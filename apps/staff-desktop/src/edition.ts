import type { StaffEdition } from "@/lib/staffTypes";

/**
 * Every build carries both editions' screens; the server decides which one a
 * clinic sees (`edition` in the bootstrap, from STAFF_EDITION on the server).
 * This is only the fallback for a server too old to say: "queue", or "full"
 * for a local preview started with `vite --mode full`.
 * Vite's `define` swaps __STAFF_EDITION__ for a string literal; without it
 * the typeof check keeps this from throwing.
 */
declare const __STAFF_EDITION__: string | undefined;

export const STAFF_EDITION: StaffEdition =
  typeof __STAFF_EDITION__ === "string" && __STAFF_EDITION__ === "full" ? "full" : "queue";
