"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The family's LINE sign-in on the patient site. The site is a LIFF app inside
 * the clinic's LINE OA, so opened from LINE the family is already signed in;
 * opened in a normal browser they tap "sign in with LINE" once. Everything
 * personal — booking, my bookings, cancel, postpone, messages — rides on the
 * ID token this hands out, which the server verifies with LINE.
 *
 * status: "loading" while LIFF starts · "in" signed in · "out" needs sign-in.
 * Without NEXT_PUBLIC_LIFF_ID (local dev only) it reports "in" with a stand-in
 * token the dev server accepts.
 */
export type LineState =
  | { status: "loading" | "out"; token: null; name: null }
  | { status: "in"; token: string; name: string | null };

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID;
const DEV: LineState = { status: "in", token: "local-dev", name: null };

/** outside LINE liff.init() has been seen to never settle — give up after this */
const INIT_TIMEOUT_MS = 4000;

export function useLine(): LineState & { login: () => void; relogin: () => void } {
  const [state, setState] = useState<LineState>(LIFF_ID ? { status: "loading", token: null, name: null } : DEV);

  useEffect(() => {
    if (!LIFF_ID) return;
    let cancelled = false;
    const giveUp = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("liff timeout")), INIT_TIMEOUT_MS));
    import("@line/liff")
      .then(async ({ default: liff }) => {
        await Promise.race([liff.init({ liffId: LIFF_ID }), giveUp]);
        const token = liff.isLoggedIn() ? liff.getIDToken() : null;
        if (cancelled) return;
        if (!token) {
          setState({ status: "out", token: null, name: null });
          return;
        }
        setState({ status: "in", token, name: null });
        const profile = await liff.getProfile().catch(() => null);
        if (!cancelled && profile) setState({ status: "in", token, name: profile.displayName });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "out", token: null, name: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(() => {
    if (!LIFF_ID) return;
    void import("@line/liff").then(async ({ default: liff }) => {
      try {
        await liff.init({ liffId: LIFF_ID });
      } catch {
        // already initialised, or LINE unreachable — login() below decides
      }
      // come back to this same page (and its query) after LINE's sign-in
      liff.login({ redirectUri: window.location.href });
    });
  }, []);

  /**
   * The server refused the token (it expired while the page sat open): get a
   * fresh one. Inside LINE, reopening the page issues a new token; in a
   * browser, sign out and back in. Either way the family lands on this page.
   */
  const relogin = useCallback(() => {
    if (!LIFF_ID) return;
    void import("@line/liff").then(async ({ default: liff }) => {
      try {
        await liff.init({ liffId: LIFF_ID });
      } catch {
        // already initialised, or LINE unreachable
      }
      if (liff.isInClient()) {
        window.location.reload();
        return;
      }
      if (liff.isLoggedIn()) liff.logout();
      liff.login({ redirectUri: window.location.href });
    });
  }, []);

  return { ...state, login, relogin };
}
