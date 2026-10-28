/**
 * External QC - the secondary check by an external agency, after ironing.
 *
 * ---------------------------------------------------------------------------
 *  WHAT A WRITE DOES, IN ONE TRANSACTION
 *
 *    1. lock the order and style (finishingFlow.service.js)
 *    2. write the entry - offered, the three boxes, each faulty box by reason
 *    3. write its checker codes and its inspection report grid
 *    4. keep its bags in the Alteration Unit equal to every box and reason but
 *       Iron (alteration.service.js syncBag) - Iron goes back to ironing as
 *       Re-iron and is received there, not bagged
 *    5. check the flow: offered never more than the order's net ironed qty;
 *       Iron never less than ironing has already taken back to re-iron
 *
 *  A refusal at any step rolls the rest back. The arithmetic of one entry is
 *  in domain/finishing.js and is also held by CHECK constraints.
 *
 *  Nothing here sends a piece to a stitching unit, and nothing can: a bag has
 *  no stitching unit to go to, and ironing's Re-iron lane names none.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { istDate, istIsoDate } from '../utils/dates.js';
import { QC_BOXES, QC_REASONS, REASON_FIELDS, bagsOf, ironOf, pctText, qcProblems, shareOf } from '../domain/finishing.js';
import { assertFinishingFlow, finishingFlow, finishingJson, finishingSums, flowOf, lockFinishingFlow } from './finishingFlow.service.js';
import { projectBag, syncBag } from './alteration.service.js';
import { assertUploadable } from './attachment.service.js';
import { listValues } from './productionRegister.service.js';
import { checkInspection, inspectionTotals } from '../domain/quality.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const dateOnly = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00.000Z`);

export const SORTABLE = ['entryDate', 'pcsOffered', 'pcsApproved', 'pcsAlteration', 'pcsRejected', 'createdAt'];

/** The vendor category an agency must be in. */
export const AGENCY_CATEGORY = 'External QC';

/** What an inspection report may be: a photo or a PDF. */
const REPORT_FILES = { only: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'], kinds: 'a PDF or a photo (JPEG, PNG or WebP)' };

const QTYS = ['pcsOffered', 'pcsApproved', 'pcsAlteration', 'pcsRejected', ...REASON_FIELDS];

const ATTACHMENT_SELECT = { id: true, fileName: true, mimeType: true, sizeBytes: true, uploadedByName: true, createdAt: true };

const INCLUDE = {
  order: { select: { id: true, orderNo: true, buyer: { select: { id: true, buyerName: true } } } },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  agency: { select: { id: true, vendorName: true, vendorCode: true } },
  checkers: { orderBy: { checkerCode: 'asc' }, include: { employee: { select: { id: true, empId: true, empName: true } } } },
  inspectionLines: { orderBy: { lineNo: 'asc' } },
};

function project(row) {
  const out = { ...row };
  for (const k of QTYS) out[k] = D(row[k]).toString();
  out.pcsIron = ironOf(row).toString();
  out.pcsToAlterationUnit = D(row.pcsAlteration).plus(D(row.pcsRejected)).minus(ironOf(row)).toString();
  out.approvedPct = pctText(shareOf(row.pcsApproved, row.pcsOffered));
  out.alterationPct = pctText(shareOf(row.pcsAlteration, row.pcsOffered));
  out.rejectedPct = pctText(shareOf(row.pcsRejected, row.pcsOffered));
  if (row.checkers) out.checkers = row.checkers.map((c) => ({ ...c, pcs: D(c.pcs).toString() }));
  if (row.inspectionLines) {
    // The inspection report's totals block, over the pieces offered.
    const { lines: _lines, ...totals } = inspectionTotals(row.pcsOffered, row.inspectionLines);
    out.inspection = row.inspectionLines.length ? totals : null;
  }
  return out;
}

function checkedDate(iso) {
  const today = istIsoDate();
  const day = iso ? String(iso).slice(0, 10) : today;
  if (day > today) throw ApiError.badRequest(`${istDate(dateOnly(day))} has not happened yet`, { field: 'entryDate' });
  return dateOnly(day);
}

function assertEntry(e) {
  const problems = qcProblems(e);
  if (problems.length) {
    throw ApiError.badRequest(problems.map((p) => p.message).join('. '), { field: problems[0].field, problems });
  }
}

/** Trimmed, upper-cased, blanks dropped; a code given twice is refused. */
function normaliseCheckers(lines = []) {
  const out = [];
  const seen = new Set();
  for (const l of lines) {
    const code = String(l.checkerCode ?? '').trim().toUpperCase();
    if (!code && D(l.pcs).isZero()) continue;
    if (!code) throw ApiError.badRequest('Give the checker code for every line with pieces', { field: 'checkers' });
    if (D(l.pcs).lessThanOrEqualTo(0)) throw ApiError.badRequest(`Enter the pieces traced to ${code}`, { field: 'checkers' });
    if (seen.has(code)) throw ApiError.badRequest(`Checker code ${code} is given twice`, { field: 'checkers' });
    seen.add(code);
    out.push({ checkerCode: code, pcs: D(l.pcs) });
  }
  return out;
}

/**
 * The inspection grid as sent: a line with nothing on it is dropped, so the
 * screen can post all 26 particulars and only what was found is kept.
 */
function normaliseInspection(lines = []) {
  return lines
    .map((l) => ({
      particular: String(l.particular ?? '').trim(),
      critical: Number(l.critical ?? 0),
      major: Number(l.major ?? 0),
      minor: Number(l.minor ?? 0),
      remark: l.remark?.trim() || null,
    }))
    .filter((l) => l.critical || l.major || l.minor || l.remark);
}

/**
 * Every particular a value of L_InspDefect26 - or already on the entry, so a
 * line keeps a particular the list has since withdrawn - and the defects no
 * more than the pieces offered.
 */
async function assertInspection(tx, lines, pcsOffered, kept = []) {
  if (!lines.length) return;
  const allowed = await listValues(tx, 'InspDefect26');
  const keep = new Set(kept.map((l) => l.particular));
  for (const l of lines) {
    if (!allowed.has(l.particular) && !keep.has(l.particular)) {
      throw ApiError.badRequest(`"${l.particular}" is not one of the inspection defects (L_InspDefect26)`, { field: 'inspectionLines' });
    }
  }
  const rule = checkInspection(Number(pcsOffered), lines);
  if (rule) throw ApiError.badRequest(rule.message, { field: rule.field });
}

/** Replaces the inspection grid row by row, so the audit trail sees each change. */
async function writeInspection(tx, entryId, lines, actorId) {
  const existing = await tx.externalQcInspectionLine.findMany({ where: { entryId } });
  for (const row of existing) await tx.externalQcInspectionLine.delete({ where: { id: row.id } });
  const { lines: worked } = inspectionTotals(0, lines);
  for (const [i, l] of worked.entries()) {
    await tx.externalQcInspectionLine.create({
      data: {
        entryId,
        lineNo: i + 1,
        particular: l.particular,
        critical: l.critical,
        major: l.major,
        minor: l.minor,
        total: l.total,
        remark: l.remark,
        createdById: actorId,
      },
    });
  }
}

// ===========================================================================
//  CONTEXT AND OPTIONS
// ===========================================================================

async function agencies(client) {
  return client.vendor.findMany({
    where: { deletedAt: null, status: 'ACTIVE', category: { equals: AGENCY_CATEGORY, mode: 'insensitive' } },
    orderBy: { vendorName: 'asc' },
    select: { id: true, vendorCode: true, vendorName: true },
  });
}

async function checkers(client) {
  return client.employee.findMany({
    where: { deletedAt: null, status: 'ACTIVE', designation: { equals: 'Checker', mode: 'insensitive' } },
    orderBy: { empId: 'asc' },
    select: { id: true, empId: true, empName: true },
  });
}

/** Every dropdown the screen needs, in one call. */
export async function context(auth) {
  const [a, c] = await Promise.all([agencies(prisma), checkers(prisma)]);
  return {
    today: istIsoDate(),
    canWrite: Boolean(auth?.has?.('EXTERNAL_QC.CREATE')),
    agencies: a,
    checkers: c,
    reasons: QC_REASONS.map((r) => r.key),
    boxes: QC_BOXES.map(({ box, label }) => ({ box, label })),
  };
}

/** The Order dropdown: every order and style ironing has pressed, with what is waiting. */
export async function orderOptions() {
  const sums = await finishingSums(prisma, {});
  const flows = [...sums.values()].map((s) => ({ ...s, flow: flowOf(s) })).filter((s) => s.flow.ironed.greaterThan(0));
  if (!flows.length) return [];
  const [orders, styles] = await Promise.all([
    prisma.buyerOrder.findMany({
      where: { id: { in: [...new Set(flows.map((f) => f.orderId))] }, deletedAt: null },
      select: { id: true, orderNo: true, buyer: { select: { buyerName: true, buyerCode: true } } },
    }),
    prisma.style.findMany({ where: { id: { in: [...new Set(flows.map((f) => f.styleId))] } }, select: { id: true, styleNo: true } }),
  ]);
  const order = new Map(orders.map((o) => [o.id, o]));
  const style = new Map(styles.map((s) => [s.id, s]));
  return flows
    .filter((f) => order.has(f.orderId))
    .map((f) => ({
      key: `${f.orderId}:${f.styleId}`,
      orderId: f.orderId,
      orderNo: order.get(f.orderId).orderNo,
      buyerName: order.get(f.orderId).buyer?.buyerName ?? null,
      buyerCode: order.get(f.orderId).buyer?.buyerCode ?? null,
      styleId: f.styleId,
      styleNo: style.get(f.styleId)?.styleNo ?? null,
      pcsIroned: f.flow.ironed.toString(),
      pcsOffered: f.flow.offered.toString(),
      pcsAvailable: f.flow.waitingForQc.toString(),
    }))
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo) || String(a.styleNo).localeCompare(String(b.styleNo)));
}

/** The order and style's flow: net ironed available, and where the rest is. */
export async function position({ orderId, styleId }) {
  return { flow: finishingJson(await finishingFlow(prisma, { orderId, styleId })) };
}

// ===========================================================================
//  THE REGISTER
// ===========================================================================

export async function list(query) {
  const { page, pageSize, skip, take, orderBy, search, includeDeleted } = query;
  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.styleId ? { styleId: query.styleId } : {}),
    ...(query.agencyId ? { agencyId: query.agencyId } : {}),
    ...(query.checkerCode ? { checkers: { some: { checkerCode: String(query.checkerCode).trim().toUpperCase() } } } : {}),
    ...(query.dateFrom || query.dateTo
      ? { entryDate: { ...(query.dateFrom ? { gte: dateOnly(query.dateFrom) } : {}), ...(query.dateTo ? { lte: dateOnly(query.dateTo) } : {}) } }
      : {}),
    ...searchFilter(search, ['inspectorName', 'remarks', 'order.orderNo', 'style.styleNo', 'agency.vendorName']),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.externalQcEntry.findMany({ where, orderBy: orderBy ?? { entryDate: 'desc' }, skip, take, include: INCLUDE }),
    prisma.externalQcEntry.count({ where }),
    prisma.externalQcEntry.aggregate({ where, _sum: Object.fromEntries(QTYS.map((q) => [q, true])) }),
  ]);
  const s = sums._sum;
  return {
    rows: rows.map(project),
    total,
    page,
    pageSize,
    totals: {
      pcsOffered: D(s.pcsOffered).toString(),
      pcsApproved: D(s.pcsApproved).toString(),
      pcsAlteration: D(s.pcsAlteration).toString(),
      pcsRejected: D(s.pcsRejected).toString(),
      pcsIron: ironOf(s).toString(),
      approvedPct: pctText(shareOf(s.pcsApproved, s.pcsOffered)),
      alterationPct: pctText(shareOf(s.pcsAlteration, s.pcsOffered)),
      rejectedPct: pctText(shareOf(s.pcsRejected, s.pcsOffered)),
    },
  };
}

export async function getById(id) {
  const row = await prisma.externalQcEntry.findFirst({
    where: { id, deletedAt: null },
    include: {
      ...INCLUDE,
      attachments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, select: ATTACHMENT_SELECT },
      bags: { orderBy: [{ box: 'asc' }, { reason: 'asc' }] },
    },
  });
  if (!row) throw ApiError.notFound('External QC entry');
  return {
    ...project(row),
    bags: row.bags.filter((b) => b.status !== 'CANCELLED').map(projectBag),
    position: await position(row),
  };
}

// ===========================================================================
//  WRITES
// ===========================================================================

async function resolveRefs(tx, { orderId, styleId }) {
  const [order, style] = await Promise.all([
    tx.buyerOrder.findFirst({ where: { id: orderId, deletedAt: null }, select: { orderNo: true } }),
    tx.style.findFirst({ where: { id: styleId, deletedAt: null }, select: { styleNo: true } }),
  ]);
  if (!order) throw ApiError.badRequest('That order does not exist', { field: 'orderId' });
  if (!style) throw ApiError.badRequest('That style does not exist', { field: 'styleId' });
  return `${order.orderNo} / ${style.styleNo}`;
}

async function assertAgency(tx, agencyId, { keeping } = {}) {
  if (agencyId === keeping) return;
  const v = await tx.vendor.findFirst({ where: { id: agencyId, deletedAt: null }, select: { vendorName: true, category: true, status: true } });
  if (!v) throw ApiError.badRequest('That agency does not exist', { field: 'agencyId' });
  if (v.category?.toLowerCase() !== AGENCY_CATEGORY.toLowerCase() || v.status !== 'ACTIVE') {
    throw ApiError.badRequest(`${v.vendorName} is not an active External QC agency on the Vendor Master`, { field: 'agencyId' });
  }
}

/** Replaces the entry's checker lines row by row, so the audit trail sees each change. */
async function writeCheckers(tx, entryId, lines, actorId) {
  const [existing, employees] = await Promise.all([
    tx.externalQcCheckerLine.findMany({ where: { entryId } }),
    lines.length
      ? tx.employee.findMany({
        where: { deletedAt: null, OR: lines.map((l) => ({ empId: { equals: l.checkerCode, mode: 'insensitive' } })) },
        select: { id: true, empId: true },
      })
      : [],
  ]);
  const employeeOf = new Map(employees.map((e) => [e.empId.toUpperCase(), e.id]));
  const want = new Map(lines.map((l) => [l.checkerCode, l]));

  for (const row of existing) {
    if (!want.has(row.checkerCode)) await tx.externalQcCheckerLine.delete({ where: { id: row.id } });
  }
  for (const l of lines) {
    const row = existing.find((r) => r.checkerCode === l.checkerCode);
    const employeeId = employeeOf.get(l.checkerCode) ?? null;
    if (row) {
      if (!D(row.pcs).equals(l.pcs) || row.employeeId !== employeeId) {
        await tx.externalQcCheckerLine.update({ where: { id: row.id }, data: { pcs: l.pcs, employeeId, updatedById: actorId } });
      }
    } else {
      await tx.externalQcCheckerLine.create({
        data: { entryId, checkerCode: l.checkerCode, pcs: l.pcs, employeeId, createdById: actorId, updatedById: actorId },
      });
    }
  }
}

/** One bag per box and reason but Iron, kept equal to the entry. */
async function syncBags(tx, entry, actorId) {
  const existing = await tx.alterationReceipt.findMany({ where: { externalQcEntryId: entry.id } });
  const byKey = new Map(existing.map((b) => [`${b.box}:${b.reason}`, b]));
  for (const want of bagsOf(entry)) {
    const label = QC_BOXES.find((b) => b.box === want.box).label;
    await syncBag(tx, {
      existing: byKey.get(`${want.box}:${want.reason}`) ?? null,
      qty: entry.deletedAt ? D(0) : want.qty,
      create: {
        source: 'EXTERNAL_QC',
        externalQcEntryId: entry.id,
        box: want.box,
        reason: want.reason,
        orderId: entry.orderId,
        styleId: entry.styleId,
      },
      refresh: { receivedDate: entry.entryDate },
      what: `the ${label} box, reason ${want.reason}`,
      actorId,
    });
  }
}

function dataOf(input) {
  const out = {};
  for (const q of QTYS) if (input[q] !== undefined) out[q] = D(input[q]);
  return out;
}

export async function create(auth, input) {
  const entryDate = checkedDate(input.entryDate);
  const checkerLines = normaliseCheckers(input.checkers);
  const inspectionLines = normaliseInspection(input.inspectionLines);
  const data = {
    entryDate,
    orderId: input.orderId,
    styleId: input.styleId,
    agencyId: input.agencyId,
    inspectorName: input.inspectorName ?? null,
    ...Object.fromEntries(QTYS.map((q) => [q, D(input[q])])),
    remarks: input.remarks ?? null,
  };
  assertEntry({ ...data, checkers: checkerLines });

  return prisma.$transaction(async (tx) => {
    await lockFinishingFlow(tx, data.orderId, data.styleId);
    const label = await resolveRefs(tx, data);
    await assertAgency(tx, data.agencyId);
    await assertInspection(tx, inspectionLines, data.pcsOffered);

    const row = await tx.externalQcEntry.create({
      data: { ...data, recordedById: auth.userId, recordedByName: auth.fullName, createdById: auth.userId, updatedById: auth.userId },
    });
    await writeCheckers(tx, row.id, checkerLines, auth.userId);
    await writeInspection(tx, row.id, inspectionLines, auth.userId);
    await syncBags(tx, row, auth.userId);
    await assertFinishingFlow(tx, row, label);

    return project(await tx.externalQcEntry.findUnique({ where: { id: row.id }, include: INCLUDE }));
  });
}

/** Everything but the order and style, which are what the entry IS. */
export async function update(auth, id, input) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.externalQcEntry.findFirst({
      where: { id, deletedAt: null },
      include: { checkers: true, inspectionLines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!existing) throw ApiError.notFound('External QC entry');
    await lockFinishingFlow(tx, existing.orderId, existing.styleId);
    const label = await resolveRefs(tx, existing);

    const checkerLines = input.checkers !== undefined
      ? normaliseCheckers(input.checkers)
      : existing.checkers.map((c) => ({ checkerCode: c.checkerCode, pcs: D(c.pcs) }));
    const merged = { ...existing, ...dataOf(input) };
    if (input.agencyId !== undefined) merged.agencyId = input.agencyId;
    assertEntry({ ...merged, checkers: checkerLines });
    await assertAgency(tx, merged.agencyId, { keeping: existing.agencyId });
    // A grid not sent is kept, and is still held to the pieces now offered.
    const inspectionLines = input.inspectionLines !== undefined
      ? normaliseInspection(input.inspectionLines)
      : existing.inspectionLines;
    await assertInspection(tx, inspectionLines, merged.pcsOffered, existing.inspectionLines);

    const row = await tx.externalQcEntry.update({
      where: { id },
      data: {
        ...(input.entryDate ? { entryDate: checkedDate(input.entryDate) } : {}),
        ...Object.fromEntries(QTYS.map((q) => [q, merged[q]])),
        agencyId: merged.agencyId,
        ...(input.inspectorName !== undefined ? { inspectorName: input.inspectorName } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        updatedById: auth.userId,
      },
    });
    if (input.checkers !== undefined) await writeCheckers(tx, id, checkerLines, auth.userId);
    if (input.inspectionLines !== undefined) await writeInspection(tx, id, inspectionLines, auth.userId);
    await syncBags(tx, row, auth.userId);
    await assertFinishingFlow(tx, row, label);

    return project(await tx.externalQcEntry.findUnique({ where: { id }, include: INCLUDE }));
  });
}

export async function remove(auth, id) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.externalQcEntry.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw ApiError.notFound('External QC entry');
    await lockFinishingFlow(tx, existing.orderId, existing.styleId);
    const label = await resolveRefs(tx, existing);

    const row = await tx.externalQcEntry.update({ where: { id }, data: { deletedAt: new Date(), deletedById: auth.userId } });
    // Refused if the Alteration Unit has worked a bag, or ironing has taken
    // back the Iron pieces - those have moved on and must be undone first.
    await syncBags(tx, row, auth.userId);
    await assertFinishingFlow(tx, row, label);
    return { id, deleted: true };
  });
}

// ===========================================================================
//  THE INSPECTION REPORT
// ===========================================================================

async function assertEntryExists(entryId) {
  const e = await prisma.externalQcEntry.findFirst({ where: { id: entryId, deletedAt: null }, select: { id: true } });
  if (!e) throw ApiError.notFound('External QC entry');
}

export async function listAttachments(entryId) {
  await assertEntryExists(entryId);
  return prisma.externalQcAttachment.findMany({
    where: { entryId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: ATTACHMENT_SELECT,
  });
}

/** The one read that pulls the bytes. */
export async function fetchAttachment(entryId, id) {
  const row = await prisma.externalQcAttachment.findFirst({
    where: { id, entryId, deletedAt: null },
    select: { fileName: true, mimeType: true, sizeBytes: true, data: true },
  });
  if (!row) throw ApiError.notFound('Inspection report');
  return row;
}

export async function addAttachment(entryId, file, actor) {
  await assertEntryExists(entryId);
  assertUploadable(file, REPORT_FILES);
  return prisma.externalQcAttachment.create({
    data: {
      entryId,
      fileName: file.originalname.slice(0, 255),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      data: file.buffer,
      uploadedById: actor?.id ?? null,
      uploadedByName: actor?.fullName ?? null,
    },
    select: ATTACHMENT_SELECT,
  });
}

export async function removeAttachment(entryId, id, actorId) {
  const row = await prisma.externalQcAttachment.findFirst({ where: { id, entryId, deletedAt: null }, select: { id: true } });
  if (!row) throw ApiError.notFound('Inspection report');
  await prisma.externalQcAttachment.update({ where: { id }, data: { deletedAt: new Date(), deletedById: actorId ?? null } });
  return { id };
}
