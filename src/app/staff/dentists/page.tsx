"use client";

import React, { useState } from "react";
import { useTreatments } from "@/lib/treatmentsContext";
import { useStaff, type EditableDentist } from "@/lib/staffStore";
import { EditDentistModal } from "@/components/staff/settings/EditDentistModal";
import { DentistLeaveModal } from "@/components/staff/settings/DentistLeaveModal";
import { fmtHolidayRange } from "@/components/staff/schedule/RangeCalendar";
import { IconCalendar, IconEdit, IconPlus } from "@/components/staff/shell/staffIcons";

/** Sunday-first, like a wall calendar — `shift.weekday` 0 = Sun … 6 = Sat */
const WEEK = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/**
 * ทันตแพทย์ & เวรตรวจ — one row per dentist: who they are, which days they
 * work (a week strip that scans down the list), whether they take bookings,
 * and the edit button. The full profile (blurb, photo, hours, treatments)
 * lives in the edit dialog; what is set here shows on the patient site.
 */
export default function StaffDentistsPage() {
  const { dentists, updateDentist, dentistLeaves, today } = useStaff();
  const tr = useTreatments();
  const [editingDentist, setEditingDentist] = useState<EditableDentist | null>(null);
  const [adding, setAdding] = useState(false);
  const [leaveFor, setLeaveFor] = useState<EditableDentist | null>(null);

  return (
    <div className="staff-container">
      <div className="staff-page-header">
        <div>
          <h2>ทันตแพทย์ &amp; เวรตรวจ</h2>
          <p>ชื่อ รูป และคำแนะนำตัวที่นี่ จะแสดงบนหน้าเว็บคนไข้ทันที</p>
        </div>
        <button type="button" className="btn-secondary-staff btn-lg" onClick={() => setAdding(true)}>
          <IconPlus size={17} />
          <span>เพิ่มทันตแพทย์</span>
        </button>
      </div>

      <div className="ledger-table doc-list" role="table" aria-label="ทันตแพทย์">
        <div className="ledger-head doc-grid" role="row">
          <span role="columnheader">ทันตแพทย์</span>
          <span role="columnheader">วันออกตรวจ</span>
          <span role="columnheader">รับนัดออนไลน์</span>
          <span role="columnheader" aria-label="วันลาและแก้ไข" />
        </div>

        {dentists.map((d) => {
          const on = (wd: number) => d.shifts?.find((s) => s.weekday === wd)?.enabled ?? false;
          const hours = (wd: number) => {
            const s = d.shifts?.find((x) => x.weekday === wd);
            return s?.enabled ? `${s.start}–${s.end} น.` : "หยุด";
          };
          const treats = d.treats.map((k) => tr.name(k)).join(" · ");
          const ages = Object.values(d.treatAges ?? {});
          const kidsOnly = ages.filter((v) => v === "kids").length;
          const adultsOnly = ages.filter((v) => v === "adults").length;
          const upcoming = dentistLeaves.filter((l) => l.dentistSlug === d.slug && l.end >= today);
          const nextLeave = upcoming.at(0);
          const moreLeaves = upcoming.length - 1;
          return (
            <div key={d.slug} className={`ledger-row doc-grid ${d.isActive ? "" : "inactive"}`} role="row">
              <div className="doc-who" role="cell">
                <span className={`doc-avatar tint-${d.isActive ? d.tint : "off"}`} aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element -- shared with the desktop app, which has no next/image */}
                  {d.photo.small ? <img src={d.photo.small} alt="" /> : d.text.th.name.split(" ")[1]?.[0] || "ท"}
                </span>
                <span className="doc-text">
                  <span className="doc-name">{d.text.th.name}</span>
                  <span className="doc-sub">
                    {d.text.th.title} · ประสบการณ์ {d.years} ปี
                  </span>
                  {treats ? (
                    <span className="doc-treats" title={treats}>
                      รับตรวจ: {treats}
                    </span>
                  ) : null}
                  {kidsOnly + adultsOnly > 0 ? (
                    <span className="doc-treats">
                      {kidsOnly > 0 ? `เด็กเท่านั้น ${kidsOnly} รายการ` : ""}
                      {kidsOnly > 0 && adultsOnly > 0 ? " · " : ""}
                      {adultsOnly > 0 ? `ผู้ใหญ่เท่านั้น ${adultsOnly} รายการ` : ""}
                    </span>
                  ) : null}
                </span>
              </div>

              <div className="doc-days" role="cell">
                <div className="week-strip" aria-label="วันออกตรวจ">
                  {WEEK.map((w, wd) => (
                    <span key={w} className={on(wd) ? "on" : ""} title={`${w} · ${hours(wd)}`}>
                      {w}
                    </span>
                  ))}
                </div>
                {nextLeave ? (
                  <span className="doc-leave-tag">
                    ลา {fmtHolidayRange(nextLeave)}
                    {moreLeaves > 0 ? ` +${moreLeaves}` : ""}
                  </span>
                ) : null}
              </div>

              <label className="doc-toggle" role="cell">
                <input
                  type="checkbox"
                  checked={d.isActive}
                  onChange={(e) => updateDentist(d.slug, { isActive: e.target.checked })}
                />
                <span>{d.isActive ? "เปิดรับ" : "พักงาน"}</span>
              </label>

              <div role="cell" className="doc-actions">
                <button type="button" className="btn-secondary-staff" onClick={() => setLeaveFor(d)}>
                  <IconCalendar size={14} />
                  <span>วันลา</span>
                </button>
                <button type="button" className="btn-secondary-staff" onClick={() => setEditingDentist(d)}>
                  <IconEdit size={14} />
                  <span>แก้ไข</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="ledger-note">
        “วันลา” ปิดรับนัดออนไลน์ของคุณหมอในวันที่เลือก · เวลาเข้าเวร รูป และคำแนะนำตัว แก้ได้ในปุ่ม “แก้ไข” · วันหยุดทั้งคลินิกอยู่ในเมนู “เวลาทำการ &amp; วันหยุด”
      </p>

      {editingDentist && (
        <EditDentistModal dentist={editingDentist} onClose={() => setEditingDentist(null)} />
      )}
      {adding && <EditDentistModal dentist={null} onClose={() => setAdding(false)} />}
      {leaveFor && <DentistLeaveModal dentist={leaveFor} onClose={() => setLeaveFor(null)} />}
    </div>
  );
}
