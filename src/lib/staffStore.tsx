"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { IconKey } from "@/data/icons";
import type { TreatmentInfo } from "@/lib/treatments";
import type { DentistLeave } from "@/lib/staffTypes";
import { TreatmentsProvider } from "@/lib/treatmentsContext";
import type { ClinicDaySetting } from "@/lib/clinicSettings";
import { todayISO } from "@/lib/dates";
import { openStaffEvents } from "@/lib/staffEvents";
import { DEFAULT_RULES, type BookingRules } from "@/lib/bookingRules";
import {
  assignPoolDentist,
  staffAddChild,
  staffAddHoliday,
  staffAddWaitlist,
  staffCreateAppointment,
  staffCreateDentist,
  staffDeleteAppointment,
  staffFinishVisit,
  staffMarkNotificationsRead,
  staffRemoveHoliday,
  staffRemoveWaitlist,
  staffSaveVisitRecord,
  staffSetQueueStatus,
  staffSetWaitlistStatus,
  staffUpdateAppointment,
  staffUpdateChairs,
  staffUpdateBookingRules,
  staffAppointmentsBefore,
  staffUpdateClinicInfo,
  staffUpdateDay,
  staffUpdateDentist,
  staffUpdatePatient,
  staffUpdatePrice,
  staffCreateTreatment,
  staffAddDentistLeave,
  staffRemoveDentistLeave,
  staffMessageFamily,
  staffUpdateTreatment,
  staffSetAllShowPrice,
  staffBootstrap,
  staffUpsertPatient,
  type FamilyMessageResult,
  type StaffBootstrap,
  type VisitRecordInput,
} from "@/server/actions";
import type {
  AppointmentStatus,
  EditableDentist,
  PatientChildInput,
  PatientRecord,
  PatientUpsertInput,
  StaffAppointment,
  StaffEdition,
  StaffNotification,
  VisitRecord,
  WaitlistEntry,
} from "@/lib/staffTypes";

/**
 * The staff console's state — now backed by Postgres.
 *
 * The provider fetches its working state from the server (`staffBootstrap`)
 * and every mutation goes through a Server Action, then re-reads the
 * bootstrap so every page (and the patient site) shows the same truth.
 * The old localStorage mirror is gone; the database is the store.
 *
 * `initial` is supplied by the staff layout (a server component) so the first
 * paint already has data; `refresh()` re-fetches after each mutation.
 */

export type {
  AppointmentStatus,
  BookingSource,
  StaffAppointment,
  StaffEdition,
  EditableDentist,
  PatientRecord,
  PatientChild,
  PatientChildInput,
  PatientUpsertInput,
  WaitlistEntry,
  VisitRecord,
  StaffNotification,
  ShiftHour,
} from "@/lib/staffTypes";

/** what this PC is for — a per-device setting (localStorage), full edition only */
export type DeviceMode = "frontdesk" | "room";

const DEVICE_MODE_KEY = "dentakids.deviceMode";
const ROOM_DENTIST_KEY = "dentakids.roomDentist";

export interface StaffContextType {
  /** which build this is — "queue" hides patient records + room pages */
  edition: StaffEdition;
  /** this PC's role — "room" locks it onto one dentist's room page */
  deviceMode: DeviceMode;
  setDeviceMode: (mode: DeviceMode) => void;
  /** the dentist whose room this PC hosts (deviceMode "room") */
  roomDentistSlug: string | null;
  setRoomDentistSlug: (slug: string | null) => void;
  today: string;
  appointments: StaffAppointment[];
  dentists: EditableDentist[];
  patients: PatientRecord[];
  waitlist: WaitlistEntry[];
  visitRecords: VisitRecord[];
  notifications: StaffNotification[];
  servicePrices: Record<IconKey, number | null>;
  schedule: ClinicDaySetting[];
  holidays: { id: number; start: string; end: string; name: string }[];
  /** booking-rules knobs: chairs caps one wall-clock slot; the online rules
   *  (src/lib/bookingRules.ts): window, book-before, cancel-before, day queue */
  settings: { chairs: number } & BookingRules;
  updateChairs: (chairs: number) => void;
  updateBookingRules: (patch: Partial<BookingRules>) => void;
  /** `appointments` holds everything from this date on; older visits load
   *  with loadHistory() when a screen needs them */
  appointmentsFrom: string;
  historyLoaded: boolean;
  loadHistory: () => void;
  /** the clinic's saved contact details (phone, LINE, address, map) */
  clinicInfo: StaffBootstrap["clinicInfo"];
  updateClinicInfo: (patch: Parameters<typeof staffUpdateClinicInfo>[0]) => void;
  /** hand a pooled ("any dentist") booking to a dentist; true once saved */
  assignDentist: (id: string, dentistSlug: string) => Promise<boolean>;
  // Actions — same names the UI already calls; each writes to Postgres
  /** resolves true once saved; false = the time was taken or the save failed
   *  (a toast already said which) — keep the form open then */
  createAppointment: (
    data: Omit<StaffAppointment, "id" | "ref" | "createdAt" | "dentistId">,
    /** one key per "new appointment" window — a double click saves once */
    opts?: { idempotencyKey?: string },
  ) => Promise<boolean>;
  /** resolves true once saved — false if it failed (a toast already said so) */
  updateAppointment: (id: string, updates: Partial<StaffAppointment>) => Promise<boolean>;
  updateStatus: (id: string, status: AppointmentStatus) => void;
  /** queue transitions — check-in stamps the clinic clock server-side */
  setQueueStatus: (id: string, status: "confirmed" | "arrived" | "in_chair" | "completed" | "no_show") => void;
  /** resolves true once the move is saved — tell the family only then */
  rescheduleAppointment: (id: string, date: string, time: string, dentistSlug?: string) => Promise<boolean>;
  /** push a message into the family's LINE chat; resolves with what happened (and toasts it) */
  messageFamily: (id: string, text: string) => Promise<FamilyMessageResult>;
  deleteAppointment: (id: string) => void;
  updateDentist: (slug: string, updates: Partial<EditableDentist>) => void;
  createDentist: (input: Parameters<typeof staffCreateDentist>[0]) => void;
  createPatient: (data: Omit<PatientRecord, "id" | "registeredAt">) => void;
  updatePatient: (id: string, updates: Partial<PatientRecord>) => void;
  addPatientChild: (patientId: string, name: string) => void;
  addWaitlist: (entry: Omit<WaitlistEntry, "id" | "arrivedAt" | "status">) => void;
  updateWaitlistStatus: (id: string, status: WaitlistEntry["status"], dentistSlug?: string) => void;
  /** assign (or re-assign) a dentist while a walk-in still waits */
  assignWaitingDentist: (waitlistId: string, dentistSlug: string | null) => void;
  removeWaitlist: (id: string) => void;
  /* visit records — the room page's save/finish (full edition) */
  saveVisitRecord: (rec: Omit<VisitRecord, "id" | "updatedAt">) => void;
  finishVisit: (rec: Omit<VisitRecord, "id" | "updatedAt">) => void;
  refresh: () => void;
  updateServicePrice: (key: IconKey, price: number | null) => void;
  /** every treatment, shown or hidden — ตั้งค่า → บริการ & ราคา edits these */
  treatments: TreatmentInfo[];
  createTreatment: (input: Parameters<typeof staffCreateTreatment>[0]) => void;
  /** dentists' leave (ลา) — those days have no bookable slots */
  dentistLeaves: DentistLeave[];
  /** unanswered LINE messages (full edition's แชท LINE) */
  lineUnread: number;
  addDentistLeave: (dentistSlug: string, start: string, end: string, note: string) => void;
  removeDentistLeave: (id: number) => void;
  /** is this dentist on leave on this date? */
  onLeave: (dentistSlug: string, date: string) => DentistLeave | undefined;
  updateTreatment: (key: string, patch: Parameters<typeof staffUpdateTreatment>[1]) => void;
  /** show or hide every price on the patient site */
  setAllShowPrice: (show: boolean) => void;
  updateDayOpen: (day: ClinicDaySetting["day"], isOpen: boolean) => void;
  updateDayTime: (day: ClinicDaySetting["day"], field: "start" | "end", val: string) => void;
  addHoliday: (start: string, end: string, name: string) => void;
  removeHoliday: (id: number | string) => void;
  markAllNotificationsRead: () => void;
  simulateOnlineBooking: () => void;
  toast: string | null;
  showToast: (msg: string) => void;
  walkinOpen: boolean;
  setWalkinOpen: (open: boolean) => void;
  /** true while a mutation round-trip is in flight */
  syncing: boolean;
}

const StaffContext = createContext<StaffContextType | null>(null);

/** the bootstrap's schedule rows already match ClinicDaySetting */
function asClinicSchedule(rows: StaffBootstrap["schedule"]): ClinicDaySetting[] {
  return rows.map((r) => ({ day: r.day as ClinicDaySetting["day"], isOpen: r.isOpen, start: r.start, end: r.end }));
}

/**
 * The app can be newer than the server it talks to (a clinic PC updated
 * before the deploy). Lists an older server doesn't send yet become empty
 * instead of crashing the page.
 */
function withDefaults(b: StaffBootstrap): StaffBootstrap {
  return {
    ...b,
    treatments: b.treatments ?? [],
    dentistLeaves: b.dentistLeaves ?? [],
    holidays: b.holidays ?? [],
    waitlist: b.waitlist ?? [],
    visitRecords: b.visitRecords ?? [],
    notifications: b.notifications ?? [],
    lineUnread: b.lineUnread ?? 0,
    changeSeq: b.changeSeq ?? 0,
    // an older server sends every appointment ever
    appointmentsFrom: b.appointmentsFrom ?? "0000-01-01",
    settings: { ...DEFAULT_RULES, ...b.settings, chairs: b.settings?.chairs ?? 3 },
  };
}

/**
 * A fresh download replaces everything from its `appointmentsFrom` on; older
 * appointments this screen already has (history it loaded, or a day that just
 * rolled out of the window) stay, unless the download sent a newer copy.
 */
function mergeFresh(prev: StaffBootstrap, fresh: StaffBootstrap): StaffBootstrap {
  const next = withDefaults(fresh);
  // a slow download that left before a newer one must not roll the screen back
  if (next.changeSeq < (prev.changeSeq ?? 0) && next.today === prev.today) return prev;
  // the download also carries older appointments changed lately — those win
  const sent = new Set(next.appointments.map((a) => a.id));
  const older = prev.appointments.filter((a) => a.date < next.appointmentsFrom && !sent.has(a.id));
  return older.length ? { ...next, appointments: [...older, ...next.appointments] } : next;
}

export function StaffProvider({
  children,
  initial,
  edition = "queue",
}: {
  children: React.ReactNode;
  initial: StaffBootstrap;
  /** "queue" is the lean install; "full" adds patients + room pages */
  edition?: StaffEdition;
}) {
  const [state, setState] = useState<StaffBootstrap>(() => withDefaults(initial));
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [walkinOpen, setWalkinOpen] = useState(false);
  // per-PC role: this device either runs the desk console or sits in a
  // treatment room on one dentist's page. Persisted locally — it's about
  // THIS machine, not clinic state
  const [deviceMode, setDeviceModeState] = useState<DeviceMode>(() =>
    typeof window !== "undefined" && localStorage.getItem(DEVICE_MODE_KEY) === "room"
      ? "room"
      : "frontdesk",
  );
  const [roomDentistSlug, setRoomDentistSlugState] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(ROOM_DENTIST_KEY) : null,
  );

  const today = state.today || todayISO();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((current) => (current === msg ? null : current)), 3000);
  }, []);

  /**
   * Run a mutation against the server, then pull fresh state. Errors surface
   * as a toast; the UI stays usable because state only changes on success.
   */
  const mutate = useCallback(
    async (what: string, fn: () => Promise<unknown>): Promise<boolean> => {
      setSyncing(true);
      try {
        await fn();
      } catch (e) {
        console.error(e);
        showToast(`ข้อผิดพลาด: ${what} ไม่สำเร็จ`);
        // anything shown before the save (a typed price, a ticked box) goes
        // back to what the server really has
        staffBootstrap()
          .then((fresh) => setState((prev) => mergeFresh(prev, fresh)))
          .catch(() => {})
          .finally(() => setSyncing(false));
        return false;
      }
      // saved. The fresh download after it is only for the screen: if it
      // fails (a network blip), the save still counts and the next live
      // update or poll brings the data
      try {
        const fresh = await staffBootstrap();
        setState((prev) => mergeFresh(prev, fresh));
      } catch {
        // shown on the next refresh
      } finally {
        setSyncing(false);
      }
      return true;
    },
    [showToast],
  );

  /** silent re-fetch — the poll and manual refresh share this */
  const refresh = useCallback(() => {
    staffBootstrap()
      .then((fresh) => setState((prev) => mergeFresh(prev, fresh)))
      .catch(() => {});
  }, []);

  /**
   * Several machines hold the console open at once (front desk + room PCs).
   * Live updates keep them convergent (docs/design/04-live-updates.md): the
   * server announces a change number on every save, and this screen
   * re-downloads only when that number is newer than its data — within a
   * moment, instead of up to 20 s later and 180 full downloads an hour. If
   * live updates aren't available, it falls back to polling every POLL_MS.
   */
  const knownSeq = useRef(0);
  useEffect(() => {
    knownSeq.current = Math.max(knownSeq.current, state.changeSeq ?? 0);
  }, [state.changeSeq]);
  const syncingRef = useRef(false);
  useEffect(() => {
    syncingRef.current = syncing;
  }, [syncing]);

  useEffect(() => {
    const POLL_MS = 20_000;
    let poll: ReturnType<typeof setInterval> | undefined;
    let soon: ReturnType<typeof setTimeout> | undefined;
    // a mutation round-trip already re-reads the world; skip the overlap
    const pull = () => {
      if (!syncingRef.current) refresh();
    };
    const close = openStaffEvents({
      onSeq: (seq) => {
        if (poll) {
          clearInterval(poll);
          poll = undefined;
        }
        if (seq > knownSeq.current) {
          // a burst of saves (e.g. a bill with several lines) → one refresh
          clearTimeout(soon);
          soon = setTimeout(pull, 150);
        }
      },
      onDown: () => {
        if (!poll) poll = setInterval(pull, POLL_MS);
      },
    });
    return () => {
      close();
      clearInterval(poll);
      clearTimeout(soon);
    };
  }, [refresh]);

  // a console left open overnight: when the clinic's date changes, download
  // again so วันนี้ shows the new day (live updates only fire on a save)
  const shownDay = state.today;
  useEffect(() => {
    const tick = setInterval(() => {
      if (todayISO() !== shownDay) refresh();
    }, 60_000);
    return () => clearInterval(tick);
  }, [shownDay, refresh]);

  const setDeviceMode = useCallback((mode: DeviceMode) => {
    setDeviceModeState(mode);
    try {
      localStorage.setItem(DEVICE_MODE_KEY, mode);
    } catch {}
  }, []);

  const setRoomDentistSlug = useCallback((slug: string | null) => {
    setRoomDentistSlugState(slug);
    try {
      if (slug) localStorage.setItem(ROOM_DENTIST_KEY, slug);
      else localStorage.removeItem(ROOM_DENTIST_KEY);
    } catch {}
  }, []);

  const slugToId = useMemo(() => {
    const m = new Map<string, number>();
    // the bootstrap's dentists carry the DB id in `_id` (set by the converter)
    for (const d of state.dentists) {
      const withId = d as EditableDentist & { _id?: number };
      if (typeof withId._id === "number") m.set(d.slug, withId._id);
    }
    return m;
  }, [state.dentists]);

  /* ── appointments ──────────────────────────────────────────────────────── */

  const createAppointment = useCallback(
    (
      data: Omit<StaffAppointment, "id" | "ref" | "createdAt" | "dentistId">,
      opts?: { idempotencyKey?: string },
    ): Promise<boolean> => {
      return mutate("บันทึกนัดหมาย (เวลานี้อาจชนกับนัดอื่น)", async () => {
        const ref = await staffCreateAppointment({
          date: data.date,
          time: data.time,
          treatmentKey: data.treatmentKey,
          dentistId: slugToId.get(data.dentistSlug) ?? 0,
          childName: data.childName,
          guardianName: data.guardianName,
          phone: data.phone,
          source: data.source,
          note: data.notes,
          price: data.price ?? null,
          idempotencyKey: opts?.idempotencyKey,
        });
        // null = the slot (or part of a longer treatment's time) was taken
        if (!ref) throw new Error("slot_taken");
      });
    },
    [mutate, slugToId],
  );

  const updateAppointment = useCallback(
    (id: string, updates: Partial<StaffAppointment>) => {
      const numeric = Number(id);
      if (!Number.isFinite(numeric)) return Promise.resolve(false);
      return mutate(updates.date || updates.time || updates.dentistSlug ? "ย้ายนัด (เวลานั้นอาจไม่ว่างแล้ว)" : "แก้ไขนัดหมาย", () =>
        staffUpdateAppointment(numeric, {
          date: updates.date,
          time: updates.time,
          dentistId: updates.dentistSlug ? slugToId.get(updates.dentistSlug) : undefined,
          note: updates.notes,
          price: updates.price,
          childName: updates.childName,
          guardianName: updates.guardianName,
          phone: updates.phone,
          status: updates.status,
        }),
      );
    },
    [mutate, slugToId],
  );

  const updateStatus = useCallback(
    (id: string, status: AppointmentStatus) => {
      updateAppointment(id, { status });
    },
    [updateAppointment],
  );

  const setQueueStatus = useCallback(
    (id: string, status: "confirmed" | "arrived" | "in_chair" | "completed" | "no_show") => {
      const numeric = Number(id);
      if (!Number.isFinite(numeric)) return;
      void mutate("อัปเดตคิว", () => staffSetQueueStatus(numeric, status));
    },
    [mutate],
  );

  const rescheduleAppointment = useCallback(
    (id: string, date: string, time: string, dentistSlug?: string) => {
      // a no-show given a new time is expected again; anyone checked in or in
      // the chair keeps their place (a cancelled one stays cancelled — the
      // server refuses to move it)
      const current = state.appointments.find((a) => a.id === id);
      const status = current?.status === "no_show" ? "confirmed" : undefined;
      return updateAppointment(id, { date, time, dentistSlug, status });
    },
    [updateAppointment, state.appointments],
  );

  const messageFamily = useCallback(
    async (id: string, text: string): Promise<FamilyMessageResult> => {
      const numeric = Number(id);
      const result: FamilyMessageResult = Number.isFinite(numeric)
        ? await staffMessageFamily(numeric, text).catch((): FamilyMessageResult => "failed")
        : "failed";
      showToast(
        result === "sent"
          ? "ส่งข้อความทาง LINE แล้ว"
          : result === "no_line"
            ? "นัดนี้ไม่ได้จองผ่าน LINE — โทรแจ้งผู้ปกครองแทน"
            : result === "not_configured"
              ? "ยังไม่ได้ตั้งค่า LINE OA บนเซิร์ฟเวอร์ — ส่งข้อความไม่ได้"
              : "ส่งข้อความทาง LINE ไม่สำเร็จ — โทรแจ้งผู้ปกครองแทน",
      );
      return result;
    },
    [showToast],
  );

  const deleteAppointment = useCallback(
    (id: string) => {
      const numeric = Number(id);
      if (!Number.isFinite(numeric)) return;
      void mutate("ลบนัดหมาย", () => staffDeleteAppointment(numeric));
    },
    [mutate],
  );

  /* ── dentists ──────────────────────────────────────────────────────────── */

  const updateDentist = useCallback(
    (slug: string, updates: Partial<EditableDentist>) => {
      void mutate("บันทึกข้อมูลแพทย์", () =>
        staffUpdateDentist(slug, {
          years: updates.years,
          licenseNo: updates.licenseNo,
          tint: updates.tint,
          isActive: updates.isActive,
          photoSmall: updates.photo?.small,
          photoLarge: updates.photo?.large,
          text: updates.text,
          treats: updates.treats,
          treatAges: updates.treatAges,
          shifts: updates.shifts,
        }),
      );
    },
    [mutate],
  );

  const createDentist = useCallback(
    (input: Parameters<typeof staffCreateDentist>[0]) => {
      void mutate("เพิ่มทันตแพทย์", () => staffCreateDentist(input));
    },
    [mutate],
  );

  /* ── patients ──────────────────────────────────────────────────────────── */

  /**
   * PatientRecord (the form's shape) → PatientUpsertInput (the wire shape):
   * the child form's string id only survives the trip when it's a real DB id —
   * optimistic keys like "c-…" mean "insert me".
   */
  const toUpsertInput = useCallback(
    (data: Omit<PatientRecord, "id" | "registeredAt">): PatientUpsertInput => ({
      name: data.guardianName,
      fullName: data.guardianFullName,
      relation: data.guardianRelation,
      phone: data.phone,
      lineId: data.lineId,
      address: data.address,
      children: data.children.map(
        (c): PatientChildInput => ({
          id: c.id && /^\d+$/.test(c.id) ? Number(c.id) : undefined,
          name: c.name,
          fullName: c.fullName,
          nickname: c.nickname,
          birthdate: c.birthdate,
          age: c.age ?? null,
          gender: c.gender,
          hn: c.hn,
          bloodType: c.bloodType,
          idCard: c.idCard,
          tags: c.tags,
          recallMonths: c.recallMonths,
          coverage: c.coverage,
          conditions: c.conditions,
          medications: c.medications,
          allergies: c.allergies,
          notes: c.notes,
        }),
      ),
    }),
    [],
  );

  const createPatient = useCallback(
    (data: Omit<PatientRecord, "id" | "registeredAt">) => {
      void mutate("เพิ่มผู้ปกครอง", () => staffUpsertPatient(toUpsertInput(data)));
    },
    [mutate, toUpsertInput],
  );

  const updatePatient = useCallback(
    (id: string, updates: Partial<PatientRecord>) => {
      void mutate("บันทึกข้อมูลผู้ปกครอง", () =>
        staffUpdatePatient(Number(id), {
          name: updates.guardianName,
          fullName: updates.guardianFullName,
          relation: updates.guardianRelation,
          phone: updates.phone,
          lineId: updates.lineId,
          address: updates.address,
          // only sync children when the form actually sent them
          children: updates.children
            ? toUpsertInput({
                guardianName: updates.guardianName ?? "",
                phone: updates.phone ?? "",
                children: updates.children,
              }).children
            : undefined,
        }),
      );
    },
    [mutate, toUpsertInput],
  );

  const addPatientChild = useCallback(
    (patientId: string, name: string) => {
      void mutate("เพิ่มเด็ก", () => staffAddChild(Number(patientId), name));
    },
    [mutate],
  );

  /* ── waitlist ──────────────────────────────────────────────────────────── */

  const addWaitlist = useCallback(
    (entry: Omit<WaitlistEntry, "id" | "arrivedAt" | "status">) => {
      void mutate("ลงชื่อ Walk-in", () =>
        staffAddWaitlist({
          childName: entry.childName,
          guardianPhone: entry.guardianPhone,
          treatmentKey: entry.treatmentKey,
          dentistId: entry.dentistSlug ? slugToId.get(entry.dentistSlug) ?? null : null,
          note: entry.notes,
        }),
      );
    },
    [mutate, slugToId],
  );

  const updateWaitlistStatus = useCallback(
    (id: string, status: WaitlistEntry["status"], dentistSlug?: string) => {
      void mutate("อัปเดตคิว", () =>
        staffSetWaitlistStatus(Number(id), status, dentistSlug ? slugToId.get(dentistSlug) ?? null : undefined),
      );
    },
    [mutate, slugToId],
  );

  const removeWaitlist = useCallback(
    (id: string) => {
      void mutate("ลบคิว", () => staffRemoveWaitlist(Number(id)));
    },
    [mutate],
  );

  /** queue card picker: park a walk-in under a dentist while it waits */
  const assignWaitingDentist = useCallback(
    (waitlistId: string, dentistSlug: string | null) => {
      const numeric = Number(waitlistId);
      if (!Number.isFinite(numeric)) return;
      void mutate("จัดแพทย์", () =>
        staffSetWaitlistStatus(
          numeric,
          "waiting",
          dentistSlug ? slugToId.get(dentistSlug) ?? null : null,
        ),
      );
    },
    [mutate, slugToId],
  );

  /* ── visit records (room page, full edition) ─────────────────────────── */

  const toVisitInput = useCallback(
    (rec: Omit<VisitRecord, "id" | "updatedAt">): VisitRecordInput => ({
      appointmentId: rec.appointmentId ? Number(rec.appointmentId) : null,
      waitlistId: rec.waitlistId ? Number(rec.waitlistId) : null,
      dentistId: rec.dentistSlug ? slugToId.get(rec.dentistSlug) ?? null : null,
      treatments: rec.treatments,
      detail: rec.detail,
      price: rec.price ?? null,
      items: rec.items,
    }),
    [slugToId],
  );

  const saveVisitRecord = useCallback(
    (rec: Omit<VisitRecord, "id" | "updatedAt">) => {
      void mutate("บันทึกการรักษา", () => staffSaveVisitRecord(toVisitInput(rec)));
    },
    [mutate, toVisitInput],
  );

  const finishVisit = useCallback(
    (rec: Omit<VisitRecord, "id" | "updatedAt">) => {
      void mutate("ปิดการรักษา", () => staffFinishVisit(toVisitInput(rec)));
    },
    [mutate, toVisitInput],
  );

  /* ── pool ("any dentist") assignment ─────────────────────────────────── */

  const assignDentist = useCallback(
    (id: string, dentistSlug: string) => {
      const numeric = Number(id);
      const dentistId = slugToId.get(dentistSlug);
      if (!Number.isFinite(numeric) || dentistId === undefined) return Promise.resolve(false);
      let taken = false;
      return mutate("จัดแพทย์", async () => {
        const res = await assignPoolDentist(numeric, dentistId);
        taken = !res.ok;
      }).then((saved) => {
        if (taken) showToast("เวลานั้นไม่ว่างแล้ว กรุณาเลือกแพทย์ท่านอื่น");
        return saved && !taken;
      });
    },
    [mutate, slugToId, showToast],
  );

  /* ── prices / schedule / holidays ──────────────────────────────────────── */

  const updateServicePrice = useCallback(
    (key: IconKey, price: number | null) => {
      setState((s) => ({ ...s, servicePrices: { ...s.servicePrices, [key]: price } }));
      void mutate("บันทึกราคา", () => staffUpdatePrice(key, price));
    },
    [mutate],
  );

  const addDentistLeave = useCallback(
    (dentistSlug: string, start: string, end: string, note: string) => {
      void mutate("บันทึกวันลา", () => staffAddDentistLeave(dentistSlug, start, end, note));
    },
    [mutate],
  );

  const removeDentistLeave = useCallback(
    (id: number) => {
      setState((s) => ({ ...s, dentistLeaves: s.dentistLeaves.filter((l) => l.id !== id) }));
      void mutate("ลบวันลา", () => staffRemoveDentistLeave(id));
    },
    [mutate],
  );

  const onLeave = useCallback(
    (dentistSlug: string, date: string) =>
      state.dentistLeaves.find((l) => l.dentistSlug === dentistSlug && l.start <= date && l.end >= date),
    [state.dentistLeaves],
  );

  const createTreatment = useCallback(
    (input: Parameters<typeof staffCreateTreatment>[0]) => {
      void mutate("เพิ่มบริการ", () => staffCreateTreatment(input));
    },
    [mutate],
  );

  const updateTreatment = useCallback(
    (key: string, patch: Parameters<typeof staffUpdateTreatment>[1]) => {
      // flip it on screen at once — the refresh after the write confirms it
      setState((s) => ({
        ...s,
        treatments: s.treatments.map((t) =>
          t.key === key
            ? {
                ...t,
                ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
                ...(patch.price !== undefined ? { price: patch.price } : {}),
                ...(patch.showPrice !== undefined ? { showPrice: patch.showPrice } : {}),
                ...(patch.durationMin !== undefined ? { durationMin: patch.durationMin } : {}),
              }
            : t,
        ),
      }));
      void mutate("บันทึกบริการ", () => staffUpdateTreatment(key, patch));
    },
    [mutate],
  );

  const setAllShowPrice = useCallback(
    (show: boolean) => {
      setState((s) => ({ ...s, treatments: s.treatments.map((t) => ({ ...t, showPrice: show })) }));
      void mutate(show ? "แสดงราคาทั้งหมด" : "ซ่อนราคาทั้งหมด", () => staffSetAllShowPrice(show));
    },
    [mutate],
  );

  const updateDayOpen = useCallback(
    (day: ClinicDaySetting["day"], isOpen: boolean) => {
      setState((s) => ({ ...s, schedule: s.schedule.map((d) => (d.day === day ? { ...d, isOpen } : d)) }));
      void mutate("บันทึกวันทำการ", () => staffUpdateDay(day, { isOpen }));
    },
    [mutate],
  );

  const updateDayTime = useCallback(
    (day: ClinicDaySetting["day"], field: "start" | "end", val: string) => {
      setState((s) => ({ ...s, schedule: s.schedule.map((d) => (d.day === day ? { ...d, [field]: val } : d)) }));
      void mutate("บันทึกเวลาทำการ", () => staffUpdateDay(day, { [field]: val }));
    },
    [mutate],
  );

  const addHoliday = useCallback(
    (start: string, end: string, name: string) => {
      void mutate("เพิ่มวันหยุด", () => staffAddHoliday(start, end, name));
    },
    [mutate],
  );

  const removeHoliday = useCallback(
    (id: number | string) => {
      void mutate("ลบวันหยุด", () => staffRemoveHoliday(Number(id)));
    },
    [mutate],
  );

  const updateClinicInfo = useCallback(
    (patch: Parameters<typeof staffUpdateClinicInfo>[0]) => {
      void mutate("บันทึกข้อมูลคลินิก", () => staffUpdateClinicInfo(patch));
    },
    [mutate],
  );

  const updateBookingRules = useCallback(
    (patch: Partial<BookingRules>) => {
      setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
      void mutate("บันทึกกฎการจอง", () => staffUpdateBookingRules(patch));
    },
    [mutate],
  );

  /* older appointments: one download, the first time a screen needs them
     (search, past list, a patient's visits, the schedule further back) */
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyLoading = useRef(false);
  const loadHistory = useCallback(() => {
    if (historyLoaded || historyLoading.current) return;
    historyLoading.current = true;
    staffAppointmentsBefore(state.appointmentsFrom)
      .then((older) => {
        setState((s) => {
          // rows the screen already has (recent changes) are as new or newer
          const have = new Set(s.appointments.map((a) => a.id));
          return {
            ...s,
            appointments: [...older.filter((a) => !have.has(a.id)), ...s.appointments],
            // the screen now holds everything; later downloads keep it (mergeFresh)
            appointmentsFrom: "0000-01-01",
          };
        });
        setHistoryLoaded(true);
      })
      .catch(() => showToast("โหลดประวัตินัดเก่าไม่สำเร็จ — ลองใหม่อีกครั้ง"))
      .finally(() => {
        historyLoading.current = false;
      });
  }, [historyLoaded, state.appointmentsFrom, showToast]);

  const updateChairs = useCallback(
    (chairs: number) => {
      const n = Number.isFinite(chairs) && chairs > 0 ? Math.floor(chairs) : 3;
      setState((s) => ({ ...s, settings: { ...s.settings, chairs: n } }));
      void mutate("บันทึกจำนวนเก้าอี้", () => staffUpdateChairs(n));
    },
    [mutate],
  );

  /* ── notifications / demo helpers ──────────────────────────────────────── */

  const markAllNotificationsRead = useCallback(() => {
    void mutate("อ่านแจ้งเตือน", () => staffMarkNotificationsRead());
  }, [mutate]);

  const simulateOnlineBooking = useCallback(() => {
    const picks = [
      { child: "น้องภูผา", age: 6, parent: "คุณแม่อริสา", phone: "0819987766", treat: "fluoride" as IconKey, doc: "onanong" },
      { child: "น้องพอร์ช", age: 4, parent: "คุณพ่อวิเชียร", phone: "0897765544", treat: "checkup" as IconKey, doc: "khanon" },
      { child: "น้องลลิน", age: 7, parent: "คุณแม่สุชาดา", phone: "0853321100", treat: "filling" as IconKey, doc: "phannathip" },
    ];
    const pick = picks[Math.floor(Math.random() * picks.length)];
    const times = ["14:00", "15:30", "16:00", "16:30"];
    const time = times[Math.floor(Math.random() * times.length)];
    createAppointment({
      date: today,
      time,
      durationMin: 30,
      childName: pick.child,
      childAge: pick.age,
      guardianName: pick.parent,
      phone: pick.phone,
      dentistSlug: pick.doc,
      treatmentKey: pick.treat,
      source: "online",
      status: "confirmed",
      notes: "จองผ่าน LINE LIFF ออนไลน์ (จำลอง)",
      price: state.servicePrices[pick.treat] ?? 300,
    });
    showToast("จำลองการจองออนไลน์เรียบร้อย");
  }, [createAppointment, today, state.servicePrices, showToast]);

  const value = useMemo<StaffContextType>(
    () => ({
      edition,
      deviceMode,
      setDeviceMode,
      roomDentistSlug,
      setRoomDentistSlug,
      today,
      appointments: state.appointments,
      dentists: state.dentists,
      patients: state.patients,
      waitlist: state.waitlist,
      visitRecords: state.visitRecords ?? [],
      notifications: state.notifications,
      servicePrices: state.servicePrices,
      schedule: asClinicSchedule(state.schedule),
      holidays: state.holidays,
      settings: state.settings,
      updateChairs,
      updateBookingRules,
      appointmentsFrom: state.appointmentsFrom,
      historyLoaded,
      loadHistory,
      clinicInfo: state.clinicInfo ?? null,
      updateClinicInfo,
      assignDentist,
      createAppointment,
      updateAppointment,
      updateStatus,
      setQueueStatus,
      rescheduleAppointment,
      messageFamily,
      deleteAppointment,
      updateDentist,
      createDentist,
      createPatient,
      updatePatient,
      addPatientChild,
      addWaitlist,
      updateWaitlistStatus,
      assignWaitingDentist,
      removeWaitlist,
      saveVisitRecord,
      finishVisit,
      refresh,
      updateServicePrice,
      treatments: state.treatments,
      dentistLeaves: state.dentistLeaves,
      lineUnread: state.lineUnread,
      addDentistLeave,
      removeDentistLeave,
      onLeave,
      createTreatment,
      updateTreatment,
      setAllShowPrice,
      updateDayOpen,
      updateDayTime,
      addHoliday,
      removeHoliday,
      markAllNotificationsRead,
      simulateOnlineBooking,
      toast,
      showToast,
      walkinOpen,
      setWalkinOpen,
      syncing,
    }),
    [
      edition, deviceMode, setDeviceMode, roomDentistSlug, setRoomDentistSlug,
      today, state, toast, showToast, walkinOpen, syncing,
      createAppointment, updateAppointment, updateStatus, setQueueStatus, rescheduleAppointment, messageFamily,
      deleteAppointment, updateDentist, createDentist, createPatient, updatePatient, addPatientChild,
      addWaitlist, updateWaitlistStatus, assignWaitingDentist, removeWaitlist, updateServicePrice, createTreatment, updateTreatment, setAllShowPrice, addDentistLeave, removeDentistLeave, onLeave,
      saveVisitRecord, finishVisit, refresh,
      updateDayOpen, updateDayTime, addHoliday, removeHoliday, updateChairs, updateBookingRules, historyLoaded, loadHistory, updateClinicInfo, assignDentist,
      markAllNotificationsRead, simulateOnlineBooking,
    ],
  );

  return (
    <StaffContext.Provider value={value}>
      <TreatmentsProvider list={state.treatments}>{children}</TreatmentsProvider>
    </StaffContext.Provider>
  );
}

export function useStaff() {
  const context = useContext(StaffContext);
  if (!context) {
    throw new Error("useStaff must be used within a StaffProvider");
  }
  return context;
}
