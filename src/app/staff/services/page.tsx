"use client";

import React, { useMemo, useState } from "react";
import { useStaff } from "@/lib/staffStore";
import { iconGroups } from "@/data/icons";
import { useT } from "@/i18n/lang";
import type { TreatmentInfo } from "@/lib/treatments";
import { ServiceIcon } from "@/components/shared/serviceIcons";
import { TreatmentModal } from "@/components/staff/settings/TreatmentModal";
import { IconCheck, IconEdit, IconPlus, IconSearch } from "@/components/staff/shell/staffIcons";

type Show = "all" | "on" | "off";

/**
 * บริการ & ราคา — every treatment the clinic offers, by group. Each row: the
 * icon and name, the starting price (edit in place), whether it shows on the
 * patient site, and an edit button for name / icon / colour / group. "เพิ่ม
 * บริการ" adds a new one that can reuse any icon.
 */
export default function StaffServicesPage() {
  const { treatments: all, updateTreatment, setAllShowPrice } = useStaff();
  // "more" is the home page's see-all tile, not a treatment anyone books
  const treatments = useMemo(() => all.filter((t) => t.key !== "more"), [all]);
  const dict = useT();

  const [search, setSearch] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceValue, setPriceValue] = useState("");
  const [modal, setModal] = useState<TreatmentInfo | "new" | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return treatments.filter((t) => {
      if (show === "on" && !t.isActive) return false;
      if (show === "off" && t.isActive) return false;
      if (!q) return true;
      return t.name.th.toLowerCase().includes(q) || t.name.en.toLowerCase().includes(q);
    });
  }, [treatments, search, show]);

  const onCount = treatments.filter((t) => t.isActive).length;
  /** absent (older server) counts as shown */
  const priceShown = (t: TreatmentInfo) => t.showPrice !== false;
  const priceOnCount = treatments.filter(priceShown).length;

  const startPrice = (t: TreatmentInfo) => {
    setEditingPrice(t.key);
    setPriceValue(t.price === null ? "" : String(t.price));
  };

  const savePrice = (t: TreatmentInfo) => {
    const raw = priceValue.trim();
    const num = raw === "" ? null : Number(raw.replace(/[^\d]/g, ""));
    updateTreatment(t.key, { price: num !== null && Number.isFinite(num) ? num : null });
    setEditingPrice(null);
  };

  const priceText = (p: number | null) =>
    p === null ? "ประเมินหน้างาน" : p === 0 ? "ฟรี (รวมในค่าตรวจ)" : `฿${p.toLocaleString()}`;

  return (
    <div className="staff-container">
      <div className="staff-page-header">
        <div>
          <h2>บริการ &amp; ราคา</h2>
          <p>
            แสดงบนเว็บ {onCount} จาก {treatments.length} บริการ · แสดงราคา {priceOnCount} รายการ ·
            แก้แล้วหน้าเว็บคนไข้อัปเดตทันที
          </p>
        </div>
        <button type="button" className="btn-secondary-staff btn-lg" onClick={() => setModal("new")}>
          <IconPlus size={17} />
          <span>เพิ่มบริการ</span>
        </button>
      </div>

      <div className="staff-toolbar">
        <div className="staff-pill-group">
          <button type="button" className={`staff-pill-btn ${show === "all" ? "active" : ""}`} onClick={() => setShow("all")}>
            ทั้งหมด
          </button>
          <button type="button" className={`staff-pill-btn ${show === "on" ? "active" : ""}`} onClick={() => setShow("on")}>
            แสดงบนเว็บ
          </button>
          <button type="button" className={`staff-pill-btn ${show === "off" ? "active" : ""}`} onClick={() => setShow("off")}>
            ซ่อนอยู่
          </button>
        </div>
        <div className="svc-price-all" role="group" aria-label="ราคาบนเว็บคนไข้">
          <span>ราคาบนเว็บ:</span>
          <button
            type="button"
            className="btn-secondary-staff"
            disabled={priceOnCount === treatments.length}
            onClick={() => setAllShowPrice(true)}
          >
            แสดงทั้งหมด
          </button>
          <button
            type="button"
            className="btn-secondary-staff"
            disabled={priceOnCount === 0}
            onClick={() => setAllShowPrice(false)}
          >
            ซ่อนทั้งหมด
          </button>
        </div>
        <div className="staff-search-box" style={{ width: "300px" }}>
          <IconSearch size={15} color="var(--staff-ink-muted)" />
          <input
            type="search"
            aria-label="ค้นหาบริการ"
            placeholder="ค้นหาชื่อบริการ…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {iconGroups.map((g) => {
        const items = visible.filter((t) => t.group === g);
        if (items.length === 0) return null;
        return (
          <section key={g} className="svc-group">
            <h3 className="svc-group-title">
              {dict.group[g]} <span>{items.length}</span>
            </h3>
            <div className="ledger-table">
              {items.map((t) => (
                <div key={t.key} className={`svc-row ${t.isActive ? "" : "hidden-svc"}`}>
                  <span className={`svc-disc tint-${t.tint}`}>
                    <ServiceIcon k={t.icon} size={24} />
                  </span>

                  <span className="svc-name">
                    <span className="svc-th">
                      {t.name.th}
                      {t.custom ? <span className="svc-badge">เพิ่มเอง</span> : null}
                    </span>
                    <span className="svc-en">{t.name.en}</span>
                  </span>

                  <span className="svc-price">
                    {editingPrice === t.key ? (
                      <span className="svc-price-edit">
                        <input
                          className="form-control"
                          inputMode="numeric"
                          aria-label={`ราคา ${t.name.th}`}
                          placeholder="ว่าง = ประเมิน"
                          value={priceValue}
                          autoFocus
                          onChange={(e) => setPriceValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") savePrice(t);
                            if (e.key === "Escape") setEditingPrice(null);
                          }}
                        />
                        <button
                          type="button"
                          className="btn-action-icon success"
                          aria-label="บันทึกราคา"
                          onClick={() => savePrice(t)}
                        >
                          <IconCheck size={15} />
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="svc-price-btn" onClick={() => startPrice(t)} title="แตะเพื่อแก้ราคา">
                        {priceText(t.price)}
                      </button>
                    )}
                    <label className="svc-price-show" title="แสดงราคานี้บนเว็บคนไข้หรือไม่">
                      <input
                        type="checkbox"
                        checked={priceShown(t)}
                        onChange={(e) => updateTreatment(t.key, { showPrice: e.target.checked })}
                      />
                      <span>{priceShown(t) ? "แสดงราคาบนเว็บ" : "ซ่อนราคา"}</span>
                    </label>
                  </span>

                  <label className="svc-switch" title={t.isActive ? "แสดงบนเว็บคนไข้" : "ซ่อนจากเว็บคนไข้"}>
                    <input
                      type="checkbox"
                      checked={t.isActive}
                      onChange={(e) => updateTreatment(t.key, { isActive: e.target.checked })}
                    />
                    <span>{t.isActive ? "แสดงบนเว็บ" : "ซ่อนอยู่"}</span>
                  </label>

                  <button type="button" className="btn-secondary-staff" onClick={() => setModal(t)}>
                    <IconEdit size={14} />
                    <span>แก้ไข</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {visible.length === 0 ? <div className="staff-empty">ไม่พบบริการที่ตรงกับการค้นหา</div> : null}

      {modal ? <TreatmentModal treatment={modal === "new" ? null : modal} onClose={() => setModal(null)} /> : null}
    </div>
  );
}
