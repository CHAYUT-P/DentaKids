import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Auto-update (docs/design/07-auto-update.md). The app looks for a newer
 * version when it opens and every few hours. If there is one, a slim bar
 * offers it; staff tap "อัปเดตตอนนี้" when it suits them (never mid-patient
 * by surprise). The download is checked against our signing key before it
 * installs, then the app restarts on the new version.
 *
 * Outside the desktop app (the browser preview) there is nothing to update.
 */
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;

const inDesktopApp = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

type Phase =
  | { kind: "idle" }
  | { kind: "offer"; update: Update }
  | { kind: "downloading"; update: Update; pct: number | null }
  | { kind: "failed"; update: Update };

export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [later, setLater] = useState(false);

  useEffect(() => {
    if (!inDesktopApp()) return;
    const look = () =>
      check()
        .then((update) => {
          if (!update) return;
          setPhase((p) => (p.kind === "downloading" ? p : { kind: "offer", update }));
          setLater(false); // "later" lasts until the next check, a few hours
        })
        // offline, or no build for this computer yet — try again next time
        .catch((e) => console.warn("update check failed", e));
    void look();
    const id = setInterval(() => void look(), CHECK_EVERY_MS);
    return () => clearInterval(id);
  }, []);

  const install = async (update: Update) => {
    let total = 0;
    let got = 0;
    setPhase({ kind: "downloading", update, pct: null });
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          setPhase({ kind: "downloading", update, pct: total ? Math.min(100, Math.round((got / total) * 100)) : null });
        }
      });
      // Windows closes the app itself to run the installer; elsewhere restart here
      await relaunch();
    } catch (e) {
      console.error("update failed", e);
      setPhase({ kind: "failed", update });
    }
  };

  if (phase.kind === "idle" || (later && phase.kind === "offer")) return null;
  const v = phase.update.version;

  return (
    <div className="update-bar" role="status">
      {phase.kind === "offer" ? (
        <>
          <span className="update-text">
            <strong>มีเวอร์ชันใหม่ {v}</strong>
            {phase.update.body ? <span className="update-notes"> — {phase.update.body}</span> : null}
          </span>
          <button type="button" className="btn-primary-staff" onClick={() => void install(phase.update)}>
            อัปเดตตอนนี้
          </button>
          <button type="button" className="btn-secondary-staff" onClick={() => setLater(true)}>
            ภายหลัง
          </button>
        </>
      ) : phase.kind === "downloading" ? (
        <span className="update-text">
          <strong>กำลังอัปเดตเป็น {v}</strong>
          {phase.pct !== null ? ` · ${phase.pct}%` : "…"} — แอปจะเปิดใหม่เองเมื่อเสร็จ
        </span>
      ) : (
        <>
          <span className="update-text">
            <strong>อัปเดตไม่สำเร็จ</strong> — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ (ใช้งานเวอร์ชันเดิมต่อได้ตามปกติ)
          </span>
          <button type="button" className="btn-secondary-staff" onClick={() => void install(phase.update)}>
            ลองใหม่
          </button>
        </>
      )}
    </div>
  );
}
