"use client";

import { useLang } from "@/i18n/lang";
import type { ClinicInfoDTO } from "@/server/queries";
import { Eyebrow, Panel, Screen } from "@/components/patient/screen";

/**
 * นโยบายความเป็นส่วนตัว — the PDPA notice for the booking website. It says
 * exactly what this site collects: the name to give at the desk, a phone
 * number, the LINE account the family books with, the booking itself and an
 * optional note. Fuller patient records are kept by the clinic's staff, not
 * here. The clinic should read and approve this wording before launch, and
 * update the "last updated" date when it changes.
 */
const UPDATED = { th: "24 ตุลาคม 2569", en: "24 October 2026" };

const TEXT = {
  th: {
    title: "นโยบายความเป็นส่วนตัว",
    sections: [
      {
        h: "ใครดูแลข้อมูลของคุณ",
        p: "คลินิกทันตกรรมเดนต้าคิดส์ เป็นผู้ควบคุมข้อมูลส่วนบุคคลที่คุณให้ไว้ผ่านเว็บไซต์จองนัดนี้ ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)",
      },
      {
        h: "ข้อมูลที่เราเก็บผ่านเว็บไซต์นี้",
        list: [
          "ชื่อที่ใช้จอง (ชื่อเล่นก็ได้) และเบอร์โทรศัพท์",
          "บัญชี LINE ที่ใช้จอง (รหัสผู้ใช้ LINE และชื่อที่แสดงใน LINE)",
          "ข้อมูลการนัด: วัน เวลา บริการ ทันตแพทย์ และผู้รับบริการเป็นเด็กหรือผู้ใหญ่",
          "ข้อความถึงคลินิกหรืออาการที่คุณเลือกกรอกเอง (ไม่บังคับ)",
          "ข้อมูลทางเทคนิค เช่น หมายเลข IP ใช้ชั่วคราวเพื่อป้องกันการใช้งานผิดปกติ",
        ],
        p: "เว็บไซต์นี้ไม่ขอชื่อ-นามสกุลจริง เลขบัตรประชาชน หรือที่อยู่ของคุณ",
      },
      {
        h: "เราใช้ข้อมูลเพื่ออะไร",
        list: [
          "จัดการนัดหมายตามที่คุณขอ: จอง เลื่อน และยกเลิกนัด",
          "แสดงนัดของคุณเมื่อเข้าสู่ระบบด้วย LINE",
          "ส่งข้อความยืนยันและเตือนนัดทาง LINE และติดต่อคุณเมื่อนัดมีการเปลี่ยนแปลง",
          "ให้ทันตแพทย์เตรียมการรักษาจากข้อความหรืออาการที่คุณกรอก",
        ],
        p: "ข้อความเกี่ยวกับอาการอาจเป็นข้อมูลสุขภาพ การกรอกถือว่าคุณยินยอมให้คลินิกใช้เพื่อเตรียมการรักษาเท่านั้น กรุณากรอกเฉพาะที่จำเป็น",
      },
      {
        h: "ใครเห็นข้อมูลของคุณ",
        p: "เจ้าหน้าที่และทันตแพทย์ของคลินิก และผู้ให้บริการที่ระบบจำเป็นต้องใช้ ได้แก่ ผู้ให้บริการเซิร์ฟเวอร์และ LINE เพื่อส่งข้อความ เราไม่ขายหรือส่งต่อข้อมูลของคุณเพื่อการตลาด",
      },
      {
        h: "เก็บไว้นานเท่าไร",
        p: "ข้อมูลการนัดเก็บไว้เป็นประวัติการรับบริการของคลินิก ตามระยะเวลาที่จำเป็นต่อการรักษาและตามที่กฎหมายกำหนด ชื่อและเบอร์ที่คุณกรอกล่าสุดจะถูกจำไว้ในเครื่องของคุณ (ไม่ใช่ที่คลินิก) เพื่อกรอกให้อัตโนมัติในการจองครั้งถัดไป",
      },
      {
        h: "สิทธิของคุณ",
        p: "คุณขอดู ขอสำเนา ขอแก้ไข ขอลบ หรือคัดค้านการใช้ข้อมูลของคุณได้ และถอนความยินยอมได้ทุกเมื่อ โดยติดต่อคลินิก",
      },
    ],
    contact: "ติดต่อคลินิก",
    updated: "ปรับปรุงล่าสุด",
  },
  en: {
    title: "Privacy notice",
    sections: [
      {
        h: "Who looks after your data",
        p: "Denta Kids Dental Clinic is the data controller for the personal data you give through this booking website, under Thailand's Personal Data Protection Act B.E. 2562 (PDPA).",
      },
      {
        h: "What this website collects",
        list: [
          "The name you book under (a nickname is fine) and a phone number",
          "The LINE account you book with (your LINE user id and display name)",
          "The booking: day, time, treatment, dentist, and whether it's for a child or an adult",
          "A note or symptoms you choose to write (optional)",
          "Technical data such as your IP address, used briefly to prevent abuse",
        ],
        p: "This website does not ask for your full legal name, ID card number or address.",
      },
      {
        h: "What we use it for",
        list: [
          "Managing the appointments you ask for: booking, moving and cancelling",
          "Showing your bookings when you sign in with LINE",
          "Sending confirmations and reminders on LINE, and contacting you if a booking changes",
          "Letting the dentist prepare from the note or symptoms you wrote",
        ],
        p: "A note about symptoms may be health information. By writing it you consent to the clinic using it only to prepare your treatment. Please write only what's needed.",
      },
      {
        h: "Who sees your data",
        p: "The clinic's staff and dentists, and the services the system needs to run: the server provider, and LINE to deliver messages. We never sell your data or share it for marketing.",
      },
      {
        h: "How long we keep it",
        p: "Bookings are kept as the clinic's record of your visits, for as long as treatment needs and the law requires. The name and phone you last entered are remembered on your own device (not by the clinic) to fill in your next booking.",
      },
      {
        h: "Your rights",
        p: "You can ask to see, copy, correct or delete your data, or object to its use, and withdraw consent at any time, by contacting the clinic.",
      },
    ],
    contact: "Contact the clinic",
    updated: "Last updated",
  },
};

export function PrivacyPage({ info }: { info: ClinicInfoDTO | null }) {
  const { lang } = useLang();
  const x = TEXT[lang];
  const phone = info?.phoneDisplay || info?.phone || "";
  return (
    <Screen title={x.title} back="/">
      {x.sections.map((sec) => (
        <div key={sec.h}>
          <Eyebrow>{sec.h}</Eyebrow>
          <Panel>
            {"list" in sec && sec.list ? (
              <ul className="prose privacyList">
                {sec.list.map((li) => (
                  <li key={li}>{li}</li>
                ))}
              </ul>
            ) : null}
            {sec.p ? <p className="prose">{sec.p}</p> : null}
          </Panel>
        </div>
      ))}
      <Eyebrow>{x.contact}</Eyebrow>
      <Panel>
        <p className="prose">
          {phone ? (
            <a href={`tel:${info?.phone ?? phone}`} className="privacyLink">
              {phone}
            </a>
          ) : null}
          {info?.lineId ? ` · LINE ${info.lineId}` : ""}
          {"\n"}
          {x.updated} {UPDATED[lang]}
        </p>
      </Panel>
    </Screen>
  );
}
