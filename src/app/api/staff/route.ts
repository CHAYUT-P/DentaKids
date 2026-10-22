import { NextResponse, type NextRequest } from "next/server";

import * as actions from "@/server/actions";
import { staffTokenOk, withStaffToken } from "@/server/staffAuth";

/**
 * The desktop app's whole API: POST { action, args } with a bearer token from
 * /api/staff/login. The allowlist below maps names onto the same server
 * actions the web console uses — verified once here, then run inside
 * withStaffToken so each action's own guard passes. Single implementation,
 * two doors.
 */

const OPS: Record<string, (...args: never[]) => Promise<unknown>> = {
  bootstrap: actions.staffBootstrap,
  prices: actions.staffPrices,
  createAppointment: actions.staffCreateAppointment,
  updateAppointment: actions.staffUpdateAppointment,
  deleteAppointment: actions.staffDeleteAppointment,
  setQueueStatus: actions.staffSetQueueStatus,
  assignPoolDentist: actions.assignPoolDentist,
  updateChairs: actions.staffUpdateChairs,
  updateBookingWindow: actions.staffUpdateBookingWindow,
  appointmentsBefore: actions.staffAppointmentsBefore,
  updateDentist: actions.staffUpdateDentist,
  createDentist: actions.staffCreateDentist,
  upsertPatient: actions.staffUpsertPatient,
  updatePatient: actions.staffUpdatePatient,
  addChild: actions.staffAddChild,
  addWaitlist: actions.staffAddWaitlist,
  setWaitlistStatus: actions.staffSetWaitlistStatus,
  removeWaitlist: actions.staffRemoveWaitlist,
  saveVisitRecord: actions.staffSaveVisitRecord,
  finishVisit: actions.staffFinishVisit,
  updatePrice: actions.staffUpdatePrice,
  createTreatment: actions.staffCreateTreatment,
  addDentistLeave: actions.staffAddDentistLeave,
  messageFamily: actions.staffMessageFamily,
  patientFile: actions.staffPatientFile,
  ensurePatient: actions.staffEnsurePatient,
  childForAppointment: actions.staffChildForAppointment,
  setTeeth: actions.staffSetTeeth,
  savePlan: actions.staffSavePlan,
  removePlan: actions.staffRemovePlan,
  signPlan: actions.staffSignPlan,
  billFromPlan: actions.staffBillFromPlan,
  takeDeposit: actions.staffTakeDeposit,
  saveDoc: actions.staffSaveDoc,
  removeDoc: actions.staffRemoveDoc,
  medications: actions.staffMedications,
  saveMedication: actions.staffSaveMedication,
  uploadFile: actions.staffUploadFile,
  fileBody: actions.staffFileBody,
  removeFile: actions.staffRemoveFile,
  recalls: actions.staffRecalls,
  setRecall: actions.staffSetRecall,
  remindRecall: actions.staffRemindRecall,
  suppliers: actions.staffSuppliers,
  saveSupplier: actions.staffSaveSupplier,
  stock: actions.staffStock,
  saveStockItem: actions.staffSaveStockItem,
  addMove: actions.staffAddMove,
  moves: actions.staffMoves,
  consumables: actions.staffConsumables,
  setConsumables: actions.staffSetConsumables,
  expenses: actions.staffExpenses,
  saveExpense: actions.staffSaveExpense,
  removeExpense: actions.staffRemoveExpense,
  labOrders: actions.staffLabOrders,
  saveLabOrder: actions.staffSaveLabOrder,
  removeLabOrder: actions.staffRemoveLabOrder,
  exportPatients: actions.staffExportPatients,
  importPatients: actions.staffImportPatients,
  exportBills: actions.staffExportBills,
  chats: actions.staffChats,
  chatThread: actions.staffChatThread,
  chatSend: actions.staffChatSend,
  whoAmI: actions.staffWhoAmI,
  signIn: actions.staffSignIn,
  signOut: actions.staffSignOut,
  users: actions.staffUsers,
  saveUser: actions.staffSaveUser,
  audit: actions.staffAudit,
  punch: actions.staffPunch,
  clock: actions.staffClock,
  report: actions.staffReport,
  dfStatement: actions.staffDfStatement,
  cashierDay: actions.staffCashierDay,
  openBill: actions.staffOpenBill,
  openBlankBill: actions.staffOpenBlankBill,
  saveBill: actions.staffSaveBill,
  addPayment: actions.staffAddPayment,
  voidBill: actions.staffVoidBill,
  dayClose: actions.staffDayClose,
  nextVisit: actions.staffNextVisit,
  setDisplay: actions.staffSetDisplay,
  claims: actions.staffClaims,
  setClaimStatus: actions.staffSetClaimStatus,
  billingSettings: actions.staffBillingSettings,
  saveBillingSettings: actions.staffSaveBillingSettings,
  saveDfRule: actions.staffSaveDfRule,
  aftercareNotes: actions.staffAftercareNotes,
  saveAftercareNote: actions.staffSaveAftercareNote,
  removeDfRule: actions.staffRemoveDfRule,
  removeDentistLeave: actions.staffRemoveDentistLeave,
  updateTreatment: actions.staffUpdateTreatment,
  setAllShowPrice: actions.staffSetAllShowPrice,
  updateDay: actions.staffUpdateDay,
  updateClinicInfo: actions.staffUpdateClinicInfo,
  addHoliday: actions.staffAddHoliday,
  removeHoliday: actions.staffRemoveHoliday,
  markNotificationsRead: actions.staffMarkNotificationsRead,
  systemStatus: actions.staffSystemStatus,
};

const CORS = {
  // the caller must still present a valid token — a permissive origin only
  // lets the Tauri webview (tauri://localhost) reach the API at all
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Staff-User",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!staffTokenOk(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: CORS });
  }
  let body: { action?: string; args?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: CORS });
  }
  const fn = body.action ? OPS[body.action] : undefined;
  if (!fn) {
    return NextResponse.json({ error: "unknown_action" }, { status: 400, headers: CORS });
  }
  try {
    // the person signed in on that device (full edition) rides in its own header
    const userToken = req.headers.get("x-staff-user") ?? "";
    const result = await withStaffToken(() => fn(...(body.args ?? []) as never[]), userToken);
    return NextResponse.json({ ok: true, result }, { headers: CORS });
  } catch (e) {
    const { reportError } = await import("@/server/monitor");
    await reportError("staff-api", e, `action ${body.action}`);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "internal" },
      { status: 500, headers: CORS },
    );
  }
}
