import { NextRequest, NextResponse } from "next/server";

import { checkRate } from "@/server/queries";
import { reportError } from "@/server/monitor";

/**
 * POST /api/client-error — a crash in the patient website or the staff app,
 * sent by src/lib/clientErrors.ts. Rate-limited per address and size-limited;
 * the desktop app lives on another origin, hence CORS.
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
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await checkRate(`client-error:${ip}`, 20, 600))) {
    return new NextResponse(null, { status: 429, headers: CORS });
  }
  let body: { app?: string; message?: string; stack?: string; where?: string };
  try {
    body = JSON.parse((await req.text()).slice(0, 8000));
  } catch {
    return new NextResponse(null, { status: 400, headers: CORS });
  }
  const source = body.app === "staff-app" ? "staff-app" : "patient-web";
  const err = new Error(String(body.message ?? "unknown").slice(0, 500));
  err.stack = String(body.stack ?? "").slice(0, 4000);
  await reportError(source, err, String(body.where ?? "").slice(0, 300));
  return new NextResponse(null, { status: 204, headers: CORS });
}
