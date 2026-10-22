/**
 * Send crashes in the browser (the patient website, the staff app) to
 * /api/client-error, so they show up in the error log and alerts like server
 * errors do. Each distinct message is sent once per page load, and noise the
 * clinic can't act on (browser extensions, cross-origin "Script error.") is
 * skipped.
 */
let installed = false;

export function installErrorReporter(endpoint: string, app: "patient-web" | "staff-app") {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const sent = new Set<string>();
  const send = (message: string, stack = "") => {
    if (!message || message === "Script error." || /ResizeObserver loop|extension:\/\//.test(message + stack)) return;
    if (sent.has(message) || sent.size >= 5) return;
    sent.add(message);
    const body = JSON.stringify({ app, message, stack, where: window.location.pathname + window.location.hash });
    try {
      void fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    } catch {
      // reporting must never cause a second error
    }
  };
  window.addEventListener("error", (e) => send(e.message, e.error instanceof Error ? e.error.stack : ""));
  window.addEventListener("unhandledrejection", (e) => {
    const r: unknown = e.reason;
    send(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : "");
  });
}
