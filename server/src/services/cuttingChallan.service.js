/**
 * C5 - CUTTING CHALLAN.
 *
 * ===========================================================================
 *  THE DOCUMENT THAT WAS MISSING
 * ===========================================================================
 *
 * The cutting department does not draw fabric out of the store on a nod. It
 * raises a requirement, that requirement is approved against an approved plan,
 * and every Fabric Issue quotes a line of it.
 *
 * Before this module there was nothing between "cutting needs cloth" and a
 * Fabric Issue: no approved statement of what was needed, nothing to reconcile
 * the issues against, and no way to refuse an issue nobody had asked for.
 *
 * ---------------------------------------------------------------------------
 *  PARTIAL FULFILMENT YES. OVER-FULFILMENT NEVER.
 *
 *      Challan line 100 m
 *      Issue 1  40 m   ->  issued 40, still open
 *      Issue 2  30 m   ->  issued 70, still open
 *      Issue 3  30 m   ->  issued 100, COMPLETED
 *      Issue 4   1 m   ->  REFUSED
 *
 *  `issuedQty` is RE-DERIVED from the posted fabric issues inside the same
 *  transaction that posts one - never incremented from a number a caller
 *  supplied. A total that is added to can drift; a total that is recomputed
 *  from its own source cannot. The same reasoning as `stock_balances`.
 *
 *  And the rule is not only in this file:
 *  `cutting_challan_lines_no_over_fulfilment` enforces issued <= required in
 *  PostgreSQL, so a caller that never comes through this service still cannot
 *  over-issue.
 *
 *  CLOSING SHORT IS A DIFFERENT FACT FROM BEING FILLED.
 *
 *  Cutting may decide it needs no more of a line. That is a decision somebody
 *  takes and answers for, so it is recorded as one - who, when, why - rather
 *  than disguised as completion.
 *
 *  ---------------------------------------------------------------------------
 *  THE REQUIREMENT ON A CHALLAN LINE IS THE SHARED CALCULATION
 *
 *  C9: Planning, the purchase order ceiling and this document must all show
 *  the same requirement for the same style and order. They do, because all
 *  three call `domain/requirement.js` and none of them carries a formula.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError, ERROR_CODES } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber, peekNumber } from './documentNumber.service.js';
import * as engine from './approvalEngine.js';
import { categoryOfLine } from '../domain/itemCategory.js';
import { requirementFor } from '../domain/requirement.js';
import { assertNotSelfApproval } from '../domain/makerChecker.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

export const SORTABLE = ['challanNo', 'challanDate', 'status', 'requiredBy', 'createdAt'];
const SEARCH = ['challanNo', 'containerNo', 'remarks'];

const LINE_INCLUDE = {
  orderBy: { lineNo: 'asc' },
  where: { deletedAt: null },
};

const INCLUDE = {
  order: {
    select: {
      id: true,
      orderNo: true,
      orderQty: true,
      effectiveQty: true,
      status: true,
      buyer: { select: { id: true, buyerCode: true, buyerName: true } },
    },
  },
  style: {
    select: {
      id: true,
      styleNo: true,
      styleDescription: true,
      avgFabricUtilizationPerPc: true,
      avgUtilizationUom: true,
    },
  },
  planning: {
    select: {
      id: true,
      planNo: true,
      planDepartment: true,
      plannedQty: true,
      plannedCuttingPcs: true,
      containerNo: true,
      approvalStatus: true,
      workflowState: true,
    },
  },
  planApproval: {
    select: {
      id: true,
      approvalNo: true,
      round: true,
      approvalStatus: true,
      isCurrent: true,
      workflowState: true,
    },
  },
  lines: {
    ...LINE_INCLUDE,
    include: {
      fabricIssues: {
        where: { deletedAt: null },
        select: {
          id: true,
          issueNo: true,
          issueDate: true,
          fabricQtyIssued: true,
          uom: true,
          postedAt: true,
          roll: { select: { id: true, rollNo: true } },
        },
        orderBy: { issueDate: 'asc' },
      },
    },
  },
};

const LIST_INCLUDE = {
  order: { select: { id: true, orderNo: true } },
  style: { select: { id: true, styleNo: true } },
  lines: { ...LINE_INCLUDE, select: { id: true, requiredQty: true, issuedQty: true, status: true, uom: true } },
};

// ===========================================================================
//  PROJECTION
// ===========================================================================

function projectLine(line) {
  const required = D(line.requiredQty);
  const issued = D(line.issuedQty);
  const outstanding = required.minus(issued);

  return {
    ...line,
    outstandingQty: (outstanding.isNegative() ? ZERO : outstanding).toFixed(4),
    fulfilledPct: required.isZero()
      ? '0.00'
      : issued.div(required).mul(100).toDecimalPlaces(2).toFixed(2),
    /** Whether another issue may still be raised against this line at all. */
    open: line.status !== 'COMPLETED' && line.status !== 'CANCELLED' && outstanding.greaterThan(0),
  };
}

function project(challan) {
  if (!challan) return challan;
  const lines = (challan.lines ?? []).map(projectLine);

  const required = lines.reduce((a, l) => a.plus(D(l.requiredQty)), ZERO);
  const issued = lines.reduce((a, l) => a.plus(D(l.issuedQty)), ZERO);

  return {
    ...challan,
    lines,
    totals: {
      requiredQty: required.toFixed(4),
      issuedQty: issued.toFixed(4),
      outstandingQty: (() => {
        const left = required.minus(issued);
        return (left.isNegative() ? ZERO : left).toFixed(4);
      })(),
      fulfilledPct: required.isZero()
        ? '0.00'
        : issued.div(required).mul(100).toDecimalPlaces(2).toFixed(2),
    },
    approved: challan.workflowState === 'APPROVED' || challan.workflowState === 'COMPLETED',
    closedShort: Boolean(challan.closedShortAt),
    /** A challan may only be edited while nobody has acted on it. */
    editable: challan.workflowState === 'DRAFT' || challan.workflowState === 'REJECTED',
    workflow: {
      state: challan.workflowState,
      label: engine.STATE_LABEL[challan.workflowState],
      allowed: engine.allowedFrom(challan.workflowState),
      progress: engine.progressOf(challan.workflowState, 'CUTTING_CHALLAN'),
    },
  };
}

// ===========================================================================
//  VALIDATION
// ===========================================================================

/**
 * C5: the challan is raised against an APPROVED planning version.
 *
 * The foreign key only guarantees the plan exists. Whether it has been
 * approved is a workflow question, and it is the whole reason this document
 * has to name a plan at all: a requirement drawn against an unapproved plan is
 * a requirement drawn against nothing.
 */
async function resolveApprovedPlan(tx, planningId) {
  const db = tx ?? prisma;

  const plan = await db.planning.findFirst({
    where: { id: planningId, deletedAt: null },
    select: {
      id: true,
      planNo: true,
      workflowState: true,
      approvalStatus: true,
      containerNo: true,
      orderId: true,
      plannedQty: true,
      plannedCuttingPcs: true,
    },
  });

  if (!plan) {
    throw ApiError.badRequest('The planning version named does not exist', { field: 'planningId' });
  }

  const approved = plan.workflowState === 'APPROVED' || plan.approvalStatus === 'APPROVED';
  if (!approved) {
    throw new ApiError(
      409,
      `Plan ${plan.planNo} is ${String(plan.workflowState).replace(/_/g, ' ').toLowerCase()}. ` +
        'A cutting challan may only be raised against an approved planning version - the ' +
        'requirement it draws against has to have been agreed first.',
      {
        code: ERROR_CODES.INVALID_TRANSITION,
        details: { field: 'planningId', planNo: plan.planNo, workflowState: plan.workflowState },
      },
    );
  }

  return plan;
}

/**
 * The current approved Plan Approval version for a style and container, where
 * the office works through one.
 *
 * Optional by design: some plans carry their approval on the plan itself. What
 * is NOT optional is that a Plan Approval named here must be the CURRENT one -
 * quoting a demoted version would authorise cutting against a plan that has
 * been superseded.
 */
async function resolveCurrentPlanApproval(tx, planApprovalId) {
  if (!planApprovalId) return null;
  const db = tx ?? prisma;

  const pa = await db.planApproval.findFirst({
    where: { id: planApprovalId, deletedAt: null },
    select: {
      id: true,
      approvalNo: true,
      round: true,
      approvalStatus: true,
      isCurrent: true,
      workflowState: true,
    },
  });
  if (!pa) {
    throw ApiError.badRequest('The plan approval named does not exist', { field: 'planApprovalId' });
  }
  if (pa.approvalStatus !== 'APPROVED') {
    throw ApiError.conflict(
      `Plan approval ${pa.approvalNo} is ${pa.approvalStatus.toLowerCase()} and cannot authorise ` +
        'a cutting challan.',
      { field: 'planApprovalId' },
    );
  }
  if (!pa.isCurrent) {
    throw ApiError.conflict(
      `Plan approval ${pa.approvalNo} (version ${pa.round}) has been superseded. Raise the ` +
        'challan against the current version.',
      { field: 'planApprovalId', round: pa.round },
    );
  }
  return pa;
}

async function validateLineDropdowns(line) {
  await assertValueInList('ItemCategory', line.itemCategory, { field: 'itemCategory' });
  await assertValueInList('UOM', line.uom, { field: 'uom' });
  if (line.subCategory) {
    await assertValueInList('FabricSubCat', line.subCategory, { field: 'subCategory' });
  }
  if (line.accessoriesItem) {
    await assertValueInList('AccessoriesItem', line.accessoriesItem, { field: 'accessoriesItem' });
  }
  if (line.colorCode) await assertValueInList('ColorCode', line.colorCode, { field: 'colorCode' });
}

// ===========================================================================
//  FULFILMENT - derived, never incremented
// ===========================================================================

/**
 * Re-derives one line's issued quantity from the fabric issues that quote it,
 * and moves the line's status to match.
 *
 * MUST run on the caller's transaction client. It is called from inside the
 * fabric-issue posting transaction, so the total a reader sees is never ahead
 * of or behind the issues it summarises - and a rolled-back issue takes its
 * contribution to the total with it.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} lineId
 */
export async function recomputeLineFulfilment(tx, lineId) {
  const line = await tx.cuttingChallanLine.findUnique({
    where: { id: lineId },
    select: { id: true, challanId: true, requiredQty: true, status: true },
  });
  if (!line) return null;

  const agg = await tx.fabricIssue.aggregate({
    where: { cuttingChallanLineId: lineId, deletedAt: null, postedAt: { not: null } },
    _sum: { fabricQtyIssued: true },
  });

  const issued = D(agg._sum.fabricQtyIssued ?? 0);
  const required = D(line.requiredQty);

  // A line that was closed short stays closed short. Re-deriving its quantity
  // must not quietly reopen a decision somebody took.
  const status =
    line.status === 'CANCELLED'
      ? 'CANCELLED'
      : issued.greaterThanOrEqualTo(required)
        ? 'COMPLETED'
        : issued.greaterThan(0)
          ? 'IN_PROGRESS'
          : 'PENDING';

  const updated = await tx.cuttingChallanLine.update({
    where: { id: lineId },
    data: { issuedQty: issued, status },
  });

  await recomputeChallanFulfilment(tx, line.challanId);
  return updated;
}

/**
 * Rolls the line statuses up to the header, and completes the challan when
 * every line is done.
 *
 * Completion goes through the approval engine rather than a bare status write,
 * so a completed challan leaves a stage event and an approval-trail entry like
 * every other document in the system.
 */
export async function recomputeChallanFulfilment(tx, challanId, actor = {}) {
  const challan = await tx.cuttingChallan.findUnique({
    where: { id: challanId },
    select: {
      id: true,
      challanNo: true,
      status: true,
      workflowState: true,
      lines: { where: { deletedAt: null }, select: { status: true } },
    },
  });
  if (!challan) return null;

  const lines = challan.lines ?? [];
  const settled = lines.every((l) => l.status === 'COMPLETED' || l.status === 'CANCELLED');
  const started = lines.some((l) => l.status === 'IN_PROGRESS' || l.status === 'COMPLETED');

  if (settled && lines.length > 0 && challan.workflowState === 'APPROVED') {
    return engine.complete(tx, {
      documentType: 'CUTTING_CHALLAN',
      documentId: challanId,
      actor,
      remarks: 'Every line is either fully issued or closed short.',
    });
  }

  const status = settled && lines.length ? 'COMPLETED' : started ? 'IN_PROGRESS' : 'PENDING';
  if (status === challan.status) return challan;

  return tx.cuttingChallan.update({ where: { id: challanId }, data: { status } });
}

/**
 * C5 - THE GATE A FABRIC ISSUE PASSES THROUGH.
 *
 * Called from inside `fabricIssue.post()`'s transaction, against rows that
 * transaction has read, immediately before the issue is written. Two store
 * keepers issuing against the same line at the same moment both pass the
 * preview; only one passes this.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} lineId
 * @param {Prisma.Decimal|string|number} qty
 * @param {object} [opts]
 * @param {string} [opts.excludeIssueId]  When re-checking an existing issue
 */
export async function assertLineCanTake(tx, lineId, qty, { excludeIssueId } = {}) {
  const line = await tx.cuttingChallanLine.findUnique({
    where: { id: lineId },
    include: {
      challan: {
        select: { id: true, challanNo: true, workflowState: true, status: true, styleId: true, orderId: true },
      },
    },
  });

  if (!line || line.deletedAt) {
    throw ApiError.badRequest('The cutting challan line named does not exist', {
      field: 'cuttingChallanLineId',
    });
  }

  const challan = line.challan;

  // The challan itself has to have been approved. An issue against a draft is
  // an issue against a piece of paper nobody signed.
  if (challan.workflowState !== 'APPROVED' && challan.workflowState !== 'COMPLETED') {
    throw new ApiError(
      409,
      `Cutting challan ${challan.challanNo} is ` +
        `${String(challan.workflowState).replace(/_/g, ' ').toLowerCase()}. Fabric may only be ` +
        'issued against an approved challan.',
      {
        code: ERROR_CODES.INVALID_TRANSITION,
        details: { field: 'cuttingChallanLineId', challanNo: challan.challanNo },
      },
    );
  }

  if (line.status === 'CANCELLED') {
    throw ApiError.conflict(
      `Line ${line.lineNo} of ${challan.challanNo} was closed short and takes no further issues.`,
      { field: 'cuttingChallanLineId', closedShort: true },
    );
  }

  // Re-derived here rather than read off the row, so the check cannot be
  // fooled by a stale total.
  const agg = await tx.fabricIssue.aggregate({
    where: {
      cuttingChallanLineId: lineId,
      deletedAt: null,
      postedAt: { not: null },
      ...(excludeIssueId ? { id: { not: excludeIssueId } } : {}),
    },
    _sum: { fabricQtyIssued: true },
  });

  const alreadyIssued = D(agg._sum.fabricQtyIssued ?? 0);
  const required = D(line.requiredQty);
  const wanted = D(qty);
  const outstanding = required.minus(alreadyIssued);

  if (outstanding.lessThanOrEqualTo(0)) {
    throw ApiError.conflict(
      `Line ${line.lineNo} of ${challan.challanNo} is fully issued: ${required.toFixed(4)} ` +
        `${line.uom} was required and ${alreadyIssued.toFixed(4)} has gone out. No further ` +
        'issue can be made against it.',
      {
        field: 'cuttingChallanLineId',
        requiredQty: required.toFixed(4),
        issuedQty: alreadyIssued.toFixed(4),
      },
    );
  }

  if (wanted.greaterThan(outstanding)) {
    throw ApiError.conflict(
      `Line ${line.lineNo} of ${challan.challanNo} has ${outstanding.toFixed(4)} ${line.uom} ` +
        `outstanding and ${wanted.toFixed(4)} was requested. Over-fulfilment of a cutting ` +
        'challan is not permitted - raise a further challan if more is genuinely needed.',
      {
        field: 'fabricQtyIssued',
        requiredQty: required.toFixed(4),
        alreadyIssuedQty: alreadyIssued.toFixed(4),
        outstandingQty: outstanding.toFixed(4),
        requestedQty: wanted.toFixed(4),
        overBy: wanted.minus(outstanding).toFixed(4),
      },
    );
  }

  return {
    line,
    challan,
    requiredQty: required,
    alreadyIssuedQty: alreadyIssued,
    outstandingQty: outstanding,
    /** True when this issue closes the line. */
    completesLine: wanted.equals(outstanding),
  };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    status, orderId, styleId, planningId, containerNo, openOnly,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(status ? { status } : {}),
    ...(orderId ? { orderId } : {}),
    ...(styleId ? { styleId } : {}),
    ...(planningId ? { planningId } : {}),
    ...(containerNo ? { containerNo } : {}),
    ...(openOnly ? { status: { in: ['PENDING', 'IN_PROGRESS'] } } : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total] = await Promise.all([
    prisma.cuttingChallan.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.cuttingChallan.count({ where }),
  ]);

  return { rows: rows.map(project), total, page, pageSize };
}

export async function getById(id) {
  const challan = await prisma.cuttingChallan.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!challan) throw ApiError.notFound('Cutting challan');

  const [status, stageEvents] = await Promise.all([
    engine.statusOf('CUTTING_CHALLAN', id),
    engine.stageEvents('CUTTING_CHALLAN', id),
  ]);

  return { ...project(challan), createdById: challan.createdById, approval: status, stageEvents };
}

/**
 * The lines a fabric issue may currently be raised against.
 *
 * Filtered to approved challans with something still outstanding, so the
 * Fabric Issue form cannot offer a line the posting would refuse.
 */
export async function issuableLines({ orderId, styleId, itemCategory } = {}) {
  const lines = await prisma.cuttingChallanLine.findMany({
    where: {
      deletedAt: null,
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      ...(itemCategory ? { itemCategory } : {}),
      challan: {
        deletedAt: null,
        workflowState: { in: ['APPROVED', 'COMPLETED'] },
        ...(orderId ? { orderId } : {}),
        ...(styleId ? { styleId } : {}),
      },
    },
    include: {
      challan: {
        select: {
          id: true,
          challanNo: true,
          challanDate: true,
          containerNo: true,
          order: { select: { id: true, orderNo: true } },
          style: { select: { id: true, styleNo: true } },
        },
      },
    },
    orderBy: [{ challan: { challanDate: 'asc' } }, { lineNo: 'asc' }],
  });

  return lines
    .map(projectLine)
    .filter((l) => l.open)
    .map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      challanId: l.challan.id,
      challanNo: l.challan.challanNo,
      containerNo: l.challan.containerNo,
      orderNo: l.challan.order?.orderNo ?? null,
      styleNo: l.challan.style?.styleNo ?? null,
      itemCategory: l.itemCategory,
      category: l.category,
      subCategory: l.subCategory,
      accessoriesItem: l.accessoriesItem,
      colorCode: l.colorCode,
      description: l.description,
      uom: l.uom,
      requiredQty: D(l.requiredQty).toFixed(4),
      issuedQty: D(l.issuedQty).toFixed(4),
      outstandingQty: l.outstandingQty,
      label:
        `${l.challan.challanNo} line ${l.lineNo} - ${l.description ?? l.itemCategory}: ` +
        `${l.outstandingQty} ${l.uom} outstanding`,
    }));
}

/**
 * What a challan would look like before it is saved, including the shared
 * requirement calculation's answer for every line.
 */
export async function preview(input) {
  const order = input.orderId
    ? await prisma.buyerOrder.findFirst({
        where: { id: input.orderId, deletedAt: null },
        include: {
          style: { select: { id: true, styleNo: true, avgFabricUtilizationPerPc: true, avgUtilizationUom: true } },
        },
      })
    : null;

  const style = await resolveStyleWithBom(input.styleId ?? order?.styleId);
  const on = input.challanDate ? new Date(input.challanDate) : new Date();

  const lines = (input.lines ?? []).map((line, i) => {
    const need = requirementFor({ style, order, line, on });
    const required = D(line.requiredQty ?? 0);
    return {
      lineNo: line.lineNo ?? i + 1,
      itemCategory: line.itemCategory,
      requiredQty: required.toFixed(4),
      uom: line.uom,
      /** C9 - the SAME function planning and the PO ceiling call. */
      requirement: need.requirement ? need.requirement.toFixed(4) : null,
      requirementUom: need.uom ?? null,
      requirementBasis: need.basis,
      requirementAvailable: need.requirement !== null,
      /** Over the computed requirement is allowed here, and reported. */
      overRequirementQty:
        need.requirement && required.greaterThan(need.requirement)
          ? required.minus(need.requirement).toFixed(4)
          : null,
    };
  });

  return {
    nextChallanNo: await peekNumber('CUTTING_CHALLAN'),
    order: order ? { id: order.id, orderNo: order.orderNo, effectiveQty: D(order.effectiveQty).toFixed(4) } : null,
    style: style ? { id: style.id, styleNo: style.styleNo } : null,
    lines,
    totals: {
      requiredQty: lines.reduce((a, l) => a.plus(D(l.requiredQty)), ZERO).toFixed(4),
    },
  };
}

async function resolveStyleWithBom(styleId) {
  if (!styleId) return null;
  return prisma.style.findFirst({
    where: { id: styleId, deletedAt: null },
    include: { bomLines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
  });
}

// ===========================================================================
//  WRITES
// ===========================================================================

/**
 * Raises a cutting challan, in DRAFT.
 *
 * The challan number and the rows are taken together: a rolled-back challan
 * must not burn a number out of the series.
 */
export async function create(input, actor = {}) {
  if (!input.lines?.length) {
    throw ApiError.badRequest('A cutting challan needs at least one required item', {
      field: 'lines',
    });
  }

  for (const line of input.lines) await validateLineDropdowns(line);

  const plan = await resolveApprovedPlan(null, input.planningId);
  const planApproval = await resolveCurrentPlanApproval(null, input.planApprovalId);

  const order = await prisma.buyerOrder.findFirst({
    where: { id: input.orderId, deletedAt: null },
    include: { style: { select: { id: true } } },
  });
  if (!order) throw ApiError.badRequest('Order does not exist', { field: 'orderId' });

  const styleId = input.styleId ?? order.styleId;
  const style = await resolveStyleWithBom(styleId);
  if (!style) throw ApiError.badRequest('Style does not exist', { field: 'styleId' });

  const challanDate = input.challanDate ? new Date(input.challanDate) : new Date();

  const challan = await prisma.$transaction(async (tx) => {
    const challanNo = input.challanNo?.trim() || (await nextNumber('CUTTING_CHALLAN', { tx }));

    const clash = await tx.cuttingChallan.findUnique({
      where: { challanNo },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict('This challan number already exists', { field: 'challanNo' });

    return tx.cuttingChallan.create({
      data: {
        challanNo,
        challanDate,
        orderId: order.id,
        styleId: style.id,
        planningId: plan.id,
        planApprovalId: planApproval?.id ?? null,
        containerNo: input.containerNo ?? plan.containerNo ?? null,
        requiredBy: input.requiredBy ? new Date(input.requiredBy) : null,
        remarks: input.remarks ?? null,
        status: 'PENDING',
        createdById: actor.userId ?? null,
        updatedById: actor.userId ?? null,
        lines: {
          create: input.lines.map((line, i) => {
            // C9: the shared calculation, frozen onto the line at creation for
            // the same reason the PO freezes its ceiling - the BOM may move,
            // and a figure somebody has signed may not.
            const need = requirementFor({ style, order, line, on: challanDate });
            return {
              lineNo: line.lineNo ?? i + 1,
              itemCategory: line.itemCategory,
              category: categoryOfLine(line, { field: 'itemCategory' }),
              subCategory: line.subCategory ?? null,
              accessoriesItem: line.accessoriesItem ?? null,
              colorCode: line.colorCode ?? null,
              description: line.description ?? null,
              requiredQty: D(line.requiredQty),
              uom: line.uom,
              computedRequirementQty: need.requirement ?? null,
              requirementBasis: need.basis,
              remarks: line.remarks ?? null,
              createdById: actor.userId ?? null,
              updatedById: actor.userId ?? null,
            };
          }),
        },
      },
      include: INCLUDE,
    });
  });

  await engine.record(null, {
    documentType: 'CUTTING_CHALLAN',
    documentId: challan.id,
    documentNo: challan.challanNo,
    action: 'SUBMITTED',
    toStatus: 'DRAFT',
    actor,
    remarks:
      `Cutting requirement raised against plan ${plan.planNo}: ` +
      `${challan.lines.length} item(s) for order ${order.orderNo}.`,
  });

  return project(challan);
}

/** Edits a challan while it is still a draft. */
export async function update(id, input, actor = {}) {
  const existing = await prisma.cuttingChallan.findFirst({
    where: { id, deletedAt: null },
    include: { lines: LINE_INCLUDE },
  });
  if (!existing) throw ApiError.notFound('Cutting challan');

  if (existing.workflowState !== 'DRAFT' && existing.workflowState !== 'REJECTED') {
    throw ApiError.conflict(
      `${existing.challanNo} is ${engine.STATE_LABEL[existing.workflowState].toLowerCase()} and ` +
        'can no longer be edited. Fabric may already have been issued against it.',
      { workflowState: existing.workflowState },
    );
  }

  if (input.lines) for (const line of input.lines) await validateLineDropdowns(line);

  const order = await prisma.buyerOrder.findFirst({
    where: { id: input.orderId ?? existing.orderId, deletedAt: null },
  });
  const style = await resolveStyleWithBom(input.styleId ?? existing.styleId);
  const challanDate = input.challanDate ? new Date(input.challanDate) : existing.challanDate;

  if (input.planningId) await resolveApprovedPlan(null, input.planningId);
  if (input.planApprovalId) await resolveCurrentPlanApproval(null, input.planApprovalId);

  const challan = await prisma.$transaction(async (tx) => {
    if (input.lines) {
      // Replaced wholesale rather than diffed. A draft challan has no fabric
      // issues against it - `assertLineCanTake()` refuses those until it is
      // approved - so there is nothing pointing at these rows to orphan.
      await tx.cuttingChallanLine.deleteMany({ where: { challanId: id } });
    }

    return tx.cuttingChallan.update({
      where: { id },
      data: {
        ...(input.challanDate !== undefined ? { challanDate } : {}),
        ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
        ...(input.styleId !== undefined ? { styleId: input.styleId } : {}),
        ...(input.planningId !== undefined ? { planningId: input.planningId } : {}),
        ...(input.planApprovalId !== undefined ? { planApprovalId: input.planApprovalId } : {}),
        ...(input.containerNo !== undefined ? { containerNo: input.containerNo } : {}),
        ...(input.requiredBy !== undefined
          ? { requiredBy: input.requiredBy ? new Date(input.requiredBy) : null }
          : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        updatedById: actor.userId ?? null,
        ...(input.lines
          ? {
              lines: {
                create: input.lines.map((line, i) => {
                  const need = requirementFor({ style, order, line, on: challanDate });
                  return {
                    lineNo: line.lineNo ?? i + 1,
                    itemCategory: line.itemCategory,
                    category: categoryOfLine(line, { field: 'itemCategory' }),
                    subCategory: line.subCategory ?? null,
                    accessoriesItem: line.accessoriesItem ?? null,
                    colorCode: line.colorCode ?? null,
                    description: line.description ?? null,
                    requiredQty: D(line.requiredQty),
                    uom: line.uom,
                    computedRequirementQty: need.requirement ?? null,
                    requirementBasis: need.basis,
                    remarks: line.remarks ?? null,
                    createdById: actor.userId ?? null,
                    updatedById: actor.userId ?? null,
                  };
                }),
              },
            }
          : {}),
      },
      include: INCLUDE,
    });
  });

  return project(challan);
}

/** Hands the challan in for approval. */
export async function submit(id, { submittedTo, remarks } = {}, actor = {}) {
  await engine.submit(null, {
    documentType: 'CUTTING_CHALLAN',
    documentId: id,
    submittedTo,
    actor,
    remarks,
  });
  return getById(id);
}

/**
 * Approves a challan.
 *
 * MAKER-CHECKER. The person who raised the requirement may not be the person
 * who authorises it: a cutting supervisor approving their own draw on the
 * store is the whole control this document exists to impose.
 */
export async function approve(id, { remarks } = {}, actor = {}) {
  const existing = await prisma.cuttingChallan.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, challanNo: true, createdById: true },
  });
  if (!existing) throw ApiError.notFound('Cutting challan');

  assertNotSelfApproval(existing, actor, 'cutting challan');

  await engine.approve(null, {
    documentType: 'CUTTING_CHALLAN',
    documentId: id,
    actor,
    remarks,
    data: {
      approvedById: actor.userId ?? null,
      approvedByName: actor.fullName ?? null,
      approvedAt: new Date(),
      decidedAt: new Date(),
    },
  });
  return getById(id);
}

/** Rejects, with a reason. */
export async function reject(id, { reason } = {}, actor = {}) {
  await engine.reject(null, {
    documentType: 'CUTTING_CHALLAN',
    documentId: id,
    actor,
    reason,
    data: { decidedAt: new Date(), rejectionReason: reason },
  });
  return getById(id);
}

/**
 * C5 - closes a line, or a whole challan, SHORT.
 *
 * The cutting floor has decided it needs no more. That is a decision, not an
 * outcome, so it is recorded as one: who, when, and why. A short-closed line
 * takes no further issues; `assertLineCanTake()` refuses them by name.
 */
export async function closeShort(id, { lineId, reason } = {}, actor = {}) {
  if (!reason || reason.trim().length < 3) {
    throw ApiError.badRequest('Closing a challan short needs a reason', { field: 'reason' });
  }

  const existing = await prisma.cuttingChallan.findFirst({
    where: { id, deletedAt: null },
    include: { lines: LINE_INCLUDE },
  });
  if (!existing) throw ApiError.notFound('Cutting challan');

  if (existing.workflowState !== 'APPROVED') {
    throw ApiError.conflict(
      `${existing.challanNo} is ${engine.STATE_LABEL[existing.workflowState].toLowerCase()}. Only ` +
        'an approved challan can be closed short - a draft is simply cancelled.',
      { workflowState: existing.workflowState },
    );
  }

  const targets = lineId
    ? existing.lines.filter((l) => l.id === lineId)
    : existing.lines.filter((l) => l.status !== 'COMPLETED');

  if (!targets.length) {
    throw ApiError.badRequest(
      lineId ? 'That line is not on this challan' : 'Every line is already complete',
      { field: 'lineId' },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.cuttingChallanLine.updateMany({
      where: { id: { in: targets.map((l) => l.id) } },
      data: { status: 'CANCELLED', updatedById: actor.userId ?? null },
    });

    await tx.cuttingChallan.update({
      where: { id },
      data: {
        closedShortAt: new Date(),
        closedShortById: actor.userId ?? null,
        closedShortByName: actor.fullName ?? null,
        closedShortReason: reason,
        updatedById: actor.userId ?? null,
      },
    });

    await engine.record(tx, {
      documentType: 'CUTTING_CHALLAN',
      documentId: id,
      documentNo: existing.challanNo,
      action: 'AMENDED',
      actor,
      remarks:
        `Closed short: ${targets.length} line(s) will take no further issues. Reason: ${reason}`,
    });

    await recomputeChallanFulfilment(tx, id, actor);
  });

  return getById(id);
}

/** Cancels a challan that has not been acted on. */
export async function cancel(id, { reason } = {}, actor = {}) {
  const existing = await prisma.cuttingChallan.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { where: { deletedAt: null }, select: { issuedQty: true } } },
  });
  if (!existing) throw ApiError.notFound('Cutting challan');

  const issued = (existing.lines ?? []).reduce((a, l) => a.plus(D(l.issuedQty)), ZERO);
  if (issued.greaterThan(0)) {
    throw ApiError.conflict(
      `${existing.challanNo} has already had ${issued.toFixed(4)} issued against it and cannot ` +
        'be cancelled. Close it short instead, which records the decision.',
      { issuedQty: issued.toFixed(4) },
    );
  }

  await engine.cancel(null, {
    documentType: 'CUTTING_CHALLAN',
    documentId: id,
    actor,
    reason,
  });
  return getById(id);
}

/** Soft-deletes a draft. */
export async function remove(id, actorId) {
  const existing = await prisma.cuttingChallan.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, challanNo: true, workflowState: true },
  });
  if (!existing) throw ApiError.notFound('Cutting challan');

  if (existing.workflowState !== 'DRAFT') {
    throw ApiError.conflict(
      `${existing.challanNo} is ${engine.STATE_LABEL[existing.workflowState].toLowerCase()} and ` +
        'cannot be deleted. Cancel it instead, which leaves the record.',
      { workflowState: existing.workflowState },
    );
  }

  await prisma.cuttingChallan.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId ?? null },
  });
  return { id, deleted: true };
}
