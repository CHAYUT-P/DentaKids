"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addDays,
  addMonths,
  dayOfMonth,
  daysInMonth,
  monthStart,
  thaiDate,
  todayISO,
  weekdayIndex,
  yearOf,
} from "@/lib/dates";
import { IconCalendar, IconChevronLeft, IconChevronRight } from "@/components/staff/shell/staffIcons";

/**
 * The staff app's date box. The browser's own date picker is small, English
 * and different on every machine; this one matches the rest of the app:
 *
 *   the box      reads like the other fields: "วันพุธที่ 21 ต.ค. 2569"
 *   the calendar opens as wide as the box, big day buttons, Thai month and
 *                day names, Buddhist-era years, month/year jump for far
 *                dates (birthdays), วันนี้ / พรุ่งนี้, past days greyed out
 *                when `min` says so
 *
 * The calendar is drawn in a layer above everything (a portal), so a window
 * that scrolls can't cut it off. Values stay plain YYYY-MM-DD strings.
 */

const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const MONTHS_LONG = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

const monthIndex = (iso: string) => Number(iso.slice(5, 7)) - 1;
const isoOf = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}-01`;

export function DateField({
  value,
  onChange,
  min,
  max,
  placeholder = "เลือกวันที่",
  clearable = false,
  id,
  ariaLabel,
}: {
  /** YYYY-MM-DD, or "" for none */
  value: string;
  onChange: (iso: string) => void;
  /** earliest pickable day (YYYY-MM-DD) */
  min?: string;
  /** latest pickable day (YYYY-MM-DD) */
  max?: string;
  placeholder?: string;
  /** offer "ล้าง" to empty the box (optional dates: expiry, due date…) */
  clearable?: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  const today = todayISO();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthStart(value || today));
  const [pos, setPos] = useState<{ left: number; top: number; width: number; above: boolean } | null>(null);
  const boxRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  /**
   * place the calendar exactly as wide as the box: under it when it fits,
   * above it when that fits, otherwise as low as it can go while staying
   * fully on screen
   */
  const place = () => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, 300);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const popH = popRef.current?.offsetHeight ?? 470;
    const below = window.innerHeight - r.bottom;
    const above = r.top >= popH + 12 && below < popH + 12;
    const top =
      below >= popH + 12 ? r.bottom + 6 : above ? r.top - popH - 6 : Math.max(8, window.innerHeight - popH - 8);
    setPos({ left, width, above, top });
  };

  const toggle = () => {
    if (!open) setView(monthStart(value || today));
    setOpen(!open);
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, view]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        boxRef.current?.focus();
      }
    };
    const onMove = () => place();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  const allowed = (iso: string) => (!min || iso >= min) && (!max || iso <= max);
  const pick = (iso: string) => {
    if (!allowed(iso)) return;
    onChange(iso);
    setOpen(false);
    boxRef.current?.focus();
  };

  const cells: (string | null)[] = [];
  for (let i = 0; i < weekdayIndex(view); i++) cells.push(null);
  for (let d = 0; d < daysInMonth(view); d++) cells.push(addDays(view, d));
  while (cells.length % 7) cells.push(null);

  const year = yearOf(view);
  const firstYear = min ? yearOf(min) : yearOf(today) - 100;
  const lastYear = max ? yearOf(max) : yearOf(today) + 5;
  const years: number[] = [];
  for (let y = lastYear; y >= firstYear; y--) years.push(y);
  const canPrev = !min || addMonths(view, -1) >= monthStart(min);
  const canNext = !max || addMonths(view, 1) <= monthStart(max);
  const tomorrow = addDays(today, 1);

  const layer = typeof document === "undefined" ? null : (document.querySelector(".staff-root") ?? document.body);

  return (
    <>
      <button
        ref={boxRef}
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`form-control df-box${open ? " open" : ""}${value ? "" : " empty"}`}
        onClick={toggle}
      >
        <IconCalendar size={17} />
        <span className="df-text">{value ? thaiDate(value) : placeholder}</span>
      </button>

      {open && layer
        ? createPortal(
            <>
              <div className="df-overlay" onMouseDown={() => setOpen(false)} />
              <div
                ref={popRef}
                className="df-pop"
                role="dialog"
                aria-label="เลือกวันที่"
                style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: "hidden" }}
              >
                <div className="df-head">
                  <button
                    type="button"
                    className="df-nav"
                    aria-label="เดือนก่อนหน้า"
                    disabled={!canPrev}
                    onClick={() => setView(addMonths(view, -1))}
                  >
                    <IconChevronLeft size={18} />
                  </button>
                  <div className="df-title">
                    <select
                      aria-label="เดือน"
                      value={monthIndex(view)}
                      onChange={(e) => setView(isoOf(year, Number(e.target.value)))}
                    >
                      {MONTHS_LONG.map((m, i) => (
                        <option key={m} value={i}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="ปี"
                      value={year}
                      onChange={(e) => setView(isoOf(Number(e.target.value), monthIndex(view)))}
                    >
                      {years.map((y) => (
                        <option key={y} value={y}>
                          {y + 543}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="df-nav"
                    aria-label="เดือนถัดไป"
                    disabled={!canNext}
                    onClick={() => setView(addMonths(view, 1))}
                  >
                    <IconChevronRight size={18} />
                  </button>
                </div>

                <div className="df-grid">
                  {DOW.map((d, i) => (
                    <span key={d} className={`df-dow${i === 0 ? " sun" : ""}`}>
                      {d}
                    </span>
                  ))}
                  {cells.map((iso, i) =>
                    iso === null ? (
                      <span key={`pad${i}`} aria-hidden="true" />
                    ) : (
                      <button
                        key={iso}
                        type="button"
                        className={`df-day${iso === today ? " today" : ""}${iso === value ? " on" : ""}${
                          weekdayIndex(iso) === 0 ? " sun" : ""
                        }`}
                        disabled={!allowed(iso)}
                        aria-label={thaiDate(iso)}
                        aria-pressed={iso === value}
                        onClick={() => pick(iso)}
                      >
                        {dayOfMonth(iso)}
                      </button>
                    ),
                  )}
                </div>

                <div className="df-foot">
                  <button type="button" className="df-quick" disabled={!allowed(today)} onClick={() => pick(today)}>
                    วันนี้ <span>{dayOfMonth(today)} {MONTHS[monthIndex(today)]}</span>
                  </button>
                  <button type="button" className="df-quick" disabled={!allowed(tomorrow)} onClick={() => pick(tomorrow)}>
                    พรุ่งนี้ <span>{dayOfMonth(tomorrow)} {MONTHS[monthIndex(tomorrow)]}</span>
                  </button>
                  {clearable && value ? (
                    <button
                      type="button"
                      className="df-quick clear"
                      onClick={() => {
                        onChange("");
                        setOpen(false);
                      }}
                    >
                      ล้าง
                    </button>
                  ) : null}
                </div>
              </div>
            </>,
            layer,
          )
        : null}
    </>
  );
}
