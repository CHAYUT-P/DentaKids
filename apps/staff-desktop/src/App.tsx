import { useCallback, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";

import { CrashScreen } from "./components/CrashScreen";
import { LoginScreen } from "./components/LoginScreen";
import { StaffSidebar } from "./components/StaffSidebar";
import { API_BASE, ensureStaffToken, hasStaffToken, staffBootstrap, type StaffBootstrap } from "./api";
import { STAFF_EDITION } from "./edition";
import { installErrorReporter } from "@/lib/clientErrors";

// crashes in this app go to the same error log and alerts as the server's
installErrorReporter(`${API_BASE}/api/client-error`, "staff-app");

import { DeviceGate } from "@/components/staff/shell/DeviceGate";
import { CashierView } from "@/components/staff/billing/CashierView";
import { StockView } from "@/components/staff/stock/StockView";
import { ReportsView } from "@/components/staff/reports/ReportsView";
import { ChatView } from "@/components/staff/chat/ChatView";
import { RoomPage } from "@/components/staff/rooms/RoomPage";
import { ScheduleView } from "@/components/staff/schedule/ScheduleView";
import { SetupView } from "@/components/staff/settings/SetupView";
import { StaffTopbar } from "@/components/staff/shell/StaffTopbar";
import { StaffProvider } from "@/lib/staffStore";
import { StaffUserGate } from "@/lib/staffUser";
import { LangProvider } from "@/i18n/lang";

import PatientsPage from "@/app/staff/patients/page";
import TodayPage from "@/app/staff/queue/page";

import "@/app/staff/staff.css";

/**
 * The staff console, standalone: same pages/sidebar/topbar/store the web
 * version renders, fed by /api/staff instead of server actions. No token →
 * the PIN screen; token → bootstrap once, then the store refreshes after
 * every mutation exactly like the web.
 */
export default function App() {
  const [authed, setAuthed] = useState(hasStaffToken());
  const [silentFailed, setSilentFailed] = useState(false);
  const [initial, setInitial] = useState<StaffBootstrap | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  // clinic builds carry the PIN — exchange it silently; no PIN → manual screen
  useEffect(() => {
    if (authed) return;
    void ensureStaffToken().then((ok) => {
      if (ok) setAuthed(true);
      else setSilentFailed(true);
    });
  }, [authed]);

  const load = useCallback(() => {
    staffBootstrap()
      .then(setInitial)
      .catch(() => {
        setInitial(null);
        setLoadErr(true);
        if (!hasStaffToken()) setAuthed(false); // token rejected → re-login
      });
  }, []);

  useEffect(() => {
    if (authed) load();
  }, [authed, load]);

  if (!authed) {
    // silent exchange still in flight — a plain spinner, not the login form
    if (!silentFailed) {
      return (
        <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", color: "#9aa4c4" }}>
          กำลังเข้าสู่ระบบ…
        </div>
      );
    }
    return <LoginScreen onLogin={() => setAuthed(true)} />;
  }

  if (!initial) {
    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", color: "#9aa4c4" }}>
        {loadErr ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วเปิดใหม่" : "กำลังโหลด…"}
      </div>
    );
  }

  return (
    <CrashScreen>
    <LangProvider>
      <StaffProvider initial={initial} edition={STAFF_EDITION}>
        <HashRouter>
          <StaffUserGate>
          <DeviceGate>
            <div className="staff-root">
              <StaffSidebar />
              <div className="staff-main">
                <StaffTopbar />
                <Routes>
                  <Route path="/" element={<TodayPage />} />
                  <Route path="/schedule" element={<ScheduleView />} />
                  <Route path="/settings" element={<SetupView patientWebUrl={API_BASE} />} />
                  {STAFF_EDITION === "full" ? (
                    <>
                      <Route path="/patients" element={<PatientsPage />} />
                      <Route path="/rooms" element={<RoomsRoute />} />
                      <Route path="/rooms/:slug" element={<RoomRoute />} />
                      <Route path="/cashier" element={<CashierView />} />
                      <Route path="/stock" element={<StockView />} />
                      <Route path="/reports" element={<ReportsView />} />
                      <Route path="/chat" element={<ChatView />} />
                    </>
                  ) : null}
                  {/* addresses from the old eight-item menu land where their content moved */}
                  <Route path="/queue" element={<Navigate to="/" replace />} />
                  <Route path="/appointments" element={<Navigate to="/schedule" replace />} />
                  <Route path="/dentists" element={<Navigate to="/settings" replace />} />
                  <Route path="/services" element={<Navigate to="/settings" replace />} />
                  <Route path="/notifications" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </div>
          </DeviceGate>
          </StaffUserGate>
        </HashRouter>
      </StaffProvider>
    </LangProvider>
    </CrashScreen>
  );
}

/** /rooms — pick which dentist's room this screen shows */
function RoomsRoute() {
  const navigate = useNavigate();
  return (
    <RoomPage
      slug={null}
      onPickRoom={(s) => {
        if (s) navigate(`/rooms/${s}`);
      }}
    />
  );
}

/** /rooms/:slug — one dentist's room page */
function RoomRoute() {
  const { slug } = useParams();
  const navigate = useNavigate();
  return (
    <RoomPage
      slug={slug ?? null}
      onPickRoom={(s) => navigate(s ? `/rooms/${s}` : "/rooms")}
    />
  );
}
