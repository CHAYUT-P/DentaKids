"use client";

import React, { useState } from "react";
import { useTreatments } from "@/lib/treatmentsContext";
import { coveredTimes, durationTh, slotsNeeded, timeRange } from "@/lib/slots";
import { useStaff, type BookingSource } from "@/lib/staffStore";
import type { IconKey } from "@/data/icons";
import { IconX, IconPlus, IconPhone, IconWalkIn, IconSmartphone } from "@/components/staff/shell/staffIcons";

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
  const { today, dentists, appointments, createAppointment } = useStaff();
  const tr = useTreatments();

  const [date, setDate] = useState(initialDate || today);
  const [time, setTime] = useState(initialTime || "10:00");
  const [dentistSlug, setDentistSlug] = useState(initialDentistSlug || dentists[0]?.slug || "naree");
  const [treatmentKey, setTreatmentKey] = useState<IconKey>("checkup");
  /** the name the family gives at the desk — a nickname is enough */
  const [childName, setChildName] = useState(initialChildName || "");
  const [phone, setPhone] = useState(initialPhone || "");
  const [source, setSource] = useState<BookingSource>("phone");
  const [notes, setNotes] = useState("");

  const activeDentists = dentists.filter((d) => d.isActive);

  /** a 1-hour treatment holds two half-hours — does either already belong to someone? */
  const durationMin = tr.get(treatmentKey).durationMin;
  const need = new Set(coveredTimes(time, durationMin));
  const clash = appointments.find(
    (a) =>
      a.date === date &&
      a.dentistSlug === dentistSlug &&
      a.status !== "cancelled" &&
      coveredTimes(a.time, a.durationMin).some((t) => need.has(t)),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!childName.trim()) {
      alert("กรุณากรอกชื่อที่ใช้จอง");
      return;
    }
    if (!phone.trim()) {
      alert("กรุณากรอกเบอร์โทร");
      return;
    }
    if (clash) return;

    createAppointment({
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
    });

    if (onCreated) onCreated();
    onClose();
  };

  const times = [
    "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
    "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00"
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card booking-card" onClick={(e) => e.stopPropagation()}>
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

            {/* Treatment & Dentist */}
            <div className="form-row-2">
              <div className="form-group">
                <label>ทันตแพทย์ผู้ตรวจ</label>
                <select
                  className="form-control"
                  value={dentistSlug}
                  onChange={(e) => setDentistSlug(e.target.value)}
                >
                  {activeDentists.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.text.th.name} ({d.text.th.title})
                    </option>
                  ))}
                </select>
              </div>

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
            </div>

            {/* Date & Time */}
            <div className="form-row-2">
              <div className="form-group">
                <label>วันที่นัดหมาย</label>
                <input
                  type="date"
                  className="form-control"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>เวลานัดหมาย</label>
                <select
                  className="form-control"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                >
                  {times.map((t) => (
                    <option key={t} value={t}>
                      {t} น.
                    </option>
                  ))}
                </select>
              </div>
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
            {clash ? (
              <span className="booking-clash">
                ช่วง {timeRange(time, durationMin)} ชนกับนัดของ {clash.childName} ({timeRange(clash.time, clash.durationMin)})
              </span>
            ) : slotsNeeded(durationMin) > 1 ? (
              <span className="booking-long">บริการนี้ใช้เวลา {durationTh(durationMin)} · {timeRange(time, durationMin)}</span>
            ) : null}
            <button type="button" className="btn-secondary-staff" onClick={onClose}>
              ยกเลิก
            </button>
            <button type="submit" className="btn-primary-staff" disabled={!!clash}>
              <IconPlus size={15} />
              <span>บันทึกการจอง</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
