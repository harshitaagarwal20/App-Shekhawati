/**
 * The Alteration Unit - the separate in-house unit that repairs and cleans.
 *
 * ---------------------------------------------------------------------------
 *  BAGS IN, PIECES OUT
 *
 *  The unit's pending list is its bags (alteration_receipts). Nobody types a
 *  bag in: External QC and ironing keep them, through syncBag() below, equal
 *  to the pieces they sent -
 *
 *      External QC   one bag per box and reason other than Iron
 *      Ironing       one bag per entry: the pieces rejected at the table
 *                    (and every pending reject Phase 3 saved, converted)
 *
 *  An entry here works one bag on one day:
 *
 *      altered / cleaned   back to Ironing, source "From Alteration Unit", and
 *                          from there through External QC again
 *      not repairable      into the Rejected Register, stage Alteration Unit,
 *                          with the bag's original reason
 *
 *  and across a bag's entries, altered + not repairable never exceed the bag
 *  (held here and by a CHECK on the bag). Nothing goes to a stitching unit.
 *
 *  WHAT A WRITE DOES, IN ONE TRANSACTION
 *
 *    1. lock the order and style (finishingFlow.service.js)
 *    2. write the entry
 *    3. re-sum the bag's entries onto the bag and set its status
 *    4. keep the entry's Rejected Register row equal to its not-repairable
 *    5. check the flow: altered pieces already back at ironing cannot be
 *       taken away here
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { ageDays } from '../utils/figures.js';
import { istDate, istIsoDate } from '../utils/dates.js';
import { alterationProblems, bagBalance, bagStatus } from '../domain/finishing.js';
import { assertFinishingFlow, finishingFlow, finishingJson, lockFinishingFlow } from './finishingFlow.service.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const dateOnly = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00.000Z`);

export const SORTABLE = ['entryDate', 'pcsAltered', 'pcsNotRepairable', 'createdAt'];
export const BAG_SORTABLE = ['receivedDate', 'qty', 'reason', 'createdAt'];

/** The department whose active employees are the Alteration Staff dropdown. */
export const ALTERATION_DEPARTMENT = 'Alteration';

const BAG_INCLUDE = {
  order: { select: { id: true, orderNo: true, buyer: { select: { buyerName: true } } } },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  externalQcEntry: { select: { id: true, entryDate: true, agency: { select: { id: true, vendorName: true } } } },
  ironingEntry: { select: { id: true, entryDate: true, source: true, fromUnit: true } },
};

const INCLUDE = {
  order: { select: { id: true, orderNo: true, buyer: { select: { buyerName: true } } } },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  staff: { select: { id: true, empId: true, empName: true } },
  receipt: { include: BAG_INCLUDE },
  rejected: { select: { id: true, qty: true, reason: true, deletedAt: true } },
};

/** "External QC - Rejected box" / "Ironing (internal)" - where a bag came from, in words. */
export function bagOrigin(bag) {
  if (bag.source === 'EXTERNAL_QC') return `External QC - ${bag.box === 'REJECTED' ? 'Rejected' : 'Alteration'} box`;
  return 'Ironing (internal)';
}

export function projectBag(bag) {
  return {
    ...bag,
    qty: D(bag.qty).toString(),
    pcsAltered: D(bag.pcsAltered).toString(),
    pcsNotRepairable: D(bag.pcsNotRepairable).toString(),
    balance: bagBalance(bag).toString(),
    origin: bagOrigin(bag),
    ageDays: ageDays(bag.receivedDate),
  };
}

function project(row) {
  return {
    ...row,
    pcsAltered: D(row.pcsAltered).toString(),
    pcsNotRepairable: D(row.pcsNotRepairable).toString(),
    receipt: row.receipt ? projectBag(row.receipt) : null,
    rejected: row.rejected && !row.rejected.deletedAt ? { ...row.rejected, qty: D(row.rejected.qty).toString() } : null,
  };
}

function checkedDate(iso) {
  const today = istIsoDate();
  const day = iso ? String(iso).slice(0, 10) : today;
  if (day > today) throw ApiError.badRequest(`${istDate(dateOnly(day))} has not happened yet`, { field: 'entryDate' });
  return dateOnly(day);
}

function assertProblems(problems) {
  if (problems.length) {
    throw ApiError.badRequest(problems.map((p) => p.message).join('. '), { field: problems[0].field, problems });
  }
}

// ===========================================================================
//  BAGS - kept by External QC and ironing
// ===========================================================================

/**
 * Keeps one bag equal to the pieces its source sent.
 *
 * Created at the first piece, resized on a correction, and emptied (status
 * CANCELLED) when the source goes to zero. A bag cannot be made smaller than
 * the Alteration Unit has already worked out of it: those pieces are back at
 * ironing or in the Rejected Register, and the source would have to be
 * corrected after them.
 *
 * @param existing  the bag as it is now, or null
 * @param qty       what it should hold
 * @param create    the fields of a new bag (source, links, order, style, reason ...)
 * @param refresh   fields to keep current on an existing bag (receivedDate, defectType ...)
 * @param what      "the Alteration box, reason Defected" - for the message
 */
export async function syncBag(tx, { existing, qty, create, refresh = {}, what, actorId }) {
  const want = D(qty);
  if (existing) {
    const worked = D(existing.pcsAltered).plus(D(existing.pcsNotRepairable));
    if (want.lessThan(worked)) {
      throw ApiError.conflict(
        `The Alteration Unit has already worked ${worked} of the ${D(existing.qty)} pieces sent for ${what} `
          + `(${D(existing.pcsAltered)} altered, ${D(existing.pcsNotRepairable)} not repairable). It cannot be made `
          + `less than ${worked} here.`,
        { field: 'pcsAlteration' },
      );
    }
    const next = { ...existing, qty: want };
    if (D(existing.qty).equals(want) && existing.status === bagStatus(next)
      && Object.entries(refresh).every(([k, v]) => String(existing[k] ?? '') === String(v ?? ''))) {
      return existing;
    }
    return tx.alterationReceipt.update({
      where: { id: existing.id },
      data: { ...refresh, qty: want, status: bagStatus(next), updatedById: actorId },
    });
  }
  if (want.lessThanOrEqualTo(0)) return null;
  return tx.alterationReceipt.create({
    data: { ...create, ...refresh, qty: want, status: 'OPEN', createdById: actorId, updatedById: actorId },
  });
}

/** Re-sums a bag's live entries onto it. */
async function recomputeBag(tx, bagId, actorId) {
  const [bag, sums] = await Promise.all([
    tx.alterationReceipt.findUnique({ where: { id: bagId } }),
    tx.alterationEntry.aggregate({
      where: { receiptId: bagId, deletedAt: null },
      _sum: { pcsAltered: true, pcsNotRepairable: true },
    }),
  ]);
  const next = { ...bag, pcsAltered: D(sums._sum.pcsAltered), pcsNotRepairable: D(sums._sum.pcsNotRepairable) };
  if (bagBalance(next).lessThan(0)) {
    throw ApiError.conflict(
      `This bag holds ${D(bag.qty)} pieces. Altered (${next.pcsAltered}) and not repairable `
        + `(${next.pcsNotRepairable}) would be ${bagBalance(next).negated()} more than were received.`,
      { field: 'pcsAltered' },
    );
  }
  return tx.alterationReceipt.update({
    where: { id: bagId },
    data: { pcsAltered: next.pcsAltered, pcsNotRepairable: next.pcsNotRepairable, status: bagStatus(next), updatedById: actorId },
  });
}

/**
 * Keeps the entry's Rejected Register row equal to its not-repairable pieces:
 * created at the first, resized on a correction, removed (soft) at zero.
 */
async function syncRegister(tx, entry, bag, actorId) {
  const held = await tx.rejectedRegisterEntry.findUnique({ where: { alterationEntryId: entry.id } });
  const qty = entry.deletedAt ? D(0) : D(entry.pcsNotRepairable);

  if (qty.lessThanOrEqualTo(0)) {
    if (held && !held.deletedAt) {
      await tx.rejectedRegisterEntry.update({
        where: { id: held.id },
        data: { deletedAt: new Date(), deletedById: actorId, updatedById: actorId },
      });
    }
    return;
  }

  const data = {
    rejectDate: entry.entryDate,
    stage: 'ALTERATION_UNIT',
    orderId: entry.orderId,
    styleId: entry.styleId,
    unit: bag.unit,
    qty,
    reason: bag.reason,
    defectType: bag.defectType,
    origin: bag.source,
    notRepairableReason: entry.notRepairableReason,
    alterationReceiptId: bag.id,
    deletedAt: null,
    deletedById: null,
    updatedById: actorId,
  };
  if (held) await tx.rejectedRegisterEntry.update({ where: { id: held.id }, data });
  else await tx.rejectedRegisterEntry.create({ data: { ...data, alterationEntryId: entry.id, createdById: actorId } });
}

// ===========================================================================
//  CONTEXT, OPTIONS, THE PENDING LIST
// ===========================================================================

async function staff(client) {
  return client.employee.findMany({
    where: { deletedAt: null, status: 'ACTIVE', department: { equals: ALTERATION_DEPARTMENT, mode: 'insensitive' } },
    orderBy: { empName: 'asc' },
    select: { id: true, empId: true, empName: true, designation: true },
  });
}

export async function context(auth) {
  return {
    today: istIsoDate(),
    canWrite: Boolean(auth?.has?.('ALTERATION.CREATE')),
    staff: await staff(prisma),
    department: ALTERATION_DEPARTMENT,
  };
}

/** Orders and styles with bags still open, and how many pieces are waiting. */
export async function orderOptions() {
  const open = await prisma.alterationReceipt.groupBy({
    by: ['orderId', 'styleId'],
    where: { status: 'OPEN' },
    _sum: { qty: true, pcsAltered: true, pcsNotRepairable: true },
    _count: { _all: true },
    _min: { receivedDate: true },
  });
  if (!open.length) return [];
  const [orders, styles] = await Promise.all([
    prisma.buyerOrder.findMany({
      where: { id: { in: [...new Set(open.map((g) => g.orderId))] } },
      select: { id: true, orderNo: true, buyer: { select: { buyerName: true } } },
    }),
    prisma.style.findMany({ where: { id: { in: [...new Set(open.map((g) => g.styleId))] } }, select: { id: true, styleNo: true } }),
  ]);
  const order = new Map(orders.map((o) => [o.id, o]));
  const style = new Map(styles.map((s) => [s.id, s]));
  return open
    .filter((g) => order.has(g.orderId))
    .map((g) => ({
      key: `${g.orderId}:${g.styleId}`,
      orderId: g.orderId,
      orderNo: order.get(g.orderId).orderNo,
      buyerName: order.get(g.orderId).buyer?.buyerName ?? null,
      styleId: g.styleId,
      styleNo: style.get(g.styleId)?.styleNo ?? null,
      bags: g._count._all,
      pcsPending: D(g._sum.qty).minus(D(g._sum.pcsAltered)).minus(D(g._sum.pcsNotRepairable)).toString(),
      oldestReceived: g._min.receivedDate,
    }))
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo) || String(a.styleNo).localeCompare(String(b.styleNo)));
}

/** The pending list: bags, oldest first, each with its reason and balance. */
export async function bags(query = {}) {
  const { page = 1, pageSize = 100, skip = 0, take = 100, orderBy, search } = query;
  const where = {
    ...(query.status === 'ALL' ? {} : { status: query.status ?? 'OPEN' }),
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.styleId ? { styleId: query.styleId } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.reason ? { reason: query.reason } : {}),
    ...searchFilter(search, ['reason', 'defectType', 'unit', 'order.orderNo', 'style.styleNo']),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.alterationReceipt.findMany({
      where,
      orderBy: orderBy ?? [{ receivedDate: 'asc' }, { createdAt: 'asc' }],
      skip,
      take,
      include: BAG_INCLUDE,
    }),
    prisma.alterationReceipt.count({ where }),
    prisma.alterationReceipt.aggregate({ where, _sum: { qty: true, pcsAltered: true, pcsNotRepairable: true } }),
  ]);
  const s = sums._sum;
  return {
    rows: rows.map(projectBag),
    total,
    page,
    pageSize,
    totals: {
      qty: D(s.qty).toString(),
      pcsAltered: D(s.pcsAltered).toString(),
      pcsNotRepairable: D(s.pcsNotRepairable).toString(),
      balance: D(s.qty).minus(D(s.pcsAltered)).minus(D(s.pcsNotRepairable)).toString(),
    },
  };
}

export async function getBag(id) {
  const bag = await prisma.alterationReceipt.findUnique({
    where: { id },
    include: {
      ...BAG_INCLUDE,
      entries: { where: { deletedAt: null }, orderBy: { entryDate: 'asc' }, include: { staff: { select: { id: true, empId: true, empName: true } } } },
    },
  });
  if (!bag) throw ApiError.notFound('Alteration bag');
  return {
    ...projectBag(bag),
    entries: bag.entries.map((e) => ({ ...e, pcsAltered: D(e.pcsAltered).toString(), pcsNotRepairable: D(e.pcsNotRepairable).toString() })),
  };
}

/** The finishing flow of one order and style, for the form. */
export async function position({ orderId, styleId }) {
  return { flow: finishingJson(await finishingFlow(prisma, { orderId, styleId })) };
}

// ===========================================================================
//  THE REGISTER OF ENTRIES
// ===========================================================================

export async function list(query) {
  const { page, pageSize, skip, take, orderBy, search, includeDeleted } = query;
  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.styleId ? { styleId: query.styleId } : {}),
    ...(query.staffId ? { staffId: query.staffId } : {}),
    ...(query.receiptId ? { receiptId: query.receiptId } : {}),
    ...(query.dateFrom || query.dateTo
      ? { entryDate: { ...(query.dateFrom ? { gte: dateOnly(query.dateFrom) } : {}), ...(query.dateTo ? { lte: dateOnly(query.dateTo) } : {}) } }
      : {}),
    ...searchFilter(search, ['remarks', 'notRepairableReason', 'order.orderNo', 'style.styleNo', 'staff.empName', 'receipt.reason']),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.alterationEntry.findMany({ where, orderBy: orderBy ?? { entryDate: 'desc' }, skip, take, include: INCLUDE }),
    prisma.alterationEntry.count({ where }),
    prisma.alterationEntry.aggregate({ where, _sum: { pcsAltered: true, pcsNotRepairable: true } }),
  ]);
  return {
    rows: rows.map(project),
    total,
    page,
    pageSize,
    totals: {
      pcsAltered: D(sums._sum.pcsAltered).toString(),
      pcsNotRepairable: D(sums._sum.pcsNotRepairable).toString(),
    },
  };
}

export async function getById(id) {
  const row = await prisma.alterationEntry.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!row) throw ApiError.notFound('Alteration entry');
  return { ...project(row), position: await position(row) };
}

// ===========================================================================
//  WRITES
// ===========================================================================

async function assertStaff(tx, staffId, { keeping } = {}) {
  if (!staffId || staffId === keeping) return;
  const emp = await tx.employee.findFirst({
    where: { id: staffId, deletedAt: null },
    select: { empName: true, department: true, status: true },
  });
  if (!emp) throw ApiError.badRequest('That employee does not exist', { field: 'staffId' });
  if (emp.department?.toLowerCase() !== ALTERATION_DEPARTMENT.toLowerCase() || emp.status !== 'ACTIVE') {
    throw ApiError.badRequest(`${emp.empName} is not active staff of the Alteration department`, { field: 'staffId' });
  }
}

async function labelOf(tx, orderId, styleId) {
  const [order, style] = await Promise.all([
    tx.buyerOrder.findUnique({ where: { id: orderId }, select: { orderNo: true } }),
    tx.style.findUnique({ where: { id: styleId }, select: { styleNo: true } }),
  ]);
  return `${order?.orderNo ?? '?'} / ${style?.styleNo ?? '?'}`;
}

function assertNotBeforeBag(entryDate, bag) {
  if (entryDate < bag.receivedDate) {
    throw ApiError.badRequest(
      `This bag reached the Alteration Unit on ${istDate(bag.receivedDate)} - it cannot have been worked before that.`,
      { field: 'entryDate' },
    );
  }
}

/**
 * One save of the form: one entry per bag worked, all on one order and style.
 *
 * @param input { entryDate, staffId, remarks, lines: [{ receiptId, pcsAltered, pcsNotRepairable, notRepairableReason }] }
 */
export async function create(auth, input) {
  const entryDate = checkedDate(input.entryDate);
  const lines = (input.lines ?? []).filter((l) => D(l.pcsAltered).plus(D(l.pcsNotRepairable)).greaterThan(0));
  if (!lines.length) throw ApiError.badRequest('Enter the pieces altered or not repairable for at least one bag', { field: 'lines' });
  if (new Set(lines.map((l) => l.receiptId)).size !== lines.length) {
    throw ApiError.badRequest('Each bag can appear once in a save', { field: 'lines' });
  }
  for (const l of lines) assertProblems(alterationProblems({ ...l, staffId: input.staffId }));

  const first = await prisma.alterationReceipt.findUnique({ where: { id: lines[0].receiptId }, select: { orderId: true, styleId: true } });
  if (!first) throw ApiError.badRequest('That bag does not exist', { field: 'lines' });

  return prisma.$transaction(async (tx) => {
    await lockFinishingFlow(tx, first.orderId, first.styleId);
    await assertStaff(tx, input.staffId);
    const label = await labelOf(tx, first.orderId, first.styleId);

    const ids = [];
    for (const l of lines) {
      const bag = await tx.alterationReceipt.findUnique({ where: { id: l.receiptId } });
      if (!bag) throw ApiError.badRequest('That bag does not exist', { field: 'lines' });
      if (bag.orderId !== first.orderId || bag.styleId !== first.styleId) {
        throw ApiError.badRequest('Every bag in one save must be of the same order and style', { field: 'lines' });
      }
      if (bag.status === 'CANCELLED') throw ApiError.conflict('That bag was cancelled at its source', { field: 'lines' });
      assertNotBeforeBag(entryDate, bag);

      const row = await tx.alterationEntry.create({
        data: {
          entryDate,
          receiptId: bag.id,
          orderId: bag.orderId,
          styleId: bag.styleId,
          pcsAltered: D(l.pcsAltered),
          pcsNotRepairable: D(l.pcsNotRepairable),
          notRepairableReason: D(l.pcsNotRepairable).greaterThan(0) ? String(l.notRepairableReason).trim() : null,
          staffId: input.staffId,
          remarks: input.remarks ?? null,
          recordedById: auth.userId,
          recordedByName: auth.fullName,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
      });
      const updated = await recomputeBag(tx, bag.id, auth.userId);
      await syncRegister(tx, row, updated, auth.userId);
      ids.push(row.id);
    }
    await assertFinishingFlow(tx, first, label);

    const rows = await tx.alterationEntry.findMany({ where: { id: { in: ids } }, include: INCLUDE });
    return { rows: rows.map(project) };
  });
}

/** Counts, reason, staff, date and remarks. The bag is what the entry IS. */
export async function update(auth, id, input) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.alterationEntry.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw ApiError.notFound('Alteration entry');
    await lockFinishingFlow(tx, existing.orderId, existing.styleId);
    const label = await labelOf(tx, existing.orderId, existing.styleId);

    const merged = { ...existing };
    for (const k of ['pcsAltered', 'pcsNotRepairable']) if (input[k] !== undefined) merged[k] = D(input[k]);
    for (const k of ['notRepairableReason', 'staffId', 'remarks']) if (input[k] !== undefined) merged[k] = input[k];
    if (D(merged.pcsNotRepairable).lessThanOrEqualTo(0)) merged.notRepairableReason = null;
    assertProblems(alterationProblems(merged));
    await assertStaff(tx, merged.staffId, { keeping: existing.staffId });

    const bag = await tx.alterationReceipt.findUnique({ where: { id: existing.receiptId } });
    const entryDate = input.entryDate ? checkedDate(input.entryDate) : existing.entryDate;
    assertNotBeforeBag(entryDate, bag);

    const row = await tx.alterationEntry.update({
      where: { id },
      data: {
        entryDate,
        pcsAltered: merged.pcsAltered,
        pcsNotRepairable: merged.pcsNotRepairable,
        notRepairableReason: merged.notRepairableReason ? String(merged.notRepairableReason).trim() : null,
        staffId: merged.staffId,
        remarks: merged.remarks ?? null,
        updatedById: auth.userId,
      },
    });
    const updated = await recomputeBag(tx, bag.id, auth.userId);
    await syncRegister(tx, row, updated, auth.userId);
    await assertFinishingFlow(tx, existing, label);
    return project(await tx.alterationEntry.findUnique({ where: { id }, include: INCLUDE }));
  });
}

export async function remove(auth, id) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.alterationEntry.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw ApiError.notFound('Alteration entry');
    await lockFinishingFlow(tx, existing.orderId, existing.styleId);
    const label = await labelOf(tx, existing.orderId, existing.styleId);

    const row = await tx.alterationEntry.update({ where: { id }, data: { deletedAt: new Date(), deletedById: auth.userId } });
    const updated = await recomputeBag(tx, existing.receiptId, auth.userId);
    await syncRegister(tx, row, updated, auth.userId);
    // Altered pieces already received back at ironing cannot be un-altered.
    await assertFinishingFlow(tx, existing, label);
    return { id, deleted: true };
  });
}
