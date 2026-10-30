import type {
  StaffAppointment,
  EditableDentist,
  PatientRecord,
  VisitRecord,
  WaitlistEntry,
  StaffNotification,
  ShiftHour,
} from "@/lib/staffStore";
import type {
  AppointmentDTO,
  DentistDTO,
  GuardianDTO,
  NotificationDTO,
  VisitRecordDTO,
  WaitlistDTO,
} from "@/server/queries";
import type { IconKey } from "@/data/icons";

/**
 * DB → staff-UI adapters. The staff console's components render the shapes from
 * src/lib/staffStore.tsx (StaffAppointment, EditableDentist, PatientRecord…);
 * the database stores the same facts normalised across tables. These pure
 * functions convert one to the other so the UI keeps working unchanged while
 * the storage underneath becomes Postgres.
 */

export function toUIAppointment(a: AppointmentDTO): StaffAppointment {
  return {
    id: String(a.id),
    ref: a.ref,
    date: a.date,
    time: a.time,
    durationMin: a.durationMin,
    childName: a.childName,
    childId: a.childId != null ? String(a.childId) : null,
    guardianName: a.guardianName,
    phone: a.phone,
    dentistSlug: a.dentistSlug,
    dentistId: a.dentistId,
    treatmentKey: a.treatmentKey,
    source: a.source,
    status: a.status,
    checkedInAt: a.checkedInAt,
    notes: a.note,
    price: a.price ?? undefined,
    forSelf: a.forSelf,
    ageGroup: a.ageGroup,
    lineName: a.lineName,
    hasLine: a.hasLine,
    createdAt: a.date,
  };
}

export function toUIAppointments(list: AppointmentDTO[]): StaffAppointment[] {
  return list.map(toUIAppointment);
}

export function toUIEditableDentist(d: DentistDTO): EditableDentist {
  const shifts: ShiftHour[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const s = d.shifts.find((x) => x.weekday === weekday);
    return {
      weekday,
      enabled: s?.enabled ?? false,
      start: s?.start ?? "09:00",
      end: s?.end ?? "17:00",
    };
  });
  return {
    ...({ _id: d.id } as object), // the DB id, carried for booking mutations
    slug: d.slug,
    years: d.years,
    licenseNo: d.licenseNo,
    tint: d.tint as EditableDentist["tint"],
    face: d.face as EditableDentist["face"],
    photo: { small: d.photoSmall, large: d.photoLarge },
    treats: d.treats,
    treatAges: d.treatAges ?? {},
    text: d.text as EditableDentist["text"],
    isActive: d.isActive,
    shifts,
  };
}

export function toUIEditableDentists(list: DentistDTO[]): EditableDentist[] {
  return list.map(toUIEditableDentist);
}

export function toUIPatient(g: GuardianDTO): PatientRecord {
  return {
    id: String(g.id),
    guardianName: g.name,
    guardianFullName: g.fullName || undefined,
    guardianRelation: g.relation || undefined,
    phone: g.phone.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"),
    lineId: g.lineContact || undefined,
    address: g.address || undefined,
    children: g.children.map((c) => ({
      id: String(c.id),
      name: c.name,
      fullName: c.fullName || undefined,
      nickname: c.nickname ?? undefined,
      age: c.age ?? undefined,
      birthdate: c.birthdate ?? undefined,
      gender: (c.gender || undefined) as PatientRecord["children"][number]["gender"],
      hn: c.hn ?? undefined,
      bloodType: (c.bloodType || undefined) as PatientRecord["children"][number]["bloodType"],
      idCard: c.idCard || undefined,
      tags: c.tags,
      recallMonths: c.recallMonths,
      coverage: c.coverage,
      conditions: c.conditions || undefined,
      medications: c.medications || undefined,
      allergies: c.allergies || undefined,
      notes: c.notes || undefined,
    })),
    registeredAt: g.registeredAt,
  };
}

export function toUIPatients(list: GuardianDTO[]): PatientRecord[] {
  return list.map(toUIPatient);
}

export function toUIWaitlistEntry(w: WaitlistDTO): WaitlistEntry {
  return {
    id: String(w.id),
    childName: w.childName,
    guardianPhone: w.guardianPhone,
    treatmentKey: w.treatmentKey,
    dentistSlug: w.dentistSlug ?? undefined,
    arrivedAt: w.arrivedAt,
    status: w.status,
    notes: w.note,
  };
}

export function toUIWaitlist(list: WaitlistDTO[]): WaitlistEntry[] {
  return list.map(toUIWaitlistEntry);
}

export function toUINotification(n: NotificationDTO): StaffNotification {
  return {
    id: String(n.id),
    type: n.type as StaffNotification["type"],
    title: n.title,
    body: n.body,
    time: n.createdAt.slice(11, 16),
    unread: !n.isRead,
    refCode: n.refCode ?? undefined,
  };
}

export function toUINotifications(list: NotificationDTO[]): StaffNotification[] {
  return list.map(toUINotification);
}

export function toUIVisitRecord(v: VisitRecordDTO): VisitRecord {
  return {
    id: String(v.id),
    appointmentId: v.appointmentId != null ? String(v.appointmentId) : undefined,
    waitlistId: v.waitlistId != null ? String(v.waitlistId) : undefined,
    dentistSlug: v.dentistSlug ?? undefined,
    treatments: v.treatments as IconKey[],
    detail: v.detail,
    price: v.price ?? undefined,
    items: v.items as VisitRecord["items"],
    updatedAt: v.updatedAt,
  };
}

export function toUIVisitRecords(list: VisitRecordDTO[]): VisitRecord[] {
  return list.map(toUIVisitRecord);
}
