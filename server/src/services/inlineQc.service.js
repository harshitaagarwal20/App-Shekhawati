/**
 * Inline QC - checks taken on the stitching line, and the Action needed list.
 *
 * ---------------------------------------------------------------------------
 *  WHERE IT SITS
 *
 *      Cutting Issue  ->  STITCHING RECORD / HOURLY MONITORING
 *      (cut pieces         INLINE QC   <- beside stitching, not after it
 *       posted to a unit)
 *
 *  A checker walks the line while the tailors work. An entry names the
 *  tailor; the unit is the tailor's Unit / Line; the order and style are the
 *  ones cut for that unit (the same list stitching uses). It moves no
 *  pieces, so it neither waits on a stitching record nor feeds ironing.
 *
 *  What it produces is the ACTION NEEDED LIST. Every defect found is a line
 *  for the person named in Inform To, who marks it Resolved. Only that
 *  person may (Admin excepted) - see mayResolve() in domain/inlineQc.js.
 *
 *  THE UNIT. A login tied to a stitching unit (a supervisor) reads only that
 *  unit's checks, exactly as on the stitching screens - scopeOf() in
 *  stitching.service.js. The checker's desk is tied to no unit and reads
 *  them all. Lines addressed to a person are theirs to see whatever unit.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { istDate, istIsoDate } from '../utils/dates.js';
import { getManyByCode } from './masterList.service.js';
import { orderOptions as stitchingOrderOptions, scopeOf } from './stitching.service.js';
import { notify } from './notification.service.js';
import * as rules from '../domain/inlineQc.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const dateOnly = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00.000Z`);

export const SORTABLE = ['entryDate', 'checkType', 'unit', 'pcsChecked', 'pcsRejected', 'createdAt'];
export const ACTION_SORTABLE = ['createdAt', 'status', 'defect', 'resolvedAt'];

/** Who may be named in Inform To. */
export const RESOLVE = 'INLINE_QC.RESOLVE';

const ACTIONS_LINK = '/inline-qc/actions';

const INCLUDE = {
  order: { select: { id: true, orderNo: true, buyer: { select: { id: true, buyerName: true } } } },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  tailor: { select: { id: true, empId: true, empName: true } },
  defects: { orderBy: { createdAt: 'asc' } },
};

function project(row) {
  const defects = row.defects ?? [];
  return {
    ...row,
    pcsChecked: D(row.pcsChecked).toString(),
    pcsRejected: D(row.pcsRejected).toString(),
    rejectionPct: rules.rejectionPct(row.pcsChecked, row.pcsRejected),
    checkTypeLabel: rules.checkTypeLabel(row.checkType),
    /** The defects as one cell - what the Excel export carries. */
    defectsFound: defects.map((d) => d.defect).join('; '),
    openDefects: defects.filter((d) => d.status === 'OPEN').length,
  };
}

function checkedDate(iso) {
  const today = istIsoDate();
  const day = iso ? String(iso).slice(0, 10) : today;
  if (day > today) throw ApiError.badRequest(`${istDate(dateOnly(day))} has not happened yet`, { field: 'entryDate' });
  return dateOnly(day);
}

function assertEntry(e) {
  const problems = rules.entryProblems(e);
  if (problems.length) {
    throw ApiError.badRequest(problems.map((p) => p.message).join('. '), { field: problems[0].field, problems });
  }
}

function between(field, from, to) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { gte: dateOnly(from) } : {}), ...(to ? { lte: dateOnly(to) } : {}) } };
}

const resolverOf = (auth) => ({ userId: auth?.userId, isAdmin: Boolean(auth?.isAdmin), canResolve: Boolean(auth?.has?.(RESOLVE)) });

// ===========================================================================
//  THE PEOPLE
// ===========================================================================

/** Active tailors on a stitching unit - or on the one unit this login is held to. */
async function tailorsFor(scope) {
  return prisma.employee.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      designation: { equals: 'Tailor', mode: 'insensitive' },
      unitLine: scope.fixedUnit ? scope.fixedUnit : { in: scope.units },
    },
    orderBy: [{ unitLine: 'asc' }, { empName: 'asc' }],
    select: { id: true, empId: true, empName: true, unitLine: true },
  });
}

/**
 * The Inform To dropdown: active logins holding INLINE_QC.RESOLVE through a
 * business role. ADMIN holds every permission by construction and is left
 * out, as in notification.service.js usersWithPermission() - or every defect
 * could be addressed to the IT desk.
 */
async function informToCandidates(client = prisma) {
  const users = await client.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      roles: {
        some: {
          role: { deletedAt: null, code: { not: 'ADMIN' }, permissions: { some: { permission: { code: RESOLVE } } } },
        },
      },
    },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true, employee: { select: { designation: true, unitLine: true } } },
  });
  return users.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    designation: u.employee?.designation ?? null,
    unit: u.employee?.unitLine ?? null,
  }));
}

async function assertInformTo(tx, userId, { keeping } = {}) {
  if (!userId) return null;
  const candidates = await informToCandidates(tx);
  const hit = candidates.find((c) => c.id === userId);
  if (hit) return hit;
  // Already named on the entry and since moved on: kept, never newly chosen.
  if (userId === keeping?.id) return { id: keeping.id, fullName: keeping.name };
  throw ApiError.badRequest('That person cannot be informed - they need a login with Inline QC Resolve', { field: 'informToUserId' });
}

// ===========================================================================
//  CONTEXT AND OPTIONS
// ===========================================================================

/** Everything the screen needs before it can draw. */
export async function context(auth) {
  const scope = await scopeOf(auth);
  const [tailors, informTo, myOpen] = await Promise.all([
    tailorsFor(scope),
    informToCandidates(),
    auth?.userId ? openFor(auth.userId) : 0,
  ]);
  return {
    today: istIsoDate(),
    fixedUnit: scope.fixedUnit,
    units: scope.fixedUnit ? [scope.fixedUnit] : scope.units,
    canWrite: Boolean(auth?.has?.('INLINE_QC.CREATE')),
    canResolve: Boolean(auth?.has?.(RESOLVE)),
    checkTypes: rules.CHECK_TYPES,
    tailors,
    informTo,
    /** Defects addressed to this login and still open. */
    myOpen,
  };
}

/**
 * The Order dropdown for the tailor's unit: every order and style with
 * cutting posted to it. The stitching list, so the two screens agree.
 */
export async function orderOptions(auth, { unit } = {}) {
  return stitchingOrderOptions(auth, { unit });
}

async function openFor(userId) {
  return prisma.inlineQcDefect.count({
    where: { status: 'OPEN', entry: { deletedAt: null, informToUserId: userId } },
  });
}

// ===========================================================================
//  THE REGISTER
// ===========================================================================

export async function list(query, auth) {
  const scope = await scopeOf(auth);
  const unit = scope.fixedUnit ?? (query.unit || null);
  const { page, pageSize, skip, take, orderBy, search, includeDeleted } = query;
  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(unit ? { unit } : {}),
    ...(query.checkType ? { checkType: query.checkType } : {}),
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.styleId ? { styleId: query.styleId } : {}),
    ...(query.tailorId ? { tailorId: query.tailorId } : {}),
    ...(query.informToUserId ? { informToUserId: query.informToUserId } : {}),
    ...(query.defect || query.openOnly === 'true' || query.openOnly === true
      ? {
        defects: {
          some: {
            ...(query.defect ? { defect: query.defect } : {}),
            ...(query.openOnly === 'true' || query.openOnly === true ? { status: 'OPEN' } : {}),
          },
        },
      }
      : {}),
    ...between('entryDate', query.dateFrom, query.dateTo),
    ...searchFilter(search, ['unit', 'operation', 'sizeMeasurement', 'informToName', 'remarks', 'order.orderNo', 'style.styleNo', 'tailor.empName']),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.inlineQcEntry.findMany({ where, orderBy: orderBy ?? { entryDate: 'desc' }, skip, take, include: INCLUDE }),
    prisma.inlineQcEntry.count({ where }),
    prisma.inlineQcEntry.aggregate({ where, _sum: { pcsChecked: true, pcsRejected: true } }),
  ]);
  const openDefects = await prisma.inlineQcDefect.count({ where: { status: 'OPEN', entry: where } });
  return {
    rows: rows.map(project),
    total,
    page,
    pageSize,
    totals: {
      pcsChecked: D(sums._sum.pcsChecked).toString(),
      pcsRejected: D(sums._sum.pcsRejected).toString(),
      rejectionPct: rules.rejectionPct(sums._sum.pcsChecked, sums._sum.pcsRejected),
      openDefects,
    },
  };
}

/**
 * One check. A unit-bound login sees its own unit's checks, and any check
 * addressed to it.
 */
export async function getById(auth, id) {
  const scope = await scopeOf(auth);
  const row = await prisma.inlineQcEntry.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(scope.fixedUnit ? { OR: [{ unit: scope.fixedUnit }, { informToUserId: auth.userId }] } : {}),
    },
    include: INCLUDE,
  });
  if (!row) throw ApiError.notFound('Inline QC entry');
  return { ...project(row), canResolve: rules.mayResolve(resolverOf(auth), row) };
}

// ===========================================================================
//  WRITES
// ===========================================================================

/** The tailor, and the unit the check is for. */
async function resolveTailor(tx, tailorId, scope) {
  const t = await tx.employee.findFirst({
    where: { id: tailorId, deletedAt: null },
    select: { id: true, empName: true, designation: true, unitLine: true, status: true },
  });
  if (!t) throw ApiError.badRequest('That tailor does not exist', { field: 'tailorId' });
  if (t.status !== 'ACTIVE') throw ApiError.badRequest(`${t.empName} is inactive on the Employee Master`, { field: 'tailorId' });
  if (String(t.designation).toLowerCase() !== 'tailor') {
    throw ApiError.badRequest(`${t.empName} is not a tailor on the Employee Master`, { field: 'tailorId' });
  }
  if (!t.unitLine || !scope.units.includes(t.unitLine)) {
    throw ApiError.badRequest(`${t.empName} is not on a stitching unit - set the Unit / Line on the Employee Master`, { field: 'tailorId' });
  }
  if (scope.fixedUnit && t.unitLine !== scope.fixedUnit) {
    throw ApiError.forbidden(`You record for ${scope.fixedUnit} only; ${t.empName} is in ${t.unitLine}.`, { field: 'tailorId' });
  }
  return t;
}

/**
 * The order and style must have cut pieces posted to the unit, and a check
 * cannot look at more pieces than were cut for it.
 */
async function resolveOrderStyle(tx, { unit, orderId, styleId, pcsChecked }) {
  const [order, style, issued] = await Promise.all([
    tx.buyerOrder.findFirst({ where: { id: orderId, deletedAt: null }, select: { orderNo: true } }),
    tx.style.findFirst({ where: { id: styleId, deletedAt: null }, select: { styleNo: true } }),
    tx.cuttingIssue.aggregate({
      where: { firmName: unit, orderId, styleId, deletedAt: null, status: { not: 'CANCELLED' }, postedAt: { not: null } },
      _sum: { cuttingPcsIssued: true },
      _count: { _all: true },
    }),
  ]);
  if (!order) throw ApiError.badRequest('That order does not exist', { field: 'orderId' });
  if (!style) throw ApiError.badRequest('That style does not exist', { field: 'styleId' });
  const label = `${order.orderNo} / ${style.styleNo}`;
  if (issued._count._all === 0) {
    throw ApiError.badRequest(`No cutting has been issued to ${unit} for ${label}, so there is nothing of it on the line to check.`, { field: 'orderId' });
  }
  const cut = D(issued._sum.cuttingPcsIssued);
  if (D(pcsChecked).greaterThan(cut)) {
    throw ApiError.badRequest(`${unit} was issued ${cut} cut pieces of ${label} - a check cannot cover ${D(pcsChecked)}.`, { field: 'pcsChecked' });
  }
  return label;
}

/**
 * Operation and defects come from their lists. A value the entry already
 * holds is kept even if the list has since dropped it; it cannot be newly
 * chosen.
 */
async function assertListValues({ operation, defects }, held = { operation: null, defects: [] }) {
  const lists = await getManyByCode(['Operation', 'DefectType']);
  const ops = new Set(lists.Operation.map((v) => v.value));
  const kinds = new Set(lists.DefectType.map((v) => v.value));
  if (operation && !ops.has(operation) && operation !== held.operation) {
    throw ApiError.badRequest(`"${operation}" is not on the Operation list`, { field: 'operation' });
  }
  for (const d of defects) {
    if (!kinds.has(d) && !held.defects.includes(d)) {
      throw ApiError.badRequest(`"${d}" is not on the Defect Type list`, { field: 'defects' });
    }
  }
}

/** Tell the Inform To person, after the save has committed. Never fails the save. */
async function tellInformTo(auth, entry, defects, label) {
  if (!entry.informToUserId || !defects.length || entry.informToUserId === auth.userId) return;
  try {
    await notify({
      userIds: [entry.informToUserId],
      kind: 'INLINE_QC_DEFECT',
      title: `Inline QC: ${defects.length === 1 ? defects[0] : `${defects.length} defects`} - ${label}`,
      body: `${entry.unit}, tailor ${entry.tailorName}. ${D(entry.pcsRejected)} of ${D(entry.pcsChecked)} pieces rejected `
        + `(${defects.join(', ')}). Recorded by ${auth.fullName}.`,
      link: ACTIONS_LINK,
      documentType: 'INLINE_QC',
      documentId: entry.id,
    });
  } catch (e) {
    console.error('[inline-qc] notification failed', e);
  }
}

export async function create(auth, input) {
  const scope = await scopeOf(auth);
  const entryDate = checkedDate(input.entryDate);
  const defects = rules.normaliseDefects(input.defects);
  const size = rules.sizeFieldsFor(input.checkType, input);
  const data = {
    entryDate,
    checkType: input.checkType,
    ...size,
    pcsChecked: D(input.pcsChecked),
    pcsRejected: D(input.pcsRejected),
    informToUserId: input.informToUserId || null,
    remarks: input.remarks ?? null,
  };
  assertEntry({ ...data, defects });
  await assertListValues({ operation: data.operation, defects });

  const { row, label, tailorName } = await prisma.$transaction(async (tx) => {
    const tailor = await resolveTailor(tx, input.tailorId, scope);
    const unit = tailor.unitLine;
    const lbl = await resolveOrderStyle(tx, { unit, orderId: input.orderId, styleId: input.styleId, pcsChecked: data.pcsChecked });
    const informTo = await assertInformTo(tx, data.informToUserId);

    const created = await tx.inlineQcEntry.create({
      data: {
        ...data,
        tailorId: tailor.id,
        unit,
        orderId: input.orderId,
        styleId: input.styleId,
        informToName: informTo?.fullName ?? null,
        recordedById: auth.userId,
        recordedByName: auth.fullName,
        createdById: auth.userId,
        updatedById: auth.userId,
      },
    });
    // Row by row, so the audit trail has each defect line.
    for (const defect of defects) {
      await tx.inlineQcDefect.create({ data: { entryId: created.id, defect, createdById: auth.userId, updatedById: auth.userId } });
    }
    return {
      row: await tx.inlineQcEntry.findUnique({ where: { id: created.id }, include: INCLUDE }),
      label: lbl,
      tailorName: tailor.empName,
    };
  });

  await tellInformTo(auth, { ...row, tailorName }, defects, label);
  return project(row);
}

/**
 * Everything but the tailor, order and style, which are what the check IS.
 * A defect taken off is removed; a defect kept keeps its status, so one
 * already resolved stays resolved. Changing Inform To moves the open
 * defects to the new person's list.
 */
export async function update(auth, id, input) {
  const scope = await scopeOf(auth);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.inlineQcEntry.findFirst({
      where: { id, deletedAt: null, ...(scope.fixedUnit ? { unit: scope.fixedUnit } : {}) },
      include: { defects: true, tailor: { select: { empName: true } } },
    });
    if (!existing) throw ApiError.notFound('Inline QC entry');

    const checkType = input.checkType ?? existing.checkType;
    const size = rules.sizeFieldsFor(checkType, {
      operation: input.operation !== undefined ? input.operation : existing.operation,
      sizeMeasurement: input.sizeMeasurement !== undefined ? input.sizeMeasurement : existing.sizeMeasurement,
    });
    const wanted = input.defects !== undefined ? rules.normaliseDefects(input.defects) : existing.defects.map((d) => d.defect);
    const merged = {
      checkType,
      ...size,
      pcsChecked: input.pcsChecked !== undefined ? D(input.pcsChecked) : existing.pcsChecked,
      pcsRejected: input.pcsRejected !== undefined ? D(input.pcsRejected) : existing.pcsRejected,
      informToUserId: input.informToUserId !== undefined ? (input.informToUserId || null) : existing.informToUserId,
    };
    assertEntry({ ...merged, defects: wanted });
    await assertListValues(
      { operation: merged.operation, defects: wanted },
      { operation: existing.operation, defects: existing.defects.map((d) => d.defect) },
    );
    const label = await resolveOrderStyle(tx, { unit: existing.unit, orderId: existing.orderId, styleId: existing.styleId, pcsChecked: merged.pcsChecked });
    const informTo = await assertInformTo(tx, merged.informToUserId, {
      keeping: { id: existing.informToUserId, name: existing.informToName },
    });

    await tx.inlineQcEntry.update({
      where: { id },
      data: {
        ...(input.entryDate ? { entryDate: checkedDate(input.entryDate) } : {}),
        ...merged,
        informToName: informTo?.fullName ?? null,
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        updatedById: auth.userId,
      },
    });

    const diff = rules.diffDefects(existing.defects, wanted);
    for (const d of diff.drop) await tx.inlineQcDefect.delete({ where: { id: d.id } });
    for (const defect of diff.add) {
      await tx.inlineQcDefect.create({ data: { entryId: id, defect, createdById: auth.userId, updatedById: auth.userId } });
    }

    const row = await tx.inlineQcEntry.findUnique({ where: { id }, include: INCLUDE });
    // The new person hears about every open defect; the same person only
    // about the ones just added.
    const changedPerson = merged.informToUserId !== existing.informToUserId;
    const tell = changedPerson
      ? row.defects.filter((d) => d.status === 'OPEN').map((d) => d.defect)
      : diff.add;
    return { row, label, tell, tailorName: existing.tailor.empName };
  });

  await tellInformTo(auth, { ...result.row, tailorName: result.tailorName }, result.tell, result.label);
  return { ...project(result.row), canResolve: rules.mayResolve(resolverOf(auth), result.row) };
}

/** Soft delete: its defects leave the Action needed list. The trail keeps both. */
export async function remove(auth, id) {
  const scope = await scopeOf(auth);
  const existing = await prisma.inlineQcEntry.findFirst({
    where: { id, deletedAt: null, ...(scope.fixedUnit ? { unit: scope.fixedUnit } : {}) },
    select: { id: true },
  });
  if (!existing) throw ApiError.notFound('Inline QC entry');
  await prisma.inlineQcEntry.update({ where: { id }, data: { deletedAt: new Date(), deletedById: auth.userId } });
  return { id, deleted: true };
}

// ===========================================================================
//  THE ACTION NEEDED LIST
// ===========================================================================

const ACTION_INCLUDE = {
  entry: {
    select: {
      id: true,
      entryDate: true,
      checkType: true,
      unit: true,
      operation: true,
      sizeMeasurement: true,
      pcsChecked: true,
      pcsRejected: true,
      informToUserId: true,
      informToName: true,
      recordedByName: true,
      remarks: true,
      order: { select: { id: true, orderNo: true } },
      style: { select: { id: true, styleNo: true } },
      tailor: { select: { id: true, empId: true, empName: true } },
    },
  },
};

function projectAction(row, auth) {
  const e = row.entry;
  return {
    id: row.id,
    defect: row.defect,
    status: row.status,
    resolvedAt: row.resolvedAt,
    resolvedByName: row.resolvedByName,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt,
    entryId: e.id,
    entryDate: e.entryDate,
    checkType: rules.checkTypeLabel(e.checkType),
    unit: e.unit,
    orderNo: e.order?.orderNo ?? null,
    styleNo: e.style?.styleNo ?? null,
    tailor: e.tailor?.empName ?? null,
    tailorEmpId: e.tailor?.empId ?? null,
    operation: e.operation,
    sizeMeasurement: e.sizeMeasurement,
    pcsChecked: D(e.pcsChecked).toString(),
    pcsRejected: D(e.pcsRejected).toString(),
    informToUserId: e.informToUserId,
    informTo: e.informToName,
    foundBy: e.recordedByName,
    canResolve: auth ? rules.mayResolve(resolverOf(auth), e) : false,
  };
}

/**
 * The defects waiting on someone. By default the caller's own open lines.
 * `scope=all` is everyone's - held to the caller's unit when they have one.
 */
export async function actions(query, auth) {
  const unitScope = await scopeOf(auth);
  const { page, pageSize, skip, take, orderBy, search } = query;
  const everyone = query.scope === 'all';
  const status = query.status === 'ALL' ? null : (query.status || 'OPEN');

  const entry = {
    deletedAt: null,
    ...(everyone
      ? {
        ...(unitScope.fixedUnit ? { unit: unitScope.fixedUnit } : query.unit ? { unit: query.unit } : {}),
        ...(query.informToUserId ? { informToUserId: query.informToUserId } : {}),
      }
      : { informToUserId: auth.userId }),
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...between('entryDate', query.dateFrom, query.dateTo),
  };
  const where = {
    entry,
    ...(status ? { status } : {}),
    ...searchFilter(search, ['defect', 'entry.unit', 'entry.order.orderNo', 'entry.style.styleNo', 'entry.tailor.empName']),
  };

  const [rows, total] = await Promise.all([
    prisma.inlineQcDefect.findMany({ where, orderBy: orderBy ?? [{ status: 'asc' }, { createdAt: 'asc' }], skip, take, include: ACTION_INCLUDE }),
    prisma.inlineQcDefect.count({ where }),
  ]);
  return { rows: rows.map((r) => projectAction(r, auth)), total, page, pageSize };
}

async function findAction(tx, defectId) {
  const row = await tx.inlineQcDefect.findFirst({ where: { id: defectId, entry: { deletedAt: null } }, include: ACTION_INCLUDE });
  if (!row) throw ApiError.notFound('Defect');
  return row;
}

function assertMayResolve(auth, row) {
  if (rules.mayResolve(resolverOf(auth), row.entry)) return;
  throw ApiError.forbidden(
    row.entry.informToName
      ? `This defect went to ${row.entry.informToName}; only they can mark it.`
      : 'This defect was sent to nobody, so only Admin can mark it.',
  );
}

export async function resolve(auth, defectId, { note } = {}) {
  return prisma.$transaction(async (tx) => {
    const row = await findAction(tx, defectId);
    assertMayResolve(auth, row);
    if (row.status === 'RESOLVED') throw ApiError.conflict(`${row.defect} was already resolved by ${row.resolvedByName ?? 'someone'}`);
    await tx.inlineQcDefect.update({
      where: { id: defectId },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedById: auth.userId,
        resolvedByName: auth.fullName,
        resolutionNote: note ? String(note).trim() || null : null,
        updatedById: auth.userId,
      },
    });
    return projectAction(await findAction(tx, defectId), auth);
  });
}

/** Undo a Resolved marked by mistake. The trail keeps both. */
export async function reopen(auth, defectId) {
  return prisma.$transaction(async (tx) => {
    const row = await findAction(tx, defectId);
    assertMayResolve(auth, row);
    if (row.status === 'OPEN') return projectAction(row, auth);
    await tx.inlineQcDefect.update({
      where: { id: defectId },
      data: { status: 'OPEN', resolvedAt: null, resolvedById: null, resolvedByName: null, resolutionNote: null, updatedById: auth.userId },
    });
    return projectAction(await findAction(tx, defectId), auth);
  });
}
