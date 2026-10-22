import "server-only";

import postgres from "postgres";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { clinicSetting } from "@/db/schema";

/**
 * Live updates for the staff screens (docs/design/04-live-updates.md).
 *
 * Every save bumps one counter, `change_seq`, and announces the new number on
 * the Postgres channel `dk_changes` (LISTEN/NOTIFY). Each server instance
 * keeps ONE listening connection and fans the news out to its open staff
 * screens (/api/staff/events). A screen re-downloads only when the number it
 * hears is newer than the data it has, and every (re)connect starts by
 * telling it the current number, so a change made while it was reconnecting
 * is never missed.
 *
 * Postgres is the message bus on purpose: it already connects every server
 * instance (Vercel functions, or the VPS), so there is nothing new to run.
 */

const CHANNEL = "dk_changes";
const SEQ_KEY = "change_seq";

/** something was saved: bump the counter and tell every listening server */
export async function notifyChange(): Promise<void> {
  try {
    const rows = await db
      .insert(clinicSetting)
      .values({ key: SEQ_KEY, value: "1" })
      .onConflictDoUpdate({
        target: clinicSetting.key,
        set: { value: sql`(${clinicSetting.value}::bigint + 1)::text`, updatedAt: new Date() },
      })
      .returning({ value: clinicSetting.value });
    await db.execute(sql`select pg_notify(${CHANNEL}, ${rows[0].value})`);
  } catch (e) {
    // live updates are a convenience — a failed announcement never fails the save;
    // screens still catch up on their next reconnect
    console.error("[changes] notify failed:", e);
  }
}

/** the current change number (0 before the first save) */
export async function currentChangeSeq(): Promise<number> {
  const [row] = await db.select({ value: clinicSetting.value }).from(clinicSetting).where(eq(clinicSetting.key, SEQ_KEY));
  return Number(row?.value ?? 0) || 0;
}

type Listener = (seq: number) => void;
const hub = globalThis as unknown as {
  __dkChanges?: { listeners: Set<Listener>; ready?: Promise<void>; conn?: ReturnType<typeof postgres> };
};

/**
 * LISTEN needs a real session, which connection poolers in transaction mode
 * (Neon's "-pooler" host, PgBouncer) don't provide — use the direct host.
 */
function directUrl(): string {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "";
  return url.replace("-pooler.", ".");
}

function state() {
  return (hub.__dkChanges ??= { listeners: new Set() });
}

async function ensureListening(): Promise<void> {
  const s = state();
  if (!s.ready) {
    s.conn = postgres(directUrl(), { max: 1, idle_timeout: 0, onnotice: () => {} });
    s.ready = s.conn
      .listen(CHANNEL, (payload) => {
        const seq = Number(payload) || 0;
        for (const fn of s.listeners) fn(seq);
      })
      .then(() => undefined)
      .catch(async (e) => {
        // let the next screen try again rather than caching the failure
        s.ready = undefined;
        await s.conn?.end({ timeout: 1 }).catch(() => {});
        s.conn = undefined;
        throw e;
      });
  }
  return s.ready;
}

/** hear every change while subscribed; returns the unsubscribe */
export async function subscribeChanges(fn: Listener): Promise<() => void> {
  await ensureListening();
  state().listeners.add(fn);
  return () => {
    state().listeners.delete(fn);
  };
}
