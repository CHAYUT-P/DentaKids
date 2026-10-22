import { connectStaffEvents } from "@/lib/staffEventsConnect";

/**
 * The staff screens' live-updates connection (docs/design/04-live-updates.md):
 * reads the Server-Sent Events stream from /api/staff/events and reports the
 * change numbers it hears. `fetch` streaming rather than EventSource, because
 * EventSource can't send the desktop app's Authorization header.
 *
 *   onSeq(n)  the server's current change number (on every connect, and on
 *             every save) — the store refreshes when n is newer than its data
 *   onDown()  live updates aren't working right now — the store falls back to
 *             polling until the next successful connect
 *
 * A stream the server ends on schedule reconnects at once; a failing one
 * backs off (2 s, 4 s … 30 s). Returns a function that closes it for good.
 */
export function openStaffEvents(h: { onSeq: (seq: number) => void; onDown: () => void }): () => void {
  let closed = false;
  let ctrl: AbortController | null = null;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  void (async () => {
    let failures = 0;
    while (!closed) {
      ctrl = new AbortController();
      let healthy = false;
      try {
        const res = await connectStaffEvents(ctrl.signal);
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let event = "message";
            let data = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (event === "unavailable") throw new Error("live updates unavailable");
            if (event === "hello" || event === "change") {
              healthy = true;
              failures = 0;
              h.onSeq(Number(data) || 0);
            }
          }
        }
      } catch {
        // network error, sign-in expired, server can't LISTEN — handled below
      }
      if (closed) return;
      if (healthy) {
        await sleep(300); // ended on schedule — straight back
      } else {
        failures++;
        h.onDown();
        await sleep(Math.min(30_000, 2000 * 2 ** (failures - 1)));
      }
    }
  })();

  return () => {
    closed = true;
    ctrl?.abort();
  };
}
