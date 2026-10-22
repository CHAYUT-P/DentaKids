import { staffEventsFetch } from "./api";

/** the desktop app's way to open the live-updates stream: server address + bearer token */
export function connectStaffEvents(signal: AbortSignal): Promise<Response> {
  return staffEventsFetch(signal);
}
