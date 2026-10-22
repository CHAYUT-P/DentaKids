import { NextRequest } from "next/server";

import { currentChangeSeq, subscribeChanges } from "@/server/changes";
import { isStaffAuthed, staffTokenOk } from "@/server/staffAuth";

/**
 * GET /api/staff/events — a Server-Sent Events stream for the staff screens:
 *
 *   event: hello   data: <change number now>    (first thing, every connect)
 *   event: change  data: <new change number>    (whenever anything is saved)
 *   : ping                                        (every 20 s, keeps proxies open)
 *
 * The stream ends after SSE_STREAM_SECONDS (default 55, inside serverless
 * time limits) and the screen reconnects at once; the hello on reconnect is
 * what guarantees nothing is missed in between. On a long-running server
 * (the VPS) it can be set much higher. STAFF_LIVE_UPDATES=off switches it off:
 * every screen falls back to polling every 20 s, no deploy needed.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STREAM_MS = Math.max(10, Number(process.env.SSE_STREAM_SECONDS ?? 55)) * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization",
  // one preflight per day, not one per reconnect
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  // the desktop app sends its bearer token; the web console has its cookie
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!(token ? staffTokenOk(token) : await isStaffAuthed())) {
    return new Response("unauthorized", { status: 401, headers: CORS });
  }

  const enc = new TextEncoder();
  let stop: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          open = false;
        }
      };

      let unsubscribe: () => void = () => {};
      try {
        if (process.env.STAFF_LIVE_UPDATES === "off") throw new Error("switched off");
        unsubscribe = await subscribeChanges((seq) => send(`event: change\ndata: ${seq}\n\n`));
      } catch {
        // switched off, or LISTEN isn't possible here — the screen falls back to polling
        send("event: unavailable\ndata: listen\n\n");
        controller.close();
        return;
      }
      send(`retry: 1000\nevent: hello\ndata: ${await currentChangeSeq()}\n\n`);

      const ping = setInterval(() => send(": ping\n\n"), 20_000);
      const end = () => {
        if (!open) return;
        open = false;
        clearInterval(ping);
        clearTimeout(timer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      const timer = setTimeout(end, STREAM_MS);
      req.signal.addEventListener("abort", end);
      stop = end;
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
