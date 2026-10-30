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
  /**
   * Years in practice. `0` means the clinic has not filled it in yet — every
   * screen hides the badge rather than printing "0 ปี".
   */
  years: number;
  /** เลขที่ใบอนุญาตประกอบวิชาชีพทันตกรรม (ท.xxxx); empty = not recorded */
  licenseNo: string;
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

/**
 * The clinic's six dentists.
 *
 * Only what the clinic actually gave us is filled in: name, licence number,
 * speciality and the university behind their dental degree. `years`, `blurb`,
 * `bio`, `languages` and both photos are deliberately left empty — staff type
 * them into the dentist editor later, and every screen hides an empty field
 * instead of printing a placeholder. The weekly `days` are a working mock-up so
 * booking has something to offer; the real duty roster replaces them before
 * launch.
 */
export const dentists: Dentist[] = [
  {
    slug: "onanong",
    years: 0,
    licenseNo: "ท.5021",
    tint: "rose",
    face: { skin: "#f7d5c0", hair: "#3a2b3f", cut: "bun", scrubs: "#fea6c9", extra: "none" },
    photo: { small: "", large: "" },
    treats: ["kids", "babytooth", "fluoride", "sealant", "pulpotomy"],
    treatAges: {
      kids: "kids",
      babytooth: "kids",
      fluoride: "kids",
      sealant: "kids",
      pulpotomy: "kids",
      checkup: "kids",
      consult: "kids",
      followup: "kids",
    },
    text: {
      th: {
        name: "ทพญ. อรอนงค์ พนังคสิริ",
        title: "ทันตแพทย์เฉพาะทางสำหรับเด็ก",
        blurb: "",
        bio: "",
        credentials: ["ทันตแพทยศาสตรบัณฑิต มหาวิทยาลัยเชียงใหม่"],
        languages: "",
        days: "จันทร์, พุธ, ศุกร์, เสาร์",
      },
      en: {
        name: "Dr. Onanong Panangkasiri",
        title: "Paediatric dentist",
        blurb: "",
        bio: "",
        credentials: ["DDS, Chiang Mai University"],
        languages: "",
        days: "Mon, Wed, Fri, Sat",
      },
    },
  },
  {
    slug: "piyada",
    years: 0,
    licenseNo: "ท.7188",
    tint: "lav",
    face: { skin: "#f9dfcc", hair: "#4a3326", cut: "bob", scrubs: "#d6b8e9", extra: "none" },
    photo: { small: "", large: "" },
    treats: ["kids", "babytooth", "fluoride", "sealant", "spacemaintainer"],
    treatAges: {
      kids: "kids",
      babytooth: "kids",
      fluoride: "kids",
      sealant: "kids",
      spacemaintainer: "kids",
      checkup: "kids",
      consult: "kids",
      followup: "kids",
    },
    text: {
      th: {
        name: "ทพญ. ปิยดา บุญเพ็ญ",
        title: "ทันตแพทย์เด็ก",
        blurb: "",
        bio: "",
        credentials: ["ทันตแพทยศาสตรบัณฑิต มหาวิทยาลัยมหิดล"],
        languages: "",
        days: "อังคาร, พฤหัสบดี, เสาร์",
      },
      en: {
        name: "Dr. Piyada Boonpen",
        title: "Paediatric dentist",
        blurb: "",
        bio: "",
        credentials: ["DDS, Mahidol University"],
        languages: "",
        days: "Tue, Thu, Sat",
      },
    },
  },
  {
    slug: "khanon",
    years: 0,
    licenseNo: "ท.18624",
    tint: "violet",
    face: { skin: "#efc3a4", hair: "#2f2536", cut: "crop", scrubs: "#c9a4e2", extra: "glasses" },
    photo: { small: "", large: "" },
    treats: ["checkup", "filling", "extraction", "scaling", "rootcanal", "toothache"],
    text: {
      th: {
        name: "ทพ. ขานนท์ คำศิลป์",
        title: "ทันตแพทย์ผู้ใหญ่และเด็ก",
        blurb: "",
        bio: "",
        credentials: ["ทันตแพทยศาสตรบัณฑิต มหาวิทยาลัยเวสเทิร์น"],
        languages: "",
        days: "จันทร์, อังคาร, พฤหัสบดี, ศุกร์",
      },
      en: {
        name: "Dr. Khanon Kamsin",
        title: "Dentist for adults & children",
        blurb: "",
        bio: "",
        credentials: ["DDS, Western University"],
        languages: "",
        days: "Mon, Tue, Thu, Fri",
      },
    },
  },
  {
    slug: "phannathip",
    years: 0,
    licenseNo: "ท.1617",
    tint: "gold",
    face: { skin: "#f7d5c0", hair: "#5a4231", cut: "wave", scrubs: "#fee6a6", extra: "none" },
    photo: { small: "", large: "" },
    treats: ["checkup", "consult", "followup", "scaling", "polish", "filling", "extraction", "whitening"],
    text: {
      th: {
        name: "ทพญ. พรรณทิพย์ สิงหจันทร์",
        title: "ทันตแพทย์ทั่วไป",
        blurb: "",
        bio: "",
        credentials: ["ทันตแพทยศาสตรบัณฑิต จุฬาลงกรณ์มหาวิทยาลัย"],
        languages: "",
        days: "จันทร์, พุธ, พฤหัสบดี",
      },
      en: {
        name: "Dr. Phannathip Singhachan",
        title: "General dentist",
        blurb: "",
        bio: "",
        credentials: ["DDS, Chulalongkorn University"],
        languages: "",
        days: "Mon, Wed, Thu",
      },
    },
  },
  {
    slug: "phakphum",
    years: 0,
    licenseNo: "ท.9863",
    tint: "steel",
    face: { skin: "#e2ab86", hair: "#332a2a", cut: "short", scrubs: "#b6c6fa", extra: "cap" },
    photo: { small: "", large: "" },
    treats: ["extraction", "wisdom", "surgery", "anesthesia", "sedation", "rootcanal", "toothache"],
    text: {
      th: {
        name: "ทพ. ภาคภูมิ ฉายศรีศิริ",
        title: "ทันตแพทย์ศัลยกรรมช่องปาก",
        blurb: "",
        bio: "",
        credentials: ["ทันตแพทยศาสตรบัณฑิต มหาวิทยาลัยธรรมศาสตร์"],
        languages: "",
        days: "พุธ, ศุกร์, เสาร์",
      },
      en: {
        name: "Dr. Phakphum Chaisrisiri",
        title: "Oral surgeon",
        blurb: "",
        bio: "",
        credentials: ["DDS, Thammasat University"],
        languages: "",
        days: "Wed, Fri, Sat",
      },
    },
  },
  {
    slug: "chawalit",
    years: 0,
    licenseNo: "ท.10031",
    tint: "peri",
    face: { skin: "#e8c4a8", hair: "#3a2b3f", cut: "short", scrubs: "#a3b6f7", extra: "none" },
    photo: { small: "", large: "" },
    treats: ["braces", "aligner", "retainer", "spacemaintainer", "nightguard", "jaw"],
    text: {
      th: {
        name: "ทพ. ชวลิต สุจริตวิริยะกุล",
        title: "ทันตแพทย์จัดฟัน",
        blurb: "",
        bio: "",
        credentials: ["ทันตแพทยศาสตรบัณฑิต มหาวิทยาลัยมหิดล"],
        languages: "",
        days: "อังคาร, พฤหัสบดี, เสาร์",
      },
      en: {
        name: "Dr. Chawalit Sujaritwiriyakul",
        title: "Orthodontist",
        blurb: "",
        bio: "",
        credentials: ["DDS, Mahidol University"],
        languages: "",
        days: "Tue, Thu, Sat",
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
