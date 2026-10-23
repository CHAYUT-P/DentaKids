/**
 * The online-booking rules the clinic sets in ตั้งค่า → กฎการจอง & เก้าอี้
 * (stored in clinic_setting). They apply to families on the website and are
 * enforced on the server; staff can still book, move and cancel anything
 * from the staff app.
 *
 * - windowDays   how far ahead families may book (up to a year)
 * - leadHours    a booking must be made at least this long before its time
 * - cancelHours  a family may cancel or move their own booking until this long
 *                before its time (0 = right up to the appointment)
 * - dayQueueMax  how many families may join a full day's queue without a fixed
 *                time (0 = no day queue)
 */
export interface BookingRules {
  windowDays: number;
  leadHours: number;
  cancelHours: number;
  dayQueueMax: number;
}

export const DEFAULT_WINDOW_DAYS = 14;
export const MAX_WINDOW_DAYS = 365;
/** book-before and cancel-before: whole hours, up to a week */
export const MAX_RULE_HOURS = 168;
export const MAX_DAY_QUEUE = 50;

export const DEFAULT_RULES: BookingRules = {
  windowDays: DEFAULT_WINDOW_DAYS,
  leadHours: 1,
  cancelHours: 0,
  dayQueueMax: 10,
};

/** clinic_setting keys */
export const RULE_KEYS: Record<keyof BookingRules, string> = {
  windowDays: "booking_window_days",
  leadHours: "booking_lead_hours",
  cancelHours: "cancel_before_hours",
  dayQueueMax: "day_queue_max",
};

/** the choices the settings page offers for the window */
export const WINDOW_CHOICES: { days: number; th: string }[] = [
  { days: 7, th: "1 สัปดาห์" },
  { days: 14, th: "2 สัปดาห์" },
  { days: 30, th: "1 เดือน" },
  { days: 60, th: "2 เดือน" },
  { days: 90, th: "3 เดือน" },
  { days: 180, th: "6 เดือน" },
  { days: 365, th: "1 ปี" },
];

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

export function clampWindowDays(n: unknown): number {
  return clampInt(n, 1, MAX_WINDOW_DAYS, DEFAULT_WINDOW_DAYS);
}

/** one rule's value, kept inside its allowed range */
export function clampRule(key: keyof BookingRules, n: unknown): number {
  switch (key) {
    case "windowDays":
      return clampWindowDays(n);
    case "leadHours":
      return clampInt(n, 0, MAX_RULE_HOURS, DEFAULT_RULES.leadHours);
    case "cancelHours":
      return clampInt(n, 0, MAX_RULE_HOURS, DEFAULT_RULES.cancelHours);
    case "dayQueueMax":
      return clampInt(n, 0, MAX_DAY_QUEUE, DEFAULT_RULES.dayQueueMax);
  }
}

/** Thai label for a window length, e.g. 30 → "1 เดือน", 45 → "45 วัน" */
export function windowLabelTh(days: number): string {
  return WINDOW_CHOICES.find((c) => c.days === days)?.th ?? `${days} วัน`;
}

/** "2 ชั่วโมง", "1 วัน", "1 วัน 6 ชั่วโมง" — for rule texts */
export function hoursLabelTh(h: number): string {
  if (h < 24) return `${h} ชั่วโมง`;
  const d = Math.floor(h / 24);
  const rest = h % 24;
  return rest ? `${d} วัน ${rest} ชั่วโมง` : `${d} วัน`;
}

export function hoursLabelEn(h: number): string {
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  const rest = h % 24;
  const days = `${d} day${d === 1 ? "" : "s"}`;
  return rest ? `${days} ${rest} h` : days;
}
