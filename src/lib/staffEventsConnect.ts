/**
 * How the staff screens open the live-updates stream — the web console signs
 * in with its cookie. The desktop app swaps this file for its own (bearer
 * token, server address): apps/staff-desktop/src/staffEventsConnect.ts.
 */
export function connectStaffEvents(signal: AbortSignal): Promise<Response> {
  return fetch("/api/staff/events", { credentials: "same-origin", cache: "no-store", signal });
}
