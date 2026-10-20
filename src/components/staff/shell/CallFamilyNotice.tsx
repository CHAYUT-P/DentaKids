import { IconPhone } from "@/components/staff/shell/staffIcons";

/**
 * "This family didn't book through LINE — call them": the clinic can't
 * message them, so a moved or cancelled booking only reaches them by phone.
 * Shown big on purpose — it's the step that's easy to forget.
 */
export function CallFamilyNotice({ phone }: { phone: string }) {
  return (
    <div className="call-family" role="note">
      <span className="cf-icon" aria-hidden="true">
        <IconPhone size={22} />
      </span>
      <div className="cf-text">
        <strong>นัดนี้ไม่ได้จองผ่าน LINE — โทรแจ้งผู้ปกครองที่</strong>
        <span className="cf-phone">{phone || "ไม่มีเบอร์โทร"}</span>
      </div>
    </div>
  );
}
