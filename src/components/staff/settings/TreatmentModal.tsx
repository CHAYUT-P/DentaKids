"use client";

import React, { useState } from "react";
import { useStaff } from "@/lib/staffStore";
import { iconGroups, iconLibrary, tints, type IconGroup, type IconKey, type Tint } from "@/data/icons";
import { useT } from "@/i18n/lang";
import type { TreatmentInfo } from "@/lib/treatments";
import { DURATION_CHOICES, durationTh, endTime } from "@/lib/slots";
import { ServiceIcon } from "@/components/shared/serviceIcons";
import { IconCheck, IconX } from "@/components/staff/shell/staffIcons";

const TINT_TH: Record<Tint, string> = {
  rose: "ชมพู",
  peri: "คราม",
  violet: "ม่วง",
  blue: "ฟ้า",
  steel: "น้ำเงินเทา",
  gold: "ทอง",
  lav: "ลาเวนเดอร์",
};

/**
 * Add a treatment, or edit one. Any icon from the library can be picked, so
 * one drawing can stand for several treatments (e.g. "ตรวจฟันเด็กเล็ก" reusing
 * the check-up tooth). Built-in treatments keep their default name unless a
 * new one is typed here.
 */
export function TreatmentModal({ treatment, onClose }: { treatment: TreatmentInfo | null; onClose: () => void }) {
  const { createTreatment, updateTreatment } = useStaff();
  const dict = useT();
  const editing = treatment !== null;

  const [nameTh, setNameTh] = useState(treatment?.name.th ?? "");
  const [nameEn, setNameEn] = useState(treatment?.name.en ?? "");
  const [group, setGroup] = useState<IconGroup>(treatment?.group ?? "check");
  const [icon, setIcon] = useState<IconKey>(treatment?.icon ?? "checkup");
  const [tint, setTint] = useState<Tint>(treatment?.tint ?? "rose");
  const [quoted, setQuoted] = useState(treatment ? treatment.price === null : false);
  const [price, setPrice] = useState(treatment?.price != null ? String(treatment.price) : "");
  /** how long it takes — a 1-hour treatment holds two half-hour booking slots */
  const [duration, setDuration] = useState<number>(treatment?.durationMin ?? 30);
  const [err, setErr] = useState<string | null>(null);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameTh.trim()) {
      setErr("กรุณาใส่ชื่อบริการ (ภาษาไทย)");
      return;
    }
    const num = quoted ? null : Number(price.replace(/[^\d]/g, ""));
    if (!quoted && (price.trim() === "" || !Number.isFinite(num))) {
      setErr("กรุณาใส่ราคา หรือเลือก “ราคาประเมินหน้างาน”");
      return;
    }
    const fields = {
      nameTh: nameTh.trim(),
      nameEn: nameEn.trim() || undefined,
      iconKey: icon,
      tint,
      groupKey: group,
      price: num,
      durationMin: duration,
    };
    if (editing) updateTreatment(treatment.key, { ...fields, nameEn: fields.nameEn ?? null });
    else createTreatment(fields);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{editing ? "แก้ไขบริการ" : "เพิ่มบริการ"}</h3>
          <button type="button" className="btn-action-icon" aria-label="ปิด" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        <form onSubmit={save}>
          <div className="modal-body">
            <div className="tm-preview">
              <span className={`svc-disc tint-${tint}`}>
                <ServiceIcon k={icon} size={26} />
              </span>
              <span className="tm-preview-text">
                <strong>{nameTh.trim() || "ชื่อบริการ"}</strong>
                <span>{nameEn.trim() || "English name"}</span>
              </span>
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="tm-th">ชื่อบริการ (ไทย) *</label>
                <input
                  id="tm-th"
                  className="form-control"
                  value={nameTh}
                  placeholder="เช่น ตรวจฟันเด็กเล็ก"
                  onChange={(e) => {
                    setNameTh(e.target.value);
                    setErr(null);
                  }}
                />
              </div>
              <div className="form-group">
                <label htmlFor="tm-en">ชื่อภาษาอังกฤษ</label>
                <input
                  id="tm-en"
                  className="form-control"
                  value={nameEn}
                  placeholder="e.g. Toddler check-up"
                  onChange={(e) => setNameEn(e.target.value)}
                />
              </div>
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="tm-group">หมวดบนเว็บ</label>
                <select
                  id="tm-group"
                  className="form-control"
                  value={group}
                  onChange={(e) => setGroup(e.target.value as IconGroup)}
                >
                  {iconGroups.map((g) => (
                    <option key={g} value={g}>
                      {dict.group[g]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="tm-price">ราคาเริ่มต้น (บาท)</label>
                <input
                  id="tm-price"
                  className="form-control"
                  inputMode="numeric"
                  value={quoted ? "" : price}
                  disabled={quoted}
                  placeholder={quoted ? "ประเมินหน้างาน" : "เช่น 500 (0 = ฟรี)"}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setErr(null);
                  }}
                />
                <label className="tm-check">
                  <input type="checkbox" checked={quoted} onChange={(e) => setQuoted(e.target.checked)} />
                  <span>ราคาประเมินหน้างาน</span>
                </label>
              </div>
            </div>

            <div className="form-group">
              <span className="tm-label">ระยะเวลาต่อคิว</span>
              <div className="tm-durations" role="radiogroup" aria-label="ระยะเวลาต่อคิว">
                {DURATION_CHOICES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={duration === m}
                    className={`staff-pill-btn ${duration === m ? "active" : ""}`}
                    onClick={() => setDuration(m)}
                  >
                    {durationTh(m)}
                  </button>
                ))}
              </div>
              <span className="tm-hint">
                {duration > 30
                  ? `หนึ่งคิวใช้เวลา ${durationTh(duration)} — เช่น จอง 10:00 จะกันเวลา 10:00–${endTime("10:00", duration)} ไม่ให้คิวอื่นจองซ้อน`
                  : "หนึ่งคิวใช้ช่องเวลาเดียว (30 นาที)"}
              </span>
            </div>

            <div className="form-group">
              <span className="tm-label">ไอคอน</span>
              <div className="tm-icons" role="radiogroup" aria-label="ไอคอน">
                {iconLibrary.map((e) => (
                  <button
                    key={e.key}
                    type="button"
                    role="radio"
                    aria-checked={icon === e.key}
                    aria-label={dict.service[e.key]}
                    title={dict.service[e.key]}
                    className={`tm-icon ${icon === e.key ? "on" : ""}`}
                    onClick={() => setIcon(e.key)}
                  >
                    <span className={`svc-disc sm tint-${tint}`}>
                      <ServiceIcon k={e.key} size={20} />
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <span className="tm-label">สีพื้น</span>
              <div className="tm-tints" role="radiogroup" aria-label="สีพื้น">
                {tints.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={tint === c}
                    aria-label={TINT_TH[c]}
                    title={TINT_TH[c]}
                    className={`tm-tint tint-${c} ${tint === c ? "on" : ""}`}
                    onClick={() => setTint(c)}
                  >
                    {tint === c ? <IconCheck size={14} /> : null}
                  </button>
                ))}
              </div>
            </div>

            {err ? <p className="tm-err">{err}</p> : null}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary-staff btn-lg" onClick={onClose}>
              ยกเลิก
            </button>
            <button type="submit" className="btn-primary-staff btn-lg">
              <IconCheck size={16} />
              <span>{editing ? "บันทึก" : "เพิ่มบริการ"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
