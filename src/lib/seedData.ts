import { addDays, weekdayIndex } from "./dates";
import type { IconKey } from "@/data/icons";

/**
 * Demo data shared by the database seed (scripts/seed.ts) and any code that
 * needs the same fixtures. Extracted from the old inline mock in
 * src/lib/staffStore.tsx so the seed and the UI never drift apart.
 *
 * Appointments are computed from "today" (Bangkok) at call time. Each booking
 * lands on the named dentist's next working day — the old mock booked
 * dentists on their days off, which real availability checking now forbids.
 */

/** weekly working days (0 = Sun … 6 = Sat), matching the shifts the seed writes */
const WORK_DAYS: Record<string, number[]> = {
  onanong: [1, 3, 5, 6], // จันทร์ พุธ ศุกร์ เสาร์
  piyada: [2, 4, 6], // อังคาร พฤหัสบดี เสาร์
  khanon: [1, 2, 4, 5], // จันทร์ อังคาร พฤหัสบดี ศุกร์
  phannathip: [1, 3, 4], // จันทร์ พุธ พฤหัสบดี
  phakphum: [3, 5, 6], // พุธ ศุกร์ เสาร์
  chawalit: [2, 4, 6], // อังคาร พฤหัสบดี เสาร์
};

/** the first day on/after `fromISO` that this dentist actually works */
function nextWorkingDay(slug: string, fromISO: string): string {
  const days = WORK_DAYS[slug];
  let iso = fromISO;
  for (let i = 0; i < 14; i++) {
    if (days?.includes(weekdayIndex(iso))) return iso;
    iso = addDays(iso, 1);
  }
  return fromISO;
}

export interface DemoAppointment {
  ref: string;
  date: string;
  time: string;
  durationMin: number;
  childName: string;
  childAge?: number;
  guardianName: string;
  phone: string;
  dentistSlug: string;
  treatmentKey: IconKey;
  source: "online" | "phone" | "walkin";
  status: "confirmed" | "completed" | "cancelled";
  notes?: string;
  price?: number;
}

export interface DemoPatient {
  guardianName: string;
  phone: string;
  children: {
    name: string;
    nickname?: string;
    age?: number;
    allergies?: string;
    notes?: string;
  }[];
}

export function buildDefaultPatients(): DemoPatient[] {
  return [
    {
      guardianName: "คุณแม่มณฑิรา (Mon)",
      phone: "081-234-5678",
      children: [
        {
          name: "น้องเจได (Jedi)",
          nickname: "เจได",
          age: 5,
          allergies: "ไม่มี",
          notes: "กลัวเสียงเครื่องกรอฟันเล็กน้อย ชอบฟังเพลงตอนตรวจ",
        },
      ],
    },
    {
      guardianName: "คุณพ่อนพดล (Nop)",
      phone: "089-876-5432",
      children: [
        {
          name: "น้องพรีม (Preme)",
          nickname: "พรีม",
          age: 8,
          allergies: "แพ้ยาเพนิซิลลิน",
          notes: "ฟันกรามแท้ซี่แรกขึ้นแล้ว แนะนำเคลือบหลุมร่องฟัน",
        },
        { name: "น้องพร้อม (Prom)", nickname: "พร้อม", age: 3, allergies: "ไม่มี", notes: "มาตรวจฟันครั้งแรก" },
      ],
    },
    {
      guardianName: "คุณแม่กมลวรรณ (Kamon)",
      phone: "084-555-1234",
      children: [
        {
          name: "น้องมินนี่ (Minnie)",
          nickname: "มินนี่",
          age: 12,
          allergies: "ไม่มี",
          notes: "เริ่มจัดฟันแบบใส ติดตามผลทุก 2 เดือน",
        },
      ],
    },
  ];
}

export function buildDefaultAppointments(tDate: string): DemoAppointment[] {
  return [
    // ── around today: each demo booking lands on that dentist's
    // next working day on/after today, so availability checking agrees ────
    {
      ref: "DK-4821",
      date: nextWorkingDay("onanong", tDate),
      time: "09:30",
      durationMin: 30,
      childName: "น้องเจได",
      childAge: 5,
      guardianName: "คุณแม่มณฑิรา",
      phone: "081-234-5678",
      dentistSlug: "onanong",
      treatmentKey: "checkup",
      source: "online",
      status: "confirmed",
      notes: "ตรวจสุขภาพฟันประจำ 6 เดือน",
      price: 300,
    },
    {
      ref: "DK-4825",
      date: nextWorkingDay("onanong", tDate),
      time: "10:30",
      durationMin: 30,
      childName: "น้องพรีม",
      childAge: 8,
      guardianName: "คุณพ่อนพดล",
      phone: "089-876-5432",
      dentistSlug: "onanong",
      treatmentKey: "sealant",
      source: "phone",
      status: "confirmed",
      notes: "เคลือบหลุมร่องฟันกราม 2 ซี่",
      price: 700,
    },
    {
      ref: "DK-4830",
      date: nextWorkingDay("chawalit", tDate),
      time: "11:00",
      durationMin: 30,
      childName: "น้องมินนี่",
      childAge: 12,
      guardianName: "คุณแม่กมลวรรณ",
      phone: "084-555-1234",
      dentistSlug: "chawalit",
      treatmentKey: "aligner",
      source: "online",
      status: "confirmed",
      notes: "เปลี่ยนชิ้นงานจัดฟันใสชุดที่ 4",
      price: 0,
    },
    {
      ref: "DK-4832",
      date: nextWorkingDay("khanon", tDate),
      time: "13:30",
      durationMin: 30,
      childName: "น้องต้นกล้า",
      childAge: 6,
      guardianName: "คุณแม่วิไล",
      phone: "082-999-1122",
      dentistSlug: "khanon",
      treatmentKey: "scaling",
      source: "online",
      status: "confirmed",
      notes: "ขูดหินปูนและขัดฟัน",
      price: 800,
    },
    {
      ref: "DK-4838",
      date: nextWorkingDay("phannathip", tDate),
      time: "15:00",
      durationMin: 30,
      childName: "น้องออโต้",
      childAge: 7,
      guardianName: "คุณพ่อกิตติ",
      phone: "086-333-4455",
      dentistSlug: "phannathip",
      treatmentKey: "filling",
      source: "phone",
      status: "confirmed",
      notes: "อุดฟันกรามน้ำนมล่างขวา 1 ด้าน",
      price: 900,
    },

    // ── tomorrow ─────────────────────────────────────────────────────────
    {
      ref: "DK-4850",
      date: nextWorkingDay("onanong", addDays(tDate, 1)),
      time: "10:00",
      durationMin: 30,
      childName: "น้องยูจิ",
      childAge: 4,
      guardianName: "คุณแม่พิมพ์",
      phone: "087-111-2233",
      dentistSlug: "onanong",
      treatmentKey: "fluoride",
      source: "online",
      status: "confirmed",
      notes: "เคลือบฟลูออไรด์วานิช",
      price: 600,
    },
    {
      ref: "DK-4852",
      date: nextWorkingDay("chawalit", addDays(tDate, 1)),
      time: "14:00",
      durationMin: 30,
      childName: "น้องไอริณ",
      childAge: 9,
      guardianName: "คุณพ่อชาญ",
      phone: "085-444-5566",
      dentistSlug: "chawalit",
      treatmentKey: "braces",
      source: "phone",
      status: "confirmed",
      notes: "ปรับลวดจัดฟันรายเดือน",
      price: 1500,
    },

    // ── in 3 days ────────────────────────────────────────────────────────
    {
      ref: "DK-4870",
      date: nextWorkingDay("phakphum", addDays(tDate, 3)),
      time: "11:30",
      durationMin: 30,
      childName: "น้องคอปเตอร์",
      childAge: 10,
      guardianName: "คุณแม่ศศิ",
      phone: "083-666-7788",
      dentistSlug: "phakphum",
      treatmentKey: "extraction",
      source: "online",
      status: "confirmed",
      notes: "ถอนฟันน้ำนมที่โยก",
      price: 700,
    },

    // ── past (history) ───────────────────────────────────────────────────
    {
      ref: "DK-4477",
      date: (() => { for (let i = 2; i < 9; i++) { const iso = addDays(tDate, -i); if (WORK_DAYS.onanong.includes(weekdayIndex(iso))) return iso; } return addDays(tDate, -2); })(),
      time: "16:00",
      durationMin: 30,
      childName: "น้องเจได",
      childAge: 5,
      guardianName: "คุณแม่มณฑิรา",
      phone: "081-234-5678",
      dentistSlug: "onanong",
      treatmentKey: "fluoride",
      source: "online",
      status: "completed",
      notes: "เคลือบฟลูออไรด์เสร็จเรียบร้อย แนะนำนัด 6 เดือน",
      price: 600,
    },
    {
      ref: "DK-4310",
      date: (() => { for (let i = 5; i < 12; i++) { const iso = addDays(tDate, -i); if (WORK_DAYS.phannathip.includes(weekdayIndex(iso))) return iso; } return addDays(tDate, -5); })(),
      time: "11:00",
      durationMin: 30,
      childName: "น้องพรีม",
      childAge: 8,
      guardianName: "คุณพ่อนพดล",
      phone: "089-876-5432",
      dentistSlug: "phannathip",
      treatmentKey: "filling",
      source: "phone",
      status: "completed",
      notes: "อุดฟันกรามบน 1 ซี่",
      price: 900,
    },
  ];
}
