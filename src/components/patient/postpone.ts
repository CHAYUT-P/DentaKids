import { RESCHEDULE_KEY, type RescheduleHandoff } from "@/components/patient/BookingFlow";
import type { AgeGroup } from "@/lib/ageGroup";

/**
 * "เลื่อนนัด" from anywhere (my bookings, the home slip): the old slot rides in
 * sessionStorage only for the banner on /book, and the address carries just
 * the ref, treatment and dentist — the LINE sign-in is the proof.
 */
export function postponeHref(a: {
  ref: string;
  date: string;
  time: string;
  childName: string;
  ageGroup: AgeGroup | null;
  treatmentKey: string;
  dentistSlug: string | null;
}): string {
  const handoff: RescheduleHandoff = {
    ref: a.ref,
    date: a.date,
    time: a.time,
    childName: a.childName,
    ageGroup: a.ageGroup,
  };
  try {
    sessionStorage.setItem(RESCHEDULE_KEY, JSON.stringify(handoff));
  } catch {
    // storage blocked — the flow just shows the ref without the old time
  }
  const q = new URLSearchParams({ r: a.ref, t: a.treatmentKey });
  if (a.dentistSlug) q.set("d", a.dentistSlug);
  return `/book?${q.toString()}`;
}
