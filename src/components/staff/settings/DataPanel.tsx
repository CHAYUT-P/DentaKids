"use client";

import React, { useState } from "react";

import { staffExportBills, staffExportPatients, staffImportPatients } from "@/server/actions";
import { FIELD_NAMES, guessColumns, parseCsv, type ImportField } from "@/lib/dataio";
import { useStaff } from "@/lib/staffStore";
import { DateField } from "@/components/staff/shell/DateField";

/** hand a string to the browser as a file to save */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const FIELDS = Object.keys(FIELD_NAMES) as ImportField[];

/**
 * ตั้งค่า › นำเข้า / ส่งออกข้อมูล (full edition) — bring the patient list over
 * from the old program as CSV (columns are matched by their Thai/English
 * names and can be corrected before importing), and take patients or bills
 * out as CSV (Excel opens them).
 */
export function DataPanel() {
  const { today, showToast, refresh } = useStaff();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [cols, setCols] = useState<Partial<Record<ImportField, number>>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setResult("");
    const buf = await file.arrayBuffer();
    // old Windows programs often export TIS-620 (Thai) rather than UTF-8
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("windows-874").decode(buf);
    const parsed = parseCsv(text);
    setRows(parsed);
    setCols(guessColumns(parsed[0] ?? []));
  };

  const run = async () => {
    if (!rows) return;
    const body = rows.slice(1).map((r) => {
      const o: Partial<Record<ImportField, string>> = {};
      for (const f of FIELDS) if (cols[f] != null) o[f] = r[cols[f]!] ?? "";
      return o;
    });
    setBusy(true);
    let created = 0,
      updated = 0,
      skipped = 0;
    for (let i = 0; i < body.length; i += 400) {
      const r = await staffImportPatients(body.slice(i, i + 400));
      created += r.created;
      updated += r.updated;
      skipped += r.skipped;
    }
    setBusy(false);
    setResult(`นำเข้าแล้ว: เพิ่มใหม่ ${created} · อัปเดต ${updated} · ข้าม ${skipped} (ไม่มีเบอร์โทรหรือชื่อ)`);
    setRows(null);
    showToast("นำเข้ารายชื่อคนไข้เรียบร้อย");
    refresh();
  };

  const header = rows?.[0] ?? [];
  return (
    <div className="staff-container billing-settings">
      <div className="staff-page-header">
        <div>
          <h2>นำเข้า / ส่งออกข้อมูล</h2>
          <p>ย้ายรายชื่อคนไข้จากโปรแกรมเดิมทีละส่วน · ส่งออกเป็น CSV (เปิดใน Excel ได้)</p>
        </div>
      </div>

      <section className="settings-card">
        <h3>นำเข้ารายชื่อคนไข้จากไฟล์ CSV</h3>
        <p className="settings-help">
          ส่งออกรายชื่อคนไข้จากโปรแกรมเดิมเป็น CSV/Excel (บันทึกเป็น .csv) แล้วเลือกไฟล์ที่นี่. ระบบจับคู่คอลัมน์ให้อัตโนมัติ
          ตรวจและแก้ได้ก่อนนำเข้า · ต้องมีเบอร์โทรและชื่อ · คนไข้ที่มีอยู่แล้วจะถูกอัปเดต ไม่ซ้ำ · ช่องว่างในไฟล์จะไม่ลบข้อมูลเดิม
        </p>
        <label className="btn-secondary-staff" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
          เลือกไฟล์ CSV
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => void read(e.target.files?.[0])} />
        </label>
        {result ? <p className="ok-note">{result}</p> : null}
        {rows ? (
          <>
            <p className="settings-help">พบ {rows.length - 1} แถว · จับคู่คอลัมน์:</p>
            <div className="map-grid">
              {FIELDS.map((f) => (
                <label key={f}>
                  {FIELD_NAMES[f].label}
                  <select className="form-control" value={cols[f] ?? ""} onChange={(e) => setCols({ ...cols, [f]: e.target.value === "" ? undefined : Number(e.target.value) })}>
                    <option value="">— ไม่นำเข้า —</option>
                    {header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `คอลัมน์ ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="import-preview">
              <table className="ps-table">
                <thead>
                  <tr>
                    {FIELDS.filter((f) => cols[f] != null).map((f) => (
                      <th key={f}>{FIELD_NAMES[f].label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(1, 6).map((r, i) => (
                    <tr key={i}>
                      {FIELDS.filter((f) => cols[f] != null).map((f) => (
                        <td key={f}>{r[cols[f]!]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="settings-save">
              <button type="button" className="btn-secondary-staff" onClick={() => setRows(null)}>
                ยกเลิก
              </button>
              <button type="button" className="btn-primary-staff" disabled={busy || cols.phone == null || (cols.name == null && cols.fullName == null)} onClick={() => void run()}>
                {busy ? "กำลังนำเข้า…" : `นำเข้า ${rows.length - 1} แถว`}
              </button>
            </div>
          </>
        ) : null}
      </section>

      <section className="settings-card">
        <h3>ส่งออก</h3>
        <div className="export-row">
          <span>รายชื่อคนไข้ทั้งหมด</span>
          <button type="button" className="btn-secondary-staff" onClick={async () => download(`patients-${today}.csv`, await staffExportPatients())}>
            ดาวน์โหลด CSV
          </button>
        </div>
        <div className="export-row">
          <span>บิลและการรับเงิน</span>
          <DateField ariaLabel="ตั้งแต่" value={from} onChange={setFrom} max={to || undefined} />
          <DateField ariaLabel="ถึง" value={to} onChange={setTo} min={from || undefined} />
          <button type="button" className="btn-secondary-staff" onClick={async () => download(`bills-${from}_${to}.csv`, await staffExportBills(from, to))}>
            ดาวน์โหลด CSV
          </button>
        </div>
      </section>
    </div>
  );
}
