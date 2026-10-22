"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTreatments } from "@/lib/treatmentsContext";
import { ClockButton, useStaffUser } from "@/lib/staffUser";
import { initial } from "@/lib/roles";
import { useStaff, type StaffAppointment } from "@/lib/staffStore";
import { BookingModal } from "@/components/staff/schedule/BookingModal";
import { AddWaitlistModal } from "@/components/staff/schedule/AddWaitlistModal";
import { AppointmentDetailModal } from "@/components/staff/schedule/AppointmentDetailModal";
import { NotificationsPanel } from "@/components/staff/shell/NotificationsPanel";
import { IconAlertTriangle, IconBell, IconCheck, IconPlus, IconSearch } from "@/components/staff/shell/staffIcons";

const STATUS_TH: Record<StaffAppointment["status"], string> = {
  confirmed: "ยืนยันแล้ว",
  arrived: "เช็คอินแล้ว",
  in_chair: "กำลังตรวจ",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
  no_show: "ไม่มา",
};

/**
 * The one bar every staff screen shares: find any booking, the two ways a
 * family enters the day (walk-in, new booking), and the bell. Each action
 * lives here once — pages no longer repeat them.
 */
export function StaffTopbar() {
  const { user, accounts, signOut } = useStaffUser();
  const { today, appointments, notifications, toast, loadHistory } = useStaff();
  const tr = useTreatments();
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<StaffAppointment | null>(null);

  const unread = notifications.filter((n) => n.unread).length;

  // searching covers old visits too — fetch them the first time someone searches
  useEffect(() => {
    if (query.trim().length >= 2) loadHistory();
  }, [query, loadHistory]);

  /* name, phone (digits only) or booking ref — nearest to today first */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, "");
    const dist = (d: string) => Math.abs(Date.parse(d) - Date.parse(today));
    return appointments
      .filter(
        (a) =>
          a.childName.toLowerCase().includes(q) ||
          (a.lineName ?? "").toLowerCase().includes(q) ||
          a.ref.toLowerCase().includes(q) ||
          (digits.length >= 3 && a.phone.replace(/\D/g, "").includes(digits)),
      )
      .sort((a, b) => dist(a.date) - dist(b.date))
      .slice(0, 8);
  }, [query, appointments, today]);

  const isWarningToast =
    toast &&
    (toast.includes("อยู่แล้ว") ||
      toast.includes("ข้อผิดพลาด") ||
      toast.includes("ล้มเหลว") ||
      toast.includes("ไม่สำเร็จ") ||
      toast.includes("ไม่ถูกต้อง") ||
      toast.includes("ไม่ว่าง"));

  return (
    <>
      <header className="staff-topbar">
        <div className="staff-search">
          <label className="staff-search-field">
            <IconSearch size={17} />
            <input
              type="search"
              aria-label="ค้นหานัดหมาย"
              placeholder="ค้นหาชื่อเด็ก เบอร์โทร หรือรหัสจอง"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
            />
          </label>
          {query.trim().length >= 2 ? (
            <>
              <div className="staff-popover-scrim" onClick={() => setQuery("")} aria-hidden="true" />
              <div className="staff-search-results" role="listbox" aria-label="ผลการค้นหา">
                {results.length === 0 ? (
                  <div className="staff-search-empty">ไม่พบนัดที่ตรงกับ “{query.trim()}”</div>
                ) : (
                  results.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="option"
                      aria-selected="false"
                      className="staff-search-row"
                      onClick={() => {
                        setOpened(a);
                        setQuery("");
                      }}
                    >
                      <span className="ssr-when">
                        {a.date === today ? "วันนี้" : a.date.split("-").reverse().slice(0, 2).join("/")}
                        <b>{a.time}</b>
                      </span>
                      <span className="ssr-main">
                        <span className="ssr-name">{a.childName}</span>
                        <span className="ssr-sub">
                          {tr.name(a.treatmentKey)} · {a.phone}
                        </span>
                      </span>
                      <span className="ssr-side">
                        <span className="ssr-ref">{a.ref}</span>
                        <span className={`status-pill ${a.status}`}>{STATUS_TH[a.status]}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="staff-topbar-actions">
          <button type="button" className="btn-secondary-staff btn-lg" onClick={() => setShowWaitlistModal(true)}>
            <IconPlus size={17} />
            <span>Walk-in</span>
          </button>
          <button type="button" className="btn-primary-staff btn-lg" onClick={() => setShowBookingModal(true)}>
            <IconPlus size={17} />
            <span>นัดใหม่</span>
          </button>
          <ClockButton />
          {user && accounts ? (
            <button type="button" className="staff-user-chip" title="ล็อกเครื่อง / สลับผู้ใช้" onClick={() => void signOut()}>
              <span className="ug-avatar small">{initial(user.name)}</span>
              <span>{user.name}</span>
            </button>
          ) : null}
          <div className="staff-bell-wrap">
            <button
              type="button"
              className={`staff-bell ${bellOpen ? "open" : ""}`}
              aria-label={unread > 0 ? `การแจ้งเตือน ${unread} รายการใหม่` : "การแจ้งเตือน"}
              aria-expanded={bellOpen}
              onClick={() => setBellOpen(!bellOpen)}
            >
              <IconBell size={19} />
              {unread > 0 ? <span className="staff-bell-badge">{unread}</span> : null}
            </button>
            {bellOpen ? (
              <NotificationsPanel onClose={() => setBellOpen(false)} onOpenAppointment={setOpened} />
            ) : null}
          </div>
        </div>
      </header>

      {toast && (
        <div className="staff-floating-toast">
          {isWarningToast ? <IconAlertTriangle size={16} color="#ffd43b" /> : <IconCheck size={16} color="#51cf66" />}
          <span>{toast}</span>
        </div>
      )}

      {showBookingModal && <BookingModal onClose={() => setShowBookingModal(false)} />}
      {showWaitlistModal && <AddWaitlistModal onClose={() => setShowWaitlistModal(false)} />}
      {opened && <AppointmentDetailModal appointment={opened} onClose={() => setOpened(null)} />}
    </>
  );
}
