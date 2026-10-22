"use client";

import { useEffect } from "react";

import { installErrorReporter } from "@/lib/clientErrors";

/** mounts the browser crash reporter once (see src/lib/clientErrors.ts) */
export function ErrorReporter() {
  useEffect(() => {
    installErrorReporter("/api/client-error", window.location.pathname.startsWith("/staff") ? "staff-app" : "patient-web");
  }, []);
  return null;
}
