"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { TreatmentKey } from "@/lib/treatments";
import { useTreatments } from "@/lib/treatmentsContext";
import { useLang } from "@/i18n/lang";
import { fmtShort } from "@/lib/dates";
import { timeRange } from "@/lib/slots";
import { useLine } from "@/lib/useLine";
import { cancelBooking, myBookingsByLine } from "@/server/actions";
import { RESCHEDULE_KEY, type RescheduleHandoff } from "@/components/patient/BookingFlow";
import { Check, Cross } from "@/components/shared/icons";
import { EmptySlip, Eyebrow, LineSignIn, Screen, Slip } from "@/components/patient/screen";
import { BookingsSkeleton } from "@/components/patient/PageLoading";
import { ServiceIcon } from "@/components/shared/serviceIcons";

/**
 * The family's appointments: the next one as the slip itself, then the history
 * as ledger rows.
 *
 * Identity is the LINE account and nothing else — opened from the clinic's
 * LINE OA the family is already signed in; in a normal browser they sign in
 * with LINE first. A phone number is never enough to see anybody's bookings.
 *
 * Cancel asks once more, then marks the appointment cancelled in the DB (staff
 * see it immediately). Postpone hands the booking to the flow at `/book?r=` —
 * same row, same ref, new date/time — so the family never holds two bookings.
 */

type Row = NonNullable<Awaited<ReturnType<typeof myBookingsByLine>>>[number];
type Names = Record<string, { th: string; en: string }>;

function PastRow({ a, names }: { a: Row; names: Names }) {
  const { t, lang } = useLang();
  const tr = useTreatments();
  const dentist = a.dentistSlug ? names[a.dentistSlug]?.[lang] : undefined;
  return (
    <div className={`histRow ${a.status}`}>
      <span className={`disc t-${tr.tint(a.treatmentKey as TreatmentKey)}`}>
        <ServiceIcon k={tr.icon(a.treatmentKey as TreatmentKey)} size={25} />
      </span>
      <span className="hText">
        <span className="hn">{tr.name(a.treatmentKey as TreatmentKey, lang)}</span>
        <span className="hm">
          {fmtShort(t, a.date)} · {timeRange(a.time, a.durationMin)} · {dentist || t.booking.anyone}
        </span>
      </span>
      <span className="hSide">
        <span className={`tag ${a.status === "completed" ? "done" : "off"}`}>
          {a.status === "completed" ? <Check size={10} /> : <Cross size={10} />}
          {a.status === "completed"
            ? t.bookingsPage.done
            : a.status === "no_show"
              ? t.bookingsPage.noshow
              : t.bookingsPage.cancelled}
        </span>
        <a
          href={`/book?t=${a.treatmentKey}${a.dentistSlug ? `&d=${a.dentistSlug}` : ""}`}
          className="againBtn"
        >
          {t.bookingsPage.bookAgain}
        </a>
      </span>
    </div>
  );
}

export function BookingsPage({
  today,
  dentistNames,
  address,
}: {
  today: string;
  dentistNames: Names;
  address: { th: string; en: string };
}) {
  const { t, lang } = useLang();
  const line = useLine();
  const router = useRouter();

  /** null = still loading (or the token was refused — `failed` says which) */
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (line.status !== "in") return;
    let cancelled = false;
    myBookingsByLine(line.token)
      .then((r) => {
        if (cancelled) return;
        if (r) setRows(r);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [line.status, line.token]);

  /** the ref whose "cancel?" question is open, and the one being cancelled */
  const [asking, setAsking] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelErr, setCancelErr] = useState<string | null>(null);

  // the next visit: a live booking from today onwards — confirmed, checked in,
  // or in the chair right now all still belong on the slip
  const live = (s: Row["status"]) => s === "confirmed" || s === "arrived" || s === "in_chair";
  const all = rows ?? [];
  const upcoming = all
    .filter((b) => live(b.status) && b.date >= today)
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
  const history = all
    .filter((b) => !live(b.status) || b.date < today)
    .sort((a, b) => (a.date + a.time > b.date + b.time ? -1 : 1));

  /** the old slot rides in sessionStorage only for the banner on /book */
  function doPostpone(a: Row) {
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
    router.push(`/book?${q.toString()}`);
  }

  async function doCancel(a: Row) {
    if (line.status !== "in") return;
    setCancelling(a.ref);
    setCancelErr(null);
    const r = await cancelBooking(a.ref, line.token).catch(() => ({ ok: false }));
    setCancelling(null);
    setAsking(null);
    if (r.ok) {
      setRows((prev) => (prev ?? []).map((x) => (x.ref === a.ref ? { ...x, status: "cancelled" as const } : x)));
    } else {
      setCancelErr(a.ref);
    }
  }

  if (line.status === "out" || failed) {
    return (
      <Screen title={t.nav.bookings} back="/">
        {failed ? <p className="err">{t.line.failed}</p> : null}
        <LineSignIn onLogin={line.login} />
      </Screen>
    );
  }

  if (rows === null) {
    return (
      <Screen title={t.nav.bookings} back="/">
        <BookingsSkeleton />
      </Screen>
    );
  }

  return (
    <Screen title={t.nav.bookings} back="/">
      {line.name ? <p className="hint" style={{ padding: "0 4px 8px" }}>LINE · {line.name}</p> : null}
      <Eyebrow>{t.bookingsPage.upcoming}</Eyebrow>
      {upcoming.length > 0 ? (
        upcoming.map((a) => (
          <div key={a.ref} className="upNext">
            <Slip
              appt={{
                ref: a.ref,
                dateISO: a.date,
                time: timeRange(a.time, a.durationMin),
                treatment: a.treatmentKey as TreatmentKey,
                dentist: a.dentistSlug,
                status: "confirmed",
              }}
              patient={a.childName}
              dentistName={a.dentistSlug ? dentistNames[a.dentistSlug]?.[lang] : undefined}
              address={address[lang]}
            />
            {/* only a booking nobody has checked in yet can move or be cancelled */}
            {a.status !== "confirmed" ? null : asking === a.ref ? (
              <div className="cancelAsk">
                <span className="caQ">{t.bookingsPage.confirmCancel}</span>
                <div className="twoBtn" style={{ marginTop: 0 }}>
                  <button type="button" className="softBtn" disabled={cancelling === a.ref} onClick={() => setAsking(null)}>
                    {t.bookingsPage.keepIt}
                  </button>
                  <button
                    type="button"
                    className="softBtn solid"
                    disabled={cancelling === a.ref}
                    onClick={() => void doCancel(a)}
                  >
                    {cancelling === a.ref ? "…" : t.bookingsPage.yesCancel}
                  </button>
                </div>
              </div>
            ) : (
              <div className="twoBtn">
                <button type="button" className="softBtn" onClick={() => doPostpone(a)}>
                  {t.bookingsPage.reschedule}
                </button>
                <button
                  type="button"
                  className="softBtn danger"
                  onClick={() => {
                    setCancelErr(null);
                    setAsking(a.ref);
                  }}
                >
                  {t.bookingsPage.cancelBooking}
                </button>
              </div>
            )}
            {cancelErr === a.ref ? <p className="err">{t.bookingsPage.cancelFailed}</p> : null}
          </div>
        ))
      ) : (
        <EmptySlip />
      )}

      <Eyebrow>{t.bookingsPage.past}</Eyebrow>
      <div className="hist">
        {history.map((a) => (
          <PastRow key={a.ref} a={a} names={dentistNames} />
        ))}
        {history.length === 0 ? <p className="hint" style={{ padding: 12 }}>{t.bookingsPage.noPast}</p> : null}
      </div>
    </Screen>
  );
}
