"use client";

import React, { useMemo, useState } from "react";
import { useStaff, type EditableDentist, type ShiftHour } from "@/lib/staffStore";
import { useTreatments } from "@/lib/treatmentsContext";
import { iconGroups, type IconKey } from "@/data/icons";
import { KID_UNDER, TREAT_AGES, TREAT_AGES_TH, type TreatAges } from "@/lib/ageGroup";
import { dict } from "@/i18n/dict";
import { resizeImage } from "@/lib/imageResize";
import { IconX, IconCheck } from "@/components/staff/shell/staffIcons";

/**
 * The dentist editor — a roomy sheet with three tabs instead of one long
 * cramped form:
 *
 *   ข้อมูลทั่วไป   photos (small + large), name, specialty, intro, years,
 *                   card colour, taking bookings
 *   การรักษาที่รับ  every treatment, grouped; tick what they do and pick who
 *                   they see for it (kids / both / adults) on the same row
 *   วันเวลาเข้าเวร  the weekly shift, one row per day
 *
 * What is saved here is what the patient booking site offers.
 */

interface EditDentistModalProps {
  /** null = create a new dentist */
  dentist: EditableDentist | null;
  onClose: () => void;
}

type Tab = "profile" | "treats" | "hours";

const WEEKDAY_NAMES = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
/** Monday first, the way the desk reads a week */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TINT_CHOICES = ["rose", "peri", "violet", "blue", "steel", "gold", "lav"];
const TINT_HEX: Record<string, string> = {
  rose: "#fb70a4",
  peri: "#7c86e8",
  violet: "#a06cd5",
  blue: "#4dabf7",
  steel: "#748ffc",
  gold: "#f2b03d",
  lav: "#b197fc",
};
/** short labels for the per-row switch; the full wording is the tooltip */
const AGES_SHORT: Record<TreatAges, string> = { kids: "เด็ก", both: "เด็กและผู้ใหญ่", adults: "ผู้ใหญ่" };

/** create-mode default shifts: Mon–Sat 09:00–18:00, Sunday off */
const defaultShifts = (): ShiftHour[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    enabled: weekday !== 0,
    start: "09:00",
    end: "18:00",
  }));

/** kids / both / adults as one segmented switch */
function AgesSwitch({
  value,
  onChange,
  disabled,
}: {
  value: TreatAges;
  onChange: (v: TreatAges) => void;
  disabled?: boolean;
}) {
  return (
    <div className="de-seg" role="radiogroup" aria-label="รับคนไข้กลุ่มไหน">
      {TREAT_AGES.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          title={TREAT_AGES_TH[v]}
          className={value === v ? "on" : ""}
          disabled={disabled}
          onClick={() => onChange(v)}
        >
          {AGES_SHORT[v]}
        </button>
      ))}
    </div>
  );
}

export function EditDentistModal({ dentist, onClose }: EditDentistModalProps) {
  const { updateDentist, createDentist } = useStaff();
  const tr = useTreatments();
  const isNew = dentist === null;

  const [tab, setTab] = useState<Tab>("profile");
  /** the treatments tab can hide the ones this dentist doesn't do */
  const [onlyTaken, setOnlyTaken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [slug, setSlug] = useState("");
  const [years, setYears] = useState(dentist?.years ?? 0);
  const [licenseNo, setLicenseNo] = useState(dentist?.licenseNo ?? "");
  const [tint, setTint] = useState<string>(dentist?.tint ?? "lav");
  const [thName, setThName] = useState(dentist?.text.th.name ?? "");
  const [enName, setEnName] = useState(dentist?.text.en.name ?? "");
  const [thTitle, setThTitle] = useState(dentist?.text.th.title ?? "");
  const [enTitle, setEnTitle] = useState(dentist?.text.en.title ?? "");
  const [thBlurb, setThBlurb] = useState(dentist?.text.th.blurb ?? "");
  const [isActive, setIsActive] = useState(dentist?.isActive ?? true);
  /** current photo addresses, or freshly resized data URLs once replaced */
  const [photoSmall, setPhotoSmall] = useState(dentist?.photo.small ?? "");
  const [photoLarge, setPhotoLarge] = useState(dentist?.photo.large ?? "");
  const [photoChanged, setPhotoChanged] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  /** read, shrink and stage a picked photo; a first large photo also makes the small one */
  const pickPhoto = async (file: File | undefined, which: "small" | "large") => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("กรุณาเลือกไฟล์รูปภาพ (JPG หรือ PNG)");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("ไฟล์ใหญ่เกินไป (เกิน 20 MB)");
      return;
    }
    setError(null);
    setPhotoBusy(true);
    try {
      if (which === "small") {
        setPhotoSmall(await resizeImage(file, "square"));
      } else {
        setPhotoLarge(await resizeImage(file, "portrait"));
        if (!photoSmall) setPhotoSmall(await resizeImage(file, "square"));
      }
      setPhotoChanged(true);
    } catch {
      setError("เปิดรูปนี้ไม่ได้ ลองไฟล์อื่น");
    } finally {
      setPhotoBusy(false);
    }
  };
  const removePhoto = (which: "small" | "large") => {
    if (which === "small") setPhotoSmall("");
    else setPhotoLarge("");
    setPhotoChanged(true);
  };
  const [shifts, setShifts] = useState<ShiftHour[]>(dentist?.shifts ?? defaultShifts());
  const [treats, setTreats] = useState<IconKey[]>(dentist?.treats ?? []);
  /** per treatment: kids only / both / adults only — missing means both */
  const [treatAges, setTreatAges] = useState<Partial<Record<string, TreatAges>>>(dentist?.treatAges ?? {});

  /** every treatment in the clinic's list, plus any this dentist still carries,
   *  grouped the way the patient site groups them */
  const groups = useMemo(() => {
    const keys = new Set<string>([...tr.list.map((e) => e.key), ...(dentist?.treats ?? [])]);
    const groupOf = (k: string) => tr.list.find((e) => e.key === k)?.group ?? "misc";
    return iconGroups
      .map((g) => ({
        g,
        items: [...keys]
          .filter((k) => groupOf(k) === g)
          .sort((a, b) => tr.name(a).localeCompare(tr.name(b), "th")) as IconKey[],
      }))
      .filter((x) => x.items.length > 0);
  }, [tr, dentist]);

  const takes = (k: IconKey) => treats.includes(k);
  const agesOf = (k: string): TreatAges => treatAges[k] ?? "both";
  const shownOnline = (k: string) => tr.list.find((e) => e.key === k)?.isActive ?? true;

  const setAges = (k: string, v: TreatAges) =>
    setTreatAges((prev) => {
      const next = { ...prev };
      if (v === "both") delete next[k];
      else next[k] = v;
      return next;
    });
  /** one answer for every treatment they take */
  const setAllAges = (v: TreatAges) => {
    const next: Partial<Record<string, TreatAges>> = {};
    if (v !== "both") for (const g of groups) for (const k of g.items) if (takes(k)) next[k] = v;
    setTreatAges(next);
  };
  const toggleTreat = (k: IconKey) =>
    setTreats((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const takenCount = groups.reduce((n, g) => n + g.items.filter(takes).length, 0);
  const allAges: TreatAges | null = (() => {
    const vals = new Set(groups.flatMap((g) => g.items.filter(takes).map(agesOf)));
    return vals.size === 1 ? [...vals][0] : null;
  })();

  const setShift = (w: number, patch: Partial<ShiftHour>) =>
    setShifts((prev) => prev.map((s) => (s.weekday === w ? { ...s, ...patch } : s)));
  const workDays = shifts.filter((s) => s.enabled).length;
  /** the first working day's hours, copied to every working day */
  const sameHoursForAll = () => {
    const first = WEEK_ORDER.map((w) => shifts.find((s) => s.weekday === w)).find((s) => s?.enabled);
    if (!first) return;
    setShifts((prev) => prev.map((s) => (s.enabled ? { ...s, start: first.start, end: first.end } : s)));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    // checked here rather than with `required`, which can't point at a field
    // sitting on a tab that isn't open
    if (isNew && !/^[a-z0-9-]+$/.test(slug.trim().toLowerCase())) {
      setTab("profile");
      setError("กรอกรหัสภาษาอังกฤษ (a-z, 0-9, -) สำหรับลิงก์หน้าคุณหมอ");
      return;
    }
    if (!thName.trim() || !enName.trim()) {
      setTab("profile");
      setError("กรอกชื่อคุณหมอทั้งภาษาไทยและภาษาอังกฤษ");
      return;
    }
    const badShift = shifts.find((s) => s.enabled && s.start >= s.end);
    if (badShift) {
      setTab("hours");
      setError(`วัน${WEEKDAY_NAMES[badShift.weekday]}: เวลาเลิกต้องหลังเวลาเริ่ม`);
      return;
    }

    const activeDaysTh = WEEK_ORDER.filter((w) => shifts.find((s) => s.weekday === w)?.enabled)
      .map((w) => WEEKDAY_NAMES[w])
      .join(", ");

    if (isNew) {
      createDentist({
        slug: slug.trim().toLowerCase(),
        years,
        licenseNo: licenseNo.trim(),
        tint,
        treats,
        treatAges,
        shifts,
        photoSmall,
        photoLarge,
        text: {
          th: {
            name: thName,
            title: thTitle,
            blurb: thBlurb,
            bio: "",
            credentials: [],
            languages: "",
            days: activeDaysTh || "ตามนัดหมาย",
          },
          en: {
            name: enName,
            title: enTitle,
            blurb: thBlurb,
            bio: "",
            credentials: [],
            languages: "",
            days: "",
          },
        },
      });
      onClose();
      return;
    }

    updateDentist(dentist.slug, {
      isActive,
      years,
      licenseNo: licenseNo.trim(),
      tint: tint as EditableDentist["tint"],
      shifts,
      treats,
      treatAges,
      // only a changed photo travels — an unchanged one is just its address
      ...(photoChanged ? { photo: { small: photoSmall, large: photoLarge } } : {}),
      text: {
        ...dentist.text,
        th: {
          ...dentist.text.th,
          name: thName,
          title: thTitle,
          blurb: thBlurb,
          days: activeDaysTh || "ตามนัดหมาย",
        },
        en: {
          ...dentist.text.en,
          name: enName,
          title: enTitle,
        },
      },
    });
    onClose();
  };

  const initial = thName.trim().split(/\s+/)[1]?.[0] || thName.trim()[0] || "ท";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card de-sheet" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSave}>
          {/* who this is, and whether they take bookings at all */}
          <div className="de-head">
            <span className="de-avatar" style={{ background: TINT_HEX[tint] ?? TINT_HEX.lav }} aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element -- shared with the desktop app, which has no next/image */}
              {photoSmall ? <img src={photoSmall} alt="" /> : initial}
            </span>
            <div className="de-title">
              <h3>{isNew ? "เพิ่มทันตแพทย์ใหม่" : thName || "ทันตแพทย์"}</h3>
              <span>{isNew ? "กรอกข้อมูล เลือกการรักษา และวันเวลาเข้าเวร" : thTitle || "แก้ไขข้อมูลทันตแพทย์"}</span>
            </div>
            {!isNew ? (
              <label className={`de-status ${isActive ? "on" : ""}`}>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span className="de-switch" aria-hidden="true" />
                <span>{isActive ? "เปิดรับนัด" : "พักงาน"}</span>
              </label>
            ) : null}
            <button type="button" className="btn-action-icon" onClick={onClose} aria-label="ปิด">
              <IconX size={18} />
            </button>
          </div>

          <div className="de-body">
            <nav className="de-tabs" aria-label="ส่วนของข้อมูล">
              <button type="button" className={tab === "profile" ? "on" : ""} onClick={() => setTab("profile")}>
                <span className="de-tab-name">ข้อมูลทั่วไป</span>
                <span className="de-tab-sub">ชื่อ ความเชี่ยวชาญ คำแนะนำ</span>
              </button>
              <button type="button" className={tab === "treats" ? "on" : ""} onClick={() => setTab("treats")}>
                <span className="de-tab-name">การรักษาที่รับ</span>
                <span className="de-tab-sub">รับ {takenCount} รายการ · เด็ก/ผู้ใหญ่</span>
              </button>
              <button type="button" className={tab === "hours" ? "on" : ""} onClick={() => setTab("hours")}>
                <span className="de-tab-name">วันเวลาเข้าเวร</span>
                <span className="de-tab-sub">{workDays > 0 ? `เข้าเวร ${workDays} วัน/สัปดาห์` : "ยังไม่มีวันเข้าเวร"}</span>
              </button>
            </nav>

            <div className="de-panel">
              {error ? <p className="de-error">{error}</p> : null}

              {tab === "profile" ? (
                <div className="de-section">
                  <div className="de-photos">
                    <div className="de-photo">
                      <span className="de-photo-k">รูปเล็ก</span>
                      <div className="de-photo-box small">
                        {/* eslint-disable-next-line @next/next/no-img-element -- shared with the desktop app, which has no next/image */}
                        {photoSmall ? <img src={photoSmall} alt="รูปเล็ก" /> : <span>{initial}</span>}
                      </div>
                      <p>แสดงในรายชื่อคุณหมอและตอนจอง · ครอปเป็นรูปสี่เหลี่ยมจัตุรัสให้อัตโนมัติ</p>
                      <div className="de-photo-btns">
                        <label className="btn-secondary-staff">
                          <input
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(e) => {
                              void pickPhoto(e.target.files?.[0], "small");
                              e.target.value = "";
                            }}
                          />
                          {photoSmall ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
                        </label>
                        {photoSmall ? (
                          <button type="button" className="btn-secondary-staff" onClick={() => removePhoto("small")}>
                            ลบรูป
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="de-photo">
                      <span className="de-photo-k">รูปใหญ่</span>
                      <div className="de-photo-box large">
                        {/* eslint-disable-next-line @next/next/no-img-element -- shared with the desktop app, which has no next/image */}
                        {photoLarge ? <img src={photoLarge} alt="รูปใหญ่" /> : <span>ยังไม่มีรูป</span>}
                      </div>
                      <p>แสดงในหน้าประวัติคุณหมอ · แนะนำรูปแนวตั้ง ครึ่งตัว</p>
                      <div className="de-photo-btns">
                        <label className="btn-secondary-staff">
                          <input
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(e) => {
                              void pickPhoto(e.target.files?.[0], "large");
                              e.target.value = "";
                            }}
                          />
                          {photoLarge ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
                        </label>
                        {photoLarge ? (
                          <button type="button" className="btn-secondary-staff" onClick={() => removePhoto("large")}>
                            ลบรูป
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {photoBusy ? <p className="de-photo-busy">กำลังย่อรูป…</p> : null}
                  </div>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label>ชื่อ-นามสกุล (ภาษาไทย) *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={thName}
                        placeholder="เช่น ทพญ. นรี ศรีวัฒนา"
                        onChange={(e) => {
                          setThName(e.target.value);
                          setError(null);
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Name (English) *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={enName}
                        placeholder="e.g. Dr. Naree Sriwattana"
                        onChange={(e) => {
                          setEnName(e.target.value);
                          setError(null);
                        }}
                      />
                    </div>
                  </div>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label>ความเชี่ยวชาญ (ไทย)</label>
                      <input
                        type="text"
                        className="form-control"
                        value={thTitle}
                        placeholder="เช่น ทันตแพทย์เฉพาะทางสำหรับเด็ก"
                        onChange={(e) => setThTitle(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Specialty (English)</label>
                      <input
                        type="text"
                        className="form-control"
                        value={enTitle}
                        placeholder="e.g. Pediatric dentist"
                        onChange={(e) => setEnTitle(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>คำแนะนำตัวสั้นๆ (แสดงบนหน้ารายชื่อคุณหมอ)</label>
                    <textarea
                      className="form-control de-textarea"
                      rows={3}
                      value={thBlurb}
                      placeholder="เช่น ใจเย็น ดูแลเด็กเล็กและการมาหาหมอฟันครั้งแรก"
                      onChange={(e) => setThBlurb(e.target.value)}
                    />
                  </div>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label>ประสบการณ์ (ปี)</label>
                      <input
                        type="number"
                        className="form-control"
                        min={0}
                        max={60}
                        value={years}
                        placeholder="เว้นว่างไว้ได้ถ้ายังไม่ระบุ"
                        onChange={(e) => setYears(Number(e.target.value) || 0)}
                      />
                    </div>
                    <div className="form-group">
                      <label>เลขที่ใบอนุญาตประกอบวิชาชีพ</label>
                      <input
                        type="text"
                        className="form-control"
                        value={licenseNo}
                        placeholder="เช่น ท.5021"
                        onChange={(e) => setLicenseNo(e.target.value)}
                      />
                    </div>
                    {isNew ? (
                      <div className="form-group">
                        <label>รหัสลิงก์ (ภาษาอังกฤษพิมพ์เล็ก) *</label>
                        <input
                          type="text"
                          className="form-control"
                          value={slug}
                          placeholder="เช่น naree"
                          onChange={(e) => {
                            setSlug(e.target.value);
                            setError(null);
                          }}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="form-group">
                    <label>สีการ์ดบนหน้าเว็บคนไข้</label>
                    <div className="de-tints">
                      {TINT_CHOICES.map((t) => (
                        <button
                          key={t}
                          type="button"
                          aria-label={t}
                          aria-pressed={tint === t}
                          className={tint === t ? "on" : ""}
                          style={{ background: TINT_HEX[t] }}
                          onClick={() => setTint(t)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "treats" ? (
                <div className="de-section">
                  <div className="de-intro">
                    <p>
                      ติ๊กการรักษาที่คุณหมอท่านนี้ทำ แล้วเลือกว่ารับคนไข้กลุ่มไหน —{" "}
                      <strong>เด็ก</strong> คืออายุต่ำกว่า {KID_UNDER} ปี หน้าเว็บจองจะแสดงคุณหมอให้ตรงกับที่ตั้งไว้
                    </p>
                    <div className="de-bulk">
                      <span>ตั้งทุกรายการที่รับเป็น</span>
                      <AgesSwitch value={allAges ?? ("" as TreatAges)} onChange={setAllAges} disabled={takenCount === 0} />
                    </div>
                  </div>

                  <div className="de-filter" role="radiogroup" aria-label="แสดงรายการ">
                    <button type="button" className={!onlyTaken ? "on" : ""} onClick={() => setOnlyTaken(false)}>
                      แสดงทั้งหมด
                    </button>
                    <button type="button" className={onlyTaken ? "on" : ""} onClick={() => setOnlyTaken(true)}>
                      เฉพาะที่รับ ({takenCount})
                    </button>
                  </div>

                  {groups.map(({ g, items }) => {
                    const shown = onlyTaken ? items.filter(takes) : items;
                    if (shown.length === 0) return null;
                    return (
                      <div key={g} className="de-group">
                        <h4>{dict.th.group[g]}</h4>
                        <div className="de-list">
                          {shown.map((k) => {
                            const on = takes(k);
                            return (
                              <div key={k} className={`de-treat${on ? " on" : ""}`}>
                                <label className="de-check">
                                  <input type="checkbox" checked={on} onChange={() => toggleTreat(k)} />
                                  <span className="de-tname">{tr.name(k)}</span>
                                  {!shownOnline(k) ? <span className="de-tag muted">เจ้าหน้าที่ลงนัดเท่านั้น</span> : null}
                                </label>
                                {on ? (
                                  <AgesSwitch value={agesOf(k)} onChange={(v) => setAges(k, v)} />
                                ) : (
                                  <span className="de-off">ไม่รับ</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {tab === "hours" ? (
                <div className="de-section">
                  <div className="de-intro">
                    <p>เปิดวันที่คุณหมอเข้าเวร แล้วตั้งเวลา — ช่วงเวลานี้คือเวลาที่คนไข้จองได้</p>
                    <button type="button" className="btn-secondary-staff" onClick={sameHoursForAll} disabled={workDays < 2}>
                      ใช้เวลาเดียวกันทุกวัน
                    </button>
                  </div>
                  <div className="de-list">
                    {WEEK_ORDER.map((w) => {
                      const s = shifts.find((x) => x.weekday === w)!;
                      return (
                        <div key={w} className={`de-day${s.enabled ? " on" : ""}`}>
                          <label className="de-status small">
                            <input
                              type="checkbox"
                              checked={s.enabled}
                              onChange={(e) => {
                                setShift(w, { enabled: e.target.checked });
                                setError(null);
                              }}
                            />
                            <span className="de-switch" aria-hidden="true" />
                            <span className="de-dayname">{WEEKDAY_NAMES[w]}</span>
                          </label>
                          {s.enabled ? (
                            <div className="de-times">
                              <input
                                type="time"
                                step={1800}
                                className="form-control"
                                value={s.start}
                                onChange={(e) => {
                                  setShift(w, { start: e.target.value });
                                  setError(null);
                                }}
                              />
                              <span>ถึง</span>
                              <input
                                type="time"
                                step={1800}
                                className="form-control"
                                value={s.end}
                                onChange={(e) => {
                                  setShift(w, { end: e.target.value });
                                  setError(null);
                                }}
                              />
                            </div>
                          ) : (
                            <span className="de-off">ไม่เข้าเวร</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary-staff" onClick={onClose}>
              ยกเลิก
            </button>
            <button type="submit" className="btn-primary-staff" disabled={photoBusy}>
              <IconCheck size={16} />
              <span>{isNew ? "เพิ่มทันตแพทย์" : "บันทึก"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
