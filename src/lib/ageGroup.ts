/**
 * Kids and adults. The family says who the booking is for — a kid (under 12)
 * or an adult (12 and over) — and each dentist says, per treatment, whether
 * they see kids only, adults only, or both. Booking only offers the dentists
 * (and so the treatments) that fit.
 */

/** who a booking is for */
export type AgeGroup = "kid" | "adult";

/** who a dentist sees for one treatment */
export type TreatAges = "kids" | "adults" | "both";

/** under this age is a kid; this age and over is an adult */
export const KID_UNDER = 12;

export const AGE_GROUPS: AgeGroup[] = ["kid", "adult"];
export const TREAT_AGES: TreatAges[] = ["kids", "both", "adults"];

export const isAgeGroup = (v: unknown): v is AgeGroup => v === "kid" || v === "adult";
export const isTreatAges = (v: unknown): v is TreatAges => v === "kids" || v === "adults" || v === "both";

/** may a dentist with this setting see this group? Unset or no group = yes */
export function agesAllow(ages: TreatAges | undefined, group: AgeGroup | null | undefined): boolean {
  if (!group || !ages || ages === "both") return true;
  return ages === (group === "kid" ? "kids" : "adults");
}

/** staff-facing labels */
export const AGE_GROUP_TH: Record<AgeGroup, string> = { kid: "เด็ก", adult: "ผู้ใหญ่" };
export const TREAT_AGES_TH: Record<TreatAges, string> = {
  kids: "เด็กเท่านั้น",
  both: "เด็กและผู้ใหญ่",
  adults: "ผู้ใหญ่เท่านั้น",
};
