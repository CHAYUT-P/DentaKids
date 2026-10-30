import type { AgeGroup, TreatAges } from "@/lib/ageGroup";
import type { IconKey } from "@/data/icons";
import type { TreatmentKey } from "@/lib/treatments";

/**
 * The staff console's UI types. They used to live inside staffStore.tsx; they
 * are extracted here so server-side modules can import them without pulling in
 * the client store (and its React context) into the server bundle.
 */

export type AppointmentStatus =
  | "confirmed"
  | "arrived"
  | "in_chair"
  | "completed"
  | "cancelled"
  | "no_show";
export type BookingSource = "online" | "phone" | "walkin";

/**
 * Which feature set this staff build carries. "queue" is the default install:
 * queue + bookings + website content. "full" adds patient records, per-dentist
 * room pages and the per-PC device mode — same codebase, bigger bundle
 * (vite build --mode full / STAFF_EDITION=full on the web).
 */
export type StaffEdition = "queue" | "full";

export interface StaffAppointment {
  id: string;
  ref: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMin: number;
  childName: string;
  /** DB child row id when the booking matched a patient record — the room
   *  page uses it to surface allergies/conditions */
  childId?: string | null;
  childAge?: number;
  guardianName: string;
  phone: string;
  dentistSlug: string;
  /** null = pooled "any dentist" booking still waiting for assignment */
  dentistId: number | null;
  treatmentKey: TreatmentKey;
  source: BookingSource;
  status: AppointmentStatus;
  /** HH:MM the family checked in at the desk (status "arrived" onward) */
  checkedInAt?: string | null;
  notes?: string;
  price?: number;
  createdAt: string;
  /** true when the patient booked for themselves (adult, no child involved) */
  forSelf?: boolean;
  /** "kid" (under 12) / "adult" as the family picked it online; null = not asked */
  ageGroup?: AgeGroup | null;
  /** LINE display name of the account that booked online ("" or absent = not via LINE) */
  lineName?: string;
  /** booked from LINE — the desk can message the family from the app */
  hasLine?: boolean;
}

export interface ShiftHour {
  weekday: number; // 0 = Sun, 1 = Mon … 6 = Sat
  enabled: boolean;
  start: string;
  end: string;
}

export interface EditableDentist {
  slug: string;
  years: number;
  /** เลขที่ใบอนุญาตประกอบวิชาชีพ (ท.xxxx); "" = not recorded */
  licenseNo: string;
  tint: string;
  face: Record<string, unknown>;
  photo: { small: string; large: string };
  treats: IconKey[];
  /** per treatment, who they see — "kids" / "adults"; missing = both */
  treatAges: Partial<Record<string, TreatAges>>;
  text: Record<"th" | "en", {
    name: string;
    title: string;
    blurb: string;
    bio: string;
    credentials: string[];
    languages: string;
    days: string;
  }>;
  isActive: boolean;
  shifts: ShiftHour[];
}

export interface PatientChild {
  id: string;
  /** everyday display name, e.g. "น้องเจได" */
  name: string;
  fullName?: string;
  nickname?: string;
  birthdate?: string;
  age?: number;
  gender?: "male" | "female";
  hn?: string;
  bloodType?: "" | "A" | "B" | "O" | "AB";
  /** เลขบัตรประชาชน */
  idCard?: string;
  tags?: string[];
  /** months between check-ups (0 = none) */
  recallMonths?: number;
  /** who pays — see COVERAGE_LABEL */
  coverage?: string;
  conditions?: string;
  medications?: string;
  allergies?: string;
  notes?: string;
}

export interface PatientRecord {
  id: string;
  guardianName: string;
  guardianFullName?: string;
  guardianRelation?: string;
  phone: string;
  lineId?: string;
  address?: string;
  children: PatientChild[];
  registeredAt: string;
}

export interface WaitlistEntry {
  id: string;
  childName: string;
  guardianPhone: string;
  treatmentKey: TreatmentKey;
  dentistSlug?: string;
  arrivedAt: string;
  status: "waiting" | "in_chair" | "done";
  notes?: string;
}

/** one child row in a patient form payload — what the server writes */
export interface PatientChildInput {
  /** DB id when editing an existing child row; absent = new child */
  id?: number;
  name: string;
  fullName?: string;
  nickname?: string;
  birthdate?: string;
  age?: number | null;
  gender?: string;
  hn?: string;
  bloodType?: string;
  idCard?: string;
  tags?: string[];
  recallMonths?: number;
  coverage?: string;
  conditions?: string;
  medications?: string;
  allergies?: string;
  notes?: string;
}

/** the full guardian form — absent fields are left untouched server-side */
export interface PatientUpsertInput {
  name: string;
  fullName?: string;
  /** "แม่" | "พ่อ" | "ตนเอง" … */
  relation?: string;
  phone: string;
  /** the typed-in LINE id — stored as line_contact, never the push id */
  lineId?: string;
  address?: string;
  children?: PatientChildInput[];
}

/** the wire shape for saving a visit record — what the actions/API accept */
/** one billable line of a visit, as the dentist records it in the room */
export interface VisitItem {
  key: TreatmentKey;
  /** tooth numbers as written, e.g. "54 55" */
  teeth: string;
  qty: number;
  /** baht per unit */
  price: number;
}

export interface VisitRecordInput {
  /** the booking this visit came from — XOR waitlistId */
  appointmentId?: number | null;
  /** the walk-in queue row — XOR appointmentId */
  waitlistId?: number | null;
  dentistId?: number | null;
  /** IconKey[] — treatments actually performed */
  treatments: string[];
  detail: string;
  price?: number | null;
  items?: VisitItem[];
}

/**
 * The dentist's record of one visit (full edition — room page). Exactly one
 * of appointmentId / waitlistId is set: the visit it belongs to.
 */
export interface VisitRecord {
  id: string;
  appointmentId?: string;
  waitlistId?: string;
  dentistSlug?: string;
  /** IconKey[] — treatments actually performed */
  treatments: TreatmentKey[];
  detail: string;
  price?: number;
  /** the visit as billable lines; empty on records made before lines existed */
  items: VisitItem[];
  updatedAt: string;
}

/** a dentist's leave (ลา): no bookable slots from start to end, inclusive */
export interface DentistLeave {
  id: number;
  dentistId: number;
  dentistSlug: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  note: string;
}

export interface StaffNotification {
  id: string;
  type: "online_booking" | "cancellation" | "reschedule" | "check_in" | "reminder";
  title: string;
  body: string;
  time: string;
  unread: boolean;
  refCode?: string;
}
