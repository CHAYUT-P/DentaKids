import "server-only";

import { createHash } from "node:crypto";
import { desc, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { errorEvent } from "@/db/schema";

/**
 * Error tracking without a third-party service. Every error the system hits —
 * a server crash (instrumentation.ts), a failed staff-API call, a crash in
 * the patient website or the staff app (/api/client-error) — is grouped by a
 * fingerprint and counted in `error_event`.
 *
 * A NEW kind of server error (or one not alerted in the last hour) sends a
 * LINE message to ALERT_LINE_USER_ID, so the developer hears about it before
 * the clinic calls. At most MAX_ALERTS_PER_HOUR / MAX_ALERTS_PER_DAY go out:
 * alerts use the clinic OA's monthly message quota, which booking
 * confirmations and reminders need.
 *
 * Browser-reported errors are recorded and shown in the staff app, but never
 * alert on their own: anyone can post to /api/client-error, so letting them
 * alert would let a stranger spend the clinic's LINE quota and write the text
 * of messages to the developer's phone.
 *
 * Reporting must never make things worse: it never throws.
 */

const ALERT_EVERY_MS = 60 * 60 * 1000;
const MAX_ALERTS_PER_HOUR = 10;
const MAX_ALERTS_PER_DAY = 20;
const ALERTING: ErrorSource[] = ["server", "staff-api"];

export type ErrorSource = "server" | "staff-api" | "patient-web" | "staff-app";

/** the same error with different ids, refs or times groups into one row */
function fingerprintOf(source: string, where: string, message: string): string {
  const blurred = message
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>")
    .replace(/DK-\d+|W-\d+/g, "<ref>")
    .replace(/\d+/g, "#");
  const place = where.replace(/\d+/g, "#").replace(/\?.*$/, "");
  return createHash("sha1").update(`${source}|${place}|${blurred}`).digest("hex").slice(0, 24);
}

export async function reportError(source: ErrorSource, err: unknown, where = ""): Promise<void> {
  try {
    const message = (err instanceof Error ? err.message : String(err ?? "unknown")).slice(0, 500) || "unknown";
    const detail = err instanceof Error ? (err.stack ?? "").slice(0, 4000) : "";
    const fingerprint = fingerprintOf(source, where, message);
    console.error(`[${source}] ${where} — ${message}`);

    const [row] = await db
      .insert(errorEvent)
      .values({ fingerprint, source, message, where: where.slice(0, 300), detail })
      .onConflictDoUpdate({
        target: errorEvent.fingerprint,
        set: { count: sql`${errorEvent.count} + 1`, lastSeen: new Date(), message, detail },
      })
      .returning();

    const to = process.env.ALERT_LINE_USER_ID;
    const due = !row.alertedAt || Date.now() - row.alertedAt.getTime() > ALERT_EVERY_MS;
    if (!to || !due || !ALERTING.includes(source)) return;
    // count the alerts actually sent — one error repeating every hour is
    // still one alert per hour, and they all spend the OA's message quota
    const { checkRate } = await import("@/server/queries");
    if (!(await checkRate("alerts:hour", MAX_ALERTS_PER_HOUR, 3600))) return;
    if (!(await checkRate("alerts:day", MAX_ALERTS_PER_DAY, 24 * 3600))) return;

    const { pushLineAlert } = await import("@/server/line");
    const sent = await pushLineAlert(
      to,
      `⚠️ Denta Kids — ระบบมีข้อผิดพลาด\n${message}\nที่: ${where || source}\nแหล่ง: ${source} · ครั้งที่ ${row.count}`,
    );
    if (sent) await db.update(errorEvent).set({ alertedAt: new Date() }).where(sql`${errorEvent.id} = ${row.id}`);
  } catch (e) {
    // the database itself may be what's down — the console still has it
    console.error("[monitor] could not record an error:", e);
  }
}

/** the latest errors, newest first — the staff app's สถานะระบบ card */
export async function recentErrors(limit = 10) {
  return db
    .select({
      source: errorEvent.source,
      message: errorEvent.message,
      where: errorEvent.where,
      count: errorEvent.count,
      lastSeen: errorEvent.lastSeen,
    })
    .from(errorEvent)
    .orderBy(desc(errorEvent.lastSeen))
    .limit(limit);
}
