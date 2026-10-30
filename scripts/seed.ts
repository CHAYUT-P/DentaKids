/**
 * Seed the database with the clinic's demo data.
 *
 * Run:  pnpm db:seed
 *
 * Idempotent: every section upserts on its natural key, so re-running
 * repairs/refreshes demo rows without orphaning anything. Appointment dates
 * are computed from today (Bangkok) at seed time, so the demo always shows a
 * plausible schedule. Re-seed any morning to pull "today" back to today.
 */
import "dotenv/config";

import { and, eq, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { dentists as dentistSeed } from "../src/data/dentists";
import { prices } from "../src/data/prices";
import { todayISO } from "../src/lib/dates";
import { buildDefaultAppointments, buildDefaultPatients } from "../src/lib/seedData";
import {
  appointment,
  child,
  clinicDay,
  clinicInfo,
  clinicSetting,
  dentist,
  dentistShift,
  dentistText,
  dentistTreat,
  guardian,
  holiday,
  staffNotification,
  treatment,
  waitlistEntry,
} from "../src/db/schema";

/**
 * Scripts run outside Next.js, where `server-only` (in src/db/index.ts) would
 * throw — so the seed builds its own client from the same DATABASE_URL.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = drizzle(postgres(url, { prepare: false }));

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

async function seedDentists() {
  for (const [i, d] of dentistSeed.entries()) {
    const [row] = await db
      .insert(dentist)
      .values({
        slug: d.slug,
        years: d.years,
        licenseNo: d.licenseNo,
        tint: d.tint,
        face: d.face,
        photoSmall: d.photo.small,
        photoLarge: d.photo.large,
        isActive: true,
        sort: i,
      })
      .onConflictDoUpdate({
        target: dentist.slug,
        set: {
          years: d.years,
          licenseNo: d.licenseNo,
          tint: d.tint,
          face: d.face,
          photoSmall: d.photo.small,
          photoLarge: d.photo.large,
          isActive: true,
          sort: i,
          updatedAt: new Date(),
        },
      })
      .returning({ id: dentist.id });

    // bilingual profile text
    for (const lang of ["th", "en"] as const) {
      const t = d.text[lang];
      await db
        .insert(dentistText)
        .values({
          dentistId: row.id,
          lang,
          name: t.name,
          title: t.title,
          blurb: t.blurb,
          bio: t.bio,
          credentials: t.credentials,
          languages: t.languages,
          days: t.days,
        })
        .onConflictDoUpdate({
          target: [dentistText.dentistId, dentistText.lang],
          set: {
            name: t.name,
            title: t.title,
            blurb: t.blurb,
            bio: t.bio,
            credentials: t.credentials,
            languages: t.languages,
            days: t.days,
          },
        });
    }

    // treatments this dentist takes — routine visits are ticked like any other,
    // and each row keeps the age scope from the roster (a kids-only dentist must
    // not be bookable for an adult)
    for (const k of new Set([...d.treats, "checkup", "consult", "followup"])) {
      const ages = d.treatAges?.[k] ?? "both";
      await db
        .insert(dentistTreat)
        .values({ dentistId: row.id, treatmentKey: k, ages })
        .onConflictDoUpdate({
          target: [dentistTreat.dentistId, dentistTreat.treatmentKey],
          set: { ages },
        });
    }

    // weekly shifts — mirrors the old buildDefaultDentists logic
    const dayMap: Record<string, number> = {
      จันทร์: 1,
      อังคาร: 2,
      พุธ: 3,
      พฤหัสบดี: 4,
      ศุกร์: 5,
      เสาร์: 6,
    };
    for (let w = 0; w < 7; w++) {
      const isWorking =
        w !== 0 && Object.entries(dayMap).some(([th, num]) => num === w && d.text.th.days.includes(th));
      await db
        .insert(dentistShift)
        .values({
          dentistId: row.id,
          weekday: w,
          enabled: isWorking,
          start: "09:00",
          end: w === 5 ? "20:00" : w === 6 ? "17:00" : "18:00",
        })
        .onConflictDoUpdate({
          target: [dentistShift.dentistId, dentistShift.weekday],
          set: { enabled: isWorking, start: "09:00", end: w === 5 ? "20:00" : w === 6 ? "17:00" : "18:00" },
        });
    }
  }

  /**
   * Retire dentists that are no longer in the roster.
   *
   * Upserting on slug only ever adds, so a dentist removed from
   * src/data/dentists.ts would keep taking bookings forever. They are retired
   * (is_active = false) rather than deleted, because appointments and invoices
   * point at them by id — a delete would orphan that history.
   */
  const keep = dentistSeed.map((d) => d.slug);
  const retired = await db
    .update(dentist)
    .set({ isActive: false, sort: 9999, updatedAt: new Date() })
    .where(and(eq(dentist.isActive, true), notInArray(dentist.slug, keep)))
    .returning({ slug: dentist.slug });
  for (const r of retired) console.log(`  · retired ${r.slug} (no longer in the roster)`);
}

async function seedTreatments() {
  const entries = Object.entries(prices) as [string, number | null][];
  for (const [key, price] of entries) {
    await db
      .insert(treatment)
      .values({ key, price, durationMin: 30, isActive: true, sort: 0 })
      .onConflictDoUpdate({ target: treatment.key, set: { price } });
  }
}

async function seedClinicDays() {
  // Mon–Thu 09–18, Fri 09–20, Sat 09–17, Sun closed
  const plan: Record<string, { isOpen: boolean; start: string; end: string }> = {
    sun: { isOpen: false, start: "09:00", end: "18:00" },
    mon: { isOpen: true, start: "09:00", end: "18:00" },
    tue: { isOpen: true, start: "09:00", end: "18:00" },
    wed: { isOpen: true, start: "09:00", end: "18:00" },
    thu: { isOpen: true, start: "09:00", end: "18:00" },
    fri: { isOpen: true, start: "09:00", end: "20:00" },
    sat: { isOpen: true, start: "09:00", end: "17:00" },
  };
  for (const day of DAY_KEYS) {
    const p = plan[day];
    await db
      .insert(clinicDay)
      .values({ day, isOpen: p.isOpen, start: p.start, end: p.end })
      .onConflictDoUpdate({ target: clinicDay.day, set: { isOpen: p.isOpen, start: p.start, end: p.end } });
  }
}

async function seedHolidays() {
  const rows = [
    { start: "2026-12-31", end: "2026-12-31", name: "วันสิ้นปี" },
    { start: "2027-01-01", end: "2027-01-01", name: "วันขึ้นปีใหม่" },
    { start: "2027-04-13", end: "2027-04-15", name: "วันสงกรานต์" },
  ];
  const existing = await db.select({ start: holiday.start, end: holiday.end }).from(holiday);
  for (const r of rows) {
    if (!existing.some((e) => e.start === r.start && e.end === r.end)) {
      await db.insert(holiday).values(r);
    }
  }
}

/**
 * Guardians + children from the same demo families the staff mock used,
 * returning a lookup from child name → ids for the appointment seeder.
 * Upserts on phone / (guardian, name) so re-seeding never duplicates.
 */
async function seedPatients(): Promise<{ childIdByName: Map<string, number>; guardianIdByName: Map<string, number> }> {
  const childIdByName = new Map<string, number>();
  const guardianIdByName = new Map<string, number>();

  for (const fam of buildDefaultPatients()) {
    const phoneDigits = fam.phone.replace(/\D/g, "");
    const [g] = await db
      .insert(guardian)
      .values({
        name: fam.guardianName,
        phone: phoneDigits,
      })
      .onConflictDoUpdate({
        target: guardian.phone,
        set: { name: fam.guardianName, updatedAt: new Date() },
      })
      .returning({ id: guardian.id });
    guardianIdByName.set(fam.guardianName, g.id);

    for (const c of fam.children) {
      const clean = c.name.trim();
      const [row] = await db
        .insert(child)
        .values({
          guardianId: g.id,
          name: clean,
          nickname: c.nickname,
          age: c.age,
          allergies: c.allergies ?? "",
          notes: c.notes ?? "",
        })
        .onConflictDoNothing()
        .returning({ id: child.id });
      if (row) {
        childIdByName.set(clean, row.id);
      } else {
        // already there from a previous seed — look the id up
        const existing = await db
          .select({ id: child.id })
          .from(child)
          .where(and(eq(child.guardianId, g.id), eq(child.name, clean)));
        childIdByName.set(clean, existing[0].id);
      }
    }
  }
  return { childIdByName, guardianIdByName };
}

async function seedClinicInfo() {
  /**
   * The clinic's real contact row. The address/phone here are the old demo
   * placeholders — the owner will paste the verified Chon Buri details from
   * the Google Maps listing (see docs/PROJECT.md § Backend). onConflictDoNothing
   * means staff edits are never overwritten by a re-seed.
   */
  await db
    .insert(clinicInfo)
    .values({
      id: 1,
      phone: "021234567",
      phoneDisplay: "02-123-4567",
      lineId: "@dentakids",
      lineUrl: "https://line.me/R/ti/p/~@dentakids",
      mapUrl: "https://maps.app.goo.gl/KJvwAruQJT99UZuEA",
      directionsUrl:
        "https://www.google.com/maps/dir/?api=1&destination=Denta+Kids+Dental+Center+Samet+Chon+Buri",
      addressTh: "ตำบลเสม็ด อำเภอเมืองชลบุรี ชลบุรี 20000 (ที่อยู่เต็มรอยืนยันจากเจ้าของ)",
      addressEn: "Samet, Mueang Chon Buri District, Chon Buri 20000 (full address pending owner confirmation)",
      landmarkTh: "ใกล้สี่แยกเสม็ด ชลบุรี",
      landmarkEn: "Near Samet intersection, Chon Buri",
    })
    .onConflictDoNothing();
}

async function main() {
  console.log("Seeding Denta Kids database…");

  await seedDentists();
  await seedTreatments();
  await seedClinicDays();
  await seedClinicInfo();
  // chair count staff edits later — never overwritten by a re-seed
  await db
    .insert(clinicSetting)
    .values({ key: "chairs", value: "3" })
    .onConflictDoNothing();
  await seedHolidays();
  const { childIdByName, guardianIdByName } = await seedPatients();

  // ── appointments (demo schedule around today) ────────────────────────────
  const today = todayISO();
  const dentistsAll = await db.select({ id: dentist.id, slug: dentist.slug }).from(dentist);
  const dentistIdBySlug = new Map(dentistsAll.map((d) => [d.slug, d.id]));

  const demo = buildDefaultAppointments(today);
  // clear previous demo appointments so re-seeding never double-books
  await db.delete(appointment);
  await db.delete(staffNotification);
  await db.delete(waitlistEntry);

  for (const a of demo) {
    const dentistId = dentistIdBySlug.get(a.dentistSlug);
    if (!dentistId) {
      console.warn(`  ! unknown dentist slug ${a.dentistSlug}, skipping`);
      continue;
    }
    await db
      .insert(appointment)
      .values({
        ref: a.ref,
        childId: childIdByName.get(a.childName) ?? null,
        childName: a.childName,
        guardianId: guardianIdByName.get(a.guardianName) ?? null,
        guardianName: a.guardianName,
        phone: a.phone.replace(/\D/g, ""),
        dentistId,
        treatmentKey: a.treatmentKey,
        date: a.date,
        time: a.time,
        durationMin: a.durationMin,
        source: a.source,
        status: a.status,
        note: a.notes ?? "",
        price: a.price,
        forSelf: false,
      })
      .onConflictDoNothing();
  }

  // ── one demo waitlist entry + notifications (same as the old mock) ───────
  const walkInDentistId = dentistIdBySlug.get("onanong");
  await db.insert(waitlistEntry).values({
    childName: "น้องพร้อม",
    guardianPhone: "0898765432",
    treatmentKey: "checkup",
    dentistId: walkInDentistId ?? null,
    arrivedAt: "09:40",
    status: "waiting",
    note: "Walk-in ตรวจฟันครั้งแรก รอต่อจากน้องเจได",
  });

  await db.insert(staffNotification).values([
    {
      type: "online_booking",
      title: "การจองใหม่ออนไลน์ (LINE LIFF)",
      body: "น้องต้นกล้า จองขูดหินปูน กับ ทพ. ขานนท์ เวลา 13:30 น.",
      refCode: "DK-4832",
      isRead: true,
    },
    {
      type: "reminder",
      title: "ส่งการแจ้งเตือน LINE อัตโนมัติ",
      body: "ส่งข้อความเตือนนัดหมายพรุ่งนี้ 2 รายการเรียบร้อยแล้ว",
      isRead: true,
    },
  ]);

  const counts = await Promise.all([
    db.$count(dentist),
    db.$count(appointment),
    db.$count(guardian),
    db.$count(child),
  ]);
  console.log(
    `Done. dentists=${counts[0]} appointments=${counts[1]} guardians=${counts[2]} children=${counts[3]}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
