import { fileURLToPath } from "node:url";
import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = path.resolve(here, "../../src");

/**
 * Single source of truth: @/x resolves into the main web app's src, EXCEPT the
 * few files that differ on desktop (api client instead of server actions,
 * react-router sidebar instead of next/link). Everything else — pages,
 * modals, store, i18n — is literally the same file the web console builds.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    // `--mode full` stamps the full-edition feature set into the bundle;
    // every other mode builds the lean queue console
    __STAFF_EDITION__: JSON.stringify(mode === "full" ? "full" : "queue"),
  },
  resolve: {
    alias: [
      { find: "@/server/actions", replacement: path.resolve(here, "src/api.ts") },
      { find: "@/lib/staffEventsConnect", replacement: path.resolve(here, "src/staffEventsConnect.ts") },
      { find: "@/components/staff/shell/StaffSidebar", replacement: path.resolve(here, "src/components/StaffSidebar.tsx") },
      { find: "@/app", replacement: path.resolve(mainSrc, "app") },
      { find: "@/components", replacement: path.resolve(mainSrc, "components") },
      { find: "@/data", replacement: path.resolve(mainSrc, "data") },
      { find: "@/i18n", replacement: path.resolve(mainSrc, "i18n") },
      { find: "@/lib", replacement: path.resolve(mainSrc, "lib") },
      { find: "@/server", replacement: path.resolve(mainSrc, "server") },
      { find: "@/db", replacement: path.resolve(mainSrc, "db") },
    ],
  },
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", target: "es2021" },
}));
