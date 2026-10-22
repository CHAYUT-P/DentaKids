/**
 * A fresh idempotency key: one per booking attempt / payment, made on the
 * screen and sent with the request. The server remembers it with the row it
 * creates, so the same request arriving twice (a double tap, a retry after a
 * dropped connection) finds that row instead of making a second one.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // older browsers: still unique enough for one clinic's requests
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}
