/**
 * Fabric Scrutiny Report. Sheet: "Fabric Scrutiny Report"
 * (Role Acess - QC; the decision itself rests with Dinesh Sir).
 *
 * ===========================================================================
 *  A FINALISED SCRUTINY IS LOCKED
 * ===========================================================================
 *
 * A scrutiny is not paperwork about fabric. It is the document on the strength
 * of which a roll gets released to the cutting floor, sent back for rework, or
 * written off and debited to a vendor. By the time the decision is a day old,
 * money and material have both moved because of it.
 *
 * So the record has two lives:
 *
 *   OPEN     QC has recorded what they found. The row is editable.
 *   LOCKED   The decision has been taken. The row stops moving - permanently.
 *
 * `finalise()` is the one-way door. After it:
 *
 *   - `update()` refuses. There is no force flag and no admin override.
 *   - `amend()` is the only way to change anything, and it does not edit
 *     history: it writes a DocumentAmendment holding the reason and a
 *     field-level before/after set, THEN applies the change. What the record
 *     said on the day it was decided remains recoverable, which is the whole
 *     point of an amendment rather than an edit.
 *   - the roll is moved by the decision itself, in the same transaction:
 *     ACCEPT releases it, REWORK and REJECT hold it.
 *
 * ---------------------------------------------------------------------------
 *  WHY REJECT DOES NOT WRITE THE STOCK OFF HERE
 *
 *  A rejected quantity is a claim against a vendor before it is a stock
 *  adjustment, and the workbook settles it with a debit note that this system
 *  does not model. Writing the fabric out of the ledger on rejection would
 *  quietly destroy the evidence the claim rests on. The roll is HELD instead -
 *  visible, unusable, and still on the books - which is what the sheet's own
 *  "Debit note to vendor" remark implies.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError, ERROR_CODES } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber, peekNumber } from './documentNumber.service.js';

export const SORTABLE = [
  'scrutinyNo',
  'scrutinyDate',
  'defectType',
  'qtyAffected',
  'decision',
  'createdAt',
];

const SEARCH = ['scrutinyNo', 'defectType', 'checkedByName', 'authorisedBy', 'remarks'];

const D = (v) => new Prisma.Decimal(v ?? 0);

/**
 * What each decision does to the roll.
 *
 * The decision is the only thing on this sheet that has a physical consequence,
 * so the consequence is written down beside it rather than left to a screen.
 */
export const DECISION_EFFECT = {
  ACCEPT: {
    label: 'Accept',
    rollStage: null, // released as it was; the defect is tolerated
    isHeld: false,
    summary: 'The roll is released. The defect is within what the buyer will take.',
  },
  REWORK: {
    label: 'Rework',
    rollStage: 'SCRUTINY_HOLD',
    isHeld: true,
    summary: 'The roll is held for rework - usually back to the vendor, at their cost.',
  },
  REJECT: {
    label: 'Reject',
    rollStage: 'REJECTED',
    isHeld: true,
    summary:
      'The roll is rejected and held. The stock stays on the books as evidence for the ' +
      'debit note; it is not written off here.',
  },
};

const INCLUDE = {
  /**
   * C4 - the structured findings behind the decision.
   *
   * Without this the lines were written and stored correctly and then never
   * came back on a read, so the detail screen's findings table could not
   * render and a checker had no way to see what had been recorded. Each line
   * names its own roll, because a checking report routinely covers a lot.
   */
  defects: {
    where: { deletedAt: null },
    orderBy: { lineNo: 'asc' },
    include: { roll: { select: { id: true, rollNo: true } } },
  },
  roll: {
    select: {
      id: true,
      rollNo: true,
      fabricName: true,
      colorCode: true,
      content: true,
      count: true,
      gsm: true,
      uom: true,
      receivedQty: true,
      balanceQty: true,
      stage: true,
      location: true,
      isHeld: true,
      vendor: { select: { id: true, vendorName: true } },
      grn: { select: { id: true, grnNo: true } },
    },
  },
  order: {
    select: {
      id: true,
      orderNo: true,
      status: true,
      buyer: { select: { id: true, buyerName: true } },
    },
  },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  checkedByEmployee: {
    select: { id: true, empId: true, empName: true, department: true, designation: true },
  },
};

const LIST_INCLUDE = {
  roll: { select: { id: true, rollNo: true, fabricName: true, colorCode: true } },
  order: { select: { id: true, orderNo: true } },
  style: { select: { id: true, styleNo: true } },
};

// ===========================================================================
//  VALIDATION HELPERS
// ===========================================================================

async function validateDropdowns(data) {
  if (data.defectType !== undefined) {
    await assertValueInList('DefectType', data.defectType, { field: 'defectType', required: true });
  }
  if (data.uom !== undefined) await assertValueInList('UOM', data.uom, { field: 'uom' });
  if (data.authorisedBy !== undefined) {
    await assertValueInList('AuthorisedBy', data.authorisedBy, { field: 'authorisedBy' });
  }
}

async function resolveRoll(rollId) {
  const roll = await prisma.fabricRoll.findFirst({
    where: { id: rollId, deletedAt: null },
    select: { id: true, rollNo: true, receivedQty: true, balanceQty: true, uom: true, stage: true },
  });
  if (!roll) throw ApiError.badRequest('Fabric roll does not exist', { field: 'rollId' });
  return roll;
}

async function resolveChecker(checkedByEmployeeId, checkedByName) {
  if (checkedByEmployeeId) {
    const employee = await prisma.employee.findFirst({
      where: { id: checkedByEmployeeId, deletedAt: null },
    });
    if (!employee) {
      throw ApiError.badRequest('Employee does not exist', { field: 'checkedByEmployeeId' });
    }
    if (employee.status !== 'ACTIVE') {
      throw ApiError.badRequest(`${employee.empName} is inactive`, {
        field: 'checkedByEmployeeId',
      });
    }
    return employee;
  }
  if (!checkedByName) {
    throw ApiError.badRequest('Name the checker', { field: 'checkedByEmployeeId' });
  }
  return prisma.employee.findFirst({
    where: { empName: checkedByName, deletedAt: null, status: 'ACTIVE' },
  });
}

/** The one-way door, stated once so every caller refuses for the same reason. */
function assertOpen(scrutiny, what = 'changed') {
  if (!scrutiny.isLocked) return;
  throw new ApiError(
    409,
    `${scrutiny.scrutinyNo} was finalised as ${scrutiny.decision} on ` +
      `${new Date(scrutiny.lockedAt ?? scrutiny.decidedAt).toISOString().slice(0, 10)} and cannot ` +
      `be ${what}. A roll has been released or held on the strength of it. ` +
      'Record an amendment instead - it keeps what the record said before.',
    {
      code: ERROR_CODES.DOCUMENT_LOCKED,
      details: {
        isLocked: true,
        decision: scrutiny.decision,
        lockedAt: scrutiny.lockedAt,
        amendmentCount: scrutiny.amendmentCount,
      },
    },
  );
}

// ===========================================================================
//  PROJECTION
// ===========================================================================

function project(s) {
  if (!s) return s;
  const affected = D(s.qtyAffected);
  const rollQty = D(s.roll?.receivedQty ?? 0);
  return {
    ...s,
    effect: DECISION_EFFECT[s.decision],
    finalised: s.isLocked,
    /** How much of the roll the defect covers - the number the Director weighs. */
    affectedPctOfRoll: rollQty.isZero()
      ? null
      : affected.div(rollQty).mul(100).toDecimalPlaces(2).toFixed(2),
    amended: s.amendmentCount > 0,
  };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    decision, rollId, orderId, styleId, defectType, checkedBy, isLocked, dateFrom, dateTo,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(decision ? { decision } : {}),
    ...(rollId ? { rollId } : {}),
    ...(orderId ? { orderId } : {}),
    ...(styleId ? { styleId } : {}),
    ...(defectType ? { defectType } : {}),
    ...(checkedBy ? { checkedByEmployeeId: checkedBy } : {}),
    ...(isLocked !== undefined ? { isLocked } : {}),
    ...(dateFrom || dateTo
      ? {
          scrutinyDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total, totals] = await Promise.all([
    prisma.fabricScrutiny.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.fabricScrutiny.count({ where }),
    prisma.fabricScrutiny.aggregate({ where, _sum: { qtyAffected: true } }),
  ]);

  return {
    rows: rows.map(project),
    total,
    page,
    pageSize,
    totals: { qtyAffected: D(totals._sum.qtyAffected ?? 0).toFixed(4) },
  };
}

export async function getById(id) {
  const scrutiny = await prisma.fabricScrutiny.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!scrutiny) throw ApiError.notFound('Fabric scrutiny');

  const [amendments, siblings, history] = await Promise.all([
    prisma.documentAmendment.findMany({
      where: { documentType: 'FABRIC_SCRUTINY', documentId: id },
      orderBy: { amendmentNo: 'asc' },
    }),
    // Every other scrutiny on the same roll. A roll with four defect reports
    // against it is a different conversation from one with a single stain.
    prisma.fabricScrutiny.findMany({
      where: { rollId: scrutiny.rollId, id: { not: id }, deletedAt: null },
      orderBy: { scrutinyDate: 'asc' },
      include: LIST_INCLUDE,
    }),
    prisma.approvalHistory.findMany({
      where: { documentType: 'FABRIC_SCRUTINY', documentId: id },
      orderBy: { actedAt: 'asc' },
    }),
  ]);

  const totalAffected = [scrutiny, ...siblings].reduce((a, s) => a.plus(D(s.qtyAffected)), D(0));

  return {
    ...project(scrutiny),
    amendments,
    otherScrutinies: {
      count: siblings.length,
      rows: siblings.map(project),
      totalQtyAffectedOnRoll: totalAffected.toFixed(4),
    },
    history,
    editable: {
      canEdit: !scrutiny.isLocked,
      canFinalise: !scrutiny.isLocked,
      canAmend: scrutiny.isLocked,
      canDelete: !scrutiny.isLocked,
    },
  };
}

// ===========================================================================
//  COMMANDS
// ===========================================================================

/**
 * Records what QC found.
 *
 * The decision defaults to ACCEPT and means nothing until `finalise()` - the
 * row is a finding, not a ruling, and the roll is untouched. That separation is
 * deliberate: QC records, the Director decides, and a checker filling in a form
 * on the inspection table must not be able to reject a roll by accident.
 */
export async function create(input, actorId) {
  await validateDropdowns(input);

  const roll = await resolveRoll(input.rollId);
  const employee = await resolveChecker(input.checkedByEmployeeId, input.checkedByName);

  const order = await prisma.buyerOrder.findFirst({
    where: { id: input.orderId, deletedAt: null },
    select: { id: true, orderNo: true, styleId: true },
  });
  if (!order) throw ApiError.badRequest('Order does not exist', { field: 'orderId' });

  const affected = D(input.qtyAffected);
  if (!affected.greaterThan(0)) {
    throw ApiError.badRequest('Quantity affected must be greater than zero', {
      field: 'qtyAffected',
    });
  }
  if (affected.greaterThan(D(roll.receivedQty))) {
    throw ApiError.badRequest(
      `Roll ${roll.rollNo} was received at ${D(roll.receivedQty).toFixed(4)} ${roll.uom}. ` +
        `${affected.toFixed(4)} cannot be affected.`,
      { field: 'qtyAffected' },
    );
  }

  const scrutiny = await prisma.$transaction(async (tx) => {
    const scrutinyNo = input.scrutinyNo?.trim() || (await nextNumber('FABRIC_SCRUTINY', { tx }));
    const clash = await tx.fabricScrutiny.findUnique({
      where: { scrutinyNo },
      select: { id: true },
    });
    if (clash) {
      throw ApiError.conflict('This scrutiny number already exists', { field: 'scrutinyNo' });
    }

    return tx.fabricScrutiny.create({
      data: {
        // C4 - the structured findings. The header's own defectType and
        // qtyAffected stay as the SUMMARY - they are what the workbook prints -
        // and these are the detail a director actually decides on.
        ...(input.defects?.length
          ? {
              defects: {
                create: input.defects.map((d, i) => ({
                  lineNo: d.lineNo ?? i + 1,
                  category: d.category,
                  defectType: d.defectType,
                  rollId: d.rollId ?? roll.id,
                  qty: D(d.qty),
                  uom: d.uom ?? input.uom ?? roll.uom,
                  remarks: d.remarks ?? null,
                  createdById: actorId,
                  updatedById: actorId,
                })),
              },
            }
          : {}),
        scrutinyNo,
        scrutinyDate: input.scrutinyDate ? new Date(input.scrutinyDate) : new Date(),
        rollId: roll.id,
        orderId: order.id,
        styleId: input.styleId ?? order.styleId,
        defectType: input.defectType,
        qtyAffected: affected,
        uom: input.uom ?? roll.uom,
        checkedByEmployeeId: employee?.id ?? null,
        checkedByName: employee?.empName ?? input.checkedByName,
        authorisedBy: input.authorisedBy ?? null,
        // A finding, not yet a ruling. Nothing happens to the roll until
        // finalise() is called and the decision is taken for real.
        decision: input.decision ?? 'ACCEPT',
        remarks: input.remarks ?? null,
        isLocked: false,
        createdById: actorId,
        updatedById: actorId,
      },
      include: LIST_INCLUDE,
    });
  });

  await recordHistory(scrutiny, 'SUBMITTED', {
    toStatus: 'OPEN',
    actorId,
    remarks:
      `${input.defectType} on roll ${roll.rollNo}: ${affected.toFixed(4)} ` +
      `${input.uom ?? roll.uom} affected`,
  });

  return project(scrutiny);
}

/** Edits an open scrutiny. Refused the moment it is finalised. */
export async function update(id, input, actorId) {
  const existing = await prisma.fabricScrutiny.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw ApiError.notFound('Fabric scrutiny');
  assertOpen(existing, 'edited');

  await validateDropdowns(input);
  if (input.rollId !== undefined) await resolveRoll(input.rollId);

  const updated = await prisma.fabricScrutiny.update({
    where: { id },
    data: {
      ...(input.scrutinyDate !== undefined ? { scrutinyDate: new Date(input.scrutinyDate) } : {}),
      ...(input.rollId !== undefined ? { rollId: input.rollId } : {}),
      ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
      ...(input.styleId !== undefined ? { styleId: input.styleId } : {}),
      ...(input.defectType !== undefined ? { defectType: input.defectType } : {}),
      ...(input.qtyAffected !== undefined ? { qtyAffected: D(input.qtyAffected) } : {}),
      ...(input.uom !== undefined ? { uom: input.uom } : {}),
      ...(input.checkedByName !== undefined ? { checkedByName: input.checkedByName } : {}),
      ...(input.checkedByEmployeeId !== undefined
        ? { checkedByEmployeeId: input.checkedByEmployeeId }
        : {}),
      ...(input.authorisedBy !== undefined ? { authorisedBy: input.authorisedBy } : {}),
      ...(input.decision !== undefined ? { decision: input.decision } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  return project(updated);
}

/**
 * Takes the decision, and locks the record.
 *
 * One transaction: the decision, the lock, and what the decision does to the
 * roll. After this the row is immutable and only `amend()` can touch it.
 *
 * @param {{userId: string, fullName: string}} actor
 */
export async function finalise(id, input, actor) {
  const { decision, authorisedBy, remarks } = input ?? {};
  const scrutiny = await prisma.fabricScrutiny.findFirst({
    where: { id, deletedAt: null },
    include: { roll: true },
  });
  if (!scrutiny) throw ApiError.notFound('Fabric scrutiny');
  assertOpen(scrutiny, 'finalised again');

  const effect = DECISION_EFFECT[decision];
  if (!effect) throw ApiError.badRequest(`Unknown decision "${decision}"`, { field: 'decision' });
  if (authorisedBy) {
    await assertValueInList('AuthorisedBy', authorisedBy, { field: 'authorisedBy' });
  }

  /**
   * C4 - A REWORK OR A REJECTION HAS TO SAY WHAT WAS FOUND.
   *
   * "If disposition is REWORK or REJECT, at least one defect line must exist.
   * Otherwise posting must fail."
   *
   * Sending a lot back to a job worker, or writing it off, costs real money and
   * is argued about later. A decision with no recorded finding behind it cannot
   * be defended, and - because REWORK routes the fabric back to Job Work - it
   * also gives the job worker nothing to correct.
   *
   * Checked here for the message, and by the
   * `fabric_scrutinies_decision_needs_defects` trigger for the guarantee. Rule
   * 19: a business rule with only application validation behind it is not
   * implemented.
   */
  const decidedAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    // Lines supplied with the decision are written FIRST, so the trigger that
    // fires on the header update below can see them.
    if (input?.defects?.length) {
      const existingLines = await tx.fabricScrutinyDefect.count({
        where: { scrutinyId: id, deletedAt: null },
      });
      await tx.fabricScrutinyDefect.createMany({
        data: input.defects.map((d, i) => ({
          scrutinyId: id,
          lineNo: d.lineNo ?? existingLines + i + 1,
          category: d.category,
          defectType: d.defectType,
          rollId: d.rollId ?? scrutiny.rollId,
          qty: D(d.qty),
          uom: d.uom ?? scrutiny.uom,
          remarks: d.remarks ?? null,
          createdById: actor.userId ?? null,
          updatedById: actor.userId ?? null,
        })),
      });
    }

    if (decision === 'REWORK' || decision === 'REJECT') {
      const found = await tx.fabricScrutinyDefect.count({
        where: { scrutinyId: id, deletedAt: null },
      });
      if (found === 0) {
        throw ApiError.badRequest(
          `${scrutiny.scrutinyNo} cannot be posted as ${decision.toLowerCase()} without at least ` +
            'one defect line. Record what was found - which roll, how much, and what the defect ' +
            'was - before taking the decision.',
          {
            field: 'defects',
            decision,
            required: 'At least one defect line (roll, quantity, defect type).',
          },
        );
      }

      // The header's qtyAffected is the SUMMARY of the lines. Kept in step
      // here rather than left to disagree with the detail beneath it.
      const total = await tx.fabricScrutinyDefect.aggregate({
        where: { scrutinyId: id, deletedAt: null },
        _sum: { qty: true },
      });
      await tx.fabricScrutiny.update({
        where: { id },
        data: { qtyAffected: D(total._sum.qty ?? scrutiny.qtyAffected) },
      });
    }

    const row = await tx.fabricScrutiny.update({
      where: { id },
      data: {
        decision,
        authorisedBy: authorisedBy ?? scrutiny.authorisedBy ?? actor.fullName,
        remarks: remarks ?? scrutiny.remarks,
        decidedAt,
        decidedById: actor.userId,
        decidedByName: actor.fullName,
        // The one-way door.
        isLocked: true,
        lockedAt: decidedAt,
        lockedById: actor.userId,
        updatedById: actor.userId,
      },
      include: LIST_INCLUDE,
    });

    // What the decision does to the fabric, in the same transaction as the
    // decision itself - so a roll is never released by a scrutiny that failed
    // to save, and never left held by one that saved.
    await tx.fabricRoll.update({
      where: { id: scrutiny.rollId },
      data: {
        isHeld: effect.isHeld,
        ...(effect.rollStage ? { stage: effect.rollStage } : {}),
        remarks:
          decision === 'ACCEPT'
            ? scrutiny.roll.remarks
            : `${effect.label} on ${row.scrutinyNo}: ${scrutiny.defectType}, ` +
              `${D(scrutiny.qtyAffected).toFixed(4)} ${scrutiny.uom} affected`,
        updatedById: actor.userId,
      },
    });

    return row;
  });

  await recordHistory(updated, decision === 'ACCEPT' ? 'APPROVED' : 'REJECTED', {
    fromStatus: 'OPEN',
    toStatus: decision,
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks: remarks ?? effect.summary,
  });

  return project(updated);
}

/**
 * Amends a finalised scrutiny.
 *
 * This is the ONLY way a locked record changes, and it is not an edit. The
 * before/after set is written to document_amendments first, with the reason,
 * and only then is the change applied - so the record as it stood when the
 * decision was taken stays recoverable from the amendment trail.
 *
 * A changed decision re-applies its effect to the roll, in the same
 * transaction, because an amendment that says "actually, reject" and leaves the
 * roll released would be worse than no amendment at all.
 *
 * @param {{userId: string, fullName: string}} actor
 */
export async function amend(id, { reason, changes, remarks }, actor) {
  const scrutiny = await prisma.fabricScrutiny.findFirst({
    where: { id, deletedAt: null },
    include: { roll: true },
  });
  if (!scrutiny) throw ApiError.notFound('Fabric scrutiny');

  if (!scrutiny.isLocked) {
    throw ApiError.badRequest(
      `${scrutiny.scrutinyNo} has not been finalised. Edit it directly - an amendment is for ` +
        'records that are already locked.',
    );
  }

  // Only the findings and the decision can be amended. The roll, the order and
  // the style identify WHICH scrutiny this is; a report about a different roll
  // is a different report.
  const AMENDABLE = ['defectType', 'qtyAffected', 'decision', 'authorisedBy', 'checkedByName', 'remarks'];
  const applied = {};
  const before = {};
  const after = {};

  for (const [field, value] of Object.entries(changes ?? {})) {
    if (!AMENDABLE.includes(field)) {
      throw ApiError.badRequest(
        `"${field}" cannot be amended. A scrutiny about a different roll, order or style is a ` +
          'different scrutiny - record a new one.',
        { field, amendable: AMENDABLE },
      );
    }
    const current = scrutiny[field];
    const currentText = current instanceof Prisma.Decimal ? current.toString() : current;
    if (String(currentText ?? '') === String(value ?? '')) continue;

    before[field] = currentText ?? null;
    after[field] = value ?? null;
    applied[field] = field === 'qtyAffected' ? D(value) : value;
  }

  if (Object.keys(applied).length === 0) {
    throw ApiError.badRequest('An amendment has to change something.', { field: 'changes' });
  }

  if (applied.defectType) {
    await assertValueInList('DefectType', applied.defectType, { field: 'defectType' });
  }
  if (applied.authorisedBy) {
    await assertValueInList('AuthorisedBy', applied.authorisedBy, { field: 'authorisedBy' });
  }
  if (applied.decision && !DECISION_EFFECT[applied.decision]) {
    throw ApiError.badRequest(`Unknown decision "${applied.decision}"`, { field: 'decision' });
  }
  if (applied.qtyAffected) {
    if (!D(applied.qtyAffected).greaterThan(0)) {
      throw ApiError.badRequest('Quantity affected must be greater than zero', {
        field: 'qtyAffected',
      });
    }
    if (D(applied.qtyAffected).greaterThan(D(scrutiny.roll.receivedQty))) {
      throw ApiError.badRequest(
        `Roll ${scrutiny.roll.rollNo} was received at ` +
          `${D(scrutiny.roll.receivedQty).toFixed(4)} ${scrutiny.roll.uom}.`,
        { field: 'qtyAffected' },
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    // The record of what changed goes down FIRST. If applying the change fails,
    // the amendment goes with it; if writing the amendment fails, the change
    // never happens. Either way the two never disagree.
    const previous = await tx.documentAmendment.count({
      where: { documentType: 'FABRIC_SCRUTINY', documentId: id },
    });
    await tx.documentAmendment.create({
      data: {
        documentType: 'FABRIC_SCRUTINY',
        documentId: id,
        documentNo: scrutiny.scrutinyNo,
        amendmentNo: previous + 1,
        reason,
        changes: { before, after },
        remarks: remarks ?? null,
        amendedById: actor.userId,
      },
    });

    const row = await tx.fabricScrutiny.update({
      where: { id },
      data: {
        ...applied,
        amendmentCount: previous + 1,
        // The record stays locked. An amendment does not reopen it.
        updatedById: actor.userId,
      },
      include: LIST_INCLUDE,
    });

    // A changed decision has to reach the roll, or the amendment is a lie.
    if (applied.decision) {
      const effect = DECISION_EFFECT[applied.decision];
      await tx.fabricRoll.update({
        where: { id: scrutiny.rollId },
        data: {
          isHeld: effect.isHeld,
          ...(effect.rollStage ? { stage: effect.rollStage } : {}),
          remarks:
            `${effect.label} on ${scrutiny.scrutinyNo} (amendment ${previous + 1}): ${reason}`,
          updatedById: actor.userId,
        },
      });
    }

    return row;
  });

  await recordHistory(updated, 'REWORK_REQUESTED', {
    fromStatus: scrutiny.decision,
    toStatus: applied.decision ?? scrutiny.decision,
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks: `Amendment ${updated.amendmentCount}: ${reason}`,
  });

  return getById(id);
}

/** Deletes an open scrutiny. A finalised one is a decision and stays. */
export async function remove(id, actorId) {
  const scrutiny = await prisma.fabricScrutiny.findFirst({ where: { id, deletedAt: null } });
  if (!scrutiny) throw ApiError.notFound('Fabric scrutiny');
  assertOpen(scrutiny, 'deleted');

  await prisma.fabricScrutiny.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId },
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

async function recordHistory(s, action, { fromStatus, toStatus, actorId, actorName, remarks }) {
  const previous = await prisma.approvalHistory.count({
    where: { documentType: 'FABRIC_SCRUTINY', documentId: s.id },
  });
  await prisma.approvalHistory.create({
    data: {
      documentType: 'FABRIC_SCRUTINY',
      documentId: s.id,
      documentNo: s.scrutinyNo,
      sequenceNo: previous + 1,
      action,
      fromStatus: fromStatus ?? null,
      toStatus: toStatus ?? null,
      actedByName: actorName ?? null,
      actedById: actorId ?? null,
      remarks: remarks ?? null,
    },
  });
}

/** The three decisions and what each does, for the UI to render honestly. */
export function decisions() {
  return Object.entries(DECISION_EFFECT).map(([decision, effect]) => ({ decision, ...effect }));
}

/** What a scrutiny will look like, and do, before it is saved. */
export async function preview({ rollId, qtyAffected, decision }) {
  const roll = await prisma.fabricRoll.findFirst({
    where: { id: rollId, deletedAt: null },
    include: {
      vendor: { select: { id: true, vendorName: true } },
      grn: { select: { id: true, grnNo: true } },
    },
  });
  if (!roll) throw ApiError.notFound('Fabric roll');

  const affected = D(qtyAffected ?? 0);
  const received = D(roll.receivedQty);

  const existing = await prisma.fabricScrutiny.findMany({
    where: { rollId, deletedAt: null },
    select: { scrutinyNo: true, defectType: true, qtyAffected: true, decision: true },
  });
  const alreadyAffected = existing.reduce((a, s) => a.plus(D(s.qtyAffected)), D(0));

  return {
    roll: {
      id: roll.id,
      rollNo: roll.rollNo,
      fabricName: roll.fabricName,
      colorCode: roll.colorCode,
      gsm: roll.gsm,
      uom: roll.uom,
      receivedQty: received.toFixed(4),
      balanceQty: D(roll.balanceQty).toFixed(4),
      stage: roll.stage,
      isHeld: roll.isHeld,
      vendorName: roll.vendor?.vendorName ?? null,
      grnNo: roll.grn?.grnNo ?? null,
    },
    qtyAffected: affected.toFixed(4),
    affectedPctOfRoll: received.isZero()
      ? null
      : affected.div(received).mul(100).toDecimalPlaces(2).toFixed(2),
    /** Everything already reported against this roll, so nothing is double-counted. */
    priorScrutinies: {
      count: existing.length,
      totalQtyAffected: alreadyAffected.toFixed(4),
      rows: existing,
    },
    cumulativeQtyAffected: alreadyAffected.plus(affected).toFixed(4),
    exceedsRoll: alreadyAffected.plus(affected).greaterThan(received),
    /** What finalising with this decision would do. Said before, not after. */
    effect: decision ? DECISION_EFFECT[decision] : null,
    nextScrutinyNo: await peekNumber('FABRIC_SCRUTINY'),
  };
}
