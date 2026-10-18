import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { dentist } from "@/db/schema";

/**
 * GET /api/dentist-photo/<slug>/<small|large> — a dentist's uploaded photo.
 *
 * Photos are stored in the dentist row as data URLs (resized in the staff app
 * before upload), but pages never carry them inline: the dentist list hands
 * out this address instead, with ?v=<last edit> so a new photo is a new URL
 * and the old one can be cached for good.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string; size: string }> }) {
  const { slug, size } = await ctx.params;
  if (size !== "small" && size !== "large") return new NextResponse("not found", { status: 404 });

  const [row] = await db
    .select({ small: dentist.photoSmall, large: dentist.photoLarge })
    .from(dentist)
    .where(eq(dentist.slug, slug));
  const value = row?.[size] ?? "";

  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(value);
  if (!m) return new NextResponse("not found", { status: 404 });

  return new NextResponse(Buffer.from(m[2], "base64"), {
    headers: {
      "Content-Type": m[1],
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
