/**
 * A family can mark a booking (or a day-queue sign-up) as pain / emergency
 * and leave a short note. Both live in the row's note text — the mark first —
 * so the staff app, LINE and older screens all show it without a new column.
 */
export const URGENT_MARK = "🚨 ปวด/ฉุกเฉิน";
export const NOTE_MAX = 300;

/** the note as stored: the mark (if urgent), then what the family wrote */
export function familyNote(text: unknown, urgent: unknown): string {
  const body = typeof text === "string" ? text.trim().slice(0, NOTE_MAX) : "";
  if (urgent !== true) return body;
  return body ? `${URGENT_MARK} — ${body}` : URGENT_MARK;
}

export function isUrgent(note: string | null | undefined): boolean {
  return !!note && note.startsWith(URGENT_MARK);
}
