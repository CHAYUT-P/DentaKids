"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  staffAddPayment,
  staffBillingSettings,
  staffCashierDay,
  staffDayClose,
  staffNextVisit,
  staffOpenBill,
  staffOpenBlankBill,
  staffSaveBill,
  staffSetDisplay,
  staffVoidBill,
  staffExpenses,
  staffClaims,
  staffSetClaimStatus,
  staffRemoveExpense,
  staffSaveExpense,
  staffStock,
} from "@/server/actions";
import { EXPENSE_CATEGORIES, type Expense, type StockItem } from "@/lib/stock";
import {
  DEFAULT_BILLING_SETTINGS,
  PAY_METHODS,
  COVERAGE_LABEL,
  CLAIM_STATUS_LABEL,
  type ClaimRow,
  type ClaimStatus,
  baht,
  billTotals,
  lineNet,
  payMethodLabel,
  type Bill,
  type BillItem,
  type BillingSettings,
  type CashierDay,
  type DayClose,
  type PayMethod,
  type PendingVisit,
} from "@/lib/billing";
import { addDays, fmtLong } from "@/lib/dates";
import { useStaff } from "@/lib/staffStore";
import { useTreatments } from "@/lib/treatmentsContext";
import { useT } from "@/i18n/lang";
import { useStaffUser, NoAccess } from "@/lib/staffUser";
import { EditionNotice } from "@/components/staff/shell/DeviceGate";
import { PatientFileButton } from "@/components/staff/patients/PatientFileView";
import { staffQuery } from "@/lib/staffNav";
import { PrintSheet, PromptPayQR } from "@/components/staff/billing/ReceiptSheet";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCreditCard,
  IconPlus,
  IconWalkIn,
  IconSmartphone,
  IconX,
} from "@/components/staff/shell/staffIcons";
import { DateField } from "@/components/staff/shell/DateField";
import { newIdempotencyKey } from "@/lib/idempotency";

type PrintTarget = { kind: "receipt"; bill: Bill } | { kind: "close"; close: DayClose };

const idleDisplay = { mode: "idle" as const, patientName: "", items: [], total: 0, paid: 0, balance: 0, qrAmount: 0 };

const fetchDay = (date: string) => Promise.all([staffCashierDay(date), staffDayClose(date)]);

/** the fields a cashier edits — what "unsaved changes" compares */
const editable = (i: BillItem) => [i.treatmentKey, i.stockItemId ?? null, i.name, i.teeth, i.qty, i.unitPrice, i.discount, i.labCost, i.dentistSlug];

/**
 * การเงิน (full edition) — the counter's money screen. รับชำระ lists who is
 * here today without a settled bill and opens their bill, built from what the
 * dentist recorded in the room; ปิดยอด is the day close: money in by method,
 * what is still owed, and each dentist's DF.
 */
export function CashierView() {
  const { edition, today, dentists, showToast } = useStaff();
  const allowed = useStaffUser().can("cashier");
  const dict = useT();
  const [tab, setTab] = useState<"pay" | "close" | "expenses" | "claims">("pay");
  const [shelf, setShelf] = useState<StockItem[]>([]);
  const [date, setDate] = useState(today);
  const [day, setDay] = useState<CashierDay | null>(null);
  const [close, setClose] = useState<DayClose | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [settings, setSettings] = useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [print, setPrint] = useState<{ target: PrintTarget; next: { date: string; time: string } | null } | null>(null);
  const [blank, setBlank] = useState<{ name: string; phone: string } | null>(null);
  /** this PC drives the customer-facing screen (remembered per device) */
  const [screen, setScreen] = useState(() => {
    try {
      return localStorage.getItem("dk:customer-screen") === "1";
    } catch {
      return false;
    }
  });
  const toggleScreen = () => {
    const next = !screen;
    setScreen(next);
    try {
      localStorage.setItem("dk:customer-screen", next ? "1" : "0");
    } catch {
      // storage blocked — the switch just won't be remembered
    }
    if (!next) void staffSetDisplay(idleDisplay).catch(() => {});
  };

  const dentistName = useCallback(
    (slug: string | null) => (slug ? (dentists.find((d) => d.slug === slug)?.text.th.name ?? slug) : "—"),
    [dentists],
  );

  /** after a change: fetch again and wait for it, so the next step sees fresh data */
  const load = useCallback(async () => {
    try {
      const [d, c] = await fetchDay(date);
      setDay(d);
      setClose(c);
    } catch {
      showToast("โหลดข้อมูลการเงินไม่สำเร็จ");
    }
  }, [date, showToast]);

  // the other counters take money too — keep this screen current
  useEffect(() => {
    let live = true;
    const tick = () =>
      fetchDay(date)
        .then(([d, c]) => {
          if (!live) return;
          setDay(d);
          setClose(c);
        })
        .catch(() => {});
    void tick();
    const t = setInterval(() => void tick(), 20_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [date]);

  useEffect(() => {
    staffBillingSettings()
      .then((r) => setSettings(r.settings))
      .catch(() => {});
    // products the counter can sell
    staffStock()
      .then((s) => setShelf(s.filter((i) => i.isActive && i.sellable)))
      .catch(() => {});
  }, []);

  // sent here for one visit (วันนี้ › รับชำระ): open that bill straight away
  useEffect(() => {
    const v = staffQuery("visit");
    const m = v?.match(/^([aw])-(\d+)$/);
    if (!m) return;
    let live = true;
    staffOpenBill(m[1] === "a" ? { appointmentId: Number(m[2]) } : { waitlistId: Number(m[2]) })
      .then(async (id) => {
        if (!live || id == null) return;
        setSelected(id);
        setTab("pay");
        // the first background refresh may land after this with older data —
        // fetch again once it has settled
        for (const wait of [0, 1500]) {
          await new Promise((r) => setTimeout(r, wait));
          const [d, c] = await fetchDay(date);
          if (!live) return;
          setDay(d);
          setClose(c);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // only on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // print once the sheet is on the page, then drop it
  useEffect(() => {
    if (!print) return;
    const t = setTimeout(() => {
      window.print();
      setPrint(null);
    }, 120);
    return () => clearTimeout(t);
  }, [print]);

  if (edition !== "full") return <EditionNotice feature="การเงิน" />;
  if (!allowed) return <NoAccess what="หน้าการเงิน" />;

  const bills = day?.bills ?? [];
  const bill = bills.find((b) => b.id === selected) ?? null;
  const owing = bills.filter((b) => b.status === "open" || b.status === "partial");
  const done = bills.filter((b) => b.status === "paid" || b.status === "void");

  const openVisit = async (p: PendingVisit) => {
    const id = await staffOpenBill({ appointmentId: p.appointmentId, waitlistId: p.waitlistId });
    if (id == null) return showToast("เปิดบิลไม่สำเร็จ");
    await load();
    setSelected(id);
  };

  const openBlank = async () => {
    if (!blank) return;
    const id = await staffOpenBlankBill({ patientName: blank.name, phone: blank.phone });
    setBlank(null);
    await load();
    setSelected(id);
  };

  const printReceipt = async (b: Bill) => {
    const next = b.phone ? await staffNextVisit(b.phone, b.date).catch(() => null) : null;
    setPrint({ target: { kind: "receipt", bill: b }, next });
  };

  return (
    <div className="staff-container cashier">
      <div className="staff-page-header">
        <div>
          <h2>การเงิน</h2>
          <p>{fmtLong(dict, date, "th")}{date === today ? " · วันนี้" : ""}</p>
        </div>
        <div className="cashier-head-actions">
          <div className="staff-pill-group">
            <button type="button" className={`staff-pill-btn ${tab === "pay" ? "active" : ""}`} onClick={() => setTab("pay")}>
              รับชำระ
            </button>
            <button type="button" className={`staff-pill-btn ${tab === "close" ? "active" : ""}`} onClick={() => setTab("close")}>
              ปิดยอดประจำวัน
            </button>
            <button type="button" className={`staff-pill-btn ${tab === "expenses" ? "active" : ""}`} onClick={() => setTab("expenses")}>
              ค่าใช้จ่าย
            </button>
            <button type="button" className={`staff-pill-btn ${tab === "claims" ? "active" : ""}`} onClick={() => setTab("claims")}>
              เบิกสิทธิ์
            </button>
          </div>
          <button type="button" className={`pay-chip ${screen ? "on" : ""}`} onClick={toggleScreen} title="ส่งบิลไปจอที่หันไปทางผู้ปกครอง">
            จอลูกค้า {screen ? "เปิด" : "ปิด"}
          </button>
          <div className="cashier-date">
            <button type="button" className="btn-date-nav" title="วันก่อนหน้า" onClick={() => setDate(addDays(date, -1))}>
              <IconChevronLeft size={16} />
            </button>
            <button type="button" className="btn-secondary-staff" disabled={date === today} onClick={() => setDate(today)}>
              วันนี้
            </button>
            <button
              type="button"
              className="btn-date-nav"
              title="วันถัดไป"
              disabled={date >= today}
              onClick={() => setDate(addDays(date, 1))}
            >
              <IconChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {tab === "pay" ? (
        <div className="cashier-grid">
          <aside className="cashier-list">
            <section>
              <h3 className="cl-head">
                รอชำระ <span>{(day?.pending.length ?? 0) + owing.length}</span>
              </h3>
              {owing.map((b) => (
                <button
                  key={`b-${b.id}`}
                  type="button"
                  className={`cl-row ${selected === b.id ? "active" : ""}`}
                  onClick={() => setSelected(b.id)}
                >
                  <span className="cl-name">{b.patientName}</span>
                  <span className="cl-sub">
                    {b.status === "partial" ? `ค้าง ${baht(b.balance)}` : `บิล ${baht(b.total)}`}
                    {b.dentistSlug ? ` · ${dentistName(b.dentistSlug)}` : ""}
                  </span>
                  <span className={`cl-tag ${b.status}`}>{b.status === "partial" ? "ชำระบางส่วน" : "เปิดบิลแล้ว"}</span>
                </button>
              ))}
              {(day?.pending ?? []).map((p) => (
                <button key={`p-${p.ref}`} type="button" className="cl-row" onClick={() => void openVisit(p)}>
                  <span className="cl-name">
                    {p.kind === "walkin" ? <IconWalkIn size={13} /> : <IconSmartphone size={13} />} {p.patientName}
                  </span>
                  <span className="cl-sub">
                    {p.time} น. · {dentistName(p.dentistSlug)}
                  </span>
                  <span className={`cl-tag ${p.status === "completed" ? "ready" : "here"}`}>
                    {p.status === "completed" ? "ตรวจเสร็จ" : p.status === "in_chair" ? "กำลังตรวจ" : "รอตรวจ"}
                  </span>
                </button>
              ))}
              {day && day.pending.length + owing.length === 0 ? <p className="cl-empty">ไม่มีคนรอชำระ</p> : null}

              {blank ? (
                <div className="cl-blank">
                  <input
                    className="form-control"
                    placeholder="ชื่อลูกค้า"
                    aria-label="ชื่อลูกค้า"
                    value={blank.name}
                    autoFocus
                    onChange={(e) => setBlank({ ...blank, name: e.target.value })}
                  />
                  <input
                    className="form-control"
                    placeholder="เบอร์โทร (ไม่บังคับ)"
                    aria-label="เบอร์โทร"
                    inputMode="tel"
                    value={blank.phone}
                    onChange={(e) => setBlank({ ...blank, phone: e.target.value })}
                  />
                  <div className="cl-blank-actions">
                    <button type="button" className="btn-secondary-staff" onClick={() => setBlank(null)}>
                      ยกเลิก
                    </button>
                    <button type="button" className="btn-primary-staff" onClick={() => void openBlank()}>
                      เปิดบิล
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="cl-add" onClick={() => setBlank({ name: "", phone: "" })}>
                  <IconPlus size={14} /> บิลใหม่ (ขายสินค้า / ไม่มีนัด)
                </button>
              )}
            </section>

            <section>
              <h3 className="cl-head">
                ชำระแล้ว <span>{done.length}</span>
              </h3>
              {done.map((b) => (
                <button
                  key={`d-${b.id}`}
                  type="button"
                  className={`cl-row ${b.status === "void" ? "void" : ""} ${selected === b.id ? "active" : ""}`}
                  onClick={() => setSelected(b.id)}
                >
                  <span className="cl-name">{b.patientName}</span>
                  <span className="cl-sub">
                    {b.receiptNo ?? "—"} · {baht(b.total)}
                  </span>
                  <span className={`cl-tag ${b.status}`}>{b.status === "void" ? "ยกเลิก" : "ชำระครบ"}</span>
                </button>
              ))}
              {done.length === 0 ? <p className="cl-empty">ยังไม่มี</p> : null}
            </section>
          </aside>

          <section className="cashier-bill">
            {bill ? (
              <BillEditor
                key={`${bill.id}-${bill.status}-${bill.payments.length}`}
                bill={bill}
                screen={screen}
                shelf={shelf}
                settings={settings}
                dentistName={dentistName}
                onChanged={load}
                onPrint={printReceipt}
                onSave={async (input) => {
                  const ok = await staffSaveBill(bill.id, input);
                  if (!ok) showToast("บันทึกบิลไม่สำเร็จ");
                  return ok;
                }}
                onPay={async (input) => {
                  const r = await staffAddPayment(bill.id, input);
                  if (!r.ok) showToast("รับชำระไม่สำเร็จ");
                  else showToast(`รับชำระแล้ว · ใบเสร็จ ${r.receiptNo ?? ""}`);
                  return r.ok;
                }}
                onVoid={async (reason) => {
                  const ok = await staffVoidBill(bill.id, reason);
                  showToast(ok ? "ยกเลิกบิลแล้ว" : "ยกเลิกบิลไม่สำเร็จ");
                  return ok;
                }}
              />
            ) : (
              <div className="cashier-empty">
                <IconCreditCard size={30} />
                <strong>เลือกคนไข้ทางซ้ายเพื่อเปิดบิล</strong>
                <span>รายการรักษาจะมาจากที่หมอบันทึกในห้องตรวจ แก้ไขหรือเพิ่มได้ก่อนรับเงิน</span>
              </div>
            )}
          </section>
        </div>
      ) : tab === "claims" ? (
        <ClaimsView date={date} />
      ) : tab === "expenses" ? (
        <ExpensesView date={date} onChanged={load} />
      ) : (
        <DayCloseView close={close} dentistName={dentistName} onPrint={() => close && setPrint({ target: { kind: "close", close }, next: null })} />
      )}

      {print ? (
        <PrintSheet target={print.target} settings={settings} dentistName={dentistName} nextVisit={print.next} />
      ) : null}
    </div>
  );
}

/* ── one bill: lines, totals, payment ──────────────────────────────────── */

function emptyLine(dentistSlug: string | null): BillItem {
  return { treatmentKey: null, name: "", teeth: "", qty: 1, unitPrice: 0, discount: 0, labCost: 0, dentistSlug, df: 0 };
}

function BillEditor({
  bill,
  screen,
  shelf,
  settings,
  dentistName,
  onSave,
  onPay,
  onVoid,
  onChanged,
  onPrint,
}: {
  bill: Bill;
  screen: boolean;
  shelf: StockItem[];
  settings: BillingSettings;
  dentistName: (slug: string | null) => string;
  onSave: (input: { items: BillItem[]; discount: number; note: string; patientName?: string }) => Promise<boolean>;
  onPay: (input: { method: PayMethod; amount: number; note?: string; idempotencyKey?: string }) => Promise<boolean>;
  onVoid: (reason: string) => Promise<boolean>;
  onChanged: () => Promise<void>;
  onPrint: (b: Bill) => void;
}) {
  const { dentists } = useStaff();
  const tr = useTreatments();
  const catalog = useMemo(() => tr.list.filter((t) => t.key !== "more"), [tr.list]);

  const [items, setItems] = useState<BillItem[]>(bill.items);
  const [discount, setDiscount] = useState(String(bill.discount || ""));
  const [note, setNote] = useState(bill.note);
  const [name, setName] = useState(bill.patientName);
  const claimMethod: PayMethod | null =
    bill.coverage === "sso" ? "sso" : bill.coverage === "nhso" ? "nhso" : bill.coverage === "insurance" ? "insurance" : null;
  const [method, setMethod] = useState<PayMethod>(claimMethod ?? "cash");
  const [amount, setAmount] = useState<string>("");
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  /** this payment's idempotency key — see `pay` */
  const [payKey] = useState(newIdempotencyKey);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [showLab, setShowLab] = useState(bill.items.some((i) => i.labCost > 0));

  // a settled receipt is final — to change it, cancel it (with a reason) and bill again
  const locked = bill.status === "void" || bill.status === "paid";
  const voided = bill.status === "void";
  const disc = Number(discount) || 0;
  const { subtotal, total } = billTotals(items, disc);
  const balance = Math.max(0, total - bill.paid);
  const payAmount = amount === "" ? balance : Math.max(0, Math.round(Number(amount) || 0));
  const change = method === "cash" && tendered ? Math.max(0, Math.round(Number(tendered) || 0) - payAmount) : 0;

  const draft = { items, discount: disc, note, patientName: name };
  const dirty =
    JSON.stringify([items.map(editable), disc, note, name]) !==
    JSON.stringify([bill.items.map(editable), bill.discount, bill.note, bill.patientName]);

  // the customer screen follows this bill as it is edited and paid
  const shown = JSON.stringify(items.map((i) => [i.name, i.qty, lineNet(i)]));
  useEffect(() => {
    if (!screen || bill.status === "void") return;
    if (bill.status === "paid") {
      void staffSetDisplay({ ...idleDisplay, mode: "thanks", patientName: bill.patientName }).catch(() => {});
      const t = setTimeout(() => void staffSetDisplay(idleDisplay).catch(() => {}), 10_000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      void staffSetDisplay({
        mode: "bill",
        patientName: bill.patientName,
        items: (JSON.parse(shown) as [string, number, number][]).map(([name, qty, amount]) => ({ name, qty, amount })),
        total,
        paid: bill.paid,
        balance,
        qrAmount: method === "promptpay" ? payAmount : 0,
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [screen, bill.status, bill.patientName, bill.paid, shown, total, balance, method, payAmount]);

  const setLine = (idx: number, patch: Partial<BillItem>) =>
    setItems((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const pickTreatment = (idx: number, key: string) => {
    if (!key) return setLine(idx, { treatmentKey: null, stockItemId: null });
    if (key.startsWith("stock:")) {
      const item = shelf.find((i) => i.id === Number(key.slice(6)));
      if (item) setLine(idx, { treatmentKey: null, stockItemId: item.id, name: item.name, unitPrice: item.price, dentistSlug: null });
      return;
    }
    const t = tr.get(key);
    setLine(idx, { treatmentKey: key, stockItemId: null, name: t.name.th, unitPrice: t.price ?? items[idx].unitPrice });
  };

  const save = async () => {
    setBusy(true);
    const ok = await onSave(draft);
    if (ok) await onChanged();
    setBusy(false);
    return ok;
  };

  const pay = async () => {
    if (payAmount <= 0 || busy) return;
    setBusy(true);
    if (dirty && !(await onSave(draft))) {
      setBusy(false);
      return;
    }
    // the same key until this payment goes through — a double click or a
    // retry after a dropped connection records the money once (the editor
    // is rebuilt after each payment, which makes the next key)
    const ok = await onPay({ method, amount: payAmount, idempotencyKey: payKey });
    await onChanged();
    setBusy(false);
    if (ok) {
      setAmount("");
      setTendered("");
    }
  };

  return (
    <div className="bill">
      <header className="bill-head">
        <div>
          {bill.appointmentId || bill.waitlistId || locked ? (
            <h3>{bill.patientName}</h3>
          ) : (
            <input className="bill-name-input" aria-label="ชื่อลูกค้า" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          {bill.childId || bill.phone ? (
            <PatientFileButton childId={bill.childId} phone={bill.phone} name={bill.patientName} label="แฟ้มคนไข้" className="btn-secondary-staff bill-file-btn" />
          ) : null}
          <span className="bill-sub">
            {bill.phone || "ไม่มีเบอร์"}
            {bill.dentistSlug ? ` · ${dentistName(bill.dentistSlug)}` : ""}
            {bill.receiptNo ? ` · ใบเสร็จ ${bill.receiptNo}` : ""}
          </span>
        </div>
        <span className={`bill-status ${bill.status}`}>
          {bill.status === "open" ? "ยังไม่ชำระ" : bill.status === "partial" ? "ชำระบางส่วน" : bill.status === "paid" ? "ชำระครบแล้ว" : "ยกเลิกแล้ว"}
        </span>
      </header>

      {bill.coverage !== "cash" && !voided ? (
        <div className={`cover-note ${bill.coverage}`}>
          <strong>สิทธิ์: {COVERAGE_LABEL[bill.coverage]}</strong>
          {bill.coverage === "sso" ? (
            <span>
              ใช้ไปแล้วปีนี้ {baht(bill.ssoUsed)} จาก {baht(settings.ssoYearLimit)} · เหลือ{" "}
              <b>{baht(Math.max(0, settings.ssoYearLimit - bill.ssoUsed))}</b> — ส่วนที่เกินเก็บเงินจากผู้ปกครอง
            </span>
          ) : bill.coverage === "nhso" ? (
            <span>
              ใช้สิทธิ์ไปแล้ว {bill.nhsoVisits} จาก {settings.nhsoVisitLimit} ครั้งในปีงบประมาณนี้
              {bill.nhsoVisits >= settings.nhsoVisitLimit ? " — ครบสิทธิ์แล้ว เก็บเงินตามปกติ" : ""}
            </span>
          ) : bill.coverage === "gov" ? (
            <span>ผู้ปกครองชำระเอง แล้วนำใบเสร็จไปเบิกต้นสังกัด</span>
          ) : (
            <span>บันทึกส่วนที่ประกันจ่ายเป็น “ประกัน / บริษัทเบิก” แล้วติดตามที่แท็บเบิกสิทธิ์</span>
          )}
        </div>
      ) : null}

      {voided ? (
        <div className="bill-void-note">
          <IconAlertTriangle size={15} /> ยกเลิกเพราะ: {bill.voidReason}
        </div>
      ) : null}

      <div className={`bill-lines ${showLab ? "with-lab" : ""}`} role="table" aria-label="รายการในบิล">
        <div className="bl-row bl-head" role="row">
          <span>รายการ</span>
          <span>ซี่ฟัน</span>
          <span className="num">จำนวน</span>
          <span className="num">ราคา/หน่วย</span>
          <span className="num">ส่วนลด</span>
          {showLab ? <span className="num">ค่าแลป</span> : null}
          <span>แพทย์</span>
          <span className="num">รวม</span>
          <span />
        </div>
        {items.map((l, idx) => (
          <div key={idx} className="bl-row" role="row">
            <span className="bl-name">
              <select
                className="form-control"
                aria-label="บริการ"
                value={l.stockItemId ? `stock:${l.stockItemId}` : (l.treatmentKey ?? "")}
                disabled={locked}
                onChange={(e) => pickTreatment(idx, e.target.value)}
              >
                <option value="">— พิมพ์เอง —</option>
                <optgroup label="หัตถการ">
                  {catalog.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name.th}
                    </option>
                  ))}
                </optgroup>
                {shelf.length ? (
                  <optgroup label="สินค้า">
                    {shelf.map((i) => (
                      <option key={i.id} value={`stock:${i.id}`}>
                        {i.name} (เหลือ {i.qty})
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              {!l.treatmentKey && !l.stockItemId ? (
                <input
                  className="form-control"
                  aria-label="ชื่อรายการ"
                  placeholder="เช่น แปรงสีฟันเด็ก"
                  value={l.name}
                  disabled={locked}
                  onChange={(e) => setLine(idx, { name: e.target.value })}
                />
              ) : null}
            </span>
            <input className="form-control" aria-label="ซี่ฟัน" placeholder="—" value={l.teeth} disabled={locked} onChange={(e) => setLine(idx, { teeth: e.target.value })} />
            <input className="form-control num" aria-label="จำนวน" inputMode="numeric" value={l.qty} disabled={locked} onChange={(e) => setLine(idx, { qty: Number(e.target.value.replace(/\D/g, "")) || 1 })} />
            <input className="form-control num" aria-label="ราคาต่อหน่วย" inputMode="numeric" value={l.unitPrice || ""} placeholder="0" disabled={locked} onChange={(e) => setLine(idx, { unitPrice: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            <input className="form-control num" aria-label="ส่วนลดรายการ" inputMode="numeric" value={l.discount || ""} placeholder="0" disabled={locked} onChange={(e) => setLine(idx, { discount: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            {showLab ? (
              <input className="form-control num" aria-label="ค่าแลป" inputMode="numeric" value={l.labCost || ""} placeholder="0" disabled={locked} onChange={(e) => setLine(idx, { labCost: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            ) : null}
            <select className="form-control" aria-label="แพทย์" value={l.dentistSlug ?? ""} disabled={locked} onChange={(e) => setLine(idx, { dentistSlug: e.target.value || null })}>
              <option value="">— ไม่มี —</option>
              {dentists.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.text.th.name}
                </option>
              ))}
            </select>
            <span className="num bl-total">{lineNet(l).toLocaleString("th-TH")}</span>
            {locked ? (
              <span />
            ) : (
              <button type="button" className="btn-action-icon danger" aria-label="ลบรายการ" onClick={() => setItems((ls) => ls.filter((_, i) => i !== idx))}>
                <IconX size={14} />
              </button>
            )}
          </div>
        ))}
        {!locked ? (
          <div className="bl-tools">
            <button type="button" className="btn-secondary-staff" onClick={() => setItems((ls) => [...ls, emptyLine(bill.dentistSlug)])}>
              <IconPlus size={14} /> เพิ่มรายการ
            </button>
            <label className="bl-lab-toggle">
              <input type="checkbox" checked={showLab} onChange={(e) => setShowLab(e.target.checked)} /> มีค่าแลป
            </label>
          </div>
        ) : null}
      </div>

      <div className="bill-bottom">
        <div className="bill-note">
          <label htmlFor="bill-note">หมายเหตุ</label>
          <textarea id="bill-note" className="form-control" rows={2} value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="bill-sum">
          <span>รวม</span>
          <span className="num">{baht(subtotal)}</span>
          <span>ส่วนลดท้ายบิล</span>
          <input className="form-control num" aria-label="ส่วนลดท้ายบิล" inputMode="numeric" placeholder="0" value={discount} disabled={locked} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ""))} />
          <strong>ยอดสุทธิ</strong>
          <strong className="num">{baht(total)}</strong>
          {bill.payments.map((p) => (
            <React.Fragment key={p.id}>
              <span className="muted">
                ชำระ {payMethodLabel(p.method)} · {new Date(p.at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="num muted">{baht(p.amount)}</span>
            </React.Fragment>
          ))}
          <strong className={balance > 0 ? "owe" : "ok"}>คงเหลือ</strong>
          <strong className={`num ${balance > 0 ? "owe" : "ok"}`}>{baht(balance)}</strong>
        </div>
      </div>

      {!locked && balance > 0 ? (
        <div className="bill-pay">
          <div className="pay-methods" role="radiogroup" aria-label="ช่องทางชำระ">
            {/* spending a deposit only makes sense when the patient has one */}
            {PAY_METHODS.filter((m) => (m.kind === "money" ? true : m.kind === "deposit" ? bill.credit > 0 : m.key === claimMethod)).map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={method === m.key}
                className={`pay-chip ${method === m.key ? "on" : ""}`}
                onClick={() => {
                  setMethod(m.key);
                  if (m.key === "credit") setAmount(String(Math.min(balance, bill.credit)));
                  if (m.key === "sso") setAmount(String(Math.min(balance, Math.max(0, settings.ssoYearLimit - bill.ssoUsed))));
                }}
              >
                {m.label}
                {m.key === "credit" ? ` (เหลือ ${baht(bill.credit)})` : ""}
              </button>
            ))}
          </div>
          <div className="pay-row">
            <label className="pay-field">
              <span>รับชำระ (บาท)</span>
              <input className="form-control num" inputMode="numeric" value={amount === "" ? String(balance) : amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </label>
            {method === "cash" ? (
              <label className="pay-field">
                <span>รับเงินมา</span>
                <input className="form-control num" inputMode="numeric" placeholder={String(payAmount)} value={tendered} onChange={(e) => setTendered(e.target.value.replace(/\D/g, ""))} />
              </label>
            ) : null}
            {method === "cash" && change > 0 ? (
              <div className="pay-change">
                ทอน <strong>{baht(change)}</strong>
              </div>
            ) : null}
            <button type="button" className="btn-primary-staff btn-lg pay-go" disabled={busy || payAmount <= 0} onClick={() => void pay()}>
              <IconCheck size={16} />
              <span>รับชำระ {baht(payAmount)}</span>
            </button>
          </div>
          {method === "promptpay" ? (
            settings.promptpayId ? (
              <div className="pay-qr">
                <PromptPayQR id={settings.promptpayId} amount={payAmount} />
                <span>ให้ผู้ปกครองสแกนจ่าย {baht(payAmount)} แล้วกดรับชำระเมื่อเห็นยอดเข้า</span>
              </div>
            ) : (
              <p className="pay-hint">ยังไม่ได้ใส่เบอร์พร้อมเพย์ — ตั้งค่า › การเงิน &amp; DF</p>
            )
          ) : null}
        </div>
      ) : null}

      <footer className="bill-actions">
        {!voided ? (
          voiding === null ? (
            <button type="button" className="btn-secondary-staff danger-soft" onClick={() => setVoiding("")}>
              ยกเลิกบิล
            </button>
          ) : (
            <div className="bill-voiding">
              <input
                className="form-control"
                aria-label="เหตุผลที่ยกเลิก"
                placeholder="เหตุผลที่ยกเลิก (จำเป็น)"
                value={voiding}
                autoFocus
                onChange={(e) => setVoiding(e.target.value)}
              />
              <button type="button" className="btn-secondary-staff" onClick={() => setVoiding(null)}>
                ไม่ยกเลิก
              </button>
              <button
                type="button"
                className="btn-primary-staff danger"
                disabled={!voiding.trim() || busy}
                onClick={async () => {
                  setBusy(true);
                  if (await onVoid(voiding)) await onChanged();
                  setBusy(false);
                }}
              >
                ยืนยันยกเลิก
              </button>
            </div>
          )
        ) : (
          <span />
        )}
        <div className="bill-actions-right">
          {!locked ? (
            <button type="button" className="btn-secondary-staff" disabled={!dirty || busy} onClick={() => void save()}>
              {dirty ? "บันทึกการแก้ไข" : "บันทึกแล้ว"}
            </button>
          ) : null}
          {bill.payments.length > 0 ? (
            <button type="button" className="btn-primary-staff" disabled={dirty} onClick={() => onPrint(bill)} title={dirty ? "บันทึกก่อนพิมพ์" : undefined}>
              พิมพ์ใบเสร็จ
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

/* ── day close ─────────────────────────────────────────────────────────── */

function DayCloseView({
  close,
  dentistName,
  onPrint,
}: {
  close: DayClose | null;
  dentistName: (slug: string | null) => string;
  onPrint: () => void;
}) {
  if (!close) return <div className="staff-empty">กำลังโหลด…</div>;
  const dfTotal = close.dentists.reduce((s, d) => s + d.df, 0);
  return (
    <div className="close-view">
      <div className="close-cards">
        <div className="close-card main">
          <span>รับเงินวันนี้</span>
          <strong>{baht(close.received)}</strong>
        </div>
        <div className="close-card">
          <span>บิลชำระครบ</span>
          <strong>{close.billsPaid}</strong>
        </div>
        <div className={`close-card ${close.owing > 0 ? "warn" : ""}`}>
          <span>ค้างชำระ</span>
          <strong>{baht(close.owing)}</strong>
          <em>{close.billsOwing} บิล</em>
        </div>
        <div className="close-card">
          <span>DF รวม</span>
          <strong>{baht(dfTotal)}</strong>
        </div>
        <div className="close-card">
          <span>ค่าใช้จ่ายวันนี้</span>
          <strong>{baht(close.expenses)}</strong>
          <em>เงินเข้าสุทธิ {baht(close.received - close.expenses)}</em>
        </div>
        {close.claims > 0 ? (
          <div className="close-card">
            <span>รอเบิกจากสิทธิ์</span>
            <strong>{baht(close.claims)}</strong>
            <em>ประกันสังคม / บัตรทอง / ประกัน</em>
          </div>
        ) : null}
      </div>

      <div className="close-cols">
        <section className="ledger-table close-table">
          <h3>แยกตามช่องทาง</h3>
          {close.byMethod.length === 0 ? <p className="cl-empty">ยังไม่มีการรับเงิน</p> : null}
          {close.byMethod.map((m) => (
            <div key={m.method} className="ct-row">
              <span>{payMethodLabel(m.method)}</span>
              <span className="muted">{m.count} รายการ</span>
              <strong className="num">{baht(m.amount)}</strong>
            </div>
          ))}
        </section>

        <section className="ledger-table close-table">
          <h3>ค่าแพทย์ (DF) — บิลที่ชำระครบ</h3>
          {close.dentists.length === 0 ? <p className="cl-empty">ยังไม่มี</p> : null}
          {close.dentists.map((d) => (
            <div key={d.dentistSlug ?? "-"} className="ct-row">
              <span>{d.dentistSlug ? dentistName(d.dentistSlug) : "ไม่ระบุแพทย์"}</span>
              <span className="muted">
                ยอด {baht(d.revenue)}
                {d.labCost ? ` · แลป ${baht(d.labCost)}` : ""}
              </span>
              <strong className="num">{baht(d.df)}</strong>
            </div>
          ))}
        </section>
      </div>

      {close.voided.length > 0 ? (
        <section className="ledger-table close-table">
          <h3>บิลที่ยกเลิก</h3>
          {close.voided.map((v, i) => (
            <div key={i} className="ct-row">
              <span>
                {v.receiptNo ?? "(ยังไม่ออกเลข)"} · {v.patientName}
              </span>
              <span className="muted">{v.reason}</span>
              <strong className="num">{baht(v.total)}</strong>
            </div>
          ))}
        </section>
      ) : null}

      <div className="close-actions">
        <button type="button" className="btn-primary-staff btn-lg" onClick={onPrint}>
          พิมพ์สรุปปิดยอด
        </button>
      </div>
    </div>
  );
}

/* ── expenses ──────────────────────────────────────────────────────────── */

function ExpensesView({ date, onChanged }: { date: string; onChanged: () => Promise<void> }) {
  const { showToast } = useStaff();
  const month = date.slice(0, 7);
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [f, setF] = useState({ date, category: EXPENSE_CATEGORIES[0], amount: "", method: "cash" as PayMethod, note: "" });

  const range = (m: string): [string, string] => [`${m}-01`, `${m}-31`];
  useEffect(() => {
    let live = true;
    staffExpenses(...range(month))
      .then((r) => live && setRows(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [month]);

  const add = async () => {
    const amount = Number(f.amount);
    if (!amount) return;
    await staffSaveExpense({ date: f.date, category: f.category, amount, method: f.method, note: f.note });
    setF({ ...f, amount: "", note: "" });
    showToast("บันทึกค่าใช้จ่ายแล้ว");
    setRows(await staffExpenses(...range(month)));
    await onChanged();
  };

  const total = (rows ?? []).reduce((s, r) => s + r.amount, 0);
  const byCat = Object.entries(
    (rows ?? []).reduce<Record<string, number>>((m, r) => ((m[r.category] = (m[r.category] ?? 0) + r.amount), m), {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="close-view">
      <section className="pf-card wide">
        <h3>บันทึกค่าใช้จ่าย</h3>
        <div className="move-form">
          <DateField ariaLabel="วันที่" value={f.date} onChange={(v) => setF({ ...f, date: v })} />
          <select className="form-control" aria-label="หมวด" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input className="form-control num" inputMode="numeric" aria-label="จำนวนเงิน" placeholder="จำนวนเงิน" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, "") })} />
          <select className="form-control" aria-label="จ่ายด้วย" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PayMethod })}>
            {PAY_METHODS.filter((m) => m.kind === "money").map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <input className="form-control" aria-label="รายละเอียด" placeholder="รายละเอียด" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <button type="button" className="btn-primary-staff" disabled={!Number(f.amount)} onClick={() => void add()}>
            บันทึก
          </button>
        </div>
      </section>
      <div className="close-cols">
        <section className="ledger-table close-table">
          <h3>ค่าใช้จ่ายเดือนนี้ — {baht(total)}</h3>
          {rows?.length === 0 ? <p className="cl-empty">ยังไม่มี</p> : null}
          {rows?.map((r) => (
            <div key={r.id} className="ct-row">
              <span>
                {r.category}
                {r.note ? <span className="muted"> · {r.note}</span> : null}
              </span>
              <span className="muted">
                {r.date} · {payMethodLabel(r.method)}
              </span>
              <span className="num">
                <strong>{baht(r.amount)}</strong>
                <button
                  type="button"
                  className="btn-action-icon danger"
                  aria-label="ลบ"
                  onClick={async () => {
                    if (!window.confirm("ลบรายการนี้?")) return;
                    await staffRemoveExpense(r.id);
                    setRows(await staffExpenses(...range(month)));
                    await onChanged();
                  }}
                >
                  <IconX size={13} />
                </button>
              </span>
            </div>
          ))}
        </section>
        <section className="ledger-table close-table">
          <h3>แยกตามหมวด</h3>
          {byCat.map(([c, amt]) => (
            <div key={c} className="ct-row">
              <span>{c}</span>
              <span className="muted">{total ? Math.round((amt / total) * 100) : 0}%</span>
              <strong className="num">{baht(amt)}</strong>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

/* ── claims to file ────────────────────────────────────────────────────── */

function ClaimsView({ date }: { date: string }) {
  const { showToast } = useStaff();
  const [month, setMonth] = useState(date.slice(0, 7));
  const [rows, setRows] = useState<ClaimRow[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [only, setOnly] = useState<ClaimStatus | "all">("pending");

  const fetchRows = useCallback(() => staffClaims(`${month}-01`, `${month}-31`), [month]);
  useEffect(() => {
    let live = true;
    fetchRows()
      .then((r) => live && setRows(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [fetchRows]);

  const shown = (rows ?? []).filter((r) => only === "all" || r.status === only);
  const sum = (s: ClaimStatus) => (rows ?? []).filter((r) => r.status === s).reduce((t, r) => t + r.amount, 0);

  const mark = async (status: ClaimStatus) => {
    await staffSetClaimStatus(picked, status);
    setPicked([]);
    setRows(await fetchRows());
    showToast(`อัปเดต ${picked.length} รายการเป็น “${CLAIM_STATUS_LABEL[status]}”`);
  };

  const exportCsv = () => {
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["วันที่", "สิทธิ์", "ชื่อผู้รับบริการ", "เลขบัตรประชาชน", "รายการ", "จำนวนเงิน", "เลขที่ใบเสร็จ", "สถานะ"],
      ...shown.map((r) => [r.date, payMethodLabel(r.method), r.patientName, r.idCard, r.items, r.amount, r.receiptNo ?? "", CLAIM_STATUS_LABEL[r.status]]),
    ];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + lines.map((l) => l.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `claims-${month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="close-view">
      <div className="close-cards">
        <div className="close-card">
          <span>รอยื่นเบิก</span>
          <strong>{baht(sum("pending"))}</strong>
        </div>
        <div className="close-card">
          <span>ยื่นเบิกแล้ว รอเงิน</span>
          <strong>{baht(sum("submitted"))}</strong>
        </div>
        <div className="close-card">
          <span>ได้รับเงินแล้ว</span>
          <strong>{baht(sum("paid"))}</strong>
        </div>
        <div className={`close-card ${sum("rejected") ? "warn" : ""}`}>
          <span>ถูกปฏิเสธ</span>
          <strong>{baht(sum("rejected"))}</strong>
        </div>
      </div>

      <div className="staff-toolbar">
        <input className="form-control month-input" type="month" aria-label="เดือน" value={month} onChange={(e) => setMonth(e.target.value)} />
        <div className="staff-pill-group">
          {(["pending", "submitted", "paid", "rejected", "all"] as const).map((k) => (
            <button key={k} type="button" className={`staff-pill-btn ${only === k ? "active" : ""}`} onClick={() => setOnly(k)}>
              {k === "all" ? "ทั้งหมด" : CLAIM_STATUS_LABEL[k]}
            </button>
          ))}
        </div>
        <button type="button" className="btn-secondary-staff" style={{ marginLeft: "auto" }} disabled={!shown.length} onClick={exportCsv}>
          ส่งออกรายการเบิก (CSV)
        </button>
      </div>

      {picked.length ? (
        <div className="claims-bar">
          <span>เลือก {picked.length} รายการ →</span>
          <button type="button" className="btn-secondary-staff" onClick={() => void mark("submitted")}>
            ยื่นเบิกแล้ว
          </button>
          <button type="button" className="btn-primary-staff" onClick={() => void mark("paid")}>
            ได้รับเงินแล้ว
          </button>
          <button type="button" className="btn-secondary-staff danger-soft" onClick={() => void mark("rejected")}>
            ถูกปฏิเสธ
          </button>
        </div>
      ) : null}

      <section className="ledger-table">
        {rows === null ? <p className="cl-empty" style={{ padding: "12px 18px" }}>กำลังโหลด…</p> : null}
        {rows && shown.length === 0 ? <p className="cl-empty" style={{ padding: "12px 18px" }}>ไม่มีรายการในเดือนนี้</p> : null}
        {shown.map((r) => (
          <label key={r.paymentId} className="claim-row">
            <input
              type="checkbox"
              checked={picked.includes(r.paymentId)}
              onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.paymentId] : p.filter((x) => x !== r.paymentId)))}
            />
            <span className="muted">{r.date}</span>
            <span>
              <strong>{r.patientName}</strong>
              <span className="muted"> · {r.idCard || "ไม่มีเลขบัตร"}</span>
              <span className="muted claim-items">{r.items}</span>
            </span>
            <span>{payMethodLabel(r.method)}</span>
            <strong className="num">{baht(r.amount)}</strong>
            <span className={`cl-tag ${r.status === "paid" ? "paid" : r.status === "rejected" ? "void" : "open"}`}>{CLAIM_STATUS_LABEL[r.status]}</span>
          </label>
        ))}
      </section>
      <p className="settings-help">
        ระบบเก็บรายการให้ครบพร้อมเลขบัตรประชาชน — นำไฟล์ CSV ไปยื่นในระบบของสำนักงานประกันสังคม / สปสช. แล้วกลับมาอัปเดตสถานะที่นี่
      </p>
    </div>
  );
}
