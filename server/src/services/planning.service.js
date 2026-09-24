/**
 * Planning. Sheets: "Planning_" (header) + "Planning" (allotment rows)
 * (Role Acess - Planning Dept (Operator/GM), approved by Vinay ji / Dinesh Sir).
 *
 * ---------------------------------------------------------------------------
 *  THE CEILING RULE
 *
 *  Current Process.xlsx -> Planning sheet: "Sum should match Order Qty".
 *  Phase 0 left that cross-row rule to the service layer. This is that layer.
 *
 *      permittedQty = BuyerOrder.effectiveQty = orderQty x (1 + APPROVED excess)
 *      plannedQty   = SUM(line.deliverableSize)
 *
 *      plannedQty MUST NOT exceed permittedQty.
 *
 *  EVERY DEPARTMENT, cutting included. A cutting plan says how many pieces are
 *  to be cut, and the fabric those pieces consume is worked out from the
 *  style's BOM rather than typed - see `estimateFabric`. The pieces are what
 *  the order bounds; the cloth follows from them.
 *
 *  Because effectiveQty embeds only the excess the Director actually granted,
 *  a plan may go above the plain order quantity exactly as far as an APPROVED
 *  excess allows and not one piece further. An excess that is merely REQUESTED
 *  buys the planner nothing: the order behaves as though it had no excess at
 *  all until Dinesh Sir signs it off.
 *
 *  The check is re-run at every point where either side of the inequality can
 *  move - create, edit, line edit, submit, and again at approval, because the
 *  order's excess can be amended or revoked after a plan was drawn up.
 * ---------------------------------------------------------------------------
 *
 * Every quantity on this screen is calculated here. plannedQty and
 * plannedCuttingPcs are derived from the lines, and any such field arriving in
 * a request body is stripped by the validator before it reaches this file.
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError, ERROR_CODES } from '../utils/ApiError.js';
import { OPTIONS_LIMIT, searchFilter } from '../utils/http.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber } from './documentNumber.service.js';
import { assertNotSelfApproval } from '../domain/makerChecker.js';
import { requirementFor } from '../domain/requirement.js';

export const SORTABLE = [
  'planNo',
  'planDate',
  'planDepartment',
  'orderQty',
  'plannedQty',
  'status',
  'approvalStatus',
  'containerNo',
  'createdAt',
];

const SEARCH = ['planNo', 'styleNo', 'containerNo', 'remarks'];

/**
 * What each planning department is called, and what its line quantity means.
 *
 * SHIPPING IS CALLED DISPATCH. The enum value stays `SHIPPING` - it is what
 * every existing plan is stored as, and renaming stored data to change a word
 * on screen is how one thing ends up with two names. Only the wording moves.
 */
export const DEPARTMENT_WORD = {
  CUTTING: 'cutting',
  STITCHING: 'stitching',
  IRON: 'iron',
  PACKING: 'packing',
  SHIPPING: 'dispatch',
};

/**
 * The heading the "how much to produce" column carries, per department.
 *
 * Every department plans a number of PIECES. Cutting additionally carries the
 * fabric those pieces will consume - which is not typed, but worked out from
 * the style's BOM. See `estimateFabric`.
 */
export const ALLOTMENT_LABEL = {
  CUTTING: 'Pieces to cut',
  STITCHING: 'Pieces to stitch',
  IRON: 'Pieces to iron',
  PACKING: 'Produced pieces',
  SHIPPING: 'Produced pieces',
};

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

const ORDER_SELECT = {
  id: true,
  orderNo: true,
  orderDate: true,
  orderQty: true,
  effectiveQty: true,
  excessPct: true,
  excessApprovedPct: true,
  excessApprovalStatus: true,
  buyerDeliveryDate: true,
  colorCode: true,
  sizeGroup: true,
  status: true,
  buyer: { select: { id: true, buyerCode: true, buyerName: true } },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
};

const ORDER_LINE_SELECT = {
  id: true,
  lineNo: true,
  orderQty: true,
  effectiveQty: true,
  colorCode: true,
  sizeGroup: true,
  style: { select: { id: true, styleNo: true, styleDescription: true } },
};

const LIST_INCLUDE = {
  order: { select: ORDER_SELECT },
  // The line the plan is for. Every quantity on the plan is measured against
  // THIS, not against the order header.
  orderLine: { select: ORDER_LINE_SELECT },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  _count: { select: { lines: { where: { deletedAt: null } } } },
};

const LINE_ORDER = [{ lineDate: 'asc' }, { lineNo: 'asc' }];

// ===========================================================================
//  CALCULATION - the single place plan quantities are derived
// ===========================================================================

/**
 * The fabric a cutting line's pieces will consume, worked out from the BOM.
 *
 * ===========================================================================
 *  ESTIMATED, NOT TYPED
 * ===========================================================================
 *
 *  A planner says how many pieces are to be cut on a date. How much cloth that
 *  takes is not a second decision - it is the style's average utilisation per
 *  piece times those pieces, plus the wastage the BOM declares. Asking for it
 *  again invites a number that disagrees with the BOM, and a cutting floor
 *  issued against the wrong one.
 *
 *  THE SAME CALCULATION AS EVERYWHERE ELSE. `requirementFor` is what the order
 *  screen, the purchase-order ceiling and the cutting challan all call, so the
 *  metres shown here are the metres those documents show for the same pieces -
 *  by construction, not by three people keeping one multiplication in step. It
 *  is handed a quantity of its own rather than the order's, because a plan line
 *  covers part of an order.
 *
 *  FROZEN ONCE STORED. The answer is written onto the line, exactly as the
 *  cutting challan freezes its own requirement: a BOM may be revised, and a
 *  figure somebody has signed may not change under them.
 *
 *  A STYLE WITH NO UTILISATION CANNOT BE PLANNED FOR CUTTING. The resolver
 *  says so in its own words, and those words name the screen to fix it on -
 *  more use than a plan quietly holding no fabric at all.
 */
function estimateFabric(style, pieces, on) {
  const answer = requirementFor({
    style,
    // `requirementFor` reads the quantity off an order; this line has its own.
    order: { effectiveQty: pieces },
    line: { itemCategory: 'Fabric' },
    on,
  });

  if (answer.requirement === null) {
    throw ApiError.badRequest(answer.basis, { field: 'fabricQty', reason: answer.reason });
  }
  return { qty: answer.requirement, uom: answer.uom, basis: answer.basis };
}

/**
 * Puts the BOM's answer onto every line of a cutting plan.
 *
 * Runs after `normaliseLines`, so the pieces are already Decimals and the
 * rows already carry the date whose BOM revision applies.
 */
function withFabricEstimates(lines, planDepartment, style) {
  if (planDepartment !== 'CUTTING') {
    // Nothing else issues cloth, so nothing else carries the estimate.
    return lines.map((l) => ({ ...l, fabricQty: null, fabricUom: null }));
  }
  return lines.map((l) => {
    const est = estimateFabric(style, l.deliverableSize, l.lineDate);
    return { ...l, fabricQty: est.qty, fabricUom: est.uom };
  });
}

/**
 * Sums the lines. The only source of plannedQty / plannedCuttingPcs /
 * plannedFabricQty.
 *
 * A cutting plan fills the fabric column and leaves the pieces column empty;
 * the other three departments do the reverse. Both are summed unconditionally
 * because an empty column sums to zero, which is the right answer for it.
 */
export function totalsFromLines(lines) {
  return lines.reduce(
    (acc, l) => ({
      plannedQty: acc.plannedQty.plus(D(l.deliverableSize)),
      plannedCuttingPcs: acc.plannedCuttingPcs.plus(D(l.cuttingPcsAllotted)),
      plannedFabricQty: acc.plannedFabricQty.plus(D(l.fabricQty)),
    }),
    { plannedQty: ZERO, plannedCuttingPcs: ZERO, plannedFabricQty: ZERO },
  );
}

/**
 * The allocation of an order into a plan, and whether it is legal.
 *
 * `permittedQty` is the order's effectiveQty - the Phase 3 ceiling. Everything
 * reported here is measured against that, never against the requested excess,
 * so the answer changes the moment the Director's decision changes.
 *
 * @param {object} order Buyer order carrying orderQty, effectiveQty, excess state
 * @param {Prisma.Decimal|string|number} plannedQty
 * @param {Prisma.Decimal|string|number} plannedCuttingPcs
 */
export function allocation(order, plannedQty, plannedCuttingPcs = 0) {
  const plain = D(order.orderQty);
  const permitted = D(order.effectiveQty);
  const planned = D(plannedQty);
  const cutting = D(plannedCuttingPcs);

  const headroom = permitted.minus(plain); // extra pieces the granted excess buys
  const overBy = planned.minus(permitted);
  const excessUsed = planned.greaterThan(plain) ? planned.minus(plain) : ZERO;
  const shortfall = plain.minus(planned);

  return {
    /** Pieces the buyer ordered. */
    orderQty: plain.toFixed(4),
    /** The ceiling: order qty plus the excess the Director actually granted. */
    permittedQty: permitted.toFixed(4),
    /** Sum of the plan's deliverable sizes. */
    plannedQty: planned.toFixed(4),
    /** Sum of the plan's cutting pieces allotted. */
    plannedCuttingPcs: cutting.toFixed(4),
    /** Still to be allotted before the plan covers the whole order. */
    unplannedQty: shortfall.greaterThan(0) ? shortfall.toFixed(4) : '0.0000',
    /** Head-room left under the ceiling. Negative means the plan is illegal. */
    remainingQty: permitted.minus(planned).toFixed(4),
    /** Extra pieces the approved excess makes available. */
    excessHeadroomQty: headroom.toFixed(4),
    /** How much of that head-room this plan is consuming. */
    excessUsedQty: excessUsed.toFixed(4),
    excessApprovalStatus: order.excessApprovalStatus,
    excessApprovedPct: D(order.excessApprovedPct).toFixed(6),
    excessRequestedPct: D(order.excessPct).toFixed(6),
    /** True once the plan reaches beyond the plain order quantity. */
    usesExcess: excessUsed.greaterThan(0),
    /** True when the plan exactly covers the order - the workbook's ideal. */
    matchesOrderQty: planned.equals(plain),
    /** THE rule. */
    withinPermitted: !overBy.greaterThan(0),
    overBy: overBy.greaterThan(0) ? overBy.toFixed(4) : '0.0000',
  };
}

/**
 * Throws unless the plan fits under the order's ceiling.
 *
 * The message deliberately explains WHICH rule bit: a plan that would have been
 * legal with the requested excess is told that the excess is not approved,
 * rather than being handed a bare arithmetic refusal.
 */
function assertWithinPermitted(order, alloc, { action = 'plan' } = {}) {
  if (alloc.withinPermitted) return;

  const requestedCeiling = D(order.orderQty).mul(D(1).plus(D(order.excessPct)));
  const wouldFitWithRequestedExcess = D(alloc.plannedQty).lessThanOrEqualTo(requestedCeiling);
  const status = order.excessApprovalStatus;

  // Names the STYLE when the subject is one line of the order, so a planner on
  // a multi-style order is told which style went over rather than being handed
  // the order number and left to work it out.
  const what = order.subjectLabel ?? `order ${order.orderNo}`;

  let why;
  if (status === 'PENDING' && wouldFitWithRequestedExcess) {
    why =
      `${what} has requested an excess of ${D(order.excessPct).mul(100).toFixed(2)}%, ` +
      'but the Director has not approved it yet. Until that decision is taken it may only be ' +
      `planned up to ${alloc.permittedQty} pieces.`;
  } else if (status === 'REJECTED' && wouldFitWithRequestedExcess) {
    why =
      `The excess requested on order ${order.orderNo} was rejected, so ${what} may only be planned ` +
      `up to its plain quantity of ${alloc.permittedQty} pieces.`;
  } else if (status === 'APPROVED') {
    why =
      `${what} allows ${alloc.orderQty} pieces plus an approved excess of ` +
      `${D(order.excessApprovedPct).mul(100).toFixed(2)}% (${alloc.excessHeadroomQty} pieces), ` +
      `a ceiling of ${alloc.permittedQty}.`;
  } else {
    why = `${what} permits ${alloc.permittedQty} pieces.`;
  }

  throw ApiError.conflict(
    `This ${action} allots ${alloc.plannedQty} pieces, which is ${alloc.overBy} over what ` +
      `${order.subjectLabel ? 'that style' : 'the order'} permits. ${why}`,
    { rule: 'PLANNED_QTY_EXCEEDS_PERMITTED', allocation: alloc },
  );
}

/** Per-unit rollup ("Unit" -> L_StitchingUnit). Feeds Cutting Issue. */
export function unitAllocation(lines) {
  const byUnit = new Map();
  for (const line of lines) {
    const key = line.unit ?? '(unassigned)';
    const acc = byUnit.get(key) ?? {
      unit: key,
      lineCount: 0,
      deliverableSize: ZERO,
      cuttingPcsAllotted: ZERO,
      fabricQty: ZERO,
      fabricUom: null,
      firstDate: line.lineDate,
      lastDate: line.lineDate,
      statuses: new Set(),
    };
    acc.lineCount += 1;
    acc.deliverableSize = acc.deliverableSize.plus(D(line.deliverableSize));
    acc.cuttingPcsAllotted = acc.cuttingPcsAllotted.plus(D(line.cuttingPcsAllotted));
    acc.fabricQty = acc.fabricQty.plus(D(line.fabricQty));
    // The first unit named wins: a plan mixing metres and yards for one unit
    // would not sum, and validateLines has already refused that case.
    acc.fabricUom = acc.fabricUom ?? line.fabricUom ?? null;
    if (line.lineDate < acc.firstDate) acc.firstDate = line.lineDate;
    if (line.lineDate > acc.lastDate) acc.lastDate = line.lineDate;
    acc.statuses.add(line.status);
    byUnit.set(key, acc);
  }

  return [...byUnit.values()]
    .map((u) => ({
      unit: u.unit,
      lineCount: u.lineCount,
      deliverableSize: u.deliverableSize.toFixed(4),
      cuttingPcsAllotted: u.cuttingPcsAllotted.toFixed(4),
      fabricQty: u.fabricQty.toFixed(4),
      fabricUom: u.fabricUom,
      firstDate: u.firstDate,
      lastDate: u.lastDate,
      statuses: [...u.statuses],
    }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
}

// ===========================================================================
//  VALIDATION HELPERS
// ===========================================================================

/** Loads the order a plan hangs off, refusing one that cannot be planned. */
async function resolveOrder(orderId, { forWrite = true } = {}) {
  const order = await prisma.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { ...ORDER_SELECT, styleId: true },
  });
  if (!order) throw ApiError.badRequest('Order does not exist', { field: 'orderId' });
  if (forWrite && order.status === 'CANCELLED') {
    throw ApiError.badRequest(`Order ${order.orderNo} is cancelled and cannot be planned`, {
      field: 'orderId',
    });
  }
  return order;
}

/**
 * The thing a plan is actually measured against: ONE LINE of the order.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS RETURNS AN ORDER-SHAPED OBJECT
 *
 *  `allocation()` and `assertWithinPermitted()` were written against the order
 *  header - they read `orderQty`, `effectiveQty` and the excess fields. Every
 *  one of those has a per-line equivalent, so rather than thread a second
 *  concept through both functions and all six call sites, this returns an
 *  object of the same SHAPE carrying the LINE's quantities and the order's
 *  excess state. The arithmetic is unchanged; only what it is pointed at moves.
 *
 *  The excess percentages stay the order's because that is where the Director's
 *  decision lives - one decision covers the order. What differs per line is the
 *  quantity it applies to, and `effectiveQty` on the line already carries that.
 * ---------------------------------------------------------------------------
 */
async function resolvePlanSubject(orderId, orderLineId, { forWrite = true } = {}) {
  const order = await resolveOrder(orderId, { forWrite });

  if (!orderLineId) {
    throw ApiError.badRequest(
      'A plan is for one style of the order. Pick which line it covers.',
      { field: 'orderLineId' },
    );
  }

  const line = await prisma.buyerOrderLine.findFirst({
    where: { id: orderLineId, orderId: order.id, deletedAt: null },
    include: {
      style: {
        select: {
          id: true,
          styleNo: true,
          styleDescription: true,
          /* The BOM, for the fabric a cutting plan's pieces will consume.
             `avgFabricUtilizationPerPc` is what the Fabric branch of
             `requirementFor` reads; the lines carry the declared wastage and
             the revision that was effective on the planned date. */
          avgFabricUtilizationPerPc: true,
          avgUtilizationUom: true,
          bomLines: {
            where: { deletedAt: null },
            orderBy: { lineNo: 'asc' },
          },
        },
      },
    },
  });
  if (!line) {
    throw ApiError.badRequest(
      `Order ${order.orderNo} has no such line. A plan can only cover a style that is on the order.`,
      { field: 'orderLineId' },
    );
  }

  return {
    order,
    line,
    /** Order-shaped, so allocation() and assertWithinPermitted() need no change. */
    subject: {
      orderNo: order.orderNo,
      orderQty: line.orderQty,
      effectiveQty: line.effectiveQty,
      excessPct: order.excessPct,
      excessApprovedPct: order.excessApprovedPct,
      excessApprovalStatus: order.excessApprovalStatus,
      /** Names the style in a refusal, so a planner knows which line was over. */
      subjectLabel: `${line.style.styleNo}${line.colorCode ? ` / ${line.colorCode}` : ''} on order ${order.orderNo}`,
    },
  };
}

/*
 * CONTAINER NO IS TYPED, NOT CHOSEN.
 *
 * It used to be checked against the ContainerNo master list. That made the
 * Planning form - which offers a free-text box reading "As printed on the
 * container" - refuse every real container number: typing MSKU7654321 came
 * back "not one of the Container No values. Valid values are: CN-91, CN-92,
 * CN-93, CN-94, CN-95." The screen invited an entry the rules then rejected.
 *
 * The list was the wrong shape for the thing. A container number belongs to
 * ONE shipment and is never used again, so a master list of them could only
 * grow into thousands of dead entries with the one needed today missing - and
 * somebody would have to register a container in Masters before the order it
 * carries could be planned.
 *
 * So it is free text, entered at Planning, and carried forward from there:
 * Plan Approval, Cutting Challan and Cutting Issue all inherit it from the
 * plan and only override it when told to.
 */
/** Submitted To is a List Master value. Container No is not - see above. */
async function validateDropdowns({ submittedTo }) {
  if (submittedTo !== undefined) {
    await assertValueInList('AuthorisedBy', submittedTo, { field: 'submittedTo' });
  }
}

/**
 * Every line's Unit comes from L_StitchingUnit, and every line says how many
 * pieces that unit is to produce on that date.
 *
 * The department no longer changes what a line may carry - all four plan in
 * pieces - so it is not a parameter here any more. What differs by department
 * is only what the pieces are CALLED (see ALLOTMENT_LABEL) and, for cutting,
 * that the fabric they consume is worked out afterwards from the BOM.
 */
async function validateLines(lines) {
  const units = [...new Set(lines.map((l) => l.unit).filter(Boolean))];
  for (const unit of units) {
    await assertValueInList('StitchingUnit', unit, { field: 'unit' });
  }

  const uoms = [...new Set(lines.map((l) => l.fabricUom).filter(Boolean))];
  for (const uom of uoms) {
    await assertValueInList('UOM', uom, { field: 'fabricUom' });
  }

  for (const line of lines) {
    /*
     * A CUTTING PLAN ALLOTS FABRIC. What is handed to a cutting floor is
     * cloth; what comes back is panels. The other three departments receive a
     * count, so they allot pieces.
     */
    const hasPieces = line.deliverableSize !== null && line.deliverableSize !== undefined;

    /*
     * EVERY DEPARTMENT PLANS PIECES. Cutting says how many are to be cut,
     * stitching how many stitched, packing and dispatch how many go out - and
     * the sum of them is what the order is measured against.
     */
    if (!hasPieces) {
      throw ApiError.badRequest(
        `Line ${line.lineNo}: say how many pieces are allotted to this unit on this date.`,
        { field: 'deliverableSize', lineNo: line.lineNo },
      );
    }
  }
}

/**
 * ONLY STITCHING IS SPLIT BY UNIT. Cutting, packing and dispatch are done in
 * one place, so their lines carry no unit - one sent anyway is dropped rather
 * than stored against a plan whose screen no longer shows it.
 */
export const departmentUsesUnit = (planDepartment) => planDepartment === 'STITCHING';

/** Numbers the lines 1..n in date order, so the grid always reads like the sheet. */
function normaliseLines(lines, planDepartment) {
  const keepUnit = departmentUsesUnit(planDepartment);
  return [...lines]
    .sort((a, b) => String(a.lineDate).localeCompare(String(b.lineDate)))
    .map((l, i) => ({
      lineNo: i + 1,
      lineDate: new Date(l.lineDate),
      unit: keepUnit ? l.unit ?? null : null,
      deliverableSize:
        l.deliverableSize === null || l.deliverableSize === undefined
          ? null
          : D(l.deliverableSize),
      // Retired - a line carries one quantity now. Written null so a revised
      // plan does not keep a figure the screen no longer offers.
      cuttingPcsAllotted: null,
      fabricQty:
        l.fabricQty === null || l.fabricQty === undefined ? null : D(l.fabricQty),
      fabricUom: l.fabricUom ?? null,
      status: l.status ?? 'PENDING',
      remark: l.remark ?? null,
    }));
}

// ===========================================================================
//  WORKFLOW STATE
// ===========================================================================

/**
 * The four states a plan can be in, derived rather than stored, so there is one
 * definition of "draft" and it cannot drift out of step with the columns.
 *
 *   DRAFT     PENDING  + never submitted - the planner is still building it
 *   SUBMITTED PENDING  + submitted       - with the GM / Director
 *   APPROVED  APPROVED                   - gates Cutting Issue
 *   REJECTED  REJECTED                   - back with the planner to revise
 */
export function workflowState(plan) {
  if (plan.approvalStatus === 'APPROVED') return 'APPROVED';
  if (plan.approvalStatus === 'REJECTED') return 'REJECTED';
  return plan.submittedAt ? 'SUBMITTED' : 'DRAFT';
}

/** Counts what has been raised against a plan. */
async function downstreamUsage(planningId) {
  const [cuttingIssues, planApprovals] = await Promise.all([
    prisma.cuttingIssue.count({ where: { planningId, deletedAt: null } }),
    prisma.planApproval.count({ where: { planningId, deletedAt: null } }),
  ]);
  return { cuttingIssues, planApprovals, total: cuttingIssues };
}

/** Explains, in one place, whether and how a plan may be changed. */
function editability(plan, usage) {
  const state = workflowState(plan);
  const open = state === 'DRAFT' || state === 'REJECTED';
  const alive = plan.status !== 'CANCELLED';
  return {
    state,
    /** Lines and quantities move only while the plan is back with the planner. */
    canEditLines: open && alive,
    /** Container, remarks and dates - same window. */
    canEditHeader: open && alive,
    canSubmit: open && alive,
    canDecide: state === 'SUBMITTED',
    /** A rejected plan is revised, which bumps the version. */
    canRevise: state === 'REJECTED',
    canDelete: usage.cuttingIssues === 0 && state !== 'APPROVED',
    lockedBy: usage.cuttingIssues > 0 ? [`${usage.cuttingIssues} cutting issue(s)`] : [],
  };
}

// ===========================================================================
//  PROJECTION
// ===========================================================================

function project(plan) {
  if (!plan) return plan;
  const { _count, ...rest } = plan;
  return {
    ...rest,
    lineCount: _count?.lines ?? plan.lines?.length,
    state: workflowState(plan),
    /*
     * Measured against the plan's own order line.
     *
     * This used to read `plan.order`, which on a multi-style order reported the
     * whole order's quantity as though it were this plan's ceiling - so a plan
     * for a 500-piece style showed 800 permitted and looked 300 under when it
     * was exactly on target.
     */
    allocation: plan.orderLine
      ? allocation(
        {
          orderNo: plan.order?.orderNo,
          orderQty: plan.orderLine.orderQty,
          effectiveQty: plan.orderLine.effectiveQty,
          excessPct: plan.order?.excessPct ?? 0,
          excessApprovedPct: plan.order?.excessApprovedPct ?? 0,
          excessApprovalStatus: plan.order?.excessApprovalStatus,
        },
        plan.plannedQty,
        plan.plannedCuttingPcs,
      )
      : undefined,
  };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    status, approvalStatus, state, orderId, planDepartment, containerNo,
    planFrom, planTo,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(status ? { status } : {}),
    ...(approvalStatus ? { approvalStatus } : {}),
    ...(orderId ? { orderId } : {}),
    ...(planDepartment ? { planDepartment } : {}),
    ...(containerNo ? { containerNo } : {}),
    // DRAFT and SUBMITTED are both approvalStatus PENDING; submittedAt splits them.
    ...(state === 'DRAFT' ? { approvalStatus: 'PENDING', submittedAt: null } : {}),
    ...(state === 'SUBMITTED' ? { approvalStatus: 'PENDING', submittedAt: { not: null } } : {}),
    ...(state === 'APPROVED' ? { approvalStatus: 'APPROVED' } : {}),
    ...(state === 'REJECTED' ? { approvalStatus: 'REJECTED' } : {}),
    ...(planFrom || planTo
      ? {
          planDate: {
            ...(planFrom ? { gte: new Date(planFrom) } : {}),
            ...(planTo ? { lte: new Date(planTo) } : {}),
          },
        }
      : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total] = await Promise.all([
    prisma.planning.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.planning.count({ where }),
  ]);

  return { rows: rows.map(project), total, page, pageSize };
}

/** Full plan detail: header, lines, allocation, unit rollup, approval trail. */
export async function getById(id) {
  const plan = await prisma.planning.findFirst({
    where: { id, deletedAt: null },
    include: {
      order: { select: ORDER_SELECT },
      orderLine: { select: ORDER_LINE_SELECT },
      style: { select: { id: true, styleNo: true, styleDescription: true } },
      lines: { where: { deletedAt: null }, orderBy: LINE_ORDER },
    },
  });
  if (!plan) throw ApiError.notFound('Plan');

  const [usage, approvals, history, siblings] = await Promise.all([
    downstreamUsage(id),
    prisma.planApproval.findMany({
      where: { planningId: id, deletedAt: null },
      orderBy: { round: 'asc' },
    }),
    prisma.approvalHistory.findMany({
      where: { documentType: 'PLANNING', documentId: id },
      orderBy: { actedAt: 'asc' },
    }),
    // Every other plan on this order - which department, and which style. On a
    // multi-style order these are two different things, so the row says both.
    prisma.planning.findMany({
      where: { orderId: plan.orderId, deletedAt: null, id: { not: id } },
      select: {
        id: true,
        planNo: true,
        planDepartment: true,
        plannedQty: true,
        status: true,
        approvalStatus: true,
        submittedAt: true,
        version: true,
        orderLineId: true,
        styleNo: true,
      },
      orderBy: [{ styleNo: 'asc' }, { planDepartment: 'asc' }],
    }),
  ]);

  return {
    ...project(plan),
    // F-10: read by withApprovability() in the controller, then removed.
    createdById: plan.createdById,
    unitAllocation: departmentUsesUnit(plan.planDepartment) ? unitAllocation(plan.lines) : [],
    orderAllocation: {
      // The ceiling for THIS PLAN'S STYLE, not for the whole order.
      permittedQty: D(plan.orderLine.effectiveQty).toFixed(4),
      thisPlan: D(plan.plannedQty).toFixed(4),
      /** Other plans for the same style - i.e. other departments. */
      otherDepartments: siblings
        .filter((x) => x.orderLineId === plan.orderLineId)
        .map((x) => ({ ...x, plannedQty: D(x.plannedQty).toFixed(4), state: workflowState(x) })),
      /** Plans for the OTHER styles on this order. */
      otherStyles: siblings
        .filter((x) => x.orderLineId !== plan.orderLineId)
        .map((x) => ({ ...x, plannedQty: D(x.plannedQty).toFixed(4), state: workflowState(x) })),
    },
    usage,
    editable: editability(plan, usage),
    approvals,
    history,
  };
}

// ===========================================================================
//  COMMANDS
// ===========================================================================

/**
 * Creates a plan, header and lines together.
 *
 * One live plan exists per (order, department); a rejected plan is revised in
 * place and its version bumped, which is what the Plan Approval sheet's
 * "Revised plan v2" records. A second plan for the same order and department is
 * therefore refused rather than silently allotting the order twice.
 */
export async function create(input, actorId) {
  await validateDropdowns(input);
  const { order, line, subject } = await resolvePlanSubject(input.orderId, input.orderLineId);

  // One plan per (order line, department). Two styles on one order get two
  // cutting plans; the same style twice does not.
  const clash = await prisma.planning.findFirst({
    where: {
      orderId: order.id,
      orderLineId: line.id,
      planDepartment: input.planDepartment,
      deletedAt: null,
    },
    select: { id: true, planNo: true },
  });
  if (clash) {
    throw ApiError.conflict(
      `${line.style.styleNo} on order ${order.orderNo} already has a ` +
        `${input.planDepartment.toLowerCase()} plan (${clash.planNo}). Edit or revise that plan ` +
        'rather than starting a second one for the same style.',
      { existingPlanId: clash.id, existingPlanNo: clash.planNo },
    );
  }

  const raw = normaliseLines(input.lines, input.planDepartment);
  await validateLines(raw);
  // The BOM's answer, not the planner's: see estimateFabric.
  const lines = withFabricEstimates(raw, input.planDepartment, line.style);

  const { plannedQty, plannedCuttingPcs, plannedFabricQty } = totalsFromLines(lines);
  const alloc = allocation(subject, plannedQty, plannedCuttingPcs);
  assertWithinPermitted(subject, alloc);

  const planNo = await nextNumber('PLANNING');

  const plan = await prisma.planning.create({
    data: {
      planNo,
      planDepartment: input.planDepartment,
      containerNo: input.containerNo ?? null,
      orderId: order.id,
      // The line this plan is for, and its style. Both from the line itself -
      // never from the order header, which on a multi-style order names only
      // the first style and carries every style's quantity.
      orderLineId: line.id,
      styleId: line.styleId,
      styleNo: line.style.styleNo,
      orderQty: D(line.orderQty),
      planDate: input.planDate ? new Date(input.planDate) : new Date(),
      status: 'PENDING',
      remarks: input.remarks ?? null,
      approvalStatus: 'PENDING',
      version: 1,
      plannedQty,
      plannedCuttingPcs,
      plannedFabricQty,
      lines: { create: lines.map((l) => ({ ...l, createdById: actorId, updatedById: actorId })) },
      createdById: actorId,
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  await recordHistory(plan, 'SUBMITTED', {
    toStatus: 'DRAFT',
    actorId,
    remarks: `Plan drafted for ${alloc.plannedQty} of ${alloc.permittedQty} permitted pieces`,
  });

  return project(plan);
}

/**
 * Edits a plan while it is still with the planner.
 *
 * Lines are replaced wholesale when supplied - the grid is small and edited as a
 * unit, and a full replacement keeps the line numbering and the recomputed
 * totals honest. The ceiling is re-checked against the order as it stands now,
 * not as it stood when the plan was drawn.
 */
export async function update(id, input, actorId) {
  const existing = await prisma.planning.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { where: { deletedAt: null }, orderBy: LINE_ORDER } },
  });
  if (!existing) throw ApiError.notFound('Plan');

  const usage = await downstreamUsage(id);
  const editable = editability(existing, usage);
  if (!editable.canEditHeader) {
    throw ApiError.conflict(
      editable.state === 'SUBMITTED'
        ? 'This plan is with the approver. Recall it or wait for the decision before editing.'
        : editable.state === 'APPROVED'
          ? 'An approved plan cannot be edited.'
          : 'A cancelled plan cannot be edited.',
      { state: editable.state },
    );
  }

  await validateDropdowns(input);
  const { subject, line } = await resolvePlanSubject(existing.orderId, existing.orderLineId);

  const raw = input.lines ? normaliseLines(input.lines, existing.planDepartment) : existing.lines;
  if (input.lines) await validateLines(raw);
  const lines = input.lines
    ? withFabricEstimates(raw, existing.planDepartment, line.style)
    : raw;

  const { plannedQty, plannedCuttingPcs, plannedFabricQty } = totalsFromLines(lines);
  const alloc = allocation(subject, plannedQty, plannedCuttingPcs);
  assertWithinPermitted(subject, alloc);

  const plan = await prisma.$transaction(async (tx) => {
    if (input.lines) {
      // A hard delete, deliberately, and the one place in this codebase that
      // does not soft-delete. Lines are numbered 1..n under a unique key on
      // (planningId, lineNo); soft-deleted rows would keep their numbers and
      // collide with the replacements. The grid is only ever replaced while the
      // plan is a draft or a rejected plan being revised, so nothing approved
      // or issued against is being erased - and the approval trail, which is
      // what an audit reads, is untouched.
      await tx.planningLine.deleteMany({ where: { planningId: id } });
    }
    return tx.planning.update({
      where: { id },
      data: {
        ...(input.planDepartment !== undefined ? { planDepartment: input.planDepartment } : {}),
        ...(input.containerNo !== undefined ? { containerNo: input.containerNo } : {}),
        ...(input.planDate !== undefined ? { planDate: new Date(input.planDate) } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        // The Auto columns are re-synced from the plan's own ORDER LINE on
        // every write, so a change to the line's quantity is picked up and the
        // style can never drift from the line the plan belongs to.
        styleId: line.styleId,
        styleNo: line.style.styleNo,
        orderQty: D(line.orderQty),
        plannedQty,
        plannedCuttingPcs,
        plannedFabricQty,
        ...(input.lines
          ? {
              lines: {
                create: lines.map((l) => ({ ...l, createdById: actorId, updatedById: actorId })),
              },
            }
          : {}),
        updatedById: actorId,
      },
      include: LIST_INCLUDE,
    });
  });

  return project(plan);
}

// ---------------------------------------------------------------------------
//  Lines
// ---------------------------------------------------------------------------

/** Replaces the whole allotment grid. The ceiling is re-checked. */
export async function setLines(id, inputLines, actorId) {
  return update(id, { lines: inputLines }, actorId);
}

/**
 * Moves one line's status or remark once the plan is live.
 *
 * This is the only write allowed on an approved plan: the floor reporting that
 * a day's allotment is done. It cannot touch a quantity, so it cannot breach
 * the ceiling.
 */
export async function setLineStatus(id, lineId, { status, remark }, actorId) {
  const line = await prisma.planningLine.findFirst({
    where: { id: lineId, planningId: id, deletedAt: null },
    include: { planning: { select: { id: true, planNo: true, status: true } } },
  });
  if (!line) throw ApiError.notFound('Plan line');
  if (line.planning.status === 'CANCELLED') {
    throw ApiError.badRequest('This plan is cancelled');
  }

  await prisma.planningLine.update({
    where: { id: lineId },
    data: {
      ...(status !== undefined ? { status } : {}),
      ...(remark !== undefined ? { remark } : {}),
      updatedById: actorId,
    },
  });

  return getById(id);
}

// ---------------------------------------------------------------------------
//  Approval flow
// ---------------------------------------------------------------------------

/**
 * Where a submitted plan goes.
 *
 * The submit dialog used to make the planner choose this from L_AuthorisedBy,
 * which listed the two people it could ever be. Every plan in this office goes
 * to the same desk, so the question had one real answer and the dropdown was a
 * step that could only be got wrong - a plan submitted to the wrong name is
 * a plan nobody is looking for.
 *
 * A plain string rather than a user id: `submittedTo` is a VarChar on four
 * tables and is printed on the approval sheet, so it has always been a NAME
 * rather than an account. Routing to a real Director login is a larger change
 * - a column, a way to nominate who holds the post, and queue filtering by
 * assignee - and is not what this is.
 */
const DEFAULT_APPROVER = 'Director';

/**
 * Submits the plan to the GM / Director.
 *
 * Opens a PlanApproval round - the " Plan Approval" sheet - and re-checks the
 * ceiling, because the order's excess may have moved since the plan was drawn.
 */
export async function submit(id, { submittedTo, remarks }, actor) {
  const plan = await prisma.planning.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { where: { deletedAt: null } } },
  });
  if (!plan) throw ApiError.notFound('Plan');

  const usage = await downstreamUsage(id);
  const editable = editability(plan, usage);
  if (!editable.canSubmit) {
    throw ApiError.badRequest(
      editable.state === 'SUBMITTED'
        ? 'This plan has already been submitted and is awaiting a decision.'
        : editable.state === 'APPROVED'
          ? 'This plan is already approved.'
          : 'A cancelled plan cannot be submitted.',
      { state: editable.state },
    );
  }
  if (plan.lines.length === 0) {
    throw ApiError.badRequest('A plan with no allotment lines cannot be submitted');
  }

  /*
   * `validateDropdowns` checks against L_AuthorisedBy only when a value was
   * actually sent, so an explicit recipient is still verified. The default is
   * applied AFTER that check, deliberately: it is our own constant, not a
   * master-list value somebody could rename or deactivate out from under the
   * submit button.
   */
  await validateDropdowns({ submittedTo });
  const recipient = submittedTo?.trim() || DEFAULT_APPROVER;

  const { subject } = await resolvePlanSubject(plan.orderId, plan.orderLineId);
  const { plannedQty, plannedCuttingPcs, plannedFabricQty } = totalsFromLines(plan.lines);
  const alloc = allocation(subject, plannedQty, plannedCuttingPcs);
  assertWithinPermitted(subject, alloc);

  // Each round replaces exactly the one before it, so a rejected version and
  // the corrected version that followed stay linked. Round 1 replaces nothing.
  // `plan_approvals_later_rounds_supersede` refuses a later round that names no
  // predecessor, which is what keeps the version chain unbroken (§15).
  const previous = await prisma.planApproval.findFirst({
    where: { planningId: id, deletedAt: null },
    orderBy: { round: 'desc' },
    select: { id: true, round: true },
  });
  const round = (previous?.round ?? 0) + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const approvalNo = await nextNumber('PLAN_APPROVAL', { tx });

    await tx.planApproval.create({
      data: {
        approvalNo,
        submittedDate: new Date(),
        orderId: plan.orderId,
        containerNo: plan.containerNo,
        preparedBy: actor.fullName,
        submittedTo: recipient,
        approvalStatus: 'PENDING',
        rectificationRemarks: remarks ?? null,
        planningId: id,
        round,
        supersedesId: previous?.id ?? null,
        preparedById: actor.userId,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });

    return tx.planning.update({
      where: { id },
      data: {
        approvalStatus: 'PENDING',
        submittedTo: recipient,
        submittedAt: new Date(),
        submittedById: actor.userId,
        submittedByName: actor.fullName,
        approvedAt: null,
        approvedById: null,
        approvedByName: null,
        rejectionReason: null,
        // The totals are re-stamped from the lines at the moment of submission.
        plannedQty,
        plannedCuttingPcs,
        plannedFabricQty,
        updatedById: actor.userId,
      },
      include: LIST_INCLUDE,
    });
  });

  await recordHistory(updated, 'SUBMITTED', {
    fromStatus: workflowState(plan),
    toStatus: 'SUBMITTED',
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks:
      remarks ??
      `Round ${round}: ${alloc.plannedQty} pieces submitted to ${recipient}` +
        (alloc.usesExcess ? ` (uses ${alloc.excessUsedQty} of the approved excess)` : ''),
  });

  return project(updated);
}

/** Pulls a submitted plan back before a decision is taken. */
export async function recall(id, { reason }, actor) {
  const plan = await prisma.planning.findFirst({ where: { id, deletedAt: null } });
  if (!plan) throw ApiError.notFound('Plan');
  if (workflowState(plan) !== 'SUBMITTED') {
    throw ApiError.badRequest('Only a submitted plan that has not been decided can be recalled');
  }

  const open = await prisma.planApproval.findFirst({
    where: { planningId: id, approvalStatus: 'PENDING', deletedAt: null },
    orderBy: { round: 'desc' },
  });

  const [updated] = await prisma.$transaction([
    prisma.planning.update({
      where: { id },
      data: { submittedAt: null, submittedById: null, updatedById: actor.userId },
      include: LIST_INCLUDE,
    }),
    ...(open
      ? [
          prisma.planApproval.update({
            where: { id: open.id },
            data: {
              deletedAt: new Date(),
              deletedById: actor.userId,
              rectificationRemarks: `Recalled by the planner: ${reason}`,
            },
          }),
        ]
      : []),
  ]);

  await recordHistory(updated, 'REOPENED', {
    fromStatus: 'SUBMITTED',
    toStatus: 'DRAFT',
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks: reason,
  });

  return project(updated);
}

/**
 * Approves the plan ("Approved by Vinay ji (GM) / Dinesh Sir").
 *
 * The ceiling is checked one final time here. Between drafting and approval the
 * order can be amended - an approved excess returns to PENDING whenever the
 * quantity moves - so a plan that was legal when drawn can be illegal by the
 * time it reaches the approver. Approving it would let unauthorised pieces
 * through to Cutting Issue, so it is refused instead.
 */
export async function approve(id, { remarks }, actor) {
  const plan = await prisma.planning.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { where: { deletedAt: null } } },
  });
  if (!plan) throw ApiError.notFound('Plan');

  /*
   * MAKER-CHECKER. This service approves by writing its own columns and never
   * reaches approvalEngine.transition(), so the engine's registry-driven check
   * does not cover it. The call has to be here.
   */assertNotSelfApproval(plan, actor, 'plan');
  if (workflowState(plan) !== 'SUBMITTED') {
    throw ApiError.badRequest(
      workflowState(plan) === 'DRAFT'
        ? 'This plan has not been submitted for approval yet.'
        : `This plan is already ${plan.approvalStatus.toLowerCase()}.`,
    );
  }

  const { subject } = await resolvePlanSubject(plan.orderId, plan.orderLineId, { forWrite: false });
  const { plannedQty, plannedCuttingPcs, plannedFabricQty } = totalsFromLines(plan.lines);
  const alloc = allocation(subject, plannedQty, plannedCuttingPcs);
  assertWithinPermitted(subject, alloc);

  const open = await prisma.planApproval.findFirst({
    where: { planningId: id, approvalStatus: 'PENDING', deletedAt: null },
    orderBy: { round: 'desc' },
  });

  const decidedAt = new Date();
  /*
   * AN INTERACTIVE TRANSACTION, SO THE DECISION CAN BE CLAIMED RATHER THAN
   * ASSUMED.
   *
   * This was a `$transaction([...])` batch, which cannot look at the result of
   * its own first statement. Two problems came with that. The state check above
   * runs outside the transaction, so two approvers both passed it and both
   * wrote; and `workflowState` was never written, so a plan whose
   * `approvalStatus` said APPROVED still read DRAFT or SUBMITTED in the column
   * the approval queue and the engine registry consult - PLN-123 is that,
   * DRAFT on the column and APPROVED on the decision.
   *
   * Claiming the row by naming the status it must still hold fixes both: the
   * write is the guard, and both columns move in the one statement.
   */
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.planning.updateMany({
      where: { id, approvalStatus: 'PENDING' },
      data: {
        approvalStatus: 'APPROVED',
        workflowState: 'APPROVED',
        approvedAt: decidedAt,
        approvedById: actor.userId,
        approvedByName: actor.fullName,
        rejectionReason: null,
        status: plan.status === 'PENDING' ? 'IN_PROGRESS' : plan.status,
        plannedQty,
        plannedCuttingPcs,
        plannedFabricQty,
        updatedById: actor.userId,
      },
    });

    if (claimed.count === 0) {
      throw new ApiError(
        409,
        `Plan ${plan.planNo} was decided by somebody else a moment ago. Your decision was not `
        + 'recorded. Reload it and check what was decided before acting again.',
        { code: ERROR_CODES.CONCURRENT_DECISION },
      );
    }

    if (open) {
      await tx.planApproval.update({
        where: { id: open.id },
        data: {
          approvalStatus: 'APPROVED',
          workflowState: 'APPROVED',
          approvedDate: decidedAt,
          decidedAt,
          approvedById: actor.userId,
          approvedByName: actor.fullName,
          rejectionReason: null,
          // Approving the PLAN closes the open approval round, and an
          // approved round is immutable (§15) - so this locks it, exactly
          // as planApproval.approve() does when the round is decided from
          // its own screen. Two doors onto one act; both must lock it, and
          // `plan_approvals_approved_is_locked` refuses the row if either
          // forgets.
          isLocked: true,
          lockedAt: decidedAt,
          updatedById: actor.userId,
        },
      });
    }

    return tx.planning.findUnique({ where: { id }, include: LIST_INCLUDE });
  });

  await recordHistory(updated, 'APPROVED', {
    fromStatus: 'SUBMITTED',
    toStatus: 'APPROVED',
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks:
      remarks ??
      `Approved for ${alloc.plannedQty} pieces against a ceiling of ${alloc.permittedQty}`,
  });

  return project(updated);
}

/** Rejects the plan. It goes back to the planner, who revises and resubmits. */
export async function reject(id, { reason, rectification }, actor) {
  const plan = await prisma.planning.findFirst({ where: { id, deletedAt: null } });
  if (!plan) throw ApiError.notFound('Plan');
  if (workflowState(plan) !== 'SUBMITTED') {
    throw ApiError.badRequest('There is no plan awaiting a decision here.');
  }

  const open = await prisma.planApproval.findFirst({
    where: { planningId: id, approvalStatus: 'PENDING', deletedAt: null },
    orderBy: { round: 'desc' },
  });

  const rejectedAt = new Date();

  // Claimed, and both status columns together - see the note in approve().
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.planning.updateMany({
      where: { id, approvalStatus: 'PENDING' },
      data: {
        approvalStatus: 'REJECTED',
        workflowState: 'REJECTED',
        rejectionReason: reason,
        approvedAt: null,
        approvedById: null,
        approvedByName: null,
        updatedById: actor.userId,
      },
    });

    if (claimed.count === 0) {
      throw new ApiError(
        409,
        `Plan ${plan.planNo} was decided by somebody else a moment ago. Your decision was not `
        + 'recorded. Reload it and check what was decided before acting again.',
        { code: ERROR_CODES.CONCURRENT_DECISION },
      );
    }

    if (open) {
      await tx.planApproval.update({
        where: { id: open.id },
        data: {
          approvalStatus: 'REJECTED',
          workflowState: 'REJECTED',
          rejectionReason: reason,
          rectificationRemarks: rectification ?? open.rectificationRemarks,
          // A refusal is a decision, and a decision carries who made it and
          // when. `plan_approvals_decided_at_present` allows only a PENDING
          // round to have neither.
          decidedAt: rejectedAt,
          approvedById: actor.userId,
          approvedByName: actor.fullName,
          updatedById: actor.userId,
        },
      });
    }

    return tx.planning.findUnique({ where: { id }, include: LIST_INCLUDE });
  });

  await recordHistory(updated, 'REJECTED', {
    fromStatus: 'SUBMITTED',
    toStatus: 'REJECTED',
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks: rectification ? `${reason} - ${rectification}` : reason,
  });

  return project(updated);
}

/**
 * Opens a rejected plan for revision. Bumps the version, which is what the Plan
 * Approval sheet calls "Revised plan v2", and returns it to draft.
 */
export async function revise(id, { remarks }, actor) {
  const plan = await prisma.planning.findFirst({ where: { id, deletedAt: null } });
  if (!plan) throw ApiError.notFound('Plan');
  if (workflowState(plan) !== 'REJECTED') {
    throw ApiError.badRequest('Only a rejected plan is revised. Edit the draft instead.');
  }

  const updated = await prisma.planning.update({
    where: { id },
    data: {
      version: plan.version + 1,
      approvalStatus: 'PENDING',
      submittedAt: null,
      submittedById: null,
      rejectionReason: null,
      ...(remarks !== undefined ? { remarks } : {}),
      updatedById: actor.userId,
    },
    include: LIST_INCLUDE,
  });

  await recordHistory(updated, 'REWORK_REQUESTED', {
    fromStatus: 'REJECTED',
    toStatus: 'DRAFT',
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks: `Revised plan v${updated.version}${remarks ? ` - ${remarks}` : ''}`,
  });

  return project(updated);
}

// ---------------------------------------------------------------------------
//  Status
// ---------------------------------------------------------------------------

/**
 * Excel marks Planning Status "Auto". The transitions that make sense are
 * guarded here: nothing leaves CANCELLED or COMPLETED, and a plan cannot be
 * worked before it is approved.
 */
const ALLOWED_TRANSITIONS = {
  PENDING: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD: ['PENDING', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export async function setStatus(id, status, actorId) {
  const plan = await prisma.planning.findFirst({ where: { id, deletedAt: null } });
  if (!plan) throw ApiError.notFound('Plan');
  if (plan.status === status) return project(plan);

  const allowed = ALLOWED_TRANSITIONS[plan.status] ?? [];
  if (!allowed.includes(status)) {
    throw ApiError.badRequest(
      `A plan that is ${plan.status.replace('_', ' ').toLowerCase()} cannot move to ` +
        `${status.replace('_', ' ').toLowerCase()}.`,
      { from: plan.status, to: status, allowed },
    );
  }

  if ((status === 'IN_PROGRESS' || status === 'COMPLETED') && plan.approvalStatus !== 'APPROVED') {
    throw ApiError.badRequest(
      'A plan cannot be worked before it is approved. Submit it for approval first.',
      { approvalStatus: plan.approvalStatus },
    );
  }

  if (status === 'CANCELLED') {
    const usage = await downstreamUsage(id);
    if (usage.cuttingIssues > 0) {
      throw ApiError.conflict(
        `This plan has ${usage.cuttingIssues} cutting issue(s) against it and cannot be ` +
          'cancelled. Put it on hold instead.',
        { usage },
      );
    }
  }

  const updated = await prisma.planning.update({
    where: { id },
    data: { status, updatedById: actorId },
    include: LIST_INCLUDE,
  });

  await recordHistory(updated, status === 'CANCELLED' ? 'CANCELLED' : 'SUBMITTED', {
    fromStatus: plan.status,
    toStatus: status,
    actorId,
    remarks: `Status changed from ${plan.status} to ${status}`,
  });

  return project(updated);
}

/** Soft delete. Refused once cutting has been issued against the plan. */
export async function remove(id, actorId) {
  const plan = await prisma.planning.findFirst({ where: { id, deletedAt: null } });
  if (!plan) throw ApiError.notFound('Plan');

  const usage = await downstreamUsage(id);
  if (usage.cuttingIssues > 0) {
    throw ApiError.conflict(
      `This plan has ${usage.cuttingIssues} cutting issue(s) against it and cannot be deleted.`,
      { usage },
    );
  }
  if (plan.approvalStatus === 'APPROVED') {
    throw ApiError.conflict('An approved plan cannot be deleted. Cancel it instead.');
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.planningLine.updateMany({
      where: { planningId: id, deletedAt: null },
      data: { deletedAt: now, deletedById: actorId },
    }),
    prisma.planning.update({
      where: { id },
      data: { deletedAt: now, deletedById: actorId, status: 'CANCELLED' },
    }),
  ]);

  return { deleted: true };
}

// ---------------------------------------------------------------------------
//  Helpers and previews
// ---------------------------------------------------------------------------

async function recordHistory(plan, action, { fromStatus, toStatus, actorId, actorName, remarks }) {
  const previous = await prisma.approvalHistory.count({
    where: { documentType: 'PLANNING', documentId: plan.id },
  });
  await prisma.approvalHistory.create({
    data: {
      documentType: 'PLANNING',
      documentId: plan.id,
      documentNo: plan.planNo,
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

/**
 * What an order permits, and what has already been planned against it.
 *
 * The Planning form calls this the moment an order is picked, so the planner
 * sees the ceiling BEFORE typing a single deliverable size - and sees it in the
 * same terms a refusal would use. No arithmetic happens in the browser.
 */
export async function orderAllocation(orderId, { excludePlanId } = {}) {
  const order = await resolveOrder(orderId, { forWrite: false });

  const [plans, orderLines] = await Promise.all([
    prisma.planning.findMany({
      where: {
        orderId,
        deletedAt: null,
        ...(excludePlanId ? { id: { not: excludePlanId } } : {}),
      },
      select: {
        id: true,
        planNo: true,
        planDepartment: true,
        plannedQty: true,
        plannedCuttingPcs: true,
        status: true,
        approvalStatus: true,
        submittedAt: true,
        version: true,
        orderLineId: true,
        styleNo: true,
      },
      orderBy: { planDepartment: 'asc' },
    }),
    // Every style on the order, so the form can offer them and state each
    // one's own ceiling before anything is typed.
    prisma.buyerOrderLine.findMany({
      where: { orderId, deletedAt: null },
      select: ORDER_LINE_SELECT,
      orderBy: { lineNo: 'asc' },
    }),
  ]);

  /*
   * THE CEILING IS PER STYLE, SO THIS ANSWERS PER STYLE.
   *
   * The form used to get one `permittedQty` for the order and measure whatever
   * the planner typed against it. On a two-style order that is the wrong
   * number for both styles. Each line now carries its own ceiling, what has
   * already been planned against it, and whether it is already spoken for in
   * this department.
   */
  const lines = orderLines.map((l) => {
    const own = plans.filter((p) => p.orderLineId === l.id);
    const plannedSoFar = own.reduce((a, p) => a.plus(D(p.plannedQty)), ZERO);
    return {
      orderLineId: l.id,
      lineNo: l.lineNo,
      style: l.style,
      colorCode: l.colorCode,
      sizeGroup: l.sizeGroup,
      orderQty: D(l.orderQty).toFixed(4),
      permittedQty: D(l.effectiveQty).toFixed(4),
      excessHeadroomQty: D(l.effectiveQty).minus(D(l.orderQty)).toFixed(4),
      plannedQty: plannedSoFar.toFixed(4),
      remainingQty: D(l.effectiveQty).minus(plannedSoFar).toFixed(4),
      plannedDepartments: own.map((p) => p.planDepartment),
      plans: own.map((p) => ({
        id: p.id,
        planNo: p.planNo,
        planDepartment: p.planDepartment,
        plannedQty: D(p.plannedQty).toFixed(4),
        state: workflowState(p),
      })),
    };
  });

  return {
    order: {
      id: order.id,
      orderNo: order.orderNo,
      orderQty: D(order.orderQty).toFixed(4),
      effectiveQty: D(order.effectiveQty).toFixed(4),
      excessPct: D(order.excessPct).toFixed(6),
      excessApprovedPct: D(order.excessApprovedPct).toFixed(6),
      excessApprovalStatus: order.excessApprovalStatus,
      buyerDeliveryDate: order.buyerDeliveryDate,
      colorCode: order.colorCode,
      sizeGroup: order.sizeGroup,
      status: order.status,
      buyer: order.buyer,
      style: order.style,
    },
    /** The ceiling, stated once, in the terms every refusal will use. */
    permittedQty: D(order.effectiveQty).toFixed(4),
    /** What the granted excess adds on top of the plain order quantity. */
    excessHeadroomQty: D(order.effectiveQty).minus(D(order.orderQty)).toFixed(4),
    /** One entry per style on the order, each with its OWN ceiling. */
    lines,
    /** Departments already planned, so the planner knows what exists. */
    departments: plans.map((p) => ({
      ...p,
      plannedQty: D(p.plannedQty).toFixed(4),
      plannedCuttingPcs: D(p.plannedCuttingPcs).toFixed(4),
      state: workflowState(p),
    })),
    plannedDepartments: plans.map((p) => p.planDepartment),
  };
}

/**
 * Checks a grid that has not been saved yet, so the form can show the planner
 * exactly where they stand against the ceiling as they type - and refuse in the
 * browser for the same reason, and in the same words, the API would.
 */
export async function previewAllocation({ orderId, orderLineId, planDepartment, lines = [] }) {
  // The preview is measured against the same line the save would be, so the
  // browser refuses in the same words and for the same reason - including
  // saying nothing at all for a cutting plan, which is not measured in pieces.
  const { order, line, subject } = await resolvePlanSubject(orderId, orderLineId, { forWrite: false });
  const normalised = normaliseLines(lines, planDepartment);

  /*
   * The fabric estimate, worked out the same way the save will work it out.
   * A style with no utilisation makes the calculation impossible rather than
   * wrong, and the planner should read that on the screen as a note rather
   * than meet it as a refusal when they press save.
   */
  let estimated = normalised;
  let fabricNote = null;
  if (planDepartment === 'CUTTING') {
    try {
      estimated = withFabricEstimates(normalised, planDepartment, line.style);
    } catch (err) {
      fabricNote = err.message;
    }
  }

  const { plannedQty, plannedCuttingPcs, plannedFabricQty } = totalsFromLines(estimated);
  const alloc = allocation(subject, plannedQty, plannedCuttingPcs);

  let violation = null;
  try {
    assertWithinPermitted(subject, alloc);
  } catch (err) {
    violation = err.message;
  }

  return {
    orderNo: order.orderNo,
    orderLineId: line.id,
    styleNo: line.style.styleNo,
    colorCode: line.colorCode,
    sizeGroup: line.sizeGroup,
    allocation: alloc,
    /** The BOM's answer for these pieces. Null unless this is a cutting plan. */
    plannedFabricQty: planDepartment === 'CUTTING' ? plannedFabricQty.toFixed(4) : null,
    fabricUom: estimated.find((l) => l.fabricUom)?.fabricUom ?? null,
    /** Why there is no estimate, when there is none. */
    fabricNote,
    /**
     * The rows as they would be saved, so the form can show each line's own
     * fabric rather than a per-unit total spread across its rows.
     */
    lines: estimated.map((l) => ({
      lineDate: l.lineDate,
      unit: l.unit,
      deliverableSize: l.deliverableSize?.toFixed(4) ?? null,
      fabricQty: l.fabricQty?.toFixed(4) ?? null,
      fabricUom: l.fabricUom ?? null,
    })),
    unitAllocation: departmentUsesUnit(planDepartment) ? unitAllocation(estimated) : [],
    /** Null when the grid is legal; the exact refusal message when it is not. */
    violation,
  };
}

/** Plan dropdown for Cutting Issue and the Plan Approval log. */
export async function options({ orderId, approvedOnly } = {}) {
  return prisma.planning.findMany({
    where: {
      deletedAt: null,
      status: { not: 'CANCELLED' },
      ...(orderId ? { orderId } : {}),
      ...(approvedOnly ? { approvalStatus: 'APPROVED' } : {}),
    },
    orderBy: { planDate: 'desc' },
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      planNo: true,
      planDepartment: true,
      containerNo: true,
      styleNo: true,
      orderQty: true,
      plannedQty: true,
      status: true,
      approvalStatus: true,
      version: true,
      order: { select: { id: true, orderNo: true } },
    },
  });
}
