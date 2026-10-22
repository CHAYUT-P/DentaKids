import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { appointment, errorEvent, guardian, messageLog, rateLimit, slotHold } from "@/db/schema";
import { addDays, thaiDate, todayISO } from "@/lib/dates";
import { timeRange } from "@/lib/slots";
import { pushLineText } from "@/server/line";

/**
 * Appointment reminders over LINE — called by Vercel Cron twice a day
 * (vercel.json):
 *
 *   ?kind=day_before  18:00 Bangkok — "tomorrow at …"
 *   ?kind=morning      07:00 Bangkok — "today at …"
 *
 * Auth: Vercel signs cron calls with `Authorization: Bearer $CRON_SECRET`;
 * without the env var set the route stays closed — never public.
 *
 * Idempotent by message_log: a sent reminder is logged with the appointment id
 * and kind, so a retried run sends nothing twice. A failed push isn't logged,
 * so the next run gets another chance at it.
 */

type Kind = "reminder_day_before" | "reminder_morning";

const KINDS: Record<string, Kind> = {
  day_before: "reminder_day_before",
  morning: "reminder_morning",
};

function text(kind: Kind, a: { ref: string; childName: string; date: string; time: string; durationMin: number }) {
  const when = timeRange(a.time, a.durationMin);
  return kind === "reminder_day_before"
    ? `เตือนนัดหมายค่ะ 🦷\nพรุ่งนี้ ${thaiDate(a.date)} เวลา ${when} น. มีนัดของ ${a.childName} นะคะ\nแจ้งชื่อนี้ที่เคาน์เตอร์เมื่อมาถึงได้เลย\nรหัสจอง: ${a.ref}`
    : `วันนี้มีนัดนะคะ ⏰\nนัดของ ${a.childName} เวลา ${when} น. — แวะมาสักเล็กน้อยก่อนเวลาได้เลยค่ะ\nรหัสจอง: ${a.ref}`;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const kind = KINDS[request.nextUrl.searchParams.get("kind") ?? ""];
  if (!kind) return new NextResponse("bad kind", { status: 400 });

  const target = kind === "reminder_day_before" ? addDays(todayISO(), 1) : todayISO();

  // confirmed bookings on the target day that can be reached in LINE — the
  // account that booked, or (older bookings) a LINE-linked guardian
  const rows = await db
    .select({
      id: appointment.id,
      ref: appointment.ref,
      childName: appointment.childName,
      date: appointment.date,
      time: appointment.time,
      durationMin: appointment.durationMin,
      lineUserId: sql<string | null>`coalesce(${appointment.lineUserId}, ${guardian.lineUserId})`,
    })
    .from(appointment)
    .leftJoin(guardian, eq(appointment.guardianId, guardian.id))
    .where(
      and(
        eq(appointment.date, target),
        eq(appointment.status, "confirmed"),
        or(isNotNull(appointment.lineUserId), isNotNull(guardian.lineUserId)),
      ),
    );

  // skip anything this kind already went out for — retries must not re-send
  const sent = rows.length
    ? await db
        .select({ appointmentId: messageLog.appointmentId })
        .from(messageLog)
        .where(and(eq(messageLog.kind, kind), inArray(messageLog.appointmentId, rows.map((r) => r.id))))
    : [];
  const already = new Set(sent.map((s) => s.appointmentId));

  let ok = 0;
  let failed = 0;
  for (const a of rows) {
    if (already.has(a.id) || !a.lineUserId) continue;
    const to = a.lineUserId;
    // one sender per booking and kind: Vercel can deliver the same cron twice,
    // so take a lock, look again, then send and log in the same step
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`remind:${kind}:${a.id}`}))`);
      const [done] = await tx
        .select({ id: messageLog.id })
        .from(messageLog)
        .where(and(eq(messageLog.kind, kind), eq(messageLog.appointmentId, a.id)));
      if (done) return "skipped" as const;
      if (!(await pushLineText(to, text(kind, a)))) return "failed" as const;
      await tx.insert(messageLog).values({ appointmentId: a.id, kind, lineResponse: { to } });
      return "sent" as const;
    });
    if (result === "sent") ok++;
    if (result === "failed") failed++;
  }

  // daily housekeeping (the morning run): tables that would otherwise only
  // grow — expired rate-limit counters and holds, errors not seen for 90 days
  if (kind === "reminder_morning") {
    await db.delete(rateLimit).where(lt(rateLimit.resetAt, new Date(Date.now() - 24 * 3600_000)));
    await db.delete(slotHold).where(lt(slotHold.expiresAt, new Date(Date.now() - 24 * 3600_000)));
    await db.delete(errorEvent).where(lt(errorEvent.lastSeen, new Date(Date.now() - 90 * 24 * 3600_000)));
  }

  return NextResponse.json({ kind, date: target, found: rows.length, sent: ok, failed });
}
