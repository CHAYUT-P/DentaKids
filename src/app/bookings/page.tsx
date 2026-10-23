import type { Metadata } from "next";
import { connection } from "next/server";

import { BookingsPage } from "@/components/patient/BookingsPage";
import { nowMinutes, todayISO } from "@/lib/dates";
import { TreatmentsProvider } from "@/lib/treatmentsContext";
import { getBookingRules, getClinicInfo, listDentists, listTreatmentCatalog } from "@/server/queries";

export const metadata: Metadata = {
  title: "Denta Kids · ประวัติการจอง",
  description: "นัดหมายที่กำลังจะถึงและนัดหมายที่ผ่านมา",
};

/**
 * Identity arrives on the client, not here — the family's LINE sign-in picks
 * their bookings. No rows are preloaded: with nobody signed in, the page has
 * nothing of anybody's to show. What is loaded here is the clinic's own data
 * the rows are drawn with: treatment names, dentist names, the address.
 */
export default async function Page() {
  await connection();
  // every treatment and dentist, hidden/retired ones too — an old booking
  // still shows its name
  const [catalog, dentists, info, rules] = await Promise.all([
    listTreatmentCatalog(),
    listDentists(),
    getClinicInfo(),
    getBookingRules(),
  ]);
  const dentistNames = Object.fromEntries(
    dentists.map((d) => [d.slug, { th: d.text.th.name, en: d.text.en.name || d.text.th.name }]),
  );
  return (
    <TreatmentsProvider list={catalog}>
      <BookingsPage
        today={todayISO()}
        nowMin={nowMinutes()}
        cancelHours={rules.cancelHours}
        clinicPhone={info?.phone ? { tel: info.phone, display: info.phoneDisplay || info.phone } : null}
        dentistNames={dentistNames}
        address={{ th: info?.addressTh ?? "", en: info?.addressEn || info?.addressTh || "" }}
      />
    </TreatmentsProvider>
  );
}
