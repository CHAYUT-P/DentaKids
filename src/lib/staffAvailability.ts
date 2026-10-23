import { coveredTimes, gridTimes, slotsNeeded, SLOT_MIN } from "@/lib/slots";

/**
 * What the staff app's time picker shows for one day: a row per half-hour
 * the clinic is open, a column per dentist. Worked out in the app from data
 * it already holds (bookings, shifts, leave, opening hours), so it appears
 * instantly; the server still checks the slot when the booking is saved.
 *
 * Staff rules (not the website's): any time the clinic is open can be booked,
 * also outside a dentist's shift ("นอกเวร", allowed with a warning) — but not
 * on a dentist's leave, not over another booking, not in the past.
 */
export type CellState =
  /** free, inside the dentist's shift */
  | "free"
  /** free, but outside the dentist's shift — allowed, with a warning */
  | "offshift"
  /** a booking starts here (label = who) */
  | "booked"
  /** a longer booking that started earlier still runs here */
  | "cont"
  /** the booking being moved — where it is now */
  | "self"
  /** can't start here: the treatment would run into a booking or past closing */
  | "blocked"
  /** already gone (today) */
  | "past";

export interface Cell {
  state: CellState;
  label?: string;
}

export interface DayColumn {
  slug: string;
  name: string;
  /** on leave that day — the whole column is closed */
  leave: boolean;
  /** works that weekday at all */
  onShift: boolean;
  cells: Record<string, Cell>;
}

export interface DayGrid {
  /** clinic open (not a closed weekday, not a holiday) */
  open: boolean;
  times: string[];
  columns: DayColumn[];
  /** start times inside a shift, free for this treatment — the day strip's count */
  freeCount: number;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function dayGrid(input: {
  date: string;
  today: string;
  nowMin: number;
  durationMin: number;
  clinic: { isOpen: boolean; start: string; end: string } | undefined;
  holiday: boolean;
  weekday: number;
  dentists: {
    slug: string;
    name: string;
    shifts: { weekday: number; enabled: boolean; start: string; end: string }[];
    onLeave: boolean;
  }[];
  /** that day's bookings, any status — cancelled ones are ignored here */
  appointments: { id: string; dentistSlug: string; time: string; durationMin: number; status: string; childName: string }[];
  /** the booking being moved: its own slots don't block it */
  excludeId?: string;
}): DayGrid {
  const { date, today, nowMin, durationMin, clinic } = input;
  const open = !!clinic?.isOpen && !input.holiday;
  if (!open || !clinic) return { open: false, times: [], columns: [], freeCount: 0 };

  const times = gridTimes(clinic.start, clinic.end);
  const close = toMin(clinic.end);
  const need = slotsNeeded(durationMin);
  let freeCount = 0;

  const live = input.appointments.filter((a) => a.status !== "cancelled");
  const columns = input.dentists.map((d): DayColumn => {
    const shift = d.shifts.find((s) => s.weekday === input.weekday && s.enabled);
    const inShift = (t: string) => !!shift && toMin(t) >= toMin(shift.start) && toMin(t) + SLOT_MIN <= toMin(shift.end);
    // who holds each half-hour of this dentist's day
    const holder: Record<string, { label: string; starts: boolean; self: boolean }> = {};
    for (const a of live) {
      if (a.dentistSlug !== d.slug) continue;
      coveredTimes(a.time, a.durationMin).forEach((t, i) => {
        holder[t] = { label: a.childName, starts: i === 0, self: a.id === input.excludeId };
      });
    }
    const cells: Record<string, Cell> = {};
    for (const t of times) {
      const h = holder[t];
      if (h && !h.self) {
        cells[t] = h.starts ? { state: "booked", label: h.label } : { state: "cont", label: h.label };
        continue;
      }
      if (d.onLeave) {
        cells[t] = { state: "blocked" };
        continue;
      }
      if (date === today && toMin(t) < nowMin) {
        cells[t] = h?.self && h.starts ? { state: "self" } : { state: "past" };
        continue;
      }
      const span = coveredTimes(t, durationMin);
      const fits =
        toMin(t) + need * SLOT_MIN <= close && span.every((x) => !holder[x] || holder[x].self);
      if (h?.self && h.starts) {
        cells[t] = { state: "self" };
      } else if (!fits) {
        cells[t] = { state: "blocked" };
      } else if (span.every(inShift)) {
        cells[t] = { state: "free" };
        freeCount++;
      } else {
        cells[t] = { state: "offshift" };
      }
    }
    return { slug: d.slug, name: d.name, leave: d.onLeave, onShift: !!shift, cells };
  });

  // dentists working that day first, then the rest (staff may still book them)
  columns.sort((a, b) => Number(b.onShift && !b.leave) - Number(a.onShift && !a.leave));
  return { open, times, columns, freeCount };
}
