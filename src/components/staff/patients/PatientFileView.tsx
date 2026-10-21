"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  staffBillFromPlan,
  staffBillingSettings,
  staffFileBody,
  staffMedications,
  staffPatientFile,
  staffRemoveDoc,
  staffRemoveFile,
  staffRemovePlan,
  staffSaveDoc,
  staffSaveMedication,
  staffSavePlan,
  staffSetTeeth,
  staffSignPlan,
  staffTakeDeposit,
  staffUploadFile,
} from "@/server/actions";
import {
  DEFAULT_BILLING_SETTINGS,
  PAY_METHODS,
  COVERAGE_LABEL,
  asCoverage,
  baht,
  lineNet,
  payMethodLabel,
  type BillingSettings,
  type PayMethod,
} from "@/lib/billing";
import {
  PLAN_STATUS_LABEL,
  type ClinicalDocRow,
  type DocKind,
  type FileMeta,
  type Medication,
  type PatientFileData,
  type PlanItemRow,
  type PlanRow,
  type PlanStatus,
  type RxLine,
  PDPA_TEXT,
} from "@/lib/clinical";
import { fmtLong } from "@/lib/dates";
import { useStaff } from "@/lib/staffStore";
import { useTreatments } from "@/lib/treatmentsContext";
import { useT } from "@/i18n/lang";
import { useStaffUser } from "@/lib/staffUser";
import { ClinicalPrint, type ClinicalPrintTarget } from "@/components/staff/patients/ClinicalPrint";
import { Odontogram } from "@/components/staff/patients/Odontogram";
import { SignaturePad } from "@/components/staff/patients/SignaturePad";
import { PatientForm, formFromRecord, toPatientPayload } from "@/components/staff/patients/PatientForm";
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconEdit,
  IconPhone,
  IconPlus,
  IconX,
} from "@/components/staff/shell/staffIcons";
import { DateField } from "@/components/staff/shell/DateField";

type Tab = "overview" | "chart" | "plans" | "history" | "docs" | "files";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "ภาพรวม" },
  { key: "chart", label: "ฟัน" },
  { key: "plans", label: "แผนการรักษา" },
  { key: "history", label: "ประวัติ" },
  { key: "docs", label: "เอกสาร" },
  { key: "files", label: "รูป / X-ray" },
];

const VISIT_STATUS: Record<string, string> = {
  confirmed: "นัดไว้",
  arrived: "มาแล้ว",
  in_chair: "กำลังตรวจ",
  completed: "ตรวจเสร็จ",
  cancelled: "ยกเลิก",
  no_show: "ไม่มา",
  waiting: "รอตรวจ",
};

/**
 * แฟ้มคนไข้ (full edition) — everything about one patient: who they are and
 * what to watch for, the dental chart, plans and estimates, every visit and
 * bill, paperwork and images.
 */
export function PatientFileView({ childId, onBack }: { childId: number; onBack?: () => void }) {
  const { today, patients, updatePatient, dentists, showToast } = useStaff();
  const { can } = useStaffUser();
  const dict = useT();
  const [file, setFile] = useState<PatientFileData | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [settings, setSettings] = useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [print, setPrint] = useState<ClinicalPrintTarget | null>(null);
  const [editing, setEditing] = useState(false);

  const dentistName = useCallback(
    (slug: string | null) => (slug ? (dentists.find((d) => d.slug === slug)?.text.th.name ?? slug) : "—"),
    [dentists],
  );
  const day = (iso: string) => fmtLong(dict, iso, "th");

  const reload = useCallback(async () => {
    const f = await staffPatientFile(childId);
    setFile(f);
    setMissing(!f);
  }, [childId]);

  useEffect(() => {
    let live = true;
    staffPatientFile(childId)
      .then((f) => {
        if (!live) return;
        setFile(f);
        setMissing(!f);
      })
      .catch(() => setMissing(true));
    staffBillingSettings()
      .then((r) => live && setSettings(r.settings))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [childId]);

  useEffect(() => {
    if (!print) return;
    const t = setTimeout(() => {
      window.print();
      setPrint(null);
    }, 120);
    return () => clearTimeout(t);
  }, [print]);

  if (missing) {
    return (
      <div className="staff-container">
        <div className="staff-empty">ไม่พบแฟ้มคนไข้นี้</div>
      </div>
    );
  }
  if (!file) return <div className="staff-container"><div className="staff-empty">กำลังเปิดแฟ้ม…</div></div>;

  const family = patients.find((p) => p.id === String(file.guardianId));
  const upcoming = file.visits.filter((v) => v.status === "confirmed" && v.date >= today).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
  const recallOpen = file.recalls.find((r) => r.status === "due" || r.status === "contacted");
  const allergic = file.allergies && file.allergies !== "ไม่มี";

  return (
    <div className="staff-container pf">
      <header className="pf-head">
        {onBack ? (
          <button type="button" className="btn-action-icon" title="กลับ" onClick={onBack}>
            <IconChevronLeft size={16} />
          </button>
        ) : null}
        <div className="pf-who">
          <h2>
            {file.fullName || file.name}
            {file.nickname || (file.fullName && file.name !== file.fullName) ? (
              <span className="pf-nick"> ({file.nickname || file.name})</span>
            ) : null}
          </h2>
          <p>
            {file.hn ? `HN ${file.hn} · ` : ""}
            {file.age != null ? `${file.age} ปี · ` : ""}
            <IconPhone size={12} /> {file.guardian.phone}
            {file.guardian.name ? ` · ${file.guardian.relation || "ผู้ปกครอง"} ${file.guardian.name}` : ""}
          </p>
          {file.tags.length || file.coverage !== "cash" ? (
            <div className="pf-tags">
              {file.coverage !== "cash" ? <span className="cover">สิทธิ์ {COVERAGE_LABEL[asCoverage(file.coverage)]}</span> : null}
              {file.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="pf-money">
          {file.owing > 0 ? <span className="pf-owing">ค้างชำระ {baht(file.owing)}</span> : null}
          {file.credit > 0 ? <span className="pf-credit">มัดจำคงเหลือ {baht(file.credit)}</span> : null}
          {family ? (
            <button type="button" className="btn-secondary-staff" onClick={() => setEditing(true)}>
              <IconEdit size={14} /> แก้ไขข้อมูล
            </button>
          ) : null}
        </div>
      </header>

      {allergic ? (
        <div className="pf-alert">
          <IconAlertTriangle size={16} /> แพ้ยา/อาหาร: <strong>{file.allergies}</strong>
        </div>
      ) : null}

      <nav className="pf-tabs" role="tablist">
        {TABS.filter((t) => can("chart") || !["chart", "plans", "docs"].includes(t.key)).map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === "plans" && file.plans.length ? <em>{file.plans.length}</em> : null}
            {t.key === "files" && file.files.length ? <em>{file.files.length}</em> : null}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="pf-grid">
          <section className="pf-card">
            <h3>ข้อมูลคนไข้</h3>
            <dl>
              <dt>ชื่อ-นามสกุล</dt>
              <dd>{file.fullName || "—"}</dd>
              <dt>ชื่อเล่น</dt>
              <dd>{file.nickname || file.name}</dd>
              <dt>วันเกิด</dt>
              <dd>{file.birthdate ? day(file.birthdate) : "—"}</dd>
              <dt>เพศ</dt>
              <dd>{file.gender === "male" ? "ชาย" : file.gender === "female" ? "หญิง" : "—"}</dd>
              <dt>เลขบัตรประชาชน</dt>
              <dd>{file.idCard || "—"}</dd>
              <dt>กรุ๊ปเลือด</dt>
              <dd>{file.bloodType || "—"}</dd>
            </dl>
          </section>
          <section className="pf-card">
            <h3>สุขภาพ</h3>
            <dl>
              <dt>แพ้ยา/อาหาร</dt>
              <dd className={allergic ? "warn" : ""}>{file.allergies || "—"}</dd>
              <dt>โรคประจำตัว</dt>
              <dd>{file.conditions || "—"}</dd>
              <dt>ยาที่ใช้ประจำ</dt>
              <dd>{file.medications || "—"}</dd>
              <dt>ข้อควรระวัง</dt>
              <dd>{file.notes || "—"}</dd>
            </dl>
          </section>
          <section className="pf-card">
            <h3>ผู้ปกครอง</h3>
            <dl>
              <dt>ชื่อ</dt>
              <dd>
                {file.guardian.fullName || file.guardian.name || "—"}
                {file.guardian.relation ? ` (${file.guardian.relation})` : ""}
              </dd>
              <dt>โทร</dt>
              <dd>{file.guardian.phone || "—"}</dd>
              <dt>LINE</dt>
              <dd>{file.guardian.lineContact || "—"}</dd>
              <dt>ที่อยู่</dt>
              <dd>{file.guardian.address || "—"}</dd>
            </dl>
          </section>
          <section className="pf-card">
            <h3>นัดหมาย &amp; รอบตรวจ</h3>
            {upcoming.length === 0 ? <p className="cl-empty">ไม่มีนัดที่จะถึง</p> : null}
            {upcoming.slice(0, 3).map((v) => (
              <p key={v.ref} className="pf-line">
                {day(v.date)} {v.time} น. · {dentistName(v.dentistSlug)}
              </p>
            ))}
            <p className="pf-line muted">
              {recallOpen
                ? `ครบรอบตรวจ ${day(recallOpen.dueDate)}`
                : file.recallMonths > 0
                  ? `ตรวจตามรอบทุก ${file.recallMonths} เดือน`
                  : "ไม่ได้ตั้งรอบตรวจ"}
            </p>
          </section>
          {can("cashier") ? <DepositCard file={file} onDone={reload} /> : null}
        </div>
      ) : null}

      {tab === "chart" ? (
        <Odontogram
          age={file.age}
          chart={file.chart}
          history={file.chartHistory}
          onSave={async (input) => {
            await staffSetTeeth({ childId: file.childId, ...input });
            showToast("บันทึกชาร์ตฟันแล้ว");
            await reload();
          }}
        />
      ) : null}

      {tab === "plans" ? (
        <PlansTab
          file={file}
          dentistName={dentistName}
          onPrint={(plan) => setPrint({ kind: "estimate", plan })}
          onChanged={reload}
        />
      ) : null}

      {tab === "history" ? (
        <div className="pf-history">
          <section className="pf-card wide">
            <h3>การรักษาที่ผ่านมา</h3>
            {file.visits.length === 0 ? <p className="cl-empty">ยังไม่มีประวัติ</p> : null}
            {file.visits.map((v) => (
              <div key={`${v.kind}-${v.id}`} className="ph-row">
                <span className="ph-date">
                  {day(v.date)}
                  <em>{v.time} น.</em>
                </span>
                <span className="ph-body">
                  <VisitItems items={v.items} fallbackKey={v.treatmentKey} />
                  {v.detail ? <span className="ph-detail">{v.detail}</span> : null}
                </span>
                <span className="ph-side">
                  <span className={`cl-tag ${v.status === "completed" ? "paid" : v.status === "cancelled" || v.status === "no_show" ? "void" : "open"}`}>
                    {VISIT_STATUS[v.status] ?? v.status}
                  </span>
                  <span className="muted">{dentistName(v.dentistSlug)}</span>
                </span>
              </div>
            ))}
          </section>
          <section className="pf-card wide">
            <h3>บิล &amp; ใบเสร็จ</h3>
            {file.bills.length === 0 ? <p className="cl-empty">ยังไม่มีบิล</p> : null}
            {file.bills.map((b) => (
              <div key={b.id} className="ph-row">
                <span className="ph-date">{day(b.date)}</span>
                <span className="ph-body">
                  <strong>{b.receiptNo ?? "ยังไม่ออกใบเสร็จ"}</strong>
                  <span className="muted">{b.items.map((i) => i.name).join(", ")}</span>
                  {b.payments.length ? (
                    <span className="muted">ชำระ: {b.payments.map((p) => `${payMethodLabel(p.method)} ${baht(p.amount)}`).join(" · ")}</span>
                  ) : null}
                </span>
                <span className="ph-side">
                  <strong className={b.status === "void" ? "struck" : ""}>{baht(b.total)}</strong>
                  <span className={`cl-tag ${b.status}`}>
                    {b.status === "paid" ? "ชำระครบ" : b.status === "void" ? "ยกเลิก" : b.status === "partial" ? `ค้าง ${baht(b.balance)}` : "ยังไม่ชำระ"}
                  </span>
                </span>
              </div>
            ))}
          </section>
        </div>
      ) : null}

      {tab === "docs" ? (
        <DocsTab file={file} dentistName={dentistName} onPrint={(doc) => setPrint({ kind: "doc", doc })} onChanged={reload} />
      ) : null}

      {tab === "files" ? <FilesTab file={file} onChanged={reload} /> : null}

      {editing && family ? (
        <div className="modal-overlay" onClick={() => setEditing(false)}>
          <div className="modal-card modal-card-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>แก้ไขข้อมูลคนไข้</h3>
              <button type="button" className="btn-action-icon" aria-label="ปิด" onClick={() => setEditing(false)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              <PatientForm
                initial={formFromRecord(family)}
                submitLabel="บันทึกการแก้ไข"
                onSubmit={(s) => {
                  updatePatient(family.id, toPatientPayload(s));
                  setEditing(false);
                  showToast("บันทึกข้อมูลคนไข้แล้ว");
                  setTimeout(() => void reload(), 1200);
                }}
                onCancel={() => setEditing(false)}
              />
            </div>
          </div>
        </div>
      ) : null}

      {print ? <ClinicalPrint target={print} patient={file} settings={settings} dentistName={dentistName} /> : null}
    </div>
  );
}

function VisitItems({ items, fallbackKey }: { items: { key: string; teeth: string; qty: number; price: number }[]; fallbackKey: string }) {
  const tr = useTreatments();
  if (!items.length) return <span>{tr.name(fallbackKey)}</span>;
  return (
    <span>
      {items.map((i, idx) => (
        <span key={idx} className="ph-item">
          {tr.name(i.key)}
          {i.teeth ? ` ซี่ ${i.teeth}` : ""}
          {i.qty > 1 ? ` ×${i.qty}` : ""}
        </span>
      ))}
    </span>
  );
}

/* ── deposit ───────────────────────────────────────────────────────────── */

function DepositCard({ file, onDone }: { file: PatientFileData; onDone: () => Promise<void> }) {
  const { showToast } = useStaff();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [busy, setBusy] = useState(false);

  const take = async () => {
    const n = Number(amount);
    if (!n) return;
    setBusy(true);
    const id = await staffTakeDeposit({ childId: file.childId, amount: n, method });
    setBusy(false);
    if (id) {
      showToast(`รับมัดจำ ${baht(n)} แล้ว — ดูใบเสร็จที่หน้าการเงิน`);
      setAmount("");
      await onDone();
    } else showToast("รับมัดจำไม่สำเร็จ");
  };

  return (
    <section className="pf-card">
      <h3>การเงิน</h3>
      <dl>
        <dt>ค้างชำระ</dt>
        <dd className={file.owing > 0 ? "warn" : ""}>{baht(file.owing)}</dd>
        <dt>เงินมัดจำคงเหลือ</dt>
        <dd>{baht(file.credit)}</dd>
      </dl>
      <div className="pf-deposit">
        <input className="form-control num" inputMode="numeric" placeholder="จำนวนเงิน" aria-label="จำนวนเงินมัดจำ" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
        <select className="form-control" aria-label="ช่องทาง" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
          {PAY_METHODS.filter((m) => m.kind === "money").map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn-primary-staff" disabled={!amount || busy} onClick={() => void take()}>
          รับมัดจำ
        </button>
      </div>
      <p className="form-hint">ใช้หักในบิลครั้งต่อไปได้ ด้วยช่องทาง “หักเงินมัดจำ” ที่หน้าการเงิน</p>
    </section>
  );
}

/* ── plans, estimates, contracts ───────────────────────────────────────── */

function blankPlan(): Omit<PlanRow, "id" | "itemsTotal" | "paid" | "createdAt" | "signature" | "signedBy" | "signedAt"> & { id: number | null } {
  return { id: null, title: "", kind: "plan", status: "draft", agreedTotal: null, note: "", dentistSlug: null, items: [] };
}

function PlansTab({
  file,
  dentistName,
  onPrint,
  onChanged,
}: {
  file: PatientFileData;
  dentistName: (slug: string | null) => string;
  onPrint: (plan: PlanRow) => void;
  onChanged: () => Promise<void>;
}) {
  const { dentists, showToast } = useStaff();
  const tr = useTreatments();
  const catalog = useMemo(() => tr.list.filter((t) => t.key !== "more"), [tr.list]);
  const [draft, setDraft] = useState<ReturnType<typeof blankPlan> | null>(null);
  const [picked, setPicked] = useState<Record<number, number[]>>({});
  const [instalment, setInstalment] = useState<Record<number, string>>({});
  const [signing, setSigning] = useState<{ plan: PlanRow; png: string; name: string } | null>(null);

  const sign = async () => {
    if (!signing?.png) return;
    const ok = await staffSignPlan(signing.plan.id, signing.png, signing.name);
    showToast(ok ? "บันทึกลายเซ็นแล้ว — แผนนี้ตกลงแล้ว" : "บันทึกลายเซ็นไม่สำเร็จ");
    setSigning(null);
    await onChanged();
  };

  const save = async () => {
    if (!draft) return;
    await staffSavePlan({ ...draft, childId: file.childId });
    setDraft(null);
    showToast("บันทึกแผนการรักษาแล้ว");
    await onChanged();
  };

  const setItem = (idx: number, patch: Partial<PlanItemRow>) =>
    setDraft((d) => (d ? { ...d, items: d.items.map((i, n) => (n === idx ? { ...i, ...patch } : i)) } : d));

  const toBill = async (p: PlanRow) => {
    const id =
      p.kind === "contract"
        ? await staffBillFromPlan({ planId: p.id, itemIds: [], instalment: Number(instalment[p.id]) || 0 })
        : await staffBillFromPlan({ planId: p.id, itemIds: picked[p.id] ?? [] });
    showToast(id ? "ส่งไปที่หน้าการเงินแล้ว — เก็บเงินได้เลย" : "ส่งไม่สำเร็จ");
    setPicked((x) => ({ ...x, [p.id]: [] }));
    await onChanged();
  };

  if (draft) {
    const total = draft.items.filter((i) => i.status !== "cancelled").reduce((s, i) => s + lineNet(i), 0);
    return (
      <section className="pf-card wide plan-edit">
        <h3>{draft.id ? "แก้ไขแผนการรักษา" : "แผนการรักษาใหม่"}</h3>
        <div className="form-row-2">
          <div className="form-group">
            <label htmlFor="plan-title">ชื่อแผน</label>
            <input id="plan-title" className="form-control" placeholder="เช่น อุดฟันน้ำนม 4 ซี่ / จัดฟันแบบติดแน่น" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div className="form-group">
            <label>ประเภท</label>
            <div className="staff-pill-group">
              <button type="button" className={`staff-pill-btn ${draft.kind === "plan" ? "active" : ""}`} onClick={() => setDraft({ ...draft, kind: "plan" })}>
                แผน / ใบเสนอราคา
              </button>
              <button type="button" className={`staff-pill-btn ${draft.kind === "contract" ? "active" : ""}`} onClick={() => setDraft({ ...draft, kind: "contract" })}>
                สัญญาแบ่งจ่าย (เช่น จัดฟัน)
              </button>
            </div>
          </div>
        </div>
        <div className="form-row-2">
          <div className="form-group">
            <label htmlFor="plan-dentist">ทันตแพทย์</label>
            <select id="plan-dentist" className="form-control" value={draft.dentistSlug ?? ""} onChange={(e) => setDraft({ ...draft, dentistSlug: e.target.value || null })}>
              <option value="">— ไม่ระบุ —</option>
              {dentists.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.text.th.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="plan-status">สถานะ</label>
            <select id="plan-status" className="form-control" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as PlanStatus })}>
              {(Object.keys(PLAN_STATUS_LABEL) as PlanStatus[]).map((k) => (
                <option key={k} value={k}>
                  {PLAN_STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {draft.kind === "contract" ? (
          <div className="form-group">
            <label htmlFor="plan-agreed">ราคาตกลงทั้งคอร์ส (บาท)</label>
            <input id="plan-agreed" className="form-control num" inputMode="numeric" value={draft.agreedTotal ?? ""} onChange={(e) => setDraft({ ...draft, agreedTotal: Number(e.target.value.replace(/\D/g, "")) || null })} />
          </div>
        ) : null}

        <div className="bill-lines">
          <div className="pl-row bl-head">
            <span>รายการ</span>
            <span>ซี่ฟัน</span>
            <span className="num">จำนวน</span>
            <span className="num">ราคา</span>
            <span className="num">ส่วนลด</span>
            <span>สถานะ</span>
            <span className="num">รวม</span>
            <span />
          </div>
          {draft.items.map((i, idx) => (
            <div key={idx} className="pl-row">
              <select
                className="form-control"
                aria-label="บริการ"
                value={i.treatmentKey ?? ""}
                onChange={(e) => {
                  const t = e.target.value ? tr.get(e.target.value) : null;
                  setItem(idx, t ? { treatmentKey: t.key, name: t.name.th, unitPrice: t.price ?? i.unitPrice } : { treatmentKey: null });
                }}
              >
                <option value="">— พิมพ์เอง —</option>
                {catalog.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name.th}
                  </option>
                ))}
              </select>
              <input className="form-control" aria-label="ซี่ฟัน" value={i.teeth} onChange={(e) => setItem(idx, { teeth: e.target.value })} />
              <input className="form-control num" aria-label="จำนวน" inputMode="numeric" value={i.qty} onChange={(e) => setItem(idx, { qty: Number(e.target.value.replace(/\D/g, "")) || 1 })} />
              <input className="form-control num" aria-label="ราคา" inputMode="numeric" value={i.unitPrice || ""} onChange={(e) => setItem(idx, { unitPrice: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
              <input className="form-control num" aria-label="ส่วนลด" inputMode="numeric" value={i.discount || ""} placeholder="0" onChange={(e) => setItem(idx, { discount: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
              <select className="form-control" aria-label="สถานะรายการ" value={i.status} onChange={(e) => setItem(idx, { status: e.target.value as PlanItemRow["status"] })}>
                <option value="planned">รอทำ</option>
                <option value="done">ทำแล้ว</option>
                <option value="cancelled">ยกเลิก</option>
              </select>
              <span className="num">{lineNet(i).toLocaleString("th-TH")}</span>
              <button type="button" className="btn-action-icon danger" aria-label="ลบรายการ" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, n) => n !== idx) })}>
                <IconX size={14} />
              </button>
            </div>
          ))}
          {!draft.items.length ? (
            <p className="cl-empty">ยังไม่มีรายการ</p>
          ) : null}
          {(() => {
            const empty: PlanItemRow = { treatmentKey: null, name: "", teeth: "", qty: 1, unitPrice: 0, discount: 0, status: "planned", doneAt: null };
            return (
              <div className="bl-tools">
                <button type="button" className="btn-secondary-staff" onClick={() => setDraft({ ...draft, items: [...draft.items, empty] })}>
                  <IconPlus size={14} /> เพิ่มรายการ
                </button>
                <span className="vl-total">รวม {baht(total)}</span>
              </div>
            );
          })()}
        </div>
        <div className="form-group">
          <label htmlFor="plan-note">หมายเหตุ</label>
          <textarea id="plan-note" className="form-control" rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </div>
        <div className="settings-save">
          <button type="button" className="btn-secondary-staff" onClick={() => setDraft(null)}>
            ยกเลิก
          </button>
          <button type="button" className="btn-primary-staff" onClick={() => void save()}>
            บันทึกแผน
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="plans">
      {signing ? (
        <div className="modal-overlay" onClick={() => setSigning(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>ยอมรับแผนการรักษา · {signing.plan.title}</h3>
            </div>
            <div className="modal-body sign-body">
              <p>
                ราคา{signing.plan.kind === "contract" ? "ตกลง" : "ประมาณการ"}{" "}
                <strong>{baht(signing.plan.kind === "contract" && signing.plan.agreedTotal != null ? signing.plan.agreedTotal : signing.plan.itemsTotal)}</strong>
                {" · "}
                {signing.plan.items.filter((i) => i.status !== "cancelled").map((i) => i.name).join(", ")}
              </p>
              <label className="sign-name">
                ชื่อผู้เซ็น
                <input className="form-control" value={signing.name} onChange={(e) => setSigning({ ...signing, name: e.target.value })} />
              </label>
              <SignaturePad onChange={(png) => setSigning((s) => (s ? { ...s, png } : s))} />
              <div className="settings-save">
                <button type="button" className="btn-secondary-staff" onClick={() => setSigning(null)}>
                  ยกเลิก
                </button>
                <button type="button" className="btn-primary-staff" disabled={!signing.png || !signing.name.trim()} onClick={() => void sign()}>
                  ยืนยันลายเซ็น
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <div className="plans-top">
        <button type="button" className="btn-primary-staff" onClick={() => setDraft(blankPlan())}>
          <IconPlus size={14} /> แผน / ใบเสนอราคาใหม่
        </button>
      </div>
      {file.plans.length === 0 ? <p className="cl-empty">ยังไม่มีแผนการรักษา</p> : null}
      {file.plans.map((p) => {
        const contract = p.kind === "contract";
        const left = contract && p.agreedTotal != null ? Math.max(0, p.agreedTotal - p.paid) : 0;
        const sel = picked[p.id] ?? [];
        return (
          <section key={p.id} className="pf-card wide plan-card">
            <header>
              <div>
                <h3>{p.title}</h3>
                <span className="muted">
                  {contract ? "สัญญาแบ่งจ่าย" : "แผนการรักษา"} · {dentistName(p.dentistSlug)} · {PLAN_STATUS_LABEL[p.status]}
                </span>
              </div>
              <div className="plan-actions">
                {p.signature ? (
                  <span className="plan-signed" title={p.signedAt ? new Date(p.signedAt).toLocaleString("th-TH") : ""}>
                    ✓ เซ็นยอมรับแล้ว{p.signedBy ? ` · ${p.signedBy}` : ""}
                  </span>
                ) : p.status === "draft" || p.status === "accepted" ? (
                  <button
                    type="button"
                    className="btn-secondary-staff"
                    onClick={() => setSigning({ plan: p, png: "", name: file.guardian.fullName || file.guardian.name })}
                  >
                    ให้ผู้ปกครองเซ็น
                  </button>
                ) : null}
                <button type="button" className="btn-secondary-staff" onClick={() => onPrint(p)}>
                  พิมพ์ใบเสนอราคา
                </button>
                <button
                  type="button"
                  className="btn-secondary-staff"
                  onClick={() => setDraft({ id: p.id, title: p.title, kind: p.kind, status: p.status, agreedTotal: p.agreedTotal, note: p.note, dentistSlug: p.dentistSlug, items: p.items })}
                >
                  แก้ไข
                </button>
                <button
                  type="button"
                  className="btn-action-icon danger"
                  aria-label="ลบแผน"
                  onClick={async () => {
                    if (!window.confirm(`ลบแผน “${p.title}”?`)) return;
                    await staffRemovePlan(p.id);
                    await onChanged();
                  }}
                >
                  <IconX size={14} />
                </button>
              </div>
            </header>
            {p.items.map((i) => (
              <label key={i.id} className={`plan-line ${i.status}`}>
                {!contract && i.status === "planned" ? (
                  <input
                    type="checkbox"
                    checked={sel.includes(i.id!)}
                    onChange={(e) =>
                      setPicked((x) => ({ ...x, [p.id]: e.target.checked ? [...sel, i.id!] : sel.filter((v) => v !== i.id) }))
                    }
                  />
                ) : (
                  <span className="plan-dot" />
                )}
                <span>
                  {i.name}
                  {i.teeth ? ` · ซี่ ${i.teeth}` : ""}
                  {i.qty > 1 ? ` ×${i.qty}` : ""}
                </span>
                <span className="muted">{i.status === "done" ? `ทำแล้ว${i.doneAt ? ` ${i.doneAt}` : ""}` : i.status === "cancelled" ? "ยกเลิก" : "รอทำ"}</span>
                <span className="num">{baht(lineNet(i))}</span>
              </label>
            ))}
            <footer className="plan-foot">
              {contract ? (
                <>
                  <span>
                    ราคาตกลง <strong>{baht(p.agreedTotal ?? 0)}</strong> · จ่ายแล้ว <strong>{baht(p.paid)}</strong> · คงเหลือ{" "}
                    <strong className={left > 0 ? "owe" : ""}>{baht(left)}</strong>
                  </span>
                  <span className="plan-bill">
                    <input
                      className="form-control num"
                      inputMode="numeric"
                      placeholder="ค่างวดครั้งนี้"
                      aria-label="ค่างวดครั้งนี้"
                      value={instalment[p.id] ?? ""}
                      onChange={(e) => setInstalment((x) => ({ ...x, [p.id]: e.target.value.replace(/\D/g, "") }))}
                    />
                    <button type="button" className="btn-primary-staff" disabled={!Number(instalment[p.id])} onClick={() => void toBill(p)}>
                      ส่งเก็บค่างวด
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span>
                    รวมทั้งแผน <strong>{baht(p.itemsTotal)}</strong>
                  </span>
                  <button type="button" className="btn-primary-staff" disabled={!sel.length} onClick={() => void toBill(p)}>
                    ส่งรายการที่เลือกไปเก็บเงิน ({sel.length})
                  </button>
                </>
              )}
            </footer>
          </section>
        );
      })}
    </div>
  );
}

/* ── paperwork ─────────────────────────────────────────────────────────── */

const DOC_LABEL: Record<DocKind, string> = {
  prescription: "ใบสั่งยา",
  certificate: "ใบรับรองแพทย์",
  referral: "ใบส่งตัว",
  consent: "ใบยินยอมรับการรักษา",
  pdpa: "ยินยอมเก็บข้อมูล (PDPA)",
};

function DocsTab({
  file,
  dentistName,
  onPrint,
  onChanged,
}: {
  file: PatientFileData;
  dentistName: (slug: string | null) => string;
  onPrint: (doc: Pick<ClinicalDocRow, "kind" | "date" | "dentistSlug" | "data">) => void;
  onChanged: () => Promise<void>;
}) {
  const { today, dentists, showToast } = useStaff();
  const [form, setForm] = useState<{ id: number | null; kind: DocKind; date: string; dentistSlug: string; data: Record<string, unknown> } | null>(null);
  const [meds, setMeds] = useState<Medication[]>([]);

  useEffect(() => {
    if (form?.kind !== "prescription") return;
    let live = true;
    staffMedications()
      .then((m) => live && setMeds(m.filter((x) => x.isActive)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [form?.kind]);

  const start = (kind: DocKind) =>
    setForm({ id: null, kind, date: today, dentistSlug: dentists[0]?.slug ?? "", data: kind === "prescription" ? { items: [] } : {} });

  const set = (k: string, v: unknown) => setForm((f) => (f ? { ...f, data: { ...f.data, [k]: v } } : f));
  const rx = (form?.data.items as RxLine[] | undefined) ?? [];
  const setRx = (items: RxLine[]) => set("items", items);

  const save = async (andPrint: boolean) => {
    if (!form) return;
    await staffSaveDoc({ ...form, childId: file.childId, dentistSlug: form.dentistSlug || null });
    // new drug names typed in the prescription join the clinic's drug list
    if (form.kind === "prescription") {
      for (const line of rx) {
        if (line.name.trim() && !meds.some((m) => m.name === line.name.trim() && m.strength === line.strength)) {
          await staffSaveMedication({ name: line.name.trim(), strength: line.strength, unit: line.unit, sig: line.sig, isActive: true });
        }
      }
    }
    if (andPrint) onPrint({ kind: form.kind, date: form.date, dentistSlug: form.dentistSlug || null, data: form.data });
    setForm(null);
    showToast("บันทึกเอกสารแล้ว");
    await onChanged();
  };

  const field = (k: string, label: string, opts: { area?: boolean; placeholder?: string; type?: string } = {}) => (
    <div className="form-group">
      <label htmlFor={`doc-${k}`}>{label}</label>
      {opts.area ? (
        <textarea id={`doc-${k}`} className="form-control" rows={2} placeholder={opts.placeholder} value={String(form?.data[k] ?? "")} onChange={(e) => set(k, e.target.value)} />
      ) : (
        <input id={`doc-${k}`} type={opts.type ?? "text"} className="form-control" placeholder={opts.placeholder} value={String(form?.data[k] ?? "")} onChange={(e) => set(k, e.target.value)} />
      )}
    </div>
  );

  if (form) {
    return (
      <section className="pf-card wide doc-form">
        <h3>{DOC_LABEL[form.kind]}</h3>
        <div className="form-row-2">
          <div className="form-group">
            <label htmlFor="doc-date">วันที่</label>
            <DateField id="doc-date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
          </div>
          <div className="form-group">
            <label htmlFor="doc-dentist">ทันตแพทย์</label>
            <select id="doc-dentist" className="form-control" value={form.dentistSlug} onChange={(e) => setForm({ ...form, dentistSlug: e.target.value })}>
              {dentists.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.text.th.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {form.kind === "prescription" ? (
          <>
            {file.allergies ? <div className="pf-alert">แพ้ยา/อาหาร: {file.allergies}</div> : null}
            {rx.map((line, idx) => (
              <div key={idx} className="rx-row">
                <input
                  className="form-control"
                  list="rx-meds"
                  aria-label="ชื่อยา"
                  placeholder="ชื่อยา"
                  value={line.name}
                  onChange={(e) => {
                    const m = meds.find((x) => x.name === e.target.value);
                    setRx(rx.map((l, n) => (n === idx ? (m ? { ...l, name: m.name, strength: m.strength, unit: m.unit, sig: l.sig || m.sig } : { ...l, name: e.target.value }) : l)));
                  }}
                />
                <input className="form-control" aria-label="ความแรง" placeholder="ความแรง" value={line.strength} onChange={(e) => setRx(rx.map((l, n) => (n === idx ? { ...l, strength: e.target.value } : l)))} />
                <input className="form-control num" aria-label="จำนวน" placeholder="จำนวน" value={line.qty} onChange={(e) => setRx(rx.map((l, n) => (n === idx ? { ...l, qty: e.target.value } : l)))} />
                <input className="form-control" aria-label="หน่วย" placeholder="หน่วย" value={line.unit} onChange={(e) => setRx(rx.map((l, n) => (n === idx ? { ...l, unit: e.target.value } : l)))} />
                <input className="form-control rx-sig" aria-label="วิธีใช้" placeholder="วิธีใช้" value={line.sig} onChange={(e) => setRx(rx.map((l, n) => (n === idx ? { ...l, sig: e.target.value } : l)))} />
                <button type="button" className="btn-action-icon danger" aria-label="ลบยา" onClick={() => setRx(rx.filter((_, n) => n !== idx))}>
                  <IconX size={14} />
                </button>
              </div>
            ))}
            <datalist id="rx-meds">
              {meds.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.strength}
                </option>
              ))}
            </datalist>
            <div className="bl-tools">
              <button type="button" className="btn-secondary-staff" onClick={() => setRx([...rx, { name: "", strength: "", qty: "1", unit: "", sig: "" }])}>
                <IconPlus size={14} /> เพิ่มยา
              </button>
            </div>
            {field("note", "หมายเหตุ")}
          </>
        ) : null}
        {form.kind === "certificate" ? (
          <>
            {field("diagnosis", "ผลการตรวจ / การวินิจฉัย", { area: true })}
            {field("treatment", "การรักษา", { area: true })}
            <div className="form-row-2">
              {field("restDays", "ควรพัก (วัน)", { type: "number", placeholder: "0 = ไม่ต้องพัก" })}
              {field("license", "เลขที่ใบอนุญาตประกอบวิชาชีพ")}
            </div>
            <div className="form-row-2">
              {field("restFrom", "พักตั้งแต่", { type: "date" })}
              {field("restTo", "ถึง", { type: "date" })}
            </div>
            {field("opinion", "ความเห็นเพิ่มเติม", { area: true })}
          </>
        ) : null}
        {form.kind === "referral" ? (
          <>
            {field("to", "ส่งถึง (โรงพยาบาล / คลินิก / แพทย์)")}
            {field("reason", "เหตุผลที่ส่งต่อ", { area: true })}
            {field("findings", "ผลการตรวจ / การรักษาที่ทำแล้ว", { area: true })}
          </>
        ) : null}
        {form.kind === "pdpa" ? (
          <>
            <ol className="pdpa-text">
              {PDPA_TEXT.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
            {field("guardianName", "ชื่อผู้ให้ความยินยอม", { placeholder: file.guardian.fullName || file.guardian.name })}
            <div className="form-group">
              <label>ลายเซ็น</label>
              {typeof form.data.signature === "string" && form.data.signature ? (
                <div className="sig-saved">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.data.signature} alt="ลายเซ็น" />
                  <button type="button" className="btn-secondary-staff" onClick={() => set("signature", "")}>
                    เซ็นใหม่
                  </button>
                </div>
              ) : (
                <SignaturePad onChange={(png) => set("signature", png)} />
              )}
            </div>
          </>
        ) : null}
        {form.kind === "consent" ? (
          <>
            {field("procedure", "การรักษาที่จะทำ", { area: true, placeholder: "เช่น ถอนฟันน้ำนมซี่ 74 ภายใต้ยาชาเฉพาะที่" })}
            {field("risks", "ความเสี่ยง / ผลข้างเคียงที่แจ้งแล้ว", { area: true })}
            {field("alternatives", "ทางเลือกอื่น", { area: true })}
            {field("guardianName", "ชื่อผู้ยินยอม", { placeholder: file.guardian.fullName || file.guardian.name })}
            <div className="form-group">
              <label>ลายเซ็นผู้ยินยอม (เซ็นบนจอ หรือเว้นไว้เพื่อเซ็นบนกระดาษ)</label>
              {typeof form.data.signature === "string" && form.data.signature ? (
                <div className="sig-saved">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.data.signature} alt="ลายเซ็น" />
                  <button type="button" className="btn-secondary-staff" onClick={() => set("signature", "")}>
                    เซ็นใหม่
                  </button>
                </div>
              ) : (
                <SignaturePad onChange={(png) => set("signature", png)} />
              )}
            </div>
          </>
        ) : null}

        <div className="settings-save">
          <button type="button" className="btn-secondary-staff" onClick={() => setForm(null)}>
            ยกเลิก
          </button>
          <button type="button" className="btn-secondary-staff" onClick={() => void save(false)}>
            บันทึก
          </button>
          <button type="button" className="btn-primary-staff" onClick={() => void save(true)}>
            บันทึกและพิมพ์
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="docs">
      <div className="plans-top">
        {(Object.keys(DOC_LABEL) as DocKind[]).map((k) => (
          <button key={k} type="button" className="btn-secondary-staff" onClick={() => start(k)}>
            <IconPlus size={14} /> {DOC_LABEL[k]}
          </button>
        ))}
      </div>
      {file.docs.length === 0 ? <p className="cl-empty">ยังไม่มีเอกสาร</p> : null}
      <section className="pf-card wide">
        {file.docs.map((d) => (
          <div key={d.id} className="ph-row">
            <span className="ph-date">{d.date}</span>
            <span className="ph-body">
              <strong>{DOC_LABEL[d.kind]}</strong>
              <span className="muted">
                {d.kind === "prescription"
                  ? ((d.data.items as RxLine[] | undefined) ?? []).map((i) => i.name).join(", ")
                  : String(d.data.diagnosis ?? d.data.procedure ?? d.data.reason ?? "")}
              </span>
            </span>
            <span className="ph-side">
              <span className="muted">{dentistName(d.dentistSlug)}</span>
              <span className="plan-actions">
                <button type="button" className="btn-secondary-staff" onClick={() => onPrint(d)}>
                  พิมพ์
                </button>
                <button type="button" className="btn-secondary-staff" onClick={() => setForm({ id: d.id, kind: d.kind, date: d.date, dentistSlug: d.dentistSlug ?? "", data: d.data })}>
                  แก้ไข
                </button>
                <button
                  type="button"
                  className="btn-action-icon danger"
                  aria-label="ลบเอกสาร"
                  onClick={async () => {
                    if (!window.confirm("ลบเอกสารนี้?")) return;
                    await staffRemoveDoc(d.id);
                    await onChanged();
                  }}
                >
                  <IconX size={14} />
                </button>
              </span>
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

/* ── photos, X-rays, scans ─────────────────────────────────────────────── */

/** the PC's camera (webcam / intra-oral USB camera): look, snap, keep */
function CameraCapture({ onClose, onShot }: { onClose: () => void; onShot: (jpeg: string) => Promise<void> }) {
  const video = React.useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [count, setCount] = useState(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let live = true;
    navigator.mediaDevices
      ?.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : { width: 1600, height: 1200 } })
      .then(async (s) => {
        if (!live) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
        const all = await navigator.mediaDevices.enumerateDevices();
        if (live) setDevices(all.filter((d) => d.kind === "videoinput"));
      })
      .catch(() => live && setErr("เปิดกล้องไม่ได้ — ตรวจสอบว่าเสียบกล้องแล้วและอนุญาตให้แอปใช้กล้อง"));
    return () => {
      live = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  const snap = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    await onShot(c.toDataURL("image/jpeg", 0.86));
    setCount((n) => n + 1);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="camera-box" onClick={(e) => e.stopPropagation()}>
        {err ? <p className="ug-err">{err}</p> : <video ref={video} autoPlay playsInline muted />}
        <div className="file-view-bar">
          {devices.length > 1 ? (
            <select className="form-control" aria-label="กล้อง" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">กล้องเริ่มต้น</option>
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `กล้อง ${i + 1}`}
                </option>
              ))}
            </select>
          ) : (
            <span>{count ? `ถ่ายแล้ว ${count} รูป` : "ถ่ายได้หลายรูปติดกัน"}</span>
          )}
          <span className="plan-actions">
            <button type="button" className="btn-secondary-staff" onClick={onClose}>
              ปิด
            </button>
            <button type="button" className="btn-primary-staff" disabled={!!err} onClick={() => void snap()}>
              ถ่ายรูป
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** shrink a photo to at most 1600 px on its long side, as JPEG */
async function shrink(file: File): Promise<{ body: string; mime: string }> {
  const asDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  if (!file.type.startsWith("image/")) return { body: await asDataUrl(file), mime: file.type };
  const url = await asDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { body: canvas.toDataURL("image/jpeg", 0.86), mime: "image/jpeg" };
}

function FilesTab({ file, onChanged }: { file: PatientFileData; onChanged: () => Promise<void> }) {
  const { showToast } = useStaff();
  const [kind, setKind] = useState<FileMeta["kind"]>("photo");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<{ meta: FileMeta; src: string } | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [camera, setCamera] = useState(false);

  // fetch images for the grid, a few at a time
  useEffect(() => {
    let live = true;
    const want = file.files.filter((f) => f.mime.startsWith("image/") && !thumbs[f.id]).slice(0, 12);
    (async () => {
      for (const f of want) {
        const b = await staffFileBody(f.id).catch(() => null);
        if (!live || !b) continue;
        setThumbs((t) => ({ ...t, [f.id]: `data:${b.mime};base64,${b.body}` }));
      }
    })();
    return () => {
      live = false;
    };
  }, [file.files, thumbs]);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    for (const f of Array.from(list)) {
      try {
        const { body, mime } = await shrink(f);
        const r = await staffUploadFile({ childId: file.childId, kind, name: f.name, mime, body });
        if (!r.ok) showToast(r.error === "size" ? `${f.name} ใหญ่เกิน 3 MB` : `${f.name} ชนิดไฟล์ไม่รองรับ`);
      } catch {
        showToast(`อัปโหลด ${f.name} ไม่สำเร็จ`);
      }
    }
    setBusy(false);
    await onChanged();
  };

  const open = async (f: FileMeta) => {
    const b = thumbs[f.id] ? null : await staffFileBody(f.id);
    const src = thumbs[f.id] ?? (b ? `data:${b.mime};base64,${b.body}` : "");
    setView({ meta: f, src });
  };

  return (
    <div className="files">
      <div className="plans-top">
        <select className="form-control files-kind" aria-label="ชนิด" value={kind} onChange={(e) => setKind(e.target.value as FileMeta["kind"])}>
          <option value="photo">รูปถ่ายในช่องปาก</option>
          <option value="xray">ฟิล์ม X-ray</option>
          <option value="document">เอกสารสแกน (PDF/รูป)</option>
        </select>
        <button type="button" className="btn-secondary-staff" onClick={() => setCamera(true)}>
          ถ่ายรูปด้วยกล้อง
        </button>
        <label className={`btn-primary-staff ${busy ? "disabled" : ""}`}>
          <IconPlus size={14} /> {busy ? "กำลังอัปโหลด…" : "เพิ่มไฟล์"}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden disabled={busy} onChange={(e) => void upload(e.target.files)} />
        </label>
      </div>
      {file.files.length === 0 ? <p className="cl-empty">ยังไม่มีไฟล์</p> : null}
      <div className="file-grid">
        {file.files.map((f) => (
          <figure key={f.id} className="file-tile">
            <button type="button" className="file-thumb" onClick={() => void open(f)}>
              {thumbs[f.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbs[f.id]} alt={f.name} />
              ) : (
                <span>{f.mime === "application/pdf" ? "PDF" : "…"}</span>
              )}
            </button>
            <figcaption>
              <span>{f.kind === "xray" ? "X-ray" : f.kind === "document" ? "เอกสาร" : "รูปถ่าย"}</span>
              <span className="muted">{new Date(f.createdAt).toLocaleDateString("th-TH")}</span>
              <button
                type="button"
                className="btn-action-icon danger"
                aria-label="ลบไฟล์"
                onClick={async () => {
                  if (!window.confirm(`ลบไฟล์ ${f.name}?`)) return;
                  await staffRemoveFile(f.id);
                  await onChanged();
                }}
              >
                <IconX size={13} />
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
      {camera ? (
        <CameraCapture
          onClose={() => setCamera(false)}
          onShot={async (dataUrl) => {
            const r = await staffUploadFile({ childId: file.childId, kind, name: `กล้อง ${new Date().toLocaleString("th-TH")}`, mime: "image/jpeg", body: dataUrl });
            showToast(r.ok ? "บันทึกรูปแล้ว" : "บันทึกรูปไม่สำเร็จ");
            await onChanged();
          }}
        />
      ) : null}
      {view ? (
        <div className="modal-overlay" onClick={() => setView(null)}>
          <div className="file-view" onClick={(e) => e.stopPropagation()}>
            {view.meta.mime === "application/pdf" ? (
              <iframe src={view.src} title={view.meta.name} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.src} alt={view.meta.name} />
            )}
            <div className="file-view-bar">
              <span>{view.meta.name}</span>
              <button type="button" className="btn-secondary-staff" onClick={() => setView(null)}>
                ปิด
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A button that opens a patient's file full-screen — by file id, or by the
 * phone + name of a booking (a file is made on the spot if there is none).
 */
export function PatientFileButton({
  childId,
  phone,
  name,
  label = "แฟ้มคนไข้",
  className = "btn-secondary-staff",
  children,
}: {
  childId?: number | null;
  phone?: string;
  name?: string;
  label?: string;
  className?: string;
  /** richer content for the button (e.g. a whole patient row) */
  children?: React.ReactNode;
}) {
  const { edition, showToast } = useStaff();
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (edition !== "full") return null;

  const go = async () => {
    if (childId) return setOpen(childId);
    if (!phone || !name) return showToast("ต้องมีชื่อและเบอร์โทรเพื่อเปิดแฟ้ม");
    setBusy(true);
    const { staffEnsurePatient } = await import("@/server/actions");
    const id = await staffEnsurePatient({ phone, name }).catch(() => null);
    setBusy(false);
    if (id) setOpen(id);
    else showToast("เปิดแฟ้มไม่สำเร็จ — ตรวจสอบเบอร์โทร");
  };

  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={() => void go()}>
        {children ?? (busy ? "กำลังเปิด…" : label)}
      </button>
      {open
        ? createPortal(
            // on <body>, so a dialog's transform or overflow can't clip it
            <div className="pf-overlay" role="dialog" aria-label="แฟ้มคนไข้" onClick={(e) => e.stopPropagation()}>
              <PatientFileView childId={open} onBack={() => setOpen(null)} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
