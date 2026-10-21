/**
 * Ironing - after stitching, before External QC.
 *
 * ---------------------------------------------------------------------------
 *  THREE SOURCES, THREE LANES
 *
 *    Stitching unit       stitched pieces from the unit named in From Unit
 *    Re-iron              sent back by External QC with reason "Iron"
 *    From Alteration Unit altered / cleaned, on their way to External QC again
 *
 *  Each lane has its own balance (received - ironed - damaged + re-ironed),
 *  so a piece is received once and ironed once per trip. Every piece ironed,
 *  whatever its lane, is offered to External QC next.
 *
 *  WHAT A WRITE DOES, IN ONE TRANSACTION
 *
 *    1. lock - a stitching-unit entry takes the unit's lock (the one stitching
 *       and printing take, unitFlow.service.js) and then the order's
 *       finishing lock; the other sources take only the finishing lock
 *    2. write the entry
 *    3. keep its bag in the Alteration Unit equal to the pieces it rejected
 *    4. for a stitching unit: re-share the unit's received pieces across its
 *       cutting challans and set each one Not received / Partially / Closed
 *    5. check the flows: received never more than stitched less out for
 *       printing (unit lane); re-iron and altered received never more than
 *       External QC and the Alteration Unit sent; ironed never cut below what
 *       External QC was offered; no lane ironed past what it received
 *
 *  A refusal at 5 rolls back 2-4.
 *
 *  Not unit-scoped by login: the ironing table takes pieces from every unit.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { istDate, istIsoDate } from '../utils/dates.js';
import { getManyByCode } from './masterList.service.js';
import { allocateReceipts, damageFraction, entryProblems, pctText, undecidedOf } from '../domain/ironing.js';
import { assertFlow, flowJson, lockUnitFlow, unitFlow } from './unitFlow.service.js';
import {
  assertFinishingFlow,
  finishingFlow,
  finishingJson,
  finishingSums,
  flowOf,
  lockFinishingFlow,
} from './finishingFlow.service.js';
import { syncBag } from './alteration.service.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const dateOnly = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00.000Z`);

export const SORTABLE = ['entryDate', 'source', 'fromUnit', 'pcsReceived', 'pcsIroned', 'pcsDamaged', 'createdAt'];

/** The reason every reject raised here carries into the Alteration Unit and the Rejected Register. */
export const REJECT_REASON = 'Ironing damage';

/** The Source dropdown, in the order the form offers it. */
export const SOURCES = [
  { value: 'STITCHING_UNIT', label: 'Stitching unit' },
  { value: 'RE_IRON', label: 'Re-iron (from External QC)' },
  { value: 'ALTERATION_UNIT', label: 'From Alteration Unit' },
];
export const sourceLabel = (s) => SOURCES.find((x) => x.value === s)?.label ?? s;

const QTYS = ['pcsReceived', 'pcsIroned', 'pcsDamaged', 'pcsReIroned', 'pcsRejected'];

const INCLUDE = {
  order: { select: { id: true, orderNo: true, buyer: { select: { id: true, buyerName: true } } } },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  ironer: { select: { id: true, empId: true, empName: true } },
  alterationReceipt: { select: { id: true, qty: true, pcsAltered: true, pcsNotRepairable: true, status: true, reason: true } },
};

function project(row) {
  const out = { ...row, sourceLabel: sourceLabel(row.source) };
  for (const k of QTYS) out[k] = D(row[k]).toString();
  out.pcsUndecided = undecidedOf({ damaged: row.pcsDamaged, reIroned: row.pcsReIroned, rejected: row.pcsRejected }).toString();
  if (row.alterationReceipt) {
    const b = row.alterationReceipt;
    out.alterationReceipt = { ...b, qty: D(b.qty).toString(), pcsAltered: D(b.pcsAltered).toString(), pcsNotRepairable: D(b.pcsNotRepairable).toString() };
  }
  return out;
}

function checkedDate(iso) {
  const today = istIsoDate();
  const day = iso ? String(iso).slice(0, 10) : today;
  if (day > today) {
    throw ApiError.badRequest(`${istDate(dateOnly(day))} has not happened yet`, { field: 'entryDate' });
  }
  return dateOnly(day);
}

const fromUnits = (source) => (source ?? 'STITCHING_UNIT') === 'STITCHING_UNIT';

// ===========================================================================
//  CONTEXT AND OPTIONS
// ===========================================================================

async function ironers(client) {
  return client.employee.findMany({
    where: { deletedAt: null, status: 'ACTIVE', designation: { equals: 'Ironer', mode: 'insensitive' } },
    orderBy: { empName: 'asc' },
    select: { id: true, empId: true, empName: true },
  });
}

/** Everything the ironing screen's dropdowns need, in one call. */
export async function context(auth) {
  const [lists, people] = await Promise.all([getManyByCode(['StitchingUnit', 'IroningDamage']), ironers(prisma)]);
  return {
    today: istIsoDate(),
    canWrite: Boolean(auth?.has?.('IRONING.CREATE')),
    sources: SOURCES,
    units: lists.StitchingUnit.map((v) => v.value),
    damageTypes: lists.IroningDamage.map((v) => v.value),
    ironers: people,
  };
}

/** The pieces a stitching unit has stitched, by order and style, and where they are now. */
async function unitOptions() {
  const where = { deletedAt: null };
  const [stitched, printed, ironing] = await Promise.all([
    prisma.stitchingRecord.groupBy({ by: ['unit', 'orderId', 'styleId'], where, _sum: { actualStitched: true } }),
    prisma.printing.groupBy({
      by: ['fromUnit', 'orderId', 'styleId'],
      where: { fabricStage: 'AFTER_STITCHING', deletedAt: null, status: { not: 'CANCELLED' }, fromUnit: { not: null } },
      _sum: { qty: true, qtyReceived: true },
    }),
    prisma.ironingEntry.groupBy({
      by: ['fromUnit', 'orderId', 'styleId'],
      where: { ...where, source: 'STITCHING_UNIT' },
      _sum: { pcsReceived: true, pcsIroned: true, pcsDamaged: true, pcsReIroned: true, pcsRejected: true },
    }),
  ]);
  const k = (unit, o, s) => `${o}:${s}:${unit}`;
  const printOf = new Map(printed.map((g) => [k(g.fromUnit, g.orderId, g.styleId), g._sum]));
  const ironOf = new Map(ironing.map((g) => [k(g.fromUnit, g.orderId, g.styleId), g._sum]));
  return stitched
    .filter((g) => D(g._sum.actualStitched).greaterThan(0))
    .map((g) => {
      const key = k(g.unit, g.orderId, g.styleId);
      const p = printOf.get(key) ?? {};
      const i = ironOf.get(key) ?? {};
      const out = D(p.qty).minus(D(p.qtyReceived));
      const received = D(i.pcsReceived);
      return {
        key,
        source: 'STITCHING_UNIT',
        orderId: g.orderId,
        styleId: g.styleId,
        unit: g.unit,
        pcsStitched: D(g._sum.actualStitched).toString(),
        pcsOutForPrinting: out.toString(),
        pcsReceivedAtIroning: received.toString(),
        pcsAvailableToReceive: D(g._sum.actualStitched).minus(out).minus(received).toString(),
        balance: received.minus(D(i.pcsIroned)).minus(D(i.pcsDamaged)).plus(D(i.pcsReIroned)).toString(),
        pcsUndecided: undecidedOf({ damaged: i.pcsDamaged, reIroned: i.pcsReIroned, rejected: i.pcsRejected }).toString(),
      };
    });
}

/** The pieces coming back - re-iron from External QC, altered from the Alteration Unit. */
async function returnOptions() {
  const sums = await finishingSums(prisma, {});
  const out = [];
  for (const s of sums.values()) {
    const f = flowOf(s);
    const lanes = [
      { source: 'RE_IRON', lane: s.lanes.RE_IRON, toReceive: f.reIronPending, sent: f.qcIron },
      { source: 'ALTERATION_UNIT', lane: s.lanes.ALTERATION_UNIT, toReceive: f.alteredPending, sent: f.altered },
    ];
    for (const { source, lane, toReceive, sent } of lanes) {
      if (sent.lessThanOrEqualTo(0) && lane.received.lessThanOrEqualTo(0)) continue;
      out.push({
        key: `${s.orderId}:${s.styleId}:${source}`,
        source,
        orderId: s.orderId,
        styleId: s.styleId,
        unit: null,
        pcsSentBack: sent.toString(),
        pcsReceivedAtIroning: lane.received.toString(),
        pcsAvailableToReceive: toReceive.toString(),
        balance: lane.received.minus(lane.ironed).minus(lane.damaged).plus(lane.reIroned).toString(),
        pcsUndecided: undecidedOf(lane).toString(),
      });
    }
  }
  return out;
}

/**
 * The Order dropdown: every (order, style, source) with pieces to receive or
 * to iron - unit by unit for stitched pieces, one line each for re-iron and
 * altered pieces.
 */
export async function orderOptions() {
  const live = [...(await unitOptions()), ...(await returnOptions())];
  if (!live.length) return [];

  const [orders, styles] = await Promise.all([
    prisma.buyerOrder.findMany({
      where: { id: { in: [...new Set(live.map((g) => g.orderId))] } },
      select: { id: true, orderNo: true, buyer: { select: { buyerName: true } } },
    }),
    prisma.style.findMany({ where: { id: { in: [...new Set(live.map((g) => g.styleId))] } }, select: { id: true, styleNo: true } }),
  ]);
  const order = new Map(orders.map((o) => [o.id, o]));
  const style = new Map(styles.map((s) => [s.id, s]));
  const rank = { STITCHING_UNIT: 0, RE_IRON: 1, ALTERATION_UNIT: 2 };

  return live
    .filter((g) => order.has(g.orderId))
    .map((g) => ({
      ...g,
      sourceLabel: sourceLabel(g.source),
      orderNo: order.get(g.orderId).orderNo,
      buyerName: order.get(g.orderId).buyer?.buyerName ?? null,
      styleNo: style.get(g.styleId)?.styleNo ?? null,
    }))
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo)
      || String(a.styleNo).localeCompare(String(b.styleNo))
      || rank[a.source] - rank[b.source]
      || String(a.unit).localeCompare(String(b.unit)));
}

/**
 * The flow for one lane - a unit's (with the challans it closes), or the
 * re-iron / altered lane of an order and style - and the order's finishing
 * flow beside it.
 */
export async function position({ source = 'STITCHING_UNIT', unit, orderId, styleId }) {
  const finishing = finishingJson(await finishingFlow(prisma, { orderId, styleId }));
  if (!fromUnits(source)) {
    const sums = (await finishingSums(prisma, { orderId, styleId })).get(`${orderId}:${styleId}`);
    const lane = sums?.lanes[source] ?? { received: D(0), ironed: D(0), damaged: D(0), reIroned: D(0), rejected: D(0) };
    const f = sums ? flowOf(sums) : null;
    const toReceive = source === 'RE_IRON' ? f?.reIronPending : f?.alteredPending;
    return {
      source,
      unit: null,
      flow: flowJson({
        receivedAtIroning: lane.received,
        ironed: lane.ironed,
        damaged: lane.damaged,
        reIroned: lane.reIroned,
        rejected: lane.rejected,
        availableToReceive: toReceive ?? D(0),
        balance: lane.received.minus(lane.ironed).minus(lane.damaged).plus(lane.reIroned),
        undecided: undecidedOf(lane),
      }),
      finishing,
      challans: [],
    };
  }
  const [flow, challans] = await Promise.all([
    unitFlow(prisma, { unit, orderId, styleId }),
    prisma.cuttingIssue.findMany({
      where: { ...postedTo(unit), orderId, styleId },
      orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, challanNo: true, issueDate: true, cuttingPcsIssued: true, pcsReceivedAtIroning: true, ironingReceiptStatus: true },
    }),
  ]);
  return {
    source,
    unit,
    flow: flowJson(flow),
    finishing,
    challans: challans.map((c) => ({
      ...c,
      cuttingPcsIssued: D(c.cuttingPcsIssued).toString(),
      pcsReceivedAtIroning: D(c.pcsReceivedAtIroning).toString(),
    })),
  };
}

// ===========================================================================
//  THE REGISTER
// ===========================================================================

export async function list(query) {
  const { page, pageSize, skip, take, orderBy, search, includeDeleted } = query;
  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(query.source ? { source: query.source } : {}),
    ...(query.fromUnit ? { fromUnit: query.fromUnit } : {}),
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.styleId ? { styleId: query.styleId } : {}),
    ...(query.ironerId ? { ironerId: query.ironerId } : {}),
    ...(query.dateFrom || query.dateTo
      ? { entryDate: { ...(query.dateFrom ? { gte: dateOnly(query.dateFrom) } : {}), ...(query.dateTo ? { lte: dateOnly(query.dateTo) } : {}) } }
      : {}),
    ...searchFilter(search, ['fromUnit', 'damageType', 'remarks', 'order.orderNo', 'style.styleNo', 'ironer.empName']),
  };

  // "Damage still to decide": damaged > re-ironed + rejected. Not expressible
  // as a Prisma filter on one row's columns, so read the ids first.
  if (query.undecidedOnly === 'true' || query.undecidedOnly === true) {
    const ids = await prisma.$queryRaw`
      SELECT id FROM ironing_entries
       WHERE deleted_at IS NULL AND pcs_damaged > pcs_re_ironed + pcs_rejected`;
    where.id = { in: ids.map((r) => r.id) };
  }

  const [rows, total, sums] = await Promise.all([
    prisma.ironingEntry.findMany({ where, orderBy: orderBy ?? { entryDate: 'desc' }, skip, take, include: INCLUDE }),
    prisma.ironingEntry.count({ where }),
    prisma.ironingEntry.aggregate({ where, _sum: Object.fromEntries(QTYS.map((q) => [q, true])) }),
  ]);
  const s = sums._sum;
  return {
    rows: rows.map(project),
    total,
    page,
    pageSize,
    totals: {
      ...Object.fromEntries(QTYS.map((q) => [q, D(s[q]).toString()])),
      pcsUndecided: undecidedOf({ damaged: s.pcsDamaged, reIroned: s.pcsReIroned, rejected: s.pcsRejected }).toString(),
      damagePct: pctText(damageFraction(s.pcsIroned, s.pcsDamaged)),
    },
  };
}

export async function getById(id) {
  const row = await prisma.ironingEntry.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!row) throw ApiError.notFound('Ironing entry');
  return {
    ...project(row),
    position: await position({ source: row.source, unit: row.fromUnit, orderId: row.orderId, styleId: row.styleId }),
  };
}

/**
 * Pieces rejected at ironing before Phase 4, and what became of them. Every
 * PENDING one was converted into a bag in the Alteration Unit (TRANSFERRED).
 */
export async function pendingRejects(query = {}) {
  const rows = await prisma.pendingReject.findMany({
    where: { ...(query.status ? { status: query.status } : {}), ...(query.orderId ? { orderId: query.orderId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      order: { select: { id: true, orderNo: true } },
      style: { select: { id: true, styleNo: true } },
      ironingEntry: { select: { id: true, entryDate: true } },
      alterationReceipt: { select: { id: true, status: true } },
    },
  });
  return rows.map((r) => ({ ...r, qty: D(r.qty).toString() }));
}

// ===========================================================================
//  WRITES
// ===========================================================================

const postedTo = (unit) => ({ firmName: unit, deletedAt: null, status: { not: 'CANCELLED' }, postedAt: { not: null } });

/**
 * Re-shares what the unit has sent to ironing across its cutting challans,
 * oldest first, and writes the challans whose share or status changed.
 * Derived from the live entries every time - never incremented.
 */
async function recomputeChallans(tx, { fromUnit: unit, orderId, styleId }, actorId) {
  const [challans, received] = await Promise.all([
    tx.cuttingIssue.findMany({
      where: { ...postedTo(unit), orderId, styleId },
      orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, cuttingPcsIssued: true, pcsReceivedAtIroning: true, ironingReceiptStatus: true },
    }),
    tx.ironingEntry.aggregate({ where: { fromUnit: unit, orderId, styleId, deletedAt: null }, _sum: { pcsReceived: true } }),
  ]);
  const shares = allocateReceipts(
    challans.map((c) => ({ id: c.id, pcsIssued: c.cuttingPcsIssued })),
    received._sum.pcsReceived,
  );
  for (const [i, share] of shares.entries()) {
    const c = challans[i];
    if (D(c.pcsReceivedAtIroning).equals(share.received) && c.ironingReceiptStatus === share.status) continue;
    await tx.cuttingIssue.update({
      where: { id: c.id },
      data: { pcsReceivedAtIroning: share.received, ironingReceiptStatus: share.status, updatedById: actorId },
    });
  }
}

/**
 * Keeps the entry's bag in the Alteration Unit equal to the pieces it
 * rejected. Refused if the Alteration Unit has already worked more of the
 * bag than the correction would leave in it.
 */
async function syncAlterationBag(tx, entry, actorId) {
  const existing = await tx.alterationReceipt.findUnique({ where: { ironingEntryId: entry.id } });
  await syncBag(tx, {
    existing,
    qty: entry.deletedAt ? D(0) : D(entry.pcsRejected),
    create: {
      source: 'IRONING',
      ironingEntryId: entry.id,
      orderId: entry.orderId,
      styleId: entry.styleId,
      reason: REJECT_REASON,
    },
    refresh: { receivedDate: entry.entryDate, defectType: entry.damageType, unit: entry.fromUnit },
    what: 'ironing damage from this entry',
    actorId,
  });
}

function assertEntry(e) {
  const problems = entryProblems(e);
  if (problems.length) {
    throw ApiError.badRequest(problems.map((p) => p.message).join('. '), { field: problems[0].field, problems });
  }
}

async function resolveRefs(tx, input) {
  const [order, style, units] = await Promise.all([
    tx.buyerOrder.findFirst({ where: { id: input.orderId, deletedAt: null }, select: { id: true, orderNo: true } }),
    tx.style.findFirst({ where: { id: input.styleId, deletedAt: null }, select: { id: true, styleNo: true } }),
    fromUnits(input.source) ? getManyByCode(['StitchingUnit']) : null,
  ]);
  if (!order) throw ApiError.badRequest('That order does not exist', { field: 'orderId' });
  if (!style) throw ApiError.badRequest('That style does not exist', { field: 'styleId' });
  if (units && !units.StitchingUnit.some((v) => v.value === input.fromUnit)) {
    throw ApiError.badRequest(`"${input.fromUnit}" is not a stitching unit`, { field: 'fromUnit' });
  }
  return { label: `${order.orderNo} / ${style.styleNo}` };
}

async function assertIroner(tx, ironerId, { keeping } = {}) {
  if (!ironerId || ironerId === keeping) return;
  const emp = await tx.employee.findFirst({
    where: { id: ironerId, deletedAt: null },
    select: { empName: true, designation: true, status: true },
  });
  if (!emp) throw ApiError.badRequest('That employee does not exist', { field: 'ironerId' });
  if (emp.designation?.toLowerCase() !== 'ironer' || emp.status !== 'ACTIVE') {
    throw ApiError.badRequest(`${emp.empName} is not an active ironer`, { field: 'ironerId' });
  }
}

async function assertDamageType(value) {
  if (!value) return;
  const lists = await getManyByCode(['IroningDamage'], { includeInactive: false });
  if (!lists.IroningDamage.some((v) => v.value === value)) {
    throw ApiError.badRequest(`"${value}" is not an ironing damage type`, { field: 'damageType' });
  }
}

/** Unit lock (stitching-unit lane only), then the order's finishing lock. Never the other way. */
async function lockFor(tx, e) {
  if (fromUnits(e.source)) await lockUnitFlow(tx, e.fromUnit, e.orderId, e.styleId);
  await lockFinishingFlow(tx, e.orderId, e.styleId);
}

/** Every check a write must leave true, for the lane it wrote and the order. */
async function assertAll(tx, row, label) {
  if (fromUnits(row.source)) {
    await recomputeChallans(tx, row, row.updatedById);
    await assertFlow(tx, { unit: row.fromUnit, orderId: row.orderId, styleId: row.styleId }, label);
  }
  await assertFinishingFlow(tx, { orderId: row.orderId, styleId: row.styleId }, label);
}

export async function create(auth, input) {
  const entryDate = checkedDate(input.entryDate);
  const source = input.source ?? 'STITCHING_UNIT';
  if (fromUnits(source) && !input.fromUnit) {
    throw ApiError.badRequest('Choose the unit the pieces came from', { field: 'fromUnit' });
  }
  const data = {
    entryDate,
    source,
    orderId: input.orderId,
    styleId: input.styleId,
    // Pieces coming back from External QC or the Alteration Unit come from
    // no stitching unit, and are never sent to one.
    fromUnit: fromUnits(source) ? input.fromUnit : null,
    ironerId: input.ironerId ?? null,
    ...Object.fromEntries(QTYS.map((q) => [q, D(input[q])])),
    damageType: D(input.pcsDamaged).greaterThan(0) ? input.damageType ?? null : null,
    remarks: input.remarks ?? null,
  };
  assertEntry(data);
  await assertDamageType(data.damageType);

  return prisma.$transaction(async (tx) => {
    await lockFor(tx, data);
    const { label } = await resolveRefs(tx, data);
    await assertIroner(tx, data.ironerId);

    const row = await tx.ironingEntry.create({
      data: { ...data, recordedById: auth.userId, recordedByName: auth.fullName, createdById: auth.userId, updatedById: auth.userId },
    });
    await syncAlterationBag(tx, row, auth.userId);
    await assertAll(tx, row, label);

    return project(await tx.ironingEntry.findUnique({ where: { id: row.id }, include: INCLUDE }));
  });
}

/**
 * Counts, damage decisions, ironer, date and remarks. The source, unit, order
 * and style are what the entry IS; a different one is a different entry.
 */
export async function update(auth, id, input) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.ironingEntry.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw ApiError.notFound('Ironing entry');
    await lockFor(tx, existing);
    const { label } = await resolveRefs(tx, existing);

    const merged = { ...existing };
    for (const q of QTYS) if (input[q] !== undefined) merged[q] = D(input[q]);
    if (input.ironerId !== undefined) merged.ironerId = input.ironerId;
    if (input.damageType !== undefined) merged.damageType = input.damageType;
    if (D(merged.pcsDamaged).lessThanOrEqualTo(0)) merged.damageType = null;
    assertEntry(merged);
    await assertDamageType(input.damageType !== undefined ? merged.damageType : null);
    await assertIroner(tx, merged.ironerId, { keeping: existing.ironerId });

    const row = await tx.ironingEntry.update({
      where: { id },
      data: {
        ...(input.entryDate ? { entryDate: checkedDate(input.entryDate) } : {}),
        ...Object.fromEntries(QTYS.map((q) => [q, merged[q]])),
        ironerId: merged.ironerId,
        damageType: merged.damageType,
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        updatedById: auth.userId,
      },
    });
    await syncAlterationBag(tx, row, auth.userId);
    await assertAll(tx, row, label);

    return project(await tx.ironingEntry.findUnique({ where: { id }, include: INCLUDE }));
  });
}

export async function remove(auth, id) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.ironingEntry.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw ApiError.notFound('Ironing entry');
    await lockFor(tx, existing);
    const { label } = await resolveRefs(tx, existing);

    const row = await tx.ironingEntry.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: auth.userId, updatedById: auth.userId },
    });
    await syncAlterationBag(tx, row, auth.userId);
    // Deleting a delivery whose pieces were ironed afterwards would leave
    // more ironed than received; deleting ironing that External QC has since
    // been offered would leave more offered than ironed - refused, like any
    // other write.
    await assertAll(tx, row, label);
    return { id, deleted: true };
  });
}
