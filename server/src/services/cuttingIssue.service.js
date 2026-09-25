/**
 * Cutting Issue. Sheet: "Cutting Issue"
 * (Role Acess - Cutting Dept (Supervisor); the Phase 1 brief also gives it to
 * the Store Manager).
 *
 * ===========================================================================
 *  THE LAST DOCUMENT IN THE APPLICATION
 * ===========================================================================
 *
 * The pipeline ends here. Nothing downstream of a cutting issue exists in this
 * system - no stitching record, no QC, no packing, no dispatch - which is not
 * an omission but the agreed scope, and it has one consequence that shapes this
 * whole file:
 *
 *      THERE IS NOTHING AFTER THIS TO CORRECT IT WITH.
 *
 * A purchase order can be amended because a GRN comes later. A plan can be
 * rejected because a revision comes later. Cloth that has been cut cannot be
 * un-cut by anything inside or outside this system. So a cutting issue is
 * verified hard BEFORE it is posted, and is immutable the moment it is.
 *
 * ---------------------------------------------------------------------------
 *  THE TEN CHECKS
 *
 *  `verify()` runs all ten, always, and returns every one of them with a pass
 *  or a fail and a sentence saying why. It does not stop at the first failure:
 *  a supervisor on the cutting floor should be told everything that is wrong in
 *  one go, not sent round the loop ten times.
 *
 *      1  Order exists
 *      2  Order is valid                (not cancelled, not completed)
 *      3  Planning exists               for this order and container
 *      4  Plan approval exists          for this order and container
 *      5  Approval is APPROVED          and that version is the current one
 *      6  Fabric process complete       dyeing / printing returned, where the
 *                                       plan routed the fabric through one
 *      7  Stock / availability          the fabric issue behind it is posted
 *                                       and covers the pieces being cut
 *      8  Within permitted quantity     against the approved plan
 *      9  Excess authorised             where 8 is exceeded, through the
 *                                       configurable excess engine
 *     10  Remainder reconciles          issued = consumed + remainder +
 *                                       wastage, with wastage TYPED rather
 *                                       than inferred                  (C6)
 *
 *  `post()` re-runs the whole set inside the transaction and refuses on any
 *  failure. The preview and the post cannot disagree, because they call the
 *  same function.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError, ERROR_CODES } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber, peekNumber } from './documentNumber.service.js';
import * as excess from './excess.service.js';
import * as engine from './approvalEngine.js';
// C6 - the cutting issue moves stock now. One ledger, one way in.
import {
  DEFAULT_LOCATION,
  LOCATION,
  assertRollNoAvailable,
  postMovement,
} from './inventory.service.js';
import { panelCounts } from '../domain/panels.js';
import { takeNewest } from '../domain/fifo.js';

export const SORTABLE = [
  'challanNo',
  'issueDate',
  'firmName',
  'plannedCutting',
  'cuttingPcsIssued',
  'status',
  'createdAt',
];

const SEARCH = ['challanNo', 'firmName', 'containerNo', 'remarks'];

const D = (v) => new Prisma.Decimal(v ?? 0);

/**
 * The checks, named once so the code and the screen use one vocabulary.
 *
 * C6 ADDS THE TENTH AND CHANGES NOTHING ABOUT THE NINE. All ten run on every
 * posting, none of them short-circuits, and a supervisor is told everything
 * that is wrong at once rather than one thing at a time.
 */
export const CHECKS = [
  ['ORDER_EXISTS', 'Order exists'],
  ['ORDER_VALID', 'Order is valid'],
  ['PLANNING_EXISTS', 'Planning exists'],
  ['PLAN_APPROVAL_EXISTS', 'Plan approval exists'],
  ['APPROVAL_IS_APPROVED', 'Approval is approved'],
  ['FABRIC_PROCESS_COMPLETE', 'Fabric process complete'],
  ['STOCK_AVAILABLE', 'Stock and availability'],
  ['WITHIN_PERMITTED_QTY', 'Within permitted quantity'],
  ['EXCESS_AUTHORISED', 'Excess authorised'],
  /** C6 - issued = consumed + remainder + wastage, or the posting is refused. */
  ['REMAINDER_RECONCILES', 'Remainder reconciles'],
];

/**
 * C6 - THE FABRIC EQUATION. Pure, so it can be proved without a database.
 *
 *     issuedQty = consumedQty + remainderQty + wastageQty + fabricDamageQty
 *
 * WASTAGE IS STATED, NOT DERIVED. Computing it as "whatever is left over"
 * would make this identity hold by construction and therefore test nothing:
 * the arithmetic would absorb a mis-count in silence, which is the exact
 * failure the check exists to catch. The supervisor writes down what was
 * thrown away, and the four numbers either agree or the challan does not post.
 *
 * @returns {{balances: boolean, issued: string, accounted: string, differenceQty: string}}
 */
export function reconcileFabric({
  issuedQty, consumedQty, remainderQty, remnantQty, wastageQty, fabricDamageQty,
}) {
  const issued = D(issuedQty ?? 0);
  const consumed = D(consumedQty ?? 0);
  const remainder = D(remainderQty ?? 0);
  // End-bits kept as remnants. The fifth term: they neither went back on the
  // roll nor in the bin, and without a box of their own they were being
  // entered as wastage and thrown away with it.
  const remnant = D(remnantQty ?? 0);
  const wastage = D(wastageQty ?? 0);
  const fabricDamage = D(fabricDamageQty ?? 0);
  const accounted = consumed.plus(remainder).plus(remnant).plus(wastage).plus(fabricDamage);
  const difference = issued.minus(accounted);

  return {
    issued: issued.toFixed(4),
    consumed: consumed.toFixed(4),
    remainder: remainder.toFixed(4),
    remnant: remnant.toFixed(4),
    wastage: wastage.toFixed(4),
    fabricDamage: fabricDamage.toFixed(4),
    accounted: accounted.toFixed(4),
    differenceQty: difference.toFixed(4),
    balances: difference.isZero(),
    /** Which way it is out, so the message can say "short" or "over". */
    unaccountedQty: difference.greaterThan(0) ? difference.toFixed(4) : '0.0000',
    overAccountedQty: difference.isNegative() ? difference.negated().toFixed(4) : '0.0000',
  };
}

/**
 * PLANNED VS ACTUAL CONSUMPTION. Pure, so it can be proved without a database.
 *
 *     planned    = (good pieces + damaged pieces) x the style's fabric per piece
 *     actual     = consumed + wastage + fabric damage
 *     efficiency = planned / actual
 *
 * Damaged pieces are in the planned figure because cloth was cut for them all
 * the same; leaving them out would blame the marker for a tailor's mistake.
 * The remainder and the remnants are in NEITHER figure: they went back into
 * stock and were not used.
 *
 * Efficiency is a fraction. 1.0 is exactly to standard, 0.95 means the floor
 * used about five per cent more cloth than the style allows, and above 1 it
 * beat the standard - which is worth knowing too, because a standard that is
 * beaten every time is a standard that is too generous.
 *
 * @returns {{stdPerPc: string|null, planned: string|null, actual: string, efficiency: string|null}}
 *   Nulls where there is no standard to measure against (a style whose
 *   average is still 0) or nothing was used - never a made-up 100%.
 */
export function cuttingEfficiency({
  goodPcs, damagedPcs, stdPerPc, consumedQty, wastageQty, fabricDamageQty,
}) {
  const std = D(stdPerPc ?? 0);
  const pieces = D(goodPcs ?? 0).plus(D(damagedPcs ?? 0));
  const actual = D(consumedQty ?? 0).plus(D(wastageQty ?? 0)).plus(D(fabricDamageQty ?? 0));
  const planned = std.greaterThan(0) && pieces.greaterThan(0) ? pieces.mul(std) : null;
  return {
    stdPerPc: std.greaterThan(0) ? std.toFixed(4) : null,
    planned: planned ? planned.toFixed(4) : null,
    actual: actual.toFixed(4),
    efficiency:
      planned && actual.greaterThan(0) ? planned.div(actual).toDecimalPlaces(6).toFixed(6) : null,
  };
}

/**
 * Handles and panels for a number of bags, from the style's panel list.
 *
 * Where the style lists its panels, the handle count is DERIVED - bags x
 * handles per bag - and whatever was typed is not used. Where it does not,
 * the typed count stands, as it always did.
 */
async function derivePanels(client, styleId, bags, typedHandles) {
  const components = styleId
    ? await client.styleComponent.findMany({ where: { styleId }, orderBy: { lineNo: 'asc' } })
    : [];
  const counts = panelCounts(components, bags);
  if (!counts) {
    return {
      handleIssued: D(typedHandles ?? 0),
      panelsPerBag: null,
      handlesPerBag: null,
      panelsIssued: null,
      panelBreakdown: Prisma.DbNull,
    };
  }
  return {
    handleIssued: D(counts.handles),
    panelsPerBag: counts.panelsPerBag,
    handlesPerBag: counts.handlesPerBag,
    panelsIssued: D(counts.panels),
    panelBreakdown: counts.breakdown,
  };
}

const INCLUDE = {
  order: {
    select: {
      id: true,
      orderNo: true,
      orderQty: true,
      effectiveQty: true,
      status: true,
      excessApprovalStatus: true,
      buyerDeliveryDate: true,
      buyer: { select: { id: true, buyerCode: true, buyerName: true } },
      style: { select: { id: true, styleNo: true, styleDescription: true } },
    },
  },
  // `category`, not `styleCategory`. The Style model has never had a
  // `styleCategory` field, so this select made getById() throw a Prisma
  // validation error for every cutting issue - which meant post() could never
  // return its own document. Found by the end-to-end test.
  style: {
    select: {
      id: true,
      styleNo: true,
      styleDescription: true,
      category: true,
      // The tech pack, so the challan the unit receives says what to make.
      bagLength: true,
      bagWidth: true,
      bagHeight: true,
      gussetWidth: true,
      handleDrop: true,
      dimensionUom: true,
      closure: true,
      printPlacement: true,
      artworkVersion: true,
    },
  },
  planning: {
    select: {
      id: true,
      planNo: true,
      planDepartment: true,
      plannedQty: true,
      plannedCuttingPcs: true,
      plannedFabricQty: true,
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
      approvedDate: true,
      approvedByName: true,
      containerNo: true,
      isLocked: true,
      workflowState: true,
    },
  },
  fabricIssue: {
    select: {
      id: true,
      issueNo: true,
      issueDate: true,
      purpose: true,
      fabricQtyIssued: true,
      uom: true,
      postedAt: true,
      status: true,
      roll: { select: { id: true, rollNo: true, stage: true, isHeld: true, balanceQty: true } },
    },
  },
  excessApproval: {
    select: {
      id: true,
      baseQty: true,
      permittedPct: true,
      permittedQty: true,
      maxPermittedQty: true,
      actualQty: true,
      actualExcessQty: true,
      actualExcessPct: true,
      overLimitQty: true,
      status: true,
      approvedByName: true,
      approvedAt: true,
      reason: true,
    },
  },
};

const LIST_INCLUDE = {
  order: { select: { id: true, orderNo: true } },
  style: { select: { id: true, styleNo: true } },
  planApproval: { select: { id: true, approvalNo: true, round: true, approvalStatus: true } },
};

// ===========================================================================
//  THE NINE CHECKS
// ===========================================================================

/**
 * C4 - the specific code FABRIC_PROCESS_COMPLETE fails with when a Fabric
 * Checking Report is required and has not been raised.
 *
 * Distinct from a generic verification failure on purpose: "the fabric is
 * still at the dyer" and "QC has not written the report" are chased by
 * different people, and a caller has to be able to tell them apart without
 * parsing an English sentence.
 */
export const SCRUTINY_REQUIRED_MISSING = 'SCRUTINY_REQUIRED_MISSING';

/** One check result, in the shape every check returns. */
const check = (code, passed, message, detail = {}) => ({
  code,
  label: CHECKS.find(([c]) => c === code)?.[1] ?? code,
  passed,
  message,
  ...detail,
});

/**
 * Runs all nine verifications against a proposed cutting issue.
 *
 * Every check runs, whether or not an earlier one failed, so a supervisor is
 * told everything that is wrong at once. Where a check cannot be evaluated
 * because an earlier one failed - there is no plan to check the approval of -
 * it reports that plainly rather than passing by default.
 *
 * @param {object} input
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export async function verify(input, tx = prisma) {
  const results = [];
  const cutting = D(input.cuttingPcsIssued ?? 0);

  // --- 1. Order exists ----------------------------------------------------
  const order = input.orderId
    ? await tx.buyerOrder.findFirst({
        where: { id: input.orderId, deletedAt: null },
        include: { style: { select: { id: true, styleNo: true } } },
      })
    : null;

  results.push(
    check(
      'ORDER_EXISTS',
      Boolean(order),
      order ? `Order ${order.orderNo} found.` : 'No order named, or the order does not exist.',
      { orderNo: order?.orderNo ?? null },
    ),
  );

  // --- 2. Order is valid --------------------------------------------------
  const orderValid = Boolean(order) && order.status !== 'CANCELLED' && order.status !== 'COMPLETED';
  results.push(
    check(
      'ORDER_VALID',
      orderValid,
      !order
        ? 'Cannot be checked - there is no order.'
        : order.status === 'CANCELLED'
          ? `Order ${order.orderNo} is cancelled. Nothing can be cut against it.`
          : order.status === 'COMPLETED'
            ? `Order ${order.orderNo} is already completed.`
            : `Order ${order.orderNo} is ${order.status.replace(/_/g, ' ').toLowerCase()}.`,
      { orderStatus: order?.status ?? null },
    ),
  );

  // --- 3. Planning exists -------------------------------------------------
  const planning = order
    ? await tx.planning.findFirst({
        where: {
          deletedAt: null,
          orderId: order.id,
          ...(input.planningId ? { id: input.planningId } : {}),
          ...(input.containerNo ? { containerNo: input.containerNo } : {}),
        },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  results.push(
    check(
      'PLANNING_EXISTS',
      Boolean(planning),
      !order
        ? 'Cannot be checked - there is no order.'
        : planning
          ? `Plan ${planning.planNo} covers this order` +
            (planning.containerNo ? ` and container ${planning.containerNo}.` : '.')
          : `No plan exists for ${order.orderNo}` +
            (input.containerNo ? ` and container ${input.containerNo}.` : '.') +
            ' Cutting cannot be issued against an unplanned order.',
      { planNo: planning?.planNo ?? null, planningId: planning?.id ?? null },
    ),
  );

  // --- 4. Plan approval exists --------------------------------------------
  const approval = order
    ? await tx.planApproval.findFirst({
        where: {
          deletedAt: null,
          orderId: order.id,
          ...(input.planApprovalId ? { id: input.planApprovalId } : {}),
          ...(input.containerNo ? { containerNo: input.containerNo } : {}),
        },
        // The latest version, which is the one that counts.
        orderBy: { round: 'desc' },
      })
    : null;

  results.push(
    check(
      'PLAN_APPROVAL_EXISTS',
      Boolean(approval),
      !order
        ? 'Cannot be checked - there is no order.'
        : approval
          ? `${approval.approvalNo} is version ${approval.round} of the plan approval.`
          : `No plan approval exists for ${order.orderNo}` +
            (input.containerNo ? ` / ${input.containerNo}` : '') +
            '. The plan has to be submitted for approval before anything is cut.',
      { approvalNo: approval?.approvalNo ?? null, version: approval?.round ?? null },
    ),
  );

  // --- 5. Approval is APPROVED --------------------------------------------
  // The LATEST version has to be the approved one. An order whose v1 was
  // approved and whose v2 is pending is an order somebody has changed their
  // mind about, and cutting to v1 would cut to a plan nobody now believes in.
  const approvalOk = Boolean(approval) && approval.approvalStatus === 'APPROVED';
  results.push(
    check(
      'APPROVAL_IS_APPROVED',
      approvalOk,
      !approval
        ? 'Cannot be checked - there is no plan approval.'
        : approvalOk
          ? `Version ${approval.round} was approved on ` +
            `${new Date(approval.approvedDate).toISOString().slice(0, 10)}` +
            (approval.approvedByName ? ` by ${approval.approvedByName}.` : '.')
          : `Version ${approval.round} is ${approval.approvalStatus.toLowerCase()}` +
            (approval.approvalStatus === 'REJECTED'
              ? `: ${approval.rejectionReason}. Rectify it and get the new version approved.`
              : '. It has to be approved before cutting.'),
      {
        approvalStatus: approval?.approvalStatus ?? null,
        approvedDate: approval?.approvedDate ?? null,
      },
    ),
  );

  // --- 6. Fabric process complete -----------------------------------------
  const processCheck = await verifyFabricProcess(tx, input);
  results.push(processCheck.result);

  // --- 7. Stock and availability ------------------------------------------
  const stockCheck = await verifyStock(tx, input, cutting);
  results.push(stockCheck.result);

  // --- 8 and 9. Permitted quantity, and the excess if it is exceeded -------
  const quantity = await verifyQuantity(tx, { order, planning, input, cutting });
  results.push(quantity.withinResult);
  results.push(quantity.excessResult);

  // --- 10. C6: the fabric equation ----------------------------------------
  const reconciliation = verifyRemainder(input);
  results.push(reconciliation.result);

  const failures = results.filter((r) => !r.passed);

  return {
    checks: results,
    passed: failures.length === 0,
    failures,
    /** What was resolved along the way, so the caller does not re-query it. */
    resolved: {
      order,
      planning,
      approval,
      fabricIssue: stockCheck.fabricIssue,
      jobWork: processCheck.jobWork,
      excess: quantity.assessment,
      permittedQty: quantity.permittedQty,
      reconciliation: reconciliation.figures,
    },
  };
}

/**
 * Check 10. C6 - THE REMAINDER RECONCILES.
 *
 * Everything that came onto the cutting floor for this challan has to be
 * accounted for: cut into panels, thrown away, or put back on the rack.
 *
 *     issuedQty = consumedQty + remainderQty + wastageQty + fabricDamageQty
 *
 * A challan that has not yet stated its fabric quantities is not FAILING this
 * check - it has not reached it. A draft being built up on a phone would
 * otherwise show a red cross against a box the supervisor has not filled in.
 * The posting path is where the absence bites: `post()` refuses a challan that
 * has no issued quantity, because a cutting issue that moves no cloth is not a
 * cutting issue.
 */
function verifyRemainder(input) {
  const figures = reconcileFabric(input);
  const stated = D(input.issuedQty ?? 0).greaterThan(0);

  if (!stated) {
    return {
      figures,
      result: check(
        'REMAINDER_RECONCILES',
        true,
        'No fabric quantities have been entered yet, so there is nothing to reconcile. ' +
          'They are required before this challan can be posted.',
        { ...figures, notYetEntered: true },
      ),
    };
  }

  if (figures.balances) {
    return {
      figures,
      result: check(
        'REMAINDER_RECONCILES',
        true,
        `${figures.issued} issued = ${figures.consumed} consumed + ${figures.remainder} ` +
          `returned + ${figures.remnant} remnants + ${figures.wastage} wastage + ` +
          `${figures.fabricDamage} damaged.`,
        figures,
      ),
    };
  }

  return {
    figures,
    result: check(
      'REMAINDER_RECONCILES',
      false,
      `${figures.issued} came onto the cutting floor and ${figures.accounted} is accounted for ` +
        `(${figures.consumed} consumed + ${figures.remainder} returned + ${figures.remnant} ` +
        `remnants + ${figures.wastage} wastage + ${figures.fabricDamage} damaged). ` +
        (D(figures.differenceQty).greaterThan(0)
          ? `${figures.unaccountedQty} is unaccounted for. Enter the wastage explicitly - it is ` +
            'never inferred.'
          : `${figures.overAccountedQty} more is accounted for than was ever issued.`),
      figures,
    ),
  };
}

/**
 * Check 6. Where the plan routed fabric through dyeing or printing, that work
 * has to have come back before the fabric can be cut.
 *
 * A roll still at the dyer, or held after an out-of-tolerance return, or
 * rejected at scrutiny, is not fabric anybody may cut - and the roll's own
 * stage is what says so.
 */
async function verifyFabricProcess(tx, input) {
  if (!input.fabricIssueId) {
    // Not every cutting issue names its fabric issue - the workbook's own
    // samples do not always - so this is reported rather than failed. Check 7
    // is where the absence actually bites.
    return {
      jobWork: null,
      result: check(
        'FABRIC_PROCESS_COMPLETE',
        true,
        'No fabric issue named, so no job-work process is being waited on.',
        { skipped: true },
      ),
    };
  }

  const fabricIssue = await tx.fabricIssue.findFirst({
    where: { id: input.fabricIssueId, deletedAt: null },
    include: {
      roll: { select: { id: true, rollNo: true, stage: true, isHeld: true } },
      dyeIssues: {
        where: { deletedAt: null },
        select: {
          id: true,
          dyeIssueNo: true,
          process: true,
          qty: true,
          receivedQty: true,
          status: true,
        },
      },
    },
  });

  if (!fabricIssue) {
    return {
      jobWork: null,
      result: check('FABRIC_PROCESS_COMPLETE', false, 'The named fabric issue does not exist.'),
    };
  }

  const roll = fabricIssue.roll;

  /**
   * C4 - "NO SCRUTINY REQUIRED" IS A COMPLETE STATE, NOT AN ABSENT ONE.
   *
   * A job-work return within the process standard needs no Fabric Checking
   * Report, and fabric that needed none must pass this check and proceed
   * straight to cutting. A return OUTSIDE the standard must not: it needs the
   * report, and until one exists the cloth cannot be cut.
   *
   * Before C4 there was no way to tell those two apart. Both looked like a
   * roll with nothing recorded against it.
   */
  const returns = await tx.dyeingReceipt.findMany({
    where: {
      dyeIssueId: { in: fabricIssue.dyeIssues.map((j) => j.id) },
      deletedAt: null,
    },
    select: {
      id: true,
      receiptNo: true,
      requiresScrutiny: true,
      scrutinyId: true,
      variationPct: true,
      standardShrinkageAllowed: true,
    },
  });

  const unscrutinised = returns.filter((r) => r.requiresScrutiny && !r.scrutinyId);

  const outstanding = fabricIssue.dyeIssues.filter(
    (j) => D(j.receivedQty).lessThan(D(j.qty)) && j.status !== 'CANCELLED',
  );

  if (roll?.isHeld) {
    return {
      jobWork: fabricIssue.dyeIssues,
      result: check(
        'FABRIC_PROCESS_COMPLETE',
        false,
        `Roll ${roll.rollNo} is on hold` +
          (roll.stage === 'SCRUTINY_HOLD' ? ' pending scrutiny' : '') +
          '. Held fabric cannot be cut.',
        { rollNo: roll.rollNo, stage: roll.stage },
      ),
    };
  }
  if (roll?.stage === 'REJECTED') {
    return {
      jobWork: fabricIssue.dyeIssues,
      result: check(
        'FABRIC_PROCESS_COMPLETE',
        false,
        `Roll ${roll.rollNo} was rejected at scrutiny.`,
        { rollNo: roll.rollNo },
      ),
    };
  }
  if (outstanding.length > 0) {
    const j = outstanding[0];
    return {
      jobWork: fabricIssue.dyeIssues,
      result: check(
        'FABRIC_PROCESS_COMPLETE',
        false,
        `${j.dyeIssueNo} sent ${D(j.qty).toFixed(2)} for ${j.process.toLowerCase()} and only ` +
          `${D(j.receivedQty).toFixed(2)} has come back. The fabric is still at the vendor.`,
        { jobNo: j.dyeIssueNo, process: j.process, outstanding: outstanding.length },
      ),
    };
  }

  /**
   * C4 - SCRUTINY REQUIRED BUT MISSING. Its own error code, deliberately.
   *
   * The brief asks for FABRIC_PROCESS_COMPLETE to fail "with a specific error
   * code" in this case. A generic verification failure would be indistinguishable
   * from "the fabric is still at the dyer", and those need different actions
   * from different people: one is chased at the vendor, the other is a checking
   * report QC has not done.
   */
  if (unscrutinised.length > 0) {
    const r = unscrutinised[0];
    return {
      jobWork: fabricIssue.dyeIssues,
      result: check(
        'FABRIC_PROCESS_COMPLETE',
        false,
        `Return ${r.receiptNo} came back ` +
          `${D(r.variationPct).mul(100).toDecimalPlaces(2)}% short against a standard of ` +
          `${D(r.standardShrinkageAllowed).mul(100).toDecimalPlaces(2)}%, so a Fabric Checking ` +
          'Report is required before this cloth can be cut. None has been raised against it.',
        {
          errorCode: SCRUTINY_REQUIRED_MISSING,
          rollNo: roll?.rollNo ?? null,
          receiptNo: r.receiptNo,
          receiptId: r.id,
          requiresScrutiny: true,
          scrutinyId: null,
          outstandingScrutinies: unscrutinised.length,
        },
      ),
    };
  }

  const scrutinised = returns.filter((r) => r.requiresScrutiny && r.scrutinyId);

  return {
    jobWork: fabricIssue.dyeIssues,
    result: check(
      'FABRIC_PROCESS_COMPLETE',
      true,
      fabricIssue.dyeIssues.length
        ? `${fabricIssue.dyeIssues.length} job-work lot(s) have all returned; roll ` +
          `${roll?.rollNo} is at stage ${roll?.stage?.replace(/_/g, ' ').toLowerCase()}.` +
          (scrutinised.length
            ? ` ${scrutinised.length} return(s) needed scrutiny and it has been done.`
            : returns.length
              ? ' Every return was within the process standard, so NO SCRUTINY WAS REQUIRED.'
              : '')
        : `Roll ${roll?.rollNo} went straight to cutting - no job work was involved.`,
      {
        rollNo: roll?.rollNo ?? null,
        stage: roll?.stage ?? null,
        // C4: the distinction, stated on the result rather than left implicit.
        // "No scrutiny required" is why this passed, and a screen should be
        // able to say so.
        returnsChecked: returns.length,
        scrutinyRequired: returns.some((r) => r.requiresScrutiny),
        scrutinySatisfied: scrutinised.length,
        noScrutinyRequired: returns.length > 0 && !returns.some((r) => r.requiresScrutiny),
      },
    ),
  };
}

/**
 * Check 7. The fabric behind the challan has to have actually been issued.
 *
 * A cutting issue does NOT move stock again - the Fabric Issue already took the
 * fabric out of the store, which is what a cutting issue cuts from. What is
 * verified here is that the issue exists, that it posted, and that it was for
 * this order.
 */
async function verifyStock(tx, input, cutting) {
  if (!input.fabricIssueId) {
    return {
      fabricIssue: null,
      result: check(
        'STOCK_AVAILABLE',
        false,
        'No fabric issue is named. Cutting has to be issued against fabric that was drawn from ' +
          'the store, or nothing reconciles.',
        { field: 'fabricIssueId' },
      ),
    };
  }

  const fabricIssue = await tx.fabricIssue.findFirst({
    where: { id: input.fabricIssueId, deletedAt: null },
    include: { roll: { select: { id: true, rollNo: true, balanceQty: true, uom: true } } },
  });

  if (!fabricIssue) {
    return {
      fabricIssue: null,
      result: check('STOCK_AVAILABLE', false, 'The named fabric issue does not exist.'),
    };
  }
  if (!fabricIssue.postedAt) {
    return {
      fabricIssue,
      result: check(
        'STOCK_AVAILABLE',
        false,
        `${fabricIssue.issueNo} has not been posted to the stock ledger. The fabric has not ` +
          'left the store.',
        { issueNo: fabricIssue.issueNo },
      ),
    };
  }
  if (input.orderId && fabricIssue.orderId !== input.orderId) {
    return {
      fabricIssue,
      result: check(
        'STOCK_AVAILABLE',
        false,
        `${fabricIssue.issueNo} was issued against a different order.`,
        { issueNo: fabricIssue.issueNo },
      ),
    };
  }

  // How much of this issue other challans have already claimed. Two challans
  // cutting the same fabric issue is normal - lot 1 and lot 2 - but between
  // them they cannot cut more than was issued.
  const claimed = await tx.cuttingIssue.aggregate({
    where: {
      fabricIssueId: fabricIssue.id,
      deletedAt: null,
      status: { not: 'CANCELLED' },
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
    _sum: { cuttingPcsIssued: true },
  });
  const alreadyClaimed = D(claimed._sum.cuttingPcsIssued ?? 0);

  return {
    fabricIssue,
    result: check(
      'STOCK_AVAILABLE',
      true,
      `${fabricIssue.issueNo} released ${D(fabricIssue.fabricQtyIssued).toFixed(2)} ` +
        `${fabricIssue.uom} of roll ${fabricIssue.roll?.rollNo}` +
        (alreadyClaimed.isZero()
          ? '.'
          : `; ${alreadyClaimed.toFixed(0)} pcs already cut against it on other challans.`),
      {
        issueNo: fabricIssue.issueNo,
        rollNo: fabricIssue.roll?.rollNo ?? null,
        fabricQtyIssued: D(fabricIssue.fabricQtyIssued).toFixed(4),
        alreadyCutFromThisIssue: alreadyClaimed.toFixed(4),
        cuttingNow: cutting.toFixed(4),
      },
    ),
  };
}

/**
 * Checks 8 and 9. The quantity, against the approved plan, through the
 * configurable excess engine.
 *
 * The base quantity is the plan's own allotment for this unit where the plan
 * gives one, and the plan's total cutting pieces otherwise. The threshold comes
 * from `excess_rules` - there is no 2% written down here.
 */
async function verifyQuantity(tx, { order, planning, input, cutting }) {
  const cannotCheck = !order || !planning;

  if (cannotCheck) {
    const why = !order ? 'there is no order' : 'there is no plan';
    return {
      permittedQty: null,
      assessment: null,
      withinResult: check(
        'WITHIN_PERMITTED_QTY',
        false,
        `Cannot be checked - ${why} to measure the quantity against.`,
      ),
      excessResult: check('EXCESS_AUTHORISED', false, `Cannot be checked - ${why}.`),
    };
  }

  /*
   * What the plan permits this challan: the unit's own allotment if the challan
   * names one, otherwise the plan's whole quantity.
   *
   * `plannedQty` - the sum of Deliverable Size - rather than
   * `plannedCuttingPcs`. A CUTTING PLAN NO LONGER ALLOTS PIECES: what is
   * handed to a cutting floor is fabric, so the pieces column was replaced by
   * a fabric one and `plannedCuttingPcs` is zero on every cutting plan written
   * since. Reading it here would have capped every new challan at nothing.
   *
   * Deliverable Size is the pieces that plan says the unit must deliver, which
   * is the same ceiling in all but name - and it is what the plan's own
   * over-allotment check already measures against the order.
   */
  const unitAllotment = D(input.unitWiseCuttingPcsToBeIssued ?? 0);
  const base = unitAllotment.greaterThan(0) ? unitAllotment : D(planning.plannedQty);

  // Everything else already cut on this order and container, so two challans
  // cannot each be "within the plan" while together exceeding it.
  const siblings = await tx.cuttingIssue.aggregate({
    where: {
      deletedAt: null,
      orderId: order.id,
      ...(input.containerNo ? { containerNo: input.containerNo } : {}),
      ...(unitAllotment.greaterThan(0) && input.firmName ? { firmName: input.firmName } : {}),
      status: { not: 'CANCELLED' },
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
    _sum: { cuttingPcsIssued: true },
  });
  const alreadyCut = D(siblings._sum.cuttingPcsIssued ?? 0);
  const cumulative = alreadyCut.plus(cutting);

  const assessment = await excess.assess({
    documentType: 'CUTTING_ISSUE',
    orderId: order.id,
    buyerId: order.buyerId,
    baseQty: base,
    actualQty: cumulative,
    uom: 'Pcs',
  });

  const within = assessment.within;
  const authorised =
    within ||
    (Boolean(input.excessApprovalId) && (await excessApprovalUsable(tx, input.excessApprovalId, assessment)));

  return {
    permittedQty: assessment.maxPermittedQty,
    assessment: { ...assessment, alreadyCut: alreadyCut.toFixed(4), cumulative: cumulative.toFixed(4) },
    withinResult: check(
      'WITHIN_PERMITTED_QTY',
      within,
      within
        ? `${cumulative.toFixed(0)} pcs against a permitted ${assessment.maxPermittedQty} ` +
          `(${assessment.baseQty} plus ${assessment.permittedPctDisplay}%).`
        : `${cumulative.toFixed(0)} pcs exceeds the permitted ${assessment.maxPermittedQty} by ` +
          `${assessment.overLimitQty}. ${assessment.explanation}`,
      { excess: assessment },
    ),
    excessResult: check(
      'EXCESS_AUTHORISED',
      authorised,
      within
        ? 'No excess, so no authorisation is needed.'
        : assessment.refused
          ? `${assessment.actualExcessPctDisplay}% is past the ` +
            `${assessment.hardCeilingPctDisplay}% ceiling this rule allows. No authorisation ` +
            'can permit it - the quantity has to come down.'
          : authorised
            ? 'An approved excess authorisation covers the over-limit quantity.'
            : `${assessment.overLimitQty} pcs over the limit needs an approved excess ` +
              'authorisation before this challan can be posted.',
      { requiresExcessApproval: !within && !assessment.refused },
    ),
  };
}

/** Whether a named excess authorisation actually covers what is being cut. */
async function excessApprovalUsable(tx, excessApprovalId, assessment) {
  try {
    await excess.assertPostable(tx, assessment, { excessApprovalId, label: 'This challan' });
    return true;
  } catch {
    return false;
  }
}

// ===========================================================================
//  PROJECTION
// ===========================================================================

function project(ci) {
  if (!ci) return ci;
  const planned = D(ci.unitWiseCuttingPcsToBeIssued);
  const issued = D(ci.cuttingPcsIssued);
  return {
    ...ci,
    posted: Boolean(ci.postedAt),
    /** Against the unit's own allotment, which is what a supervisor tracks. */
    varianceQty: issued.minus(planned).toFixed(4),
    variancePct: planned.isZero()
      ? null
      : issued.minus(planned).div(planned).mul(100).toDecimalPlaces(2).toFixed(2),
    stateLabel: engine.STATE_LABEL[ci.workflowState] ?? ci.workflowState,
  };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    status, orderId, styleId, firmName, containerNo, planApprovalId, isLocked,
    dateFrom, dateTo,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(status ? { status } : {}),
    ...(orderId ? { orderId } : {}),
    ...(styleId ? { styleId } : {}),
    ...(firmName ? { firmName } : {}),
    ...(containerNo ? { containerNo } : {}),
    ...(planApprovalId ? { planApprovalId } : {}),
    ...(isLocked !== undefined ? { isLocked } : {}),
    ...(dateFrom || dateTo
      ? {
          issueDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total, totals] = await Promise.all([
    prisma.cuttingIssue.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.cuttingIssue.count({ where }),
    prisma.cuttingIssue.aggregate({
      where,
      _sum: { cuttingPcsIssued: true, handleIssued: true },
    }),
  ]);

  return {
    rows: rows.map(project),
    total,
    page,
    pageSize,
    totals: {
      cuttingPcsIssued: D(totals._sum.cuttingPcsIssued ?? 0).toFixed(4),
      handleIssued: D(totals._sum.handleIssued ?? 0).toFixed(4),
    },
  };
}

export async function getById(id) {
  const ci = await prisma.cuttingIssue.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!ci) throw ApiError.notFound('Cutting issue');

  const workflow = await engine.statusOf('CUTTING_ISSUE', id);

  return {
    ...project(ci),
    workflow,
    /** The chain this challan sits at the end of - the whole pipeline. */
    traceability: {
      chain: [
        ci.order?.orderNo,
        ci.planning?.planNo,
        ci.planApproval?.approvalNo,
        ci.fabricIssue?.issueNo,
        ci.challanNo,
      ]
        .filter(Boolean)
        .join(' → '),
      orderNo: ci.order?.orderNo ?? null,
      buyerName: ci.order?.buyer?.buyerName ?? null,
      styleNo: ci.style?.styleNo ?? null,
      planNo: ci.planning?.planNo ?? null,
      approvalNo: ci.planApproval?.approvalNo ?? null,
      approvalVersion: ci.planApproval?.round ?? null,
      fabricIssueNo: ci.fabricIssue?.issueNo ?? null,
      rollNo: ci.fabricIssue?.roll?.rollNo ?? null,
    },
    editable: {
      canEdit: !ci.isLocked,
      canPost: !ci.postedAt && ci.status !== 'CANCELLED',
      canDelete: !ci.postedAt && !ci.isLocked,
      /** There is no unpost, and no amend. See the note at the top of this file. */
      canAmend: false,
      lockReason: ci.isLocked
        ? 'Cloth has been cut. This is the last document in the pipeline - there is nothing ' +
          'downstream of it to correct it with, so it does not change.'
        : null,
    },
  };
}

// ===========================================================================
//  COMMANDS
// ===========================================================================

// Container No is typed at Planning and inherited here. See planning.service.js.
async function validateDropdowns(data) {
  if (data.firmName !== undefined) {
    // Optional: cutting is not tracked by unit. A unit that IS named must
    // still be a real one.
    await assertValueInList('StitchingUnit', data.firmName, { field: 'firmName' });
  }
}

/**
 * Drafts a cutting issue.
 *
 * A draft is NOT verified - it is a form somebody is filling in - but `verify()`
 * is returned alongside it so the screen can show what still has to be true
 * before it can be posted.
 */
export async function create(input, actorId) {
  await validateDropdowns(input);

  const verification = await verify(input);
  const { order, planning, approval } = verification.resolved;

  if (!order) {
    throw ApiError.badRequest('Order does not exist', { field: 'orderId' });
  }

  const ci = await prisma.$transaction(async (tx) => {
    const panels = await derivePanels(
      tx,
      input.styleId ?? order.styleId,
      input.cuttingPcsIssued ?? 0,
      input.handleIssued,
    );
    const challanNo = input.challanNo?.trim() || (await nextNumber('CUTTING_ISSUE', { tx }));
    const clash = await tx.cuttingIssue.findUnique({
      where: { challanNo },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict('This challan number already exists', { field: 'challanNo' });

    return tx.cuttingIssue.create({
      data: {
        challanNo,
        issueDate: input.issueDate ? new Date(input.issueDate) : new Date(),
        orderId: order.id,
        styleId: input.styleId ?? order.styleId,
        // Same reason as the ceiling above: a cutting plan's pieces live in
        // plannedQty now, and plannedCuttingPcs is zero on one.
        plannedCutting: D(input.plannedCutting ?? planning?.plannedQty ?? 0),
        firmName: input.firmName ?? '',
        unitWiseCuttingPcsToBeIssued: D(input.unitWiseCuttingPcsToBeIssued ?? 0),
        cuttingPcsIssued: D(input.cuttingPcsIssued ?? 0),
        cuttingPcsDamaged: D(input.cuttingPcsDamaged ?? 0),
        ...panels,
        // C6 - the fabric equation. Stored as given; balanced at posting, not
        // at creation, so a draft can be built up a field at a time.
        issuedQty: D(input.issuedQty ?? 0),
        consumedQty: D(input.consumedQty ?? 0),
        remainderQty: D(input.remainderQty ?? 0),
        remnantQty: D(input.remnantQty ?? 0),
        wastageQty: D(input.wastageQty ?? 0),
        fabricDamageQty: D(input.fabricDamageQty ?? 0),
        fabricUom: input.fabricUom ?? 'Mtrs',
        containerNo: input.containerNo ?? planning?.containerNo ?? null,
        status: 'PENDING',
        workflowState: 'DRAFT',
        remarks: input.remarks ?? null,
        planningId: input.planningId ?? planning?.id ?? null,
        planApprovalId: input.planApprovalId ?? approval?.id ?? null,
        fabricIssueId: input.fabricIssueId ?? null,
        excessApprovalId: input.excessApprovalId ?? null,
        createdById: actorId,
        updatedById: actorId,
      },
      include: LIST_INCLUDE,
    });
  });

  await engine.record(prisma, {
    documentType: 'CUTTING_ISSUE',
    documentId: ci.id,
    documentNo: ci.challanNo,
    action: 'SUBMITTED',
    toStatus: 'DRAFT',
    actor: { userId: actorId },
    remarks: `Drafted for ${order.orderNo}${input.firmName ? `, ${input.firmName}` : ''}`,
  });

  return { ...project(ci), verification };
}

/** Edits a draft. Refused the moment the challan is posted. */
export async function update(id, input, actorId) {
  const existing = await prisma.cuttingIssue.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw ApiError.notFound('Cutting issue');
  assertUnlocked(existing, 'edited');

  await validateDropdowns(input);

  // Re-derived whenever the pieces or the style could have changed, so the
  // handle count never drifts from the bags it was multiplied from.
  const panels =
    input.cuttingPcsIssued !== undefined || input.styleId !== undefined || input.handleIssued !== undefined
      ? await derivePanels(
          prisma,
          input.styleId ?? existing.styleId,
          input.cuttingPcsIssued ?? existing.cuttingPcsIssued,
          input.handleIssued ?? existing.handleIssued,
        )
      : {};

  const ci = await prisma.cuttingIssue.update({
    where: { id },
    data: {
      ...(input.issueDate !== undefined ? { issueDate: new Date(input.issueDate) } : {}),
      ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
      ...(input.styleId !== undefined ? { styleId: input.styleId } : {}),
      ...(input.plannedCutting !== undefined
        ? { plannedCutting: D(input.plannedCutting) }
        : {}),
      ...(input.firmName !== undefined ? { firmName: input.firmName ?? '' } : {}),
      ...(input.unitWiseCuttingPcsToBeIssued !== undefined
        ? { unitWiseCuttingPcsToBeIssued: D(input.unitWiseCuttingPcsToBeIssued) }
        : {}),
      ...(input.cuttingPcsIssued !== undefined
        ? { cuttingPcsIssued: D(input.cuttingPcsIssued) }
        : {}),
      ...(input.cuttingPcsDamaged !== undefined
        ? { cuttingPcsDamaged: D(input.cuttingPcsDamaged) }
        : {}),
      ...panels,
      // C6 - the fabric equation. Individually settable so a supervisor can
      // fill the four boxes as the count comes in; the balance is enforced at
      // posting, and by cutting_issues_remainder_reconciles at every write.
      ...(input.issuedQty !== undefined ? { issuedQty: D(input.issuedQty) } : {}),
      ...(input.consumedQty !== undefined ? { consumedQty: D(input.consumedQty) } : {}),
      ...(input.remainderQty !== undefined ? { remainderQty: D(input.remainderQty) } : {}),
      ...(input.remnantQty !== undefined ? { remnantQty: D(input.remnantQty) } : {}),
      ...(input.wastageQty !== undefined ? { wastageQty: D(input.wastageQty) } : {}),
      ...(input.fabricDamageQty !== undefined
        ? { fabricDamageQty: D(input.fabricDamageQty) }
        : {}),
      ...(input.fabricUom !== undefined ? { fabricUom: input.fabricUom } : {}),
      ...(input.containerNo !== undefined ? { containerNo: input.containerNo } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      ...(input.planningId !== undefined ? { planningId: input.planningId } : {}),
      ...(input.planApprovalId !== undefined ? { planApprovalId: input.planApprovalId } : {}),
      ...(input.fabricIssueId !== undefined ? { fabricIssueId: input.fabricIssueId } : {}),
      ...(input.excessApprovalId !== undefined
        ? { excessApprovalId: input.excessApprovalId }
        : {}),
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  return { ...project(ci), verification: await verify({ ...ci, excludeId: id }) };
}

/**
 * Posts the challan. The cloth is cut.
 *
 * ONE TRANSACTION, and it is the last thing that happens to this document:
 *
 *   - ALL TEN checks run again, against rows the transaction has locked, and
 *     none of them short-circuits;
 *   - any excess authorisation is verified against the numbers being posted and
 *     then CONSUMED, so it cannot be spent twice;
 *   - C6: the ledger entries are APPENDED - an OUT off the cutting floor for
 *     what was consumed and wasted, and an IN to the store for the remainder,
 *     on the same roll it came off;
 *   - the challan is stamped, locked and moved through APPROVED to POSTED.
 *
 * No stock balance is written directly anywhere in this path. `postMovement()`
 * re-derives the balance from the ledger, which is why a reconciliation
 * dry-run after a cutting issue reports zero differences.
 *
 * After this there is no unpost and no amend. See the note at the top of this
 * file for why: nothing downstream of a cutting issue exists to correct it.
 *
 * @param {{userId: string, fullName: string}} actor
 */
export async function post(id, input, actor) {
  const existing = await prisma.cuttingIssue.findFirst({
    where: { id, deletedAt: null },
    include: { order: { select: { orderNo: true } } },
  });
  if (!existing) throw ApiError.notFound('Cutting issue');

  if (existing.postedAt) {
    throw ApiError.conflict(
      `${existing.challanNo} was posted on ` +
        `${new Date(existing.postedAt).toISOString().slice(0, 10)} and cannot be posted again.`,
      { postedAt: existing.postedAt },
    );
  }
  if (existing.status === 'CANCELLED') {
    throw ApiError.conflict(`${existing.challanNo} is cancelled.`);
  }

  const excessApprovalId = input?.excessApprovalId ?? existing.excessApprovalId ?? null;

  /**
   * C6 - a challan that moves no cloth is not a cutting issue.
   *
   * The tenth check reports an unentered equation rather than failing it, so
   * that a half-built draft does not show a red cross against a box nobody has
   * reached yet. THIS is where the absence bites: posting requires the
   * quantities, and requires them to balance.
   */
  if (!D(existing.issuedQty).greaterThan(0)) {
    throw ApiError.badRequest(
      `${existing.challanNo} has no fabric quantities. Enter what came onto the cutting floor, ` +
        'what was consumed, what is being returned and what was wasted before posting - the ' +
        'four have to reconcile and the wastage is never inferred.',
      {
        field: 'issuedQty',
        code: ERROR_CODES.VERIFICATION_FAILED,
        required: ['issuedQty', 'consumedQty', 'remainderQty', 'wastageQty'],
      },
    );
  }

  const posted = await prisma.$transaction(async (tx) => {
    // THE TEN CHECKS, on the transaction, against rows it has locked. Two
    // supervisors posting to the same plan at the same moment both passed the
    // preview; only one passes this. Every check runs - none short-circuits.
    const verification = await verify(
      {
        orderId: existing.orderId,
        styleId: existing.styleId,
        planningId: existing.planningId,
        planApprovalId: existing.planApprovalId,
        fabricIssueId: existing.fabricIssueId,
        // C6 - the fabric equation is checked against the stored figures, on
        // the transaction, immediately before the ledger is written.
        issuedQty: existing.issuedQty,
        consumedQty: existing.consumedQty,
        remainderQty: existing.remainderQty,
        remnantQty: existing.remnantQty,
        wastageQty: existing.wastageQty,
        // Was missing: a challan that recorded fabric damage reconciled on the
        // preview and then failed the same check here, because the posting
        // re-ran the equation without its fourth term.
        fabricDamageQty: existing.fabricDamageQty,
        containerNo: existing.containerNo,
        firmName: existing.firmName,
        unitWiseCuttingPcsToBeIssued: existing.unitWiseCuttingPcsToBeIssued,
        cuttingPcsIssued: existing.cuttingPcsIssued,
        excessApprovalId,
        excludeId: id,
      },
      tx,
    );

    if (!verification.passed) {
      throw new ApiError(
        409,
        `${existing.challanNo} cannot be posted. ` +
          verification.failures.map((f) => `${f.label}: ${f.message}`).join(' '),
        {
          code: ERROR_CODES.VERIFICATION_FAILED,
          details: { verification: verification.checks, failures: verification.failures },
        },
      );
    }

    // Spend the excess authorisation, if one was needed. assertPostable throws
    // rather than returning false, so a mismatched authorisation fails the whole
    // posting rather than quietly posting without one.
    const assessment = verification.resolved.excess;
    if (assessment && !assessment.within) {
      await excess.assertPostable(tx, assessment, {
        excessApprovalId,
        label: `Challan ${existing.challanNo}`,
      });
      await excess.consume(tx, excessApprovalId, {
        documentId: id,
        documentNo: existing.challanNo,
      });
    }

    const postedAt = new Date();

    /**
     * C6 - THE LEDGER, IN THE SAME TRANSACTION AS THE POSTING.
     *
     * A cutting issue used to move no stock at all: the Fabric Issue took the
     * cloth out and nothing recorded what became of it. Now the fabric sits on
     * the CUTTING FLOOR - the Fabric Issue's second leg put it there - and this
     * is what empties it:
     *
     *     OUT  cutting floor   consumed + wastage   (gone for good)
     *     IN   main store      remainder            (back on the rack)
     *
     * The remainder KEEPS ITS ROLL. `rollId` is set on the IN entry, so what
     * comes back is the same roll that went out rather than an anonymous
     * quantity of metres that nobody can trace to a receipt. That is what
     * `reuse the existing roll model` means in practice.
     */
    const ledger = await postFabricMovements(tx, { issue: existing, verification, actor });

    // Planned vs actual, against the style's average AS IT STANDS TODAY, and
    // then frozen - the efficiency report reads these columns, not the style.
    const style = await tx.style.findUnique({
      where: { id: existing.styleId },
      select: { avgFabricUtilizationPerPc: true },
    });
    const eff = cuttingEfficiency({
      goodPcs: existing.cuttingPcsIssued,
      damagedPcs: existing.cuttingPcsDamaged,
      stdPerPc: style?.avgFabricUtilizationPerPc,
      consumedQty: existing.consumedQty,
      wastageQty: existing.wastageQty,
      fabricDamageQty: existing.fabricDamageQty,
    });

    await tx.cuttingIssue.update({
      where: { id },
      data: {
        stdConsumptionPerPc: eff.stdPerPc,
        plannedConsumptionQty: eff.planned,
        actualConsumptionQty: eff.actual,
        cuttingEfficiency: eff.efficiency,
        postedAt,
        postedById: actor.userId,
        postedByName: actor.fullName,
        // C6 - non-null is the proof the ledger moved. `postedAt` alone only
        // proves the paperwork was stamped.
        stockPostedAt: ledger.moved ? postedAt : null,
        inventoryItemId: ledger.itemId ?? existing.inventoryItemId,
        // Immutable from this moment. Posting and locking are one write.
        isLocked: true,
        lockedAt: postedAt,
        excessApprovalId,
        planApprovalId: verification.resolved.approval?.id ?? existing.planApprovalId,
        planningId: verification.resolved.planning?.id ?? existing.planningId,
        remarks: input?.remarks ?? existing.remarks,
        updatedById: actor.userId,
      },
    });

    // DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → POSTED, through the
    // engine, so the trail reads the same as every other document in the
    // system. The cutting floor's own supervisor is the approver, and the
    // same act posts it - but they are two different facts and the trail
    // records both. The document ends in POSTED, which is what the screen
    // shows and what assertUnlocked() enforces.
    await engine.submit(tx, {
      documentType: 'CUTTING_ISSUE',
      documentId: id,
      submittedTo: actor.fullName,
      actor,
      remarks: `Posted: ${D(existing.cuttingPcsIssued).toFixed(0)} pcs to ${existing.firmName || 'stitching'}`,
    });

    await engine.approve(tx, {
      documentType: 'CUTTING_ISSUE',
      documentId: id,
      actor,
      remarks:
        `Cut and issued to ${existing.firmName || 'stitching'}` +
        (assessment && !assessment.within
          ? ` - ${assessment.overLimitQty} pcs over the permitted quantity, authorised.`
          : '.'),
    });

    return engine.post(tx, {
      documentType: 'CUTTING_ISSUE',
      documentId: id,
      actor,
      remarks: `Challan posted and locked. ${D(existing.cuttingPcsIssued).toFixed(0)} pcs.`,
    });
  });

  return getById(posted.id);
}

/**
 * C6 - THE LEDGER LEGS, written inside the posting transaction.
 *
 * ---------------------------------------------------------------------------
 *  NO STOCK BALANCE IS TOUCHED HERE.
 *
 *  Both movements go through `postMovement()`, which appends to the ledger and
 *  then RE-DERIVES the balance by aggregating it. Nothing in this function
 *  adds to or subtracts from a stored balance, which is why a stock
 *  reconciliation dry-run after a cutting issue reports zero differences.
 *
 *  WHERE THE FABRIC COMES FROM
 *
 *  The CUTTING FLOOR, not the main store. The Fabric Issue's second leg put it
 *  there. A challan whose fabric issue predates C3/C5 has no such leg - the
 *  cloth left stock entirely on that issue - and there is nothing on the
 *  cutting floor to take out. That is refused by name rather than silently
 *  skipped: posting without the ledger would be bypassing it.
 * ---------------------------------------------------------------------------
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function postFabricMovements(tx, { issue, verification, actor }) {
  const fabricIssue = verification.resolved.fabricIssue;

  if (!fabricIssue) {
    throw new ApiError(
      409,
      `${issue.challanNo} names no fabric issue, so there is no cloth on the cutting floor to ` +
        'account for. A cutting issue moves stock now: it has to say which issue put the fabric ' +
        'there.',
      { code: ERROR_CODES.VERIFICATION_FAILED, details: { field: 'fabricIssueId' } },
    );
  }

  const roll = await tx.fabricRoll.findUnique({
    where: { id: fabricIssue.roll?.id ?? fabricIssue.rollId },
    include: { inventoryItem: { select: { id: true, itemCategory: true } } },
  });

  if (!roll?.inventoryItemId) {
    throw ApiError.conflict(
      `Roll ${roll?.rollNo ?? ''} is not linked to a stock item, so the cutting movements could ` +
        'not be written to the ledger.',
      { code: ERROR_CODES.VERIFICATION_FAILED },
    );
  }

  const from = issue.cuttingLocation ?? 'CUTTING FLOOR';

  // A fabric issue raised before the in-process locations existed left nothing
  // at the cutting floor to draw down. Say so, rather than posting a challan
  // with no ledger behind it.
  if (!fabricIssue.inProcessLocation) {
    throw new ApiError(
      409,
      `Fabric issue ${fabricIssue.issueNo} predates the cutting-floor stock location, so there ` +
        `is no balance at ${from} for this challan to consume. Raise a fresh fabric issue ` +
        'against an approved cutting challan and post against that.',
      {
        code: ERROR_CODES.VERIFICATION_FAILED,
        details: { field: 'fabricIssueId', issueNo: fabricIssue.issueNo, legacyIssue: true },
      },
    );
  }

  const consumed = D(issue.consumedQty);
  const wastage = D(issue.wastageQty);
  const fabricDamage = D(issue.fabricDamageQty);
  const remainder = D(issue.remainderQty);
  const remnant = D(issue.remnantQty);

  const snapshot = {
    itemCategory: roll.inventoryItem?.itemCategory ?? 'Fabric',
    colorCode: roll.colorCode,
    gsm: roll.gsm,
    content: roll.content,
    uom: roll.uom,
  };

  // ---- OUT: EVERYTHING that came onto the floor for this challan ---------
  //
  //     OUT (cutting floor) = consumed + wastage + fabric damage + remainder = issuedQty
  //     IN  (main store)    = remainder
  //
  // The remainder is in BOTH legs on purpose, and getting that wrong is what
  // the end-to-end test caught: taking out only consumption and wastage left
  // the remainder sitting on the cutting floor AND added it back to the store,
  // so fifteen metres existed twice and total on-hand was overstated by
  // exactly the remainder of every challan ever posted.
  //
  // Read as a pair the two legs say the true thing: a hundred metres left the
  // floor, fifteen came back to the rack, and the eighty-five in between is
  // the cloth that became panels and offcuts. The floor ends at zero for this
  // challan, which is what "the challan is finished" means physically.
  const leaving = consumed.plus(wastage).plus(fabricDamage).plus(remainder).plus(remnant);
  // FIFO - what the floor gave up, layer by layer. The remainder and the
  // remnants go back carrying the NEWEST part of it: the oldest cloth is the
  // cloth that was cut.
  let backToStore = [];
  let toRemnants = [];
  if (leaving.greaterThan(0)) {
    const out = await postMovement(tx, {
      itemId: roll.inventoryItemId,
      rollId: roll.id,
      direction: 'OUT',
      qty: leaving,
      rate: roll.rate ?? 0,
      entryDate: issue.issueDate,
      location: from,
      documentType: 'CUTTING_ISSUE',
      documentId: issue.id,
      documentNo: issue.challanNo,
      orderId: issue.orderId,
      snapshot,
      remarks:
        `Cut on ${issue.challanNo}: ${consumed.toFixed(4)} ${issue.fabricUom} consumed` +
        (wastage.greaterThan(0) ? `, ${wastage.toFixed(4)} wastage` : '') +
        (fabricDamage.greaterThan(0) ? `, ${fabricDamage.toFixed(4)} fabric damage` : '') +
        (remainder.greaterThan(0) ? `, ${remainder.toFixed(4)} returned to store` : '') +
        (remnant.greaterThan(0) ? `, ${remnant.toFixed(4)} kept as remnants` : ''),
      actor,
    });
    [backToStore, toRemnants] = takeNewest(out.consumed, [remainder, remnant]);
  }

  // ---- IN: the remnants, as a short roll of their own ---------------------
  //
  // End-bits are not the remainder - they are no longer on the roll - and they
  // are not wastage, because they can still be cut into a pocket or a handle.
  // Booking them as a roll is what lets the ordinary Fabric Issue issue them
  // again. Numbered after the parent (FAB-0123-R1) and linked to it, so the
  // cloth still traces back to the receipt that bought it.
  let remnantRoll = null;
  if (remnant.greaterThan(0)) {
    const siblings = await tx.fabricRoll.count({ where: { parentRollId: roll.id } });
    const remnantNo = `${roll.rollNo}-R${siblings + 1}`;
    await assertRollNoAvailable(tx, remnantNo);
    remnantRoll = await tx.fabricRoll.create({
      data: {
        rollNo: remnantNo,
        isRemnant: true,
        parentRollId: roll.id,
        grnId: roll.grnId,
        vendorId: roll.vendorId,
        inventoryItemId: roll.inventoryItemId,
        fabricName: roll.fabricName,
        colorCode: roll.colorCode,
        content: roll.content,
        count: roll.count,
        construction: roll.construction,
        width: roll.width,
        gsm: roll.gsm,
        uom: roll.uom,
        shade: roll.shade ?? null,
        dyeLot: roll.dyeLot ?? null,
        receivedQty: remnant,
        balanceQty: remnant,
        rate: roll.rate,
        stage: 'RAW',
        location: LOCATION.REMNANT_STORE,
        remarks: `End-bits from ${issue.challanNo}, cut from roll ${roll.rollNo}`,
        createdById: actor.userId ?? null,
        updatedById: actor.userId ?? null,
      },
    });

    await postMovement(tx, {
      itemId: roll.inventoryItemId,
      rollId: remnantRoll.id,
      direction: 'IN',
      qty: remnant,
      rate: roll.rate ?? 0,
      carryCost: toRemnants,
      entryDate: issue.issueDate,
      location: LOCATION.REMNANT_STORE,
      documentType: 'CUTTING_ISSUE',
      documentId: issue.id,
      documentNo: issue.challanNo,
      orderId: issue.orderId,
      snapshot,
      remarks:
        `Remnants from ${issue.challanNo}: ${remnant.toFixed(4)} ${issue.fabricUom} of roll ` +
        `${roll.rollNo}, booked as ${remnantNo}`,
      actor,
    });
  }

  // ---- IN: the remainder, back on the rack, on the SAME roll -------------
  if (remainder.greaterThan(0)) {
    await postMovement(tx, {
      itemId: roll.inventoryItemId,
      // THE ROLL IDENTITY. Not a new roll and not an anonymous quantity: the
      // cloth going back is the cloth that came off this roll, and the ledger
      // says so, so it can still be traced to the GRN that received it.
      rollId: roll.id,
      direction: 'IN',
      qty: remainder,
      rate: roll.rate ?? 0,
      carryCost: backToStore,
      entryDate: issue.issueDate,
      location: DEFAULT_LOCATION,
      documentType: 'CUTTING_ISSUE',
      documentId: issue.id,
      documentNo: issue.challanNo,
      orderId: issue.orderId,
      snapshot,
      remarks:
        `Remainder returned to store on ${issue.challanNo}: ${remainder.toFixed(4)} ` +
        `${issue.fabricUom} of roll ${roll.rollNo}`,
      actor,
    });
  }

  // The roll follows its cloth: what is left on it, where it is, and whether
  // anything remains to cut.
  await tx.fabricRoll.update({
    where: { id: roll.id },
    data: {
      balanceQty: remainder,
      location: remainder.greaterThan(0) ? DEFAULT_LOCATION : roll.location,
      stage: remainder.greaterThan(0) ? 'RAW' : 'CONSUMED',
      updatedById: actor.userId ?? null,
    },
  });

  return {
    moved: leaving.greaterThan(0) || remainder.greaterThan(0),
    itemId: roll.inventoryItemId,
    remnantRollNo: remnantRoll?.rollNo ?? null,
  };
}

/** Cancels a draft. A posted challan cannot be cancelled - the cloth is cut. */
export async function cancel(id, { reason }, actor) {
  const ci = await prisma.cuttingIssue.findFirst({ where: { id, deletedAt: null } });
  if (!ci) throw ApiError.notFound('Cutting issue');
  assertUnlocked(ci, 'cancelled');

  await prisma.$transaction(async (tx) => {
    await engine.cancel(tx, {
      documentType: 'CUTTING_ISSUE',
      documentId: id,
      actor,
      reason,
    });
  });

  return getById(id);
}

/** Deletes a draft that was never posted. */
export async function remove(id, actorId) {
  const ci = await prisma.cuttingIssue.findFirst({ where: { id, deletedAt: null } });
  if (!ci) throw ApiError.notFound('Cutting issue');
  assertUnlocked(ci, 'deleted');

  await prisma.cuttingIssue.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId },
  });
  return { deleted: true };
}

/**
 * The immutability rule, stated once.
 *
 * There is no force flag and no admin override, deliberately. This is the last
 * document in the application; the thing it records has already happened to
 * physical cloth, and no later module exists to reverse it.
 */
function assertUnlocked(ci, what) {
  if (!ci.isLocked && !ci.postedAt) return;
  throw new ApiError(
    409,
    `${ci.challanNo} was posted on ` +
      `${new Date(ci.postedAt ?? ci.lockedAt).toISOString().slice(0, 10)} and cannot be ${what}. ` +
      'Cloth has been cut and issued to the unit. This is the last document in the pipeline - ' +
      'there is nothing downstream of it to correct it with, so it does not change.',
    {
      code: ERROR_CODES.DOCUMENT_LOCKED,
      details: { isLocked: true, postedAt: ci.postedAt },
    },
  );
}

// ---------------------------------------------------------------------------
//  Previews and printing
// ---------------------------------------------------------------------------

/**
 * Runs the nine checks against a challan that has not been saved yet.
 *
 * The screen calls this as the supervisor fills the form in, so every condition
 * is visible - and satisfiable - before anything is cut, rather than surfacing
 * as a refusal at the end.
 */
export async function preview(input) {
  const verification = await verify(input);
  const { order, planning, approval, fabricIssue, excess: assessment } = verification.resolved;

  return {
    verification: verification.checks,
    passed: verification.passed,
    failures: verification.failures,
    canPost: verification.passed,
    context: {
      orderNo: order?.orderNo ?? null,
      buyerName: order?.buyer?.buyerName ?? null,
      styleNo: order?.style?.styleNo ?? null,
      orderQty: order ? D(order.orderQty).toFixed(4) : null,
      effectiveQty: order ? D(order.effectiveQty).toFixed(4) : null,
      planNo: planning?.planNo ?? null,
      plannedCuttingPcs: planning ? D(planning.plannedQty).toFixed(4) : null,
      plannedFabricQty: planning ? D(planning.plannedFabricQty).toFixed(4) : null,
      containerNo: planning?.containerNo ?? null,
      approvalNo: approval?.approvalNo ?? null,
      approvalVersion: approval?.round ?? null,
      approvalStatus: approval?.approvalStatus ?? null,
      fabricIssueNo: fabricIssue?.issueNo ?? null,
      rollNo: fabricIssue?.roll?.rollNo ?? null,
    },
    /** The excess picture, with every figure the brief asks to be identified. */
    excess: assessment,
    nextChallanNo: await peekNumber('CUTTING_ISSUE'),
  };
}

/** The printable cutting challan - what travels to the stitching unit. */
export async function printView(id) {
  const ci = await prisma.cuttingIssue.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!ci) throw ApiError.notFound('Cutting issue');

  return {
    documentTitle: 'CUTTING ISSUE CHALLAN',
    challanNo: ci.challanNo,
    issueDate: ci.issueDate,
    status: ci.status,
    workflowState: ci.workflowState,
    posted: Boolean(ci.postedAt),
    postedAt: ci.postedAt,
    postedByName: ci.postedByName,
    printable: Boolean(ci.postedAt),
    printWarning: ci.postedAt
      ? null
      : 'This challan has not been posted. It is a draft, not an instruction to a unit.',
    unit: {
      firmName: ci.firmName,
      containerNo: ci.containerNo,
    },
    order: {
      orderNo: ci.order?.orderNo ?? null,
      buyerName: ci.order?.buyer?.buyerName ?? null,
      styleNo: ci.style?.styleNo ?? ci.order?.style?.styleNo ?? null,
      styleDescription: ci.style?.styleDescription ?? null,
      deliveryDate: ci.order?.buyerDeliveryDate ?? null,
    },
    line: {
      plannedCutting: D(ci.plannedCutting).toFixed(4),
      unitWiseCuttingPcsToBeIssued: D(ci.unitWiseCuttingPcsToBeIssued).toFixed(4),
      cuttingPcsIssued: D(ci.cuttingPcsIssued).toFixed(4),
      handleIssued: D(ci.handleIssued).toFixed(4),
      panelsIssued: ci.panelsIssued != null ? D(ci.panelsIssued).toFixed(4) : null,
      uom: 'Pcs',
    },
    /** Panel by panel, as frozen on the challan. Null for a style with no panel list. */
    panels: Array.isArray(ci.panelBreakdown) ? ci.panelBreakdown : null,
    spec: ci.style
      ? {
          size: [ci.style.bagLength, ci.style.bagWidth, ci.style.bagHeight]
            .filter((v) => v != null)
            .map((v) => D(v).toString())
            .join(' x ') || null,
          gusset: ci.style.gussetWidth != null ? D(ci.style.gussetWidth).toString() : null,
          handleDrop: ci.style.handleDrop != null ? D(ci.style.handleDrop).toString() : null,
          uom: ci.style.dimensionUom,
          closure: ci.style.closure,
          printPlacement: ci.style.printPlacement,
          artworkVersion: ci.style.artworkVersion,
        }
      : null,
    excess: ci.excessApproval
      ? {
          baseQty: D(ci.excessApproval.baseQty).toFixed(4),
          permittedPctDisplay: D(ci.excessApproval.permittedPct)
            .mul(100)
            .toDecimalPlaces(2)
            .toFixed(2),
          maxPermittedQty: D(ci.excessApproval.maxPermittedQty).toFixed(4),
          overLimitQty: D(ci.excessApproval.overLimitQty).toFixed(4),
          approvedByName: ci.excessApproval.approvedByName,
          approvedAt: ci.excessApproval.approvedAt,
          reason: ci.excessApproval.reason,
        }
      : null,
    references: {
      planNo: ci.planning?.planNo ?? null,
      approvalNo: ci.planApproval?.approvalNo ?? null,
      approvalVersion: ci.planApproval?.round ?? null,
      approvedByName: ci.planApproval?.approvedByName ?? null,
      fabricIssueNo: ci.fabricIssue?.issueNo ?? null,
      rollNo: ci.fabricIssue?.roll?.rollNo ?? null,
      chain: [
        ci.order?.orderNo,
        ci.planning?.planNo,
        ci.planApproval?.approvalNo,
        ci.fabricIssue?.issueNo,
        ci.challanNo,
      ]
        .filter(Boolean)
        .join(' → '),
    },
    remarks: ci.remarks,
    signatures: ['Cut By', 'Checked By', 'Received By (Unit)'],
    /** The pipeline ends here, and the printed challan says so. */
    footNote:
      'End of the Sekawati Impex ERP pipeline. Stitching, QC, packing and dispatch are ' +
      'outside this system.',
    printedAt: new Date().toISOString(),
  };
}

/** The nine checks, described, for the UI to render as a checklist. */
export function checklist() {
  return CHECKS.map(([code, label], i) => ({ step: i + 1, code, label }));
}
