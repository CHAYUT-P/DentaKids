"use client";

import React, { useState } from "react";
import { useTreatments } from "@/lib/treatmentsContext";
import { useStaff, type StaffAppointment } from "@/lib/staffStore";
import { useT } from "@/i18n/lang";
import { fmtLong, thaiDate } from "@/lib/dates";
import { timeRange } from "@/lib/slots";
import {
  IconX,
  IconCheck,
  IconPhone,
  IconClock,
  IconEdit,
  IconSmartphone,
  IconWalkIn,
  IconUsers,
  IconServices,
  IconDentist,
  IconDollar,
} from "@/components/staff/shell/staffIcons";
import { PatientFileButton } from "@/components/staff/patients/PatientFileView";
import { AgeTag } from "@/components/staff/shell/AgeTag";
import { CallFamilyNotice } from "@/components/staff/shell/CallFamilyNotice";

/** quick reasons the desk can drop into the message to the family */
const REASONS = ["คุณหมอติดธุระ", "คุณหมอลา", "คลินิกปิดทำการ"];

/**
 * The "tell the family" box under cancel / postpone / message. A booking made
 * from LINE gets a ticked box and an editable message that goes straight to
 * the family's LINE chat; any other booking shows the number to call.
 */
function LineCompose({
  hasLine,
  phone,
  send,
  onSend,
  text,
  onText,
  reason,
  onReason,
  alwaysOn = false,
}: {
  hasLine: boolean;
  phone: string;
  send: boolean;
  onSend: (v: boolean) => void;
  text: string;
  onText: (v: string) => void;
  reason?: string;
  onReason?: (v: string) => void;
  alwaysOn?: boolean;
}) {
  if (!hasLine) {
    return <CallFamilyNotice phone={phone} />;
  }
  return (
    <div className="line-compose">
      {alwaysOn ? (
        <span className="lc-title">ข้อความถึงผู้ปกครองทาง LINE</span>
      ) : (
        <label className="lc-check">
          <input type="checkbox" checked={send} onChange={(e) => onSend(e.target.checked)} />
          <span>แจ้งผู้ปกครองทาง LINE</span>
        </label>
      )}
      {send || alwaysOn ? (
        <>
          {onReason ? (
            <div className="lc-reasons">
              <span>เหตุผล:</span>
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`lc-chip ${reason === r ? "on" : ""}`}
                  onClick={() => onReason(reason === r ? "" : r)}
                >
                  {r}
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            className="form-control"
            rows={5}
            aria-label="ข้อความถึงผู้ปกครอง"
            value={text}
            onChange={(e) => onText(e.target.value)}
          />
        </>
      ) : null}
    </div>
  );
}

interface AppointmentDetailModalProps {
  appointment: StaffAppointment;
  onClose: () => void;
}

export function AppointmentDetailModal({
  appointment,
  onClose,
}: AppointmentDetailModalProps) {
  const { edition, today, dentists, patients, updateStatus, setQueueStatus, rescheduleAppointment, updateAppointment, assignDentist, createPatient, showToast, messageFamily, onLeave } = useStaff();
  const tr = useTreatments();
  const dict = useT();

  /** which panel is open under the details: postpone, cancel, or a free message */
  const [panel, setPanel] = useState<"reschedule" | "cancel" | "message" | null>(null);
  const [newDate, setNewDate] = useState(appointment.date);
  const [newTime, setNewTime] = useState(appointment.time);
  const [newDentist, setNewDentist] = useState(appointment.dentistSlug);
  const [editNotes, setEditNotes] = useState(appointment.notes || "");
  const [copied, setCopied] = useState(false);

  const hasLine = !!appointment.hasLine;
  const [notify, setNotify] = useState(hasLine);
  const [reason, setReason] = useState("");
  /** null = the staff haven't typed — the message follows the template */
  const [typed, setTyped] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const dentist = dentists.find((d) => d.slug === appointment.dentistSlug);
  const treatmentName = tr.name(appointment.treatmentKey);
  const day = (iso: string) => `วัน${fmtLong(dict, iso, "th")}`;
  const newDentistName = dentists.find((d) => d.slug === newDentist)?.text.th.name;
  const newDateLeave = newDentist ? onLeave(newDentist, newDate) : undefined;

  const template =
    panel === "cancel"
      ? `คลินิก Denta Kids ขออภัยค่ะ ขอยกเลิกนัดของ ${appointment.childName}\n` +
        `${day(appointment.date)} เวลา ${appointment.time} น. (${treatmentName})\n` +
        (reason ? `เนื่องจาก${reason}\n` : "") +
        `จองวันใหม่ได้ที่เมนูจองนัดใน LINE นี้ หรือติดต่อคลินิกได้เลยค่ะ ขอบคุณค่ะ`
      : panel === "reschedule"
        ? `คลินิก Denta Kids ขอแจ้งเลื่อนนัดของ ${appointment.childName}` +
          (reason ? ` เนื่องจาก${reason}` : "") +
          `\nจาก ${day(appointment.date)} เวลา ${appointment.time} น.` +
          `\nเป็น ${day(newDate)} เวลา ${newTime} น.` +
          (newDentist !== appointment.dentistSlug && newDentistName ? `\nกับ ${newDentistName}` : "") +
          `\nหากไม่สะดวก ติดต่อคลินิกได้เลยค่ะ ขอบคุณค่ะ`
        : `คลินิก Denta Kids ขอเตือนนัดของ ${appointment.childName}\n` +
          `${day(appointment.date)} เวลา ${appointment.time} น. (${treatmentName})` +
          (dentist ? ` กับ ${dentist.text.th.name}` : "") +
          `\nกรุณามาถึงก่อนเวลา 10 นาทีนะคะ`;
  const message = typed ?? template;

  const openPanel = (p: typeof panel) => {
    setPanel(p);
    setReason("");
    setTyped(null);
    setNotify(hasLine);
  };

  /** online bookings arrive with only name + tel — match them to the patient
   *  file by phone number (dashes/spaces ignored) */
  const digitsOnly = (s: string) => s.replace(/[^0-9]/g, "");
  const linkedPatient = patients.find(
    (p) => digitsOnly(p.phone) === digitsOnly(appointment.phone),
  );

  /** first visit: create the real patient record from this booking's contact,
   *  staff fills in the full file on the Patients page afterwards. Adult
   *  self-bookings become a "ตนเอง" record with no child rows. */
  const handleRegisterPatient = () => {
    if (appointment.forSelf) {
      createPatient({
        guardianName: appointment.guardianName,
        guardianRelation: "ตนเอง",
        phone: appointment.phone,
        children: [],
      });
    } else {
      createPatient({
        guardianName: appointment.guardianName,
        phone: appointment.phone,
        children: [
          {
            id: `c-${Date.now()}`,
            name: appointment.childName,
          },
        ],
      });
    }
    showToast("สร้างประวัติคนไข้แล้ว — กรอกรายละเอียดเพิ่มที่หน้าประวัติคนไข้");
  };

  const handleComplete = () => {
    updateStatus(appointment.id, "completed");
    onClose();
  };

  const handleCancel = () => {
    updateStatus(appointment.id, "cancelled");
    if (hasLine && notify && message.trim()) void messageFamily(appointment.id, message);
    onClose();
  };

  const handleSendMessage = async () => {
    if (!message.trim()) return;
    setSending(true);
    const result = await messageFamily(appointment.id, message);
    setSending(false);
    if (result === "sent") setPanel(null);
  };

  /** one-tap queue moves — check-in stamps the clinic clock on the server */
  const queueMove = (status: "arrived" | "in_chair" | "completed" | "no_show") => {
    setQueueStatus(appointment.id, status);
    onClose();
  };

  const handleSaveReschedule = () => {
    const moved = newDate !== appointment.date || newTime !== appointment.time;
    if (appointment.dentistId === null && newDentist && !moved) {
      // same slot, first dentist: guarded assign rejects a taken chair
      assignDentist(appointment.id, newDentist);
    } else {
      rescheduleAppointment(appointment.id, newDate, newTime, newDentist);
    }
    if (editNotes !== appointment.notes) {
      updateAppointment(appointment.id, { notes: editNotes.trim() });
    }
    const changed = moved || newDentist !== appointment.dentistSlug;
    if (changed && hasLine && notify && message.trim()) void messageFamily(appointment.id, message);
    setPanel(null);
    onClose();
  };

  /** a booking without LINE: copy the reminder to paste into a chat by hand */
  const copyReminderText = () => {
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const times = [
    "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
    "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00"
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-lg" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header" style={{ padding: "18px 24px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <h3 style={{ fontSize: "19px", fontWeight: "700" }}>รายละเอียดนัดหมาย</h3>
              <span
                className={`status-pill ${appointment.status}`}
                style={{ fontSize: "12px", padding: "3px 10px", fontWeight: "600" }}
              >
                {appointment.status === "confirmed" && "ยืนยันแล้ว"}
                {appointment.status === "arrived" && "เช็คอินแล้ว"}
                {appointment.status === "in_chair" && "กำลังตรวจ"}
                {appointment.status === "completed" && "ตรวจเสร็จสิ้น"}
                {appointment.status === "cancelled" && "ยกเลิกแล้ว"}
                {appointment.status === "no_show" && "ไม่มาตามนัด"}
              </span>
              {appointment.forSelf && (
                <span
                  style={{
                    fontSize: "12px",
                    padding: "3px 10px",
                    fontWeight: "700",
                    color: "var(--staff-primary)",
                    background: "var(--staff-primary-light)",
                    borderRadius: "999px",
                    whiteSpace: "nowrap",
                  }}
                >
                  จองให้ตัวเอง (ผู้ใหญ่)
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: "13px",
                color: "var(--staff-ink-muted)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginTop: "4px",
                flexWrap: "wrap",
              }}
            >
              <span>
                รหัสนัด: <strong style={{ color: "var(--staff-primary)" }}>{appointment.ref}</strong>
              </span>
              <span>·</span>
              <span>ช่องทาง:</span>
              <span className={`source-badge ${appointment.source}`} style={{ padding: "2px 7px", fontSize: "11px" }}>
                {appointment.source === "online" && (
                  <>
                    <IconSmartphone size={12} />
                    <span>{appointment.lineName ? "LINE" : "ออนไลน์"}</span>
                  </>
                )}
                {appointment.source === "phone" && (
                  <>
                    <IconPhone size={12} />
                    <span>โทรศัพท์</span>
                  </>
                )}
                {appointment.source === "walkin" && (
                  <>
                    <IconWalkIn size={12} />
                    <span>หน้าร้าน</span>
                  </>
                )}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn-action-icon"
            onClick={onClose}
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body" style={{ padding: "22px 24px", gap: "18px" }}>
          {/* Main Info Card */}
          <div
            style={{
              background: "linear-gradient(180deg, #fafafa 0%, #f4f4f5 100%)",
              padding: "22px 24px",
              borderRadius: "16px",
              border: "1.5px solid #e4e4e7",
              display: "flex",
              flexDirection: "column",
              gap: "18px",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.03)",
            }}
          >
            {/* Top row: Patient Profile & Quick Call */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "14px",
                    background: "var(--staff-primary-light)",
                    color: "var(--staff-primary)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: "20px",
                    fontWeight: "800",
                    flex: "none",
                    border: "1px solid #e4e4e7",
                  }}
                >
                  {appointment.childName.replace(/^(น้อง|ด\.ช\.|ด\.ญ\.)/, "")[0] || appointment.childName[0]}
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "20px", fontWeight: "800", color: "var(--staff-ink)" }}>
                      {appointment.childName}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "13.5px",
                      color: "var(--staff-ink-2)",
                      marginTop: "3px",
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    <span>{appointment.phone}</span>
                    <AgeTag group={appointment.ageGroup} />
                    {appointment.lineName ? (
                      <span className="line-tag" title="จองผ่าน LINE">
                        LINE · {appointment.lineName}
                      </span>
                    ) : appointment.source === "online" ? (
                      <span style={{ color: "var(--staff-ink-muted)" }}>· จองผ่านเว็บ (ไม่ได้เข้าผ่าน LINE)</span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <PatientFileButton phone={appointment.phone} name={appointment.childName} />
              <a
                href={`tel:${appointment.phone.replace(/[^0-9]/g, "")}`}
                className="btn-secondary-staff"
                style={{
                  textDecoration: "none",
                  padding: "8px 16px",
                  fontSize: "14px",
                  fontWeight: "600",
                  borderRadius: "10px",
                  background: "#ffffff",
                  border: "1.5px solid #e4e4e7",
                  color: "var(--staff-primary)",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <IconPhone size={15} />
                <span>{appointment.phone}</span>
              </a>
              </div>
            </div>

            {/* 4 detail tiles in a 2x2 grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "12px",
              }}
            >
              {/* Tile 1: Treatment */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "12px",
                  padding: "12px 16px",
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.02)",
                }}
              >
                <div
                  style={{
                    fontSize: "11.5px",
                    fontWeight: "600",
                    color: "var(--staff-ink-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    marginBottom: "4px",
                  }}
                >
                  <IconServices size={13} color="var(--staff-primary)" />
                  <span>การรักษา / หัตถการ</span>
                </div>
                <strong style={{ fontSize: "15px", color: "var(--staff-ink)", display: "block" }}>
                  {treatmentName}
                </strong>
              </div>

              {/* Tile 2: Dentist */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "12px",
                  padding: "12px 16px",
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.02)",
                }}
              >
                <div
                  style={{
                    fontSize: "11.5px",
                    fontWeight: "600",
                    color: "var(--staff-ink-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    marginBottom: "4px",
                  }}
                >
                  <IconDentist size={13} color="var(--staff-primary)" />
                  <span>ทันตแพทย์</span>
                </div>
                <strong style={{ fontSize: "15px", color: "var(--staff-ink)", display: "block" }}>
                  {appointment.dentistId === null ? (
                    <span
                      style={{
                        fontSize: "12.5px",
                        fontWeight: 700,
                        color: "#8a6d00",
                        background: "#fff9db",
                        border: "1px solid #ffd43b",
                        padding: "2px 10px",
                        borderRadius: "999px",
                      }}
                    >
                      รอจัดแพทย์ (จองแบบไม่เลือกแพทย์)
                    </span>
                  ) : (
                    dentist?.text.th.name || "แพทย์ทั่วไป"
                  )}
                </strong>
              </div>

              {/* Tile 3: Date & Time */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "12px",
                  padding: "12px 16px",
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.02)",
                }}
              >
                <div
                  style={{
                    fontSize: "11.5px",
                    fontWeight: "600",
                    color: "var(--staff-ink-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    marginBottom: "4px",
                  }}
                >
                  <IconClock size={13} color="#2b8a3e" />
                  <span>วันและเวลานัดหมาย</span>
                </div>
                <strong style={{ fontSize: "15px", color: "#2b8a3e", display: "block" }}>
                  {thaiDate(appointment.date)} · {timeRange(appointment.time, appointment.durationMin)} น.
                </strong>
              </div>

              {/* Tile 4: Estimated Price */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "12px",
                  padding: "12px 16px",
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.02)",
                }}
              >
                <div
                  style={{
                    fontSize: "11.5px",
                    fontWeight: "600",
                    color: "var(--staff-ink-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    marginBottom: "4px",
                  }}
                >
                  <IconDollar size={13} color="var(--staff-primary)" />
                  <span>ราคาประเมิน</span>
                </div>
                <strong
                  style={{
                    fontSize: "16.5px",
                    color: "var(--staff-primary)",
                    display: "block",
                    fontWeight: "800",
                  }}
                >
                  {appointment.price ? `฿${appointment.price.toLocaleString()}` : "ตรวจประเมิน"}
                </strong>
              </div>
            </div>
          </div>

          {/* Patient record (full edition only): online bookings are name + tel only */}
          {edition !== "full" ? null : linkedPatient ? (
            <div
              style={{
                background: "#ebfbee",
                border: "1.5px solid #b2d8b2",
                borderRadius: "14px",
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "10px",
                  background: "#ffffff",
                  color: "#2b8a3e",
                  display: "grid",
                  placeItems: "center",
                  flex: "none",
                  border: "1px solid #b2d8b2",
                }}
              >
                <IconUsers size={17} />
              </span>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#2b8a3e" }}>
                  มีประวัติคนไข้แล้ว: {linkedPatient.guardianName}
                </div>
                <div style={{ fontSize: "12.5px", color: "var(--staff-ink-2)", marginTop: "2px" }}>
                  {(linkedPatient.guardianRelation ?? "") === "ตนเอง" || linkedPatient.children.length === 0
                    ? "คนไข้ผู้ใหญ่ (จองให้ตัวเอง)"
                    : `เด็กในความดูแล ${linkedPatient.children.length} คน (${linkedPatient.children.map((c) => c.name).join(", ")})`}
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                background: "#fff9db",
                border: "1.5px solid #ffd43b",
                borderRadius: "14px",
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "10px",
                  background: "#ffffff",
                  color: "#e8a30c",
                  display: "grid",
                  placeItems: "center",
                  flex: "none",
                  border: "1px solid #ffd43b",
                }}
              >
                <IconSmartphone size={17} />
              </span>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--staff-ink)" }}>
                  {appointment.forSelf
                    ? "จองให้ตัวเอง (ผู้ใหญ่) — ยังไม่มีประวัติคนไข้"
                    : "จองออนไลน์เข้ามาแค่ชื่อ + เบอร์ — ยังไม่มีประวัติคนไข้"}
                </div>
                <div style={{ fontSize: "12.5px", color: "var(--staff-ink-2)", marginTop: "2px" }}>
                  {appointment.forSelf
                    ? "กดสร้างประวัติแล้วไปกรอกชื่อจริงที่หน้าประวัติคนไข้"
                    : "ถ้ามาครั้งแรก กดสร้างประวัติแล้วไปกรอกอายุ / แพ้ยา / หมายเหตุที่หน้าประวัติคนไข้"}
                </div>
              </div>
              <button
                type="button"
                className="btn-primary-staff"
                style={{ padding: "8px 16px", fontSize: "13px", fontWeight: "700", flex: "none" }}
                onClick={handleRegisterPatient}
              >
                <IconCheck size={15} />
                <span>สร้างประวัติคนไข้ครั้งแรก</span>
              </button>
            </div>
          )}

          {/* Reschedule / Cancel / Message panel, or the quick actions */}
          {panel === "cancel" ? (
            <div className="appt-panel danger">
              <div className="ap-title">ยกเลิกนัดของ {appointment.childName}</div>
              <LineCompose
                hasLine={hasLine}
                phone={appointment.phone}
                send={notify}
                onSend={setNotify}
                text={message}
                onText={setTyped}
                reason={reason}
                onReason={(r) => {
                  setReason(r);
                  setTyped(null);
                }}
              />
              <div className="ap-actions">
                <button type="button" className="btn-secondary-staff" onClick={() => setPanel(null)}>
                  ไม่ยกเลิก
                </button>
                <button type="button" className="btn-primary-staff danger" onClick={handleCancel}>
                  <IconX size={15} />
                  <span>{hasLine && notify ? "ยกเลิกนัดและส่งข้อความ" : "ยืนยันยกเลิกนัด"}</span>
                </button>
              </div>
            </div>
          ) : panel === "message" ? (
            <div className="appt-panel">
              <LineCompose
                hasLine={hasLine}
                phone={appointment.phone}
                send
                onSend={() => {}}
                text={message}
                onText={setTyped}
                alwaysOn
              />
              <div className="ap-actions">
                <button type="button" className="btn-secondary-staff" onClick={() => setPanel(null)}>
                  ปิด
                </button>
                <button
                  type="button"
                  className="btn-primary-staff"
                  disabled={sending || !message.trim()}
                  onClick={handleSendMessage}
                >
                  <IconSmartphone size={15} />
                  <span>{sending ? "กำลังส่ง…" : "ส่งทาง LINE"}</span>
                </button>
              </div>
            </div>
          ) : panel === "reschedule" ? (
            <div
              style={{
                border: "1.5px solid var(--staff-primary)",
                background: "var(--staff-primary-light)",
                borderRadius: "14px",
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div style={{ fontWeight: "700", fontSize: "14.5px", color: "var(--staff-primary)" }}>
                เลื่อนวัน/เวลานัดหมาย
              </div>
              <div className="form-row-2">
                <div className="form-group">
                  <label>วันที่ใหม่</label>
                  <input
                    type="date"
                    className="form-control"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>เวลาใหม่</label>
                  <select
                    className="form-control"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                  >
                    {times.map((t) => (
                      <option key={t} value={t}>
                        {t} น.
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>เปลี่ยนแพทย์</label>
                <select
                  className="form-control"
                  value={newDentist}
                  onChange={(e) => setNewDentist(e.target.value)}
                >
                  {appointment.dentistId === null ? (
                    <option value="">— รอจัดแพทย์ (ยังไม่เลือก) —</option>
                  ) : null}
                  {dentists.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.text.th.name}
                    </option>
                  ))}
                </select>
              </div>
              {newDateLeave ? (
                <div className="ap-warn">
                  {newDentistName} ลาวันนี้{newDateLeave.note ? ` (${newDateLeave.note})` : ""} — เลือกวันอื่นหรือแพทย์ท่านอื่น
                </div>
              ) : null}
              <LineCompose
                hasLine={hasLine}
                phone={appointment.phone}
                send={notify}
                onSend={setNotify}
                text={message}
                onText={setTyped}
                reason={reason}
                onReason={(r) => {
                  setReason(r);
                  setTyped(null);
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
                <button
                  type="button"
                  className="btn-secondary-staff"
                  onClick={() => setPanel(null)}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  className="btn-primary-staff"
                  onClick={handleSaveReschedule}
                >
                  {hasLine && notify ? "บันทึกและส่งข้อความ" : "บันทึกการเลื่อนนัด"}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                className="btn-secondary-staff"
                style={{
                  flex: 1,
                  justifyContent: "center",
                  padding: "10px 16px",
                  fontSize: "13.5px",
                  fontWeight: "600",
                }}
                onClick={() => openPanel("reschedule")}
              >
                <IconEdit size={15} />
                <span>เลื่อนนัดหมาย</span>
              </button>
              <button
                type="button"
                className="btn-secondary-staff"
                style={{
                  flex: 1,
                  justifyContent: "center",
                  padding: "10px 16px",
                  fontSize: "13.5px",
                  fontWeight: "600",
                }}
                onClick={hasLine ? () => openPanel("message") : copyReminderText}
              >
                {hasLine ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <IconSmartphone size={15} />
                    <span>ส่งข้อความทาง LINE</span>
                  </span>
                ) : copied ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#2b8a3e" }}>
                    <IconCheck size={15} color="#2b8a3e" />
                    <span>คัดลอกข้อความแล้ว</span>
                  </span>
                ) : (
                  <span>คัดลอกข้อความเตือน</span>
                )}
              </button>
            </div>
          )}

          {/* Notes */}
          <div className="form-group">
            <label style={{ fontSize: "13.5px", fontWeight: "600" }}>บันทึกของคลินิก</label>
            <textarea
              className="form-control"
              rows={3}
              style={{ fontSize: "14px", lineHeight: "1.5", padding: "10px 12px" }}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              onBlur={() => {
                if (editNotes !== appointment.notes) {
                  updateAppointment(appointment.id, { notes: editNotes.trim() });
                }
              }}
              placeholder="หมายเหตุเพิ่มเติมสำหรับเคสนี้ (บันทึกอัตโนมัติเมื่อพิมพ์เสร็จ)..."
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer" style={{ padding: "16px 24px", justifyContent: "space-between" }}>
          {(appointment.status === "confirmed" || appointment.status === "arrived") && panel !== "cancel" ? (
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="btn-secondary-staff"
                style={{
                  color: "var(--staff-status-cancelled-fg)",
                  borderColor: "#ffc9c9",
                  background: "#fff5f5",
                  padding: "10px 18px",
                  fontSize: "13.5px",
                  fontWeight: "600",
                }}
                onClick={() => openPanel("cancel")}
              >
                <IconX size={15} />
                <span>ยกเลิกนัด</span>
              </button>
              {appointment.status === "confirmed" && appointment.date <= today && (
                <button
                  type="button"
                  className="btn-secondary-staff"
                  style={{
                    color: "var(--staff-status-noshow-fg)",
                    borderColor: "#dee2e6",
                    background: "#f1f3f5",
                    padding: "10px 18px",
                    fontSize: "13.5px",
                    fontWeight: "600",
                  }}
                  onClick={() => queueMove("no_show")}
                >
                  <span>ไม่มา</span>
                </button>
              )}
            </div>
          ) : (
            <div />
          )}

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              className="btn-secondary-staff"
              style={{ padding: "10px 20px", fontSize: "13.5px", fontWeight: "600" }}
              onClick={onClose}
            >
              ปิด
            </button>
            {appointment.status === "confirmed" && appointment.date === today && (
              <button
                type="button"
                className="btn-primary-staff"
                style={{ padding: "10px 20px", fontSize: "13.5px", fontWeight: "600" }}
                onClick={() => queueMove("arrived")}
              >
                <IconWalkIn size={16} />
                <span>เช็คอิน</span>
              </button>
            )}
            {appointment.status === "confirmed" && appointment.date !== today && (
              <button
                type="button"
                className="btn-primary-staff"
                style={{ background: "#2b8a3e", padding: "10px 20px", fontSize: "13.5px", fontWeight: "600" }}
                onClick={handleComplete}
              >
                <IconCheck size={16} />
                <span>ตรวจเสร็จสิ้น (Mark Done)</span>
              </button>
            )}
            {appointment.status === "arrived" && (
              <button
                type="button"
                className="btn-primary-staff"
                style={{ padding: "10px 20px", fontSize: "13.5px", fontWeight: "600" }}
                onClick={() => queueMove("in_chair")}
              >
                <IconDentist size={16} />
                <span>เรียกเข้าตรวจ (Call in)</span>
              </button>
            )}
            {appointment.status === "in_chair" && (
              <button
                type="button"
                className="btn-primary-staff"
                style={{ background: "#2b8a3e", padding: "10px 20px", fontSize: "13.5px", fontWeight: "600" }}
                onClick={handleComplete}
              >
                <IconCheck size={16} />
                <span>ตรวจเสร็จสิ้น (Mark Done)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
