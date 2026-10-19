"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";

import type { Dentist } from "@/data/dentists";
import { iconGroups, type IconKey } from "@/data/icons";
import type { TreatmentKey } from "@/lib/treatments";
import { useTreatments } from "@/lib/treatmentsContext";
import { useLang, useT } from "@/i18n/lang";
import {
  addDays,
  addMonths,
  dayOfMonth,
  daysInMonth,
  fmtRelative,
  minutesOf,
  monthKey,
  monthStart,
  weekday,
  weekdayIndex,
  yearOf,
} from "@/lib/dates";
import { dentistsForUI } from "@/lib/convert";
import { useLine } from "@/lib/useLine";
import { isAgeGroup, type AgeGroup } from "@/lib/ageGroup";
import { coveredTimes, durationTh, slotsNeeded, timeRange } from "@/lib/slots";
import { bookAppointment, holdSlot, releaseSlotHold, rescheduleBooking } from "@/server/actions";
import type { SlotRow } from "@/server/queries";
import { Check, Chevron, ChevronLeft } from "@/components/shared/icons";
import { Mascot } from "@/components/shared/Mascot";
import { DentistAvatar } from "@/components/patient/portrait";
import { Cta, Eyebrow, Ghost, LineSignIn, Screen, Slip } from "@/components/patient/screen";
import { ServiceIcon } from "@/components/shared/serviceIcons";

/**
 * Who it's for (kid / adult) → treatment → dentist → day and time → name +
 * phone → booked. The kid/adult answer narrows the treatments and dentists to
 * the ones who see that group (each dentist sets it per treatment).
 *
 * The family gives only a name to say at the desk (a nickname is enough) and a
 * phone number — no guardian/child details; staff match bookings to patient
 * records themselves. The family is signed in with LINE (the site is the
 * clinic OA's LIFF app), and the booking is stamped with that account: it is
 * how "my bookings" finds it, and the only way to move or cancel it later.
 *
 * Everything the flow shows is decided by the database: the dentist roster, the
 * weekly open days, holidays and — the part that makes it real — which slots
 * are taken. A slot is taken when an appointment exists in Postgres; the same
 * `slotsForDate` definition feeds the staff schedule, so the two UIs can never
 * disagree. Confirming calls the `bookAppointment` server action, which inserts
 * the row; the unique index (dentist_id, date, time) is the double-booking guard.
 *
 * No date here comes from the browser: `today`/`nowMin` arrive from the server
 * (pinned to Bangkok), so the server render and the hydrated render agree.
 */

type Step = 1 | 2 | 3 | 4;

/** how far ahead the calendar lets a family pick */
const WINDOW_DAYS = 14;

/** the clinic wants an hour's notice, so today's next slot is an hour out */
const LEAD = 60;

/**
 * What "เลื่อนนัด" on /bookings hands to this flow: the old date/time/child,
 * only for the banner and the slip. The proof `rescheduleBooking` checks is
 * the LINE sign-in, not anything in here.
 */
export const RESCHEDULE_KEY = "dk:reschedule";
export interface RescheduleHandoff {
  ref: string;
  date: string;
  time: string;
  childName: string;
  /** who the booking is for — keeps the same dentists on offer when moving it */
  ageGroup?: AgeGroup | null;
}

/** the name + phone this family booked with last time, on this device */
const CONTACT_KEY = "dk:contact";
function readContact(): { name: string; tel: string } {
  try {
    const raw = typeof window === "undefined" ? null : localStorage.getItem(CONTACT_KEY);
    const v = raw ? (JSON.parse(raw) as { name?: unknown; tel?: unknown }) : null;
    return { name: typeof v?.name === "string" ? v.name : "", tel: typeof v?.tel === "string" ? v.tel : "" };
  } catch {
    return { name: "", tel: "" };
  }
}
function saveContact(name: string, tel: string) {
  try {
    localStorage.setItem(CONTACT_KEY, JSON.stringify({ name, tel }));
  } catch {
    // storage blocked — they just type it again next time
  }
}

const noSubscribe = () => () => {};
function readHandoff(): string | null {
  try {
    return sessionStorage.getItem(RESCHEDULE_KEY);
  } catch {
    return null;
  }
}

/** the calendar's columns, Sunday-first like a wall calendar */
const WEEK_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/* ═══════════════════════════════ props ═══════════════════════════════════ */

export interface BookingDayData {
  iso: string;
  closed: boolean;
  full: boolean;
}

export interface BookingFlowProps {
  today: string;
  nowMin: number;
  /** the DB roster — carries `id` (the appointment FK) plus the UI profile */
  dentists: (Dentist & { id: number })[];
  /** weekly open days from clinic_day */
  openDays: { day: string; isOpen: boolean }[];
  /** special closed dates from holiday */
  holidays: { start: string; end: string; name: string }[];
  /** per-date slot occupancy inside the booking window, keyed by YYYY-MM-DD */
  slots: Record<string, SlotRow[]>;
  /** chair load per date/time for "any dentist" mode: admits while live < chairs */
  load: Record<string, Record<string, { live: number; pool: number }>>;
  /** treatment chairs — one wall-clock slot holds this many live bookings */
  chairs: number;
  /** per-treatment price map for the compact price label */
  /** the popular grid on step 1 — the ten home tiles */
  popular: IconKey[];
  /** a treatment key shown on the website (built-in IconKey or one the clinic added) */
  preTreatment?: TreatmentKey;
  preDentist?: string;
  /** `?r=` — move this existing booking instead of making a new one */
  rescheduleRef?: string;
  /** the clinic's address from clinic_info, for the slip */
  address: { th: string; en: string };
}

/* ═══════════════════════════ small shared rows ═══════════════════════════ */

function Stepper({ step, onBack }: { step: Step; onBack: (s: Step) => void }) {
  const t = useT();
  const labels = [t.booking.step1, t.booking.step2, t.booking.step3, t.booking.contact];
  return (
    <ol className="steps">
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        const done = step > n;
        return (
          <li key={label} className={done ? "done" : step === n ? "now" : ""}>
            <button type="button" onClick={() => (done ? onBack(n) : undefined)} disabled={!done}>
              <span className="sn">{done ? <Check size={12} /> : n}</span>
              <span className="sl">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function TreatRow({ k, onPick }: { k: TreatmentKey; onPick: (k: TreatmentKey) => void }) {
  const { lang } = useLang();
  const tr = useTreatments();
  return (
    <button type="button" className="pickRow" onClick={() => onPick(k)}>
      <span className={`disc t-${tr.tint(k)}`}>
        <ServiceIcon k={tr.icon(k)} size={26} />
      </span>
      <span className="pt">
        <span className="pn">{tr.name(k, lang)}</span>
      </span>
      <Chevron />
    </button>
  );
}

function DentistRow({ d, onPick }: { d: Dentist; onPick: (slug: string) => void }) {
  const { t, lang } = useLang();
  const x = d.text[lang];
  return (
    <button type="button" className="pickRow" onClick={() => onPick(d.slug)}>
      <DentistAvatar d={d} alt={x.name} size={44} />
      <span className="pt">
        <span className="pn">{x.name}</span>
        <span className="pp">
          {x.title} · {d.years} {t.common.years}
        </span>
      </span>
      <Chevron />
    </button>
  );
}

function SlotBank({
  label,
  times,
  time,
  onPick,
}: {
  label: string;
  times: string[];
  time: string | null;
  onPick: (hhmm: string) => void;
}) {
  return (
    <>
      <h3>{label}</h3>
      <div className="slots">
        {times.map((hhmm) => (
          <button
            key={hhmm}
            type="button"
            className={`slot${time === hhmm ? " on" : ""}`}
            onClick={() => onPick(hhmm)}
          >
            {hhmm}
          </button>
        ))}
      </div>
    </>
  );
}
/**
 * The start times one day offers for a booking `durationMin` long. A 1-hour
 * treatment needs every half-hour it runs into: 10:00 only shows when 10:00
 * AND 10:30 are free — so a taken 10:30 also takes away 10:00.
 *   named dentist — that dentist is on shift and free for all of it
 *   any dentist   — the chairs have room for all of it, and one capable
 *                   dentist is on shift for all of it (the booking may wait
 *                   in the pool for them)
 */
function startTimes(
  rows: SlotRow[],
  dayLoad: Record<string, { live: number; pool: number }>,
  chairs: number,
  dentist: string | null,
  capable: Set<string>,
  durationMin: number,
  gone: (hhmm: string) => boolean,
): string[] {
  const has = (slug: string, t: string, free: boolean) =>
    rows.some((r) => r.dentistSlug === slug && r.time === t && (!free || !r.taken));
  return [...new Set(rows.map((r) => r.time))].sort().filter((t0) => {
    if (gone(t0)) return false;
    const need = coveredTimes(t0, durationMin);
    if (dentist) return need.every((t) => has(dentist, t, true));
    if (need.some((t) => (dayLoad[t]?.live ?? 0) >= chairs)) return false;
    return [...capable].some((slug) => need.every((t) => has(slug, t, false)));
  });
}

/* ═══════════════════════════════ the day calendar ═══════════════════════ */

function DayCalendar({
  today,
  date,
  onPick,
  openDays,
  holidays,
  slots,
  dentist,
  capable,
  load,
  chairs,
  durationMin,
}: {
  today: string;
  date: string | null;
  onPick: (iso: string) => void;
  openDays: { day: string; isOpen: boolean }[];
  holidays: { start: string; end: string; name: string }[];
  slots: Record<string, SlotRow[]>;
  /** null = "any dentist" (chair-load mode); a slug = that dentist's own grid */
  dentist: string | null;
  /** slugs able to do the picked treatment — bounds "any dentist" days */
  capable: Set<string>;
  load: Record<string, Record<string, { live: number; pool: number }>>;
  chairs: number;
  /** the picked treatment's length — a long one needs room for all of it */
  durationMin: number;
}) {
  const { t, lang } = useLang();
  const lastDay = addDays(today, WINDOW_DAYS - 1);
  const firstMonth = monthStart(today);
  const lastMonth = monthStart(lastDay);
  const [view, setView] = useState(firstMonth);

  const closedWeekday = new Map(openDays.map((d) => [d.day, !d.isOpen]));
  const holidayOn = (iso: string) => holidays.find((h) => iso >= h.start && iso <= h.end)?.name;

  const cells: (string | null)[] = [];
  for (let i = 0; i < weekdayIndex(view); i++) cells.push(null);
  for (let d = 0; d < daysInMonth(view); d++) cells.push(addDays(view, d));

  return (
    <div className="cal">
      <div className="calHead">
        <button
          type="button"
          className="calNav"
          aria-label={t.booking.prevMonth}
          disabled={view <= firstMonth}
          onClick={() => setView(addMonths(view, -1))}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="calTitle">
          {t.month[monthKey(view)]} {yearOf(view) + (lang === "th" ? 543 : 0)}
        </span>
        <button
          type="button"
          className="calNav"
          aria-label={t.booking.nextMonth}
          disabled={view >= lastMonth}
          onClick={() => setView(addMonths(view, 1))}
        >
          <Chevron size={12} />
        </button>
      </div>

      <div className="calGrid">
        {WEEK_ORDER.map((w) => (
          <span key={w} className="calDow">
            {t.weekday[w]}
          </span>
        ))}
        {cells.map((iso, i) => {
          if (iso === null) return <span key={`pad${i}`} aria-hidden="true" />;
          const out = iso < today || iso > lastDay;
          const holidayName = holidayOn(iso);
          const closed = !out && (closedWeekday.get(weekday(iso)) === true || holidayName !== undefined);
          const daySlots = slots[iso] ?? [];
          const dayLoad = load[iso] ?? {};
          // "any dentist" still has to mean *capable* dentists: a specialist
          // treatment (one dentist takes it) must grey out that dentist's
          // days off, not light up every day anyone is in.
          const mine =
            dentist === null
              ? daySlots.filter((s) => s.dentistSlug !== null && capable.has(s.dentistSlug))
              : daySlots.filter((s) => s.dentistSlug === dentist);
          const off = !out && !closed && mine.length === 0;
          const full =
            !out && !closed && !off &&
            startTimes(daySlots, dayLoad, chairs, dentist, capable, durationMin, () => false).length === 0;
          return (
            <button
              key={iso}
              type="button"
              className={`calDay${iso === today ? " today" : ""}${date === iso ? " on" : ""}${
                closed ? " off" : ""
              }${off ? " off" : ""}${full ? " full" : ""}${out ? " out" : ""}`}
              disabled={out || closed || off || full}
              onClick={() => onPick(iso)}
              title={holidayName ?? undefined}
            >
              <span className="cdn">{dayOfMonth(iso)}</span>
              {closed ? <span className="cdt">{t.common.closedShort}</span> : null}
              {off ? <span className="cdt">{t.booking.dentistOff}</span> : null}
              {full ? <span className="cdt">{t.booking.full}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════ the flow itself ═════════════════════════ */

export function BookingFlow(props: BookingFlowProps) {
  const { today, nowMin, dentists, openDays, holidays, slots, load, chairs, popular } = props;
  const tr = useTreatments();
  const { t, lang } = useLang();

  /* postpone mode: same treatment and dentist, straight to the calendar, and
     the last step moves the booking rather than creating one */
  const resched = Boolean(props.rescheduleRef && props.preTreatment);
  const handoffRaw = useSyncExternalStore(noSubscribe, readHandoff, () => null);
  const handoff = useMemo(() => {
    if (!resched || !handoffRaw) return null;
    try {
      const h = JSON.parse(handoffRaw) as RescheduleHandoff;
      return h.ref === props.rescheduleRef ? h : null;
    } catch {
      return null;
    }
  }, [resched, handoffRaw, props.rescheduleRef]);
  /** the child on the moved booking — kept here because the handoff is
   *  cleared from storage the moment the move succeeds */
  const [movedChild, setMovedChild] = useState<string | null>(null);

  /** who it's for — asked first; a postponed booking keeps its own */
  const [pickedGroup, setPickedGroup] = useState<AgeGroup | null>(null);
  const group: AgeGroup | null = resched ? (isAgeGroup(handoff?.ageGroup) ? handoff.ageGroup : null) : pickedGroup;

  const [step, setStep] = useState<Step>(resched ? 3 : props.preTreatment ? 2 : 1);
  const [treatment, setTreatment] = useState<TreatmentKey | null>(props.preTreatment ?? null);
  /** null is a real choice here — "any dentist" — so undefined means "not yet" */
  const [dentist, setDentist] = useState<string | null | undefined>(
    props.preDentist ?? (resched ? null : undefined),
  );
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  /** token for the picked slot's temporary reservation (hold-then-confirm) */
  const [holdToken, setHoldToken] = useState<string | null>(null);
  /** the family's LINE sign-in — the booking is stamped with this account */
  const line = useLine();

  // filled in from the last booking on this device; never shown before step 4,
  // so the server render never differs from the first client render
  const [bookName, setBookName] = useState(() => readContact().name);
  const [contactTel, setContactTel] = useState(() => readContact().tel);
  const [contactErr, setContactErr] = useState<string | null>(null);

  const [pending, startBooking] = useTransition();
  const [bookErr, setBookErr] = useState<string | null>(null);
  const [confirmedRef, setConfirmedRef] = useState<string | null>(null);

  const chosen = dentist ? dentists.find((d) => d.slug === dentist) : undefined;
  const roster = treatment ? dentistsForUI(dentists, treatment, group) : dentists;
  /** the picked treatment's length — a 1-hour one holds two half-hour slots */
  const durationMin = treatment ? tr.get(treatment).durationMin : 30;
  /** treatments some dentist offers to this group — the rest aren't shown */
  const offered = (k: TreatmentKey) => dentistsForUI(dentists, k, group).length > 0;
  /** slugs able to do the picked treatment — bounds the calendar in "any" mode */
  const capable = useMemo(() => new Set(roster.map((d) => d.slug)), [roster]);

  /* the free times on the picked day — for a named dentist their own open
     rows; for "any dentist" every clock time whose chair load still has room
     and at least one capable dentist covers (taken or not — a full cover
     just means the booking waits in the pool for a cancellation) */
  const daySlots = useMemo(() => {
    if (!date) return { morning: [] as string[], afternoon: [] as string[] };
    const gone = (hhmm: string) => date === today && minutesOf(hhmm) < nowMin + LEAD;
    const times = startTimes(slots[date] ?? [], load[date] ?? {}, chairs, dentist ?? null, capable, durationMin, gone);
    const cut = (from: number, to: number) =>
      times.filter((hhmm) => minutesOf(hhmm) >= from && minutesOf(hhmm) < to);
    return { morning: cut(0, 720), afternoon: cut(720, 1440) };
  }, [date, dentist, slots, load, chairs, capable, durationMin, today, nowMin]);

  /* the compact price under a treatment name — from the clinic's treatment
     list; "" when the clinic hides that price */
  const priceShort = (k: TreatmentKey) => {
    if (tr.get(k).showPrice === false) return "";
    const p = tr.get(k).price;
    if (p === null) return t.common.quote;
    if (p === 0) return t.common.free;
    return `${p.toLocaleString("en-US")} ${t.common.baht}`;
  };

  /** drop the current slot reservation — the picked slot is about to change */
  function clearHold() {
    if (holdToken) void releaseSlotHold(holdToken);
    setHoldToken(null);
  }

  /** picking a time reserves it server-side for HOLD_MINUTES — if the slot was
   *  just taken, unselect and say so rather than failing at confirm */
  function pickTime(hhmm: string) {
    clearHold();
    setTime(hhmm);
    setBookErr(null);
    if (!treatment || !date) return;
    const dentistId = dentist ? (dentists.find((d) => d.slug === dentist)?.id ?? null) : null;
    void holdSlot({ date, time: hhmm, treatmentKey: treatment, dentistId, ageGroup: group }).then((r) => {
      if (r.ok && r.token) {
        setHoldToken(r.token);
      } else {
        setTime(null);
        setBookErr(t.booking.slotTaken);
      }
    });
  }

  function pickTreatment(k: TreatmentKey) {
    clearHold();
    setTreatment(k);
    // a dentist picked for the previous treatment may not take this one —
    // drop back to the dentist step instead of showing an empty calendar
    if (dentist && !dentistsForUI(dentists, k, group).some((d) => d.slug === dentist)) {
      setDentist(undefined);
      setDate(null);
      setTime(null);
      setStep(2);
      return;
    }
    setStep(dentist === undefined ? 2 : 3);
  }

  /** the first answer: kid or adult. A treatment or dentist carried in from
   *  a link stays only if it fits the group. */
  function pickGroup(g: AgeGroup) {
    clearHold();
    setPickedGroup(g);
    setDate(null);
    setTime(null);
    const t = treatment && dentistsForUI(dentists, treatment, g).length > 0 ? treatment : null;
    const keepDentist =
      t && dentist !== undefined && (dentist === null || dentistsForUI(dentists, t, g).some((d) => d.slug === dentist));
    setTreatment(t);
    if (!keepDentist) setDentist(undefined);
    setStep(!t ? 1 : keepDentist ? 3 : 2);
  }

  /** back to the kid/adult question */
  function changeGroup() {
    clearHold();
    setPickedGroup(null);
  }

  function pickDentist(slug: string | null) {
    clearHold();
    setDentist(slug);
    setStep(3);
  }

  const title =
    !resched && group === null ? t.booking.whoTitle
    : step === 1 ? t.booking.step1
    : step === 2 ? t.booking.step2
    : step === 3 ? t.booking.step3
    : t.booking.contact;

  /** the final write — name + phone checked here, then the server action inserts */
  function confirmBooking() {
    if (!treatment || !date || !time) return;
    if (!bookName.trim()) {
      setContactErr(t.booking.errName);
      return;
    }
    if (!/^[0-9]{9,10}$/.test(contactTel.replace(/\D/g, ""))) {
      setContactErr(t.booking.errTel);
      return;
    }
    setContactErr(null);
    setBookErr(null);
    startBooking(async () => {
      const result = await bookAppointment({
        date,
        time,
        treatmentKey: treatment,
        dentistId: dentist ? (dentists.find((d) => d.slug === dentist)?.id ?? null) : null,
        childName: bookName.trim(),
        phone: contactTel,
        ageGroup: group,
        holdToken: holdToken ?? undefined,
        lineIdToken: line.token ?? undefined,
      });
      if (result.ok && result.ref) {
        setHoldToken(null);
        saveContact(bookName.trim(), contactTel);
        setConfirmedRef(result.ref);
      } else {
        setBookErr(
          result.error === "slot_taken" ? t.booking.slotTaken
          : result.error === "line" ? t.booking.errLine
          : t.booking.bookError,
        );
      }
    });
  }

  /** postpone mode's final write — moves the existing row, keeps its ref */
  function confirmReschedule() {
    if (!props.rescheduleRef || !date || !time || !line.token) return;
    const lineIdToken = line.token;
    setBookErr(null);
    startBooking(async () => {
      const result = await rescheduleBooking({
        ref: props.rescheduleRef!,
        lineIdToken,
        date,
        time,
        holdToken: holdToken ?? undefined,
      });
      if (result.ok && result.ref) {
        setHoldToken(null);
        setMovedChild(handoff?.childName ?? null);
        try {
          sessionStorage.removeItem(RESCHEDULE_KEY);
        } catch {
          // storage blocked — the stale handoff just goes unused
        }
        setConfirmedRef(result.ref);
      } else {
        setBookErr(result.error === "slot_taken" ? t.booking.slotTaken : t.booking.reschedError);
      }
    });
  }

  const booked = confirmedRef !== null;

  return (
    <Screen title={`${t.book} · ${title}`} back="/">
      {booked && treatment && date && time ? (
        <div className="doneWrap">
          <div className="doneArt">
            <Mascot h={96} id="done" />
            <span className="doneTick">
              <Check size={18} />
            </span>
          </div>
          <h2 className="doneTitle">{resched ? t.booking.reschedDone : t.booking.doneTitle}</h2>
          <p className="doneSub">{resched ? t.booking.reschedDoneSub : t.booking.doneSub}</p>

          <Slip
            appt={{
              ref: confirmedRef,
              dateISO: date,
              time: timeRange(time, durationMin),
              treatment,
              dentist: dentist ?? null,
              status: "confirmed",
            }}
            patient={`${(resched ? movedChild : bookName.trim()) || "–"}${group ? ` · ${t.booking[group]}` : ""}`}
            dentistName={chosen?.text[lang].name}
            address={props.address[lang]}
          />

          <div className="doneLinks">
            <Cta href="/bookings">{t.booking.viewBookings}</Cta>
            <Ghost href="/">{t.booking.backHome}</Ghost>
          </div>
        </div>
      ) : line.status === "out" ? (
        <LineSignIn onLogin={line.login} />
      ) : !resched && group === null ? (
        <>
          <Eyebrow>{t.booking.whoTitle}</Eyebrow>
          <p className="hint" style={{ padding: "0 4px 10px" }}>{t.booking.whoSub}</p>
          <div className="pick">
            {(["kid", "adult"] as const).map((g) => (
              <button key={g} type="button" className="pickRow" onClick={() => pickGroup(g)}>
                <span className={`disc ${g === "kid" ? "t-rose" : "t-lav"}`}>
                  <ServiceIcon k={g === "kid" ? "babytooth" : "checkup"} size={26} />
                </span>
                <span className="pt">
                  <span className="pn">{t.booking[g]}</span>
                  <span className="pp">{g === "kid" ? t.booking.kidSub : t.booking.adultSub}</span>
                </span>
                <Chevron />
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {resched ? (
            <div className="reschedNote">
              <span className="rk">{t.booking.reschedFrom}</span>
              <span className="rv">
                {handoff ? `${fmtRelative(t, today, handoff.date)} · ${handoff.time} · ` : ""}
                {props.rescheduleRef}
              </span>
              <span className="rh">{t.booking.reschedHint}</span>
            </div>
          ) : (
            <Stepper step={step} onBack={setStep} />
          )}

          {group && !resched ? (
            <div className="pickedBar">
              <span className={`disc ${group === "kid" ? "t-rose" : "t-lav"}`}>
                <ServiceIcon k={group === "kid" ? "babytooth" : "checkup"} size={23} />
              </span>
              <span className="pt">
                <span className="pn">{t.booking[group]}</span>
                <span className="pp">{group === "kid" ? t.booking.kidSub : t.booking.adultSub}</span>
              </span>
              <button type="button" className="changeBtn" onClick={changeGroup}>
                {t.common.change}
              </button>
            </div>
          ) : null}

          {step > 1 && treatment ? (
            <div className="pickedBar">
              <span className={`disc t-${tr.tint(treatment)}`}>
                <ServiceIcon k={tr.icon(treatment)} size={23} />
              </span>
              <span className="pt">
                <span className="pn">{tr.name(treatment, lang)}</span>
                {priceShort(treatment) ? <span className="pp">{priceShort(treatment)}</span> : null}
              </span>
              {resched ? null : (
                <button type="button" className="changeBtn" onClick={() => setStep(1)}>
                  {t.common.change}
                </button>
              )}
            </div>
          ) : null}

          {step >= 3 && dentist !== undefined ? (
            <div className="pickedBar">
              {chosen ? (
                <DentistAvatar d={chosen} alt={chosen.text[lang].name} size={36} />
              ) : (
                <span className="disc t-lav">
                  <ServiceIcon k="kids" size={23} />
                </span>
              )}
              <span className="pt">
                <span className="pn">{chosen ? chosen.text[lang].name : t.booking.anyone}</span>
                <span className="pp">{chosen ? chosen.text[lang].title : t.booking.anyoneSub}</span>
              </span>
              {resched ? null : (
                <button type="button" className="changeBtn" onClick={() => setStep(2)}>
                  {t.common.change}
                </button>
              )}
            </div>
          ) : null}

          {step === 1 && !tr.list.some((e) => e.isActive && e.key !== "more" && offered(e.key)) ? (
            <p className="hint" style={{ padding: "8px 4px" }}>{t.booking.noTreatments}</p>
          ) : null}

          {step === 1 ? (
            <>
              {popular.some(offered) ? <Eyebrow>{t.booking.popular}</Eyebrow> : null}
              <div className="grid cols4">
                {popular.filter(offered).map((k) => (
                  <button key={k} type="button" className="tile" onClick={() => pickTreatment(k)}>
                    <span className={`disc t-${tr.tint(k)}`}>
                      <ServiceIcon k={tr.icon(k)} size={27} />
                    </span>
                    <span className="label">{tr.name(k, lang)}</span>
                  </button>
                ))}
              </div>

              <Eyebrow>{t.booking.allGroups}</Eyebrow>
              {iconGroups.map((g) => {
                // only treatments the clinic shows on the website
                const items = tr.list.filter((e) => e.isActive && e.group === g && e.key !== "more" && offered(e.key));
                if (items.length === 0) return null;
                return (
                  <div key={g} className="pickGroup">
                    <h3>{t.group[g]}</h3>
                    <div className="pick">
                      {items.map((e) => (
                        <TreatRow key={e.key} k={e.key} onPick={pickTreatment} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Eyebrow>{t.booking.pickDentist}</Eyebrow>
              <div className="pick">
                <button type="button" className="pickRow" onClick={() => pickDentist(null)}>
                  <span className="disc t-lav">
                    <ServiceIcon k="kids" size={26} />
                  </span>
                  <span className="pt">
                    <span className="pn">{t.booking.anyone}</span>
                    <span className="pp">{t.booking.anyoneSub}</span>
                  </span>
                  <Chevron />
                </button>
                {roster.map((d) => (
                  <DentistRow key={d.slug} d={d} onPick={pickDentist} />
                ))}
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Eyebrow>{t.booking.pickDate}</Eyebrow>
              <DayCalendar
                today={today}
                date={date}
                onPick={(iso) => {
                  clearHold();
                  setDate(iso);
                  setTime(null);
                }}
                openDays={openDays}
                holidays={holidays}
                slots={slots}
                dentist={dentist ?? null}
                capable={capable}
                load={load}
                chairs={chairs}
                durationMin={durationMin}
              />
              <p className="hint">{t.booking.closedDay}</p>

              {date ? (
                <>
                  <Eyebrow>{t.booking.pickTime}</Eyebrow>
                  {slotsNeeded(durationMin) > 1 ? (
                    <p className="hint">
                      {lang === "th"
                        ? `บริการนี้ใช้เวลา ${durationTh(durationMin)} — เวลาที่แสดงคือเวลาเริ่ม`
                        : `This takes ${durationMin} minutes — the times shown are start times`}
                    </p>
                  ) : null}
                  <div className="slotWrap">
                    {daySlots.morning.length > 0 ? (
                      <SlotBank label={t.booking.morning} times={daySlots.morning} time={time} onPick={pickTime} />
                    ) : null}
                    {daySlots.afternoon.length > 0 ? (
                      <SlotBank label={t.booking.afternoon} times={daySlots.afternoon} time={time} onPick={pickTime} />
                    ) : null}
                    {daySlots.morning.length === 0 && daySlots.afternoon.length === 0 ? (
                      <p className="hint">{t.booking.fullDay}</p>
                    ) : null}
                    {time && holdToken ? <p className="hint">{t.booking.holdNote}</p> : null}
                  </div>
                </>
              ) : null}

              {resched && bookErr ? <p className="err">{bookErr}</p> : null}

              <div className="stickyBar">
                <div className="sbText">
                  <span className="sbK">{t.common.selected}</span>
                  <span className="sbV">
                    {date ? fmtRelative(t, today, date) : t.booking.pickDate}
                    {time ? ` · ${timeRange(time, durationMin)}` : ""}
                  </span>
                </div>
                {resched ? (
                  <button
                    type="button"
                    className="cta"
                    disabled={!date || !time || pending || line.status !== "in"}
                    onClick={confirmReschedule}
                  >
                    {pending ? t.booking.bookingNow : t.booking.reschedConfirm}
                  </button>
                ) : (
                  <button type="button" className="cta" disabled={!date || !time} onClick={() => setStep(4)}>
                    {t.booking.contact}
                  </button>
                )}
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <Eyebrow>{t.booking.contactSub}</Eyebrow>
              <div className="pick">
                <label className="fld">
                  <span className="fk">{t.booking.contactName}</span>
                  <input
                    className="fi"
                    type="text"
                    autoComplete="nickname"
                    placeholder={t.booking.contactNamePh}
                    value={bookName}
                    onChange={(e) => {
                      setBookName(e.target.value);
                      setContactErr(null);
                    }}
                  />
                </label>
                <label className="fld">
                  <span className="fk">{t.booking.contactTel}</span>
                  <input
                    className="fi"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder={t.booking.contactTelPh}
                    value={contactTel}
                    onChange={(e) => {
                      setContactTel(e.target.value);
                      setContactErr(null);
                    }}
                  />
                </label>
                {contactErr ? <p className="err">{contactErr}</p> : null}
                {bookErr ? <p className="err">{bookErr}</p> : null}
                <p className="hint">{t.booking.contactHint}</p>
              </div>

              <div className="stickyBar">
                <div className="sbText">
                  <span className="sbK">{t.common.selected}</span>
                  <span className="sbV">
                    {date ? fmtRelative(t, today, date) : t.booking.pickDate}
                    {time ? ` · ${timeRange(time, durationMin)}` : ""}
                  </span>
                </div>
                <button type="button" className="ghostBtn" onClick={() => setStep(3)}>
                  {t.booking.backToTime}
                </button>
                <button type="button" className="cta" onClick={confirmBooking} disabled={pending || line.status !== "in"}>
                  {pending ? t.booking.bookingNow : t.booking.confirmBooking}
                </button>
              </div>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
