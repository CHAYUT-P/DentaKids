import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

import { cookies } from "next/headers";

/**
 * Staff gate — the /staff pages and every staff* action check this.
 *
 * A single shared PIN (env `STAFF_PIN`, min 6 chars) is what reception types;
 * a successful login stores an httpOnly cookie holding a hash derived from the
 * PIN, so the raw PIN never travels or sits in the browser. Missing or short
 * `STAFF_PIN` fails closed — nothing staff-side runs without it.
 *
 * Deliberately simple (one PIN for the whole front desk, not per-user): the
 * clinic's real identity model arrives with a future accounts system; this
 * closes the "anyone on the internet can open /staff" hole today.
 */

const COOKIE = "dk_staff";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** the value the cookie must hold — derived, never the PIN itself */
function expected(): string | null {
  const pin = process.env.STAFF_PIN;
  if (!pin || pin.length < 6) return null;
  return crypto.createHash("sha256").update(`dk-staff-v1:${pin}`).digest("hex");
}

export async function isStaffAuthed(): Promise<boolean> {
  // local dev is trusted — Vercel preview/production builds run NODE_ENV=production
  if (process.env.NODE_ENV !== "production") return true;
  let got: string | undefined;
  try {
    got = (await cookies()).get(COOKIE)?.value;
  } catch {
    // no request scope — a local script (seed/e2e) calling the action directly.
    // Over HTTP there is always a request context, so this can't be reached
    // by an unauthenticated request.
    return true;
  }
  const want = expected();
  if (!want || !got || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/**
 * Verified-by-the-route context: /api/staff validates the bearer token once,
 * then runs the real actions inside this scope — the actions' own requireStaff
 * sees the store and passes. Keeps a single implementation of each staff op;
 * the API never reimplements them.
 */
const staffScope = new AsyncLocalStorage<{ userToken: string }>();

/** `userToken` = the signed-in person on that device (full edition), if any */
export function withStaffToken<T>(fn: () => Promise<T>, userToken = ""): Promise<T> {
  return staffScope.run({ userToken }, fn);
}

/** throws — every staff action calls this before touching data */
export async function requireStaff(): Promise<void> {
  if (staffScope.getStore()) return; // the API route already checked the token
  if (!(await isStaffAuthed())) throw new Error("staff auth required");
}

/** constant-time PIN check — called by the login action only */
export function staffPinOk(pin: string): boolean {
  const want = process.env.STAFF_PIN;
  if (!want || want.length < 6) return false;
  const a = Buffer.from(pin);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** called inside the login action after a good PIN — sets the session cookie */
export async function staffGrantCookie(): Promise<void> {
  const value = expected();
  if (!value) return;
  (await cookies()).set(COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

/** sign-out — clears the cookie on this device */
export async function staffClearCookie(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** the bearer token the desktop app sends — same derived value as the cookie */
export function staffToken(): string | null {
  return expected();
}

/** constant-time bearer-token check for /api/staff */
export function staffTokenOk(token: string): boolean {
  const want = expected();
  if (!want || token.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(want));
}

/* ── the person using the app (full edition) ───────────────────────────── */

const USER_COOKIE = "dk_user";
const USER_TTL = 60 * 60 * 14; // a working day, then sign in again

function userSecret(): string {
  return crypto
    .createHash("sha256")
    .update(`dk-user-v1:${process.env.STAFF_PIN ?? "dev-only-secret"}`)
    .digest("hex");
}

/** a signed "who is this" token: base64url(json) + "." + hmac */
export function signUserToken(userId: number): string {
  const body = Buffer.from(JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + USER_TTL })).toString("base64url");
  const mac = crypto.createHmac("sha256", userSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** the user id inside a valid, unexpired token — null otherwise */
export function readUserToken(token: string): number | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = crypto.createHmac("sha256", userSecret()).update(body).digest("base64url");
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(body, "base64url").toString()) as { uid: number; exp: number };
    return exp > Date.now() / 1000 ? uid : null;
  } catch {
    return null;
  }
}

/** this request's user token — the desktop sends a header, the web a cookie */
export async function currentUserToken(): Promise<string> {
  const scoped = staffScope.getStore();
  if (scoped) return scoped.userToken;
  try {
    return (await cookies()).get(USER_COOKIE)?.value ?? "";
  } catch {
    return "";
  }
}

export async function setUserCookie(token: string): Promise<void> {
  if (staffScope.getStore()) return; // desktop keeps its own copy
  try {
    const jar = await cookies();
    if (token) {
      jar.set(USER_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: USER_TTL,
      });
    } else jar.delete(USER_COOKIE);
  } catch {
    // no request scope (script)
  }
}

/**
 * Clinic-wide guard on wrong PINs, on top of the per-address limit: someone
 * using many addresses could otherwise keep guessing. After
 * WRONG_PINS_PER_HOUR wrong PINs from anywhere, PIN sign-in pauses until the
 * hour is up (screens already signed in keep working — their token stays
 * valid) and the developer gets an alert. At this rate a 6-digit PIN would
 * take years to guess.
 */
const WRONG_PINS_PER_HOUR = 100;
const WRONG_PIN_KEY = "stafflogin-wrong:all";

export async function staffLoginPaused(): Promise<boolean> {
  const { rateExceeded } = await import("@/server/queries");
  return rateExceeded(WRONG_PIN_KEY, WRONG_PINS_PER_HOUR);
}

export async function noteWrongPin(): Promise<void> {
  const { checkRate } = await import("@/server/queries");
  const within = await checkRate(WRONG_PIN_KEY, WRONG_PINS_PER_HOUR, 3600);
  if (!within) {
    const { reportError } = await import("@/server/monitor");
    await reportError("server", new Error("staff sign-in paused: too many wrong PINs this hour"), "staff login");
  }
}
