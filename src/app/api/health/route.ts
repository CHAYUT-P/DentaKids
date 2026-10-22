import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * GET /api/health — for the uptime monitor (and anyone checking): is the
 * website up, and can it reach the database? 200 when yes, 503 when the
 * database doesn't answer. Nothing private is returned.
 */
export async function GET() {
  const started = performance.now();
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const dbMs = Math.round(performance.now() - started);
  return NextResponse.json(
    {
      ok: dbOk,
      database: dbOk ? "ok" : "unreachable",
      dbMs,
      version: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
      time: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
