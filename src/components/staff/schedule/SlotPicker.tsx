"use client";

import React, { useMemo, useState } from "react";
import { useStaff } from "@/lib/staffStore";
import { addDays, dayOfMonth, nowMinutes, weekday, weekdayIndex } from "@/lib/dates";
import { dayGrid, type CellState, type DayGrid } from "@/lib/staffAvailability";
import { DateField } from "@/components/staff/shell/DateField";

/**
 * The staff app's time picker for a new appointment and for moving one:
 * a strip of days (with how many free times each has), then the chosen day
 * as a grid — a row per half-hour the clinic is open, a column per dentist.
 * Tap a free cell to pick that time and dentist. Times outside a dentist's
 * shift can still be picked (the clinic is open), and say so.
 */
const WEEKDAY_TH = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const MONTH_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const STRIP = 7;

const CELL_TEXT: Partial<Record<CellState, string>> = {
  free: "ว่าง",
  offshift: "นอกเวร",
  self: "นัดเดิม",
  cont: "↳ ต่อ",
  past: "",
  blocked: "",
};
const PICKABLE: CellState[] = ["free", "offshift", "self"];

export interface SlotPick {
  date: string;
  time: string;
  dentistSlug: string;
}

/**
 * The day grid for any date, from the staff store — shared by the picker and
 * the form that saves the pick (to know whether it can be saved).
 */
export function useGridFor(durationMin: number, excludeId?: string) {
  const { today, appointments, dentists, schedule, holidays, onLeave } = useStaff();
  // the clinic clock when the window opened (a picker is open for minutes)
  const [nowMin] = useState(nowMinutes);
  const active = useMemo(() => dentists.filter((d) => d.isActive), [dentists]);
  return (date: string) =>
    dayGrid({
      date,
      today,
      nowMin,
      durationMin,
      clinic: schedule.find((s) => s.day === weekday(date)),
      holiday: holidays.some((h) => h.start <= date && h.end >= date),
      weekday: weekdayIndex(date),
      dentists: active.map((d) => ({
        slug: d.slug,
        name: d.text.th.name,
        shifts: d.shifts,
        onLeave: !!onLeave(d.slug, date),
      })),
      appointments: appointments.filter((a) => a.date === date),
      excludeId,
    });
}

/** can this pick be saved? (a free, off-shift or unchanged cell) */
export function pickIsValid(grid: DayGrid, pick: SlotPick): boolean {
  const state = grid.columns.find((c) => c.slug === pick.dentistSlug)?.cells[pick.time]?.state;
  return !!state && PICKABLE.includes(state);
}

export function SlotPicker({
  value,
  onChange,
  durationMin,
  excludeId,
}: {
  value: SlotPick;
  onChange: (next: SlotPick) => void;
  /** the treatment's length — a 1-hour one needs two free half-hours */
  durationMin: number;
  /** moving a booking: its own time doesn't block it */
  excludeId?: string;
}) {
  const { today } = useStaff();
  const gridFor = useGridFor(durationMin, excludeId);
  // the strip starts at the chosen day (never before today)
  const [stripStart, setStripStart] = useState(() => (value.date < today ? today : value.date));

  const days = Array.from({ length: STRIP }, (_, i) => addDays(stripStart, i));
  const grid = gridFor(value.date);
  const picked = grid.columns.find((c) => c.slug === value.dentistSlug)?.cells[value.time];
  const label = (d: string) => `${WEEKDAY_TH[weekdayIndex(d)]} ${dayOfMonth(d)} ${MONTH_TH[Number(d.slice(5, 7)) - 1]}`;

  return (
    <div className="slot-picker">
      <div className="sp-days">
        <button
          type="button"
          className="sp-nav"
          aria-label="สัปดาห์ก่อน"
          disabled={stripStart <= today}
          onClick={() => setStripStart(addDays(stripStart, -STRIP) < today ? today : addDays(stripStart, -STRIP))}
        >
          ‹
        </button>
        {days.map((d) => {
          const g = gridFor(d);
          return (
            <button
              key={d}
              type="button"
              className={`sp-day${d === value.date ? " on" : ""}${!g.open ? " closed" : g.freeCount === 0 ? " full" : ""}`}
              disabled={!g.open}
              onClick={() => onChange({ ...value, date: d })}
            >
              <span>{d === today ? "วันนี้" : WEEKDAY_TH[weekdayIndex(d)]}</span>
              <b>{dayOfMonth(d)}</b>
              <span>{!g.open ? "ปิด" : g.freeCount === 0 ? "เต็ม" : `ว่าง ${g.freeCount}`}</span>
            </button>
          );
        })}
        <button type="button" className="sp-nav" aria-label="สัปดาห์ถัดไป" onClick={() => setStripStart(addDays(stripStart, STRIP))}>
          ›
        </button>
        <div className="sp-jump">
          <DateField
            value={value.date}
            min={today}
            ariaLabel="เลือกวันอื่น"
            onChange={(d) => {
              setStripStart(d);
              onChange({ ...value, date: d });
            }}
          />
        </div>
      </div>

      {!grid.open ? (
        <div className="sp-closed">คลินิกปิดวันที่ {label(value.date)} — เลือกวันอื่น</div>
      ) : (
        <div className="sp-grid" style={{ gridTemplateColumns: `56px repeat(${grid.columns.length}, minmax(0, 1fr))` }}>
          <div className="sp-corner" />
          {grid.columns.map((c) => (
            <div key={c.slug} className={`sp-head${c.leave ? " leave" : ""}`} title={c.name}>
              <span>{c.name}</span>
              {c.leave ? <small>ลา</small> : !c.onShift ? <small>ไม่เข้าเวร</small> : null}
            </div>
          ))}
          {grid.times.map((t) => (
            <React.Fragment key={t}>
              <div className="sp-time">{t}</div>
              {grid.columns.map((c) => {
                const cell = c.cells[t];
                const pickable = PICKABLE.includes(cell.state);
                const on = value.time === t && value.dentistSlug === c.slug;
                return (
                  <button
                    key={c.slug}
                    type="button"
                    className={`sp-cell ${cell.state}${on ? " on" : ""}`}
                    disabled={!pickable}
                    title={cell.label}
                    onClick={() => onChange({ ...value, time: t, dentistSlug: c.slug })}
                  >
                    {on ? "เลือก" : (cell.label ?? CELL_TEXT[cell.state])}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      )}

      <div className="sp-legend">
        <span>
          <i className="sp-key free" /> ว่าง — แตะเพื่อเลือก
        </span>
        <span>
          <i className="sp-key offshift" /> นอกเวรหมอ (คลินิกยังเปิด ลงนัดได้)
        </span>
        <span>
          <i className="sp-key booked" /> มีนัดแล้ว
        </span>
      </div>
      {picked?.state === "offshift" ? (
        <div className="ap-warn">เวลานี้อยู่นอกเวรของคุณหมอ — ยืนยันกับคุณหมอก่อนบันทึก</div>
      ) : null}
      {grid.open && !PICKABLE.includes(picked?.state ?? "blocked") ? (
        <div className="sp-hint">ยังไม่ได้เลือกเวลา — แตะช่องว่างในตาราง</div>
      ) : null}
    </div>
  );
}
