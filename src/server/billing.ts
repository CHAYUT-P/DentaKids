/**
 * Billing (full edition): bills built from the room's visit record, payments,
 * receipt numbers, doctor fees (DF) and the day close. Same rules as
 * queries.ts — no `server-only` here, only server code imports it.
 */

import crypto from "node:crypto";

import { and, asc, eq, inArray, like, ne, sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import {
  appointment,
  child,
  clinicSetting,
  dentist,
  dfRule,
  invoice,
  invoiceItem,
  patientCredit,
  payment,
  treatment,
  visitRecord,
  waitlistEntry,
} from "@/db/schema";
import {
  DEFAULT_BILLING_SETTINGS,
  billTotals,
  computeDf,
  type Bill,
  type BillItem,
  type BillingSettings,
  type BillStatus,
  type CashierDay,
  type DayClose,
  type DfMode,
  type DfRule,
  type ClaimRow,
  type ClaimStatus,
  asCoverage,
  isClaim,
  isMoney,
  type DisplayState,
  type PayMethod,
  type PendingVisit,
} from "@/lib/billing";
import { todayISO } from "@/lib/dates";
import { toTreatmentInfo } from "@/lib/treatments";
import type { VisitItem } from "@/lib/staffTypes";

const METHODS: PayMethod[] = ["cash", "transfer", "promptpay", "card", "other", "credit", "sso", "nhso", "insurance"];
const int = (n: unknown) => Math.max(0, Math.round(Number(n) || 0));

/** what a query runs on: the shared pool, or a transaction's own connection —
 *  code holding a lock reads through its transaction, never the pool */
type Q = Pick<typeof db, "select">;

/* ── lookups ───────────────────────────────────────────────────────────── */

async function dentistMaps(q: Q = db) {
  const rows = await q.select({ id: dentist.id, slug: dentist.slug }).from(dentist);
  return {
    toSlug: new Map(rows.map((r) => [r.id, r.slug])),
    toId: new Map(rows.map((r) => [r.slug, r.id])),
  };
}

async function catalog() {
  const rows = await db.select().from(treatment);
  return new Map(rows.map((r) => [r.key, toTreatmentInfo(r)]));
}

/* ── settings ──────────────────────────────────────────────────────────── */

export async function getBillingSettings(): Promise<BillingSettings> {
  const rows = await db.select().from(clinicSetting).where(eq(clinicSetting.key, "billing"));
  let s = DEFAULT_BILLING_SETTINGS;
  try {
    if (rows[0]) s = { ...DEFAULT_BILLING_SETTINGS, ...(JSON.parse(rows[0].value) as Partial<BillingSettings>) };
  } catch {
    // keep the defaults
  }
  // the customer screen's pairing code is made once, then kept
  if (!s.displayCode) {
    s = { ...s, displayCode: crypto.randomBytes(6).toString("base64url") };
    await db
      .insert(clinicSetting)
      .values({ key: "billing", value: JSON.stringify(s) })
      .onConflictDoUpdate({ target: clinicSetting.key, set: { value: JSON.stringify(s), updatedAt: new Date() } });
  }
  return s;
}

/** the customer screen: the counter writes it, the screen polls it by code */
export async function setDisplay(state: Omit<DisplayState, "updatedAt" | "clinicName" | "promptpayId">): Promise<void> {
  const s = await getBillingSettings();
  const value: DisplayState = {
    mode: state.mode === "bill" || state.mode === "thanks" ? state.mode : "idle",
    clinicName: s.clinicName,
    patientName: String(state.patientName ?? "").slice(0, 60),
    items: (state.items ?? []).slice(0, 30).map((i) => ({ name: String(i.name).slice(0, 80), qty: int(i.qty), amount: int(i.amount) })),
    total: int(state.total),
    paid: int(state.paid),
    balance: int(state.balance),
    promptpayId: state.qrAmount > 0 ? s.promptpayId : "",
    qrAmount: int(state.qrAmount),
    updatedAt: new Date().toISOString(),
  };
  await db
    .insert(clinicSetting)
    .values({ key: `display:${s.displayCode}`, value: JSON.stringify(value) })
    .onConflictDoUpdate({ target: clinicSetting.key, set: { value: JSON.stringify(value), updatedAt: new Date() } });
}

export async function getDisplay(code: string): Promise<DisplayState | null> {
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(code)) return null;
  const rows = await db.select().from(clinicSetting).where(eq(clinicSetting.key, `display:${code}`));
  if (!rows[0]) {
    const s = await getBillingSettings();
    return s.displayCode === code
      ? { mode: "idle", clinicName: s.clinicName, patientName: "", items: [], total: 0, paid: 0, balance: 0, promptpayId: "", qrAmount: 0, updatedAt: "" }
      : null;
  }
  try {
    return JSON.parse(rows[0].value) as DisplayState;
  } catch {
    return null;
  }
}

export async function saveBillingSettings(input: Partial<BillingSettings>): Promise<void> {
  const cur = await getBillingSettings();
  const next: BillingSettings = {
    clinicName: String(input.clinicName ?? cur.clinicName).slice(0, 120),
    address: String(input.address ?? cur.address).slice(0, 300),
    phone: String(input.phone ?? cur.phone).slice(0, 40),
    taxId: String(input.taxId ?? cur.taxId).slice(0, 20),
    promptpayId: String(input.promptpayId ?? cur.promptpayId).replace(/[^\d]/g, "").slice(0, 15),
    receiptPrefix: String(input.receiptPrefix ?? cur.receiptPrefix).replace(/[^A-Za-z0-9]/g, "").slice(0, 6) || "RC",
    paper: input.paper === "slip" ? "slip" : input.paper === "a5" ? "a5" : cur.paper,
    footer: String(input.footer ?? cur.footer).slice(0, 200),
    displayCode: cur.displayCode,
    sendAftercare: input.sendAftercare ?? cur.sendAftercare,
    sendThanks: input.sendThanks ?? cur.sendThanks,
    ssoYearLimit: Math.max(0, Math.round(Number(input.ssoYearLimit ?? cur.ssoYearLimit) || 0)),
    nhsoVisitLimit: Math.max(0, Math.round(Number(input.nhsoVisitLimit ?? cur.nhsoVisitLimit) || 0)),
    reviewUrl: /^https?:\/\/\S+$/.test(String(input.reviewUrl ?? cur.reviewUrl)) ? String(input.reviewUrl ?? cur.reviewUrl).slice(0, 300) : "",
  };
  await db
    .insert(clinicSetting)
    .values({ key: "billing", value: JSON.stringify(next) })
    .onConflictDoUpdate({ target: clinicSetting.key, set: { value: JSON.stringify(next), updatedAt: new Date() } });
}

/* ── DF rules ──────────────────────────────────────────────────────────── */

export async function listDfRules(): Promise<DfRule[]> {
  const { toSlug } = await dentistMaps();
  const rows = await db.select().from(dfRule).orderBy(asc(dfRule.id));
  return rows.map((r) => ({
    id: r.id,
    dentistSlug: r.dentistId != null ? (toSlug.get(r.dentistId) ?? null) : null,
    treatmentKey: r.treatmentKey,
    mode: r.mode === "fixed" ? "fixed" : "percent",
    value: r.value,
  }));
}

/** set the rule for this dentist/treatment pair (null = any) */
export async function saveDfRule(input: {
  dentistSlug: string | null;
  treatmentKey: string | null;
  mode: DfMode;
  value: number;
}): Promise<void> {
  const { toId } = await dentistMaps();
  const dentistId = input.dentistSlug ? (toId.get(input.dentistSlug) ?? null) : null;
  if (input.dentistSlug && dentistId === null) return;
  const mode = input.mode === "fixed" ? "fixed" : "percent";
  const value = mode === "percent" ? Math.min(100, int(input.value)) : int(input.value);
  await db
    .insert(dfRule)
    .values({ dentistId, treatmentKey: input.treatmentKey || null, mode, value })
    .onConflictDoUpdate({
      target: [dfRule.dentistId, dfRule.treatmentKey],
      set: { mode, value, updatedAt: new Date() },
    });
}

export async function removeDfRule(id: number): Promise<void> {
  await db.delete(dfRule).where(eq(dfRule.id, id));
}

/* ── reading bills ─────────────────────────────────────────────────────── */

/**
 * What a patient has used of their cover: ประกันสังคม baht this calendar
 * year, บัตรทอง visits this fiscal year (Oct–Sep). Voided bills don't count.
 */
async function coverageUsage(childIds: number[], q: Q = db): Promise<Map<number, { sso: number; nhsoVisits: number }>> {
  const out = new Map<number, { sso: number; nhsoVisits: number }>();
  if (!childIds.length) return out;
  const today = todayISO();
  const year = today.slice(0, 4);
  const fyStart = today.slice(5) >= "10-01" ? `${year}-10-01` : `${Number(year) - 1}-10-01`;
  const rows = await q
    .select({ childId: invoice.childId, invoiceId: invoice.id, method: payment.method, amount: payment.amount, date: payment.date })
    .from(payment)
    .innerJoin(invoice, eq(invoice.id, payment.invoiceId))
    .where(and(inArray(invoice.childId, childIds), ne(invoice.status, "void"), inArray(payment.method, ["sso", "nhso"])));
  for (const id of childIds) {
    const mine = rows.filter((r) => r.childId === id);
    out.set(id, {
      sso: mine.filter((r) => r.method === "sso" && r.date.startsWith(year)).reduce((s, r) => s + r.amount, 0),
      nhsoVisits: new Set(mine.filter((r) => r.method === "nhso" && r.date >= fyStart).map((r) => r.invoiceId)).size,
    });
  }
  return out;
}

/** `q`: pass a transaction to read inside it (see addPayment) — never the pool while holding a lock */
export async function billsWhere(where: SQL, q: Q = db): Promise<Bill[]> {
  const { toSlug } = await dentistMaps(q);
  const heads = await q.select().from(invoice).where(where).orderBy(asc(invoice.createdAt));
  if (heads.length === 0) return [];
  const ids = heads.map((h) => h.id);
  const childIds = [...new Set(heads.map((h) => h.childId).filter((x): x is number => x != null))];
  const [items, pays, credits, kids, usage] = await Promise.all([
    q.select().from(invoiceItem).where(inArray(invoiceItem.invoiceId, ids)).orderBy(asc(invoiceItem.sort), asc(invoiceItem.id)),
    q.select().from(payment).where(inArray(payment.invoiceId, ids)).orderBy(asc(payment.createdAt)),
    childIds.length
      ? q.select({ childId: patientCredit.childId, amount: patientCredit.amount }).from(patientCredit).where(inArray(patientCredit.childId, childIds))
      : Promise.resolve([] as { childId: number; amount: number }[]),
    childIds.length ? q.select({ id: child.id, coverage: child.coverage }).from(child).where(inArray(child.id, childIds)) : Promise.resolve([]),
    coverageUsage(childIds, q),
  ]);
  return heads.map((h) => {
    const lines: BillItem[] = items
      .filter((i) => i.invoiceId === h.id)
      .map((i) => ({
        id: i.id,
        treatmentKey: i.treatmentKey,
        name: i.name,
        teeth: i.teeth,
        qty: i.qty,
        unitPrice: i.unitPrice,
        discount: i.discount,
        labCost: i.labCost,
        dentistSlug: i.dentistId != null ? (toSlug.get(i.dentistId) ?? null) : null,
        df: i.df,
        stockItemId: i.stockItemId,
      }));
    const paysOf = pays
      .filter((p) => p.invoiceId === h.id)
      .map((p) => ({
        id: p.id,
        method: (METHODS.includes(p.method as PayMethod) ? p.method : "other") as PayMethod,
        amount: p.amount,
        date: p.date,
        note: p.note,
        at: p.createdAt.toISOString(),
      }));
    const { subtotal, total } = billTotals(lines, h.discount);
    const paid = paysOf.reduce((s, p) => s + p.amount, 0);
    return {
      id: h.id,
      receiptNo: h.receiptNo,
      status: h.status as BillStatus,
      date: h.date,
      appointmentId: h.appointmentId,
      waitlistId: h.waitlistId,
      patientName: h.patientName,
      phone: h.phone,
      dentistSlug: h.dentistId != null ? (toSlug.get(h.dentistId) ?? null) : null,
      childId: h.childId,
      kind: h.kind === "deposit" ? "deposit" : "visit",
      coverage: asCoverage(kids.find((k) => k.id === h.childId)?.coverage),
      ssoUsed: h.childId != null ? (usage.get(h.childId)?.sso ?? 0) : 0,
      nhsoVisits: h.childId != null ? (usage.get(h.childId)?.nhsoVisits ?? 0) : 0,
      credit: h.childId != null ? credits.filter((c) => c.childId === h.childId).reduce((s, c) => s + c.amount, 0) : 0,
      planId: h.planId,
      discount: h.discount,
      note: h.note,
      voidReason: h.voidReason,
      items: lines,
      payments: paysOf,
      subtotal,
      total,
      paid,
      balance: Math.max(0, total - paid),
      createdAt: h.createdAt.toISOString(),
      paidAt: h.paidAt ? h.paidAt.toISOString() : null,
    };
  });
}

export async function getBill(id: number, q: Q = db): Promise<Bill | null> {
  return (await billsWhere(eq(invoice.id, id), q))[0] ?? null;
}

/** everything the cashier screen shows for one day */
export async function cashierDay(date: string): Promise<CashierDay> {
  const bills = await billsWhere(eq(invoice.date, date));
  const live = bills.filter((b) => b.status !== "void");
  const billedAppt = new Set(live.map((b) => b.appointmentId).filter((x): x is number => x != null));
  const billedWalk = new Set(live.map((b) => b.waitlistId).filter((x): x is number => x != null));

  const { toSlug } = await dentistMaps();
  const appts = await db
    .select()
    .from(appointment)
    .where(and(eq(appointment.date, date), inArray(appointment.status, ["arrived", "in_chair", "completed"])));
  // walk-ins carry no date column — the day is when the row was made
  const walks = await db
    .select()
    .from(waitlistEntry)
    .where(sql`(${waitlistEntry.createdAt} at time zone 'Asia/Bangkok')::date = ${date}::date`);
  const recs = await db
    .select({ a: visitRecord.appointmentId, w: visitRecord.waitlistId })
    .from(visitRecord);
  const recA = new Set(recs.map((r) => r.a).filter((x): x is number => x != null));
  const recW = new Set(recs.map((r) => r.w).filter((x): x is number => x != null));

  const pending: PendingVisit[] = [
    ...appts
      .filter((a) => !billedAppt.has(a.id))
      .map((a) => ({
        kind: "booking" as const,
        appointmentId: a.id,
        waitlistId: null,
        ref: a.ref,
        patientName: a.childName,
        phone: a.phone,
        dentistSlug: a.dentistId != null ? (toSlug.get(a.dentistId) ?? null) : null,
        time: a.checkedInAt ?? a.time,
        status: a.status,
        recorded: recA.has(a.id),
      })),
    ...walks
      .filter((w) => !billedWalk.has(w.id))
      .map((w) => ({
        kind: "walkin" as const,
        appointmentId: null,
        waitlistId: w.id,
        ref: `W-${w.id}`,
        patientName: w.childName,
        phone: w.guardianPhone,
        dentistSlug: w.dentistId != null ? (toSlug.get(w.dentistId) ?? null) : null,
        time: w.arrivedAt,
        status: w.status === "done" ? "completed" : w.status,
        recorded: recW.has(w.id),
      })),
  ].sort((a, b) => {
    // finished in the room first — those are the ones walking to the counter
    const rank = (s: string) => (s === "completed" ? 0 : s === "in_chair" ? 1 : 2);
    return rank(a.status) - rank(b.status) || (a.time < b.time ? -1 : 1);
  });

  return { date, bills, pending };
}

/* ── writing bills ─────────────────────────────────────────────────────── */

/**
 * The bill for a visit — the existing one, or a new one built from what the
 * room recorded (or, with no record, the booked treatment at list price).
 */
export async function openBillForVisit(input: { appointmentId?: number | null; waitlistId?: number | null }): Promise<number | null> {
  const apptId = input.appointmentId ?? null;
  const walkId = input.waitlistId ?? null;
  if ((apptId === null) === (walkId === null)) return null;

  const existing = await db
    .select({ id: invoice.id })
    .from(invoice)
    .where(and(apptId !== null ? eq(invoice.appointmentId, apptId) : eq(invoice.waitlistId, walkId!), ne(invoice.status, "void")))
    .limit(1);
  if (existing[0]) return existing[0].id;

  let head: { name: string; phone: string; dentistId: number | null; date: string; bookedKey: string; childId: number | null };
  if (apptId !== null) {
    const a = (await db.select().from(appointment).where(eq(appointment.id, apptId)))[0];
    if (!a) return null;
    head = { name: a.childName, phone: a.phone, dentistId: a.dentistId, date: a.date, bookedKey: a.treatmentKey, childId: a.childId };
  } else {
    const w = (await db.select().from(waitlistEntry).where(eq(waitlistEntry.id, walkId!)))[0];
    if (!w) return null;
    head = { name: w.childName, phone: w.guardianPhone, dentistId: w.dentistId, date: todayISO(w.createdAt), bookedKey: w.treatmentKey, childId: null };
  }

  const rec = (
    await db
      .select()
      .from(visitRecord)
      .where(apptId !== null ? eq(visitRecord.appointmentId, apptId) : eq(visitRecord.waitlistId, walkId!))
  )[0];
  const cat = await catalog();
  const dentistId = rec?.dentistId ?? head.dentistId;
  const recItems = (Array.isArray(rec?.items) ? (rec.items as VisitItem[]) : []).filter((i) => i?.key);
  const lines: { treatmentKey: string; name: string; teeth: string; qty: number; unitPrice: number }[] = recItems.length
    ? recItems.map((i) => ({
        treatmentKey: i.key,
        name: cat.get(i.key)?.name.th ?? i.key,
        teeth: i.teeth ?? "",
        qty: int(i.qty) || 1,
        unitPrice: int(i.price),
      }))
    : (
        (rec && Array.isArray(rec.treatments) && rec.treatments.length ? (rec.treatments as string[]) : [head.bookedKey])
      ).map((k, idx, arr) => ({
        treatmentKey: k,
        name: cat.get(k)?.name.th ?? k,
        teeth: "",
        qty: 1,
        // an older record's single price belongs to its only treatment
        unitPrice: arr.length === 1 && rec?.price != null ? int(rec.price) : int(cat.get(k)?.price),
      }));

  // tie the bill to the patient's file when there is one (deposits, history)
  const clinical = await import("@/server/clinical");
  const childId = head.childId ?? (await clinical.matchChild(head.phone, head.name));
  const [created] = await db
    .insert(invoice)
    .values({
      date: head.date,
      appointmentId: apptId,
      waitlistId: walkId,
      childId,
      patientName: head.name,
      phone: head.phone,
      dentistId,
    })
    .returning({ id: invoice.id });
  if (lines.length) {
    await db.insert(invoiceItem).values(
      lines.map((l, i) => ({ invoiceId: created.id, ...l, dentistId, sort: i })),
    );
  }
  await refreshDf(created.id);
  return created.id;
}

/** a bill with no visit behind it — a product sale, a family paying a balance */
export async function openBlankBill(input: { patientName: string; phone: string; childId?: number | null }): Promise<number> {
  const clinical = await import("@/server/clinical");
  const childId = input.childId ?? (input.phone ? await clinical.matchChild(input.phone, input.patientName) : null);
  const [created] = await db
    .insert(invoice)
    .values({
      date: todayISO(),
      childId,
      patientName: input.patientName.trim().slice(0, 80) || "ลูกค้าทั่วไป",
      phone: input.phone.trim().slice(0, 20),
    })
    .returning({ id: invoice.id });
  return created.id;
}

/** DF and status again — after lines were written outside saveBill */
export async function refreshBill(id: number): Promise<void> {
  await refreshDf(id);
  await settleStatus(id);
}

/** replace the lines, the bill discount and the note; DF is worked out again */
export async function saveBill(
  id: number,
  input: { items: BillItem[]; discount: number; note: string; patientName?: string },
): Promise<boolean> {
  const head = (await db.select().from(invoice).where(eq(invoice.id, id)))[0];
  // a settled receipt is final — cancel it and bill again instead
  if (!head || head.status === "void" || head.status === "paid") return false;
  const { toId } = await dentistMaps();
  const lines = (input.items ?? []).slice(0, 60).map((i, idx) => ({
    invoiceId: id,
    treatmentKey: i.treatmentKey || null,
    name: String(i.name ?? "").trim().slice(0, 120) || "รายการ",
    teeth: String(i.teeth ?? "").slice(0, 60),
    qty: Math.max(1, int(i.qty)),
    unitPrice: int(i.unitPrice),
    discount: int(i.discount),
    labCost: int(i.labCost),
    dentistId: i.dentistSlug ? (toId.get(i.dentistSlug) ?? null) : null,
    stockItemId: i.stockItemId ?? null,
    sort: idx,
  }));
  await db.transaction(async (tx) => {
    await tx.delete(invoiceItem).where(eq(invoiceItem.invoiceId, id));
    if (lines.length) await tx.insert(invoiceItem).values(lines);
    await tx
      .update(invoice)
      .set({
        discount: int(input.discount),
        note: String(input.note ?? "").slice(0, 300),
        ...(input.patientName?.trim() ? { patientName: input.patientName.trim().slice(0, 80) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(invoice.id, id));
  });
  await refreshDf(id);
  await settleStatus(id);
  return true;
}

/** recompute each line's DF from the current rules */
async function refreshDf(id: number): Promise<void> {
  const bill = await getBill(id);
  if (!bill) return;
  const dfs = computeDf(bill.items, bill.discount, await listDfRules());
  await Promise.all(
    bill.items.map((it, idx) =>
      it.id != null && it.df !== dfs[idx]
        ? db.update(invoiceItem).set({ df: dfs[idx] }).where(eq(invoiceItem.id, it.id))
        : null,
    ),
  );
}

/** open → partial → paid from the money in; stamps paidAt once */
async function settleStatus(id: number): Promise<void> {
  const bill = await getBill(id);
  if (!bill || bill.status === "void") return;
  const status: BillStatus =
    bill.paid <= 0 ? "open" : bill.paid >= bill.total ? "paid" : "partial";
  await db
    .update(invoice)
    .set({
      status,
      paidAt: status === "paid" ? (bill.paidAt ? new Date(bill.paidAt) : new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(invoice.id, id));
  // settled: what was sold and what the treatments used leave the shelf,
  // and the family gets the care advice / thanks on LINE (never blocks the sale)
  if (status === "paid") {
    const { applyStockForBill } = await import("@/server/stock");
    await applyStockForBill(id);
    await sendAfterVisit(id).catch(() => {});
  }
}

/* ── after-visit LINE message ──────────────────────────────────────────── */

export async function getAftercareNotes(): Promise<Record<string, string>> {
  const rows = await db.select().from(clinicSetting).where(eq(clinicSetting.key, "aftercare"));
  try {
    return rows[0] ? (JSON.parse(rows[0].value) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function saveAftercareNote(treatmentKey: string, text: string): Promise<void> {
  const notes = await getAftercareNotes();
  const t = text.trim().slice(0, 600);
  if (t) notes[treatmentKey] = t;
  else delete notes[treatmentKey];
  const value = JSON.stringify(notes);
  await db
    .insert(clinicSetting)
    .values({ key: "aftercare", value })
    .onConflictDoUpdate({ target: clinicSetting.key, set: { value, updatedAt: new Date() } });
}

/**
 * Once a bill is paid: care advice for each treatment on it (as the clinic
 * wrote it) and/or a thank-you with the review link — to the LINE account
 * the family booked with. Sent once per bill; nothing without LINE.
 */
async function sendAfterVisit(id: number): Promise<void> {
  const s = await getBillingSettings();
  if (!s.sendAftercare && !s.sendThanks) return;
  const head = (await db.select().from(invoice).where(eq(invoice.id, id)))[0];
  if (!head || head.careSentAt || head.kind === "deposit") return;
  const { lineTargetForAppointment } = await import("@/server/queries");
  const clinical = await import("@/server/clinical");
  const to = head.appointmentId
    ? await lineTargetForAppointment(head.appointmentId)
    : head.childId
      ? await clinical.lineTargetForChild(head.childId)
      : null;
  if (!to) return;

  const bill = await getBill(id);
  const notes = s.sendAftercare ? await getAftercareNotes() : {};
  const keys = [...new Set((bill?.items ?? []).map((i) => i.treatmentKey).filter((k): k is string => !!k))];
  const advice = keys
    .filter((k) => notes[k])
    .map((k) => `• ${bill?.items.find((i) => i.treatmentKey === k)?.name ?? k}: ${notes[k]}`);
  const parts = [
    `${s.clinicName} ขอบคุณ${head.patientName ? `ที่พา${head.patientName}` : ""}มารับบริการวันนี้ค่ะ`,
    advice.length ? `คำแนะนำหลังการรักษา\n${advice.join("\n")}` : "",
    s.sendThanks && s.reviewUrl ? `ถ้าประทับใจ ช่วยรีวิวให้เราหน่อยนะคะ 🙏\n${s.reviewUrl}` : "",
  ].filter(Boolean);
  // a bare thank-you is only sent when thanks are switched on
  if (!advice.length && !(s.sendThanks && s.reviewUrl)) return;

  const { pushLineText } = await import("@/server/line");
  if (!(await pushLineText(to, parts.join("\n\n")).catch(() => false))) return;
  await db.update(invoice).set({ careSentAt: new Date() }).where(eq(invoice.id, id));
  const { messageLog } = await import("@/db/schema");
  await db.insert(messageLog).values({ appointmentId: head.appointmentId, kind: "aftercare" });
}

/* ── claims to file (ประกันสังคม / บัตรทอง / insurers) ──────────────────── */

export async function listClaims(from: string, to: string): Promise<ClaimRow[]> {
  const rows = await db
    .select({ p: payment, i: invoice, idCard: child.idCard })
    .from(payment)
    .innerJoin(invoice, eq(invoice.id, payment.invoiceId))
    .leftJoin(child, eq(child.id, invoice.childId))
    .where(and(inArray(payment.method, ["sso", "nhso", "insurance"]), ne(invoice.status, "void"), sql`${payment.date} between ${from} and ${to}`))
    .orderBy(asc(payment.date), asc(payment.id));
  const items = rows.length
    ? await db.select({ invoiceId: invoiceItem.invoiceId, name: invoiceItem.name, teeth: invoiceItem.teeth }).from(invoiceItem).where(inArray(invoiceItem.invoiceId, rows.map((r) => r.i.id)))
    : [];
  return rows.map(({ p, i, idCard }) => ({
    paymentId: p.id,
    invoiceId: i.id,
    method: p.method as PayMethod,
    amount: p.amount,
    date: p.date,
    status: (["pending", "submitted", "paid", "rejected"].includes(p.claimStatus) ? p.claimStatus : "pending") as ClaimStatus,
    receiptNo: i.receiptNo,
    patientName: i.patientName,
    idCard: idCard ?? "",
    items: items.filter((x) => x.invoiceId === i.id).map((x) => `${x.name}${x.teeth ? ` (${x.teeth})` : ""}`).join(", "),
  }));
}

export async function setClaimStatus(paymentIds: number[], status: ClaimStatus): Promise<void> {
  if (!["pending", "submitted", "paid", "rejected"].includes(status) || !paymentIds.length) return;
  await db.update(payment).set({ claimStatus: status }).where(and(inArray(payment.id, paymentIds.slice(0, 500)), inArray(payment.method, ["sso", "nhso", "insurance"])));
}

/** the next receipt number for this month: RC + พ.ศ. year + month + running */
async function nextReceiptNo(prefix: string, date: string): Promise<string> {
  const [y, m] = date.split("-");
  const stem = `${prefix}${String(Number(y) + 543).slice(-2)}${m}-`;
  const rows = await db
    .select({ no: invoice.receiptNo })
    .from(invoice)
    .where(like(invoice.receiptNo, `${stem}%`));
  const max = rows.reduce((mx, r) => Math.max(mx, Number(r.no?.slice(stem.length)) || 0), 0);
  return `${stem}${String(max + 1).padStart(4, "0")}`;
}

/** take money; the first payment gives the bill its receipt number */
/**
 * Take money on a bill. Safe against the two ways a till goes wrong:
 *
 *  · a double click, or a retry after the connection dropped — the cashier
 *    screen sends one `idempotencyKey` per payment, and a key already used
 *    gets the first payment back instead of a second one
 *  · two counters on the same bill (or the same patient's deposit) at once —
 *    a lock per bill and per patient's deposit makes "is this more than is
 *    owed / more deposit than they have?" and "record it" one step
 */
export async function addPayment(
  id: number,
  input: { method: PayMethod; amount: number; note?: string; idempotencyKey?: string },
): Promise<{ ok: boolean; receiptNo?: string; replayed?: boolean }> {
  const head = (await db.select().from(invoice).where(eq(invoice.id, id)))[0];
  const amount = int(input.amount);
  if (!head || head.status === "void" || amount <= 0) return { ok: false };
  const method = METHODS.includes(input.method) ? input.method : "other";
  const today = todayISO();
  const key = input.idempotencyKey || null;

  const outcome = await db.transaction(async (tx): Promise<"ok" | "replayed" | "refused"> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pay:${id}`}))`);
    if (key) {
      const seen = await tx.select({ id: payment.id }).from(payment).where(eq(payment.idempotencyKey, key));
      if (seen.length) return "replayed";
    }

    // never more than is owed — a settled bill takes no more money (read
    // after the lock, so a payment that just landed is counted)
    const current = await getBill(id, tx);
    if (!current || current.status === "void" || amount > current.balance) return "refused";

    // spending a deposit: only what the patient has, only on their own bill —
    // locked per patient, since two bills can draw on one deposit
    if (method === "credit") {
      if (!head.childId) return "refused";
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credit:${head.childId}`}))`);
      const { creditBalance } = await import("@/server/clinical");
      if ((await creditBalance(head.childId, tx)) < amount) return "refused";
      await tx.insert(patientCredit).values({ childId: head.childId, amount: -amount, invoiceId: id, note: "ใช้มัดจำ" });
    }

    await tx.insert(payment).values({
      invoiceId: id,
      method,
      amount,
      date: today,
      note: String(input.note ?? "").slice(0, 120),
      // paid by a fund or insurer: the clinic still has to file for it
      claimStatus: isClaim(method) ? "pending" : "",
      idempotencyKey: key,
    });
    return "ok";
  });

  if (outcome === "refused") return { ok: false };
  if (outcome === "replayed") {
    const again = (await db.select({ receiptNo: invoice.receiptNo }).from(invoice).where(eq(invoice.id, id)))[0];
    return { ok: true, receiptNo: again?.receiptNo ?? undefined, replayed: true };
  }

  let receiptNo = head.receiptNo;
  if (!receiptNo) {
    const { receiptPrefix } = await getBillingSettings();
    // two counters taking money at once can race for a number — retry on the unique index
    for (let attempt = 0; attempt < 5 && !receiptNo; attempt++) {
      const candidate = await nextReceiptNo(receiptPrefix, today);
      try {
        await db.update(invoice).set({ receiptNo: candidate }).where(eq(invoice.id, id));
        receiptNo = candidate;
      } catch {
        // taken — try the next one
      }
    }
  }
  await settleStatus(id);
  return { ok: true, receiptNo: receiptNo ?? undefined };
}

/** cancel a bill — kept, with the reason, for the day-close audit */
export async function voidBill(id: number, reason: string): Promise<boolean> {
  const why = reason.trim().slice(0, 200);
  if (!why) return false;
  const done = await db
    .update(invoice)
    .set({ status: "void", voidReason: why, voidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoice.id, id), ne(invoice.status, "void")))
    .returning({ id: invoice.id });
  // deposit spent on this bill goes back; a cancelled deposit receipt takes its deposit away
  if (done.length) {
    await db.delete(patientCredit).where(eq(patientCredit.invoiceId, id));
    const { reverseStockForBill } = await import("@/server/stock");
    await reverseStockForBill(id);
  }
  return true;
}

/* ── day close ─────────────────────────────────────────────────────────── */

export async function dayClose(date: string): Promise<DayClose> {
  // money in today, whichever day the bill belongs to — not from voided bills
  const pays = await db
    .select({ method: payment.method, amount: payment.amount, status: invoice.status })
    .from(payment)
    .innerJoin(invoice, eq(invoice.id, payment.invoiceId))
    .where(eq(payment.date, date));
  const byMethod = METHODS.map((m) => {
    const rows = pays.filter((p) => p.method === m && p.status !== "void");
    return { method: m, amount: rows.reduce((s, r) => s + r.amount, 0), count: rows.length };
  }).filter((r) => r.count > 0);

  const bills = await billsWhere(eq(invoice.date, date));
  const live = bills.filter((b) => b.status !== "void");
  const settled = live.filter((b) => b.status === "paid");
  const owingBills = live.filter((b) => b.balance > 0);

  const per = new Map<string, { lines: number; revenue: number; labCost: number; df: number }>();
  // deposits are money held, not treatment — they stay out of revenue and DF
  for (const b of settled.filter((x) => x.kind !== "deposit")) {
    const nets = b.items.map((i) => Math.max(0, i.qty * i.unitPrice - i.discount));
    const sum = nets.reduce((s, n) => s + n, 0);
    b.items.forEach((it, idx) => {
      const key = it.dentistSlug ?? "";
      const row = per.get(key) ?? { lines: 0, revenue: 0, labCost: 0, df: 0 };
      const share = sum > 0 ? (Math.min(b.discount, sum) * nets[idx]) / sum : 0;
      row.lines += 1;
      row.revenue += Math.round(nets[idx] - share);
      row.labCost += it.labCost;
      row.df += it.df;
      per.set(key, row);
    });
  }

  return {
    date,
    byMethod,
    received: byMethod.filter((r) => isMoney(r.method)).reduce((s, r) => s + r.amount, 0),
    claims: byMethod.filter((r) => isClaim(r.method)).reduce((s, r) => s + r.amount, 0),
    billsPaid: settled.length,
    billsOwing: owingBills.length,
    owing: owingBills.reduce((s, b) => s + b.balance, 0),
    dentists: [...per.entries()]
      .map(([slug, r]) => ({ dentistSlug: slug || null, ...r }))
      .sort((a, b) => b.df - a.df),
    voided: bills
      .filter((b) => b.status === "void")
      .map((b) => ({ receiptNo: b.receiptNo, patientName: b.patientName, total: b.total, reason: b.voidReason })),
    expenses: (await import("@/server/stock").then((m) => m.listExpenses(date, date))).reduce((s, e) => s + e.amount, 0),
  };
}

/** the patient's next booking after a given day — printed on the receipt */
export async function nextVisitFor(phone: string, after: string): Promise<{ date: string; time: string } | null> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 9) return null;
  const rows = await db
    .select({ date: appointment.date, time: appointment.time, phone: appointment.phone })
    .from(appointment)
    .where(and(eq(appointment.status, "confirmed"), sql`${appointment.date} > ${after}`))
    .orderBy(asc(appointment.date), asc(appointment.time));
  const hit = rows.find((r) => r.phone.replace(/\D/g, "") === digits);
  return hit ? { date: hit.date, time: hit.time } : null;
}
