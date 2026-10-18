import { AGE_GROUP_TH, type AgeGroup } from "@/lib/ageGroup";

/** "เด็ก" / "ผู้ใหญ่" — who an online booking is for; nothing when not asked */
export function AgeTag({ group }: { group?: AgeGroup | null }) {
  if (!group) return null;
  return <span className={`age-tag ${group}`}>{AGE_GROUP_TH[group]}</span>;
}
