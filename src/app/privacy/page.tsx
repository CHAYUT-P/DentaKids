import type { Metadata } from "next";
import { connection } from "next/server";

import { PrivacyPage } from "@/components/patient/PrivacyPage";
import { getClinicInfo } from "@/server/queries";

export const metadata: Metadata = {
  title: "Denta Kids · นโยบายความเป็นส่วนตัว",
  description: "ข้อมูลที่เว็บไซต์จองนัดเก็บ ใช้ทำอะไร และสิทธิของคุณตาม PDPA",
};

/** the PDPA notice — the clinic's phone and LINE come from clinic_info */
export default async function Page() {
  await connection();
  return <PrivacyPage info={await getClinicInfo()} />;
}
