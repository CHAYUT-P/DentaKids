import type { IconKey } from "@/data/icons";
import type { TreatmentInfo, TreatmentKey } from "@/lib/treatments";
import type { ClinicDaySetting } from "@/lib/clinicSettings";
import type { DfStatement, ReportData } from "@/server/reports";
import type { ChatConversation, ChatMessage } from "@/server/chat";
import type { AuditRow, ClockRow, Role, StaffUserInfo, WhoAmI } from "@/lib/roles";
import type { ImportField } from "@/lib/dataio";
import type { Consumable, Expense, LabOrder, MoveKind, StockItem, StockMove, Supplier } from "@/lib/stock";
import type { BillItem, BillingSettings, CashierDay, ClaimRow, ClaimStatus, DayClose, DfMode, DfRule, DisplayState, PayMethod } from "@/lib/billing";
import type {
  DocKind,
  FileMeta,
  Medication,
  PatientFileData,
  PlanItemRow,
  PlanStatus,
  RecallRow,
  RecallStatus,
  ToothStatus,
} from "@/lib/clinical";
import type {
  DentistLeave,
  EditableDentist,
  PatientChildInput,
  PatientRecord,
  PatientUpsertInput,
  StaffAppointment,
  StaffNotification,
  VisitRecord,
  VisitRecordInput,
  WaitlistEntry,
} from "@/lib/staffTypes";

export type { VisitRecordInput } from "@/lib/staffTypes";

/**
 * The desktop app's data layer — the same names the web console's server
 * actions export, so shared files (staffStore, pages) work unchanged. Each is
 * a POST to /api/staff carrying the bearer token the PIN login returned.
 *
 * The token lives in localStorage — the Tauri webview's storage persists, so
 * the desk stays signed in between launches like the web console's cookie.
 */

/** the hosted app origin — also where the sidebar's "patient web" link points.
 *  The double cast keeps both configs happy: vite/client gives env a Record
 *  shape, Next's tsconfig gives it ImportMetaEnv — either way it's a plain
 *  string map at runtime. */
const viteEnv = import.meta.env as unknown as Record<string, string | undefined>;
export const API_BASE = viteEnv?.VITE_API_URL ?? "https://denta-kids-ten.vercel.app";

/** clinic PIN baked into the build — the app signs itself in, no login screen */
const EMBEDDED_PIN = viteEnv?.VITE_STAFF_PIN ?? "";

const API = API_BASE;

const TOKEN_KEY = "dk:staff-token";
let token = localStorage.getItem(TOKEN_KEY) ?? "";

export function hasStaffToken(): boolean {
  return token.length > 0;
}

/**
 * Silent sign-in for clinic builds: if there's no stored token but the build
 * carries the embedded PIN, exchange it once. Returns false when the build
 * has no PIN — the caller then shows the manual login screen.
 */
export async function ensureStaffToken(): Promise<boolean> {
  if (token) return true;
  if (!EMBEDDED_PIN) return false;
  const res = await staffLogin(EMBEDDED_PIN);
  return res.ok;
}

export function staffLogout(): void {
  token = "";
  localStorage.removeItem(TOKEN_KEY);
}

export async function staffLogin(pin: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API}/api/staff/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  const data = (await res.json()) as { ok: boolean; token?: string };
  if (data.ok && data.token) {
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    return { ok: true };
  }
  return { ok: false };
}

/** the person signed in on this PC (full edition) — sent with every call */
const USER_KEY = "dk:user-token";
let userToken = localStorage.getItem(USER_KEY) ?? "";

async function call<T>(action: string, args: unknown[] = []): Promise<T> {
  const res = await fetch(`${API}/api/staff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(userToken ? { "X-Staff-User": userToken } : {}),
    },
    body: JSON.stringify({ action, args }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    error?: string;
  };
  if (!res.ok) {
    if (res.status === 401) staffLogout();
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data.result as T;
}

/* ── shapes ─────────────────────────────────────────────────────────────── */

export interface StaffBootstrap {
  today: string;
  appointments: StaffAppointment[];
  dentists: EditableDentist[];
  patients: PatientRecord[];
  waitlist: WaitlistEntry[];
  visitRecords: VisitRecord[];
  notifications: StaffNotification[];
  schedule: ClinicDaySetting[];
  holidays: { id: number; start: string; end: string; name: string }[];
  servicePrices: Record<IconKey, number | null>;
  treatments: TreatmentInfo[];
  dentistLeaves: DentistLeave[];
  lineUnread: number;
  settings: { chairs: number };
}

/* ── reads ──────────────────────────────────────────────────────────────── */

export async function staffBootstrap() {
  const b = await call<StaffBootstrap>("bootstrap");
  // uploaded photos come back as site paths ("/api/dentist-photo/…") — this
  // app runs on its own origin, so point them at the server
  const abs = (u: string) => (u?.startsWith("/") ? `${API}${u}` : u);
  if (Array.isArray(b?.dentists)) {
    b.dentists = b.dentists.map((d) => ({ ...d, photo: { small: abs(d.photo?.small), large: abs(d.photo?.large) } }));
  }
  return b;
}
export function staffPrices() {
  return call<Record<IconKey, number | null>>("prices");
}

/* ── appointments ───────────────────────────────────────────────────────── */

export function staffCreateAppointment(input: {
  date: string;
  time: string;
  treatmentKey: TreatmentKey;
  dentistId: number;
  childName: string;
  guardianName: string;
  phone: string;
  source: "phone" | "walkin" | "online";
  note?: string;
  price?: number | null;
}) {
  return call<string | null>("createAppointment", [input]);
}

export function staffUpdateAppointment<T extends object>(id: number, patch: T) {
  return call<void>("updateAppointment", [id, patch]);
}

export function staffDeleteAppointment(id: number) {
  return call<void>("deleteAppointment", [id]);
}

export function staffSetQueueStatus(
  id: number,
  status: "confirmed" | "arrived" | "in_chair" | "completed" | "no_show",
) {
  return call<void>("setQueueStatus", [id, status]);
}

export function assignPoolDentist(id: number, dentistId: number) {
  return call<{ ok: boolean; error?: "taken" | "invalid" }>("assignPoolDentist", [id, dentistId]);
}

export function staffUpdateChairs(chairs: number) {
  return call<void>("updateChairs", [chairs]);
}

/* ── dentists / patients / waitlist ─────────────────────────────────────── */

export function staffUpdateDentist<T extends object>(slug: string, patch: T) {
  return call<void>("updateDentist", [slug, patch]);
}

export function staffCreateDentist<T extends object>(input: T) {
  return call<void>("createDentist", [input]);
}

export function staffUpsertPatient(input: PatientUpsertInput) {
  return call<void>("upsertPatient", [input]);
}

export function staffUpdatePatient<T extends object>(id: number, patch: T) {
  return call<void>("updatePatient", [id, patch]);
}

export function staffAddChild(patientId: number, child: string | PatientChildInput) {
  return call<void>("addChild", [patientId, child]);
}

export function staffAddWaitlist<T extends object>(input: T) {
  return call<void>("addWaitlist", [input]);
}

export function staffSetWaitlistStatus(
  id: number,
  status: WaitlistEntry["status"],
  dentistId?: number | null,
) {
  return call<void>("setWaitlistStatus", [id, status, dentistId]);
}

export function staffRemoveWaitlist(id: number) {
  return call<void>("removeWaitlist", [id]);
}

/* ── visit records (room page — full edition) ───────────────────────────── */

export function staffSaveVisitRecord(input: VisitRecordInput) {
  return call<void>("saveVisitRecord", [input]);
}

export function staffFinishVisit(input: VisitRecordInput) {
  return call<void>("finishVisit", [input]);
}

/* ── prices / schedule / holidays / notifications ───────────────────────── */

export function staffUpdatePrice(key: IconKey, price: number | null) {
  return call<void>("updatePrice", [key, price]);
}

export function staffAddDentistLeave(dentistSlug: string, start: string, end: string, note: string) {
  return call<{ ok: boolean }>("addDentistLeave", [dentistSlug, start, end, note]);
}

export function staffRemoveDentistLeave(id: number) {
  return call<void>("removeDentistLeave", [id]);
}

/* ── data in / out (full edition) ─────────────────────────────────────── */

export function staffExportPatients() {
  return call<string>("exportPatients", []);
}

export function staffImportPatients(rows: Partial<Record<ImportField, string>>[]) {
  return call<{ created: number; updated: number; skipped: number }>("importPatients", [rows]);
}

export function staffExportBills(from: string, to: string) {
  return call<string>("exportBills", [from, to]);
}

/* ── LINE chat (full edition) ─────────────────────────────────────────── */

export function staffChats() {
  return call<ChatConversation[]>("chats", []);
}

export function staffChatThread(lineUserId: string) {
  return call<ChatMessage[]>("chatThread", [lineUserId]);
}

export function staffChatSend(lineUserId: string, text: string) {
  return call<"sent" | "not_configured" | "failed">("chatSend", [lineUserId, text]);
}

/* ── accounts (full edition) ──────────────────────────────────────────── */

export function staffWhoAmI() {
  return call<WhoAmI>("whoAmI", []);
}

export async function staffSignIn(userId: number, pin: string) {
  const r = await call<{ ok: boolean; token?: string; user?: StaffUserInfo }>("signIn", [userId, pin]);
  if (r.ok && r.token) {
    userToken = r.token;
    localStorage.setItem(USER_KEY, userToken);
  }
  return r;
}

export async function staffSignOut() {
  userToken = "";
  localStorage.removeItem(USER_KEY);
  await call<void>("signOut", []).catch(() => {});
}

export function staffUsers() {
  return call<StaffUserInfo[]>("users", []);
}

export function staffSaveUser(input: { id?: number | null; name: string; role: Role; pin?: string; dentistSlug?: string | null; isActive?: boolean }) {
  return call<{ ok: boolean; error?: string }>("saveUser", [input]);
}

export function staffPunch(userId: number, pin: string) {
  return call<{ ok: boolean; action?: "in" | "out"; at?: string; name?: string }>("punch", [userId, pin]);
}

export function staffClock(from: string, to: string) {
  return call<ClockRow[]>("clock", [from, to]);
}

export function staffAudit() {
  return call<AuditRow[]>("audit", []);
}

/* ── reports (full edition) ───────────────────────────────────────────── */

export function staffReport(from: string, to: string) {
  return call<ReportData>("report", [from, to]);
}

export function staffDfStatement(dentistSlug: string, from: string, to: string) {
  return call<DfStatement>("dfStatement", [dentistSlug, from, to]);
}

/* ── stock, expenses, labs (full edition) ─────────────────────────────── */

export function staffSuppliers() {
  return call<Supplier[]>("suppliers", []);
}

export function staffSaveSupplier(input: Partial<Supplier> & { name: string }) {
  return call<number | null>("saveSupplier", [input]);
}

export function staffStock() {
  return call<StockItem[]>("stock", []);
}

export function staffSaveStockItem(input: Partial<StockItem> & { name: string }) {
  return call<number | null>("saveStockItem", [input]);
}

export function staffAddMove(input: { itemId: number; kind: MoveKind; qty: number; unitCost?: number; lot?: string; expiry?: string | null; note?: string; date?: string }) {
  return call<void>("addMove", [input]);
}

export function staffMoves(filter: { itemId?: number; from?: string; to?: string }) {
  return call<StockMove[]>("moves", [filter]);
}

export function staffConsumables() {
  return call<Consumable[]>("consumables", []);
}

export function staffSetConsumables(treatmentKey: string, lines: { itemId: number; qty: number }[]) {
  return call<void>("setConsumables", [treatmentKey, lines]);
}

export function staffExpenses(from: string, to: string) {
  return call<Expense[]>("expenses", [from, to]);
}

export function staffSaveExpense(input: Partial<Expense> & { category: string; amount: number }) {
  return call<void>("saveExpense", [input]);
}

export function staffRemoveExpense(id: number) {
  return call<void>("removeExpense", [id]);
}

export function staffLabOrders(filter: { open?: boolean; childId?: number }) {
  return call<LabOrder[]>("labOrders", [filter]);
}

export function staffSaveLabOrder(input: Partial<LabOrder> & { patientName: string; work: string }) {
  return call<void>("saveLabOrder", [input]);
}

export function staffRemoveLabOrder(id: number) {
  return call<void>("removeLabOrder", [id]);
}

/* ── patient file (full edition) ──────────────────────────────────────── */

export function staffPatientFile(childId: number) {
  return call<PatientFileData | null>("patientFile", [childId]);
}

export function staffEnsurePatient(input: { phone: string; name: string; guardianName?: string }) {
  return call<number | null>("ensurePatient", [input]);
}

export function staffChildForAppointment(appointmentId: number) {
  return call<number | null>("childForAppointment", [appointmentId]);
}

export function staffSetTeeth(input: {
  childId: number;
  teeth: string[];
  status: ToothStatus;
  surfaces: string[];
  note: string;
  dentistSlug: string | null;
}) {
  return call<void>("setTeeth", [input]);
}

export function staffSavePlan(input: {
  id?: number | null;
  childId: number;
  title: string;
  kind: "plan" | "contract";
  status: PlanStatus;
  agreedTotal: number | null;
  note: string;
  dentistSlug: string | null;
  items: PlanItemRow[];
}) {
  return call<number>("savePlan", [input]);
}

export function staffSignPlan(id: number, signature: string, signedBy: string) {
  return call<boolean>("signPlan", [id, signature, signedBy]);
}

export function staffRemovePlan(id: number) {
  return call<void>("removePlan", [id]);
}

export function staffBillFromPlan(input: { planId: number; itemIds: number[]; instalment?: number }) {
  return call<number | null>("billFromPlan", [input]);
}

export function staffTakeDeposit(input: { childId: number; amount: number; method: PayMethod; note?: string }) {
  return call<number | null>("takeDeposit", [input]);
}

export function staffSaveDoc(input: {
  id?: number | null;
  childId: number;
  kind: DocKind;
  date: string;
  dentistSlug: string | null;
  data: Record<string, unknown>;
}) {
  return call<number>("saveDoc", [input]);
}

export function staffRemoveDoc(id: number) {
  return call<void>("removeDoc", [id]);
}

export function staffMedications() {
  return call<Medication[]>("medications", []);
}

export function staffSaveMedication(input: Omit<Medication, "id"> & { id?: number | null }) {
  return call<void>("saveMedication", [input]);
}

export function staffUploadFile(input: { childId: number; kind: FileMeta["kind"]; name: string; mime: string; body: string; note?: string }) {
  return call<{ ok: boolean; error?: string }>("uploadFile", [input]);
}

export function staffFileBody(id: number) {
  return call<{ mime: string; body: string } | null>("fileBody", [id]);
}

export function staffRemoveFile(id: number) {
  return call<void>("removeFile", [id]);
}

export function staffRecalls(filter: { childId?: number; until?: string; open?: boolean }) {
  return call<RecallRow[]>("recalls", [filter]);
}

export function staffSetRecall(id: number, patch: { status?: RecallStatus; contactNote?: string; dueDate?: string }) {
  return call<void>("setRecall", [id, patch]);
}

export function staffRemindRecall(id: number, text: string) {
  return call<FamilyMessageResult>("remindRecall", [id, text]);
}

/* ── billing (full edition) ───────────────────────────────────────────── */

export function staffCashierDay(date: string) {
  return call<CashierDay>("cashierDay", [date]);
}

export function staffOpenBill(input: { appointmentId?: number | null; waitlistId?: number | null }) {
  return call<number | null>("openBill", [input]);
}

export function staffOpenBlankBill(input: { patientName: string; phone: string }) {
  return call<number>("openBlankBill", [input]);
}

export function staffSaveBill(id: number, input: { items: BillItem[]; discount: number; note: string; patientName?: string }) {
  return call<boolean>("saveBill", [id, input]);
}

export function staffAddPayment(id: number, input: { method: PayMethod; amount: number; note?: string }) {
  return call<{ ok: boolean; receiptNo?: string }>("addPayment", [id, input]);
}

export function staffVoidBill(id: number, reason: string) {
  return call<boolean>("voidBill", [id, reason]);
}

export function staffDayClose(date: string) {
  return call<DayClose>("dayClose", [date]);
}

export function staffClaims(from: string, to: string) {
  return call<ClaimRow[]>("claims", [from, to]);
}

export function staffSetClaimStatus(paymentIds: number[], status: ClaimStatus) {
  return call<void>("setClaimStatus", [paymentIds, status]);
}

export function staffSetDisplay(state: Omit<DisplayState, "updatedAt" | "clinicName" | "promptpayId">) {
  return call<void>("setDisplay", [state]);
}

export function staffNextVisit(phone: string, after: string) {
  return call<{ date: string; time: string } | null>("nextVisit", [phone, after]);
}

export function staffBillingSettings() {
  return call<{ settings: BillingSettings; dfRules: DfRule[] }>("billingSettings", []);
}

export function staffSaveBillingSettings(input: Partial<BillingSettings>) {
  return call<void>("saveBillingSettings", [input]);
}

export function staffSaveDfRule(input: { dentistSlug: string | null; treatmentKey: string | null; mode: DfMode; value: number }) {
  return call<void>("saveDfRule", [input]);
}

export function staffAftercareNotes() {
  return call<Record<string, string>>("aftercareNotes", []);
}

export function staffSaveAftercareNote(treatmentKey: string, text: string) {
  return call<void>("saveAftercareNote", [treatmentKey, text]);
}

export function staffRemoveDfRule(id: number) {
  return call<void>("removeDfRule", [id]);
}

export type FamilyMessageResult = "sent" | "no_line" | "not_configured" | "failed";

export function staffMessageFamily(id: number, text: string) {
  return call<FamilyMessageResult>("messageFamily", [id, text]);
}

export function staffCreateTreatment(input: {
  nameTh: string;
  nameEn?: string;
  iconKey: IconKey;
  tint?: string;
  groupKey?: string;
  price: number | null;
}) {
  return call<{ ok: boolean; key?: string }>("createTreatment", [input]);
}

export function staffUpdateTreatment(
  key: string,
  patch: {
    nameTh?: string | null;
    nameEn?: string | null;
    iconKey?: IconKey;
    tint?: string | null;
    groupKey?: string | null;
    price?: number | null;
    showPrice?: boolean;
    isActive?: boolean;
  },
) {
  return call<void>("updateTreatment", [key, patch]);
}

export function staffSetAllShowPrice(show: boolean) {
  return call<void>("setAllShowPrice", [show]);
}

export function staffUpdateDay<T extends object>(day: string, patch: T) {
  return call<void>("updateDay", [day, patch]);
}

export function staffUpdateClinicInfo<T extends object>(patch: T) {
  return call<void>("updateClinicInfo", [patch]);
}

export function staffAddHoliday(start: string, end: string, name: string) {
  return call<void>("addHoliday", [start, end, name]);
}

export function staffRemoveHoliday(id: number) {
  return call<void>("removeHoliday", [id]);
}

export function staffMarkNotificationsRead() {
  return call<void>("markNotificationsRead");
}
