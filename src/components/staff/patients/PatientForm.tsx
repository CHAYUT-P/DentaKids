"use client";

import React, { useState } from "react";
import type { PatientChild, PatientRecord } from "@/lib/staffStore";
import { IconPlus, IconX } from "@/components/staff/shell/staffIcons";
import { COVERAGE_LABEL } from "@/lib/billing";
import { idCardReaderAvailable, readIdCard, thaiFullName } from "@/lib/idCard";

/**
 * The patient add/edit form (full edition) — guardian, then each child with
 * their medical notes. Shared by the patients list and the patient file.
 */

const RELATIONS = ["แม่", "พ่อ", "ยาย", "ตา", "ย่า", "ปู่", "ลุง", "ป้า", "น้า", "อา", "ผู้ปกครองอื่น", "ตนเอง"];
const GENDERS = [
  { v: "", label: "— เลือก —" },
  { v: "male", label: "ชาย" },
  { v: "female", label: "หญิง" },
] as const;
const BLOOD_TYPES = ["", "A", "B", "O", "AB"] as const;

function newHN(): string {
  return `DK-${Math.floor(100000 + Math.random() * 900000)}`;
}

/** age in years from a YYYY-MM-DD birthdate against the clinic's today */
export function ageOf(c: Pick<PatientChild, "birthdate" | "age">, today: string): number | undefined {
  if (c.birthdate) {
    const [by, bm, bd] = c.birthdate.split("-").map(Number);
    const [ty, tm, td] = today.split("-").map(Number);
    if (!by || !bm || !bd) return c.age;
    let a = ty - by;
    if (tm < bm || (tm === bm && td < bd)) a -= 1;
    return a >= 0 ? a : undefined;
  }
  return c.age;
}

/* ------------------------------------------------------------------ */
/* Shared add/edit form — staff records the REAL file here. Online     */
/* bookings only ever create a skeleton (names + phone); this form     */
/* completes it on the first visit.                                    */
/* ------------------------------------------------------------------ */

interface ChildForm {
  key: string;
  id?: string;
  name: string;
  fullName: string;
  nickname: string;
  birthdate: string;
  age: string;
  gender: "" | "male" | "female";
  hn: string;
  bloodType: "" | "A" | "B" | "O" | "AB";
  idCard: string;
  tags: string;
  recallMonths: string;
  coverage: string;
  conditions: string;
  medications: string;
  allergies: string;
  notes: string;
}

export interface PatientFormState {
  guardianName: string;
  guardianFullName: string;
  guardianRelation: string;
  phone: string;
  lineId: string;
  address: string;
  children: ChildForm[];
}

function blankChild(): ChildForm {
  return {
    key: `n-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: "",
    fullName: "",
    nickname: "",
    birthdate: "",
    age: "",
    gender: "",
    hn: newHN(),
    bloodType: "",
    idCard: "",
    tags: "",
    recallMonths: "6",
    coverage: "cash",
    conditions: "",
    medications: "",
    allergies: "",
    notes: "",
  };
}

export function blankForm(): PatientFormState {
  return {
    guardianName: "",
    guardianFullName: "",
    guardianRelation: "แม่",
    phone: "",
    lineId: "",
    address: "",
    children: [blankChild()],
  };
}

export function formFromRecord(p: PatientRecord): PatientFormState {
  return {
    guardianName: p.guardianName,
    guardianFullName: p.guardianFullName ?? "",
    guardianRelation: p.guardianRelation ?? "แม่",
    phone: p.phone,
    lineId: p.lineId ?? "",
    address: p.address ?? "",
    children: p.children.map((c) => ({
      key: c.id,
      id: c.id,
      name: c.name,
      fullName: c.fullName ?? "",
      nickname: c.nickname ?? "",
      birthdate: c.birthdate ?? "",
      age: c.age != null ? String(c.age) : "",
      gender: c.gender ?? "",
      hn: c.hn ?? newHN(),
      bloodType: c.bloodType ?? "",
      idCard: c.idCard ?? "",
      tags: (c.tags ?? []).join(", "),
      recallMonths: String(c.recallMonths ?? 6),
      coverage: c.coverage ?? "cash",
      conditions: c.conditions ?? "",
      medications: c.medications ?? "",
      allergies: c.allergies ?? "",
      notes: c.notes ?? "",
    })),
  };
}

export function PatientForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: PatientFormState;
  submitLabel: string;
  onSubmit: (s: PatientFormState) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState<PatientFormState>(initial);
  const [err, setErr] = useState<string | null>(null);

  const set = (patch: Partial<PatientFormState>) => {
    setS((prev) => ({ ...prev, ...patch }));
    setErr(null);
  };
  const setChild = (key: string, patch: Partial<ChildForm>) =>
    setS((prev) => ({
      ...prev,
      children: prev.children.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    }));

  /* a USB card reader on this PC (desktop app) fills the details in from the card */
  const reader = idCardReaderAvailable();
  const [reading, setReading] = useState(false);
  const [cardErr, setCardErr] = useState("");
  const fromCard = async (childKey: string | null) => {
    setReading(true);
    setCardErr("");
    try {
      const card = await readIdCard();
      if (childKey === null) {
        set({ guardianFullName: thaiFullName(card), ...(card.address && !s.address ? { address: card.address } : {}) });
      } else {
        setChild(childKey, {
          fullName: thaiFullName(card),
          idCard: card.cid,
          ...(card.birthdate ? { birthdate: card.birthdate } : {}),
          ...(card.gender ? { gender: card.gender } : {}),
        });
      }
    } catch (e) {
      setCardErr(e instanceof Error ? e.message : "อ่านบัตรไม่สำเร็จ");
    } finally {
      setReading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!s.guardianFullName.trim() || !s.phone.trim()) {
      setErr("กรุณากรอกชื่อ-นามสกุลจริงของผู้ปกครอง และเบอร์โทรศัพท์");
      return;
    }
    // guardian info is mandatory for minors (consent / contact / billing) —
    // adult self-bookings ("ตนเอง") need no child rows at all
    if (s.guardianRelation !== "ตนเอง") {
      if (s.children.length === 0) {
        setErr("กรุณาเพิ่มข้อมูลเด็กอย่างน้อย 1 คน");
        return;
      }
      for (const c of s.children) {
        if (!c.name.trim() || !c.fullName.trim()) {
          setErr("เด็กทุกคนต้องมีชื่อเรียก และชื่อ-นามสกุลจริง");
          return;
        }
      }
    }
    onSubmit(s);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="modal-body">
        {/* Guardian */}
        <div className="form-section-head">
          <span>ข้อมูลผู้ปกครอง</span>
          {reader ? (
            <button type="button" className="btn-secondary-staff id-read-btn" disabled={reading} onClick={() => void fromCard(null)}>
              {reading ? "กำลังอ่านบัตร…" : "อ่านบัตรประชาชนผู้ปกครอง"}
            </button>
          ) : null}
        </div>
        {cardErr ? <div className="id-read-err">{cardErr}</div> : null}
        <div className="form-row-2">
          <div className="form-group">
            <label>ชื่อ-นามสกุลจริง *</label>
            <input
              type="text"
              className="form-control"
              placeholder="เช่น นางสาววรรณษา รักษ์ฟัน"
              value={s.guardianFullName}
              onChange={(e) => set({ guardianFullName: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>ชื่อเรียก / ชื่อเล่น</label>
            <input
              type="text"
              className="form-control"
              placeholder="เช่น คุณแม่วรรณษา (Mon)"
              value={s.guardianName}
              onChange={(e) => set({ guardianName: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row-2">
          <div className="form-group">
            <label>ความสัมพันธ์กับเด็ก</label>
            <select
              className="form-control"
              value={s.guardianRelation}
              onChange={(e) => set({ guardianRelation: e.target.value })}
            >
              {RELATIONS.map((r) => (
                <option key={r} value={r}>{r === "ตนเอง" ? "ตนเอง (จองให้ตัวเอง — ไม่ต้องมีเด็ก)" : r}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>เบอร์โทรศัพท์ติดต่อ *</label>
            <input
              type="tel"
              className="form-control"
              placeholder="08X-XXX-XXXX"
              value={s.phone}
              onChange={(e) => set({ phone: e.target.value })}
              required
            />
          </div>
        </div>
        <div className="form-row-2">
          <div className="form-group">
            <label>LINE ID</label>
            <input
              type="text"
              className="form-control"
              placeholder="เช่น @mon_mom"
              value={s.lineId}
              onChange={(e) => set({ lineId: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>ที่อยู่</label>
            <input
              type="text"
              className="form-control"
              placeholder="บ้านเลขที่ / ซอย / แขวง…"
              value={s.address}
              onChange={(e) => set({ address: e.target.value })}
            />
          </div>
        </div>

        {/* Children */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "10px" }}>
          <div style={{ fontSize: "13.5px", fontWeight: 800, color: "var(--staff-ink)" }}>
            ข้อมูลเด็ก ({s.children.length} คน)
            {s.guardianRelation === "ตนเอง" ? (
              <span style={{ fontWeight: 500, fontSize: "12px", color: "var(--staff-ink-muted)" }}> — ไม่บังคับ (คนไข้ผู้ใหญ่)</span>
            ) : null}
          </div>
          <button
            type="button"
            className="btn-secondary-staff"
            style={{ padding: "5px 12px", fontSize: "12px" }}
            onClick={() => setS((prev) => ({ ...prev, children: [...prev.children, blankChild()] }))}
          >
            <IconPlus size={13} />
            <span>เพิ่มเด็ก</span>
          </button>
        </div>

        {s.children.map((c, i) => (
          <div
            key={c.key}
            style={{
              border: "1px solid var(--staff-border)",
              borderRadius: "10px",
              padding: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              background: "var(--staff-surface-subtle)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: "13px" }}>เด็กคนที่ {i + 1}</strong>
              {reader ? (
                <button type="button" className="btn-secondary-staff id-read-btn" style={{ marginLeft: "auto", marginRight: "8px" }} disabled={reading} onClick={() => void fromCard(c.key)}>
                  {reading ? "กำลังอ่าน…" : "อ่านบัตรประชาชนเด็ก"}
                </button>
              ) : null}
              {s.children.length > 1 || s.guardianRelation === "ตนเอง" ? (
                <button
                  type="button"
                  className="btn-action-icon danger"
                  title="ลบเด็กคนนี้ออก"
                  onClick={() =>
                    setS((prev) => ({ ...prev, children: prev.children.filter((x) => x.key !== c.key) }))
                  }
                >
                  <IconX size={13} />
                </button>
              ) : null}
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>ชื่อ-นามสกุลจริง *</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="เช่น ด.ช. เจได รักษ์ฟัน"
                  value={c.fullName}
                  onChange={(e) => setChild(c.key, { fullName: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>ชื่อเรียก *</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="เช่น น้องเจได"
                  value={c.name}
                  onChange={(e) => setChild(c.key, { name: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>ชื่อเล่น</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="เช่น เจได"
                  value={c.nickname}
                  onChange={(e) => setChild(c.key, { nickname: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>วันเกิด</label>
                <input
                  type="date"
                  className="form-control"
                  value={c.birthdate}
                  onChange={(e) => setChild(c.key, { birthdate: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px" }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>อายุ (ปี)</label>
                <input
                  type="number"
                  className="form-control"
                  placeholder="—"
                  value={c.age}
                  onChange={(e) => setChild(c.key, { age: e.target.value })}
                  min={0}
                  max={18}
                  disabled={!!c.birthdate}
                  title={c.birthdate ? "คำนวณจากวันเกิดอัตโนมัติ" : "กรอกเมื่อไม่ทราบวันเกิด"}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>เพศ</label>
                <select
                  className="form-control"
                  value={c.gender}
                  onChange={(e) => setChild(c.key, { gender: e.target.value as ChildForm["gender"] })}
                >
                  {GENDERS.map((g) => (
                    <option key={g.v} value={g.v}>{g.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>HN</label>
                <input
                  type="text"
                  className="form-control"
                  value={c.hn}
                  onChange={(e) => setChild(c.key, { hn: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>กรุ๊ปเลือด</label>
                <select
                  className="form-control"
                  value={c.bloodType}
                  onChange={(e) => setChild(c.key, { bloodType: e.target.value as ChildForm["bloodType"] })}
                >
                  {BLOOD_TYPES.map((b) => (
                    <option key={b} value={b}>{b || "—"}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>เลขบัตรประชาชน</label>
                <input
                  type="text"
                  className="form-control"
                  inputMode="numeric"
                  maxLength={17}
                  placeholder="13 หลัก"
                  value={c.idCard}
                  onChange={(e) => setChild(c.key, { idCard: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>นัดตรวจตามรอบทุก (เดือน)</label>
                <select
                  className="form-control"
                  value={c.recallMonths}
                  onChange={(e) => setChild(c.key, { recallMonths: e.target.value })}
                >
                  {["0", "3", "4", "6", "12"].map((m) => (
                    <option key={m} value={m}>{m === "0" ? "ไม่ต้องเตือน" : `${m} เดือน`}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>สิทธิการรักษา</label>
              <select className="form-control" value={c.coverage} onChange={(e) => setChild(c.key, { coverage: e.target.value })}>
                {Object.entries(COVERAGE_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>ป้ายกำกับ (คั่นด้วยจุลภาค)</label>
              <input
                type="text"
                className="form-control"
                placeholder="เช่น จัดฟัน, กลัวหมอฟัน, ต้องดมยา"
                value={c.tags}
                onChange={(e) => setChild(c.key, { tags: e.target.value })}
              />
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>โรคประจำตัว</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="เช่น หอบหืด หรือ ไม่มี"
                  value={c.conditions}
                  onChange={(e) => setChild(c.key, { conditions: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>ยาที่กินประจำ</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="เช่น ยาพ่น Ventolin หรือ ไม่มี"
                  value={c.medications}
                  onChange={(e) => setChild(c.key, { medications: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>ประวัติแพ้ยา / อาหาร</label>
              <input
                type="text"
                className="form-control"
                placeholder="เช่น แพ้ยา Amoxicillin หรือ ไม่มี"
                value={c.allergies}
                onChange={(e) => setChild(c.key, { allergies: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>บันทึกพฤติกรรมหรือข้อควรระวัง</label>
              <textarea
                className="form-control"
                rows={2}
                placeholder="เช่น กลัวเข็ม, ชอบให้เปิดการ์ตูนระหว่างทำฟัน"
                value={c.notes}
                onChange={(e) => setChild(c.key, { notes: e.target.value })}
              />
            </div>
          </div>
        ))}

        {err ? (
          <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#c92a2a" }}>{err}</div>
        ) : null}
      </div>

      <div className="modal-footer">
        <button type="button" className="btn-secondary-staff" onClick={onCancel}>
          ยกเลิก
        </button>
        <button type="submit" className="btn-primary-staff">
          <IconPlus size={15} />
          <span>{submitLabel}</span>
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */


export const toPatientPayload = (s: PatientFormState): Omit<PatientRecord, "id" | "registeredAt"> => ({
  guardianName: s.guardianName.trim() || s.guardianFullName.trim(),
  guardianFullName: s.guardianFullName.trim() || undefined,
  guardianRelation: s.guardianRelation || undefined,
  phone: s.phone.trim(),
  lineId: s.lineId.trim() || undefined,
  address: s.address.trim() || undefined,
  children: s.children.map((c) => ({
    id: c.id ?? `c-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: c.name.trim(),
    fullName: c.fullName.trim() || undefined,
    nickname: c.nickname.trim() || undefined,
    birthdate: c.birthdate || undefined,
    age: !c.birthdate && c.age !== "" ? parseInt(c.age, 10) : undefined,
    gender: (c.gender || undefined) as PatientChild["gender"],
    hn: c.hn.trim() || undefined,
    bloodType: (c.bloodType || undefined) as PatientChild["bloodType"],
    idCard: c.idCard.replace(/\D/g, ""),
    tags: c.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
    recallMonths: Number(c.recallMonths) || 0,
  coverage: c.coverage,
    conditions: c.conditions.trim() || undefined,
    medications: c.medications.trim() || undefined,
    allergies: c.allergies.trim() || undefined,
    notes: c.notes.trim() || undefined,
  })),
});

