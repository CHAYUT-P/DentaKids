/**
 * Live updates vs polling — measured against a running production build
 * (docs/design/04-live-updates.md). Run:
 *
 *   pnpm build && PORT=3002 DATABASE_URL=<bench db> pnpm start   # one terminal
 *   BASE=http://localhost:3002 pnpm bench:live                    # another
 *
 * Measures:
 *   1. one full staff-data download (what polling fetched every 20 s)
 *   2. save → other screens hear about it (20 real saves, timed)
 *   3. the live stream's cost while nothing happens (reconnects + pings)
 */
import "dotenv/config";
import { createHash } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3002";
const IDLE_SEC = Number(process.env.IDLE_SEC ?? 120);
const POLL_SEC = 20;
const pin = process.env.STAFF_PIN ?? "";
const token = createHash("sha256").update(`dk-staff-v1:${pin}`).digest("hex");
const auth = { Authorization: `Bearer ${token}` };

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)];
const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

async function staff(action: string, args: unknown[] = []) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/staff`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ action, args }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${action}: HTTP ${res.status} ${text.slice(0, 120)}`);
  return { bytes: Buffer.byteLength(text), ms: performance.now() - t0 };
}

/** one SSE connection: calls onEvent for each event, resolves when the server ends it */
async function stream(onEvent: (event: string, data: string) => void, signal: AbortSignal) {
  const res = await fetch(`${BASE}/api/staff/events`, { headers: auth, signal });
  if (!res.ok || !res.body) throw new Error(`events: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    buf += dec.decode(value, { stream: true });
    for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "ping";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      onEvent(event, data);
    }
  }
  return bytes;
}

async function main() {
  console.log(`Live updates benchmark → ${BASE}\n`);

  // 1. the full download polling did every 20 s
  const boots = [];
  for (let i = 0; i < 5; i++) boots.push(await staff("bootstrap"));
  const bootBytes = median(boots.map((b) => b.bytes));
  const bootMs = median(boots.map((b) => b.ms));
  console.log(`1. full staff-data download: ${kb(bootBytes)}, ${Math.round(bootMs)} ms (median of 5)`);

  // 2. save → other screens hear about it
  let waiter: ((t: number) => void) | null = null;
  const ctrl = new AbortController();
  let hello = false;
  const live = stream((event) => {
    if (event === "hello") hello = true;
    if (event === "change" && waiter) {
      const w = waiter;
      waiter = null;
      w(performance.now());
    }
  }, ctrl.signal).catch(() => 0);
  for (let i = 0; i < 50 && !hello; i++) await new Promise((r) => setTimeout(r, 100));
  if (!hello) throw new Error("no hello from /api/staff/events");
  const delays: number[] = [];
  for (let i = 0; i < 20; i++) {
    const heard = new Promise<number>((r) => (waiter = r));
    const t0 = performance.now();
    await staff("markNotificationsRead"); // a real save that every screen should hear about
    delays.push((await heard) - t0);
    await new Promise((r) => setTimeout(r, 100));
  }
  ctrl.abort();
  await live;
  console.log(
    `2. save → other screens notified: median ${Math.round(median(delays))} ms, p95 ${Math.round(p95(delays))} ms (20 saves)`,
  );
  console.log(`   + one download to show it: ~${Math.round(bootMs)} ms → fresh on screen in ~${Math.round(median(delays) + bootMs)} ms`);

  // 3. idle cost of the live connection
  console.log(`3. idle for ${IDLE_SEC} s with the live connection open…`);
  const until = Date.now() + IDLE_SEC * 1000;
  let connects = 0;
  let idleBytes = 0;
  while (Date.now() < until) {
    connects++;
    const c = new AbortController();
    const stopAt = setTimeout(() => c.abort(), Math.max(0, until - Date.now()));
    idleBytes += await stream(() => {}, c.signal).catch(() => 0);
    clearTimeout(stopAt);
  }
  const perHour = 3600 / IDLE_SEC;
  const liveReqH = Math.round(connects * perHour);
  const liveBytesH = idleBytes * perHour;
  const pollReqH = 3600 / POLL_SEC;
  const pollBytesH = pollReqH * bootBytes;

  console.log(`   ${connects} connections, ${idleBytes} bytes in ${IDLE_SEC} s\n`);
  console.log("Per open staff screen, per hour, nothing changing:");
  console.log(`  polling every ${POLL_SEC} s : ${pollReqH} requests, ${mb(pollBytesH)} downloaded`);
  console.log(`  live updates      : ${liveReqH} requests, ${kb(liveBytesH)} downloaded`);
  console.log(
    `  → ${Math.round((1 - liveReqH / pollReqH) * 100)}% fewer requests, ${Math.round((1 - liveBytesH / pollBytesH) * 1000) / 10}% less data`,
  );
  console.log("Each save adds one download per screen (only when something changed).");
  console.log(`Update delay: polling ${POLL_SEC / 2} s on average (up to ${POLL_SEC} s) → live ~${Math.round(median(delays) + bootMs)} ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
