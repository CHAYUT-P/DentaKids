"use client";

import React, { useState } from "react";
import { useStaff } from "@/lib/staffStore";
import type { DayKey } from "@/data/clinic";
import {
  IconClock,
  IconCheck,
  IconX,
  IconCalendar,
} from "@/components/staff/shell/staffIcons";
import { RangeCalendar, dayCount, fmtHolidayRange, fmtTHDate } from "@/components/staff/schedule/RangeCalendar";

const DAY_LABELS: Record<DayKey, { th: string; en: string }> = {
  mon: { th: "วันจันทร์", en: "Monday" },
  tue: { th: "วันอังคาร", en: "Tuesday" },
  wed: { th: "วันพุธ", en: "Wednesday" },
  thu: { th: "วันพฤหัสบดี", en: "Thursday" },
  fri: { th: "วันศุกร์", en: "Friday" },
  sat: { th: "วันเสาร์", en: "Saturday" },
  sun: { th: "วันอาทิตย์", en: "Sunday" },
};

export type SettingsTab = "hours" | "booking" | "profile" | "staff_notif" | "device";

export function ClinicSettings({ tab }: { tab: SettingsTab }) {
  const {
    today,
    edition,
    deviceMode,
    setDeviceMode,
    roomDentistSlug,
    setRoomDentistSlug,
    dentists,
    showToast,
    schedule,
    holidays,
    settings,
    updateChairs,
    clinicInfo,
    updateClinicInfo,
    updateDayOpen,
    updateDayTime,
    addHoliday,
    removeHoliday,
  } = useStaff();

  // which group shows is chosen by the ตั้งค่า sub-menu (SetupView)
  const activeTab = tab;

  // Special-holiday range selection (the saved list lives in the staff store
  // so patient booking also sees it). Click once = single day, twice = range.
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);
  const [selHover, setSelHover] = useState<string | null>(null);
  const [newHolidayName, setNewHolidayName] = useState("");

  // chairs: the one booking rule staff set here (the others are fixed, see below)
  const [chairCount, setChairCount] = useState<number>(settings.chairs);

  // the clinic's contact details, starting from what is saved — so saving
  // never puts demo values back
  const [tel, setTel] = useState(clinicInfo?.phoneDisplay ?? "");
  const [line, setLine] = useState(clinicInfo?.lineId ?? "");
  const [addressTh, setAddressTh] = useState(clinicInfo?.addressTh ?? "");
  const [addressEn, setAddressEn] = useState(clinicInfo?.addressEn ?? "");
  const [landmarkTh, setLandmarkTh] = useState(clinicInfo?.landmarkTh ?? "");
  const [mapLink, setMapLink] = useState(clinicInfo?.mapUrl ?? "");

  const handlePickDay = (iso: string) => {
    if (!selStart || (selStart && selEnd)) {
      setSelStart(iso);
      setSelEnd(null);
    } else if (iso === selStart) {
      setSelEnd(iso); // clicked twice = single day
    } else if (iso < selStart) {
      setSelEnd(selStart);
      setSelStart(iso);
    } else {
      setSelEnd(iso);
    }
  };

  const handleAddHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selStart || !newHolidayName.trim()) return;
    const end = selEnd ?? selStart;
    addHoliday(selStart, end, newHolidayName.trim());
    setSelStart(null);
    setSelEnd(null);
    setNewHolidayName("");
    const [s, x] = selStart <= end ? [selStart, end] : [end, selStart];
    showToast(
      s === x
        ? `ปิดรับจองวันที่ ${fmtTHDate(s)} แล้ว`
        : `ปิดรับจอง ${fmtTHDate(s)} – ${fmtTHDate(x)} แล้ว`,
    );
  };

  const handleRemoveHoliday = (id: number | string) => {
    removeHoliday(id);
    showToast("ลบวันหยุดพิเศษแล้ว");
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab === "booking") {
      if (chairCount !== settings.chairs) updateChairs(chairCount);
      showToast("บันทึกจำนวนเก้าอี้แล้ว");
      return;
    }
    if (activeTab === "profile") {
      const link = mapLink.trim();
      const lineHandle = line.trim();
      updateClinicInfo({
        phone: tel.replace(/\D/g, ""),
        phoneDisplay: tel.trim(),
        lineId: lineHandle,
        lineUrl: lineHandle ? `https://line.me/R/ti/p/${encodeURIComponent(lineHandle)}` : "",
        addressTh: addressTh.trim(),
        addressEn: addressEn.trim(),
        landmarkTh: landmarkTh.trim(),
        // one Google Maps link opens the pin; Google offers directions from it
        mapUrl: link,
        directionsUrl: link,
      });
      showToast("บันทึกข้อมูลคลินิกแล้ว — หน้าเว็บผู้ปกครองอัปเดตทันที");
    }
  };

  return (
    <div className="setup-pane">
      <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* ====================================================================
            TAB 1: เวลาทำการ & วันหยุดพิเศษ
            ==================================================================== */}
        {activeTab === "hours" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", alignItems: "stretch" }}>
            {/* Weekly Schedule */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid var(--staff-border)",
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                boxShadow: "var(--staff-shadow-sm)",
              }}
            >
              <div>
                <strong style={{ fontSize: "15px", color: "var(--staff-ink)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <IconClock size={17} color="var(--staff-primary)" />
                  <span>เวลาเปิด-ปิดทำการประจำสัปดาห์ (Weekly Operating Schedule)</span>
                </strong>
                <div style={{ fontSize: "12px", color: "var(--staff-ink-muted)", marginTop: "2px" }}>
                  กำหนดวันและช่วงเวลาที่คลินิกเปิดให้บริการ (จะแสดงบนหน้าแรกและหน้าข้อมูลคลินิกของคนไข้)
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(430px, 1fr))", gap: "8px" }}>
                {schedule.map((item) => (
                  <div
                    key={item.day}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      border: "1px solid",
                      borderColor: item.isOpen ? "var(--staff-border)" : "transparent",
                      background: item.isOpen ? "#ffffff" : "var(--staff-surface-subtle)",
                      transition: "all 0.15s",
                    }}
                  >
                    {/* Open/close + day — always a single line */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: "1 1 220px", whiteSpace: "nowrap", overflow: "hidden" }}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.isOpen}
                        title={item.isOpen ? "ปิดวันนี้" : "เปิดวันนี้"}
                        onClick={() => updateDayOpen(item.day, !item.isOpen)}
                        style={{
                          width: "48px",
                          height: "28px",
                          borderRadius: "999px",
                          border: "none",
                          background: item.isOpen ? "var(--staff-primary)" : "#ced4da",
                          position: "relative",
                          cursor: "pointer",
                          flexShrink: 0,
                          padding: 0,
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            top: "3px",
                            left: item.isOpen ? "23px" : "3px",
                            width: "22px",
                            height: "22px",
                            borderRadius: "50%",
                            background: "#ffffff",
                            transition: "left 0.15s",
                          }}
                        />
                      </button>

                      <strong
                        style={{
                          fontSize: "13.5px",
                          color: item.isOpen ? "var(--staff-ink)" : "var(--staff-ink-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item.isOpen ? "เปิดทำการ" : "ปิดทำการ"} · {DAY_LABELS[item.day].th}
                      </strong>
                    </div>

                    {/* Time Pickers */}
                    {item.isOpen ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                        <span style={{ fontSize: "12px", color: "var(--staff-ink-muted)" }}>เวลา:</span>
                        <input
                          type="time"
                          className="form-control"
                          style={{ padding: "4px 8px", width: "110px", fontSize: "13px" }}
                          value={item.start}
                          onChange={(e) => updateDayTime(item.day, "start", e.target.value)}
                        />
                        <span style={{ fontSize: "12px", color: "var(--staff-ink-muted)" }}>ถึง</span>
                        <input
                          type="time"
                          className="form-control"
                          style={{ padding: "4px 8px", width: "110px", fontSize: "13px" }}
                          value={item.end}
                          onChange={(e) => updateDayTime(item.day, "end", e.target.value)}
                        />
                        <span style={{ fontSize: "12px", color: "var(--staff-ink-muted)" }}>น.</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: "12px", color: "var(--staff-ink-muted)", fontStyle: "italic" }}>
                        ปิดทำการประจำสัปดาห์ (ไม่เปิดให้จองคิว)
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Special Holidays — own calendar, single day or range */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid var(--staff-border)",
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                boxShadow: "var(--staff-shadow-sm)",
              }}
            >
              <div>
                <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>
                  วันหยุดพิเศษของคลินิก (Special Holidays / Closed Dates)
                </strong>
                <div style={{ fontSize: "12px", color: "var(--staff-ink-muted)", marginTop: "2px" }}>
                  จิ้มวันเดียว = ปิดวันนั้นวันเดียว · จิ้มสองวัน = ปิดเป็นช่วง (เช่น 30 ธ.ค. – 3 ม.ค.) · ระบบจะปิดรับการจองคิวออนไลน์อัตโนมัติ
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "22px", alignItems: "start" }}>
                <RangeCalendar
                  today={today}
                  marked={holidays}
                  selStart={selStart}
                  selEnd={selEnd}
                  hover={selHover}
                  onHover={setSelHover}
                  onPick={handlePickDay}
                />

                <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
                  <form
                    onSubmit={handleAddHoliday}
                    style={{
                      background: "var(--staff-primary-light)",
                      border: "1px solid var(--staff-primary)",
                      borderRadius: "10px",
                      padding: "14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <div style={{ fontSize: "13.5px", fontWeight: 700, color: "var(--staff-ink)" }}>
                      {selStart ? (
                        <>ปิดรับจอง: <span style={{ color: "var(--staff-primary)" }}>{fmtHolidayRange({ start: selStart, end: selEnd ?? selStart })}</span></>
                      ) : (
                        <span style={{ fontWeight: 500, color: "var(--staff-ink-muted)" }}>จิ้มวันที่ปฏิทินเพื่อเลือกวันหยุด…</span>
                      )}
                    </div>
                    {selStart ? (
                      <button type="button" className="btn-secondary-staff" style={{ alignSelf: "flex-start", padding: "4px 12px", fontSize: "12px" }} onClick={() => { setSelStart(null); setSelEnd(null); }}>
                        <span>ล้างที่เลือก</span>
                      </button>
                    ) : null}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>ชื่อวันหยุด / เหตุผล</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="เช่น วันแรงงานแห่งชาติ, ปิดปรับปรุงระบบ"
                        value={newHolidayName}
                        onChange={(e) => setNewHolidayName(e.target.value)}
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      className="btn-primary-staff"
                      disabled={!selStart || !newHolidayName.trim()}
                      style={{ height: "36px", opacity: !selStart || !newHolidayName.trim() ? 0.5 : 1 }}
                    >
                      <IconCheck size={15} />
                      <span>+ เพิ่มวันหยุดช่วงนี้</span>
                    </button>
                  </form>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <strong style={{ fontSize: "13px", color: "var(--staff-ink)" }}>
                      วันหยุดที่บันทึกแล้ว ({holidays.length})
                    </strong>
                    {holidays.length === 0 ? (
                      <span style={{ fontSize: "12.5px", color: "var(--staff-ink-muted)" }}>ยังไม่มีวันหยุดพิเศษ</span>
                    ) : (
                      holidays.map((h) => (
                        <div
                          key={h.id}
                          style={{
                            background: "var(--staff-surface-subtle)",
                            border: "1px solid var(--staff-border)",
                            borderRadius: "8px",
                            padding: "12px 16px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "10px",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <strong style={{ fontSize: "13.5px", color: "var(--staff-ink)" }}>{h.name}</strong>
                            <div style={{ fontSize: "12px", color: "var(--staff-ink-muted)", marginTop: "2px", display: "flex", alignItems: "center", gap: "4px" }}>
                              <IconCalendar size={12} />
                              <span>{fmtHolidayRange(h)}{h.start !== h.end ? ` (${dayCount(h.start, h.end)} วัน)` : ""}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn-action-icon danger"
                            style={{ flexShrink: 0 }}
                            onClick={() => handleRemoveHoliday(h.id)}
                            title="ลบวันหยุด"
                          >
                            <IconX size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            TAB 2: กฎการจอง & เก้าอี้ — the chair count is set here; the other
            rules are fixed in the app and listed as they really work
            ==================================================================== */}
        {activeTab === "booking" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "20px", alignItems: "start" }}>
            <div style={{
                background: "#ffffff",
                border: "1px solid var(--staff-border)",
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                boxShadow: "var(--staff-shadow-sm)",
              }}>
              <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>เก้าอี้ทำฟัน</strong>
              <div className="form-group">
                <label>จำนวนเก้าอี้ที่ใช้งานได้</label>
                <select className="form-control" value={chairCount} onChange={(e) => setChairCount(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} เก้าอี้
                    </option>
                  ))}
                </select>
                <span className="settings-hint">
                  เมื่อคนไข้เลือก “ทันตแพทย์ท่านใดก็ได้” ระบบรับจองในเวลาเดียวกันได้ไม่เกินจำนวนเก้าอี้
                </span>
              </div>
            </div>

            <div style={{
                background: "#ffffff",
                border: "1px solid var(--staff-border)",
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                boxShadow: "var(--staff-shadow-sm)",
              }}>
              <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>กฎการจองที่ใช้อยู่</strong>
              <ul className="rules-list">
                <li>
                  <strong>เวลาที่จองได้</strong> = เวลาเข้าเวรของคุณหมอแต่ละท่าน — ตั้งใน “ทันตแพทย์ &amp; เวรตรวจ”
                </li>
                <li>
                  <strong>1 คิว = 30 นาที</strong> — บริการที่ใช้เวลานานกว่า (เช่น ฟอกสีฟัน 1 ชม.) กันหลายช่องอัตโนมัติ ตั้งใน “บริการ &amp; ราคา”
                </li>
                <li>
                  <strong>จองล่วงหน้าได้ 14 วัน</strong> และต้องจองก่อนเวลานัดอย่างน้อย <strong>1 ชั่วโมง</strong>
                </li>
                <li>
                  ผู้ปกครอง<strong>เลื่อน/ยกเลิกนัดเองได้</strong>ทาง LINE จนกว่าจะเช็คอิน
                </li>
                <li>
                  จองแล้ว<strong>ยืนยันทันที</strong> ได้รหัสจองและข้อความยืนยันทาง LINE
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* ====================================================================
            TAB 3: ข้อมูลคลินิก — saved to clinic_info; the patient site's
            clinic page and home card read the same row
            ==================================================================== */}
        {activeTab === "profile" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "20px", alignItems: "start" }}>
            <div style={{
                background: "#ffffff",
                border: "1px solid var(--staff-border)",
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                boxShadow: "var(--staff-shadow-sm)",
              }}>
              <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>การติดต่อ</strong>
              <div className="form-group">
                <label>เบอร์โทรศัพท์คลินิก</label>
                <input
                  type="tel"
                  className="form-control"
                  placeholder="เช่น 087-780-6669"
                  value={tel}
                  onChange={(e) => setTel(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>LINE Official Account ID</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="เช่น @dentakids"
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                />
                <span className="settings-hint">ใช้ทำปุ่ม LINE บนหน้า “เกี่ยวกับคลินิก”</span>
              </div>
            </div>

            <div style={{
                background: "#ffffff",
                border: "1px solid var(--staff-border)",
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                boxShadow: "var(--staff-shadow-sm)",
              }}>
              <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>ที่อยู่และแผนที่</strong>
              <div className="form-group">
                <label>ที่อยู่ (ภาษาไทย)</label>
                <textarea
                  className="form-control"
                  rows={2}
                  style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
                  value={addressTh}
                  onChange={(e) => setAddressTh(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>จุดสังเกต (ไม่บังคับ)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="เช่น ตรงข้ามโรงเรียน…"
                  value={landmarkTh}
                  onChange={(e) => setLandmarkTh(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Address (English)</label>
                <input type="text" className="form-control" value={addressEn} onChange={(e) => setAddressEn(e.target.value)} />
              </div>
              <div className="form-group">
                <label>ลิงก์ Google Maps</label>
                <input
                  type="url"
                  className="form-control"
                  placeholder="วางลิงก์จาก Google Maps → แชร์ → คัดลอกลิงก์"
                  value={mapLink}
                  onChange={(e) => setMapLink(e.target.value)}
                />
                <span className="settings-hint">ปุ่ม “Google Maps” และ “นำทาง” บนหน้าเว็บจะเปิดลิงก์นี้</span>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            TAB 4: การแจ้งเตือน & บัญชี — how reminders and sign-in really work
            ==================================================================== */}
        {activeTab === "staff_notif" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "20px", alignItems: "start" }}>
            <div style={{
                background: "#ffffff",
                border: "1px solid var(--staff-border)",
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                boxShadow: "var(--staff-shadow-sm)",
              }}>
              <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>ข้อความเตือนนัดทาง LINE (อัตโนมัติ)</strong>
              <ul className="rules-list">
                <li>
                  <strong>วันก่อนนัด เวลา 18:00 น.</strong> — “พรุ่งนี้มีนัดของ …”
                </li>
                <li>
                  <strong>เช้าวันนัด เวลา 07:00 น.</strong> — “วันนี้มีนัดนะคะ …”
                </li>
                <li>ส่งเฉพาะครอบครัวที่จองผ่าน LINE — นัดที่จองทางโทรศัพท์ให้โทรเตือนเอง</li>
                <li>ทุกครั้งที่จอง เลื่อน หรือยกเลิกผ่าน LINE ครอบครัวได้รับข้อความยืนยันทันที</li>
              </ul>
            </div>

            <div style={{
                background: "#ffffff",
                border: "1px solid var(--staff-border)",
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                boxShadow: "var(--staff-shadow-sm)",
              }}>
              <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>การเข้าใช้งานแอป</strong>
              <ul className="rules-list">
                <li>
                  เข้าแอปด้วย <strong>PIN ของคลินิก</strong> — พิมพ์ครั้งแรกที่เปิดแอปในแต่ละเครื่อง เครื่องจะจำไว้
                </li>
                <li>เปลี่ยน PIN: แก้ค่า STAFF_PIN บนเซิร์ฟเวอร์ แล้วทุกเครื่องจะต้องพิมพ์ PIN ใหม่</li>
              </ul>
            </div>
          </div>
        )}

        {/* ====================================================================
            TAB 5: หน้าจอเครื่องนี้ — this PC's role (full edition)
            ==================================================================== */}
        {activeTab === "device" && edition === "full" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div
              style={{
                background: "#ffffff",
                border: "1px solid var(--staff-border)",
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                boxShadow: "var(--staff-shadow-sm)",
              }}
            >
              <div>
                <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>
                  โหมดหน้าจอของเครื่องนี้ (This device&rsquo;s screen mode)
                </strong>
                <div style={{ fontSize: "12px", color: "var(--staff-ink-muted)", marginTop: "2px" }}>
                  ตั้งค่าเฉพาะเครื่องนี้เท่านั้น — คอมพิวเตอร์ห้องตรวจเปิดหน้าหมอค้างไว้ตลอดวัน
                  ส่วนเครื่องแผนกต้อนรับใช้หน้าจัดการคิวปกติ
                </div>
              </div>

              {/* mode pick */}
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`staff-pill-btn ${deviceMode === "frontdesk" ? "active" : ""}`}
                  style={{ padding: "9px 18px", fontSize: "13px" }}
                  onClick={() => setDeviceMode("frontdesk")}
                >
                  แผนกต้อนรับ (Front Desk)
                </button>
                <button
                  type="button"
                  className={`staff-pill-btn ${deviceMode === "room" ? "active" : ""}`}
                  style={{ padding: "9px 18px", fontSize: "13px" }}
                  onClick={() => setDeviceMode("room")}
                >
                  ห้องตรวจ (Treatment Room)
                </button>
              </div>

              {/* which room — only meaningful in room mode */}
              {deviceMode === "room" ? (
                <div className="form-group" style={{ maxWidth: "360px", margin: 0 }}>
                  <label>หมอประจำห้องนี้</label>
                  <select
                    className="form-control"
                    value={roomDentistSlug ?? ""}
                    onChange={(e) => setRoomDentistSlug(e.target.value || null)}
                  >
                    <option value="">— เลือกหมอทุกครั้งที่เปิดแอป —</option>
                    {dentists
                      .filter((d) => d.isActive)
                      .map((d) => (
                        <option key={d.slug} value={d.slug}>
                          {d.text.th.name}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}

              <div
                style={{
                  background: "var(--staff-surface-subtle)",
                  padding: "14px 18px",
                  borderRadius: "10px",
                  fontSize: "12.5px",
                  color: "var(--staff-ink-2)",
                  lineHeight: 1.7,
                }}
              >
                {deviceMode === "room" ? (
                  <>
                    เครื่องนี้จะแสดง<strong>เฉพาะหน้าห้องตรวจ</strong>
                    {roomDentistSlug
                      ? `ของ${dentists.find((d) => d.slug === roomDentistSlug)?.text.th.name ?? ""} `
                      : ""}
                    — คิวที่รอเรียก + ฟอร์มบันทึกการรักษา ไม่มีเมนูแผนกต้อนรับ
                    กดปุ่มฟันเฟืองมุมขวาล่างเพื่อกลับสู่หน้าปกติ
                  </>
                ) : (
                  <>เครื่องนี้แสดงหน้าจัดการคลินิกเต็มรูปแบบ — คิว นัดหมาย คนไข้ และตั้งค่า</>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Save — only the groups with something to save */}
        {activeTab === "booking" || activeTab === "profile" ? (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            padding: "16px 0",
            borderTop: "1px solid var(--staff-border)",
            gap: "12px",
          }}
        >
          <button type="submit" className="btn-primary-staff">
            <IconCheck size={16} />
            <span>บันทึก</span>
          </button>
        </div>
        ) : null}
      </form>
    </div>
  );
}
