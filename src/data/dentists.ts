import type { TreatAges } from "@/lib/ageGroup";
import type { Lang } from "@/i18n/dict";
import type { IconKey, Tint } from "./icons";

/**
 * The dentist roster. Everything a patient sees about a dentist lives here, in
 * both languages, because the copy is per-person data rather than UI strings —
 * `src/i18n/dict.ts` cannot hold it (its `Dict` type is flat) and the staff app
 * will eventually write these same fields into Postgres.
 *
 * Two pictures per dentist, as the clinic asked: `photo.small` is the round
 * thumbnail used in lists, `photo.large` the portrait on the profile page. Both
 * are empty until the staff app uploads real ones; while they are empty the app
 * draws the `face` below instead, so no screen ever shows a broken frame.
 */

/** The drawn stand-in for a photograph — see src/components/portrait.tsx. */
export type Face = {
  skin: string;
  hair: string;
  cut: "bun" | "bob" | "short" | "wave" | "crop";
  scrubs: string;
  extra: "none" | "glasses" | "cap";
};

/** Uploaded by the staff app: a thumbnail and a full portrait. */
export type Photos = { small: string; large: string };

export type DentistText = {
  /** with the Thai honorific, e.g. "ทพญ. นรี ศรีวัฒนา" */
  name: string;
  /** the speciality line under the name */
  title: string;
  /** one line, for the list and the home strip */
  blurb: string;
  /** the long description; blank line separated, rendered with pre-line */
  bio: string;
  credentials: string[];
  languages: string;
  days: string;
};

export type Dentist = {
  slug: string;
  years: number;
  /** disc/panel colour behind the portrait */
  tint: Tint;
  face: Face;
  photo: Photos;
  /** what this dentist takes bookings for */
  treats: IconKey[];
  /** per treatment, who they see — "kids", "adults"; missing = both */
  treatAges?: Partial<Record<string, TreatAges>>;
  text: Record<Lang, DentistText>;
};

export const dentists: Dentist[] = [
  {
    slug: "naree",
    years: 12,
    tint: "rose",
    face: { skin: "#f7d5c0", hair: "#3a2b3f", cut: "bun", scrubs: "#fea6c9", extra: "none" },
    photo: { small: "", large: "" },
    treats: ["checkup", "fluoride", "sealant", "filling", "pulpotomy", "kids"],
    text: {
      th: {
        name: "ทพญ. นรี ศรีวัฒนา",
        title: "ทันตแพทย์เฉพาะทางสำหรับเด็ก",
        blurb: "ดูแลเด็กเล็กและการมาหาหมอฟันครั้งแรก",
        bio: "คุณหมอนรีดูแลคนไข้เด็กมากว่า 12 ปี ถนัดเรื่องเด็กเล็กที่มาหาหมอฟันครั้งแรก ใช้วิธีค่อย ๆ ทำความคุ้นเคยกับเด็กก่อนเริ่มตรวจ เพื่อให้เด็กไม่กลัวและอยากกลับมาอีก\nนอกจากงานในคลินิก คุณหมอยังสอนผู้ปกครองเรื่องการแปรงฟันและอาหารที่ทำให้ฟันผุ เพราะเชื่อว่าการป้องกันง่ายกว่าการรักษา",
        credentials: [
          "ทันตแพทยศาสตรบัณฑิต จุฬาลงกรณ์มหาวิทยาลัย",
          "วุฒิบัตรทันตกรรมสำหรับเด็ก",
          "สมาชิกทันตแพทยสมาคมแห่งประเทศไทย",
        ],
        languages: "ไทย, อังกฤษ",
        days: "จันทร์, พุธ, ศุกร์, เสาร์",
      },
      en: {
        name: "Dr. Naree Sriwattana",
        title: "Paediatric dentist",
        blurb: "Toddlers and first-ever dental visits",
        bio: "Dr. Naree has treated children for over 12 years and is happiest with toddlers on their very first visit, taking the time to let a child get used to the room before anything begins.\nOutside the surgery they coach parents on brushing and on the food that causes decay, on the principle that prevention is easier than treatment.",
        credentials: [
          "DDS, Chulalongkorn University",
          "Board certified in paediatric dentistry",
          "Member, Dental Association of Thailand",
        ],
        languages: "Thai, English",
        days: "Mon, Wed, Fri, Sat",
      },
    },
  },
  {
    slug: "piya",
    years: 15,
    tint: "violet",
    face: { skin: "#efc3a4", hair: "#2f2536", cut: "crop", scrubs: "#d6b8e9", extra: "glasses" },
    photo: { small: "", large: "" },
    treats: ["braces", "aligner", "retainer", "spacemaintainer", "jaw", "nightguard"],
    text: {
      th: {
        name: "ทพ. ปิยะ วรกุล",
        title: "ทันตแพทย์จัดฟัน",
        blurb: "จัดฟันเด็กและวัยรุ่น ทั้งเหล็กและใส",
        bio: "คุณหมอปิยะดูแลงานจัดฟันของคลินิกทั้งหมด ตั้งแต่การประเมินฟันที่ขึ้นผิดตำแหน่งในเด็กเล็ก ไปจนถึงการจัดฟันเต็มรูปแบบในวัยรุ่น\nคุณหมอจะอธิบายแผนการรักษาให้ทั้งเด็กและผู้ปกครองเข้าใจก่อนเริ่มทุกครั้ง รวมถึงระยะเวลาและค่าใช้จ่ายทั้งหมด",
        credentials: [
          "ทันตแพทยศาสตรบัณฑิต มหาวิทยาลัยมหิดล",
          "วุฒิบัตรทันตกรรมจัดฟัน",
          "ประกาศนียบัตรการจัดฟันแบบใส",
        ],
        languages: "ไทย, อังกฤษ",
        days: "อังคาร, พฤหัสบดี, เสาร์",
      },
      en: {
        name: "Dr. Piya Worakul",
        title: "Orthodontist",
        blurb: "Braces and clear aligners for kids and teens",
        bio: "Dr. Piya runs all of the clinic's orthodontic work, from spotting a crowded bite in a small child through to full treatment for a teenager.\nEvery plan is explained to the child and the parent together before anything starts, timeline and cost included.",
        credentials: [
          "DDS, Mahidol University",
          "Board certified in orthodontics",
          "Certified in clear aligner therapy",
        ],
        languages: "Thai, English",
        days: "Tue, Thu, Sat",
      },
    },
  },
  {
    slug: "manee",
    years: 9,
    tint: "steel",
    face: { skin: "#f9dfcc", hair: "#4a3326", cut: "bob", scrubs: "#b6c6fa", extra: "none" },
    photo: { small: "", large: "" },
    treats: ["scaling", "polish", "gum", "brushing", "floss", "mouthwash"],
    text: {
      th: {
        name: "ทพญ. มณีรัตน์ อินทโชติ",
        title: "ทันตกรรมป้องกันและอนามัยช่องปาก",
        blurb: "ขูดหินปูน ขัดฟัน และสอนแปรงฟัน",
        bio: "คุณหมอมณีรัตน์ดูแลงานทำความสะอาดและป้องกันทั้งหมดของคลินิก ตั้งแต่ขูดหินปูน ขัดฟัน จนถึงการสอนเด็กแปรงฟันด้วยตัวเอง\nคุณหมอจะทำให้การขูดหินปูนครั้งแรกเป็นเรื่องสนุก โดยให้เด็กลองจับเครื่องมือและฟังเสียงก่อนเริ่มจริง",
        credentials: [
          "ทันตแพทยศาสตรบัณฑิต มหาวิทยาลัยเชียงใหม่",
          "ประกาศนียบัตรทันตกรรมป้องกันในเด็ก",
        ],
        languages: "ไทย, อังกฤษ, คำเมือง",
        days: "จันทร์, อังคาร, พฤหัสบดี, ศุกร์",
      },
      en: {
        name: "Dr. Manee Inthachot",
        title: "Preventive dentistry & oral hygiene",
        blurb: "Scaling, polishing and brushing lessons",
        bio: "Dr. Manee looks after every cleaning and prevention visit in the clinic, from scaling and polishing to teaching a child to brush properly on their own.\nA first scaling is turned into a game: the child gets to hold the instrument and hear it run before anything touches a tooth.",
        credentials: [
          "DDS, Chiang Mai University",
          "Certificate in preventive paediatric dentistry",
        ],
        languages: "Thai, English, Northern Thai",
        days: "Mon, Tue, Thu, Fri",
      },
    },
  },
  {
    slug: "thanakrit",
    years: 18,
    tint: "peri",
    face: { skin: "#e2ab86", hair: "#332a2a", cut: "short", scrubs: "#c9a4e2", extra: "cap" },
    photo: { small: "", large: "" },
    treats: ["extraction", "wisdom", "surgery", "anesthesia", "rootcanal", "toothache"],
    text: {
      th: {
        name: "ทพ. ธนกฤต เจริญพงศ์",
        title: "ศัลยกรรมช่องปากและรักษารากฟัน",
        blurb: "ถอนฟัน ผ่าฟันคุด และเคสปวดฟันฉุกเฉิน",
        bio: "คุณหมอธนกฤตดูแลเคสที่ต้องผ่าตัดและเคสปวดฟันฉุกเฉิน ประสบการณ์ 18 ปี ทำงานเร็วและนุ่มนวล เพื่อให้เด็กอยู่บนเก้าอี้สั้นที่สุด\nสำหรับเด็กที่กังวลมาก คุณหมอใช้ยาคลายความกังวลร่วมกับการอธิบายทุกขั้นตอนก่อนทำ",
        credentials: [
          "ทันตแพทยศาสตรบัณฑิต มหาวิทยาลัยขอนแก่น",
          "วุฒิบัตรศัลยศาสตร์ช่องปากและแม็กซิลโลเฟเชียล",
          "ประกาศนียบัตรการรักษารากฟัน",
        ],
        languages: "ไทย, อังกฤษ",
        days: "พุธ, ศุกร์, เสาร์",
      },
      en: {
        name: "Dr. Thanakrit Charoenpong",
        title: "Oral surgery & endodontics",
        blurb: "Extractions, wisdom teeth and emergencies",
        bio: "Dr. Thanakrit handles the surgical and emergency cases, and after 18 years works quickly and gently so that a child spends as little time in the chair as possible.\nFor an anxious child, mild sedation is combined with a full walk-through of what is about to happen.",
        credentials: [
          "DDS, Khon Kaen University",
          "Board certified in oral and maxillofacial surgery",
          "Certificate in endodontics",
        ],
        languages: "Thai, English",
        days: "Wed, Fri, Sat",
      },
    },
  },
  {
    slug: "siriporn",
    years: 7,
    tint: "gold",
    face: { skin: "#f7d5c0", hair: "#5a4231", cut: "wave", scrubs: "#fee6a6", extra: "none" },
    photo: { small: "", large: "" },
    treats: ["filling", "crown", "bridge", "whitening", "veneer", "denture"],
    text: {
      th: {
        name: "ทพญ. ศิริพร ใจดี",
        title: "ทันตกรรมบูรณะและความสวยงาม",
        blurb: "อุดฟัน ครอบฟัน และงานความสวยงาม",
        bio: "คุณหมอศิริพรดูแลงานบูรณะฟัน ตั้งแต่อุดฟันน้ำนมที่ผุ ไปจนถึงครอบฟันและงานความสวยงามในวัยรุ่น เน้นการเลือกสีและรูปฟันให้กลมกลืนกับฟันเดิม\nคุณหมอชอบให้เด็กเลือกสีวัสดุอุดเองในเคสที่เลือกได้ เพราะทำให้เด็กรู้สึกเป็นเจ้าของการรักษา",
        credentials: [
          "ทันตแพทยศาสตรบัณฑิต มหาวิทยาลัยสงขลานครินทร์",
          "ประกาศนียบัตรทันตกรรมบูรณะเชิงความงาม",
        ],
        languages: "ไทย, อังกฤษ",
        days: "จันทร์, พุธ, พฤหัสบดี",
      },
      en: {
        name: "Dr. Siriporn Jaidee",
        title: "Restorative & cosmetic dentistry",
        blurb: "Fillings, crowns and cosmetic work",
        bio: "Dr. Siriporn covers restorative work, from filling a decayed baby tooth to crowns and cosmetic treatment for teenagers, matching shade and shape to the teeth already there.\nWhere the material allows a choice, the child gets to pick the colour — it makes the treatment feel like theirs.",
        credentials: [
          "DDS, Prince of Songkla University",
          "Certificate in aesthetic restorative dentistry",
        ],
        languages: "Thai, English",
        days: "Mon, Wed, Thu",
      },
    },
  },
];

/**
 * The routine visits every dentist here takes. `treats` below is a specialty
 * list — without this, booking a check-up would offer exactly one dentist.
 */
export const generalTreats: IconKey[] = ["checkup", "consult", "followup"];

/**
 * Who can be booked for a treatment: the dentists who list it, everyone for a
 * routine visit, and everyone again for a treatment no profile claims yet (the
 * staff app can add it to a profile later without breaking the booking flow).
 */
export function dentistsFor(k: IconKey): Dentist[] {
  if (generalTreats.includes(k)) return dentists;
  const able = dentists.filter((d) => d.treats.includes(k));
  return able.length > 0 ? able : dentists;
}

export function dentistBySlug(slug: string): Dentist | undefined {
  return dentists.find((d) => d.slug === slug);
}
