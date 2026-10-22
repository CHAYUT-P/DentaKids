"use client";

import { useEffect, useState } from "react";

import { staffSystemStatus } from "@/server/actions";

type Row = Awaited<ReturnType<typeof staffSystemStatus>>[number];

const SOURCE_TH: Record<string, string> = {
  server: "เซิร์ฟเวอร์",
  "staff-api": "แอปเจ้าหน้าที่ (เซิร์ฟเวอร์)",
  "staff-app": "แอปเจ้าหน้าที่",
  "patient-web": "เว็บผู้ปกครอง",
};

/**
 * สถานะระบบ — the latest errors the system recorded (src/server/monitor.ts),
 * so whoever looks after the system can see a problem without digging in
 * the server logs. Each kind of error is one row with a count.
 */
export function SystemStatus() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    staffSystemStatus()
      .then((r) => {
        // only the last 7 days — older errors were dealt with or went away
        const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
        if (alive) setRows(r.filter((x) => new Date(x.lastSeen).getTime() > weekAgo));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const recent = rows ?? [];

  return (
    <div className="status-card">
      <strong className="status-title">สถานะระบบ</strong>
      {failed ? (
        <p className="status-bad">โหลดสถานะไม่ได้ — ตรวจการเชื่อมต่ออินเทอร์เน็ต</p>
      ) : rows === null ? (
        <p className="settings-hint">กำลังโหลด…</p>
      ) : recent.length === 0 ? (
        <p className="status-good">✓ ไม่มีข้อผิดพลาดใน 7 วันที่ผ่านมา</p>
      ) : (
        <ul className="status-list">
          {recent.map((r, i) => (
            <li key={i}>
              <span className="status-msg">{r.message}</span>
              <span className="settings-hint">
                {SOURCE_TH[r.source] ?? r.source}
                {r.where ? ` · ${r.where}` : ""} · {r.count} ครั้ง · ล่าสุด{" "}
                {new Date(r.lastSeen).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="settings-hint">
        ข้อผิดพลาดใหม่จะส่งแจ้งเตือนทาง LINE ถึงผู้ดูแลระบบ (ตั้งค่า ALERT_LINE_USER_ID บนเซิร์ฟเวอร์)
      </p>
    </div>
  );
}
