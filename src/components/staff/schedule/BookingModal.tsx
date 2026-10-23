"use client";

import React, { useState } from "react";
import { useTreatments } from "@/lib/treatmentsContext";
import { durationTh, slotsNeeded, timeRange } from "@/lib/slots";
import { useStaff, type BookingSource } from "@/lib/staffStore";
import type { IconKey } from "@/data/icons";
import { IconX, IconPlus, IconPhone, IconWalkIn, IconSmartphone } from "@/components/staff/shell/staffIcons";
import { pickIsValid, SlotPicker, useGridFor, type SlotPick } from "@/components/staff/schedule/SlotPicker";
import { newIdempotencyKey } from "@/lib/idempotency";

interface BookingModalProps {
  initialDate?: string;
  initialTime?: string;
  initialDentistSlug?: string;
  /** prefill the patient fields — used when booking straight from a patient card */
  initialChildName?: string;
  initialChildAge?: number;
  initialGuardianName?: string;
  initialPhone?: string;
  initialForSelf?: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export function BookingModal({
  initialDate,
  initialTime,
  initialDentistSlug,
  initialChildName,
  initialChildAge,
  initialGuardianName,
  initialPhone,
  initialForSelf,
  onClose,
  onCreated,
}: BookingModalProps) {
  const { today, createAppointment } = useStaff();
  const tr = useTreatments();

  /** day, time and dentist, picked together in the availability grid */
  const [pick, setPick] = useState<SlotPick>({
    date: initialDate || today,
    time: initialTime || "",
    dentistSlug: initialDentistSlug || "",
  });
  const { date, time, dentistSlug } = pick;
  /** saving: the form stays open until the server says yes, so a taken time
   *  never loses what was typed */
  const [saving, setSaving] = useState(false);
  const [treatmentKey, setTreatmentKey] = useState<IconKey>("checkup");
  /** the name the family gives at the desk — a nickname is enough */
  const [childName, setChildName] = useState(initialChildName || "");
  const [phone, setPhone] = useState(initialPhone || "");
  const [source, setSource] = useState<BookingSource>("phone");
  const [notes, setNotes] = useState("");

  /** one key per window: a double click on save books once */
  const [saveKey] = useState(newIdempotencyKey);

  /** a 1-hour treatment needs two free half-hours — the grid only offers those */
  const durationMin = tr.get(treatmentKey).durationMin;
  const gridFor = useGridFor(durationMin);
  const ready = pickIsValid(gridFor(date), pick);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!childName.trim()) {
      alert("กรุณากรอกชื่อที่ใช้จอง");
      return;
    }
    if (!phone.trim()) {
      alert("กรุณากรอกเบอร์โทร");
      return;
    }
    if (!ready) return;

    setSaving(true);
    const saved = await createAppointment({
      date,
      time,
      durationMin: 30,
      childName: childName.trim(),
      // booking from a patient record (full edition) keeps that record's
      // details; a plain desk booking is just the name + phone
      childAge: initialChildAge,
      guardianName: initialGuardianName?.trim() || childName.trim(),
      phone: phone.trim(),
      dentistSlug,
      treatmentKey,
      source,
      status: "confirmed",
      notes: notes.trim(),
      price: tr.get(treatmentKey).price ?? 0,
      forSelf: initialForSelf ?? false,
    }, { idempotencyKey: saveKey });
    setSaving(false);
    if (!saved) return; // the toast said why; fix the time and save again

    if (onCreated) onCreated();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card booking-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>นัดใหม่</h3>
          <button type="button" className="btn-action-icon" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Source */}
            <div className="form-group">
              <label>ช่องทางการจอง (Source)</label>
              <div className="staff-pill-group" style={{ width: "fit-content" }}>
                <button
                  type="button"
                  className={`staff-pill-btn ${source === "phone" ? "active" : ""}`}
                  onClick={() => setSource("phone")}
                >
                  <IconPhone size={13} />
                  <span>โทรศัพท์ (Phone)</span>
                </button>
                <button
                  type="button"
                  className={`staff-pill-btn ${source === "walkin" ? "active" : ""}`}
                  onClick={() => setSource("walkin")}
                >
                  <IconWalkIn size={13} />
                  <span>หน้าร้าน (Walk-in)</span>
                </button>
                <button
                  type="button"
                  className={`staff-pill-btn ${source === "online" ? "active" : ""}`}
                  onClick={() => setSource("online")}
                >
                  <IconSmartphone size={13} />
                  <span>LINE LIFF (Online)</span>
                </button>
              </div>
            </div>

            {/* Who is coming: the name they will give at the desk + a phone */}
            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="bk-name">ชื่อที่จอง *</label>
                <input
                  id="bk-name"
                  type="text"
                  className="form-control"
                  placeholder="เช่น น้องเจได"
                  value={childName}
                  onChange={(e) => setChildName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="bk-phone">เบอร์โทร *</label>
                <input
                  id="bk-phone"
                  type="tel"
                  className="form-control"
                  placeholder="08X-XXX-XXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* the treatment first: its length decides which times are free */}
            <div className="form-group">
              <label>หัตถการ / การรักษา</label>
              <select
                className="form-control"
                value={treatmentKey}
                onChange={(e) => setTreatmentKey(e.target.value as IconKey)}
              >
                {/* every treatment — ones hidden from the website (e.g. follow-ups)
                    are booked by staff only, and say so */}
                {tr.list
                  .filter((t) => t.key !== "more")
                  .map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name.th} {t.price ? `(฿${t.price.toLocaleString()})` : ""}
                      {t.isActive ? "" : " · เจ้าหน้าที่ลงนัดเท่านั้น"}
                    </option>
                  ))}
              </select>
            </div>

            {/* day, time and dentist from what is really free */}
            <div className="form-group">
              <label>วัน เวลา และทันตแพทย์</label>
              <SlotPicker value={pick} onChange={setPick} durationMin={durationMin} />
            </div>

            {/* Notes */}
            <div className="form-group">
              <label>หมายเหตุ / อาการเบื้องต้น</label>
              <textarea
                className="form-control"
                rows={2}
                placeholder="เช่น ตรวจสุขภาพฟันประจำปี, กังวลเรื่องฟันผุ"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-footer">
            {ready && slotsNeeded(durationMin) > 1 ? (
              <span className="booking-long">บริการนี้ใช้เวลา {durationTh(durationMin)} · {timeRange(time, durationMin)}</span>
            ) : null}
            <button type="button" className="btn-secondary-staff" onClick={onClose}>
              ยกเลิก
            </button>
            <button type="submit" className="btn-primary-staff" disabled={!ready || saving}>
              <IconPlus size={15} />
              <span>{saving ? "กำลังบันทึก…" : "บันทึกการจอง"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
