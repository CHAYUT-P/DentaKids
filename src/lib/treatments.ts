import { iconGroups, iconLibrary, isIconKey, type IconGroup, type IconKey, type Tint } from "@/data/icons";
import { dict, type Lang } from "@/i18n/dict";

/**
 * The clinic's treatment list, as one shape both apps read.
 *
 * A treatment is a row in the `treatment` table. The built-in ones use an
 * IconKey as their key ("checkup") and take their names from i18n/dict.ts;
 * ones the clinic adds get an "x-…" key, typed names, and pick any icon from
 * the library — so one drawing can serve several treatments. Bookings store
 * the key, so a hidden treatment still reads correctly on old bookings.
 */

export type TreatmentKey = string;

export interface TreatmentInfo {
  key: TreatmentKey;
  icon: IconKey;
  tint: Tint;
  group: IconGroup;
  name: Record<Lang, string>;
  /** baht; null = quoted at the visit; 0 = included */
  price: number | null;
  /** false = the patient site doesn't show this price */
  showPrice: boolean;
  durationMin: number;
  /** false = hidden from the patient site */
  isActive: boolean;
  sort: number;
  /** added by the clinic rather than one of the built-in set */
  custom: boolean;
}

/** the raw row shape (DB columns) the catalogue is built from */
export interface TreatmentRow {
  key: string;
  iconKey: string | null;
  nameTh: string | null;
  nameEn: string | null;
  tint: string | null;
  groupKey: string | null;
  price: number | null;
  /** absent on rows read before the column existed — shown */
  showPrice?: boolean;
  durationMin: number;
  isActive: boolean;
  sort: number;
}

const LIB = new Map(iconLibrary.map((e) => [e.key, e]));
const TINTS: Tint[] = ["rose", "peri", "violet", "blue", "steel", "gold", "lav"];

const asTint = (v: string | null | undefined): Tint | undefined =>
  v && (TINTS as string[]).includes(v) ? (v as Tint) : undefined;
const asGroup = (v: string | null | undefined): IconGroup | undefined =>
  v && (iconGroups as string[]).includes(v) ? (v as IconGroup) : undefined;

/** a DB row → what the screens draw; every blank falls back to the built-in */
export function toTreatmentInfo(r: TreatmentRow): TreatmentInfo {
  const builtIn = isIconKey(r.key);
  const icon: IconKey = r.iconKey && isIconKey(r.iconKey) ? r.iconKey : builtIn ? (r.key as IconKey) : "more";
  const lib = LIB.get(icon);
  return {
    key: r.key,
    icon,
    tint: asTint(r.tint) ?? lib?.tint ?? "lav",
    group: asGroup(r.groupKey) ?? lib?.group ?? "misc",
    name: {
      th: r.nameTh || (builtIn ? dict.th.service[r.key as IconKey] : "") || r.nameEn || r.key,
      en: r.nameEn || (builtIn ? dict.en.service[r.key as IconKey] : "") || r.nameTh || r.key,
    },
    price: r.price,
    showPrice: r.showPrice ?? true,
    durationMin: r.durationMin,
    isActive: r.isActive,
    sort: r.sort,
    custom: !builtIn,
  };
}

/** the built-in reading of a key nobody stored (e.g. no catalogue loaded) */
export function builtInTreatment(key: TreatmentKey): TreatmentInfo {
  return toTreatmentInfo({
    key,
    iconKey: null,
    nameTh: null,
    nameEn: null,
    tint: null,
    groupKey: null,
    price: null,
    durationMin: 30,
    isActive: true,
    sort: 0,
  });
}

/** fast lookups over a list, with the built-in reading as the fallback */
export function treatmentLookup(list: TreatmentInfo[] | undefined) {
  const byKey = new Map((list ?? []).map((t) => [t.key, t]));
  const get = (key: TreatmentKey) => byKey.get(key) ?? builtInTreatment(key);
  return {
    get,
    name: (key: TreatmentKey, lang: Lang = "th") => get(key).name[lang],
    icon: (key: TreatmentKey) => get(key).icon,
    tint: (key: TreatmentKey) => get(key).tint,
  };
}

/** make a key for a treatment the clinic adds: "x-" + a short random id */
export function newTreatmentKey(): TreatmentKey {
  return `x-${Math.random().toString(36).slice(2, 8)}`;
}
