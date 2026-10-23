import type { Dict } from "@/i18n/dict";

/**
 * Dates as plain `YYYY-MM-DD` strings, formatted with the dictionary's own
 * month and weekday names so nothing depends on `Intl` locale data.
 *
 * The rule this file exists to keep: only the server calls `todayISO()`, and
 * client components take the result as a prop. If a client component asked the
 * browser for today's date it could disagree with the server's answer (the
 * server is pinned to Bangkok, the phone is not) and React would flag the
 * mismatch.
 */

const DAY = 86400000;
const WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type DayKey = (typeof WEEK)[number];

/** today in Asia/Bangkok, as YYYY-MM-DD. Server only. */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** the clinic's own clock, as minutes since midnight in Asia/Bangkok. Server
 *  only, for the same reason as `todayISO` — it decides which of today's slots
 *  have already gone by. */
export function nowMinutes(now: Date = new Date()): number {
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** minutes since midnight for a `HH:MM` slot label */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** UTC noon for the given ISO day — far enough from either midnight that adding
 *  days can never trip over a DST boundary in any zone. */
function at(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function addDays(iso: string, n: number): string {
  const t = new Date(at(iso).getTime() + n * DAY);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function dayOfMonth(iso: string): number {
  return at(iso).getUTCDate();
}

export function yearOf(iso: string): number {
  return at(iso).getUTCFullYear();
}

/** the 1st of the given day"s month, as an ISO day — month arithmetic always
 *  starts from the 1st so it can never fall off the end of a short month */
export function monthStart(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** whole months from a month start (or any day — the day is clamped into the
 *  target month, so Jan 31 + 1 lands on Feb 28, not Mar 3) */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const last = daysInMonth(
    `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-01`,
  );
  t.setUTCDate(Math.min(d, last));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** how many days the given day"s month has — Feb 2027 is 28, Feb 2028 is 29 */
export function daysInMonth(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
}

export function monthKey(iso: string): keyof Dict["month"] {
  return `m${at(iso).getUTCMonth() + 1}` as keyof Dict["month"];
}

export function weekday(iso: string): DayKey {
  return WEEK[at(iso).getUTCDay()];
}

/** 0 = Sunday … 6 = Saturday — the column index of a day in the calendar grid,
 *  which (like a Thai wall calendar) starts the week on Sunday */
export function weekdayIndex(iso: string): number {
  return at(iso).getUTCDay();
}

export function isSunday(iso: string): boolean {
  return weekday(iso) === "sun";
}

/**
 * The nearest day the clinic is actually open. Mock appointments are stored as
 * an offset from today, so as today walks through the week an offset drifts onto
 * a Sunday — and the clinic is closed on Sundays. `dir` is which way to step: a
 * past visit moves back, an upcoming one forward, so neither jumps sides of
 * today.
 */
export function openDay(iso: string, dir: 1 | -1): string {
  return isSunday(iso) ? addDays(iso, dir) : iso;
}

/** how many days from `todayISO` to `iso` — 0 today, 1 tomorrow, −2 two days ago */
export function daysFrom(todayISO: string, iso: string): number {
  return Math.round((at(iso).getTime() - at(todayISO).getTime()) / DAY);
}

/** minutes from now (clinic clock: `today` + `nowMin`) until `iso` at `hhmm` — negative once it has passed */
export function minutesUntil(today: string, nowMin: number, iso: string, hhmm: string): number {
  return daysFrom(today, iso) * 1440 + minutesOf(hhmm) - nowMin;
}

/** "จ. 8 ก.ย." / "Mon 8 Sep" */
export function fmtShort(t: Dict, iso: string): string {
  return `${t.weekday[weekday(iso)]} ${dayOfMonth(iso)} ${t.month[monthKey(iso)]}`;
}

/** "จันทร์ 8 ก.ย. 2569" / "Monday 8 Sep 2026" — the Thai side counts in B.E. */
export function fmtLong(t: Dict, iso: string, lang: "th" | "en"): string {
  const year = at(iso).getUTCFullYear() + (lang === "th" ? 543 : 0);
  return `${t.weekdayLong[weekday(iso)]} ${dayOfMonth(iso)} ${t.month[monthKey(iso)]} ${year}`;
}

/** today and tomorrow say so instead of naming the weekday */
export function fmtRelative(t: Dict, todayISO: string, iso: string): string {
  const n = daysFrom(todayISO, iso);
  if (n === 0) return t.common.today;
  if (n === 1) return t.common.tomorrow;
  return fmtShort(t, iso);
}

const TH_WEEKDAY = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "วันศุกร์ที่ 16 ต.ค. 2569" — for LINE messages, which have no Dict at hand */
export function thaiDate(iso: string): string {
  const d = at(iso);
  return `วัน${TH_WEEKDAY[d.getUTCDay()]}ที่ ${d.getUTCDate()} ${TH_MONTH[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}
