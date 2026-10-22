import crypto from "crypto";

import { NextRequest, NextResponse } from "next/server";

import { replyLineText } from "@/server/line";

/**
 * LINE webhook — LINE POSTs events here (follow, message, …). Every request
 * is signed: x-line-signature is base64(HMAC-SHA256(secret, rawBody)), so the
 * raw body must be verified before it is parsed — a forged call gets 401.
 *
 * Configure in the Messaging API channel:
 *   Webhook URL = https://<deploy>/api/line/webhook  →  Save → Verify
 */

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
}

/** keep what families write, for the staff app's แชท LINE */
async function keep(ev: LineEvent) {
  const userId = ev.source?.userId;
  if (!userId || ev.type !== "message" || !ev.message) return;
  const { saveIncoming } = await import("@/server/chat");
  await saveIncoming(userId, ev.message.type, ev.message.text ?? "").catch(() => {});
}

function validSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  // same-length guard before timingSafeEqual throws on length mismatch
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-line-signature"))) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  const { events = [] } = JSON.parse(raw) as { events?: LineEvent[] };

  for (const ev of events) {
    await keep(ev);
    // "myid" → your own LINE user id, for ALERT_LINE_USER_ID (error alerts)
    if (ev.type === "message" && ev.replyToken && ev.message?.text?.trim().toLowerCase() === "myid" && ev.source?.userId) {
      await replyLineText(ev.replyToken, `LINE user id ของคุณ:\n${ev.source.userId}`);
      continue;
    }
    if (ev.type === "follow" && ev.replyToken) {
      // replies are free (push messages are not) — greet every new friend
      await replyLineText(
        ev.replyToken,
        "ขอบคุณที่เพิ่มเพื่อนค่ะ 🦷 กดเมนูด้านล่างเพื่อจองคิวกับ DentaKids ได้เลย",
      );
    }
  }

  // LINE only cares about a fast 200 — retries follow if we stall
  return NextResponse.json({ ok: true });
}
