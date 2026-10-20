"use client";

import React, { useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@/components/staff/shell/staffIcons";
import { addDays, addMonths, dayOfMonth, daysInMonth, monthStart, weekdayIndex } from "@/lib/dates";
import { holidayCovers, type HolidayItem } from "@/lib/clinicSettings";

const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const TH_DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

export function fmtTHDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}

export function fmtHolidayRange(h: Pick<HolidayItem, "start" | "end">): string {
  return h.start === h.end ? fmtTHDate(h.start) : `${fmtTHDate(h.start)} – ${fmtTHDate(h.end)}`;
}

export function dayCount(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return (
    Math.round(
      (Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000,
    ) + 1
  );
}

/**
 * A month calendar for picking a day or a range: click once for a single
 * day, click a second day for a range (order doesn't matter). Past days are
 * disabled; saved ranges are marked red. Used for clinic holidays and for a
 * dentist's leave.
 */
export function RangeCalendar({
  today,
  marked,
  markedLabel = "วันหยุดที่บันทึกแล้ว",
  markedTitle = "วันหยุด",
  selStart,
  selEnd,
  hover,
  onHover,
  onPick,
}: {
  today: string;
  /** saved ranges drawn red (clinic holidays, or one dentist's leave) */
  marked: HolidayItem[];
  /** legend words for the red days */
  markedLabel?: string;
  /** tooltip prefix on a red day */
  markedTitle?: string;
  selStart: string | null;
  selEnd: string | null;
  hover: string | null;
  onHover: (iso: string | null) => void;
  onPick: (iso: string) => void;
}) {
  const [view, setView] = useState(() => monthStart(today));
  const [y, m] = view.split("-").map(Number);

  const inSel = (iso: string) => {
    if (!selStart) return false;
    const end = selEnd ?? hover ?? selStart;
    const [s, e] = selStart <= end ? [selStart, end] : [end, selStart];
    return iso >= s && iso <= e;
  };

  const cells: (string | null)[] = [];
  for (let i = 0; i < weekdayIndex(view); i++) cells.push(null);
  for (let d = 0; d < daysInMonth(view); d++) cells.push(addDays(view, d));

  const btn: React.CSSProperties = {
    aspectRatio: "1",
    borderRadius: "10px",
    border: "1px solid var(--staff-border)",
    background: "#ffffff",
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--staff-ink)",
    cursor: "pointer",
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    lineHeight: 1,
  };

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <button type="button" className="btn-action-icon" onClick={() => setView((v) => addMonths(v, -1))} aria-label="เดือนก่อนหน้า">
          <IconChevronLeft size={15} />
        </button>
        <strong style={{ fontSize: "14.5px", color: "var(--staff-ink)" }}>
          {TH_MONTHS[m - 1]} {y + 543}
        </strong>
        <button type="button" className="btn-action-icon" onClick={() => setView((v) => addMonths(v, 1))} aria-label="เดือนถัดไป">
          <IconChevronRight size={15} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "6px" }}>
        {TH_DOW.map((d, i) => (
          <span key={i} style={{ textAlign: "center", fontSize: "11px", fontWeight: 700, color: "var(--staff-ink-muted)", padding: "4px 0" }}>
            {d}
          </span>
        ))}
        {cells.map((iso, i) => {
          if (iso === null) return <span key={`pad${i}`} />;
          const past = iso < today;
          const saved = marked.find((h) => holidayCovers(h, iso));
          const selected = inSel(iso);
          return (
            <button
              key={iso}
              type="button"
              disabled={past}
              title={saved ? `${markedTitle}: ${saved.name}` : fmtTHDate(iso)}
              onClick={() => onPick(iso)}
              onMouseEnter={() => onHover(iso)}
              onMouseLeave={() => onHover(null)}
              style={{
                ...btn,
                background: selected ? "var(--staff-primary)" : saved ? "#ffe3e3" : btn.background,
                borderColor: selected ? "var(--staff-primary)" : saved ? "#ffa8a8" : "var(--staff-border)",
                color: selected ? "#ffffff" : saved ? "#c92a2a" : btn.color,
                opacity: past ? 0.35 : 1,
                cursor: past ? "not-allowed" : "pointer",
                fontWeight: selected || saved ? 800 : 600,
              }}
            >
              {dayOfMonth(iso)}
              {saved && !selected ? (
                <span style={{ position: "absolute", bottom: "4px", left: "50%", transform: "translateX(-50%)", width: "5px", height: "5px", borderRadius: "50%", background: "#e03131" }} />
              ) : null}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: "14px", marginTop: "10px", fontSize: "11.5px", color: "var(--staff-ink-muted)", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: "var(--staff-primary)", display: "inline-block" }} /> วันที่กำลังเลือก
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: "#ffa8a8", display: "inline-block" }} /> {markedLabel}
        </span>
      </div>
    </div>
  );
}
