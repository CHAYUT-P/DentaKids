"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { Dentist } from "@/data/dentists";
import type { TreatmentKey } from "@/lib/treatments";
import { useTreatments } from "@/lib/treatmentsContext";
import { useLang } from "@/i18n/lang";
import { dayOfMonth, daysFrom, minutesUntil, monthKey, weekday } from "@/lib/dates";
import { timeRange } from "@/lib/slots";
import { useLine } from "@/lib/useLine";
import { myBookingsByLine } from "@/server/actions";
import { postponeHref } from "@/components/patient/postpone";
import { SectionHead } from "@/components/patient/parts";
import { Chevron } from "@/components/shared/icons";

type Row = NonNullable<Awaited<ReturnType<typeof myBookingsByLine>>>[number];

/** at most this many bookings on the home page: the next day's slip + rows */
const SHOWN = 3;

const LIVE: Row["status"][] = ["confirmed", "arrived", "in_chair"];

/**
 * "นัดถัดไปของคุณ" on the home page: the family's upcoming bookings, so they
 * don't have to open the history to know when to come.
 *
 * - The soonest day is a slip. Siblings booked the same day share it (one
 *   visit for the family), each child a line; one booking gets its own
 *   move / cancel buttons — on the day itself, map and call instead.
 * - Later bookings are small rows under it, up to SHOWN in all; the rest
 *   are one tap away ("ดูทั้งหมด").
 * - Nothing upcoming, or not signed in with LINE: the section isn't drawn —
 *   the booking banner above already invites them to book.
 */
export function NextBookings({
  today,
  nowMin,
  cancelHours,
  dentists,
  clinicPhone,
  mapUrl,
}: {
  today: string;
  nowMin: number;
  /** families change their own bookings until this many hours before */
  cancelHours: number;
  dentists: Dentist[];
  clinicPhone: { tel: string; display: string } | null;
  mapUrl: string;
}) {
  const { t, lang } = useLang();
  const tr = useTreatments();
  const line = useLine();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (line.status !== "in") return;
    let cancelled = false;
    myBookingsByLine(line.token)
      .then((r) => {
        if (!cancelled && r) setRows(r);
      })
      .catch(() => {
        // the history page still has them; the home page just stays quiet
      });
    return () => {
      cancelled = true;
    };
  }, [line.status, line.token]);

  const upcoming = (rows ?? [])
    .filter((b) => LIVE.includes(b.status))
    // today's still count until they're done (checked in, in the chair)
    .filter((b) => b.date > today || (b.date === today && (b.status !== "confirmed" || minutesUntil(today, nowMin, b.date, b.time) > -60)))
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
  if (upcoming.length === 0) return null;

  const firstDay = upcoming[0].date;
  const together = upcoming.filter((b) => b.date === firstDay);
  const later = upcoming.filter((b) => b.date !== firstDay).slice(0, Math.max(0, SHOWN - together.length));
  const isToday = firstDay === today;

  const dentistName = (slug: string | null) =>
    (slug && dentists.find((d) => d.slug === slug)?.text[lang].name) || t.booking.anyone;
  const n = (text: string, v: number) => text.replace("{n}", String(v));
  /** "14:00 น." in Thai, "14:00" in English */
  const hr = (time: string) => (lang === "th" ? `${time} น.` : time);

  /** "อีก 5 วัน", "พรุ่งนี้", "วันนี้ · อีก 2 ชม." */
  const countdown = (b: Row) => {
    const days = daysFrom(today, b.date);
    if (days >= 2) return n(t.bookingsPage.inDays, days);
    if (days === 1) return t.bookingsPage.tomorrow;
    if (b.status !== "confirmed") return `${t.bookingsPage.today} · ${t.bookingsPage.checkedIn}`;
    const mins = minutesUntil(today, nowMin, b.date, b.time);
    if (mins <= 0) return t.bookingsPage.today;
    const soon = mins < 60 ? n(t.bookingsPage.inMins, mins) : n(t.bookingsPage.inHours, Math.floor(mins / 60));
    return `${t.bookingsPage.today} · ${soon}`;
  };

  const single = together.length === 1 ? together[0] : null;
  // inside the clinic's cancel-before hours, changes go through the clinic
  const tooLate =
    single !== null && cancelHours > 0 && minutesUntil(today, nowMin, single.date, single.time) < cancelHours * 60;

  return (
    <>
      <SectionHead title={t.bookingsPage.nextTitle} href="/bookings" />
      <div className="nextList">
        <div className={`nextSlip${isToday ? " today" : ""}`}>
          <div className="nsDate">
            <span>{isToday ? t.bookingsPage.today : t.weekday[weekday(firstDay)]}</span>
            <b>{dayOfMonth(firstDay)}</b>
            <span>{t.month[monthKey(firstDay)]}</span>
          </div>
          <div className="nsBody">
            <span className="nsChip">
              {countdown(together[0])}
              {together.length > 1 ? ` · ${n(t.bookingsPage.visits, together.length)}` : ""}
            </span>
            {together.map((b) => (
              <div key={b.ref} className="nsVisit">
                <span className="nsTime">
                  {single ? hr(timeRange(b.time, b.durationMin)) : `${hr(b.time)} · ${tr.name(b.treatmentKey as TreatmentKey, lang)}`}
                </span>
                <span className="nsLine">
                  {single ? `${tr.name(b.treatmentKey as TreatmentKey, lang)} · ` : `${b.childName} · `}
                  {dentistName(b.dentistSlug)}
                </span>
                {single ? (
                  <span className="nsRef">
                    {b.childName} · {b.ref}
                  </span>
                ) : null}
              </div>
            ))}
            <div className="nsActs">
              {!single ? (
                <Link href="/bookings" className="nsBtn">
                  {t.bookingsPage.details}
                </Link>
              ) : isToday ? (
                <>
                  {mapUrl ? (
                    <a className="nsBtn" href={mapUrl} target="_blank" rel="noreferrer">
                      {t.bookingsPage.map}
                    </a>
                  ) : null}
                  {clinicPhone ? (
                    <a className="nsBtn" href={`tel:${clinicPhone.tel}`}>
                      {t.bookingsPage.callClinic}
                    </a>
                  ) : null}
                </>
              ) : tooLate || single.status !== "confirmed" ? (
                clinicPhone ? (
                  <a className="nsBtn" href={`tel:${clinicPhone.tel}`}>
                    {t.bookingsPage.callClinic} · {clinicPhone.display}
                  </a>
                ) : null
              ) : (
                <>
                  <button type="button" className="nsBtn" onClick={() => router.push(postponeHref(single))}>
                    {t.bookingsPage.reschedule}
                  </button>
                  <Link href={`/bookings?cancel=${encodeURIComponent(single.ref)}`} className="nsBtn">
                    {t.bookingsPage.cancelBooking}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        {later.map((b) => (
          <Link key={b.ref} href="/bookings" className="nextRow">
            <span className="nrDate">
              {t.weekday[weekday(b.date)]}
              <b>{dayOfMonth(b.date)}</b>
              {t.month[monthKey(b.date)]}
            </span>
            <span className="nrText">
              <span className="nsTime">
                {hr(b.time)} · {tr.name(b.treatmentKey as TreatmentKey, lang)}
              </span>
              <span className="nsLine">
                {b.childName} · {dentistName(b.dentistSlug)}
              </span>
            </span>
            <Chevron />
          </Link>
        ))}
      </div>
    </>
  );
}
