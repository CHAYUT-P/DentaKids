"use client";

import React, { useState } from "react";
import { useStaff } from "@/lib/staffStore";
import { staffUpdateClinicInfo } from "@/server/actions";
import {
  telDisplay,
  lineId,
  landmark,
  geo,
  type DayKey,
} from "@/data/clinic";
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

  // Booking rules state
  const [chairCount, setChairCount] = useState<number>(settings.chairs);
  const [slotGranularity, setSlotGranularity] = useState("30");
  const [advanceDays, setAdvanceDays] = useState("14");
  const [leadCutoffMin, setLeadCutoffMin] = useState("60");
  const [hasLunchBreak, setHasLunchBreak] = useState(true);
  const [lunchStart, setLunchStart] = useState("12:00");
  const [lunchEnd, setLunchEnd] = useState("13:00");
  const [cancelDeadlineHours, setCancelDeadlineHours] = useState("2");

  // Clinic profile state
  const [clinicNameTh, setClinicNameTh] = useState("Denta Kids คลินิกทันตกรรมสำหรับเด็ก");
  const [clinicNameEn, setClinicNameEn] = useState("Denta Kids Pediatric Dental Clinic");
  const [tel, setTel] = useState(telDisplay);
  const [line, setLine] = useState(lineId);
  const [addressTh, setAddressTh] = useState(landmark.th);
  const [addressEn, setAddressEn] = useState(landmark.en);
  const [latitude, setLatitude] = useState(String(geo.lat));
  const [longitude, setLongitude] = useState(String(geo.lng));

  // Notification settings state
  const [enableD1Reminder, setEnableD1Reminder] = useState(true);
  const [d1ReminderTime, setD1ReminderTime] = useState("18:00");
  const [enableD0Reminder, setEnableD0Reminder] = useState(true);
  const [d0ReminderTime, setD0ReminderTime] = useState("08:00");
  const [soundAlerts, setSoundAlerts] = useState(true);

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
    // chairs cap one wall-clock slot for online booking (see settlePool) —
    // persisted, unlike the display-only knobs below which are still local
    if (chairCount !== settings.chairs) updateChairs(chairCount);
    // clinic contact details now persist to Postgres (clinic_info) — the
    // patient /clinic page and the home info card read this same row
    // the form starts from the built-in defaults, not the saved row — so only
    // write contact details someone actually edited, or a save on any other
    // group would reset the clinic's real phone/LINE/address to those defaults
    const profileEdited =
      tel !== telDisplay || line !== lineId || addressTh !== landmark.th || addressEn !== landmark.en;
    if (profileEdited) {
      staffUpdateClinicInfo({
        phone: tel.replace(/\D/g, "") || undefined,
        phoneDisplay: tel || undefined,
        lineId: line || undefined,
        addressTh: addressTh || undefined,
        addressEn: addressEn || undefined,
      });
    }
    showToast("บันทึกการตั้งค่าคลินิกเรียบร้อยแล้ว — เว็บผู้ปกครองอัปเดตทันที");
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
            TAB 2: กฎการจอง & ห้องตรวจ
            ==================================================================== */}
        {activeTab === "booking" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: "20px", alignItems: "start" }}>
            {/* Chairs & Capacity */}
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
              <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>
                ความจุห้องตรวจและเก้าอี้ทำฟัน (Clinic Chairs & Room Capacity)
              </strong>

              <div className="form-group">
                <label>จำนวนเก้าอี้ทำฟันที่พร้อมใช้งาน (Active Dental Chairs)</label>
                <select
                  className="form-control"
                  value={chairCount}
                  onChange={(e) => setChairCount(Number(e.target.value))}
                >
                  <option value={1}>1 เก้าอี้ (คลินิกขนาดเล็ก)</option>
                  <option value={2}>2 เก้าอี้</option>
                  <option value={3}>3 เก้าอี้ (มาตรฐาน Denta Kids)</option>
                  <option value={4}>4 เก้าอี้</option>
                  <option value={5}>5 เก้าอี้</option>
                </select>
                <span style={{ fontSize: "11.5px", color: "var(--staff-ink-muted)" }}>
                  จำกัดจำนวนคนไข้ที่สามารถจองในเวลาเดียวกันไม่เกินจำนวนเก้าอี้
                </span>
              </div>

              <div className="form-group">
                <label>ความยาวต่อ 1 ช่องเวลา (Slot Duration)</label>
                <select
                  className="form-control"
                  value={slotGranularity}
                  onChange={(e) => setSlotGranularity(e.target.value)}
                >
                  <option value="15">15 นาที</option>
                  <option value="30">30 นาที (ค่าเริ่มต้นที่แนะนำ)</option>
                  <option value="45">45 นาที</option>
                  <option value="60">60 นาที (1 ชั่วโมง)</option>
                </select>
                <span style={{ fontSize: "11.5px", color: "var(--staff-ink-muted)" }}>
                  ระยะเวลาพื้นฐานสำหรับนัดหมายตรวจสุขภาพฟันและหัตถการทั่วไป
                </span>
              </div>
            </div>

            {/* Lunch Break & Rules */}
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>
                    ช่วงเวลาพักเที่ยง (Lunch Break Slot Rules)
                  </strong>
                  <div style={{ fontSize: "12px", color: "var(--staff-ink-muted)", marginTop: "2px" }}>
                    เว้นว่างไม่เปิดให้คนไข้จองคิวออนไลน์ในช่วงพัก
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setHasLunchBreak(!hasLunchBreak)}
                  className={`status-pill ${hasLunchBreak ? "completed" : "cancelled"}`}
                  style={{ cursor: "pointer", border: "none" }}
                >
                  {hasLunchBreak ? (
                    <>
                      <IconCheck size={11} />
                      <span>เปิดใช้พักเที่ยง</span>
                    </>
                  ) : (
                    <>
                      <IconX size={11} />
                      <span>ไม่พักเที่ยง</span>
                    </>
                  )}
                </button>
              </div>

              {hasLunchBreak && (
                <div className="form-row-2">
                  <div className="form-group">
                    <label>เริ่มพักเที่ยง</label>
                    <input
                      type="time"
                      className="form-control"
                      value={lunchStart}
                      onChange={(e) => setLunchStart(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>สิ้นสุดพักเที่ยง</label>
                    <input
                      type="time"
                      className="form-control"
                      value={lunchEnd}
                      onChange={(e) => setLunchEnd(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Advance Booking & Cutoff */}
            <div
              style={{
                gridColumn: "1 / -1",
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
              <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>
                กรอบเวลาการจองและยกเลิกนัด (Advance Window & Cancellation Policy)
              </strong>

              <div className="form-row-2">
                <div className="form-group">
                  <label>เปิดให้จองล่วงหน้าได้สูงสุด (วัน)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={advanceDays}
                    onChange={(e) => setAdvanceDays(e.target.value)}
                    min={1}
                    max={60}
                  />
                  <span style={{ fontSize: "11.5px", color: "var(--staff-ink-muted)" }}>
                    ผู้ปกครองสามารถเลือกวันตรวจได้ไม่เกิน {advanceDays} วันนับจากวันนี้
                  </span>
                </div>

                <div className="form-group">
                  <label>ปิดรับการจองก่อนถึงเวลาเริ่มนัด (นาที)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={leadCutoffMin}
                    onChange={(e) => setLeadCutoffMin(e.target.value)}
                    min={0}
                    max={240}
                  />
                  <span style={{ fontSize: "11.5px", color: "var(--staff-ink-muted)" }}>
                    ป้องกันการจองฉุกเฉินกระชั้นชิดเกินกว่าที่คลินิกจะเตรียมห้องทัน
                  </span>
                </div>
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label>ผู้ปกครองสามารถกดยกเลิกนัดเองได้ล่วงหน้าอย่างน้อย (ชั่วโมง)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={cancelDeadlineHours}
                    onChange={(e) => setCancelDeadlineHours(e.target.value)}
                    min={1}
                    max={48}
                  />
                </div>

                <div className="form-group">
                  <label>รูปแบบการยืนยันการจองออนไลน์ (LINE LIFF Booking Flow)</label>
                  <input
                    type="text"
                    className="form-control"
                    value="อนุมัติและออกรหัสนัดทันที (Auto-confirmed, No waiting approval)"
                    disabled
                    style={{ background: "var(--staff-surface-subtle)" }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            TAB 3: ข้อมูลคลินิก & ที่ตั้ง
            ==================================================================== */}
        {activeTab === "profile" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: "20px", alignItems: "start" }}>
              {/* General Info */}
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
                <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>
                  ข้อมูลชื่อคลินิกและการติดต่อ (Clinic Branding & Contacts)
                </strong>

                <div className="form-group">
                  <label>ชื่อคลินิก (ภาษาไทย) *</label>
                  <input
                    type="text"
                    className="form-control"
                    value={clinicNameTh}
                    onChange={(e) => setClinicNameTh(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Clinic Name (English) *</label>
                  <input
                    type="text"
                    className="form-control"
                    value={clinicNameEn}
                    onChange={(e) => setClinicNameEn(e.target.value)}
                    required
                  />
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>เบอร์โทรศัพท์คลินิก *</label>
                    <input
                      type="text"
                      className="form-control"
                      value={tel}
                      onChange={(e) => setTel(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>LINE Official Account ID *</label>
                    <input
                      type="text"
                      className="form-control"
                      value={line}
                      onChange={(e) => setLine(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Address & GPS */}
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
                <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>
                  ที่อยู่และพิกัดแผนที่ (Location & Navigation)
                </strong>

                <div className="form-group">
                  <label>ที่อยู่และจุดสังเกต (ภาษาไทย)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={addressTh}
                    onChange={(e) => setAddressTh(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Address & Landmarks (English)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={addressEn}
                    onChange={(e) => setAddressEn(e.target.value)}
                  />
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>พิกัดละติจูด (Latitude)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={latitude}
                      onChange={(e) => setLatitude(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>พิกัดลองจิจูด (Longitude)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={longitude}
                      onChange={(e) => setLongitude(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ====================================================================
            TAB 4: การแจ้งเตือน & บัญชีผู้ใช้
            ==================================================================== */}
        {activeTab === "staff_notif" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* LINE Reminders */}
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
              <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>
                ระบบส่งข้อความแจ้งเตือนอัตโนมัติ (LINE Messaging API Reminders)
              </strong>

              <div
                style={{
                  background: "var(--staff-surface-subtle)",
                  padding: "14px 18px",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <strong style={{ fontSize: "14px" }}>เตือนนัดหมายล่วงหน้า 1 วัน (D-1 Reminder)</strong>
                  <div style={{ fontSize: "12px", color: "var(--staff-ink-muted)", marginTop: "2px" }}>
                    ส่งข้อความเตือนผู้ปกครองทาง LINE ในช่วงเย็นก่อนถึงวันนัด 1 วัน
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <input
                    type="time"
                    className="form-control"
                    style={{ width: "105px", padding: "5px 8px" }}
                    value={d1ReminderTime}
                    onChange={(e) => setD1ReminderTime(e.target.value)}
                    disabled={!enableD1Reminder}
                  />
                  <input
                    type="checkbox"
                    checked={enableD1Reminder}
                    onChange={() => setEnableD1Reminder(!enableD1Reminder)}
                  />
                </div>
              </div>

              <div
                style={{
                  background: "var(--staff-surface-subtle)",
                  padding: "14px 18px",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <strong style={{ fontSize: "14px" }}>เตือนนัดหมายในวันตรวจ (Day-Of Morning Reminder)</strong>
                  <div style={{ fontSize: "12px", color: "var(--staff-ink-muted)", marginTop: "2px" }}>
                    ส่งข้อความเตือนในเช้าวันนัดหมายเพื่อป้องกันการลืมนัด
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <input
                    type="time"
                    className="form-control"
                    style={{ width: "105px", padding: "5px 8px" }}
                    value={d0ReminderTime}
                    onChange={(e) => setD0ReminderTime(e.target.value)}
                    disabled={!enableD0Reminder}
                  />
                  <input
                    type="checkbox"
                    checked={enableD0Reminder}
                    onChange={() => setEnableD0Reminder(!enableD0Reminder)}
                  />
                </div>
              </div>

              <div
                style={{
                  background: "var(--staff-surface-subtle)",
                  padding: "14px 18px",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <strong style={{ fontSize: "14px" }}>เสียงแจ้งเตือนเมื่อมีการจองออนไลน์ใหม่ (In-App Audio Chime)</strong>
                  <div style={{ fontSize: "12px", color: "var(--staff-ink-muted)", marginTop: "2px" }}>
                    ส่งเสียงแจ้งเตือนที่เครื่องเคาน์เตอร์ทันทีเมื่อคนไข้กดจองผ่าน LINE
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={soundAlerts}
                  onChange={() => setSoundAlerts(!soundAlerts)}
                />
              </div>
            </div>

            {/* How the desk signs in — the real mechanism, not a mock account list */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid var(--staff-border)",
                borderRadius: "14px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <strong style={{ fontSize: "15px", color: "var(--staff-ink)" }}>การเข้าใช้งานแอป</strong>
              <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: "var(--staff-ink-2)" }}>
                แอปเจ้าหน้าที่เข้าระบบด้วย PIN ของคลินิกรหัสเดียว ที่ติดมากับตัวติดตั้งแอป ยังไม่มีบัญชีแยกรายคน
              </p>
              <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: "var(--staff-ink-2)" }}>
                เปลี่ยน PIN: แก้ค่า STAFF_PIN บนเซิร์ฟเวอร์ แล้วสร้างตัวติดตั้งแอปใหม่ให้ทุกเครื่อง
              </p>
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

        {/* Global Save Button */}
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
          <button type="submit" className="btn-primary-staff" style={{ padding: "9px 22px" }}>
            <IconCheck size={16} />
            <span>บันทึกการตั้งค่าทั้งหมด</span>
          </button>
        </div>
      </form>
    </div>
  );
}
