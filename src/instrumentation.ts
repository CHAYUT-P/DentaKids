import type { Instrumentation } from "next";

/**
 * Every error the Next.js server catches — a page that fails to render, a
 * route handler or server action that throws — goes to the error log and,
 * for a new kind of error, a LINE alert (src/server/monitor.ts).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // the database client is Node-only
  const { reportError } = await import("@/server/monitor");
  await reportError("server", err, `${context.routeType} ${request.method} ${request.path.split("?")[0]}`);
};
