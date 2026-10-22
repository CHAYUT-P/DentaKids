"use client";

import React, { useEffect, useState } from "react";
import { useStaff, type PatientChild, type PatientRecord } from "@/lib/staffStore";
import { normalizeName } from "@/lib/clinicSettings";
import { useT } from "@/i18n/lang";
import { fmtLong } from "@/lib/dates";
import { COVERAGE_LABEL, asCoverage } from "@/lib/billing";
import { initial } from "@/lib/roles";
import { BookingModal } from "@/components/staff/schedule/BookingModal";
import {
  PatientForm,
  ageOf,
  blankForm,
  formFromRecord,
  toPatientPayload,
  type PatientFormState,
} from "@/components/staff/patients/PatientForm";
import { EditionNotice } from "@/components/staff/shell/DeviceGate";
import { NoAccess, useStaffUser } from "@/lib/staffUser";
import { PatientFileButton } from "@/components/staff/patients/PatientFileView";
import { RecallList } from "@/components/staff/patients/RecallList";
import {
  IconSearch,
  IconPlus,
  IconCalendar,
  IconX,
  IconEdit,
} from "@/components/staff/shell/staffIcons";

function StaffPatientsPageInner() {
  const { today, patients, createPatient, updatePatient, appointments, showToast, loadHistory } = useStaff();
  // each patient's visit list needs the full history
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);
  const dict = useT();
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bookingForChild, setBookingForChild] = useState<{
    childName: string;
    childAge?: number;
    guardianName: string;
    phone: string;
    forSelf?: boolean;
  } | null>(null);
  const [tab, setTab] = useState<"all" | "child" | "self">("all");
  const [mode, setMode] = useState<"records" | "recalls">("records");

  /** patient-centric rows: one row per patient (child), plus one row per
   *  adult self-booking record — each carrying its guardian info */
  const rows = patients.flatMap((family) =>
    (family.guardianRelation ?? "") === "ตนเอง" || family.children.length === 0
      ? [{ family, child: null as PatientChild | null }]
      : family.children.map((child) => ({ family, child: child as PatientChild | null })),
  );

  const filteredRows = rows.filter(({ family: p, child: c }) => {
    if (tab === "child" && c == null) return false;
    if (tab === "self" && c != null) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const childHit =
      c != null &&
      (c.name.toLowerCase().includes(q) ||
        (c.nickname && c.nickname.toLowerCase().includes(q)) ||
        (c.fullName && c.fullName.toLowerCase().includes(q)) ||
        (c.hn && c.hn.toLowerCase().includes(q)));
    return (
      childHit ||
      p.guardianName.toLowerCase().includes(q) ||
      (p.guardianFullName ?? "").toLowerCase().includes(q) ||
      p.phone.includes(q) ||
      (p.lineId ?? "").toLowerCase().includes(q)
    );
  });

  const childCount = rows.filter((r) => r.child != null).length;
  const selfCount = rows.filter((r) => r.child == null).length;

  /** visits for THIS patient (matched by phone + normalized name), not the
   *  whole family's bookings */
  const visitsFor = (p: PatientRecord, c: PatientChild | null) => {
    const digits = p.phone.replace(/[^0-9]/g, "");
    return appointments.filter((a) => {
      if (a.phone.replace(/[^0-9]/g, "") !== digits) return false;
      if (c == null) return true;
      return normalizeName(a.childName) === normalizeName(c.name);
    });
  };

  const rowIncomplete = (p: PatientRecord, c: PatientChild | null): boolean => {
    if (!p.guardianFullName?.trim() || !p.phone.trim()) return true;
    if (c == null) return false;
    return !c.fullName?.trim() || (!c.birthdate && c.age == null);
  };

  const bookFor = (p: PatientRecord, c: PatientChild | null, age?: number) => {
    if (c) {
      setBookingForChild({
        childName: c.name,
        childAge: age,
        guardianName: p.guardianName,
        phone: p.phone,
      });
    } else {
      setBookingForChild({
        childName: p.guardianFullName || p.guardianName,
        childAge: undefined,
        guardianName: p.guardianFullName || p.guardianName,
        phone: p.phone,
        forSelf: true,
      });
    }
  };

  const toPayload = toPatientPayload;

  const handleAdd = (s: PatientFormState) => {
    createPatient(toPayload(s));
    setShowAddModal(false);
    showToast("บันทึกประวัติคนไข้เรียบร้อยแล้ว");
  };

  const handleEdit = (s: PatientFormState) => {
    if (!editingId) return;
    updatePatient(editingId, toPayload(s));
    setEditingId(null);
    showToast("อัปเดตประวัติคนไข้เรียบร้อยแล้ว");
  };

  const editing = editingId ? patients.find((p) => p.id === editingId) ?? null : null;

  return (
    <div className="staff-container">
      <div className="staff-page-header">
        <div>
          <h2>คนไข้</h2>
          <p>แตะชื่อเพื่อเปิดแฟ้ม (ชาร์ตฟัน แผนการรักษา ประวัติ เอกสาร) — คนที่จองออนไลน์มามีแค่ชื่อเล่นกับเบอร์ เปิดแฟ้มแล้วกรอกเพิ่มได้</p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <div className="staff-pill-group">
            <button type="button" className={`staff-pill-btn ${mode === "records" ? "active" : ""}`} onClick={() => setMode("records")}>
              รายชื่อคนไข้
            </button>
            <button type="button" className={`staff-pill-btn ${mode === "recalls" ? "active" : ""}`} onClick={() => setMode("recalls")}>
              ถึงรอบตรวจ
            </button>
          </div>
          <button
            type="button"
            className="btn-primary-staff"
            onClick={() => setShowAddModal(true)}
          >
            <IconPlus size={16} />
            <span>ลงทะเบียนคนไข้ใหม่</span>
          </button>
        </div>
      </div>

      {mode === "recalls" ? <RecallList /> : null}
      <div hidden={mode !== "records"}>
      {/* Search + type tabs */}
      <div className="staff-toolbar" style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <div className="staff-search-box" style={{ width: "350px" }}>
          <IconSearch size={15} color="var(--staff-ink-muted)" />
          <input
            type="search"
            placeholder="ค้นหาชื่อเด็ก, ชื่อจริง, HN, ผู้ปกครอง, LINE, เบอร์โทร..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="staff-pill-group" style={{ width: "fit-content" }}>
          <button
            type="button"
            className={`staff-pill-btn ${tab === "all" ? "active" : ""}`}
            onClick={() => setTab("all")}
          >
            ทั้งหมด ({rows.length})
          </button>
          <button
            type="button"
            className={`staff-pill-btn ${tab === "child" ? "active" : ""}`}
            onClick={() => setTab("child")}
          >
            เด็ก ({childCount})
          </button>
          <button
            type="button"
            className={`staff-pill-btn ${tab === "self" ? "active" : ""}`}
            onClick={() => setTab("self")}
          >
            ผู้ใหญ่จองเอง ({selfCount})
          </button>
        </div>
      </div>

      {/* one row per patient — tap it to open their file */}
      {filteredRows.length === 0 ? (
        <div className="staff-empty">
          {search.trim() ? "ไม่พบคนไข้ที่ค้นหา" : "ยังไม่มีคนไข้ — กด “ลงทะเบียนคนไข้ใหม่” หรือนำเข้าจากโปรแกรมเดิมในตั้งค่า"}
        </div>
      ) : (
        <div className="pt-list" role="list">
          {filteredRows.map(({ family: p, child: c }) => {
            const visits = visitsFor(p, c);
            const last = visits.reduce<string | null>((best, a) => (a.status !== "cancelled" && (!best || a.date > best) ? a.date : best), null);
            const age = c ? ageOf(c, today) : undefined;
            const name = c ? c.name : p.guardianFullName || p.guardianName;
            const allergy = c?.allergies && c.allergies !== "ไม่มี" ? c.allergies : "";
            const cover = c?.coverage && c.coverage !== "cash" ? COVERAGE_LABEL[asCoverage(c.coverage)] : "";
            return (
              <div key={c ? `${p.id}:${c.id}` : `${p.id}:self`} className="pt-row" role="listitem">
                <PatientFileButton
                  childId={c ? Number(c.id) : undefined}
                  phone={p.phone}
                  name={name}
                  className="pt-open"
                >
                  <span className="pt-avatar" aria-hidden="true">
                    {initial(name)}
                  </span>
                  <span className="pt-main">
                    <strong>{name}</strong>
                    <em>
                      {[c?.fullName, age != null ? `${age} ปี` : "", c?.hn ? `HN ${c.hn}` : ""].filter(Boolean).join(" · ") || "ยังไม่มีชื่อจริง / วันเกิด"}
                    </em>
                  </span>
                  <span className="pt-guard">
                    {c ? `${p.guardianFullName || p.guardianName}${p.guardianRelation ? ` (${p.guardianRelation})` : ""}` : "จองให้ตัวเอง"}
                    <em>{p.phone}</em>
                  </span>
                  <span className="pt-visits">
                    {visits.length ? `มา ${visits.length} ครั้ง` : "ยังไม่เคยมา"}
                    <em>{last ? `ล่าสุด ${fmtLong(dict, last, "th")}` : ""}</em>
                  </span>
                  <span className="pt-flags">
                    {allergy ? <span className="pt-flag danger">แพ้ {allergy}</span> : null}
                    {cover ? <span className="pt-flag cover">{cover}</span> : null}
                    {rowIncomplete(p, c) ? <span className="pt-flag todo">ข้อมูลยังไม่ครบ</span> : null}
                  </span>
                </PatientFileButton>
                <span className="pt-actions">
                  <button type="button" className="btn-secondary-staff" onClick={() => bookFor(p, c, age)}>
                    <IconCalendar size={14} /> นัด
                  </button>
                  <button type="button" className="btn-secondary-staff" onClick={() => setEditingId(p.id)}>
                    <IconEdit size={14} /> แก้ไข
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      </div>

      {/* Add Patient Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-card modal-card-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>ลงทะเบียนคนไข้และครอบครัวใหม่</h3>
              <button type="button" className="btn-action-icon" onClick={() => setShowAddModal(false)}>
                <IconX size={16} />
              </button>
            </div>

            <PatientForm
              key="new"
              initial={blankForm()}
              submitLabel="บันทึกประวัติคนไข้"
              onSubmit={handleAdd}
              onCancel={() => setShowAddModal(false)}
            />
          </div>
        </div>
      )}

      {/* Edit Patient Modal */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditingId(null)}>
          <div className="modal-card modal-card-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>แก้ไขประวัติ: {editing.guardianFullName || editing.guardianName}</h3>
              <button type="button" className="btn-action-icon" onClick={() => setEditingId(null)}>
                <IconX size={16} />
              </button>
            </div>

            <PatientForm
              key={editing.id}
              initial={formFromRecord(editing)}
              submitLabel="บันทึกการแก้ไข"
              onSubmit={handleEdit}
              onCancel={() => setEditingId(null)}
            />
          </div>
        </div>
      )}

      {/* Booking Modal pre-filled with the picked patient */}
      {bookingForChild && (
        <BookingModal
          initialChildName={bookingForChild.childName}
          initialChildAge={bookingForChild.childAge}
          initialGuardianName={bookingForChild.guardianName}
          initialPhone={bookingForChild.phone}
          initialForSelf={bookingForChild.forSelf}
          onClose={() => setBookingForChild(null)}
        />
      )}
    </div>
  );
}

/**
 * Patient records are a full-edition feature — the lean "queue" install keeps
 * the route mounted (old links don't 404) but shows the upgrade note.
 */
export default function StaffPatientsPage() {
  const { edition } = useStaff();
  const allowed = useStaffUser().can("patients");
  if (edition !== "full") return <EditionNotice feature="ประวัติคนไข้" />;
  if (!allowed) return <NoAccess what="ทะเบียนคนไข้" />;
  return <StaffPatientsPageInner />;
}
