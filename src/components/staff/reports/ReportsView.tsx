"use client";

import React, { useEffect, useState } from "react";

import { staffBillingSettings, staffDfStatement, staffReport } from "@/server/actions";
import type { DfStatement, ReportData } from "@/server/reports";
import { DEFAULT_BILLING_SETTINGS, baht, payMethodLabel, type BillingSettings } from "@/lib/billing";
import { addDays, fmtLong } from "@/lib/dates";
import { useStaff } from "@/lib/staffStore";
import { useT } from "@/i18n/lang";
import { useStaffUser, NoAccess } from "@/lib/staffUser";
import { EditionNotice } from "@/components/staff/shell/DeviceGate";
import { DateField } from "@/components/staff/shell/DateField";

type Preset = "today" | "month" | "lastMonth" | "year" | "custom";

function rangeFor(p: Preset, today: string): [string, string] {
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (p === "today") return [today, today];
  if (p === "month") return [`${y}-${pad(m)}-01`, today];
  if (p === "lastMonth") {
    const ly = m === 1 ? y - 1 : y;
    const lm = m === 1 ? 12 : m - 1;
    return [`${ly}-${pad(lm)}-01`, addDays(`${y}-${pad(m)}-01`, -1)];
  }
  return [`${y}-01-01`, today];
}

/**
 * รายงาน (full edition) — the owner's view: money in and out, what sold,
 * each dentist's work and DF (with a printable statement), appointment
 * outcomes, who still owes, and cancelled receipts.
 */
export function ReportsView() {
  const { edition, today, dentists, showToast } = useStaff();
  const allowed = useStaffUser().can("reports");
  const dict = useT();
  const [preset, setPreset] = useState<Preset>("month");
  const [[from, to], setRange] = useState<[string, string]>(() => rangeFor("month", today));
  const [data, setData] = useState<ReportData | null>(null);
  const [statement, setStatement] = useState<DfStatement | null>(null);
  const [settings, setSettings] = useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);

  useEffect(() => {
    let live = true;
    staffReport(from, to)
      .then((r) => live && setData(r))
      .catch(() => showToast("โหลดรายงานไม่สำเร็จ"));
    return () => {
      live = false;
    };
  }, [from, to, showToast]);

  useEffect(() => {
    staffBillingSettings()
      .then((r) => setSettings(r.settings))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!statement) return;
    const t = setTimeout(() => {
      window.print();
      setStatement(null);
    }, 120);
    return () => clearTimeout(t);
  }, [statement]);

  if (edition !== "full") return <EditionNotice feature="รายงาน" />;
  if (!allowed) return <NoAccess what="รายงาน" />;

  const name = (slug: string | null) => (slug ? (dentists.find((d) => d.slug === slug)?.text.th.name ?? slug) : "ไม่ระบุแพทย์");
  const pick = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") setRange(rangeFor(p, today));
  };
  const maxDay = Math.max(1, ...(data?.byDay.map((d) => d.amount) ?? [1]));
  const a = data?.appointments;
  const profit = data ? data.received - data.expenses - data.df : 0;

  return (
    <div className="staff-container reports">
      <div className="staff-page-header">
        <div>
          <h2>รายงาน</h2>
          <p>
            {fmtLong(dict, from, "th")} – {fmtLong(dict, to, "th")}
          </p>
        </div>
        <div className="cashier-head-actions">
          <div className="staff-pill-group">
            {(
              [
                ["today", "วันนี้"],
                ["month", "เดือนนี้"],
                ["lastMonth", "เดือนก่อน"],
                ["year", "ปีนี้"],
                ["custom", "กำหนดเอง"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" className={`staff-pill-btn ${preset === k ? "active" : ""}`} onClick={() => pick(k)}>
                {l}
              </button>
            ))}
          </div>
          {preset === "custom" ? (
            <span className="report-range">
              <DateField ariaLabel="ตั้งแต่" value={from} onChange={(v) => setRange([v, to])} max={to || undefined} />
              <DateField ariaLabel="ถึง" value={to} onChange={(v) => setRange([from, v])} min={from || undefined} />
            </span>
          ) : null}
        </div>
      </div>

      {!data ? (
        <div className="staff-empty">กำลังคำนวณ…</div>
      ) : (
        <>
          <div className="close-cards">
            <div className="close-card main">
              <span>รับเงิน</span>
              <strong>{baht(data.received)}</strong>
              <em>{data.bills} บิล · {data.patients} คน</em>
            </div>
            <div className="close-card">
              <span>ค่าใช้จ่าย</span>
              <strong>{baht(data.expenses)}</strong>
            </div>
            <div className="close-card">
              <span>DF แพทย์</span>
              <strong>{baht(data.df)}</strong>
            </div>
            <div className={`close-card ${profit < 0 ? "warn" : ""}`}>
              <span>กำไรโดยประมาณ</span>
              <strong>{baht(profit)}</strong>
              <em>รับเงิน − ค่าใช้จ่าย − DF</em>
            </div>
            {data.claimed > 0 ? (
              <div className="close-card">
                <span>รอเบิกจากสิทธิ์</span>
                <strong>{baht(data.claimed)}</strong>
                <em>ประกันสังคม / บัตรทอง / ประกัน</em>
              </div>
            ) : null}
            <div className={`close-card ${data.owing.length ? "warn" : ""}`}>
              <span>ค้างชำระ (ทุกวัน)</span>
              <strong>{baht(data.owing.reduce((s, o) => s + o.balance, 0))}</strong>
              <em>{data.owing.length} บิล</em>
            </div>
          </div>

          {data.byDay.length > 1 ? (
            <section className="pf-card wide">
              <h3>รับเงินรายวัน</h3>
              <div className="day-bars" role="img" aria-label="กราฟรับเงินรายวัน">
                {data.byDay.map((d) => (
                  <div key={d.date} className="day-bar" title={`${d.date} · ${baht(d.amount)}`}>
                    <i style={{ height: `${Math.max(3, (d.amount / maxDay) * 100)}%` }} />
                    <span>{Number(d.date.slice(8))}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="close-cols">
            <section className="ledger-table close-table">
              <h3>รายได้ตามหัตถการ / สินค้า</h3>
              {data.treatments.length === 0 ? <p className="cl-empty">ยังไม่มี</p> : null}
              {data.treatments.slice(0, 20).map((t) => (
                <div key={t.key ?? t.name} className="ct-row">
                  <span>{t.name}</span>
                  <span className="muted">{t.count} ครั้ง</span>
                  <strong className="num">{baht(t.revenue)}</strong>
                </div>
              ))}
            </section>
            <section className="ledger-table close-table">
              <h3>ตามทันตแพทย์ · DF</h3>
              {data.dentists.map((d) => (
                <div key={d.slug ?? "-"} className="ct-row">
                  <span>
                    {name(d.slug)}
                    <span className="muted"> · {d.visits} บิล · ยอด {baht(d.revenue)}</span>
                  </span>
                  {d.slug ? (
                    <button
                      type="button"
                      className="btn-secondary-staff report-mini"
                      onClick={async () => setStatement(await staffDfStatement(d.slug!, from, to))}
                    >
                      พิมพ์ใบสรุป DF
                    </button>
                  ) : (
                    <span />
                  )}
                  <strong className="num">{baht(d.df)}</strong>
                </div>
              ))}
            </section>
          </div>

          <div className="close-cols">
            <section className="ledger-table close-table">
              <h3>นัดหมาย</h3>
              {a ? (
                <>
                  <div className="ct-row">
                    <span>นัดทั้งหมด</span>
                    <span className="muted">
                      ออนไลน์ {a.online} · โทร {a.phone} · walk-in {a.walkin}
                    </span>
                    <strong className="num">{a.total}</strong>
                  </div>
                  <div className="ct-row">
                    <span>มาตรวจเสร็จ</span>
                    <span />
                    <strong className="num">{a.completed}</strong>
                  </div>
                  <div className="ct-row">
                    <span>ไม่มาตามนัด</span>
                    <span className="muted">{a.total ? Math.round((a.noShow / a.total) * 100) : 0}%</span>
                    <strong className="num">{a.noShow}</strong>
                  </div>
                  <div className="ct-row">
                    <span>ยกเลิก</span>
                    <span className="muted">{a.total ? Math.round((a.cancelled / a.total) * 100) : 0}%</span>
                    <strong className="num">{a.cancelled}</strong>
                  </div>
                  <div className="ct-row">
                    <span>คนไข้ใหม่ (เปิดแฟ้ม)</span>
                    <span />
                    <strong className="num">{data.newPatients}</strong>
                  </div>
                </>
              ) : null}
            </section>
            <section className="ledger-table close-table">
              <h3>รับเงินช่องทางไหน &amp; จ่ายอะไรไป</h3>
              {data.byMethod.map((m) => (
                <div key={m.method} className="ct-row">
                  <span>{payMethodLabel(m.method)}</span>
                  <span />
                  <strong className="num">{baht(m.amount)}</strong>
                </div>
              ))}
              {data.expensesByCategory.map((e) => (
                <div key={e.category} className="ct-row">
                  <span className="muted">จ่าย · {e.category}</span>
                  <span />
                  <span className="num owe">−{baht(e.amount)}</span>
                </div>
              ))}
              <div className="ct-row">
                <span className="muted">มูลค่าคงคลัง</span>
                <span className="muted">{data.lowStock ? `ใกล้หมด ${data.lowStock} รายการ` : ""}</span>
                <span className="num">{baht(data.stockValue)}</span>
              </div>
            </section>
          </div>

          <div className="close-cols">
            <section className="ledger-table close-table">
              <h3>คนไข้ที่ยังค้างชำระ</h3>
              {data.owing.length === 0 ? <p className="cl-empty">ไม่มี</p> : null}
              {data.owing.map((o) => (
                <div key={o.id} className="ct-row">
                  <span>
                    {o.patientName}
                    <span className="muted"> · {o.phone}</span>
                  </span>
                  <span className="muted">
                    {o.date}
                    {o.receiptNo ? ` · ${o.receiptNo}` : ""}
                  </span>
                  <strong className="num owe">{baht(o.balance)}</strong>
                </div>
              ))}
            </section>
            <section className="ledger-table close-table">
              <h3>ใบเสร็จที่ยกเลิก</h3>
              {data.voided.length === 0 ? <p className="cl-empty">ไม่มี</p> : null}
              {data.voided.map((v, i) => (
                <div key={i} className="ct-row">
                  <span>
                    {v.receiptNo ?? "(ยังไม่ออกเลข)"} · {v.patientName}
                  </span>
                  <span className="muted">{v.reason}</span>
                  <span className="num">{baht(v.total)}</span>
                </div>
              ))}
            </section>
          </div>
        </>
      )}

      {statement ? (
        <div className="print-sheet a5">
          <style>{`@page { size: A4; margin: 12mm; }`}</style>
          <header className="ps-head">
            <strong className="ps-clinic">{settings.clinicName}</strong>
          </header>
          <h2 className="ps-title">ใบสรุปค่าแพทย์ (DF)</h2>
          <div className="ps-meta">
            <span>{name(statement.dentistSlug)}</span>
            <span>
              {fmtLong(dict, statement.from, "th")} – {fmtLong(dict, statement.to, "th")}
            </span>
          </div>
          <table className="ps-table">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>ใบเสร็จ</th>
                <th>คนไข้</th>
                <th>รายการ</th>
                <th className="num">ยอด</th>
                <th className="num">แลป</th>
                <th className="num">DF</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.date.slice(5)}</td>
                  <td>{l.receiptNo}</td>
                  <td>{l.patientName}</td>
                  <td>
                    {l.item}
                    {l.teeth ? ` (${l.teeth})` : ""}
                    {l.qty > 1 ? ` ×${l.qty}` : ""}
                  </td>
                  <td className="num">{l.amount.toLocaleString("th-TH")}</td>
                  <td className="num">{l.labCost ? l.labCost.toLocaleString("th-TH") : ""}</td>
                  <td className="num">{l.df.toLocaleString("th-TH")}</td>
                </tr>
              ))}
              <tr className="ps-sum">
                <td colSpan={4}>รวม</td>
                <td className="num">{statement.total.toLocaleString("th-TH")}</td>
                <td className="num">{statement.labCost.toLocaleString("th-TH")}</td>
                <td className="num">{statement.df.toLocaleString("th-TH")}</td>
              </tr>
            </tbody>
          </table>
          <div className="ps-two-sign">
            <div className="ps-signature">
              <span>ลงชื่อ ............................................</span>
              <span>ผู้จัดทำ</span>
            </div>
            <div className="ps-signature">
              <span>ลงชื่อ ............................................</span>
              <span>({name(statement.dentistSlug)})</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
