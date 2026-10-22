/**
 * The booking grid is half-hours. A treatment that takes longer (whitening,
 * a root canal with a crown — set per treatment in บริการ & ราคา) still
 * starts on the grid, but holds every half-hour it runs into: a one-hour
 * booking at 10:00 holds 10:00 and 10:30. These helpers are shared by the
 * patient site, the server checks and the staff schedule so all three agree.
 */

/** one slot on the grid, in minutes */
export const SLOT_MIN = 30;

/** the durations staff can pick for a treatment */
export const DURATION_CHOICES = [30, 60, 90, 120] as const;

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** how many grid slots a booking of this length holds (at least one) */
export function slotsNeeded(durationMin: number | null | undefined): number {
  return Math.max(1, Math.ceil((durationMin || SLOT_MIN) / SLOT_MIN));
}

/** every grid time a booking starting at `start` holds: 10:00 + 60 → 10:00, 10:30 */
export function coveredTimes(start: string, durationMin: number | null | undefined): string[] {
  const s = toMin(start);
  return Array.from({ length: slotsNeeded(durationMin) }, (_, i) => toHHMM(s + i * SLOT_MIN));
}

/** when a booking ends: 10:00 + 60 → 11:00 */
export function endTime(start: string, durationMin: number | null | undefined): string {
  return toHHMM(toMin(start) + slotsNeeded(durationMin) * SLOT_MIN);
}

/** "10:00" for a half-hour booking, "10:00–11:00" for a longer one */
export function timeRange(start: string, durationMin: number | null | undefined): string {
  return slotsNeeded(durationMin) > 1 ? `${start}–${endTime(start, durationMin)}` : start;
}

/** "30 นาที", "1 ชม.", "1 ชม. 30 นาที" */
export function durationTh(durationMin: number | null | undefined): string {
  const m = slotsNeeded(durationMin) * SLOT_MIN;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} นาที`;
  return r ? `${h} ชม. ${r} นาที` : `${h} ชม.`;
}

/** every grid start time from `start` up to (not including) `end`: 10:30–12:00 → 10:30, 11:00, 11:30 */
export function gridTimes(start: string, end: string): string[] {
  const out: string[] = [];
  for (let m = toMin(start); m + SLOT_MIN <= toMin(end); m += SLOT_MIN) out.push(toHHMM(m));
  return out;
}

/**
 * The start times a dentist can be booked on one day — their shift that
 * weekday, leaving room for the whole treatment (a 1-hour one can't start
 * in the last half-hour). Empty when they don't work that day.
 */
export function dentistDayTimes(
  shifts: { weekday: number; enabled: boolean; start: string; end: string }[] | undefined,
  weekday: number,
  durationMin = SLOT_MIN,
): string[] {
  const s = shifts?.find((x) => x.weekday === weekday && x.enabled);
  if (!s) return [];
  const lastStart = toMin(s.end) - slotsNeeded(durationMin) * SLOT_MIN;
  return gridTimes(s.start, s.end).filter((t) => toMin(t) <= lastStart);
}
