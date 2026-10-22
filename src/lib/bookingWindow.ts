/**
 * How far ahead families may book on the website — set by the clinic in
 * ตั้งค่า → กฎการจอง (clinic_setting "booking_window_days"), at most a year.
 * Staff can still book any date from the staff app.
 */
export const DEFAULT_WINDOW_DAYS = 14;
export const MAX_WINDOW_DAYS = 365;

/** the choices the settings page offers */
export const WINDOW_CHOICES: { days: number; th: string }[] = [
  { days: 7, th: "1 สัปดาห์" },
  { days: 14, th: "2 สัปดาห์" },
  { days: 30, th: "1 เดือน" },
  { days: 60, th: "2 เดือน" },
  { days: 90, th: "3 เดือน" },
  { days: 180, th: "6 เดือน" },
  { days: 365, th: "1 ปี" },
];

export function clampWindowDays(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.floor(v));
}

/** Thai label for a window length, e.g. 30 → "1 เดือน", 45 → "45 วัน" */
export function windowLabelTh(days: number): string {
  return WINDOW_CHOICES.find((c) => c.days === days)?.th ?? `${days} วัน`;
}
