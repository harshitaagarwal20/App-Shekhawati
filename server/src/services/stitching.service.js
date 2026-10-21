/**
 * Stitching Record, Hourly Monitoring, and printing after stitching.
 *
 * ---------------------------------------------------------------------------
 *  WHERE IT SITS
 *
 *      Cutting Issue  ->  STITCHING RECORD  (per unit, per day)
 *      (cut pieces         HOURLY MONITORING (per tailor, per hour)
 *       posted to a unit)  PRINTING AFTER STITCHING (optional, per order)
 *
 *  A cutting issue POSTED to a unit (CuttingIssue.firmName) is what gives the
 *  unit something to stitch. The unit's orders are exactly the (order, style)
 *  pairs it has posted cutting issues for, and its ceiling on each is the sum
 *  of the pieces those issues carried.
 *
 *  THE UNIT IS NOT A PERMISSION. It is the Unit / Line on the Employee record
 *  the login is tied to - see unitScopeFor() in domain/stitching.js. Every
 *  read and write below goes through scopeOf(), so a supervisor of Unit 1
 *  can neither see nor record Unit 2's work, whatever the request says.
 *
 *  All sums are in domain/stitching.js. This file reads, locks and writes.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { istDate, istIsoDate } from '../utils/dates.js';
import { getManyByCode } from './masterList.service.js';
import { nextFreeNumber } from './documentNumber.service.js';
import * as rules from '../domain/stitching.js';
import { assertFlow, lockUnitFlow, unitFlow } from './unitFlow.service.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const dateOnly = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00.000Z`);

export const SORTABLE = ['recordDate', 'unit', 'deliverableQty', 'actualStitched', 'remaining', 'createdAt'];
export const HOURLY_SORTABLE = ['entryDate', 'unit', 'slot', 'pcs', 'createdAt'];
export const PRINTING_SORTABLE = ['printingNo', 'printingDate', 'qty', 'qtyReceived', 'createdAt'];

const ORDER_SELECT = { id: true, orderNo: true, status: true, buyer: { select: { id: true, buyerName: true } } };
const STYLE_SELECT = { id: true, styleNo: true, styleDescription: true, hourlyTarget: true };

const RECORD_INCLUDE = { order: { select: ORDER_SELECT }, style: { select: STYLE_SELECT } };

// ===========================================================================
//  THE UNIT
// ===========================================================================

/**
 * What this login may do, and for which unit - plus the two dropdowns every
 * stitching screen needs (the units and the time slots), so a phone makes one
 * call before it can draw anything.
 */
export async function scopeOf(auth) {
  const lists = await getManyByCode(['StitchingUnit', 'HourlySlot']);
  const units = lists.StitchingUnit.map((v) => v.value);
  const slots = lists.HourlySlot.map((v) => v.value);
  const scope = rules.unitScopeFor({
    isAdmin: Boolean(auth?.isAdmin),
    employeeUnit: auth?.employee?.unitLine ?? null,
    units,
  });
  return { ...scope, units, slots };
}

/** The unit a read is held to. Null means "every unit" (office logins). */
function unitForRead(scope, requested) {
  if (scope.fixedUnit) return scope.fixedUnit;
  return requested || null;
}

/** The unit a write is for. Refuses a login that has no unit to record for. */
function unitForWrite(scope, requested) {
  if (!scope.canWrite) {
    throw ApiError.forbidden(
      'Your login is not tied to a stitching unit, so there is no unit to record for. '
        + 'Ask the admin to set the Unit / Line on your Employee record.',
    );
  }
  if (scope.fixedUnit) {
    if (requested && requested !== scope.fixedUnit) {
      throw ApiError.forbidden(`You record for ${scope.fixedUnit} only.`, { field: 'unit' });
    }
    return scope.fixedUnit;
  }
  if (!requested) throw ApiError.badRequest('Choose the unit', { field: 'unit' });
  if (!scope.units.includes(requested)) {
    throw ApiError.badRequest(`"${requested}" is not a stitching unit`, { field: 'unit' });
  }
  return requested;
}

/** Today in India, and a refusal for a day that has not happened yet. */
function checkedDate(iso, field) {
  const today = istIsoDate();
  const day = iso ? String(iso).slice(0, 10) : today;
  if (day > today) {
    throw ApiError.badRequest(`${istDate(dateOnly(day))} has not happened yet - stitching is recorded on the day or after it`, { field });
  }
  return dateOnly(day);
}

/**
 * Serialises every write that moves one unit's pieces of one order and style:
 * stitching, printing after stitching and ironing take the same lock.
 */
const lockUnitOrder = lockUnitFlow;

// ===========================================================================
//  CUT PIECES ISSUED, AND STITCHED
// ===========================================================================

/** Posted, not cancelled - the only cutting issues that sent anything. */
const issuedTo = (unit) => ({
  firmName: unit,
  deletedAt: null,
  status: { not: 'CANCELLED' },
  postedAt: { not: null },
});

async function piecesIssued(client, { unit, orderId, styleId }) {
  const agg = await client.cuttingIssue.aggregate({
    where: { ...issuedTo(unit), orderId, styleId },
    _sum: { cuttingPcsIssued: true },
    _count: { _all: true },
  });
  return { pcs: D(agg._sum.cuttingPcsIssued), issues: agg._count._all };
}

async function piecesStitched(client, { unit, orderId, styleId, excludeId }) {
  const agg = await client.stitchingRecord.aggregate({
    where: {
      unit,
      orderId,
      styleId,
      deletedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    _sum: { actualStitched: true },
  });
  return D(agg._sum.actualStitched);
}

/**
 * The order and style must have cut pieces posted to this unit. Returns the
 * two records for messages and projections.
 */
async function resolveOrderStyle(client, { unit, orderId, styleId }) {
  const [order, style, issued] = await Promise.all([
    client.buyerOrder.findFirst({ where: { id: orderId, deletedAt: null }, select: ORDER_SELECT }),
    client.style.findFirst({ where: { id: styleId, deletedAt: null }, select: STYLE_SELECT }),
    piecesIssued(client, { unit, orderId, styleId }),
  ]);
  if (!order) throw ApiError.badRequest('That order does not exist', { field: 'orderId' });
  if (!style) throw ApiError.badRequest('That style does not exist', { field: 'styleId' });
  if (issued.issues === 0) {
    throw ApiError.badRequest(
      `No cutting has been issued to ${unit} for ${order.orderNo} / ${style.styleNo}. `
        + 'A unit records stitching only against cut pieces posted to it.',
      { field: 'orderId' },
    );
  }
  return { order, style, issued: issued.pcs };
}

/** Refuses a count that would take the unit past the pieces it was issued. */
async function assertCeiling(tx, { unit, order, style, issued, actual, excludeId }) {
  const stitchedOthers = await piecesStitched(tx, {
    unit,
    orderId: order.id,
    styleId: style.id,
    excludeId,
  });
  const c = rules.stitchCeiling({ issued, stitchedOthers, actual });
  if (!c.ok) {
    throw ApiError.conflict(
      `${unit} was issued ${c.issued} cut pieces of ${order.orderNo} / ${style.styleNo} and has already `
        + `recorded ${stitchedOthers} stitched. ${D(actual)} more would make ${c.totalAfter} - `
        + `${c.excess} more than were cut for it. The most this entry can be is ${c.maxForThisRecord}.`,
      {
        field: 'actualStitched',
        pcsIssued: c.issued.toString(),
        pcsStitchedElsewhere: stitchedOthers.toString(),
        maxForThisRecord: c.maxForThisRecord.toString(),
      },
    );
  }
}

/**
 * What the approved stitching plan asks of this unit on this date.
 *
 * The latest APPROVED version per order line, since an older approved
 * version has been superseded. Null when no approved plan has a line for the
 * unit and day - the form then asks for the target to be typed.
 */
async function plannedDeliverable(client, { unit, date, orderId, styleId }) {
  const plans = await client.planning.findMany({
    where: {
      orderId,
      styleId,
      planDepartment: 'STITCHING',
      approvalStatus: 'APPROVED',
      deletedAt: null,
    },
    select: { id: true, orderLineId: true, version: true },
  });
  const latest = new Map();
  for (const p of plans) {
    const held = latest.get(p.orderLineId);
    if (!held || p.version > held.version) latest.set(p.orderLineId, p);
  }
  if (!latest.size) return null;

  const agg = await client.planningLine.aggregate({
    where: {
      planningId: { in: [...latest.values()].map((p) => p.id) },
      deletedAt: null,
      unit,
      lineDate: date,
    },
    _sum: { deliverableSize: true },
    _count: { _all: true },
  });
  return agg._count._all ? D(agg._sum.deliverableSize) : null;
}

// ===========================================================================
//  CONTEXT AND OPTIONS
// ===========================================================================

/** The first call every stitching screen makes. */
export async function context(auth) {
  const scope = await scopeOf(auth);
  return {
    fixedUnit: scope.fixedUnit,
    canChooseUnit: scope.canChoose,
    canWrite: scope.canWrite,
    units: scope.fixedUnit ? [scope.fixedUnit] : scope.units,
    slots: scope.slots,
    today: istIsoDate(),
  };
}

/**
 * The Order No dropdown: every (order, style) with cut pieces posted to the
 * unit, and where the unit stands on each.
 */
export async function orderOptions(auth, { unit } = {}) {
  const scope = await scopeOf(auth);
  const u = unitForRead(scope, unit);
  if (!u) return [];

  const issued = await prisma.cuttingIssue.groupBy({
    by: ['orderId', 'styleId'],
    where: issuedTo(u),
    _sum: { cuttingPcsIssued: true },
  });
  if (!issued.length) return [];

  const orderIds = [...new Set(issued.map((g) => g.orderId))];
  const styleIds = [...new Set(issued.map((g) => g.styleId))];
  const [stitched, orders, styles] = await Promise.all([
    prisma.stitchingRecord.groupBy({
      by: ['orderId', 'styleId'],
      where: { unit: u, deletedAt: null, orderId: { in: orderIds } },
      _sum: { actualStitched: true },
    }),
    prisma.buyerOrder.findMany({ where: { id: { in: orderIds }, deletedAt: null }, select: ORDER_SELECT }),
    prisma.style.findMany({ where: { id: { in: styleIds } }, select: STYLE_SELECT }),
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const styleById = new Map(styles.map((s) => [s.id, s]));
  const stitchedOf = new Map(stitched.map((g) => [`${g.orderId}:${g.styleId}`, g._sum.actualStitched]));

  return issued
    .filter((g) => orderById.has(g.orderId) && orderById.get(g.orderId).status !== 'CANCELLED')
    .map((g) => {
      const order = orderById.get(g.orderId);
      const style = styleById.get(g.styleId);
      return {
        key: `${g.orderId}:${g.styleId}`,
        unit: u,
        orderId: g.orderId,
        orderNo: order.orderNo,
        buyerName: order.buyer?.buyerName ?? null,
        styleId: g.styleId,
        styleNo: style?.styleNo ?? null,
        styleDescription: style?.styleDescription ?? null,
        hourlyTarget: style?.hourlyTarget == null ? null : D(style.hourlyTarget).toString(),
        ...rules.unitPosition({
          issued: g._sum.cuttingPcsIssued,
          stitched: stitchedOf.get(`${g.orderId}:${g.styleId}`),
        }),
      };
    })
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo) || String(a.styleNo).localeCompare(String(b.styleNo)));
}

/**
 * Everything the stitching form fills in by itself for one unit, day, order
 * and style: the plan's deliverable, the unit's position, the most this
 * entry may carry, the hourly grid's total, and the existing record if the
 * day has one (the form then edits it rather than starting a second).
 */
export async function dayContext(auth, { unit, date, orderId, styleId }) {
  const scope = await scopeOf(auth);
  const u = unitForRead(scope, unit);
  if (!u) throw ApiError.badRequest('Choose the unit', { field: 'unit' });
  const day = dateOnly(date ?? istIsoDate());

  const { order, style, issued } = await resolveOrderStyle(prisma, { unit: u, orderId, styleId });
  const [planned, existing, hourly] = await Promise.all([
    plannedDeliverable(prisma, { unit: u, date: day, orderId, styleId }),
    prisma.stitchingRecord.findFirst({
      where: { unit: u, recordDate: day, orderId, styleId, deletedAt: null },
      include: RECORD_INCLUDE,
    }),
    prisma.hourlyMonitoringEntry.aggregate({
      where: { unit: u, entryDate: day, orderId, styleId },
      _sum: { pcs: true },
      _count: { _all: true },
    }),
  ]);
  const stitchedOthers = await piecesStitched(prisma, {
    unit: u,
    orderId,
    styleId,
    excludeId: existing?.id,
  });
  const ceiling = rules.stitchCeiling({ issued, stitchedOthers, actual: 0 });

  return {
    unit: u,
    date: istIsoDate(day),
    order,
    style,
    plannedDeliverable: planned == null ? null : planned.toString(),
    existing: existing ? project(existing) : null,
    ...rules.unitPosition({ issued, stitched: stitchedOthers.plus(D(existing?.actualStitched)) }),
    maxForThisRecord: ceiling.maxForThisRecord.toString(),
    hourlyTotal: hourly._count._all ? D(hourly._sum.pcs).toString() : null,
  };
}

// ===========================================================================
//  STITCHING RECORD
// ===========================================================================

function project(row) {
  return {
    ...row,
    deliverableQty: D(row.deliverableQty).toString(),
    deliverableFromPlan: row.deliverableFromPlan == null ? null : D(row.deliverableFromPlan).toString(),
    actualStitched: D(row.actualStitched).toString(),
    remaining: D(row.remaining).toString(),
  };
}

const RECORD_SEARCH = ['unit', 'remarks', 'recordedByName', 'order.orderNo', 'style.styleNo'];

function between(field, from, to) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { gte: dateOnly(from) } : {}), ...(to ? { lte: dateOnly(to) } : {}) } };
}

/**
 * The register. `auth` holds a supervisor to their own unit - the export of
 * this list goes through the same call, so the file is held to it too.
 */
export async function list(query, auth) {
  const scope = await scopeOf(auth);
  const unit = unitForRead(scope, query.unit);
  const { page, pageSize, skip, take, orderBy, search, includeDeleted } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(unit ? { unit } : {}),
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.styleId ? { styleId: query.styleId } : {}),
    ...between('recordDate', query.dateFrom, query.dateTo),
    ...searchFilter(search, RECORD_SEARCH),
  };

  const [rows, total, sums] = await Promise.all([
    prisma.stitchingRecord.findMany({ where, orderBy: orderBy ?? { recordDate: 'desc' }, skip, take, include: RECORD_INCLUDE }),
    prisma.stitchingRecord.count({ where }),
    prisma.stitchingRecord.aggregate({ where, _sum: { deliverableQty: true, actualStitched: true, remaining: true } }),
  ]);

  return {
    rows: rows.map(project),
    total,
    page,
    pageSize,
    totals: {
      deliverableQty: D(sums._sum.deliverableQty).toString(),
      actualStitched: D(sums._sum.actualStitched).toString(),
      remaining: D(sums._sum.remaining).toString(),
    },
  };
}

/** One record, with where its unit stands on the order and style. */
export async function getById(auth, id) {
  const scope = await scopeOf(auth);
  const row = await prisma.stitchingRecord.findFirst({
    where: { id, deletedAt: null, ...(scope.fixedUnit ? { unit: scope.fixedUnit } : {}) },
    include: RECORD_INCLUDE,
  });
  if (!row) throw ApiError.notFound('Stitching record');

  const [issued, stitched] = await Promise.all([
    piecesIssued(prisma, row),
    piecesStitched(prisma, row),
  ]);
  return { ...project(row), position: rules.unitPosition({ issued: issued.pcs, stitched }) };
}

export async function create(auth, input) {
  const scope = await scopeOf(auth);
  const unit = unitForWrite(scope, input.unit);
  const recordDate = checkedDate(input.recordDate, 'recordDate');

  return prisma.$transaction(async (tx) => {
    await lockUnitOrder(tx, unit, input.orderId, input.styleId);
    const { order, style, issued } = await resolveOrderStyle(tx, { unit, orderId: input.orderId, styleId: input.styleId });

    const clash = await tx.stitchingRecord.findFirst({
      where: { unit, recordDate, orderId: order.id, styleId: style.id, deletedAt: null },
      select: { id: true },
    });
    if (clash) {
      throw ApiError.conflict(
        `${unit} already has a stitching record for ${order.orderNo} / ${style.styleNo} on ${istDate(recordDate)}. Edit that one instead.`,
        { existingId: clash.id },
      );
    }

    await assertCeiling(tx, { unit, order, style, issued, actual: input.actualStitched, excludeId: null });

    const planned = await plannedDeliverable(tx, { unit, date: recordDate, orderId: order.id, styleId: style.id });
    const deliverableQty = input.deliverableQty != null ? D(input.deliverableQty) : (planned ?? D(0));

    const row = await tx.stitchingRecord.create({
      data: {
        unit,
        recordDate,
        orderId: order.id,
        styleId: style.id,
        deliverableQty,
        deliverableFromPlan: planned,
        actualStitched: D(input.actualStitched),
        remaining: rules.remainingOf(deliverableQty, input.actualStitched),
        remarks: input.remarks ?? null,
        recordedById: auth.userId,
        recordedByName: auth.fullName,
        createdById: auth.userId,
        updatedById: auth.userId,
      },
      include: RECORD_INCLUDE,
    });
    return project(row);
  });
}

/**
 * The count, the target and the remarks. Unit, date, order and style are
 * what the row IS; changing one of them is a different day's record.
 */
export async function update(auth, id, input) {
  const scope = await scopeOf(auth);
  // The row already names its unit; only the right to write is in question.
  if (!scope.canWrite) unitForWrite(scope, null);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.stitchingRecord.findFirst({
      where: { id, deletedAt: null, ...(scope.fixedUnit ? { unit: scope.fixedUnit } : {}) },
    });
    if (!existing) throw ApiError.notFound('Stitching record');

    await lockUnitOrder(tx, existing.unit, existing.orderId, existing.styleId);
    const { order, style, issued } = await resolveOrderStyle(tx, existing);

    const actual = input.actualStitched ?? existing.actualStitched;
    const deliverable = input.deliverableQty ?? existing.deliverableQty;
    if (input.actualStitched !== undefined) {
      await assertCeiling(tx, { unit: existing.unit, order, style, issued, actual, excludeId: existing.id });
    }

    const row = await tx.stitchingRecord.update({
      where: { id },
      data: {
        deliverableQty: D(deliverable),
        actualStitched: D(actual),
        remaining: rules.remainingOf(deliverable, actual),
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        updatedById: auth.userId,
      },
      include: RECORD_INCLUDE,
    });
    // A lower count may not fall below what has already left the unit -
    // out for printing, or received at ironing.
    await assertFlow(tx, existing, `${order.orderNo} / ${style.styleNo}`);
    return project(row);
  });
}

export async function remove(auth, id) {
  const scope = await scopeOf(auth);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.stitchingRecord.findFirst({
      where: { id, deletedAt: null, ...(scope.fixedUnit ? { unit: scope.fixedUnit } : {}) },
      include: RECORD_INCLUDE,
    });
    if (!existing) throw ApiError.notFound('Stitching record');
    await lockUnitOrder(tx, existing.unit, existing.orderId, existing.styleId);
    await tx.stitchingRecord.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: auth.userId },
    });
    await assertFlow(tx, existing, `${existing.order.orderNo} / ${existing.style.styleNo}`);
    return { id, deleted: true };
  });
}

// ===========================================================================
//  HOURLY MONITORING
// ===========================================================================

/** The unit's tailors: Designation "Tailor", active, Unit / Line = the unit. */
async function tailorsOf(client, unit) {
  return client.employee.findMany({
    where: {
      unitLine: unit,
      deletedAt: null,
      status: 'ACTIVE',
      designation: { equals: 'Tailor', mode: 'insensitive' },
    },
    orderBy: [{ empId: 'asc' }],
    select: { id: true, empId: true, empName: true },
  });
}

/**
 * The grid for one unit, date and order/style: a row per tailor, a column
 * per slot, the totals, and the unit's total for the day across every order.
 */
export async function hourlyGrid(auth, { unit, date, orderId, styleId }) {
  const scope = await scopeOf(auth);
  const u = unitForRead(scope, unit);
  if (!u) throw ApiError.badRequest('Choose the unit', { field: 'unit' });
  const day = dateOnly(date ?? istIsoDate());

  const { order, style } = await resolveOrderStyle(prisma, { unit: u, orderId, styleId });

  const [tailors, entries, unitDay] = await Promise.all([
    tailorsOf(prisma, u),
    prisma.hourlyMonitoringEntry.findMany({
      where: { unit: u, entryDate: day, orderId, styleId },
      select: { employeeId: true, slot: true, pcs: true, hourlyTarget: true },
    }),
    prisma.hourlyMonitoringEntry.aggregate({
      where: { unit: u, entryDate: day },
      _sum: { pcs: true },
    }),
  ]);

  const rosterIds = new Set(tailors.map((t) => t.id));
  const strayIds = [...new Set(entries.map((e) => e.employeeId).filter((id) => !rosterIds.has(id)))];
  const extraTailors = strayIds.length
    ? await prisma.employee.findMany({ where: { id: { in: strayIds } }, select: { id: true, empId: true, empName: true } })
    : [];

  const grid = rules.buildGrid({
    slots: scope.slots,
    tailors,
    extraTailors,
    entries,
    target: style.hourlyTarget,
  });

  return {
    unit: u,
    date: istIsoDate(day),
    order,
    style,
    canWrite: scope.canWrite,
    ...grid,
    unitDayTotal: D(unitDay._sum.pcs).toString(),
  };
}

/**
 * ONE CELL. Typing a number saves it; clearing the box deletes it. Returns
 * the whole grid again so every total on the screen is the server's.
 */
export async function saveSlot(auth, input) {
  const scope = await scopeOf(auth);
  const unit = unitForWrite(scope, input.unit);
  const entryDate = checkedDate(input.date, 'date');
  const clearing = input.pcs == null;

  await prisma.$transaction(async (tx) => {
    const { style } = await resolveOrderStyle(tx, { unit, orderId: input.orderId, styleId: input.styleId });

    const key = {
      entryDate,
      orderId: input.orderId,
      styleId: input.styleId,
      employeeId: input.employeeId,
      slot: input.slot,
    };
    // Found by its fields and then written by id, never by the compound key:
    // the audit trail reads the "before" row with findFirst(where), which
    // does not accept a compound unique.
    const existing = await tx.hourlyMonitoringEntry.findFirst({ where: key });
    if (existing && existing.unit !== unit) {
      throw ApiError.forbidden(`That count was taken in ${existing.unit}.`);
    }

    if (clearing) {
      if (existing) await tx.hourlyMonitoringEntry.delete({ where: { id: existing.id } });
      return;
    }

    if (!scope.slots.includes(input.slot)) {
      throw ApiError.badRequest(`"${input.slot}" is not one of the hourly slots`, { field: 'slot' });
    }
    if (!existing) {
      const tailor = await tx.employee.findFirst({
        where: { id: input.employeeId, deletedAt: null },
        select: { id: true, empName: true, unitLine: true, status: true },
      });
      if (!tailor) throw ApiError.badRequest('That employee does not exist', { field: 'employeeId' });
      if (tailor.unitLine !== unit) {
        throw ApiError.badRequest(`${tailor.empName} is not in ${unit}`, { field: 'employeeId' });
      }
    }

    const data = {
      pcs: D(input.pcs),
      hourlyTarget: style.hourlyTarget ?? null,
      recordedById: auth.userId,
      recordedByName: auth.fullName,
      updatedById: auth.userId,
    };
    if (existing) {
      await tx.hourlyMonitoringEntry.update({ where: { id: existing.id }, data });
    } else {
      // Two phones saving the same empty cell at once: the unique key refuses
      // the second, which reaches the caller as a 409 and a retry saves it.
      await tx.hourlyMonitoringEntry.create({ data: { ...key, unit, ...data, createdById: auth.userId } });
    }
  });

  return hourlyGrid(auth, { unit, date: istIsoDate(entryDate), orderId: input.orderId, styleId: input.styleId });
}

const HOURLY_INCLUDE = {
  order: { select: { id: true, orderNo: true } },
  style: { select: { id: true, styleNo: true } },
  employee: { select: { id: true, empId: true, empName: true } },
};

/** Every cell as a row - for the export, and for anyone reconciling a day. */
export async function listHourly(query, auth) {
  const scope = await scopeOf(auth);
  const unit = unitForRead(scope, query.unit);
  const { page, pageSize, skip, take, orderBy, search } = query;

  const where = {
    ...(unit ? { unit } : {}),
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.styleId ? { styleId: query.styleId } : {}),
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...between('entryDate', query.dateFrom, query.dateTo),
    ...searchFilter(search, ['unit', 'slot', 'order.orderNo', 'style.styleNo', 'employee.empName', 'employee.empId']),
  };

  const [rows, total] = await Promise.all([
    prisma.hourlyMonitoringEntry.findMany({
      where,
      orderBy: orderBy ?? [{ entryDate: 'desc' }],
      skip,
      take,
      include: HOURLY_INCLUDE,
    }),
    prisma.hourlyMonitoringEntry.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      ...r,
      pcs: D(r.pcs).toString(),
      hourlyTarget: r.hourlyTarget == null ? null : D(r.hourlyTarget).toString(),
      belowTarget: rules.belowTarget(r.pcs, r.hourlyTarget),
    })),
    total,
    page,
    pageSize,
  };
}

// ===========================================================================
//  PRINTING AFTER STITCHING  (optional)
// ===========================================================================
//
//  The workbook's Printing sheet, at Fabric Stage "After Stitching". The same
//  `printings` table as before - the before-stitching rows written there are
//  untouched and still reported by printing-status - with "Pcs Received Back"
//  and, since Ironing, the unit the pieces were sent from. Pieces out for
//  printing are held against that unit: ironing cannot receive them from it
//  until they are back. See unitFlow.service.js.
//
//  Optional: nothing in stitching or ironing needs a printing entry.

const AFTER = 'AFTER_STITCHING';

const PRINTING_INCLUDE = {
  order: { select: ORDER_SELECT },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  vendor: { select: { id: true, vendorCode: true, vendorName: true } },
};

function projectPrinting(row) {
  const out = D(row.qty).minus(D(row.qtyReceived));
  return {
    ...row,
    qty: D(row.qty).toString(),
    qtyReceived: D(row.qtyReceived).toString(),
    qtyOut: out.toString(),
  };
}

/** Where one unit's pieces of an order and style are, for the printing form. */
export async function printingSummary({ orderId, styleId, unit }) {
  if (!orderId || !styleId || !unit) throw ApiError.badRequest('Choose the order, style and unit');
  const f = await unitFlow(prisma, { unit, orderId, styleId });
  return {
    unit,
    pcsStitched: f.stitched.toString(),
    pcsSentForPrinting: f.sentForPrinting.toString(),
    pcsReceivedBack: f.receivedFromPrinting.toString(),
    pcsOutForPrinting: f.outForPrinting.toString(),
    pcsReceivedAtIroning: f.receivedAtIroning.toString(),
    /** Still at the unit: neither at the printer nor gone to ironing. */
    pcsAvailable: f.availableToReceive.toString(),
    pcsPrintableNow: (f.availableToReceive.greaterThan(0) ? f.availableToReceive : D(0)).toString(),
  };
}

/** (order, style, unit) with stitching recorded - what can go for printing. */
export async function printingOrderOptions() {
  const groups = await prisma.stitchingRecord.groupBy({
    by: ['unit', 'orderId', 'styleId'],
    where: { deletedAt: null },
    _sum: { actualStitched: true },
  });
  if (!groups.length) return [];
  const [orders, styles] = await Promise.all([
    prisma.buyerOrder.findMany({ where: { id: { in: [...new Set(groups.map((g) => g.orderId))] } }, select: ORDER_SELECT }),
    prisma.style.findMany({ where: { id: { in: [...new Set(groups.map((g) => g.styleId))] } }, select: STYLE_SELECT }),
  ]);
  const o = new Map(orders.map((x) => [x.id, x]));
  const s = new Map(styles.map((x) => [x.id, x]));
  return groups
    .filter((g) => o.has(g.orderId) && D(g._sum.actualStitched).greaterThan(0))
    .map((g) => ({
      key: `${g.orderId}:${g.styleId}:${g.unit}`,
      orderId: g.orderId,
      orderNo: o.get(g.orderId).orderNo,
      buyerName: o.get(g.orderId).buyer?.buyerName ?? null,
      styleId: g.styleId,
      styleNo: s.get(g.styleId)?.styleNo ?? null,
      unit: g.unit,
      pcsStitched: D(g._sum.actualStitched).toString(),
    }))
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo) || a.unit.localeCompare(b.unit));
}

export async function listPrintings(query) {
  const { page, pageSize, skip, take, orderBy, search, includeDeleted } = query;
  const where = {
    fabricStage: AFTER,
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.styleId ? { styleId: query.styleId } : {}),
    ...(query.vendorId ? { vendorId: query.vendorId } : {}),
    ...(query.fromUnit ? { fromUnit: query.fromUnit } : {}),
    ...(query.openOnly === 'true' || query.openOnly === true ? { status: { in: ['PENDING', 'IN_PROGRESS'] } } : {}),
    ...between('printingDate', query.dateFrom, query.dateTo),
    ...searchFilter(search, ['printingNo', 'remarks', 'fromUnit', 'order.orderNo', 'style.styleNo', 'vendor.vendorName']),
  };
  const [rows, total] = await Promise.all([
    prisma.printing.findMany({ where, orderBy: orderBy ?? { printingDate: 'desc' }, skip, take, include: PRINTING_INCLUDE }),
    prisma.printing.count({ where }),
  ]);
  return { rows: rows.map(projectPrinting), total, page, pageSize };
}

export async function getPrinting(id) {
  const row = await prisma.printing.findFirst({ where: { id, fabricStage: AFTER, deletedAt: null }, include: PRINTING_INCLUDE });
  if (!row) throw ApiError.notFound('Printing after stitching');
  return {
    ...projectPrinting(row),
    // An older row that names no unit has no unit position to show.
    summary: row.fromUnit ? await printingSummary({ ...row, unit: row.fromUnit }) : null,
  };
}

async function assertVendor(client, vendorId) {
  const vendor = await client.vendor.findFirst({ where: { id: vendorId, deletedAt: null }, select: { id: true, status: true, vendorName: true } });
  if (!vendor) throw ApiError.badRequest('That vendor does not exist', { field: 'vendorId' });
  if (vendor.status !== 'ACTIVE') throw ApiError.badRequest(`${vendor.vendorName} is inactive`, { field: 'vendorId' });
}

async function assertStitchingUnit(unit) {
  const lists = await getManyByCode(['StitchingUnit']);
  if (!lists.StitchingUnit.some((v) => v.value === unit)) {
    throw ApiError.badRequest(`"${unit}" is not a stitching unit`, { field: 'fromUnit' });
  }
}

/**
 * Sent may not exceed what the unit stitched and still holds. `ownOut` is
 * what this row already has out, when it is being edited.
 */
async function assertPrintable(tx, { unit, orderId, styleId, qty, ownOut = 0, label }) {
  const f = await unitFlow(tx, { unit, orderId, styleId });
  const room = f.availableToReceive.plus(D(ownOut));
  if (D(qty).greaterThan(room)) {
    throw ApiError.conflict(
      `${label} from ${unit}: ${f.stitched} pieces stitched, ${f.outForPrinting.minus(D(ownOut))} already out for `
        + `printing and ${f.receivedAtIroning} gone to ironing - at most ${room.greaterThan(0) ? room : 0} can be sent.`,
      { field: 'qty', pcsPrintableNow: (room.greaterThan(0) ? room : D(0)).toString() },
    );
  }
}

function assertReceived(qty, qtyReceived) {
  if (D(qtyReceived).greaterThan(D(qty))) {
    throw ApiError.badRequest(`Received back (${D(qtyReceived)}) cannot be more than was sent (${D(qty)})`, { field: 'qtyReceived' });
  }
}

export async function createPrinting(input, actorId) {
  const printingDate = checkedDate(input.printingDate, 'printingDate');
  const qtyReceived = D(input.qtyReceived);
  assertReceived(input.qty, qtyReceived);
  await assertStitchingUnit(input.fromUnit);

  return prisma.$transaction(async (tx) => {
    await lockUnitFlow(tx, input.fromUnit, input.orderId, input.styleId);
    const [order, style] = await Promise.all([
      tx.buyerOrder.findFirst({ where: { id: input.orderId, deletedAt: null }, select: ORDER_SELECT }),
      tx.style.findFirst({ where: { id: input.styleId, deletedAt: null }, select: STYLE_SELECT }),
    ]);
    if (!order) throw ApiError.badRequest('That order does not exist', { field: 'orderId' });
    if (!style) throw ApiError.badRequest('That style does not exist', { field: 'styleId' });
    const label = `${order.orderNo} / ${style.styleNo}`;
    await assertVendor(tx, input.vendorId);
    await assertPrintable(tx, { unit: input.fromUnit, orderId: order.id, styleId: style.id, qty: D(input.qty).minus(qtyReceived), label });

    const printingNo = await nextFreeNumber(
      'PRINTING',
      async (no) => Boolean(await tx.printing.findUnique({ where: { printingNo: no }, select: { id: true } })),
      { tx },
    );
    const row = await tx.printing.create({
      data: {
        printingNo,
        printingDate,
        orderId: order.id,
        styleId: style.id,
        vendorId: input.vendorId,
        fromUnit: input.fromUnit,
        fabricStage: AFTER,
        qty: D(input.qty),
        qtyReceived,
        receivedDate: qtyReceived.greaterThan(0) ? (input.receivedDate ? dateOnly(input.receivedDate) : printingDate) : null,
        uom: input.uom ?? 'Pcs',
        remarks: input.remarks ?? null,
        status: rules.printingStatusOf(input.qty, qtyReceived),
        createdById: actorId,
        updatedById: actorId,
      },
      include: PRINTING_INCLUDE,
    });
    await assertFlow(tx, { unit: input.fromUnit, orderId: order.id, styleId: style.id }, label);
    return projectPrinting(row);
  });
}

/**
 * Counts, dates, vendor, remarks. The unit is fixed once given; an older row
 * that never named one may be given one now.
 */
export async function updatePrinting(id, input, actorId) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.printing.findFirst({ where: { id, fabricStage: AFTER, deletedAt: null } });
    if (!existing) throw ApiError.notFound('Printing after stitching');
    if (input.fromUnit && existing.fromUnit && input.fromUnit !== existing.fromUnit) {
      throw ApiError.badRequest(`${existing.printingNo} was sent from ${existing.fromUnit}; that cannot change`, { field: 'fromUnit' });
    }
    const unit = existing.fromUnit ?? input.fromUnit ?? null;
    if (unit && !existing.fromUnit) await assertStitchingUnit(unit);
    if (unit) await lockUnitFlow(tx, unit, existing.orderId, existing.styleId);

    const qty = input.qty ?? existing.qty;
    const qtyReceived = input.qtyReceived ?? existing.qtyReceived;
    assertReceived(qty, qtyReceived);
    if (input.vendorId) await assertVendor(tx, input.vendorId);
    const newOut = D(qty).minus(D(qtyReceived));
    const oldOut = existing.fromUnit ? D(existing.qty).minus(D(existing.qtyReceived)) : D(0);
    if (unit && newOut.greaterThan(oldOut)) {
      await assertPrintable(tx, { unit, orderId: existing.orderId, styleId: existing.styleId, qty: newOut, ownOut: oldOut, label: existing.printingNo });
    }

    const gotMore = D(qtyReceived).greaterThan(D(existing.qtyReceived));
    const row = await tx.printing.update({
      where: { id },
      data: {
        ...(input.printingDate ? { printingDate: checkedDate(input.printingDate, 'printingDate') } : {}),
        ...(input.vendorId ? { vendorId: input.vendorId } : {}),
        ...(unit && !existing.fromUnit ? { fromUnit: unit } : {}),
        qty: D(qty),
        qtyReceived: D(qtyReceived),
        ...(input.receivedDate
          ? { receivedDate: checkedDate(input.receivedDate, 'receivedDate') }
          : gotMore ? { receivedDate: dateOnly(istIsoDate()) } : {}),
        ...(input.uom ? { uom: input.uom } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        status: rules.printingStatusOf(qty, qtyReceived),
        updatedById: actorId,
      },
      include: PRINTING_INCLUDE,
    });
    if (unit) await assertFlow(tx, { unit, orderId: existing.orderId, styleId: existing.styleId }, existing.printingNo);
    return projectPrinting(row);
  });
}

/** Deleting only frees pieces, so it needs no flow check. */
export async function removePrinting(id, actorId) {
  const existing = await prisma.printing.findFirst({ where: { id, fabricStage: AFTER, deletedAt: null }, select: { id: true } });
  if (!existing) throw ApiError.notFound('Printing after stitching');
  await prisma.printing.update({ where: { id }, data: { deletedAt: new Date(), deletedById: actorId } });
  return { id, deleted: true };
}
