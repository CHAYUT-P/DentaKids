"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  staffAddMove,
  staffConsumables,
  staffLabOrders,
  staffMoves,
  staffRemoveLabOrder,
  staffSaveLabOrder,
  staffSaveStockItem,
  staffSaveSupplier,
  staffSetConsumables,
  staffStock,
  staffSuppliers,
} from "@/server/actions";
import {
  LAB_STATUS_LABEL,
  MOVE_LABEL,
  STOCK_CATEGORIES,
  type Consumable,
  type LabOrder,
  type LabStatus,
  type MoveKind,
  type StockItem,
  type StockMove,
  type Supplier,
} from "@/lib/stock";
import { baht } from "@/lib/billing";
import { useStaff } from "@/lib/staffStore";
import { useTreatments } from "@/lib/treatmentsContext";
import { useStaffUser, NoAccess } from "@/lib/staffUser";
import { EditionNotice } from "@/components/staff/shell/DeviceGate";
import { IconAlertTriangle, IconPlus, IconSearch, IconX } from "@/components/staff/shell/staffIcons";
import { DateField } from "@/components/staff/shell/DateField";

type Tab = "items" | "moves" | "consumables" | "labs" | "suppliers";

/**
 * คลัง & แลป (full edition) — what is on the shelf and what runs low or
 * expires, every movement in and out, what each treatment uses (taken out
 * automatically when its bill is paid), lab work in progress, and the
 * suppliers and labs the clinic deals with.
 */
export function StockView() {
  const { edition, showToast } = useStaff();
  const allowed = useStaffUser().can("stock");
  const [tab, setTab] = useState<Tab>("items");
  const [items, setItems] = useState<StockItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const loadBase = useCallback(async () => {
    const [i, s] = await Promise.all([staffStock(), staffSuppliers()]);
    setItems(i);
    setSuppliers(s);
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([staffStock(), staffSuppliers()])
      .then(([i, s]) => {
        if (!live) return;
        setItems(i);
        setSuppliers(s);
      })
      .catch(() => showToast("โหลดข้อมูลคลังไม่สำเร็จ"));
    return () => {
      live = false;
    };
  }, [showToast]);

  if (edition !== "full") return <EditionNotice feature="คลังสินค้า" />;
  if (!allowed) return <NoAccess what="คลังสินค้า" />;

  const low = items.filter((i) => i.low).length;
  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "items", label: "คงคลัง", badge: low || undefined },
    { key: "moves", label: "รับเข้า / เบิก / ประวัติ" },
    { key: "consumables", label: "วัสดุต่อหัตถการ" },
    { key: "labs", label: "งานแลป" },
    { key: "suppliers", label: "ผู้จำหน่าย & แลป" },
  ];

  return (
    <div className="staff-container stock">
      <div className="staff-page-header">
        <div>
          <h2>คลัง &amp; แลป</h2>
          <p>วัสดุ ยา สินค้า — ตัดสต็อกอัตโนมัติเมื่อบิลชำระครบ · งานที่ส่งแลป</p>
        </div>
      </div>
      <nav className="pf-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}
            {t.badge ? <em className="warn">{t.badge}</em> : null}
          </button>
        ))}
      </nav>
      {tab === "items" ? <ItemsTab items={items} suppliers={suppliers} onChanged={loadBase} /> : null}
      {tab === "moves" ? <MovesTab items={items} onChanged={loadBase} /> : null}
      {tab === "consumables" ? <ConsumablesTab items={items} /> : null}
      {tab === "labs" ? <LabsTab suppliers={suppliers} /> : null}
      {tab === "suppliers" ? <SuppliersTab suppliers={suppliers} onChanged={loadBase} /> : null}
    </div>
  );
}

/* ── items ─────────────────────────────────────────────────────────────── */

const blankItem = (): Partial<StockItem> & { name: string } => ({
  name: "",
  category: "material",
  unit: "ชิ้น",
  cost: 0,
  price: 0,
  minQty: 0,
  sellable: false,
  supplierId: null,
  note: "",
  isActive: true,
});

function ItemsTab({ items, suppliers, onChanged }: { items: StockItem[]; suppliers: Supplier[]; onChanged: () => Promise<void> }) {
  const { today, showToast } = useStaff();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "low" | "expiring">("all");
  const [edit, setEdit] = useState<(Partial<StockItem> & { name: string }) | null>(null);
  const soon = (d: string | null) => !!d && d <= new Date(Date.parse(today) + 60 * 864e5).toISOString().slice(0, 10);

  const shown = items.filter((i) => {
    if (only === "low" && !i.low) return false;
    if (only === "expiring" && !soon(i.nextExpiry)) return false;
    return !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase());
  });
  const value = items.reduce((s, i) => s + Math.max(0, i.qty) * i.cost, 0);

  const save = async () => {
    if (!edit?.name.trim()) return;
    await staffSaveStockItem(edit);
    setEdit(null);
    showToast("บันทึกรายการแล้ว");
    await onChanged();
  };

  return (
    <>
      <div className="staff-toolbar">
        <div className="staff-search-box" style={{ width: 280 }}>
          <IconSearch size={15} color="var(--staff-ink-muted)" />
          <input type="search" aria-label="ค้นหา" placeholder="ค้นหาชื่อวัสดุ/ยา/สินค้า…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="staff-pill-group">
          {(
            [
              ["all", "ทั้งหมด"],
              ["low", "ใกล้หมด"],
              ["expiring", "หมดอายุใน 60 วัน"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" className={`staff-pill-btn ${only === k ? "active" : ""}`} onClick={() => setOnly(k)}>
              {l}
            </button>
          ))}
        </div>
        <span className="muted" style={{ marginLeft: "auto" }}>
          มูลค่าคงคลัง {baht(value)}
        </span>
        <button type="button" className="btn-primary-staff" onClick={() => setEdit(blankItem())}>
          <IconPlus size={14} /> เพิ่มรายการ
        </button>
      </div>

      {edit ? (
        <section className="pf-card wide stock-edit">
          <h3>{edit.id ? "แก้ไขรายการ" : "รายการใหม่"}</h3>
          <div className="stock-form">
            <label>
              ชื่อ
              <input className="form-control" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </label>
            <label>
              ประเภท
              <select className="form-control" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as StockItem["category"] })}>
                {STOCK_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              หน่วย
              <input className="form-control" value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} />
            </label>
            <label>
              ต้นทุน/หน่วย
              <input className="form-control num" inputMode="numeric" value={edit.cost || ""} onChange={(e) => setEdit({ ...edit, cost: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            </label>
            <label>
              ราคาขาย/หน่วย
              <input className="form-control num" inputMode="numeric" value={edit.price || ""} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            </label>
            <label>
              เตือนเมื่อเหลือ
              <input className="form-control num" inputMode="numeric" value={edit.minQty || ""} onChange={(e) => setEdit({ ...edit, minQty: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            </label>
            <label>
              ผู้จำหน่าย
              <select className="form-control" value={edit.supplierId ?? ""} onChange={(e) => setEdit({ ...edit, supplierId: Number(e.target.value) || null })}>
                <option value="">—</option>
                {suppliers
                  .filter((s) => s.kind === "supplier")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={!!edit.sellable} onChange={(e) => setEdit({ ...edit, sellable: e.target.checked })} />
              ขายให้คนไข้ได้ (แสดงในหน้าการเงิน)
            </label>
            <label className="check">
              <input type="checkbox" checked={edit.isActive !== false} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
              ใช้งานอยู่
            </label>
          </div>
          <div className="settings-save">
            <button type="button" className="btn-secondary-staff" onClick={() => setEdit(null)}>
              ยกเลิก
            </button>
            <button type="button" className="btn-primary-staff" disabled={!edit.name.trim()} onClick={() => void save()}>
              บันทึก
            </button>
          </div>
        </section>
      ) : null}

      <div className="ledger-table">
        <div className="stock-row ledger-head">
          <span>รายการ</span>
          <span>ประเภท</span>
          <span className="num">คงเหลือ</span>
          <span className="num">ต้นทุน</span>
          <span className="num">ราคาขาย</span>
          <span>หมดอายุใกล้สุด</span>
          <span />
        </div>
        {shown.length === 0 ? <p className="cl-empty" style={{ padding: "12px 18px" }}>ยังไม่มีรายการ — กด “เพิ่มรายการ”</p> : null}
        {shown.map((i) => (
          <div key={i.id} className={`stock-row ${i.isActive ? "" : "inactive"}`}>
            <span>
              <strong>{i.name}</strong>
              {i.sellable ? <span className="svc-badge">ขาย</span> : null}
            </span>
            <span className="muted">{STOCK_CATEGORIES.find((c) => c.key === i.category)?.label}</span>
            <span className={`num ${i.low ? "owe" : ""}`}>
              {i.low ? <IconAlertTriangle size={13} /> : null} {i.qty.toLocaleString()} {i.unit}
            </span>
            <span className="num">{baht(i.cost)}</span>
            <span className="num">{i.price ? baht(i.price) : "—"}</span>
            <span className={soon(i.nextExpiry) ? "owe" : "muted"}>{i.nextExpiry ?? "—"}</span>
            <button type="button" className="btn-secondary-staff" onClick={() => setEdit({ ...i })}>
              แก้ไข
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── moves ─────────────────────────────────────────────────────────────── */

function MovesTab({ items, onChanged }: { items: StockItem[]; onChanged: () => Promise<void> }) {
  const { today, showToast } = useStaff();
  const [moves, setMoves] = useState<StockMove[] | null>(null);
  const [f, setF] = useState<{ itemId: string; kind: MoveKind; qty: string; unitCost: string; lot: string; expiry: string; note: string }>({
    itemId: "",
    kind: "receive",
    qty: "",
    unitCost: "",
    lot: "",
    expiry: "",
    note: "",
  });

  const fetchMoves = useCallback(() => staffMoves({ from: new Date(Date.parse(today) - 90 * 864e5).toISOString().slice(0, 10) }), [today]);

  useEffect(() => {
    let live = true;
    fetchMoves()
      .then((m) => live && setMoves(m))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [fetchMoves]);

  const add = async () => {
    const itemId = Number(f.itemId);
    const qty = Number(f.qty);
    if (!itemId || !qty) return;
    await staffAddMove({ itemId, kind: f.kind, qty, unitCost: Number(f.unitCost) || 0, lot: f.lot, expiry: f.expiry || null, note: f.note });
    setF({ ...f, qty: "", unitCost: "", lot: "", expiry: "", note: "" });
    showToast("บันทึกแล้ว");
    setMoves(await fetchMoves());
    await onChanged();
  };

  return (
    <>
      <section className="pf-card wide">
        <h3>บันทึกรับเข้า / เบิกออก / ปรับยอด</h3>
        <div className="move-form">
          <select className="form-control" aria-label="รายการ" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
            <option value="">— เลือกรายการ —</option>
            {items
              .filter((i) => i.isActive)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} (เหลือ {i.qty} {i.unit})
                </option>
              ))}
          </select>
          <select className="form-control" aria-label="ประเภท" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as MoveKind })}>
            {(Object.keys(MOVE_LABEL) as MoveKind[]).map((k) => (
              <option key={k} value={k}>
                {MOVE_LABEL[k]}
              </option>
            ))}
          </select>
          <input className="form-control num" inputMode="numeric" aria-label="จำนวน" placeholder={f.kind === "adjust" ? "+/− จำนวน" : "จำนวน"} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/[^\d-]/g, "") })} />
          {f.kind === "receive" ? (
            <>
              <input className="form-control num" inputMode="numeric" aria-label="ต้นทุนต่อหน่วย" placeholder="ต้นทุน/หน่วย" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value.replace(/\D/g, "") })} />
              <input className="form-control" aria-label="ล็อต" placeholder="ล็อต" value={f.lot} onChange={(e) => setF({ ...f, lot: e.target.value })} />
              <DateField ariaLabel="วันหมดอายุ" placeholder="วันหมดอายุ" clearable value={f.expiry} onChange={(v) => setF({ ...f, expiry: v })} />
            </>
          ) : null}
          <input className="form-control" aria-label="หมายเหตุ" placeholder="หมายเหตุ" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <button type="button" className="btn-primary-staff" disabled={!f.itemId || !Number(f.qty)} onClick={() => void add()}>
            บันทึก
          </button>
        </div>
      </section>

      <div className="ledger-table">
        <div className="move-row ledger-head">
          <span>วันที่</span>
          <span>รายการ</span>
          <span>ประเภท</span>
          <span className="num">จำนวน</span>
          <span>รายละเอียด</span>
        </div>
        {moves === null ? <p className="cl-empty" style={{ padding: "12px 18px" }}>กำลังโหลด…</p> : null}
        {moves?.length === 0 ? <p className="cl-empty" style={{ padding: "12px 18px" }}>ยังไม่มีความเคลื่อนไหวใน 90 วัน</p> : null}
        {moves?.map((m) => (
          <div key={m.id} className="move-row">
            <span className="muted">{m.date}</span>
            <span>{m.itemName}</span>
            <span>{MOVE_LABEL[m.kind]}</span>
            <span className={`num ${m.change < 0 ? "owe" : "ok"}`}>
              {m.change > 0 ? "+" : ""}
              {m.change} {m.unit}
            </span>
            <span className="muted">
              {[m.note, m.lot ? `ล็อต ${m.lot}` : "", m.expiry ? `หมดอายุ ${m.expiry}` : "", m.unitCost ? `${baht(m.unitCost)}/หน่วย` : ""]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── consumables per treatment ─────────────────────────────────────────── */

function ConsumablesTab({ items }: { items: StockItem[] }) {
  const { showToast } = useStaff();
  const tr = useTreatments();
  const catalog = useMemo(() => tr.list.filter((t) => t.key !== "more"), [tr.list]);
  const [rows, setRows] = useState<Consumable[]>([]);
  const [key, setKey] = useState<string>("");
  const [draft, setDraft] = useState<{ itemId: number; qty: number }[]>([]);

  useEffect(() => {
    let live = true;
    staffConsumables()
      .then((r) => live && setRows(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const pick = (k: string) => {
    setKey(k);
    setDraft(rows.filter((r) => r.treatmentKey === k).map((r) => ({ itemId: r.itemId, qty: r.qty })));
  };

  const save = async () => {
    await staffSetConsumables(key, draft);
    setRows(await staffConsumables());
    showToast("บันทึกวัสดุที่ใช้แล้ว");
  };

  const usable = items.filter((i) => i.isActive && i.category !== "product");
  return (
    <div className="cons">
      <aside className="cons-list">
        {catalog.map((t) => {
          const n = rows.filter((r) => r.treatmentKey === t.key).length;
          return (
            <button key={t.key} type="button" className={`cl-row ${key === t.key ? "active" : ""}`} onClick={() => pick(t.key)}>
              <span className="cl-name">{t.name.th}</span>
              <span className="cl-sub">{n ? `ใช้ ${n} รายการ` : "ยังไม่กำหนด"}</span>
            </button>
          );
        })}
      </aside>
      <section className="pf-card wide">
        {key ? (
          <>
            <h3>{tr.name(key)} — ใช้วัสดุอะไรบ้างต่อครั้ง</h3>
            <p className="settings-help">เมื่อบิลที่มีหัตถการนี้ชำระครบ ระบบจะตัดวัสดุเหล่านี้ออกจากคลังให้อัตโนมัติ (คูณตามจำนวน)</p>
            {draft.map((d, idx) => (
              <div key={idx} className="cons-row">
                <select className="form-control" aria-label="วัสดุ" value={d.itemId || ""} onChange={(e) => setDraft(draft.map((x, n) => (n === idx ? { ...x, itemId: Number(e.target.value) } : x)))}>
                  <option value="">— เลือก —</option>
                  {usable.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
                <input className="form-control num" inputMode="numeric" aria-label="จำนวน" value={d.qty} onChange={(e) => setDraft(draft.map((x, n) => (n === idx ? { ...x, qty: Number(e.target.value.replace(/\D/g, "")) || 1 } : x)))} />
                <span className="muted">{items.find((i) => i.id === d.itemId)?.unit ?? ""}</span>
                <button type="button" className="btn-action-icon danger" aria-label="ลบ" onClick={() => setDraft(draft.filter((_, n) => n !== idx))}>
                  <IconX size={14} />
                </button>
              </div>
            ))}
            <div className="bl-tools">
              <button type="button" className="btn-secondary-staff" onClick={() => setDraft([...draft, { itemId: 0, qty: 1 }])}>
                <IconPlus size={14} /> เพิ่มวัสดุ
              </button>
              <button type="button" className="btn-primary-staff" style={{ marginLeft: "auto" }} onClick={() => void save()}>
                บันทึก
              </button>
            </div>
          </>
        ) : (
          <p className="cl-empty">เลือกหัตถการทางซ้าย</p>
        )}
      </section>
    </div>
  );
}

/* ── lab orders ────────────────────────────────────────────────────────── */

function LabsTab({ suppliers }: { suppliers: Supplier[] }) {
  const { today, dentists, patients, showToast } = useStaff();
  const [rows, setRows] = useState<LabOrder[] | null>(null);
  const [open, setOpen] = useState(true);
  const [edit, setEdit] = useState<(Partial<LabOrder> & { patientName: string; work: string }) | null>(null);
  const labs = suppliers.filter((s) => s.kind === "lab");

  const fetchRows = useCallback(() => staffLabOrders({ open }), [open]);
  useEffect(() => {
    let live = true;
    fetchRows()
      .then((r) => live && setRows(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [fetchRows]);

  const kids = useMemo(
    () => patients.flatMap((p) => p.children.map((c) => ({ id: Number(c.id), label: `${c.name}${c.hn ? ` (${c.hn})` : ""} · ${p.phone}`, name: c.name }))),
    [patients],
  );

  const save = async (o: Partial<LabOrder> & { patientName: string; work: string }) => {
    await staffSaveLabOrder(o);
    setEdit(null);
    showToast("บันทึกงานแลปแล้ว");
    setRows(await fetchRows());
  };

  return (
    <>
      <div className="staff-toolbar">
        <div className="staff-pill-group">
          <button type="button" className={`staff-pill-btn ${open ? "active" : ""}`} onClick={() => setOpen(true)}>
            กำลังดำเนินการ
          </button>
          <button type="button" className={`staff-pill-btn ${!open ? "active" : ""}`} onClick={() => setOpen(false)}>
            ทั้งหมด
          </button>
        </div>
        <button
          type="button"
          className="btn-primary-staff"
          style={{ marginLeft: "auto" }}
          onClick={() => setEdit({ patientName: "", work: "", sentDate: today, status: "sent", labId: labs[0]?.id ?? null, dentistSlug: dentists[0]?.slug ?? null })}
        >
          <IconPlus size={14} /> ส่งงานแลป
        </button>
      </div>

      {edit ? (
        <section className="pf-card wide stock-edit">
          <h3>{edit.id ? "แก้ไขงานแลป" : "ส่งงานแลปใหม่"}</h3>
          <div className="stock-form">
            <label>
              คนไข้
              <input
                className="form-control"
                list="lab-kids"
                value={edit.patientName}
                onChange={(e) => {
                  const k = kids.find((x) => x.label === e.target.value);
                  setEdit({ ...edit, patientName: k ? k.name : e.target.value, childId: k ? k.id : edit.childId ?? null });
                }}
              />
              <datalist id="lab-kids">
                {kids.map((k) => (
                  <option key={k.id} value={k.label} />
                ))}
              </datalist>
            </label>
            <label>
              แลป
              <select className="form-control" value={edit.labId ?? ""} onChange={(e) => setEdit({ ...edit, labId: Number(e.target.value) || null })}>
                <option value="">—</option>
                {labs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              งาน
              <input className="form-control" placeholder="เช่น Space maintainer, ครอบฟัน, รีเทนเนอร์" value={edit.work} onChange={(e) => setEdit({ ...edit, work: e.target.value })} />
            </label>
            <label>
              ซี่ฟัน
              <input className="form-control" value={edit.teeth ?? ""} onChange={(e) => setEdit({ ...edit, teeth: e.target.value })} />
            </label>
            <label>
              สีฟัน (shade)
              <input className="form-control" value={edit.shade ?? ""} onChange={(e) => setEdit({ ...edit, shade: e.target.value })} />
            </label>
            <label>
              ทันตแพทย์
              <select className="form-control" value={edit.dentistSlug ?? ""} onChange={(e) => setEdit({ ...edit, dentistSlug: e.target.value || null })}>
                <option value="">—</option>
                {dentists.map((d) => (
                  <option key={d.slug} value={d.slug}>
                    {d.text.th.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              วันที่ส่ง
              <DateField value={edit.sentDate ?? today} onChange={(v) => setEdit({ ...edit, sentDate: v })} />
            </label>
            <label>
              นัดรับงาน
              <DateField clearable value={edit.dueDate ?? ""} onChange={(v) => setEdit({ ...edit, dueDate: v || null })} />
            </label>
            <label>
              ค่าแลป (บาท)
              <input className="form-control num" inputMode="numeric" value={edit.cost || ""} onChange={(e) => setEdit({ ...edit, cost: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            </label>
            <label>
              สถานะ
              <select className="form-control" value={edit.status ?? "sent"} onChange={(e) => setEdit({ ...edit, status: e.target.value as LabStatus })}>
                {(Object.keys(LAB_STATUS_LABEL) as LabStatus[]).map((k) => (
                  <option key={k} value={k}>
                    {LAB_STATUS_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="settings-save">
            {edit.id ? (
              <button
                type="button"
                className="btn-secondary-staff danger-soft"
                style={{ marginRight: "auto" }}
                onClick={async () => {
                  if (!window.confirm("ลบงานแลปนี้?")) return;
                  await staffRemoveLabOrder(edit.id!);
                  setEdit(null);
                  setRows(await fetchRows());
                }}
              >
                ลบ
              </button>
            ) : null}
            <button type="button" className="btn-secondary-staff" onClick={() => setEdit(null)}>
              ยกเลิก
            </button>
            <button type="button" className="btn-primary-staff" disabled={!edit.patientName.trim() || !edit.work.trim()} onClick={() => void save(edit)}>
              บันทึก
            </button>
          </div>
        </section>
      ) : null}

      <div className="ledger-table">
        <div className="lab-row ledger-head">
          <span>คนไข้ / งาน</span>
          <span>แลป</span>
          <span>ส่ง</span>
          <span>นัดรับ</span>
          <span className="num">ค่าแลป</span>
          <span>สถานะ</span>
          <span />
        </div>
        {rows?.length === 0 ? <p className="cl-empty" style={{ padding: "12px 18px" }}>ไม่มีงานแลป</p> : null}
        {rows?.map((o) => {
          const late = o.status === "sent" && o.dueDate && o.dueDate < today;
          return (
            <div key={o.id} className="lab-row">
              <span>
                <strong>{o.patientName}</strong>
                <span className="muted">
                  {" "}
                  · {o.work}
                  {o.teeth ? ` ซี่ ${o.teeth}` : ""}
                  {o.shade ? ` · ${o.shade}` : ""}
                </span>
              </span>
              <span>{suppliers.find((s) => s.id === o.labId)?.name ?? "—"}</span>
              <span className="muted">{o.sentDate}</span>
              <span className={late ? "owe" : "muted"}>{o.dueDate ?? "—"}</span>
              <span className="num">{o.cost ? baht(o.cost) : "—"}</span>
              <select
                className="form-control lab-status"
                aria-label="สถานะ"
                value={o.status}
                onChange={(e) => void save({ ...o, status: e.target.value as LabStatus, receivedDate: e.target.value === "received" ? today : o.receivedDate })}
              >
                {(Object.keys(LAB_STATUS_LABEL) as LabStatus[]).map((k) => (
                  <option key={k} value={k}>
                    {LAB_STATUS_LABEL[k]}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-secondary-staff" onClick={() => setEdit({ ...o })}>
                แก้ไข
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── suppliers & labs ──────────────────────────────────────────────────── */

function SuppliersTab({ suppliers, onChanged }: { suppliers: Supplier[]; onChanged: () => Promise<void> }) {
  const { showToast } = useStaff();
  const [edit, setEdit] = useState<(Partial<Supplier> & { name: string }) | null>(null);

  const save = async () => {
    if (!edit?.name.trim()) return;
    await staffSaveSupplier(edit);
    setEdit(null);
    showToast("บันทึกแล้ว");
    await onChanged();
  };

  return (
    <>
      <div className="staff-toolbar">
        <button type="button" className="btn-primary-staff" style={{ marginLeft: "auto" }} onClick={() => setEdit({ name: "", kind: "supplier", isActive: true })}>
          <IconPlus size={14} /> เพิ่มผู้จำหน่าย / แลป
        </button>
      </div>
      {edit ? (
        <section className="pf-card wide stock-edit">
          <div className="stock-form">
            <label>
              ชื่อ
              <input className="form-control" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </label>
            <label>
              ประเภท
              <select className="form-control" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Supplier["kind"] })}>
                <option value="supplier">ผู้จำหน่าย</option>
                <option value="lab">แลปทันตกรรม</option>
              </select>
            </label>
            <label>
              เบอร์โทร
              <input className="form-control" value={edit.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            </label>
            <label>
              ผู้ติดต่อ
              <input className="form-control" value={edit.contact ?? ""} onChange={(e) => setEdit({ ...edit, contact: e.target.value })} />
            </label>
            <label>
              หมายเหตุ
              <input className="form-control" value={edit.note ?? ""} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={edit.isActive !== false} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
              ใช้งานอยู่
            </label>
          </div>
          <div className="settings-save">
            <button type="button" className="btn-secondary-staff" onClick={() => setEdit(null)}>
              ยกเลิก
            </button>
            <button type="button" className="btn-primary-staff" onClick={() => void save()}>
              บันทึก
            </button>
          </div>
        </section>
      ) : null}
      <div className="ledger-table">
        {suppliers.length === 0 ? <p className="cl-empty" style={{ padding: "12px 18px" }}>ยังไม่มี</p> : null}
        {suppliers.map((s) => (
          <div key={s.id} className={`sup-row ${s.isActive ? "" : "inactive"}`}>
            <strong>{s.name}</strong>
            <span className="muted">{s.kind === "lab" ? "แลปทันตกรรม" : "ผู้จำหน่าย"}</span>
            <span>{s.phone}</span>
            <span className="muted">{s.contact}</span>
            <button type="button" className="btn-secondary-staff" onClick={() => setEdit({ ...s })}>
              แก้ไข
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
