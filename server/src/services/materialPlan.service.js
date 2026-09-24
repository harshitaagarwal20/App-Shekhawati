/**
 * C12 - THE RAW MATERIAL PLAN.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THIS DOCUMENT IS
 *
 *  What fabric and accessories an order needs bought in from vendors, worked
 *  out from the Style BOM, prepared by planning and signed before procurement
 *  goes to the market.
 *
 *  The office plans its raw material the same way it plans cutting, stitching
 *  and shipping. The arithmetic for it has existed since C9 - the Buyer Order
 *  screen has shown a "Material requirement" panel all along - but a panel is
 *  not a document. It was recomputed on every read: nobody prepared it, nobody
 *  signed it, and there was no version of it to point back to once the BOM
 *  moved. This module is that panel turned into a document.
 *
 *  ---------------------------------------------------------------------------
 *  THIS FILE CONTAINS NO ARITHMETIC
 *
 *  Not one multiplication. `calculateRequirement()` in buyerOrder.service.js -
 *  which is itself a presentation of `domain/requirement.js`, the ONLY
 *  requirement calculation in this application - produces every figure a plan
 *  line carries. This module's job is to freeze what it returns and to run the
 *  approval flow over it.
 *
 *  That is deliberate and it is the point. Planning, the purchase order
 *  ceiling, the cutting challan and now this document must show the same
 *  requirement for the same style and order. They do, because they all call
 *  one function and none of them carries a formula.
 *
 *  ---------------------------------------------------------------------------
 *  THE LINES ARE FROZEN
 *
 *  A plan that recalculates itself is a report, not a plan. Wastage gets
 *  renegotiated, an accessory gets substituted, an average utilisation gets
 *  corrected - and a document somebody has signed must not change underneath
 *  the signature.
 *
 *  So `create()` explodes the BOM ONCE and stores the answer, together with
 *  `requirementBasis` spelling out the multiplication in words. Re-reading a
 *  plan re-reads rows; it never recomputes. `drift()` exists to REPORT that
 *  the BOM has moved since a plan was signed - it never silently corrects it,
 *  because a signed figure that quietly changes is the failure this document
 *  was built to prevent.
 *
 *  ---------------------------------------------------------------------------
 *  [A] ONLY - IT AUTHORISES, IT DOES NOT BUY
 *
 *  Approving a material plan moves no stock, raises no purchase order and
 *  reserves nothing, and NO PURCHASE ORDER IS GATED ON IT. Procurement stays
 *  bounded by the style requirement ceiling that has bounded it since C9.
 *
 *  That was the office's decision when this document was specified, and it is
 *  written here because the absence of a gate is easy to mistake for an
 *  oversight. If a gate is wanted later it belongs in
 *  purchaseOrder.service.js, checking a PO line against an approved plan line -
 *  which is part of why a plan freezes per-line quantities and not a total.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { nextNumber, peekNumber } from './documentNumber.service.js';
import * as engine from './approvalEngine.js';
import { calculateRequirement } from './buyerOrder.service.js';
import { categoryOfLine } from '../domain/itemCategory.js';
import { assertNotSelfApproval } from '../domain/makerChecker.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

export const SORTABLE = ['planNo', 'planDate', 'approvalStatus', 'version', 'createdAt'];
const SEARCH = ['planNo', 'containerNo', 'remarks'];

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
      buyer: { select: { id: true, buyerCode: true, buyerName: true } },
    },
  },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  lines: LINE_INCLUDE,
};

const LIST_INCLUDE = {
  order: { select: { id: true, orderNo: true } },
  style: { select: { id: true, styleNo: true } },
  lines: { where: { deletedAt: null }, select: { id: true, category: true, requiredQty: true } },
};

// ===========================================================================
//  PROJECTION
// ===========================================================================

function projectLine(line) {
  return {
    id: line.id,
    lineNo: line.lineNo,
    itemCategory: line.itemCategory,
    category: line.category,
    subCategory: line.subCategory,
    accessoriesItem: line.accessoriesItem,
    colorCode: line.colorCode,
    content: line.content,
    gsm: line.gsm,
    count: line.count,
    description: line.description,
    hsnCode: line.hsnCode,
    uom: line.uom,
    avgUtilisationPerPiece: D(line.avgUtilisationPerPiece).toFixed(4),
    wastagePct: D(line.wastagePct).toFixed(6),
    baseRequirement: D(line.baseRequirement).toFixed(4),
    requiredQty: D(line.requiredQty).toFixed(4),
    /** What wastage and the approved excess added to the base requirement. */
    allowanceQty: D(line.requiredQty).minus(D(line.baseRequirement)).toFixed(4),
    requirementBasis: line.requirementBasis,
    bomLineNo: line.bomLineNo,
    remarks: line.remarks,
  };
}

/**
 * Totals by commercial category.
 *
 * Fabric and accessories are measured in different units - metres against
 * pieces - so there is deliberately NO grand total across them. A single
 * number summing metres and pieces would be arithmetic that means nothing,
 * and a screen that prints one invites somebody to act on it.
 */
function totalsByCategory(lines = []) {
  const out = {};
  for (const line of lines) {
    const key = line.category;
    out[key] = (out[key] ?? ZERO).plus(D(line.requiredQty));
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.toFixed(4)]));
}

function project(plan) {
  const lines = (plan.lines ?? []).map(projectLine);
  return {
    id: plan.id,
    planNo: plan.planNo,
    planDate: plan.planDate,
    workflowState: plan.workflowState,
    stateLabel: engine.STATE_LABEL[plan.workflowState],
    approvalStatus: plan.approvalStatus,
    version: plan.version,
    order: plan.order ?? null,
    style: plan.style ?? null,
    containerNo: plan.containerNo,
    orderQty: D(plan.orderQty).toFixed(4),
    effectiveQty: D(plan.effectiveQty).toFixed(4),
    /** What the approved excess added to the ordered quantity, in pieces. */
    excessQty: D(plan.effectiveQty).minus(D(plan.orderQty)).toFixed(4),
    submittedTo: plan.submittedTo,
    submittedAt: plan.submittedAt,
    submittedByName: plan.submittedByName,
    approvedAt: plan.approvedAt,
    approvedByName: plan.approvedByName,
    decidedAt: plan.decidedAt,
    rejectionReason: plan.rejectionReason,
    remarks: plan.remarks,
    lines,
    lineCount: lines.length,
    totalsByCategory: totalsByCategory(plan.lines ?? []),
    /** Drives the buttons a screen offers, so it cannot offer a refused one. */
    allowedTransitions: engine.allowedFrom(plan.workflowState),
    editable: plan.workflowState === 'DRAFT' || plan.workflowState === 'REJECTED',
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    deletedAt: plan.deletedAt ?? null,
  };
}

// ===========================================================================
//  BUILDING THE LINES
// ===========================================================================

async function resolveOrder(orderId) {
  const order = await prisma.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: {
      style: {
        include: { bomLines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
      },
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: 'asc' },
        include: {
          style: {
            include: { bomLines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
          },
        },
      },
    },
  });
  if (!order) throw ApiError.badRequest('Order does not exist', { field: 'orderId' });
  return order;
}

/**
 * C13 - THE ORDER LINE A PLAN IS FOR.
 *
 * An order carries several styles, each with its own quantity, so "the material
 * plan for this order" is not one document - it is one per line. Naming the
 * line explicitly is what supplies the pieces the requirement is multiplied by.
 *
 * With no `orderLineId` and exactly one line on the order, that line is taken:
 * an unambiguous choice should not have to be typed. With several, the caller
 * has to say which, because guessing would silently plan one style and ignore
 * the rest - the exact failure C13 exists to end.
 */
function resolveOrderLine(order, orderLineId) {
  const lines = order.lines ?? [];

  if (!lines.length) {
    throw ApiError.badRequest(
      `Order ${order.orderNo} has no style lines, so there is nothing to plan against.`,
      { field: 'orderId' },
    );
  }

  if (orderLineId) {
    const line = lines.find((l) => l.id === orderLineId);
    if (!line) {
      throw ApiError.badRequest(
        `That line is not on order ${order.orderNo}.`,
        { field: 'orderLineId' },
      );
    }
    return line;
  }

  if (lines.length > 1) {
    throw ApiError.badRequest(
      `Order ${order.orderNo} carries ${lines.length} styles, so it needs one material plan per ` +
        'style. Choose which line to plan.',
      {
        field: 'orderLineId',
        choices: lines.map((l) => ({
          orderLineId: l.id,
          lineNo: l.lineNo,
          styleNo: l.style?.styleNo ?? null,
          colorCode: l.colorCode,
          orderQty: D(l.orderQty).toFixed(4),
        })),
      },
    );
  }

  return lines[0];
}

/**
 * Explodes a style's BOM into plan lines, through the shared calculation.
 *
 * A line the calculation cannot price is DROPPED, not defaulted to zero: a
 * requirement of zero for an accessory the order genuinely needs is the one
 * outcome worse than no line at all, because it reads as "buy nothing" rather
 * than as "nobody knows". `create()` reports what was dropped and why.
 */
function explode(style, orderLine) {
  // C13 - the LINE's quantities, not the order's. A style's consumption has to
  // be multiplied by the pieces of that style; before C13 this was handed the
  // whole-order quantity, which on a multi-style order over-bought the style it
  // named and bought nothing for the others.
  const requirement = calculateRequirement(style, orderLine.orderQty, orderLine.effectiveQty);

  const usable = [];
  const skipped = [];

  for (const line of requirement.lines) {
    const perPiece = D(line.avgUtilisationPerPiece);
    // base = perPiece x orderQty, required = perPiece x effectiveQty x (1 + wastage).
    // required >= base always holds, which is what the table's CHECK asserts:
    // effectiveQty >= orderQty and wastage >= 0, both guaranteed upstream.
    const base = D(line.baseRequirement);
    const required = D(line.withExcess);

    if (perPiece.lessThanOrEqualTo(0) || required.lessThanOrEqualTo(0)) {
      skipped.push({
        itemCategory: line.itemCategory,
        accessoriesItem: line.accessoriesItem ?? null,
        reason:
          `BOM line ${line.lineNo} carries no usable quantity per piece, so nothing can be ` +
          'required of it. Set the utilisation on the Style Master.',
      });
      continue;
    }

    usable.push({
      itemCategory: line.itemCategory,
      category: categoryOfLine(line, { field: 'itemCategory' }),
      subCategory: line.subCategory ?? null,
      accessoriesItem: line.accessoriesItem ?? null,
      colorCode: line.colorCode ?? null,
      content: line.content ?? null,
      gsm: line.gsm ?? null,
      count: line.count ?? null,
      description: line.description ?? null,
      hsnCode: line.hsnCode ?? null,
      uom: line.uom,
      avgUtilisationPerPiece: perPiece,
      wastagePct: D(line.wastagePct),
      baseRequirement: base,
      requiredQty: required,
      requirementBasis:
        `${perPiece.toFixed(4)} ${line.uom}/pc x ${D(orderLine.effectiveQty).toFixed(4)} pcs` +
        (D(line.wastagePct).isZero()
          ? ''
          : ` x ${D(1).plus(D(line.wastagePct)).toFixed(6)} ` +
            `(${D(line.wastagePct).mul(100).toDecimalPlaces(2)}% wastage)`) +
        ` = ${required.toFixed(4)} ${line.uom}`,
      bomLineNo: line.lineNo ?? null,
    });
  }

  return { usable, skipped, fabric: requirement.fabric };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    approvalStatus, workflowState, orderId, styleId, containerNo,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(approvalStatus ? { approvalStatus } : {}),
    ...(workflowState ? { workflowState } : {}),
    ...(orderId ? { orderId } : {}),
    ...(styleId ? { styleId } : {}),
    ...(containerNo ? { containerNo } : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total] = await Promise.all([
    prisma.materialPlan.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.materialPlan.count({ where }),
  ]);

  return { rows: rows.map(project), total, page, pageSize };
}

export async function getById(id) {
  const plan = await prisma.materialPlan.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!plan) throw ApiError.notFound('Material plan');

  const [status, stageEvents] = await Promise.all([
    engine.statusOf('MATERIAL_PLAN', id),
    engine.stageEvents('MATERIAL_PLAN', id),
  ]);

  return { ...project(plan), createdById: plan.createdById, approval: status, stageEvents };
}

/**
 * What a plan for this order would contain, without saving it.
 *
 * The exact code path `create()` takes, so the figures a planner reviews are
 * the figures that will be stored - not a second rendering of them.
 */
export async function preview({ orderId, orderLineId } = {}) {
  const order = await resolveOrder(orderId);
  const orderLine = resolveOrderLine(order, orderLineId);
  const style = orderLine.style;

  if (!style) {
    throw ApiError.badRequest(
      `Line ${orderLine.lineNo} of order ${order.orderNo} has no style, so nothing describes ` +
        'what one piece consumes.',
      { field: 'orderLineId' },
    );
  }

  const { usable, skipped, fabric } = explode(style, orderLine);

  return {
    nextPlanNo: await peekNumber('MATERIAL_PLAN'),
    order: {
      id: order.id,
      orderNo: order.orderNo,
      /** The whole order, for context - the plan is for the line below. */
      orderQty: D(order.orderQty).toFixed(4),
      styleCount: (order.lines ?? []).length,
    },
    /** C13 - the line this plan is for, and the pieces it is worked out on. */
    orderLine: {
      id: orderLine.id,
      lineNo: orderLine.lineNo,
      colorCode: orderLine.colorCode,
      sizeGroup: orderLine.sizeGroup,
      orderQty: D(orderLine.orderQty).toFixed(4),
      effectiveQty: D(orderLine.effectiveQty).toFixed(4),
      excessQty: D(orderLine.effectiveQty).minus(D(orderLine.orderQty)).toFixed(4),
    },
    style: { id: style.id, styleNo: style.styleNo, styleDescription: style.styleDescription },
    fabric,
    lines: usable.map((l, i) => ({
      ...projectLine({ ...l, lineNo: i + 1 }),
      id: null,
    })),
    skipped,
    totalsByCategory: totalsByCategory(usable),
  };
}

/**
 * C13 - the lines of an order that can still be planned, for a picker.
 *
 * One plan per line, so a line whose plan is already live is not offered
 * again - the screen must not present a choice the save would refuse.
 */
export async function plannableLines(orderId) {
  const order = await resolveOrder(orderId);

  const existing = await prisma.materialPlan.findMany({
    where: { orderId, deletedAt: null },
    select: { orderLineId: true, planNo: true, workflowState: true },
  });
  const live = new Map(
    existing
      .filter((p) => !['REJECTED', 'CANCELLED'].includes(p.workflowState))
      .map((p) => [p.orderLineId, p]),
  );

  return {
    orderNo: order.orderNo,
    lines: (order.lines ?? []).map((l) => {
      const held = live.get(l.id);
      return {
        orderLineId: l.id,
        lineNo: l.lineNo,
        styleNo: l.style?.styleNo ?? null,
        styleDescription: l.style?.styleDescription ?? null,
        colorCode: l.colorCode,
        sizeGroup: l.sizeGroup,
        orderQty: D(l.orderQty).toFixed(4),
        effectiveQty: D(l.effectiveQty).toFixed(4),
        plannable: !held,
        heldBy: held ? { planNo: held.planNo, workflowState: held.workflowState } : null,
      };
    }),
  };
}

/**
 * C12 - HAS THE BOM MOVED SINCE THIS PLAN WAS SIGNED?
 *
 * Reports, never corrects. A signed figure that quietly updates itself is
 * exactly what the frozen lines exist to prevent, so this returns the
 * difference and leaves the decision to a person: an approved plan whose BOM
 * has changed is rectified into a new version, not edited.
 */
export async function drift(id) {
  const plan = await prisma.materialPlan.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!plan) throw ApiError.notFound('Material plan');

  const order = await resolveOrder(plan.orderId);
  // C13 - re-explode the SAME line the plan was raised against. Comparing it
  // against a different line's quantities would report drift that is really
  // just a different style.
  const orderLine = resolveOrderLine(order, plan.orderLineId ?? undefined);
  const { usable } = explode(orderLine.style ?? order.style, orderLine);

  const keyOf = (l) => `${l.itemCategory}|${l.accessoriesItem ?? ''}|${l.subCategory ?? ''}`;
  const now = new Map(usable.map((l) => [keyOf(l), l]));

  const changes = [];
  for (const line of plan.lines) {
    const current = now.get(keyOf(line));
    if (!current) {
      changes.push({
        lineNo: line.lineNo,
        item: line.description ?? line.itemCategory,
        kind: 'REMOVED',
        was: D(line.requiredQty).toFixed(4),
        now: null,
        note: 'The style BOM no longer carries this material.',
      });
      continue;
    }
    now.delete(keyOf(line));
    if (!current.requiredQty.equals(D(line.requiredQty))) {
      changes.push({
        lineNo: line.lineNo,
        item: line.description ?? line.itemCategory,
        kind: 'CHANGED',
        was: D(line.requiredQty).toFixed(4),
        now: current.requiredQty.toFixed(4),
        uom: line.uom,
        note: current.requirementBasis,
      });
    }
  }
  for (const [, added] of now) {
    changes.push({
      lineNo: null,
      item: added.description ?? added.itemCategory,
      kind: 'ADDED',
      was: null,
      now: added.requiredQty.toFixed(4),
      uom: added.uom,
      note: 'The style BOM has gained this material since the plan was raised.',
    });
  }

  return {
    planNo: plan.planNo,
    workflowState: plan.workflowState,
    inStep: changes.length === 0,
    changes,
    advice:
      changes.length === 0
        ? 'The plan matches the style BOM as it stands today.'
        : 'The style BOM has moved since this plan was raised. The plan is deliberately NOT ' +
          'updated - reject it and raise the next version if the new figures are the ones to buy against.',
  };
}

// ===========================================================================
//  WRITES
// ===========================================================================

/**
 * Raises a material plan, in DRAFT, from the style BOM.
 *
 * The plan number and the rows are taken together inside one transaction, so
 * a rolled-back plan never burns a number out of the series.
 */
export async function create(input, actor = {}) {
  const order = await resolveOrder(input.orderId);
  const orderLine = resolveOrderLine(order, input.orderLineId);
  const style = orderLine.style;

  if (!style) {
    throw ApiError.badRequest(
      `Line ${orderLine.lineNo} of order ${order.orderNo} has no style, so nothing describes ` +
        'what one piece consumes.',
      { field: 'orderLineId' },
    );
  }

  const { usable, skipped } = explode(style, orderLine);

  if (!usable.length) {
    throw ApiError.badRequest(
      `Style ${style.styleNo} has no BOM line that can be priced, so there is nothing to plan. ` +
        'Add the materials and their utilisation per piece to the Style Master first.',
      { field: 'orderId', skipped },
    );
  }

  const planDate = input.planDate ? new Date(input.planDate) : new Date();

  // C13 - the next version for this ORDER LINE. Keyed on the line rather than
  // the style, because one order may carry the same style twice in different
  // colours and each of those is its own requirement.
  const previous = await prisma.materialPlan.findFirst({
    where: { orderLineId: orderLine.id },
    orderBy: { version: 'desc' },
    select: { version: true, workflowState: true, planNo: true },
  });

  if (previous && !['REJECTED', 'CANCELLED'].includes(previous.workflowState)) {
    throw ApiError.conflict(
      `${previous.planNo} is already the live material plan for ${style.styleNo} on this order, ` +
        `and it is ${engine.STATE_LABEL[previous.workflowState].toLowerCase()}. A second plan for ` +
        'the same line is not a richer plan - reject the current one first if it needs replacing.',
      { field: 'orderLineId', version: previous.version },
    );
  }

  const version = (previous?.version ?? 0) + 1;

  const plan = await prisma.$transaction(async (tx) => {
    const planNo = await nextNumber('MATERIAL_PLAN', { tx });

    return tx.materialPlan.create({
      data: {
        planNo,
        planDate,
        orderId: order.id,
        styleId: style.id,
        orderLineId: orderLine.id,
        containerNo: input.containerNo ?? null,
        // Frozen: what the plan was worked out against - THE LINE's pieces,
        // not the order's, so a multi-style order plans each style correctly.
        orderQty: D(orderLine.orderQty),
        effectiveQty: D(orderLine.effectiveQty),
        version,
        remarks: input.remarks ?? null,
        createdById: actor.userId ?? null,
        updatedById: actor.userId ?? null,
        lines: {
          create: usable.map((line, i) => ({
            lineNo: i + 1,
            ...line,
            createdById: actor.userId ?? null,
            updatedById: actor.userId ?? null,
          })),
        },
      },
      include: INCLUDE,
    });
  });

  await engine.record(null, {
    documentType: 'MATERIAL_PLAN',
    documentId: plan.id,
    documentNo: plan.planNo,
    action: 'SUBMITTED',
    toStatus: 'DRAFT',
    actor,
    remarks:
      `Raw material plan v${version} raised for order ${order.orderNo} line ${orderLine.lineNo} ` +
      `/ style ${style.styleNo}: ${plan.lines.length} material(s) against ` +
      `${D(orderLine.effectiveQty).toFixed(0)} pcs.` +
      (skipped.length ? ` ${skipped.length} BOM line(s) could not be priced and were left off.` : ''),
  });

  return { ...project(plan), skipped };
}

/**
 * Edits the header while the plan is still a draft.
 *
 * THE LINES ARE NOT EDITABLE, and that is the design rather than an omission.
 * They are the BOM's answer, frozen. A planner who disagrees with a figure is
 * disagreeing with the Style Master, and the fix belongs there - where it will
 * also correct the PO ceiling, the cutting challan and the order screen, all
 * of which read the same calculation. Correcting it here would create a plan
 * that no other document in the system agrees with.
 */
export async function update(id, input, actor = {}) {
  const existing = await prisma.materialPlan.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, planNo: true, workflowState: true },
  });
  if (!existing) throw ApiError.notFound('Material plan');

  if (!['DRAFT', 'REJECTED'].includes(existing.workflowState)) {
    throw ApiError.conflict(
      `${existing.planNo} is ${engine.STATE_LABEL[existing.workflowState].toLowerCase()} and can ` +
        'no longer be edited.',
      { workflowState: existing.workflowState },
    );
  }

  await prisma.materialPlan.update({
    where: { id },
    data: {
      ...(input.containerNo !== undefined ? { containerNo: input.containerNo } : {}),
      ...(input.planDate !== undefined ? { planDate: new Date(input.planDate) } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      updatedById: actor.userId ?? null,
    },
  });

  return getById(id);
}

/** Hands the plan in for approval. */
export async function submit(id, { submittedTo, remarks } = {}, actor = {}) {
  await engine.submit(null, {
    documentType: 'MATERIAL_PLAN',
    documentId: id,
    submittedTo,
    actor,
    remarks,
    data: {
      submittedTo: submittedTo ?? null,
      submittedAt: new Date(),
      submittedById: actor.userId ?? null,
      submittedByName: actor.fullName ?? null,
    },
  });
  return getById(id);
}

/**
 * Approves a plan.
 *
 * MAKER-CHECKER. The person who prepared the requirement may not be the person
 * who signs it. That separation is the whole reason this is a document rather
 * than a panel, so it is enforced regardless of role.
 */
export async function approve(id, { remarks } = {}, actor = {}) {
  const existing = await prisma.materialPlan.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, planNo: true, createdById: true },
  });
  if (!existing) throw ApiError.notFound('Material plan');

  assertNotSelfApproval(existing, actor, 'material plan');

  await engine.approve(null, {
    documentType: 'MATERIAL_PLAN',
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
    documentType: 'MATERIAL_PLAN',
    documentId: id,
    actor,
    reason,
    data: { decidedAt: new Date(), rejectionReason: reason },
  });
  return getById(id);
}

/** Cancels a plan nobody has signed. */
export async function cancel(id, { reason } = {}, actor = {}) {
  await engine.cancel(null, {
    documentType: 'MATERIAL_PLAN',
    documentId: id,
    actor,
    reason,
  });
  return getById(id);
}

/** Soft-deletes a draft. */
export async function remove(id, actorId) {
  const existing = await prisma.materialPlan.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, planNo: true, workflowState: true },
  });
  if (!existing) throw ApiError.notFound('Material plan');

  if (existing.workflowState !== 'DRAFT') {
    throw ApiError.conflict(
      `${existing.planNo} is ${engine.STATE_LABEL[existing.workflowState].toLowerCase()} and ` +
        'cannot be deleted. Cancel it instead, which leaves the record.',
      { workflowState: existing.workflowState },
    );
  }

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.materialPlanLine.updateMany({
      where: { planId: id, deletedAt: null },
      data: { deletedAt: now, deletedById: actorId ?? null },
    });
    await tx.materialPlan.update({
      where: { id },
      data: { deletedAt: now, deletedById: actorId ?? null },
    });
  });

  return { id, planNo: existing.planNo, deleted: true };
}
