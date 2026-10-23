"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useTreatments } from "@/lib/treatmentsContext";
import { useStaff, type StaffAppointment } from "@/lib/staffStore";
import { addDays, weekday, daysFrom, fmtLong, thaiDate } from "@/lib/dates";
import { canTreat } from "@/lib/convert";
import { coveredTimes, endTime, gridTimes, slotsNeeded, timeRange } from "@/lib/slots";
import { useT } from "@/i18n/lang";
import { BookingModal } from "@/components/staff/schedule/BookingModal";
import { AppointmentDetailModal } from "@/components/staff/schedule/AppointmentDetailModal";
import { AddWaitlistModal } from "@/components/staff/schedule/AddWaitlistModal";
import { ScheduleDatePicker } from "@/components/staff/schedule/ScheduleDatePicker";
import {
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconPlus,
  IconWalkIn,
  IconCheck,
  IconX,
  IconDentist,
} from "@/components/staff/shell/staffIcons";
import { AgeTag } from "@/components/staff/shell/AgeTag";
import { UrgentNote } from "@/components/staff/shell/UrgentNote";
import { CallFamilyNotice } from "@/components/staff/shell/CallFamilyNotice";


/** HH:MM → minutes, to spot the gap the clinic leaves for lunch */
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** `lead` = the วัน / รายการ switch, drawn at the start of this toolbar */
export function ScheduleDay({ lead }: { lead?: React.ReactNode }) {
  const {
    today,
    appointments,
    dentists,
    waitlist,
    showToast,
    rescheduleAppointment,
    messageFamily,
    updateWaitlistStatus,
    assignWaitingDentist,
    removeWaitlist,
    walkinOpen,
    setWalkinOpen,
    onLeave,
    appointmentsFrom,
    loadHistory,
    dayQueue,
  } = useStaff();
  const dict = useT();
  const tr = useTreatments();

  const [selectedDate, setSelectedDate] = useState(today);
  // further back than the download reaches → fetch the older visits once
  useEffect(() => {
    if (selectedDate < appointmentsFrom) loadHistory();
  }, [selectedDate, appointmentsFrom, loadHistory]);
  const [selectedAppt, setSelectedAppt] = useState<StaffAppointment | null>(null);
  const [newBookingSlot, setNewBookingSlot] = useState<{
    date: string;
    time: string;
    dentistSlug: string;
  } | null>(null);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [showOnlyOnDuty, setShowOnlyOnDuty] = useState(true);

  // Drag and drop states
  const [draggingApptId, setDraggingApptId] = useState<string | null>(null);
  const [dragOverSlotKey, setDragOverSlotKey] = useState<string | null>(null);
  /** a dropped card waiting for "ย้ายนัด?" — nothing moves until staff confirm */
  const [pendingMove, setPendingMove] = useState<{
    appt: StaffAppointment;
    date: string;
    time: string;
    dentistSlug: string;
  } | null>(null);
  const [notifyFamily, setNotifyFamily] = useState(true);

  // Check weekday
  const weekdayKey = weekday(selectedDate);
  const weekdayNum = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(weekdayKey);

  const isDentistWorking = useCallback(
    (dentist: (typeof dentists)[0]) => {
      if (onLeave(dentist.slug, selectedDate)) return false;
      const shift = dentist.shifts?.find((s) => s.weekday === weekdayNum);
      return shift ? shift.enabled : false;
    },
    [weekdayNum, onLeave, selectedDate]
  );

  const getDentistShiftHours = (dentist: (typeof dentists)[0]) => {
    const shift = dentist.shifts?.find((s) => s.weekday === weekdayNum);
    return shift && shift.enabled ? `${shift.start} - ${shift.end}` : "หยุด";
  };

  // Dentists to show
  // Appointments on selected date
  const dayAppts = useMemo(
    () => appointments.filter((a) => a.date === selectedDate),
    [appointments, selectedDate]
  );

  // Dentists to show — one who is off (or on leave) but still holds a live
  // booking that day stays on the board, so the booking can be moved
  const displayedDentists = useMemo(() => {
    const active = dentists.filter((d) => d.isActive);
    if (!showOnlyOnDuty) return active;
    const holds = (slug: string) =>
      dayAppts.some((a) => a.dentistSlug === slug && a.status !== "cancelled");
    const onDuty = active.filter((d) => isDentistWorking(d) || holds(d.slug));
    return onDuty.length > 0 ? onDuty : active;
  }, [dentists, showOnlyOnDuty, isDentistWorking, dayAppts]);

  /**
   * The rows of the board: from the earliest dentist on duty to the last one
   * leaving that day (the real shifts, not a fixed 09:00–18:00), widened to
   * any booking that sits outside them so nothing is ever hidden.
   */
  const timeSlots = useMemo(() => {
    const spans = displayedDentists
      .map((d) => d.shifts?.find((s) => s.weekday === weekdayNum && s.enabled))
      .filter((s): s is NonNullable<typeof s> => !!s);
    let from = spans.length ? Math.min(...spans.map((s) => toMin(s.start))) : 9 * 60;
    let to = spans.length ? Math.max(...spans.map((s) => toMin(s.end))) : 18 * 60;
    for (const a of dayAppts) {
      if (a.status === "cancelled") continue;
      from = Math.min(from, toMin(a.time));
      to = Math.max(to, toMin(a.time) + slotsNeeded(a.durationMin) * 30);
    }
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return gridTimes(hhmm(from), hhmm(to));
  }, [displayedDentists, weekdayNum, dayAppts]);

  /** live bookings per day — what the date picker draws under each day number */
  const apptCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of appointments) {
      if (a.status === "cancelled") continue;
      m[a.date] = (m[a.date] ?? 0) + 1;
    }
    return m;
  }, [appointments]);

  // Quick stats
  const completedCount = dayAppts.filter((a) => a.status === "completed").length;
  const cancelledCount = dayAppts.filter((a) => a.status === "cancelled").length;
  const waitingCount = waitlist.filter((w) => w.status === "waiting").length;

  // a live booking wins over a cancelled one at the same time (cancelled, then
  // rebooked) — otherwise the grid could show the cancelled card and hide it
  const getSlotAppt = (dentistSlug: string, time: string) => {
    const here = dayAppts.filter((a) => a.dentistSlug === dentistSlug && a.time === time);
    return here.find((a) => a.status !== "cancelled") ?? here[0];
  };

  /** a longer booking that started earlier and still runs at this time */
  const getCoverAppt = (dentistSlug: string, time: string) =>
    dayAppts.find(
      (a) =>
        a.dentistSlug === dentistSlug &&
        a.status !== "cancelled" &&
        a.time !== time &&
        coveredTimes(a.time, a.durationMin).includes(time),
    );

  /** the second half-hour of a 1-hour booking: held, not bookable */
  const renderCover = (appt: StaffAppointment) => (
    <button
      type="button"
      className={`appt-cover ${appt.status}`}
      onClick={() => setSelectedAppt(appt)}
      title={`${appt.childName} · ${timeRange(appt.time, appt.durationMin)} น.`}
    >
      ↳ {appt.childName} · ต่อถึง {endTime(appt.time, appt.durationMin)}
    </button>
  );

  const dayOffset = daysFrom(today, selectedDate);
  const dateLong = fmtLong(dict, selectedDate, "th");
  const dateHint =
    dayOffset === 0 ? "วันนี้" : dayOffset === 1 ? "พรุ่งนี้" : dayOffset === -1 ? "เมื่อวาน" : "";

  const renderChip = (appt: StaffAppointment) => (
    <div
      draggable={appt.status === "confirmed"}
      onDragStart={(e) => handleDragStart(e, appt)}
      onDragEnd={handleDragEnd}
      onClick={() => setSelectedAppt(appt)}
      className={`appt-chip-card ${appt.status} ${
        draggingApptId === appt.id ? "is-dragging" : ""
      }`}
      title="คลิกเพื่อดูรายละเอียด / ลากเพื่อย้ายเวลาหรือเปลี่ยนแพทย์"
    >
      <div className="appt-chip-header">
        <strong className="appt-chip-name">{appt.childName}</strong>
        <span className="appt-chip-ref">{appt.ref}</span>
      </div>
      <div className="appt-chip-body">
        <span className="appt-treatment-name">
          {tr.name(appt.treatmentKey)}
          {slotsNeeded(appt.durationMin) > 1 ? (
            <span className="appt-long">{timeRange(appt.time, appt.durationMin)}</span>
          ) : null}
          <AgeTag group={appt.ageGroup} />
          <UrgentNote note={appt.notes} compact />
        </span>
        {appt.lineName ? (
          <span className="line-tag">LINE · {appt.lineName}</span>
        ) : (
          <span className={`source-pill-micro ${appt.source}`}>
            {appt.source === "online" && "เว็บ"}
            {appt.source === "phone" && "โทร"}
            {appt.source === "walkin" && "Walk-in"}
          </span>
        )}
      </div>
    </div>
  );

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, appt: StaffAppointment) => {
    e.dataTransfer.setData("text/plain", appt.id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingApptId(appt.id);
  };

  const handleDragEnd = () => {
    setDraggingApptId(null);
    setDragOverSlotKey(null);
  };

  const handleDragOver = (e: React.DragEvent, slotKey: string, isWorking: boolean) => {
    if (!isWorking) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverSlotKey !== slotKey) {
      setDragOverSlotKey(slotKey);
    }
  };

  const handleDragLeave = (slotKey: string) => {
    if (dragOverSlotKey === slotKey) {
      setDragOverSlotKey(null);
    }
  };

  const handleDrop = (
    e: React.DragEvent,
    targetDate: string,
    targetTime: string,
    targetDentistSlug: string,
    isWorking: boolean
  ) => {
    e.preventDefault();
    setDragOverSlotKey(null);
    setDraggingApptId(null);

    if (!isWorking) return;

    const apptId = e.dataTransfer.getData("text/plain") || draggingApptId;
    if (!apptId) return;

    const targetAppt = appointments.find((a) => a.id === apptId);
    if (!targetAppt) return;

    // Check if dropping on same slot
    if (
      targetAppt.date === targetDate &&
      targetAppt.time === targetTime &&
      targetAppt.dentistSlug === targetDentistSlug
    ) {
      return;
    }

    // any live booking holds its slots — checked in or in the chair too —
    // and a 1-hour booking needs both half-hours it would cover
    const need = new Set(coveredTimes(targetTime, targetAppt.durationMin));
    const existing = appointments.find(
      (a) =>
        a.id !== apptId &&
        a.date === targetDate &&
        a.dentistSlug === targetDentistSlug &&
        a.status !== "cancelled" &&
        coveredTimes(a.time, a.durationMin).some((t) => need.has(t)),
    );

    if (existing) {
      showToast(
        `ช่วง ${timeRange(targetTime, targetAppt.durationMin)} น. ชนกับนัดของ ${existing.childName} (${timeRange(existing.time, existing.durationMin)})`,
      );
      return;
    }

    // ask first — and offer to tell the family on LINE
    setNotifyFamily(!!targetAppt.hasLine);
    setPendingMove({ appt: targetAppt, date: targetDate, time: targetTime, dentistSlug: targetDentistSlug });
  };

  const docName = (slug: string | null | undefined) =>
    dentists.find((d) => d.slug === slug)?.text.th.name ?? "ยังไม่จัดแพทย์";

  /** what the family reads on LINE when the clinic moves their booking */
  const moveMessage = (m: NonNullable<typeof pendingMove>) =>
    `แจ้งเปลี่ยนเวลานัด 🦷\nนัดของ ${m.appt.childName} ย้ายเป็น ${thaiDate(m.date)} เวลา ${m.time} น.` +
    `\nกับ ${docName(m.dentistSlug)}\nรหัสจอง: ${m.appt.ref}\nหากไม่สะดวก ติดต่อคลินิกได้เลยค่ะ`;

  const confirmMove = async () => {
    if (!pendingMove) return;
    const m = pendingMove;
    setPendingMove(null);
    // tell the family only once the move is saved — if the time was taken
    // meanwhile, the toast says so and nobody was told a wrong time
    if (!(await rescheduleAppointment(m.appt.id, m.date, m.time, m.dentistSlug))) return;
    if (notifyFamily && m.appt.hasLine) void messageFamily(m.appt.id, moveMessage(m));
    else showToast(`ย้ายนัด ${m.appt.childName} เป็น ${m.time} น. (${docName(m.dentistSlug)})`);
  };

  return (
    <div className="staff-schedule-container">
      {/* ── Single-row Command Toolbar (Clean & Essential) ────────────────────────── */}
      <div className="schedule-toolbar">
        {/* Date Navigator */}
        <div className="schedule-date-nav">
          {lead}
          <button
            type="button"
            className="btn-date-nav"
            onClick={() => setSelectedDate(addDays(selectedDate, -1))}
            title="วันก่อนหน้า"
          >
            <IconChevronLeft size={16} />
          </button>

          <button
            type="button"
            className={`btn-date-pill ${selectedDate === today ? "active" : ""}`}
            onClick={() => setSelectedDate(today)}
          >
            วันนี้
          </button>

          <button
            type="button"
            className={`btn-date-pill ${selectedDate === addDays(today, 1) ? "active" : ""}`}
            onClick={() => setSelectedDate(addDays(today, 1))}
          >
            พรุ่งนี้
          </button>

          <button
            type="button"
            className="btn-date-nav"
            onClick={() => setSelectedDate(addDays(selectedDate, 1))}
            title="วันถัดไป"
          >
            <IconChevronRight size={16} />
          </button>

          <ScheduleDatePicker
            today={today}
            value={selectedDate}
            onChange={setSelectedDate}
            counts={apptCounts}
          />

          <h1 className="schedule-current-date-title">
            {dateLong}
            {dateHint ? <span className="sched-date-hint">{dateHint}</span> : null}
          </h1>
        </div>

        {/* Status Counters Strip */}
        <div className="schedule-stats-strip" title="นัดหมายของวันที่เลือก">
          <strong>{dayAppts.length}</strong> นัด
          <span className="stat-pill-divider">·</span>
          <strong>{completedCount}</strong> เสร็จ
          {cancelledCount > 0 ? (
            <>
              <span className="stat-pill-divider">·</span>
              <strong>{cancelledCount}</strong> ยกเลิก
            </>
          ) : null}
        </div>

        {/* Right Toolbar Controls */}
        <div className="schedule-toolbar-right">
          {/* On-duty doctor toggle */}
          <button
            type="button"
            className={`btn-seg-toggle ${showOnlyOnDuty ? "active" : ""}`}
            onClick={() => setShowOnlyOnDuty(!showOnlyOnDuty)}
            title="สลับการแสดงเฉพาะแพทย์ที่ลงตรวจ หรือแสดงแพทย์ทุกคน"
          >
            <IconDentist size={14} />
            <span>{showOnlyOnDuty ? `แพทย์ลงตรวจ (${displayedDentists.length})` : `แสดงแพทย์ทุกคน (${dentists.length})`}</span>
          </button>

          {/* Walk-in Queue Drawer Toggle */}
          <button
            type="button"
            className={`btn-walkin-toggle ${walkinOpen ? "active" : ""}`}
            onClick={() => setWalkinOpen(!walkinOpen)}
          >
            <IconWalkIn size={15} />
            <span>คิว Walk-in</span>
            {waitingCount > 0 && <span className="walkin-badge">{waitingCount}</span>}
          </button>

        </div>
      </div>

      {/* families who signed up for this day's queue on the website (no fixed time) */}
      {(() => {
        const queued = dayQueue.filter((q) => q.visitDate === selectedDate);
        if (queued.length === 0) return null;
        return (
          <div className="dayq-strip">
            <strong>คิวรอไม่ระบุเวลา {queued.length} คน</strong>
            {queued.map((q) => (
              <span key={q.id} className="dayq-person" title={`${q.phone}${q.note ? ` · ${q.note}` : ""}`}>
                {q.childName} · {tr.name(q.treatmentKey)}
                <UrgentNote note={q.note} compact />
              </span>
            ))}
            <span className="dayq-hint">เช็คอินได้ในหน้า “วันนี้” ของวันนั้น</span>
          </div>
        );
      })()}

      {/* ── Main Schedule Matrix (100% Full Width) ────────────────────── */}
      <div className="schedule-matrix-container">
        <div
          className="schedule-matrix-grid"
          style={{ "--doc-count": displayedDentists.length } as React.CSSProperties}
        >
          {/* Header Row: Doctors */}
          <div className="matrix-head-row">
            <div className="matrix-time-header">
              <IconClock size={14} />
              <span>เวลา</span>
            </div>

            {displayedDentists.map((d) => {
              const working = isDentistWorking(d);
              const shiftHours = getDentistShiftHours(d);
              const leave = onLeave(d.slug, selectedDate);

              return (
                <div
                  key={d.slug}
                  className={`matrix-doctor-header ${working ? "on-duty" : "off-duty"} ${leave ? "on-leave" : ""}`}
                >
                  <div className="matrix-doc-avatar-wrap">
                    <div className={`matrix-doc-avatar tint-${working ? d.tint : "off"}`}>
                      {d.text.th.name.split(" ")[1]?.[0] || "ท"}
                    </div>
                  </div>

                  <div className="matrix-doc-meta">
                    <div className="matrix-doc-fullname">{d.text.th.name}</div>
                    <div className="matrix-doc-specialty">{d.text.th.title}</div>
                    <div className="matrix-doc-shift-badge">
                      {leave
                        ? `ลา${leave.note ? ` · ${leave.note}` : ""}`
                        : working
                          ? `เวรตรวจ ${shiftHours} น.`
                          : "— หยุดประจำวัน —"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Time Slot Rows */}
          <div className="matrix-body-scroll">
            {timeSlots.map((time) => (
              <React.Fragment key={time}>
              <div className="matrix-slot-row">
                {/* Time Axis Column */}
                <div className="matrix-time-label">
                  <span>{time}</span>
                </div>

                {/* Dentist Slot Cells */}
                {displayedDentists.map((d) => {
                  const working = isDentistWorking(d);
                  const appt = getSlotAppt(d.slug, time);
                  const slotKey = `${d.slug}-${time}`;
                  const isDragOver = dragOverSlotKey === slotKey;

                  if (!working) {
                    return (
                      <div
                        key={slotKey}
                        className={`matrix-cell off-duty ${onLeave(d.slug, selectedDate) ? "on-leave" : ""}`}
                        title={onLeave(d.slug, selectedDate) ? "แพทย์ลาวันนี้" : "แพทย์ไม่อยู่ในเวรตรวจวันนี้"}
                      >
                        {appt ? renderChip(appt) : (() => {
                          const cover = getCoverAppt(d.slug, time);
                          return cover ? renderCover(cover) : null;
                        })()}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={slotKey}
                      className={`matrix-cell ${isDragOver ? "drop-active" : ""}`}
                      onDragOver={(e) => handleDragOver(e, slotKey, working)}
                      onDragLeave={() => handleDragLeave(slotKey)}
                      onDrop={(e) => handleDrop(e, selectedDate, time, d.slug, working)}
                    >
                      {appt ? (
                        renderChip(appt)
                      ) : getCoverAppt(d.slug, time) ? (
                        renderCover(getCoverAppt(d.slug, time)!)
                      ) : (
                        <button
                          type="button"
                          className="btn-cell-add"
                          onClick={() =>
                            setNewBookingSlot({
                              date: selectedDate,
                              time,
                              dentistSlug: d.slug,
                            })
                          }
                        >
                          <IconPlus size={12} />
                          <span>{isDragOver ? "ย้ายมาเวลานี้" : "ลงนัด"}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* ── Slide-over Walk-in Queue Drawer ─────────────────────────── */}
        {walkinOpen && (
          <aside className="walkin-drawer">
            <div className="walkin-drawer-head">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <IconWalkIn size={18} color="var(--staff-primary)" />
                <strong>คิว Walk-in วันนี้ ({waitlist.length})</strong>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className="btn-primary-staff"
                  onClick={() => setShowWaitlistModal(true)}
                >
                  <IconPlus size={12} />
                  <span>เพิ่ม</span>
                </button>
                <button
                  type="button"
                  className="btn-action-icon"
                  aria-label="ปิด"
                  onClick={() => setWalkinOpen(false)}
                >
                  <IconX size={14} />
                </button>
              </div>
            </div>

            <div className="walkin-drawer-body">
              {waitlist.length === 0 ? (
                <div className="walkin-empty-state">ยังไม่มีคิว Walk-in ในวันนี้</div>
              ) : (
                waitlist.map((w, idx) => (
                  <div
                    key={w.id}
                    className={`walkin-queue-card ${w.status === "in_chair" ? "in-chair" : ""}`}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span className="walkin-num-badge">{idx + 1}</span>
                        <strong>{w.childName}</strong>
                      </div>
                      <span className="walkin-time-text">มาถึง {w.arrivedAt} น.</span>
                    </div>

                    <div style={{ fontSize: "12px", color: "var(--staff-ink-2)" }}>
                      {tr.name(w.treatmentKey)} · {w.guardianPhone}
                    </div>

                    {/* who takes this walk-in — the room page keys off it */}
                    {w.status === "waiting" && (
                      <select
                        className="form-control"
                        value={w.dentistSlug ?? ""}
                        onChange={(e) => assignWaitingDentist(w.id, e.target.value || null)}
                      >
                        <option value="">— ยังไม่จัดหมอ —</option>
                        {dentists
                          .filter((d) => d.isActive)
                          .map((d) => (
                            <option key={d.slug} value={d.slug}>
                              {d.text.th.name}
                            </option>
                          ))}
                      </select>
                    )}

                    {w.notes && (
                      <div style={{ fontSize: "11px", color: "var(--staff-ink-muted)", fontStyle: "italic" }}>
                        &ldquo;{w.notes}&rdquo;
                      </div>
                    )}

                    <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                      {w.status === "waiting" && (
                        <button
                          type="button"
                          className="btn-primary-staff"
                          style={{ flex: 1 }}
                          onClick={() => updateWaitlistStatus(w.id, "in_chair")}
                        >
                          <span>เรียกเข้าตรวจ</span>
                        </button>
                      )}

                      {w.status === "in_chair" && (
                        <button
                          type="button"
                          className="btn-primary-staff"
                          style={{ flex: 1, background: "#2b8a3e" }}
                          onClick={() => updateWaitlistStatus(w.id, "done")}
                        >
                          <IconCheck size={13} />
                          <span>ตรวจเสร็จสิ้น</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn-action-icon"
                        onClick={() => removeWaitlist(w.id)}
                        title="ลบออกจากคิว"
                      >
                        <IconX size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────── */}
      {pendingMove ? (() => {
        const m = pendingMove;
        const doc = dentists.find((d) => d.slug === m.dentistSlug);
        const cannot = doc && !canTreat(doc.treats, m.appt.treatmentKey, doc.treatAges, m.appt.ageGroup);
        return (
          <div className="modal-overlay" onClick={() => setPendingMove(null)}>
            <div className="modal-card move-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>ย้ายนัด {m.appt.childName}?</h3>
                <button type="button" className="btn-action-icon" onClick={() => setPendingMove(null)} aria-label="ปิด">
                  <IconX size={16} />
                </button>
              </div>
              <div className="modal-body">
                <div className="move-from-to">
                  <div className="move-slot">
                    <span className="move-k">จาก</span>
                    <strong>{m.appt.time} น.</strong>
                    <span>{m.appt.date === m.date ? "" : `${thaiDate(m.appt.date)} · `}{docName(m.appt.dentistSlug)}</span>
                  </div>
                  <IconChevronRight size={18} />
                  <div className="move-slot to">
                    <span className="move-k">เป็น</span>
                    <strong>{m.time} น.</strong>
                    <span>{m.appt.date === m.date ? "" : `${thaiDate(m.date)} · `}{docName(m.dentistSlug)}</span>
                  </div>
                </div>
                <div className="move-what">
                  {tr.name(m.appt.treatmentKey)} <AgeTag group={m.appt.ageGroup} /> · {m.appt.ref}
                </div>
                {cannot ? (
                  <p className="move-warn">
                    {docName(m.dentistSlug)} ไม่ได้ตั้งให้รับ “{tr.name(m.appt.treatmentKey)}”
                    {m.appt.ageGroup ? ` สำหรับ${m.appt.ageGroup === "kid" ? "เด็ก" : "ผู้ใหญ่"}` : ""} — ย้ายได้ แต่ตรวจสอบกับคุณหมอก่อน
                  </p>
                ) : null}
                {m.appt.hasLine ? (
                  <label className="move-notify">
                    <input type="checkbox" checked={notifyFamily} onChange={(e) => setNotifyFamily(e.target.checked)} />
                    <span>แจ้งผู้ปกครองทาง LINE ว่าเปลี่ยนเวลานัด</span>
                  </label>
                ) : (
                  <CallFamilyNotice phone={m.appt.phone} />
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary-staff" onClick={() => setPendingMove(null)}>
                  ยกเลิก
                </button>
                <button type="button" className="btn-primary-staff" onClick={confirmMove}>
                  <IconCheck size={16} />
                  <span>ย้ายนัด</span>
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}

      {selectedAppt && (
        <AppointmentDetailModal
          appointment={selectedAppt}
          onClose={() => setSelectedAppt(null)}
        />
      )}

      {newBookingSlot && (
        <BookingModal
          initialDate={newBookingSlot.date}
          initialTime={newBookingSlot.time}
          initialDentistSlug={newBookingSlot.dentistSlug}
          onClose={() => setNewBookingSlot(null)}
        />
      )}

      {showWaitlistModal && (
        <AddWaitlistModal onClose={() => setShowWaitlistModal(false)} />
      )}
    </div>
  );
}
