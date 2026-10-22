import { NextResponse, type NextRequest } from "next/server";

import { checkRate } from "@/server/queries";
import { noteWrongPin, staffLoginPaused, staffPinOk, staffToken } from "@/server/staffAuth";

/**
 * Desktop-app login: the staff PIN in, a bearer token out. The token is the
 * same derived value the web console's cookie holds — the PIN itself never
 * leaves this endpoint.
 *
 * Throttled hard (5 tries / 10 min per IP, and a clinic-wide cap on wrong
 * PINs, see staffAuth) because the PIN is short.
 * CORS is open so the Tauri webview (tauri://localhost) can reach it — a
 * caller still needs the real PIN.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!(await checkRate(`stafflogin:${ip}`, 5, 600))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: CORS });
  }
  let pin = "";
  try {
    pin = (await req.json())?.pin ?? "";
  } catch {
    /* malformed body → wrong pin */
  }
  if (await staffLoginPaused()) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: CORS });
  }
  const token = staffToken();
  if (!staffPinOk(pin) || !token) {
    await noteWrongPin();
    return NextResponse.json({ ok: false }, { status: 401, headers: CORS });
  }
  return NextResponse.json({ ok: true, token }, { headers: CORS });
}
