import "server-only";

import { eq, isNull, and } from "drizzle-orm";

import { db } from "@/db/client";
import { guardian } from "@/db/schema";

/**
 * The LINE side of the app — three jobs:
 *
 * · verifyLineIdToken — the LIFF page hands us the ID token LINE signed; we
 *   ask LINE to verify it and tell us which user it belongs to. Never trust a
 *   userId posted from the browser — only the verified `sub` counts.
 * · linkGuardianLine — once a booking succeeds we stamp the verified userId
 *   onto the guardian row; later visits skip phone lookup entirely.
 * · pushLineText — booking confirmations and reminders land in the patient's
 *   LINE chat. Push messages count against the monthly quota; replies (the
 *   webhook uses those) are free.
 *
 * All three degrade to no-ops when the env vars are absent so local dev and
 * the pre-LINE deploy keep working unchanged.
 */

const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

export interface LineIdentity {
  /** the `sub` claim — the user's LINE userId, scoped to our provider */
  userId: string;
  displayName: string;
}

/**
 * Verify a LIFF ID token against LINE. Returns the identity when valid, null
 * when LINE rejects it or LINE isn't configured — callers treat null as
 * "booked without LINE", not as an error.
 */
export async function verifyLineIdToken(idToken: string): Promise<LineIdentity | null> {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId || !idToken) return null;

  try {
    const res = await fetch(LINE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { sub?: string; name?: string };
    if (!data.sub) return null;
    return { userId: data.sub, displayName: data.name ?? "" };
  } catch {
    // LINE unreachable or slow — same as "not verified"; callers ask to retry
    return null;
  }
}

/**
 * Stamp a verified LINE userId onto a guardian. The unique index makes one
 * LINE account one guardian — if it's already linked to a different row we
 * leave the old link alone rather than hijack the account.
 */
export async function linkGuardianLine(guardianId: number, identity: LineIdentity): Promise<void> {
  const taken = await db
    .select({ id: guardian.id })
    .from(guardian)
    .where(eq(guardian.lineUserId, identity.userId));
  if (taken.length > 0 && taken[0].id !== guardianId) return;

  await db
    .update(guardian)
    .set({ lineUserId: identity.userId, updatedAt: new Date() })
    .where(and(eq(guardian.id, guardianId), isNull(guardian.lineUserId)));
}

/**
 * push a text message into a patient's LINE chat (counts toward quota). What
 * went out is kept with the conversation the staff app shows (แชท LINE).
 */
export async function pushLineText(toUserId: string, text: string, from = "ระบบอัตโนมัติ"): Promise<boolean> {
  const ok = await postLine(LINE_PUSH_URL, { to: toUserId, messages: [{ type: "text", text }] });
  if (ok) {
    const { lineMessage } = await import("@/db/schema");
    await db
      .insert(lineMessage)
      .values({ lineUserId: toUserId, direction: "out", text: text.slice(0, 4000), staffName: from.slice(0, 60) })
      .catch(() => {});
  }
  return ok;
}

/** an operations alert to the developer's own LINE — not a patient message,
 *  so it is not recorded in the clinic's chat inbox */
export async function pushLineAlert(toUserId: string, text: string): Promise<boolean> {
  return postLine(LINE_PUSH_URL, { to: toUserId, messages: [{ type: "text", text: text.slice(0, 2000) }] });
}

/** reply inside the webhook window — free, but the token dies in ~1 minute */
export async function replyLineText(replyToken: string, text: string): Promise<boolean> {
  return postLine(LINE_REPLY_URL, { replyToken, messages: [{ type: "text", text }] });
}

async function postLine(url: string, body: unknown): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    // a message that can't go out never fails the booking or the batch it is in
    return false;
  }
}
