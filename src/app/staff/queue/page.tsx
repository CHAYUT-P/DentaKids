"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTreatments } from "@/lib/treatmentsContext";
import { useStaff, type StaffAppointment, type WaitlistEntry } from "@/lib/staffStore";
import { useT } from "@/i18n/lang";
import { fmtLong } from "@/lib/dates";
import { AppointmentDetailModal } from "@/components/staff/schedule/AppointmentDetailModal";
import { staffCashierDay } from "@/server/actions";
import type { CashierDay } from "@/lib/billing";
import { goStaff } from "@/lib/staffNav";
import { useStaffUser } from "@/lib/staffUser";
import { IconCheck, IconPhone, IconWalkIn } from "@/components/staff/shell/staffIcons";
import { AgeTag } from "@/components/staff/shell/AgeTag";

/**
 * วันนี้ — today's queue in two groups. ยังไม่มา: bookings not here yet, by
 * their time (no-shows at the bottom). มาแล้ว: checked-in bookings and
 * walk-ins, in the order they arrived. The desk only manages arrival, so each
 * booking has a single tick: tap when the family walks in (it moves across),
 * tap again to undo a mistake. Tapping a name opens the booking (postpone,
 * cancel, no-show live there).
 *
 * What the parents' queue-check page shows (/api/queue) is still the
 * checked-in line, so ticking here is what moves a family onto it.
 */

/** HH:MM → minutes since midnight */
const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** a lateness, readable at a glance: "12 นาที", "2 ชม. 5 นาที" */
const fmtMinutes = (m: number) => {
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} ชม. ${rest} นาที` : `${h} ชม.`;
};

type Row =
  | { kind: "booking"; at: string; appt: StaffAppointment }
  | { kind: "walkin"; at: string; entry: WaitlistEntry };

/** statuses that mean the family is (or was) here today */
const HERE: StaffAppointment["status"][] = ["arrived", "in_chair", "completed"];

/** where a visit stands after arrival (full edition): exam room, then the counter */
type Stage = { label: string; tone: "wait" | "chair" | "pay" | "paid"; bill?: number };

export default function StaffTodayPage() {
  const { today, appointments, waitlist, dentists, setQueueStatus, showToast, edition } = useStaff();
  const canPay = useStaffUser().can("cashier");
  const full = edition === "full";

  /* bills for today, so each visit shows whether it is paid (full edition) */
  const [bills, setBills] = useState<CashierDay | null>(null);
  useEffect(() => {
    if (!full || !canPay) return;
    let live = true;
    const tick = () =>
      staffCashierDay(today)
        .then((d) => live && setBills(d))
        .catch(() => {});
    void tick();
    const id = setInterval(() => void tick(), 20_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [full, canPay, today, appointments, waitlist]);

  const stageOf = (status: string, apptId?: string, walkId?: string): Stage => {
    const bill = bills?.bills.find(
      (b) => b.status !== "void" && (apptId ? String(b.appointmentId) === apptId : String(b.waitlistId) === walkId),
    );
    if (bill?.status === "paid") return { label: "ชำระแล้ว", tone: "paid" };
    if (status === "completed" || status === "done")
      return { label: bill ? `ตรวจเสร็จ · ค้าง ${bill.balance.toLocaleString("th-TH")} บาท` : "ตรวจเสร็จ · รอชำระ", tone: "pay", bill: bill?.id };
    if (status === "in_chair") return { label: "กำลังตรวจ", tone: "chair", bill: bill?.id };
    return { label: "รอตรวจ", tone: "wait", bill: bill?.id };
  };

  const stageStrip = (st: Stage, visit: string) => (
    <span className="tr-stage">
      <span className={`stage-chip ${st.tone}`}>{st.label}</span>
      {canPay && st.tone !== "paid" ? (
        <button
          type="button"
          className={st.tone === "pay" ? "btn-primary-staff stage-pay" : "btn-secondary-staff stage-pay"}
          onClick={(e) => {
            e.stopPropagation();
            goStaff(`/cashier?visit=${visit}`);
          }}
        >
          รับชำระ
        </button>
      ) : null}
    </span>
  );
  const dict = useT();
  const tr = useTreatments();
  const [opened, setOpened] = useState<StaffAppointment | null>(null);

  /* the wall clock, for "เลยเวลา 15 นาที" — client-only and coarse */
  const [clock, setClock] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  const nowMin = clock ? mins(clock) : null;

  const dentistName = (slug: string | null | undefined) =>
    slug ? (dentists.find((d) => d.slug === slug)?.text.th.name ?? "") : "";

  const todays = useMemo(
    () => appointments.filter((a) => a.date === today && a.status !== "cancelled"),
    [appointments, today],
  );

  /* not here yet: by booked time, no-shows sink to the bottom */
  const waitingRows = useMemo<Row[]>(
    () =>
      todays
        .filter((a) => !HERE.includes(a.status))
        .sort((a, b) => {
          const na = a.status === "no_show" ? 1 : 0;
          const nb = b.status === "no_show" ? 1 : 0;
          return na - nb || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
        })
        .map((appt): Row => ({ kind: "booking", at: appt.time, appt })),
    [todays],
  );

  /* here: checked-in bookings and walk-ins, in the order they arrived */
  const hereRows = useMemo<Row[]>(
    () =>
      [
        ...todays
          .filter((a) => HERE.includes(a.status))
          .map((appt): Row => ({ kind: "booking", at: appt.checkedInAt ?? appt.time, appt })),
        ...waitlist.map((entry): Row => ({ kind: "walkin", at: entry.arrivedAt, entry })),
      ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
    [todays, waitlist],
  );

  const arrived = todays.filter((a) => HERE.includes(a.status)).length;
  const notYet = todays.filter((a) => a.status === "confirmed").length;
  const walkins = waitlist.length;

  const toggle = (a: StaffAppointment) => {
    if (a.status === "confirmed") {
      setQueueStatus(a.id, "arrived");
    } else if (a.status === "arrived") {
      setQueueStatus(a.id, "confirmed");
      showToast(`ยกเลิกเช็คอินของ ${a.childName} แล้ว`);
    }
  };

  /** one row — a booking (with its tick) or a walk-in (already here) */
  const renderRow = (r: Row) => {
          if (r.kind === "walkin") {
            const w = r.entry;
            return (
              <div key={`w-${w.id}`} className={`today-row here ${full ? "staged" : ""}`} role="listitem">
                <span className="tr-time">{w.arrivedAt}</span>
                <div className="tr-main">
                  <span className="tr-name">{w.childName}</span>
                  <span className="tr-sub">
                    {tr.name(w.treatmentKey)}
                    {w.dentistSlug ? ` · ${dentistName(w.dentistSlug)}` : ""}
                  </span>
                  <span className="tr-meta">
                    <IconWalkIn size={12} /> Walk-in
                    {w.guardianPhone ? (
                      <>
                        {" · "}
                        <IconPhone size={11} /> {w.guardianPhone}
                      </>
                    ) : null}
                  </span>
                </div>
                {full ? stageStrip(stageOf(w.status, undefined, w.id), `w-${w.id}`) : null}
                <span className="tr-tick done" aria-label={`มาแล้ว ${w.arrivedAt} น.`}>
                  <IconCheck size={20} />
                  <span>มาแล้ว {w.arrivedAt}</span>
                </span>
              </div>
            );
          }

          const a = r.appt;
          const here = HERE.includes(a.status);
          const noShow = a.status === "no_show";
          const late = !here && !noShow && nowMin !== null ? nowMin - mins(a.time) : 0;
          return (
            <div
              key={a.id}
              className={`today-row ${here ? "here" : ""} ${noShow ? "noshow" : ""} ${full && here ? "staged" : ""}`}
              role="listitem"
            >
              <span className="tr-time">{a.time}</span>
              <button type="button" className="tr-main" onClick={() => setOpened(a)} title="ดูรายละเอียดนัด">
                <span className="tr-name">
                  {a.childName}
                  {late > 0 ? <span className="tr-late">เลยเวลา {fmtMinutes(late)}</span> : null}
                </span>
                <span className="tr-sub">
                  {tr.name(a.treatmentKey)}
                  {a.dentistSlug ? ` · ${dentistName(a.dentistSlug)}` : " · รอจัดแพทย์"}
                </span>
                <span className="tr-meta">
                  <IconPhone size={11} /> {a.phone}
                  {a.lineName ? <span className="line-tag">LINE · {a.lineName}</span> : null}
                  <AgeTag group={a.ageGroup} />
                  <span className="tr-ref">{a.ref}</span>
                </span>
              </button>
              {full && here ? stageStrip(stageOf(a.status, a.id), `a-${a.id}`) : null}
              {noShow ? (
                <span className="tr-tick off">ไม่มา</span>
              ) : (
                <button
                  type="button"
                  className={`tr-tick ${here ? "done" : ""}`}
                  aria-pressed={here}
                  disabled={here && a.status !== "arrived"}
                  onClick={() => toggle(a)}
                  title={here ? "แตะอีกครั้งเพื่อยกเลิกเช็คอิน" : "เช็คอินเมื่อมาถึง"}
                >
                  <IconCheck size={20} />
                  <span>{here ? `มาแล้ว${a.checkedInAt ? ` ${a.checkedInAt}` : ""}` : "เช็คอิน"}</span>
                </button>
              )}
            </div>
          );
  };

  return (
    <div className="staff-container today-view">
      <div className="today-head">
        <div>
          <div className="today-kicker">วันนี้</div>
          <h1>
            {fmtLong(dict, today, "th")}
            {clock ? <span className="today-clock"> · {clock}</span> : null}
          </h1>
        </div>
        <div className="today-stats">
          <span>
            <b>{todays.length}</b> นัดวันนี้
          </span>
          <span>
            <b>{arrived}</b> มาแล้ว
          </span>
          <span>
            <b>{notYet}</b> ยังไม่มา
          </span>
          <span>
            <b>{walkins}</b> Walk-in
          </span>
        </div>
      </div>

      <div className="today-groups">
        <section className="today-group" aria-labelledby="g-waiting">
          <header className="today-group-head">
            <span className="tg-dot waiting" aria-hidden="true" />
            <h2 id="g-waiting">ยังไม่มา</h2>
            <span className="tg-count">{notYet}</span>
          </header>
          <div className="today-list" role="list" aria-label="ยังไม่มา">
            {waitingRows.length === 0 ? (
              <div className="today-empty">{todays.length === 0 ? "วันนี้ยังไม่มีนัด" : "มาครบทุกนัดแล้ว"}</div>
            ) : (
              waitingRows.map(renderRow)
            )}
          </div>
        </section>

        <section className="today-group" aria-labelledby="g-here">
          <header className="today-group-head">
            <span className="tg-dot here" aria-hidden="true" />
            <h2 id="g-here">มาแล้ว</h2>
            <span className="tg-count">{hereRows.length}</span>
            <span className="tg-note">เรียงตามเวลามาถึง</span>
          </header>
          <div className="today-list" role="list" aria-label="มาแล้ว">
            {hereRows.length === 0 ? <div className="today-empty">ยังไม่มีใครมาถึง</div> : hereRows.map(renderRow)}
          </div>
        </section>
      </div>

      {opened && <AppointmentDetailModal appointment={opened} onClose={() => setOpened(null)} />}
    </div>
  );
}
