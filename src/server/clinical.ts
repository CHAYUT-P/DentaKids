/**
 * The patient file (full edition): who the patient is, every visit and bill,
 * the dental chart, plans and contracts, paperwork, files and recalls.
 * Same rules as queries.ts — no `server-only`, only server code imports it.
 */

import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  appointment,
  child,
  clinicalDoc,
  dentist,
  guardian,
  invoice,
  invoiceItem,
  medication,
  patientCredit,
  patientFile,
  payment,
  planItem,
  recall,
  toothEvent,
  toothState,
  treatmentPlan,
  visitRecord,
  waitlistEntry,
} from "@/db/schema";
import { normalizeName } from "@/lib/clinicSettings";
import { addDays, todayISO } from "@/lib/dates";
import { lineNet, type PayMethod } from "@/lib/billing";
import type {
  ClinicalDocRow,
  DocKind,
  FileMeta,
  Medication,
  PatientFileData,
  PatientVisit,
  PlanItemRow,
  PlanRow,
  PlanStatus,
  RecallRow,
  RecallStatus,
  ToothStatus,
} from "@/lib/clinical";
import type { VisitItem } from "@/lib/staffTypes";
import { addPayment, billsWhere } from "@/server/billing";

const int = (n: unknown) => Math.max(0, Math.round(Number(n) || 0));
const digits = (s: string) => (s || "").replace(/\D/g, "");

async function dentistMaps() {
  const rows = await db.select({ id: dentist.id, slug: dentist.slug }).from(dentist);
  return {
    toSlug: new Map(rows.map((r) => [r.id, r.slug])),
    toId: new Map(rows.map((r) => [r.slug, r.id])),
  };
}

function ageFrom(birthdate: string | null, fallback: number | null): number | null {
  if (!birthdate) return fallback;
  const [by, bm, bd] = birthdate.split("-").map(Number);
  const [ty, tm, td] = todayISO().split("-").map(Number);
  if (!by) return fallback;
  let a = ty - by;
  if (tm < bm || (tm === bm && td < bd)) a -= 1;
  return a >= 0 ? a : fallback;
}

/* ── who is this visit? ────────────────────────────────────────────────── */

/**
 * The patient-file row for a phone + the name said at the desk. Online
 * bookings carry only a nickname, so the match is phone first, then the
 * name (or nickname) with titles like น้อง stripped.
 */
export async function matchChild(phone: string, name: string): Promise<number | null> {
  const d = digits(phone);
  if (d.length < 9) return null;
  const gs = await db.select({ id: guardian.id, phone: guardian.phone }).from(guardian);
  const family = gs.filter((g) => digits(g.phone) === d).map((g) => g.id);
  if (family.length === 0) return null;
  const kids = await db.select().from(child).where(inArray(child.guardianId, family));
  const want = normalizeName(name);
  const hit =
    kids.find((c) => normalizeName(c.name) === want) ??
    kids.find((c) => c.nickname && normalizeName(c.nickname) === want) ??
    (kids.length === 1 ? kids[0] : undefined);
  return hit?.id ?? null;
}

/** the patient behind a booking — its own link, or a phone + name match */
export async function childForAppointment(appointmentId: number): Promise<number | null> {
  const a = (await db.select().from(appointment).where(eq(appointment.id, appointmentId)))[0];
  if (!a) return null;
  if (a.childId) return a.childId;
  return matchChild(a.phone, a.childName);
}

/**
 * Open a file for someone who has none yet — from a booking (name + phone)
 * or for a guardian booked as "ตนเอง" (an adult patient). Returns the child
 * row id the file hangs on.
 */
export async function ensurePatient(input: { phone: string; name: string; guardianName?: string }): Promise<number | null> {
  const found = await matchChild(input.phone, input.name);
  if (found) return found;
  const d = digits(input.phone);
  if (d.length < 9 || !input.name.trim()) return null;
  let g = (await db.select().from(guardian)).find((x) => digits(x.phone) === d);
  if (!g) {
    [g] = await db
      .insert(guardian)
      .values({ name: input.guardianName?.trim() || `ผู้ปกครอง ${input.name.trim()}`, phone: d })
      .returning();
  }
  const count = (await db.select({ id: child.id }).from(child)).length;
  const [c] = await db
    .insert(child)
    .values({ guardianId: g.id, name: input.name.trim(), hn: `DK-${String(count + 1).padStart(6, "0")}` })
    .onConflictDoNothing()
    .returning({ id: child.id });
  return c?.id ?? matchChild(input.phone, input.name);
}

/* ── the whole file ────────────────────────────────────────────────────── */

export async function getPatientFile(childId: number): Promise<PatientFileData | null> {
  const c = (await db.select().from(child).where(eq(child.id, childId)))[0];
  if (!c) return null;
  const g = (await db.select().from(guardian).where(eq(guardian.id, c.guardianId)))[0];
  const { toSlug } = await dentistMaps();
  const phoneDigits = digits(g?.phone ?? "");
  const names = new Set([normalizeName(c.name), c.nickname ? normalizeName(c.nickname) : ""].filter(Boolean));

  // visits: linked by id, or same phone and the name the family gave
  const appts = (await db.select().from(appointment)).filter(
    (a) => a.childId === childId || (digits(a.phone) === phoneDigits && names.has(normalizeName(a.childName))),
  );
  const walks = (await db.select().from(waitlistEntry)).filter(
    (w) => digits(w.guardianPhone) === phoneDigits && names.has(normalizeName(w.childName)),
  );
  const apptIds = appts.map((a) => a.id);
  const walkIds = walks.map((w) => w.id);
  const recs = await db
    .select()
    .from(visitRecord)
    .where(
      or(
        apptIds.length ? inArray(visitRecord.appointmentId, apptIds) : sql`false`,
        walkIds.length ? inArray(visitRecord.waitlistId, walkIds) : sql`false`,
      ),
    );
  const recFor = (kind: "a" | "w", id: number) =>
    recs.find((r) => (kind === "a" ? r.appointmentId === id : r.waitlistId === id));

  const visits: PatientVisit[] = [
    ...appts.map((a) => {
      const r = recFor("a", a.id);
      return {
        kind: "booking" as const,
        id: a.id,
        ref: a.ref,
        date: a.date,
        time: a.time,
        status: a.status,
        dentistSlug: (r?.dentistId ?? a.dentistId) != null ? (toSlug.get((r?.dentistId ?? a.dentistId)!) ?? null) : null,
        treatmentKey: a.treatmentKey,
        items: Array.isArray(r?.items) ? (r.items as VisitItem[]) : [],
        detail: r?.detail ?? "",
      };
    }),
    ...walks.map((w) => {
      const r = recFor("w", w.id);
      return {
        kind: "walkin" as const,
        id: w.id,
        ref: `W-${w.id}`,
        date: todayISO(w.createdAt),
        time: w.arrivedAt,
        status: w.status === "done" ? "completed" : w.status,
        dentistSlug: (r?.dentistId ?? w.dentistId) != null ? (toSlug.get((r?.dentistId ?? w.dentistId)!) ?? null) : null,
        treatmentKey: w.treatmentKey,
        items: Array.isArray(r?.items) ? (r.items as VisitItem[]) : [],
        detail: r?.detail ?? "",
      };
    }),
  ].sort((a, b) => (a.date + a.time > b.date + b.time ? -1 : 1));

  const bills = await billsWhere(
    or(
      eq(invoice.childId, childId),
      apptIds.length ? inArray(invoice.appointmentId, apptIds) : sql`false`,
      walkIds.length ? inArray(invoice.waitlistId, walkIds) : sql`false`,
    )!,
  );
  bills.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));

  const [chart, history, plans, docs, files, recalls, creditRows] = await Promise.all([
    db.select().from(toothState).where(eq(toothState.childId, childId)),
    db.select().from(toothEvent).where(eq(toothEvent.childId, childId)).orderBy(desc(toothEvent.createdAt)).limit(200),
    listPlans(childId),
    listDocs(childId),
    listFiles(childId),
    listRecalls({ childId }),
    db.select({ amount: patientCredit.amount }).from(patientCredit).where(eq(patientCredit.childId, childId)),
  ]);

  const toRow = (t: typeof toothState.$inferSelect | typeof toothEvent.$inferSelect) => ({
    tooth: t.tooth,
    status: t.status as ToothStatus,
    surfaces: Array.isArray(t.surfaces) ? (t.surfaces as string[]) : [],
    note: t.note,
    dentistSlug: t.dentistId != null ? (toSlug.get(t.dentistId) ?? null) : null,
    updatedAt: ("updatedAt" in t ? t.updatedAt : t.createdAt).toISOString(),
  });

  return {
    childId: c.id,
    guardianId: c.guardianId,
    name: c.name,
    fullName: c.fullName,
    nickname: c.nickname ?? "",
    hn: c.hn ?? "",
    birthdate: c.birthdate,
    age: ageFrom(c.birthdate, c.age),
    gender: c.gender,
    idCard: c.idCard,
    bloodType: c.bloodType,
    conditions: c.conditions,
    medications: c.medications,
    allergies: c.allergies,
    notes: c.notes,
    tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
    recallMonths: c.recallMonths,
    coverage: c.coverage,
    guardian: {
      name: g?.name ?? "",
      fullName: g?.fullName ?? "",
      relation: g?.relation ?? "",
      phone: g?.phone ?? "",
      lineContact: g?.lineContact ?? "",
      address: g?.address ?? "",
    },
    visits,
    bills,
    owing: bills.filter((b) => b.status !== "void").reduce((s, b) => s + b.balance, 0),
    credit: creditRows.reduce((s, r) => s + r.amount, 0),
    chart: chart.map(toRow),
    chartHistory: history.map((h) => ({ id: h.id, ...toRow(h) })),
    plans,
    docs,
    files,
    recalls,
  };
}

/* ── the chart ─────────────────────────────────────────────────────────── */

const STATUSES: ToothStatus[] = [
  "sound", "caries", "filled", "sealant", "pulpotomy", "rct", "ssc", "crown",
  "missing", "extracted", "unerupted", "mobile", "impacted", "implant", "watch",
];

/** mark one or more teeth; "sound" clears the mark. Every change is logged. */
export async function setTeeth(input: {
  childId: number;
  teeth: string[];
  status: ToothStatus;
  surfaces: string[];
  note: string;
  dentistSlug: string | null;
}): Promise<void> {
  if (!STATUSES.includes(input.status)) return;
  const { toId } = await dentistMaps();
  const dentistId = input.dentistSlug ? (toId.get(input.dentistSlug) ?? null) : null;
  const surfaces = (input.surfaces ?? []).filter((s) => /^[MODBLI]$/.test(s));
  const note = String(input.note ?? "").slice(0, 200);
  for (const tooth of input.teeth.filter((t) => /^[1-8][1-8]$/.test(t)).slice(0, 52)) {
    if (input.status === "sound") {
      await db.delete(toothState).where(and(eq(toothState.childId, input.childId), eq(toothState.tooth, tooth)));
    } else {
      await db
        .insert(toothState)
        .values({ childId: input.childId, tooth, status: input.status, surfaces, note, dentistId })
        .onConflictDoUpdate({
          target: [toothState.childId, toothState.tooth],
          set: { status: input.status, surfaces, note, dentistId, updatedAt: new Date() },
        });
    }
    await db.insert(toothEvent).values({ childId: input.childId, tooth, status: input.status, surfaces, note, dentistId });
  }
}

/* ── plans, estimates, contracts ───────────────────────────────────────── */

export async function listPlans(childId: number): Promise<PlanRow[]> {
  const { toSlug } = await dentistMaps();
  const plans = await db.select().from(treatmentPlan).where(eq(treatmentPlan.childId, childId)).orderBy(desc(treatmentPlan.createdAt));
  if (plans.length === 0) return [];
  const ids = plans.map((p) => p.id);
  const items = await db.select().from(planItem).where(inArray(planItem.planId, ids)).orderBy(asc(planItem.sort), asc(planItem.id));
  const paidRows = await db
    .select({ planId: invoice.planId, amount: payment.amount })
    .from(payment)
    .innerJoin(invoice, eq(invoice.id, payment.invoiceId))
    .where(and(inArray(invoice.planId, ids), ne(invoice.status, "void")));
  return plans.map((p) => {
    const lines: PlanItemRow[] = items
      .filter((i) => i.planId === p.id)
      .map((i) => ({
        id: i.id,
        treatmentKey: i.treatmentKey,
        name: i.name,
        teeth: i.teeth,
        qty: i.qty,
        unitPrice: i.unitPrice,
        discount: i.discount,
        status: i.status as PlanItemRow["status"],
        doneAt: i.doneAt,
      }));
    return {
      id: p.id,
      title: p.title,
      kind: p.kind === "contract" ? "contract" : "plan",
      status: p.status as PlanStatus,
      agreedTotal: p.agreedTotal,
      note: p.note,
      dentistSlug: p.dentistId != null ? (toSlug.get(p.dentistId) ?? null) : null,
      items: lines,
      itemsTotal: lines.filter((l) => l.status !== "cancelled").reduce((s, l) => s + lineNet(l), 0),
      paid: paidRows.filter((r) => r.planId === p.id).reduce((s, r) => s + r.amount, 0),
      createdAt: p.createdAt.toISOString(),
      signature: p.signature,
      signedBy: p.signedBy,
      signedAt: p.signedAt ? p.signedAt.toISOString() : null,
    };
  });
}

export async function savePlan(input: {
  id?: number | null;
  childId: number;
  title: string;
  kind: "plan" | "contract";
  status: PlanStatus;
  agreedTotal: number | null;
  note: string;
  dentistSlug: string | null;
  items: PlanItemRow[];
}): Promise<number> {
  const { toId } = await dentistMaps();
  const values = {
    childId: input.childId,
    title: String(input.title ?? "").trim().slice(0, 120) || "แผนการรักษา",
    kind: input.kind === "contract" ? "contract" : "plan",
    status: ["draft", "accepted", "in_progress", "done", "cancelled"].includes(input.status) ? input.status : "draft",
    agreedTotal: input.kind === "contract" && input.agreedTotal != null ? int(input.agreedTotal) : null,
    note: String(input.note ?? "").slice(0, 1000),
    dentistId: input.dentistSlug ? (toId.get(input.dentistSlug) ?? null) : null,
    updatedAt: new Date(),
  };
  let id = input.id ?? null;
  if (id) {
    await db.update(treatmentPlan).set(values).where(eq(treatmentPlan.id, id));
  } else {
    [{ id }] = await db.insert(treatmentPlan).values(values).returning({ id: treatmentPlan.id });
  }
  await db.delete(planItem).where(eq(planItem.planId, id!));
  const lines = (input.items ?? []).slice(0, 80).map((i, idx) => ({
    planId: id!,
    treatmentKey: i.treatmentKey || null,
    name: String(i.name ?? "").trim().slice(0, 120) || "รายการ",
    teeth: String(i.teeth ?? "").slice(0, 60),
    qty: Math.max(1, int(i.qty)),
    unitPrice: int(i.unitPrice),
    discount: int(i.discount),
    status: ["planned", "done", "cancelled"].includes(i.status) ? i.status : "planned",
    doneAt: i.doneAt ?? null,
    sort: idx,
  }));
  if (lines.length) await db.insert(planItem).values(lines);
  return id!;
}

/** the family signs the estimate on screen — it becomes accepted */
export async function signPlan(id: number, signature: string, signedBy: string): Promise<boolean> {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > 400_000) return false;
  await db
    .update(treatmentPlan)
    .set({ signature, signedBy: signedBy.trim().slice(0, 80), signedAt: new Date(), status: "accepted", updatedAt: new Date() })
    .where(and(eq(treatmentPlan.id, id), inArray(treatmentPlan.status, ["draft", "accepted"])));
  return true;
}

export async function removePlan(id: number): Promise<void> {
  await db.delete(treatmentPlan).where(eq(treatmentPlan.id, id));
}

/**
 * Send plan lines to the counter: a bill for today with those lines, which
 * are then marked done. For a contract, an instalment line instead.
 */
export async function billFromPlan(input: { planId: number; itemIds: number[]; instalment?: number }): Promise<number | null> {
  const p = (await db.select().from(treatmentPlan).where(eq(treatmentPlan.id, input.planId)))[0];
  if (!p) return null;
  const c = (await db.select().from(child).where(eq(child.id, p.childId)))[0];
  const g = c ? (await db.select().from(guardian).where(eq(guardian.id, c.guardianId)))[0] : undefined;
  if (!c) return null;
  const today = todayISO();
  const [bill] = await db
    .insert(invoice)
    .values({
      date: today,
      childId: c.id,
      patientName: c.name,
      phone: g?.phone ?? "",
      dentistId: p.dentistId,
      planId: p.kind === "contract" ? p.id : null,
    })
    .returning({ id: invoice.id });

  if (p.kind === "contract") {
    const amount = int(input.instalment);
    await db.insert(invoiceItem).values({
      invoiceId: bill.id,
      name: `ค่างวด ${p.title}`,
      qty: 1,
      unitPrice: amount,
      dentistId: p.dentistId,
    });
  } else {
    const items = await db
      .select()
      .from(planItem)
      .where(and(eq(planItem.planId, p.id), inArray(planItem.id, input.itemIds.length ? input.itemIds : [-1])));
    if (items.length) {
      await db.insert(invoiceItem).values(
        items.map((i, idx) => ({
          invoiceId: bill.id,
          treatmentKey: i.treatmentKey,
          name: i.name,
          teeth: i.teeth,
          qty: i.qty,
          unitPrice: i.unitPrice,
          discount: i.discount,
          dentistId: p.dentistId,
          sort: idx,
        })),
      );
      await db
        .update(planItem)
        .set({ status: "done", doneAt: today })
        .where(inArray(planItem.id, items.map((i) => i.id)));
    }
    if (p.status === "draft" || p.status === "accepted") {
      await db.update(treatmentPlan).set({ status: "in_progress", updatedAt: new Date() }).where(eq(treatmentPlan.id, p.id));
    }
  }
  const { refreshBill } = await import("@/server/billing");
  await refreshBill(bill.id);
  return bill.id;
}

/* ── deposits ──────────────────────────────────────────────────────────── */

/** take a deposit: a receipt for it, and the money kept on the patient's account */
export async function takeDeposit(input: { childId: number; amount: number; method: PayMethod; note?: string }): Promise<number | null> {
  const amount = int(input.amount);
  if (amount <= 0 || input.method === "credit") return null;
  const c = (await db.select().from(child).where(eq(child.id, input.childId)))[0];
  if (!c) return null;
  const g = (await db.select().from(guardian).where(eq(guardian.id, c.guardianId)))[0];
  const [bill] = await db
    .insert(invoice)
    .values({ date: todayISO(), kind: "deposit", childId: c.id, patientName: c.name, phone: g?.phone ?? "", note: input.note ?? "" })
    .returning({ id: invoice.id });
  await db.insert(invoiceItem).values({ invoiceId: bill.id, name: "รับเงินมัดจำ", qty: 1, unitPrice: amount });
  const r = await addPayment(bill.id, { method: input.method, amount });
  if (!r.ok) return null;
  await db.insert(patientCredit).values({ childId: c.id, amount, invoiceId: bill.id, note: "มัดจำ" });
  return bill.id;
}

export async function creditBalance(childId: number, q: Pick<typeof db, "select"> = db): Promise<number> {
  const rows = await q.select({ amount: patientCredit.amount }).from(patientCredit).where(eq(patientCredit.childId, childId));
  return rows.reduce((s, r) => s + r.amount, 0);
}

/* ── paperwork ─────────────────────────────────────────────────────────── */

export async function listDocs(childId: number): Promise<ClinicalDocRow[]> {
  const { toSlug } = await dentistMaps();
  const rows = await db.select().from(clinicalDoc).where(eq(clinicalDoc.childId, childId)).orderBy(desc(clinicalDoc.createdAt));
  return rows.map((d) => ({
    id: d.id,
    kind: d.kind as DocKind,
    date: d.date,
    dentistSlug: d.dentistId != null ? (toSlug.get(d.dentistId) ?? null) : null,
    data: (d.data ?? {}) as Record<string, unknown>,
    createdAt: d.createdAt.toISOString(),
  }));
}

export async function saveDoc(input: {
  id?: number | null;
  childId: number;
  kind: DocKind;
  date: string;
  dentistSlug: string | null;
  data: Record<string, unknown>;
}): Promise<number> {
  const { toId } = await dentistMaps();
  const values = {
    childId: input.childId,
    kind: ["prescription", "certificate", "referral", "consent", "pdpa"].includes(input.kind) ? input.kind : "certificate",
    date: /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : todayISO(),
    dentistId: input.dentistSlug ? (toId.get(input.dentistSlug) ?? null) : null,
    // the form's own fields (a signature image makes it larger)
    data: (() => {
      const json = JSON.stringify(input.data ?? {});
      return json.length <= 400_000 ? JSON.parse(json) : {};
    })(),
  };
  if (input.id) {
    await db.update(clinicalDoc).set(values).where(eq(clinicalDoc.id, input.id));
    return input.id;
  }
  const [row] = await db.insert(clinicalDoc).values(values).returning({ id: clinicalDoc.id });
  return row.id;
}

export async function removeDoc(id: number): Promise<void> {
  await db.delete(clinicalDoc).where(eq(clinicalDoc.id, id));
}

export async function listMedications(): Promise<Medication[]> {
  const rows = await db.select().from(medication).orderBy(asc(medication.name));
  return rows.map((m) => ({ id: m.id, name: m.name, strength: m.strength, unit: m.unit, sig: m.sig, isActive: m.isActive }));
}

export async function saveMedication(input: Omit<Medication, "id"> & { id?: number | null }): Promise<void> {
  const values = {
    name: String(input.name ?? "").trim().slice(0, 120),
    strength: String(input.strength ?? "").slice(0, 60),
    unit: String(input.unit ?? "").slice(0, 30),
    sig: String(input.sig ?? "").slice(0, 300),
    isActive: input.isActive !== false,
  };
  if (!values.name) return;
  if (input.id) await db.update(medication).set(values).where(eq(medication.id, input.id));
  else await db.insert(medication).values(values);
}

/* ── files ─────────────────────────────────────────────────────────────── */

const MAX_FILE = 3_000_000; // bytes after decoding

export async function listFiles(childId: number): Promise<FileMeta[]> {
  const rows = await db
    .select({
      id: patientFile.id,
      kind: patientFile.kind,
      name: patientFile.name,
      mime: patientFile.mime,
      size: patientFile.size,
      note: patientFile.note,
      createdAt: patientFile.createdAt,
    })
    .from(patientFile)
    .where(eq(patientFile.childId, childId))
    .orderBy(desc(patientFile.createdAt));
  return rows.map((f) => ({ ...f, kind: f.kind as FileMeta["kind"], createdAt: f.createdAt.toISOString() }));
}

export async function uploadFile(input: {
  childId: number;
  kind: FileMeta["kind"];
  name: string;
  mime: string;
  body: string;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(input.mime)) return { ok: false, error: "type" };
  const body = String(input.body ?? "").replace(/^data:[^,]*,/, "");
  const size = Math.floor((body.length * 3) / 4);
  if (size > MAX_FILE) return { ok: false, error: "size" };
  await db.insert(patientFile).values({
    childId: input.childId,
    kind: ["photo", "xray", "document"].includes(input.kind) ? input.kind : "photo",
    name: String(input.name ?? "ไฟล์").slice(0, 120),
    mime: input.mime,
    size,
    body,
    note: String(input.note ?? "").slice(0, 200),
  });
  return { ok: true };
}

export async function getFileBody(id: number): Promise<{ mime: string; body: string } | null> {
  const r = (await db.select({ mime: patientFile.mime, body: patientFile.body }).from(patientFile).where(eq(patientFile.id, id)))[0];
  return r ?? null;
}

export async function removeFile(id: number): Promise<void> {
  await db.delete(patientFile).where(eq(patientFile.id, id));
}

/* ── recalls ───────────────────────────────────────────────────────────── */

export async function listRecalls(filter: { childId?: number; until?: string; open?: boolean }): Promise<RecallRow[]> {
  const conds = [];
  if (filter.childId) conds.push(eq(recall.childId, filter.childId));
  if (filter.until) conds.push(sql`${recall.dueDate} <= ${filter.until}`);
  if (filter.open) conds.push(inArray(recall.status, ["due", "contacted"]));
  const rows = await db
    .select({ r: recall, c: child, g: guardian })
    .from(recall)
    .innerJoin(child, eq(child.id, recall.childId))
    .innerJoin(guardian, eq(guardian.id, child.guardianId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(recall.dueDate));
  const lineRows = await db
    .select({ phone: appointment.phone })
    .from(appointment)
    .where(isNotNull(appointment.lineUserId));
  const linePhones = new Set(lineRows.map((l) => digits(l.phone)));
  return rows.map(({ r, c, g }) => ({
    id: r.id,
    childId: c.id,
    patientName: c.name,
    guardianName: g.name,
    phone: g.phone,
    dueDate: r.dueDate,
    reason: r.reason,
    status: r.status as RecallStatus,
    contactNote: r.contactNote,
    contactedAt: r.contactedAt ? r.contactedAt.toISOString() : null,
    hasLine: !!g.lineUserId || linePhones.has(digits(g.phone)),
  }));
}

/** after a visit: the next check-up is due in the patient's recall interval */
export async function scheduleRecall(childId: number, fromDate: string): Promise<void> {
  const c = (await db.select({ months: child.recallMonths }).from(child).where(eq(child.id, childId)))[0];
  if (!c || c.months <= 0) return;
  const due = addDays(fromDate, Math.round(c.months * 30.4));
  // one open recall per patient — a new visit moves it
  await db
    .delete(recall)
    .where(and(eq(recall.childId, childId), inArray(recall.status, ["due", "contacted"])));
  await db.insert(recall).values({ childId, dueDate: due });
}

export async function scheduleRecallForAppointment(appointmentId: number): Promise<void> {
  const a = (await db.select({ date: appointment.date }).from(appointment).where(eq(appointment.id, appointmentId)))[0];
  if (!a) return;
  const childId = await childForAppointment(appointmentId);
  if (childId) await scheduleRecall(childId, a.date);
}

export async function setRecall(id: number, patch: { status?: RecallStatus; contactNote?: string; dueDate?: string }): Promise<void> {
  await db
    .update(recall)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.contactNote !== undefined ? { contactNote: patch.contactNote.slice(0, 300) } : {}),
      ...(patch.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate) ? { dueDate: patch.dueDate } : {}),
      ...(patch.status === "contacted" ? { contactedAt: new Date() } : {}),
    })
    .where(eq(recall.id, id));
}

/** the LINE account to remind: the guardian's, or one this phone booked with */
export async function lineTargetForChild(childId: number): Promise<string | null> {
  const c = (await db.select().from(child).where(eq(child.id, childId)))[0];
  if (!c) return null;
  const g = (await db.select().from(guardian).where(eq(guardian.id, c.guardianId)))[0];
  if (g?.lineUserId) return g.lineUserId;
  const d = digits(g?.phone ?? "");
  const rows = await db
    .select({ line: appointment.lineUserId, phone: appointment.phone })
    .from(appointment)
    .where(isNotNull(appointment.lineUserId))
    .orderBy(desc(appointment.createdAt));
  return rows.find((r) => digits(r.phone) === d)?.line ?? null;
}
