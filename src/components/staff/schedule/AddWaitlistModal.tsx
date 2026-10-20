"use client";

import React, { useState } from "react";
import { useTreatments } from "@/lib/treatmentsContext";
import { useStaff } from "@/lib/staffStore";
import type { IconKey } from "@/data/icons";
import { IconX, IconWalkIn } from "@/components/staff/shell/staffIcons";

interface AddWaitlistModalProps {
  onClose: () => void;
}

export function AddWaitlistModal({ onClose }: AddWaitlistModalProps) {
  const { dentists, addWaitlist } = useStaff();
  const tr = useTreatments();

  const [childName, setChildName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [treatmentKey, setTreatmentKey] = useState<IconKey>("checkup");
  const [dentistSlug, setDentistSlug] = useState<string>("");
  const [notes, setNotes] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!childName.trim() || !guardianPhone.trim()) {
      alert("กรุณากรอกชื่อคนไข้และเบอร์โทรศัพท์");
      return;
    }

    addWaitlist({
      childName: childName.trim(),
      guardianPhone: guardianPhone.trim(),
      treatmentKey,
      dentistSlug: dentistSlug || undefined,
      notes: notes.trim() || undefined,
    });

    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card booking-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>ลงทะเบียน Walk-in (คิวรอตรวจวันนี้)</h3>
          <button type="button" className="btn-action-icon" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>ชื่อที่จอง *</label>
              <input
                type="text"
                className="form-control"
                placeholder="เช่น น้องพร้อม"
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>เบอร์โทร *</label>
              <input
                type="tel"
                className="form-control"
                placeholder="08X-XXX-XXXX"
                value={guardianPhone}
                onChange={(e) => setGuardianPhone(e.target.value)}
                required
              />
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>การรักษาที่ต้องการ</label>
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
                        {t.name.th}
                      </option>
                    ))}
                </select>
              </div>

              <div className="form-group">
                <label>หมอที่ต้องการ (ถ้ามี)</label>
                <select
                  className="form-control"
                  value={dentistSlug}
                  onChange={(e) => setDentistSlug(e.target.value)}
                >
                  <option value="">หมอท่านใดก็ได้ (Any)</option>
                  {dentists.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.text.th.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>หมายเหตุ</label>
              <input
                type="text"
                className="form-control"
                placeholder="เช่น ปวดฟันมา 2 วัน, เดินทางมาถึงแล้ว"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary-staff" onClick={onClose}>
              ยกเลิก
            </button>
            <button type="submit" className="btn-primary-staff">
              <IconWalkIn size={16} />
              <span>เพิ่มเข้าคิวรอตรวจ</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
