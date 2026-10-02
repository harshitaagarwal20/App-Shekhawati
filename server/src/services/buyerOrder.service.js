/**
 * Buyer Order. Sheet: "Order" - Order Format (Role Acess - Merchandising Team).
 *
 * ---------------------------------------------------------------------------
 *  EVERY QUANTITY IS CALCULATED HERE.
 *
 *  The client sends only what a human types: order quantity, the requested
 *  excess percentage, and the selections. It never sends effectiveQty, a
 *  material requirement, or an approved excess - those are derived in this file
 *  and any such field arriving in a request body is dropped by the validator
 *  before it reaches this layer.
 * ---------------------------------------------------------------------------
 *
 * Excess workflow ("Approval from dinesh sir" on the Excess column):
 *
 *   excessPct          what the merchandiser asked for
 *   excessApprovedPct  what the Director granted - 0 until APPROVED
 *   effectiveQty       orderQty x (1 + excessApprovedPct)
 *
 * So an order with an unapproved 2% excess may still only produce its plain
 * order quantity. Nothing downstream can consume excess that was never granted.
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { OPTIONS_LIMIT, searchFilter } from '../utils/http.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber } from './documentNumber.service.js';
import * as engine from './approvalEngine.js';
// C9 - the one requirement multiplication, shared with Planning, the PO ceiling
// and the Cutting Challan.
import { computeRequirement } from '../domain/requirement.js';
import { assertNotSelfApproval } from '../domain/makerChecker.js';
import { marginsForOrder } from './costSheet.service.js';

export const SORTABLE = [
  'orderNo',
  'orderDate',
  'buyerDeliveryDate',
  'exFactoryDate',
  'containerNo',
  'orderValue',
  'orderQty',
  'status',
  'excessApprovalStatus',
  'createdAt',
];

const SEARCH = ['orderNo', 'buyerPoNo', 'itemDescription', 'colorCode', 'containerNo', 'remarks'];

const D = (v) => new Prisma.Decimal(v);
const ZERO = D(0);

const INCLUDE = {
  lines: {
    where: { deletedAt: null },
    orderBy: { lineNo: 'asc' },
    include: { style: { select: { id: true, styleNo: true, styleDescription: true } } },
  },
  buyer: {
    select: {
      id: true,
      buyerCode: true,
      buyerName: true,
      address: true,
      currency: true,
      shipMode: true,
      paymentTerms: true,
      consigneeName: true,
      consigneeAddress: true,
      destination: true,
      portOfDischarge: true,
      priceTerms: true,
      freightTerms: true,
    },
  },
  style: {
    select: {
      id: true,
      styleNo: true,
      styleDescription: true,
      category: true,
      fabricContent: true,
      sizeGroup: true,
      avgFabricUtilizationPerPc: true,
      avgUtilizationUom: true,
      buyerId: true,
    },
  },
};

const LIST_INCLUDE = {
  buyer: { select: { id: true, buyerCode: true, buyerName: true } },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  lines: {
    where: { deletedAt: null },
    orderBy: { lineNo: 'asc' },
    include: { style: { select: { id: true, styleNo: true, styleDescription: true } } },
  },
};


// ===========================================================================
//  CALCULATION - the single place order quantities are derived
// ===========================================================================

/**
 * The order quantity ceiling.
 *
 * Uses the APPROVED excess, never the requested one, so an order whose excess
 * is still pending behaves exactly like an order with no excess at all.
 */
export function calculateEffectiveQty(orderQty, excessApprovedPct) {
  return D(orderQty).mul(D(1).plus(D(excessApprovedPct ?? 0)));
}

// ===========================================================================
//  PRICE - the single place an order's value is derived
// ===========================================================================

const blank = (v) => v === undefined || v === null || v === '';

/**
 * A line's value: the ORDERED pieces x the unit price.
 *
 * Never the effective quantity. The excess is our cutting allowance, not
 * something the buyer is invoiced for, so the order book is valued at what
 * the buyer asked for. Null while the line is unpriced.
 */
export function calculateLineValue(orderQty, unitPrice) {
  if (blank(unitPrice)) return null;
  return D(orderQty).mul(D(unitPrice)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * The order's value, in its own currency and in rupees.
 *
 * ALL OR NOTHING. If any line is unpriced the total is null rather than the
 * sum of the priced ones: a partial figure would sit on the order book looking
 * exactly like the whole. An INR order is its own rupee value; a foreign one
 * needs a booked exchange rate, and nothing guesses one.
 */
export function calculateOrderValue(lines, { currency, exchangeRate } = {}) {
  if (!lines.length || lines.some((l) => blank(l.lineValue))) {
    return { orderValue: null, orderValueInr: null };
  }
  const orderValue = lines
    .reduce((a, l) => a.plus(D(l.lineValue)), ZERO)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const isInr = String(currency ?? '').trim().toUpperCase() === 'INR';
  const rate = isInr ? D(1) : blank(exchangeRate) ? null : D(exchangeRate);
  return {
    orderValue,
    orderValueInr: rate ? orderValue.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null,
  };
}

/**
 * An ex-factory date after the buyer's delivery date is a date nobody can
 * meet - the goods would leave the factory after they were due to arrive.
 */
export function assertDatesInOrder(exFactoryDate, buyerDeliveryDate) {
  if (blank(exFactoryDate) || blank(buyerDeliveryDate)) return;
  if (new Date(exFactoryDate) > new Date(buyerDeliveryDate)) {
    throw ApiError.badRequest(
      'The ex-factory date is after the buyer delivery date. Goods have to leave the factory ' +
        'before they are due at the buyer.',
      { field: 'exFactoryDate' },
    );
  }
}

/**
 * Re-derives every line value and the order totals from what is stored.
 *
 * Called after any write that can move a price, a quantity, the currency or
 * the rate, so the stored totals are always a function of the stored inputs.
 */
async function refreshOrderValue(orderId, actorId, client = prisma) {
  const order = await client.buyerOrder.findUnique({
    where: { id: orderId },
    select: { currency: true, exchangeRate: true },
  });
  const lines = await client.buyerOrderLine.findMany({
    where: { orderId, deletedAt: null },
    select: { id: true, orderQty: true, unitPrice: true, lineValue: true },
  });
  for (const l of lines) {
    const lineValue = calculateLineValue(l.orderQty, l.unitPrice);
    const same =
      (lineValue === null && l.lineValue === null) ||
      (lineValue !== null && l.lineValue !== null && D(l.lineValue).equals(lineValue));
    if (!same) {
      await client.buyerOrderLine.update({
        where: { id: l.id },
        data: { lineValue, updatedById: actorId ?? null },
      });
    }
    l.lineValue = lineValue;
  }
  const totals = calculateOrderValue(lines, order);
  await client.buyerOrder.update({ where: { id: orderId }, data: totals });
  return totals;
}

/**
 * THE TOLERANCE: an excess this small is policy, not a decision.
 *
 * ===========================================================================
 *  WHY A BAND EXISTS AT ALL
 * ===========================================================================
 *
 *  Every excess above zero used to go to the Director, so a routine 1% - the
 *  cutting allowance on almost every order this office takes - queued behind
 *  a signature exactly like a 15% one. The queue filled with decisions that
 *  had only one possible answer, and the orders that genuinely needed reading
 *  sat among them.
 *
 *  Up to and including 2% is now granted on entry. Above it, nothing changes:
 *  the excess is PENDING, the ceiling does not move, and the Director decides.
 *
 *  INCLUSIVE of 2.00% - "up to 2% is allowed" is how the office says it, and a
 *  band that refused exactly 2.00% would be the one number people test first.
 * ---------------------------------------------------------------------------
 */
export const AUTO_APPROVED_EXCESS_PCT = D('0.02');

/** How the automatic grant signs itself in the trail. */
const AUTO_APPROVAL_BY = 'Automatic (within tolerance)';

/** For messages: "2.00". */
const TOLERANCE_TEXT = AUTO_APPROVED_EXCESS_PCT.mul(100).toFixed(2);

/**
 * What happens to an excess the moment it is entered or changed.
 *
 * The single place the band is applied. create(), update() and amend() all
 * ask this rather than testing `greaterThan(0)` three times - which is how
 * the three paths came to disagree the first time.
 *
 * @returns {{status: string, approvedPct: object, automatic: boolean}}
 */
function excessOnEntry(excessPct) {
  if (!excessPct.greaterThan(0)) {
    return { status: 'NOT_REQUIRED', approvedPct: ZERO, automatic: false };
  }
  if (excessPct.lessThanOrEqualTo(AUTO_APPROVED_EXCESS_PCT)) {
    // Granted in full - the ceiling moves now, with no signature.
    return { status: 'APPROVED', approvedPct: excessPct, automatic: true };
  }
  return { status: 'PENDING', approvedPct: ZERO, automatic: false };
}

/**
 * Material requirement for an order, from the Style BOM
 * (Process Documentation s.5, "Order as per Style").
 *
 *   base       = avgUtilisationPerPiece x orderQty
 *   withWastage= base x (1 + wastagePct)
 *   withExcess = avgUtilisationPerPiece x effectiveQty x (1 + wastagePct)
 *
 * `withExcess` is what Procurement may order against this style. Because
 * effectiveQty already reflects only the approved excess, an unapproved excess
 * cannot inflate a purchase order.
 *
 * C9: the multiplication is `computeRequirement()` from domain/requirement.js -
 * the same function Planning, the PO ceiling and the Cutting Challan use - so
 * the figure a merchandiser sees on an order is the figure the ceiling will
 * later enforce. This function's job is the three VIEWS of it (base, with
 * wastage, with excess), not the arithmetic.
 */
export function calculateRequirement(style, orderQty, effectiveQty) {
  const qty = D(orderQty);
  const effective = D(effectiveQty);

  const lines = (style.bomLines ?? []).map((line) => {
    /**
     * C9 RENAME. `qtyPerPc` is read as a fallback, not as an equal:
     * `calculateRequirement()` is exported and is called by unit tests with
     * hand-built BOM fixtures that still use the old key. Reading only the new
     * name turned those into D(undefined) = 0 - a requirement of zero, silently,
     * which is the one outcome C9 forbids above all others.
     */
    const perPc = D(line.avgUtilisationPerPiece ?? line.qtyPerPc);
    const wastage = D(line.wastagePct ?? 0);

    const base = computeRequirement(perPc, qty);
    const withWastage = computeRequirement(perPc, qty, wastage);
    const withExcess = computeRequirement(perPc, effective, wastage);

    return {
      lineNo: line.lineNo,
      itemCategory: line.itemCategory,
      subCategory: line.subCategory,
      accessoriesItem: line.accessoriesItem,
      description: line.description,
      colorCode: line.colorCode,
      content: line.content,
      gsm: line.gsm,
      count: line.count,
      uom: line.uom,
      hsnCode: line.hsnCode,
      /** C9's name for it, and the deprecated alias, carrying one value. */
      avgUtilisationPerPiece: perPc.toFixed(4),
      qtyPerPc: perPc.toFixed(4),
      effectiveFrom: line.effectiveFrom ?? null,
      wastagePct: wastage.toFixed(6),
      baseRequirement: base.toFixed(4),
      withWastage: withWastage.toFixed(4),
      withExcess: withExcess.toFixed(4),
    };
  });

  // The header average is the authority for fabric (the Fabric BOM line mirrors
  // it), so it is reported separately for the merchandiser to sanity-check.
  const avg = D(style.avgFabricUtilizationPerPc);
  return {
    fabric: {
      avgUtilizationPerPc: avg.toFixed(4),
      uom: style.avgUtilizationUom,
      forOrderQty: avg.mul(qty).toFixed(4),
      forEffectiveQty: avg.mul(effective).toFixed(4),
    },
    lines,
  };
}

// ===========================================================================
//  VALIDATION HELPERS
// ===========================================================================

const LIST_FIELDS = [
  ['colorCode', 'ColorCode'],
  ['currency', 'Currency'],
  ['shipMode', 'ShipMode'],
  ['sizeGroup', 'SizeGroup'],
];

/*
 * CONTAINER NO IS NOT IN THAT LIST, AND MUST NOT BE.
 *
 * It is free text here exactly as it is on Planning and everything downstream
 * of it - a container number belongs to ONE shipment and is never used again,
 * so a master list of them could only grow into thousands of dead entries
 * with the one needed today missing. The full reasoning is in
 * planning.service.js, where the list check was removed.
 */

async function validateDropdowns(data) {
  for (const [field, listCode] of LIST_FIELDS) {
    if (data[field] === undefined) continue;
    await assertValueInList(listCode, data[field], { field });
  }
}

/** Loads the buyer and style, and refuses a style that belongs elsewhere. */
async function resolveBuyerAndStyle(buyerId, styleId) {
  const [buyer, style] = await Promise.all([
    prisma.buyer.findFirst({ where: { id: buyerId, deletedAt: null } }),
    prisma.style.findFirst({
      where: { id: styleId, deletedAt: null },
      include: { bomLines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
    }),
  ]);

  if (!buyer) throw ApiError.badRequest('Buyer does not exist', { field: 'buyerId' });
  if (buyer.status !== 'ACTIVE') {
    throw ApiError.badRequest(`Buyer "${buyer.buyerName}" is inactive`, { field: 'buyerId' });
  }
  if (!style) throw ApiError.badRequest('Style does not exist', { field: 'styleId' });
  if (style.status !== 'ACTIVE') {
    throw ApiError.badRequest(`Style ${style.styleNo} is inactive`, { field: 'styleId' });
  }
  if (style.buyerId !== buyer.id) {
    throw ApiError.badRequest(
      `Style ${style.styleNo} belongs to a different buyer. Pick a style of ${buyer.buyerName}.`,
      { field: 'styleId' },
    );
  }
  return { buyer, style };
}

/**
 * C13 - RESOLVES AND VALIDATES THE STYLES ON AN ORDER.
 *
 * Accepts either shape, so that every existing caller keeps working:
 *
 *   { lines: [{ styleId, orderQty, colorCode, sizeGroup }, ...] }   C13
 *   { styleId, orderQty, colorCode, sizeGroup }                     pre-C13
 *
 * The single-style form is normalised into a one-line order, which is exactly
 * what the migration did to every order that already existed. There is no
 * second code path: one line is not a special case, it is the ordinary case
 * with one row.
 */
async function resolveLines(input, buyer) {
  const raw = Array.isArray(input.lines) && input.lines.length
    ? input.lines
    : [{
        styleId: input.styleId,
        orderQty: input.orderQty,
        colorCode: input.colorCode ?? null,
        sizeGroup: input.sizeGroup ?? null,
        unitPrice: input.unitPrice ?? null,
      }];

  const resolved = [];
  const seen = new Set();

  for (const [i, line] of raw.entries()) {
    const field = `lines.${i}.styleId`;
    if (!line.styleId) throw ApiError.badRequest('Every order line needs a style', { field });

    const style = await prisma.style.findFirst({
      where: { id: line.styleId, deletedAt: null },
      include: { bomLines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
    });
    if (!style) throw ApiError.badRequest('Style does not exist', { field });
    if (style.status !== 'ACTIVE') {
      throw ApiError.badRequest(`Style ${style.styleNo} is inactive`, { field });
    }
    if (style.buyerId !== buyer.id) {
      throw ApiError.badRequest(
        `Style ${style.styleNo} belongs to a different buyer. Pick a style of ${buyer.buyerName}.`,
        { field },
      );
    }

    const qty = D(line.orderQty);
    if (qty.lessThanOrEqualTo(0)) {
      throw ApiError.badRequest(
        `Line ${i + 1} (${style.styleNo}) has no quantity. Ordering nothing of a style is not a line.`,
        { field: `lines.${i}.orderQty` },
      );
    }

    const colorCode = line.colorCode ?? null;
    const sizeGroup = line.sizeGroup ?? style.sizeGroup ?? null;

    /*
     * A LINE'S COLOUR AND SIZE ARE MASTER VALUES, THE SAME AS THE HEADER'S.
     *
     * `validateDropdowns()` checks the header's colour against the ColorCode
     * list, and has since Phase 3. The lines it never checked - so an order
     * whose header carried a real colour could carry lines in colours nobody
     * had ever defined, and "Chartreuse Sparkle" was accepted with a 201.
     *
     * That matters more now than it did. A line IS the thing that gets planned,
     * cut and bought against: the colour on it reaches the inventory item
     * identity, the fabric roll and the cutting challan, and a colour that is
     * not in the master list matches nothing downstream while looking perfectly
     * ordinary on the order.
     *
     * Checked per line rather than once, because two lines may legitimately
     * differ - the same style in Natural and in Night Black is exactly what
     * lines are for.
     */
    if (colorCode !== null) {
      await assertValueInList('ColorCode', colorCode, { field: `lines.${i}.colorCode` });
    }
    if (line.sizeGroup !== undefined && line.sizeGroup !== null) {
      await assertValueInList('SizeGroup', line.sizeGroup, { field: `lines.${i}.sizeGroup` });
    }

    // The same style in the same colour and size twice is one line entered
    // twice, and it would double that style's requirement. A unique index
    // refuses it too; this refuses it with a sentence somebody can act on.
    const identity = `${style.id}|${colorCode ?? ''}|${sizeGroup ?? ''}`;
    if (seen.has(identity)) {
      throw ApiError.badRequest(
        `Style ${style.styleNo} appears twice on this order in the same colour and size. ` +
          'Combine them into one line with the total quantity.',
        { field },
      );
    }
    seen.add(identity);

    const unitPrice = blank(line.unitPrice) ? null : D(line.unitPrice);
    if (unitPrice && unitPrice.isNegative()) {
      throw ApiError.badRequest(`Line ${i + 1} (${style.styleNo}) has a negative price.`, {
        field: `lines.${i}.unitPrice`,
      });
    }

    resolved.push({ lineNo: i + 1, style, colorCode, sizeGroup, orderQty: qty, unitPrice });
  }

  return resolved;
}

/**
 * The header figures, derived from the lines.
 *
 * The header quantity is a SUM and the header style is the LEAD - line 1's.
 * Neither is typed, because a header a user could set independently of the
 * lines would be a second answer to what the order contains.
 */
function headerFromLines(lines, approvedPct) {
  const orderQty = lines.reduce((a, l) => a.plus(l.orderQty), D(0));
  return {
    orderQty,
    effectiveQty: calculateEffectiveQty(orderQty, approvedPct),
    styleId: lines[0].style.id,
    colorCode: lines[0].colorCode,
    sizeGroup: lines[0].sizeGroup,
  };
}

/** The rows to write for a set of resolved lines, at a given approved excess. */
const lineRows = (lines, approvedPct, actorId) =>
  lines.map((l) => ({
    lineNo: l.lineNo,
    styleId: l.style.id,
    colorCode: l.colorCode,
    sizeGroup: l.sizeGroup,
    orderQty: l.orderQty,
    // The per-style ceiling. Always from the APPROVED excess, never the
    // requested one, so an excess awaiting a decision buys nothing.
    effectiveQty: calculateEffectiveQty(l.orderQty, approvedPct),
    unitPrice: l.unitPrice ?? null,
    lineValue: calculateLineValue(l.orderQty, l.unitPrice),
    createdById: actorId,
    updatedById: actorId,
  }));

/**
 * Counts the documents raised against an order. Once any exist, the fields that
 * those documents were built on cannot be edited - a purchase order raised for
 * 5000 pieces must not find its order silently changed to 3000.
 */
async function downstreamUsage(orderId) {
  const [plannings, quotations, purchaseOrders, fabricIssues, cuttingIssues] = await Promise.all([
    prisma.planning.count({ where: { orderId, deletedAt: null } }),
    prisma.vendorQuotation.count({ where: { orderId, deletedAt: null } }),
    prisma.purchaseOrder.count({ where: { orderId, deletedAt: null } }),
    prisma.fabricIssue.count({ where: { orderId, deletedAt: null } }),
    prisma.cuttingIssue.count({ where: { orderId, deletedAt: null } }),
  ]);
  const total = plannings + quotations + purchaseOrders + fabricIssues + cuttingIssues;
  return { plannings, quotations, purchaseOrders, fabricIssues, cuttingIssues, total };
}

/** Fields that downstream documents depend on. */
const STRUCTURAL_FIELDS = ['buyerId', 'styleId', 'orderQty', 'excessPct', 'colorCode', 'sizeGroup'];

// ===========================================================================
//  PROJECTION
// ===========================================================================

function project(order) {
  if (!order) return order;
  const excessApproved = order.excessApprovalStatus === 'APPROVED';
  return {
    ...order,
    /** Convenience flags so the client does not re-derive workflow rules. */
    excessRequested: !D(order.excessPct).isZero(),
    excessApproved,
    /** Extra pieces the approved excess allows, over and above orderQty. */
    excessQty: D(order.effectiveQty).minus(D(order.orderQty)).toFixed(4),
    /**
     * C13 - the styles this order is for. THE AUTHORITY on what it contains;
     * the header style is only the lead one.
     */
    lines: (order.lines ?? []).map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      styleId: l.styleId,
      style: l.style ?? null,
      colorCode: l.colorCode,
      sizeGroup: l.sizeGroup,
      orderQty: D(l.orderQty).toFixed(4),
      /** The per-style ceiling every requirement is computed against. */
      effectiveQty: D(l.effectiveQty).toFixed(4),
      excessQty: D(l.effectiveQty).minus(D(l.orderQty)).toFixed(4),
      unitPrice: l.unitPrice == null ? null : D(l.unitPrice).toFixed(4),
      lineValue: l.lineValue == null ? null : D(l.lineValue).toFixed(2),
      remarks: l.remarks ?? null,
    })),
    /** True while any line still has no price - the order value is then null. */
    pricePending: (order.lines ?? []).some((l) => l.unitPrice == null),
    styleCount: (order.lines ?? []).length,
  };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    status, buyerId, styleId, excessApprovalStatus, deliveryFrom, deliveryTo,
    orderFrom, orderTo, currency, containerNo,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(status ? { status } : {}),
    ...(buyerId ? { buyerId } : {}),
    ...(styleId ? { styleId } : {}),
    ...(currency ? { currency } : {}),
    ...(containerNo ? { containerNo } : {}),
    ...(excessApprovalStatus ? { excessApprovalStatus } : {}),
    ...(orderFrom || orderTo
      ? {
          orderDate: {
            ...(orderFrom ? { gte: new Date(orderFrom) } : {}),
            ...(orderTo ? { lte: new Date(orderTo) } : {}),
          },
        }
      : {}),
    ...(deliveryFrom || deliveryTo
      ? {
          buyerDeliveryDate: {
            ...(deliveryFrom ? { gte: new Date(deliveryFrom) } : {}),
            ...(deliveryTo ? { lte: new Date(deliveryTo) } : {}),
          },
        }
      : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total] = await Promise.all([
    prisma.buyerOrder.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.buyerOrder.count({ where }),
  ]);

  return { rows: rows.map(project), total, page, pageSize };
}

/**
 * Full order detail: header, the server-calculated requirement, what has been
 * procured against it so far, editability, and the approval trail.
 */
export async function getById(id) {
  const order = await prisma.buyerOrder.findFirst({
    where: { id, deletedAt: null },
    include: {
      ...INCLUDE,
      style: {
        include: { bomLines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
      },
    },
  });
  if (!order) throw ApiError.notFound('Order');

  const [usage, procurement, approvals, amendments] = await Promise.all([
    downstreamUsage(id),
    procurementSummary(id),
    prisma.approvalHistory.findMany({
      where: { documentType: 'BUYER_ORDER', documentId: id },
      orderBy: { actedAt: 'asc' },
    }),
    prisma.documentAmendment.findMany({
      where: { documentType: 'BUYER_ORDER', documentId: id },
      orderBy: { amendmentNo: 'asc' },
    }),
  ]);

  // The BOM feeds the requirement calculation below; the detail payload carries
  // the calculated result rather than the raw lines.
  const { bomLines: _bomLines, ...styleHeader } = order.style;

  /**
   * C13 - ONE REQUIREMENT PER ORDER LINE.
   *
   * Each style's consumption is multiplied by the pieces of THAT style. Before
   * C13 this passed the whole-order quantity against the header's single style,
   * which on a multi-style order over-bought that style and bought nothing for
   * the others.
   */
  const requirementByLine = await Promise.all(
    (order.lines ?? []).map(async (line) => {
      const style = await prisma.style.findFirst({
        where: { id: line.styleId, deletedAt: null },
        include: { bomLines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
      });
      return {
        lineNo: line.lineNo,
        lineId: line.id,
        styleNo: style?.styleNo ?? null,
        colorCode: line.colorCode,
        orderQty: D(line.orderQty).toFixed(4),
        effectiveQty: D(line.effectiveQty).toFixed(4),
        requirement: style
          ? calculateRequirement(style, line.orderQty, line.effectiveQty)
          : null,
      };
    }),
  );

  return {
    ...project({ ...order, style: styleHeader }),
    // F-10: read by withApprovability() in the controller, then removed.
    createdById: order.createdById,
    requirementByLine,
    /**
     * The lead line's requirement, kept under its old name so the existing
     * Order Detail panel and every consumer of this payload keep working. On a
     * single-style order it is the whole requirement; on a multi-style order it
     * is line 1's, and `requirementByLine` above carries them all.
     */
    requirement: requirementByLine[0]?.requirement
      ?? calculateRequirement(order.style, order.orderQty, order.effectiveQty),
    procurement,
    /** Each line's margin at its agreed price, against the style's approved cost sheet. */
    costing: await marginsForOrder(order),
    usage,
    editable: editability(order, usage),
    approvals,
    amendments,
  };
}

/** What has been bought and received against this order so far. */
async function procurementSummary(orderId) {
  const pos = await prisma.purchaseOrder.findMany({
    where: { orderId, deletedAt: null },
    select: {
      id: true,
      poId: true,
      item: true,
      subCategory: true,
      accessoriesItem: true,
      uom: true,
      orderQty: true,
      receivedQty: true,
      rate: true,
      amount: true,
      status: true,
      approvalStatus: true,
      vendor: { select: { id: true, vendorName: true } },
    },
    orderBy: { poDate: 'asc' },
  });

  const totalOrdered = pos.reduce((a, p) => a.plus(D(p.orderQty)), ZERO);
  const totalReceived = pos.reduce((a, p) => a.plus(D(p.receivedQty)), ZERO);
  const totalValue = pos.reduce((a, p) => a.plus(D(p.amount)), ZERO);

  return {
    purchaseOrders: pos,
    count: pos.length,
    totalOrderedQty: totalOrdered.toFixed(4),
    totalReceivedQty: totalReceived.toFixed(4),
    totalValue: totalValue.toFixed(2),
  };
}

/** Explains, in one place, whether and how an order may be changed. */
function editability(order, usage) {
  const structuralLocked = usage.total > 0;
  return {
    /** Descriptive fields (remarks, ship-to, delivery date) stay editable. */
    canEditDetails: order.status !== 'CANCELLED',
    /** Qty, style, buyer, colour, size group, excess. */
    canEditStructural: order.status !== 'CANCELLED' && !structuralLocked,
    /** An approved order changes only through the amendment path. */
    requiresAmendment: order.excessApprovalStatus === 'APPROVED' || structuralLocked,
    lockedBy: structuralLocked
      ? Object.entries(usage)
          .filter(([k, v]) => k !== 'total' && v > 0)
          .map(([k, v]) => `${v} ${k.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}`)
      : [],
  };
}

// ===========================================================================
//  COMMANDS
// ===========================================================================

/**
 * Creates an order.
 *
 * orderNo: the Order sheet notes "Buyer PO num is their order no", so a number
 * supplied by the merchandiser always wins. When none is given - the order was
 * taken before the buyer's paperwork arrived - one is drawn from the
 * BUYER_ORDER sequence.
 */
export async function create(input, actorId) {
  await validateDropdowns(input);

  // C13 - the lead style still goes through resolveBuyerAndStyle, because that
  // is what validates the BUYER. The per-line style checks are in resolveLines.
  const leadStyleId = input.lines?.[0]?.styleId ?? input.styleId;
  const { buyer, style } = await resolveBuyerAndStyle(input.buyerId, leadStyleId);
  const lines = await resolveLines(input, buyer);

  const orderNo = input.orderNo?.trim() || (await nextNumber('BUYER_ORDER'));
  const clash = await prisma.buyerOrder.findUnique({ where: { orderNo }, select: { id: true } });
  if (clash) throw ApiError.conflict('This order number already exists', { field: 'orderNo' });

  const excessPct = D(input.excessPct ?? 0);
  const excess = excessOnEntry(excessPct);

  // Only an excess that needs a DECISION needs a case made for it. Inside the
  // tolerance there is nobody to persuade.
  if (excess.status === 'PENDING' && !input.excessJustification) {
    throw ApiError.badRequest(
      `An excess above ${TOLERANCE_TEXT}% needs a justification - it goes to the Director for approval.`,
      { field: 'excessJustification' },
    );
  }

  // C13 - both header figures are derived from the lines. Within the tolerance
  // the excess is granted here, so the ceiling already reflects it; above it,
  // the approved excess is zero and effectiveQty is the plain sum.
  const header = headerFromLines(lines, excess.approvedPct);

  assertDatesInOrder(input.exFactoryDate, input.buyerDeliveryDate);
  const currency = input.currency ?? buyer.currency ?? null;
  const exchangeRate = blank(input.exchangeRate) ? null : D(input.exchangeRate);
  const totals = calculateOrderValue(
    lines.map((l) => ({ lineValue: calculateLineValue(l.orderQty, l.unitPrice) })),
    { currency, exchangeRate },
  );

  const order = await prisma.buyerOrder.create({
    data: {
      orderNo,
      orderDate: input.orderDate ? new Date(input.orderDate) : new Date(),
      itemDescription: input.itemDescription ?? style.styleDescription,
      buyerId: buyer.id,
      // Excel: "Bill To" is Auto - it defaults from the Buyer Master.
      billTo: input.billTo ?? [buyer.buyerName, buyer.address].filter(Boolean).join(', '),
      shipTo: input.shipTo ?? buyer.consigneeAddress ?? null,
      buyerDeliveryDate: input.buyerDeliveryDate ? new Date(input.buyerDeliveryDate) : null,
      // C13 - SUM of the lines, and the LEAD line's style / colour / size.
      orderQty: header.orderQty,
      styleId: header.styleId,
      colorCode: header.colorCode,
      sizeGroup: header.sizeGroup,
      // Currency and ship mode default from the buyer when not overridden.
      currency,
      shipMode: input.shipMode ?? buyer.shipMode ?? null,
      // The container the goods go out in. Nothing defaults it - unlike
      // currency and ship mode, a container is booked per shipment, so the
      // buyer master has nothing to supply.
      containerNo: input.containerNo ?? null,
      // Commercial terms. Price and payment terms default from the buyer's
      // standing terms, the same way currency and ship mode do.
      buyerPoNo: input.buyerPoNo ?? null,
      buyerPoDate: input.buyerPoDate ? new Date(input.buyerPoDate) : null,
      exFactoryDate: input.exFactoryDate ? new Date(input.exFactoryDate) : null,
      priceTerms: input.priceTerms ?? buyer.priceTerms ?? null,
      paymentTerms: input.paymentTerms ?? buyer.paymentTerms ?? null,
      exchangeRate,
      orderValue: totals.orderValue,
      orderValueInr: totals.orderValueInr,
      status: 'PENDING',
      remarks: input.remarks ?? null,
      excessPct,
      excessApprovalStatus: excess.status,
      excessApprovedPct: excess.approvedPct,
      excessApprovedAt: excess.automatic ? new Date() : null,
      excessApprovedByName: excess.automatic ? AUTO_APPROVAL_BY : null,
      excessJustification: input.excessJustification ?? null,
      effectiveQty: header.effectiveQty,
      lines: { create: lineRows(lines, excess.approvedPct, actorId) },
      createdById: actorId,
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  if (excess.status === 'PENDING') {
    await recordApproval(order, 'SUBMITTED', {
      toStatus: 'PENDING',
      actorId,
      remarks: `Excess of ${excessPct.mul(100).toFixed(2)}% requested: ${input.excessJustification}`,
    });
  } else if (excess.automatic) {
    // Recorded, not silent. The ceiling moved without a signature, so the
    // trail has to say why it moved and on whose authority.
    await recordApproval(order, 'APPROVED', {
      toStatus: 'APPROVED',
      actorId,
      actorName: AUTO_APPROVAL_BY,
      remarks:
        `Excess of ${excessPct.mul(100).toFixed(2)}% is within the ${TOLERANCE_TEXT}% ` +
        'tolerance and was approved automatically.',
    });
  }

  return project(order);
}

/**
 * Edits an order before approval.
 *
 * Descriptive fields stay open for as long as the order is alive. The
 * structural fields - buyer, style, quantity, colour, size group, excess -
 * close as soon as a downstream document exists, and an approved excess is
 * returned to PENDING whenever the quantity or excess moves.
 */
export async function update(id, input, actorId) {
  const existing = await prisma.buyerOrder.findFirst({
    where: { id, deletedAt: null },
    include: { style: { include: { bomLines: { where: { deletedAt: null } } } } },
  });
  if (!existing) throw ApiError.notFound('Order');
  if (existing.status === 'CANCELLED') {
    throw ApiError.badRequest('A cancelled order cannot be edited');
  }

  const usage = await downstreamUsage(id);

  /*
   * THE LINES, REPLACED AS A SET - the colourway grid's edit path.
   *
   * An order entered as a grid (one style, a row per colour, a column per
   * size) comes back as several lines, and editing the grid means the set of
   * lines changes shape: a colour dropped, a size added. That is only safe
   * while nothing has been planned, bought or cut against any of them - the
   * same point at which every other structural field closes - so it is
   * refused outright once a downstream document exists.
   *
   * The header is re-derived from the new set exactly as create() derives it,
   * by folding the lines' sum and lead line into `input` before the ordinary
   * update runs, so there is still one path that decides the excess.
   */
  let replacementLines = null;
  if (Array.isArray(input.lines) && input.lines.length) {
    if (usage.total > 0) {
      throw ApiError.conflict(
        `This order already has ${usage.total} downstream document(s). Its lines can no longer ` +
          'be changed here - raise an amendment instead.',
        { fields: ['lines'], usage },
      );
    }
    const { buyer: lineBuyer } = await resolveBuyerAndStyle(
      input.buyerId ?? existing.buyerId,
      input.lines[0].styleId,
    );
    replacementLines = await resolveLines(input, lineBuyer);
    const header = headerFromLines(replacementLines, D(0));
    input = {
      ...input,
      orderQty: header.orderQty.toString(),
      styleId: header.styleId,
      colorCode: header.colorCode,
      sizeGroup: header.sizeGroup,
      // Prices travel on the lines; the single-line header price does not apply.
      unitPrice: undefined,
    };
  }

  const touchedStructural = STRUCTURAL_FIELDS.filter(
    (f) => input[f] !== undefined && String(input[f]) !== String(existing[f]),
  );

  if (touchedStructural.length && usage.total > 0) {
    throw ApiError.conflict(
      `This order already has ${usage.total} downstream document(s). ${touchedStructural.join(', ')} can no longer be changed here - raise an amendment instead.`,
      { fields: touchedStructural, usage },
    );
  }

  await validateDropdowns(input);

  const buyerId = input.buyerId ?? existing.buyerId;
  const styleId = input.styleId ?? existing.styleId;

  // Re-check the pairing only when one of them actually moved. `buyer` is
  // non-null exactly in that case, which is also when Bill To must be redrawn.
  const buyer =
    buyerId !== existing.buyerId || styleId !== existing.styleId
      ? (await resolveBuyerAndStyle(buyerId, styleId)).buyer
      : null;

  const orderQty = input.orderQty !== undefined ? D(input.orderQty) : D(existing.orderQty);
  const excessPct = input.excessPct !== undefined ? D(input.excessPct) : D(existing.excessPct);

  // Any move in quantity or excess invalidates a decision already taken.
  const quantityMoved =
    !orderQty.equals(D(existing.orderQty)) || !excessPct.equals(D(existing.excessPct));

  let excessApprovalStatus = existing.excessApprovalStatus;
  let excessApprovedPct = D(existing.excessApprovedPct);
  let excessApprovedAt = existing.excessApprovedAt;
  let excessApprovedByName = existing.excessApprovedByName;
  let excessApprovedById = existing.excessApprovedById;
  let excessRejectionReason = existing.excessRejectionReason;

  if (quantityMoved) {
    // The figures move together or not at all - the same band that decides a
    // new order decides a changed one.
    const excess = excessOnEntry(excessPct);
    excessApprovalStatus = excess.status;
    excessApprovedPct = excess.approvedPct;
    excessApprovedAt = excess.automatic ? new Date() : null;
    excessApprovedByName = excess.automatic ? AUTO_APPROVAL_BY : null;
    excessApprovedById = null;
    excessRejectionReason = null;
  }

  if (excessPct.greaterThan(AUTO_APPROVED_EXCESS_PCT)) {
    const justification = input.excessJustification ?? existing.excessJustification;
    if (!justification) {
      throw ApiError.badRequest(
        `An excess above ${TOLERANCE_TEXT}% needs a justification - it goes to the Director for approval.`,
        { field: 'excessJustification' },
      );
    }
  }

  const effectiveQty = calculateEffectiveQty(orderQty, excessApprovedPct);

  assertDatesInOrder(
    input.exFactoryDate !== undefined ? input.exFactoryDate : existing.exFactoryDate,
    input.buyerDeliveryDate !== undefined ? input.buyerDeliveryDate : existing.buyerDeliveryDate,
  );

  const order = await prisma.buyerOrder.update({
    where: { id },
    data: {
      ...(input.orderNo !== undefined ? { orderNo: input.orderNo } : {}),
      ...(input.orderDate !== undefined ? { orderDate: new Date(input.orderDate) } : {}),
      ...(input.itemDescription !== undefined ? { itemDescription: input.itemDescription } : {}),
      ...(input.buyerId !== undefined ? { buyerId } : {}),
      ...(input.styleId !== undefined ? { styleId } : {}),
      ...(input.billTo !== undefined
        ? { billTo: input.billTo }
        : buyer
          ? { billTo: [buyer.buyerName, buyer.address].filter(Boolean).join(', ') }
          : {}),
      ...(input.shipTo !== undefined ? { shipTo: input.shipTo } : {}),
      ...(input.buyerDeliveryDate !== undefined
        ? { buyerDeliveryDate: input.buyerDeliveryDate ? new Date(input.buyerDeliveryDate) : null }
        : {}),
      ...(input.colorCode !== undefined ? { colorCode: input.colorCode } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.shipMode !== undefined ? { shipMode: input.shipMode } : {}),
      ...(input.sizeGroup !== undefined ? { sizeGroup: input.sizeGroup } : {}),
      ...(input.containerNo !== undefined ? { containerNo: input.containerNo } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      ...commercialPatch(input),
      ...(input.excessJustification !== undefined
        ? { excessJustification: input.excessJustification }
        : {}),
      orderQty,
      excessPct,
      excessApprovalStatus,
      excessApprovedPct,
      excessApprovedAt,
      excessApprovedByName,
      excessApprovedById,
      excessRejectionReason,
      effectiveQty,
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  /*
   * C13 - THE LINES' CEILINGS FOLLOW THE HEADER'S.
   *
   * `effectiveQty` is written on the order AND on every line, and the two are
   * the same rule applied to different quantities. approveExcess() and
   * rejectExcess() have always kept the lines in step; this path did not, so an
   * order whose excess moved here left its lines holding the OLD ceiling.
   *
   * That was invisible while nothing read the line ceiling. Planning is now
   * done per line and measured against `line.effectiveQty`, so a stale line
   * ceiling would let a plan be approved against an allowance the Director had
   * already withdrawn - which is precisely what the re-check at approval exists
   * to prevent.
   */
  if (replacementLines) {
    // Nothing references these rows yet - that was checked above - so they
    // are replaced outright rather than soft-deleted beside the new set, which
    // would leave two answers to "what styles is this order for".
    await prisma.$transaction([
      prisma.buyerOrderLine.deleteMany({ where: { orderId: id } }),
      prisma.buyerOrderLine.createMany({
        data: lineRows(replacementLines, excessApprovedPct, actorId).map((r) => ({ ...r, orderId: id })),
      }),
    ]);
  }

  await recomputeLineCeilings(id, excessApprovedPct, actorId);

  /*
   * The single-style form carries its price on the header. It can only mean
   * one line, so it is refused on an order holding several - those are priced
   * line by line through setPricing(), where each price names its line.
   */
  if (input.unitPrice !== undefined) {
    const lines = order.lines ?? [];
    if (lines.length !== 1) {
      throw ApiError.badRequest(
        'This order has several styles. Price each line from the order screen instead.',
        { field: 'unitPrice' },
      );
    }
    await prisma.buyerOrderLine.update({
      where: { id: lines[0].id },
      data: { unitPrice: blank(input.unitPrice) ? null : D(input.unitPrice), updatedById: actorId },
    });
  }
  await refreshOrderValue(id, actorId);

  if (quantityMoved && excessApprovalStatus === 'PENDING') {
    await recordApproval(order, 'SUBMITTED', {
      fromStatus: existing.excessApprovalStatus,
      toStatus: 'PENDING',
      actorId,
      remarks: 'Quantity or excess changed - excess resubmitted for approval',
    });
  }

  return project(await prisma.buyerOrder.findUnique({ where: { id }, include: LIST_INCLUDE }));
}

/** The commercial header fields an edit may carry, as a partial patch. */
function commercialPatch(input) {
  const date = (v) => (v ? new Date(v) : null);
  return {
    ...(input.buyerPoNo !== undefined ? { buyerPoNo: input.buyerPoNo || null } : {}),
    ...(input.buyerPoDate !== undefined ? { buyerPoDate: date(input.buyerPoDate) } : {}),
    ...(input.exFactoryDate !== undefined ? { exFactoryDate: date(input.exFactoryDate) } : {}),
    ...(input.priceTerms !== undefined ? { priceTerms: input.priceTerms || null } : {}),
    ...(input.paymentTerms !== undefined ? { paymentTerms: input.paymentTerms || null } : {}),
    ...(input.exchangeRate !== undefined
      ? { exchangeRate: blank(input.exchangeRate) ? null : D(input.exchangeRate) }
      : {}),
  };
}

/**
 * PRICES AN ORDER - its lines and its commercial terms.
 *
 * Separate from update() for one reason: a price is not structural. It does
 * not change what is cut or bought, so it stays open after purchase orders
 * and plans exist, when update() has long since closed the order's
 * structure. It is still a commercial fact somebody is answerable for, so
 * every change of price is written to the trail with the before and after.
 *
 * Closed only on a cancelled order, which has no value to state.
 */
export async function setPricing(id, input, actorId) {
  const existing = await prisma.buyerOrder.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
  });
  if (!existing) throw ApiError.notFound('Order');
  if (existing.status === 'CANCELLED') {
    throw ApiError.badRequest('A cancelled order cannot be priced');
  }

  assertDatesInOrder(
    input.exFactoryDate !== undefined ? input.exFactoryDate : existing.exFactoryDate,
    existing.buyerDeliveryDate,
  );
  await validateDropdowns(input);

  const byId = new Map(existing.lines.map((l) => [l.id, l]));
  const changes = [];
  for (const [i, entry] of (input.lines ?? []).entries()) {
    const line = byId.get(entry.id);
    if (!line) {
      throw ApiError.badRequest('That line is not on this order', { field: `lines.${i}.id` });
    }
    const before = line.unitPrice == null ? null : D(line.unitPrice);
    const after = blank(entry.unitPrice) ? null : D(entry.unitPrice);
    const same = (before === null && after === null) || (before && after && before.equals(after));
    if (!same) changes.push({ line, before, after });
  }

  await prisma.$transaction(async (tx) => {
    for (const { line, after } of changes) {
      await tx.buyerOrderLine.update({
        where: { id: line.id },
        data: { unitPrice: after, updatedById: actorId },
      });
    }
    await tx.buyerOrder.update({
      where: { id },
      data: {
        ...commercialPatch(input),
        ...(input.currency !== undefined ? { currency: input.currency || null } : {}),
        updatedById: actorId,
      },
    });
    await refreshOrderValue(id, actorId, tx);
  });

  if (changes.length) {
    await recordApproval(existing, 'AMENDED', {
      fromStatus: existing.excessApprovalStatus,
      toStatus: existing.excessApprovalStatus,
      actorId,
      remarks:
        'Prices changed: ' +
        changes
          .map(
            ({ line, before, after }) =>
              `line ${line.lineNo} ${before ? before.toFixed(4) : 'unpriced'} -> ` +
              `${after ? after.toFixed(4) : 'unpriced'}`,
          )
          .join('; '),
    });
  }

  return getById(id);
}

/**
 * Amends an order that is already locked by downstream documents.
 *
 * Unlike an edit, this always leaves a reasoned record in document_amendments
 * and returns any approved excess to the Director.
 */
export async function amend(id, input, actorId) {
  const existing = await prisma.buyerOrder.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw ApiError.notFound('Order');
  if (existing.status === 'CANCELLED') throw ApiError.badRequest('A cancelled order cannot be amended');

  await validateDropdowns(input);

  const orderQty = input.orderQty !== undefined ? D(input.orderQty) : D(existing.orderQty);
  const excessPct = input.excessPct !== undefined ? D(input.excessPct) : D(existing.excessPct);

  const changes = {};
  for (const field of [...STRUCTURAL_FIELDS, 'buyerDeliveryDate']) {
    if (input[field] === undefined) continue;
    const before = existing[field];
    const after = input[field];
    if (String(before) !== String(after)) changes[field] = { before: String(before ?? ''), after: String(after ?? '') };
  }

  if (Object.keys(changes).length === 0) {
    throw ApiError.badRequest('An amendment must change something');
  }

  const excess = excessOnEntry(excessPct);

  if (excess.status === 'PENDING' && !(input.excessJustification ?? existing.excessJustification)) {
    throw ApiError.badRequest(`An excess above ${TOLERANCE_TEXT}% needs a justification`, {
      field: 'excessJustification',
    });
  }

  const excessApprovalStatus = excess.status;
  const effectiveQty = calculateEffectiveQty(orderQty, excess.approvedPct);
  const amendmentNo = existing.amendmentCount + 1;

  const [order] = await prisma.$transaction([
    prisma.buyerOrder.update({
      where: { id },
      data: {
        ...(input.buyerId !== undefined ? { buyerId: input.buyerId } : {}),
        ...(input.styleId !== undefined ? { styleId: input.styleId } : {}),
        ...(input.colorCode !== undefined ? { colorCode: input.colorCode } : {}),
        ...(input.sizeGroup !== undefined ? { sizeGroup: input.sizeGroup } : {}),
        ...(input.buyerDeliveryDate !== undefined
          ? { buyerDeliveryDate: input.buyerDeliveryDate ? new Date(input.buyerDeliveryDate) : null }
          : {}),
        ...(input.excessJustification !== undefined
          ? { excessJustification: input.excessJustification }
          : {}),
        orderQty,
        excessPct,
        excessApprovalStatus,
        excessApprovedPct: excess.approvedPct,
        excessApprovedAt: excess.automatic ? new Date() : null,
        excessApprovedByName: excess.automatic ? AUTO_APPROVAL_BY : null,
        excessApprovedById: null,
        excessRejectionReason: null,
        effectiveQty,
        amendmentCount: amendmentNo,
        updatedById: actorId,
      },
      include: LIST_INCLUDE,
    }),
    prisma.documentAmendment.create({
      data: {
        documentType: 'BUYER_ORDER',
        documentId: id,
        documentNo: existing.orderNo,
        amendmentNo,
        reason: input.reason,
        changes,
        amendedById: actorId,
      },
    }),
  ]);

  // The lines' ceilings follow the header's - see the note in update(). An
  // amendment returns an above-tolerance excess to the Director (approvedPct
  // zero); one inside the tolerance is re-granted here, and the lines take
  // whichever it was rather than assuming zero.
  await recomputeLineCeilings(id, excess.approvedPct, actorId);

  await recordApproval(order, 'AMENDED', {
    fromStatus: existing.excessApprovalStatus,
    toStatus: excessApprovalStatus,
    actorId,
    remarks: `Amendment ${amendmentNo}: ${input.reason}`,
  });

  return project(order);
}

// ---------------------------------------------------------------------------
//  Excess approval - the Director's decision
// ---------------------------------------------------------------------------

/**
 * Approves the excess, optionally granting less than was asked for.
 * Recomputes effectiveQty from the granted percentage.
 */
export async function approveExcess(id, { approvedPct, remarks }, actor) {
  const order = await prisma.buyerOrder.findFirst({ where: { id, deletedAt: null } });
  if (!order) throw ApiError.notFound('Order');

  /*
   * MAKER-CHECKER. This service approves by writing its own columns and never
   * reaches approvalEngine.transition(), so the engine's registry-driven check
   * does not cover it. The call has to be here.
   */assertNotSelfApproval(order, actor, 'order');

  if (order.excessApprovalStatus !== 'PENDING') {
    throw ApiError.badRequest(
      order.excessApprovalStatus === 'NOT_REQUIRED'
        ? 'This order asks for no excess, so there is nothing to approve.'
        : `The excess on this order is already ${order.excessApprovalStatus.toLowerCase()}.`,
    );
  }

  const requested = D(order.excessPct);
  const granted = approvedPct !== undefined && approvedPct !== null ? D(approvedPct) : requested;

  if (granted.lessThan(0)) throw ApiError.badRequest('Approved excess cannot be negative');
  if (granted.greaterThan(requested)) {
    throw ApiError.badRequest(
      `Cannot approve ${granted.mul(100).toFixed(2)}% when ${requested.mul(100).toFixed(2)}% was requested.`,
      { field: 'approvedPct' },
    );
  }

  const updated = await prisma.buyerOrder.update({
    where: { id },
    data: {
      excessApprovalStatus: 'APPROVED',
      excessApprovedPct: granted,
      excessApprovedByName: actor.fullName,
      excessApprovedById: actor.userId,
      excessApprovedAt: new Date(),
      excessRejectionReason: null,
      // The whole point of the approval: the ceiling moves.
      effectiveQty: calculateEffectiveQty(order.orderQty, granted),
      updatedById: actor.userId,
    },
    include: LIST_INCLUDE,
  });

  // C13 - AND IT MOVES ON EVERY LINE. The per-style ceiling is what every
  // requirement is computed against, so an approval that raised only the header
  // would grant an excess the styles could not actually use.
  await recomputeLineCeilings(id, granted, actor.userId);

  await recordApproval(updated, 'APPROVED', {
    fromStatus: 'PENDING',
    toStatus: 'APPROVED',
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks:
      remarks ??
      (granted.equals(requested)
        ? `Excess of ${granted.mul(100).toFixed(2)}% approved as requested`
        : `Excess reduced from ${requested.mul(100).toFixed(2)}% to ${granted.mul(100).toFixed(2)}%`),
  });

  return project(updated);
}

/**
 * C13 - re-derives every line's ceiling from a newly decided excess.
 *
 * Row by row rather than one UPDATE with an expression, because
 * `calculateEffectiveQty()` is the single place this multiplication lives and
 * an inline `order_qty * (1 + pct)` in SQL would be a second copy of it - free
 * to drift from the one the rest of the system uses.
 */
async function recomputeLineCeilings(orderId, approvedPct, actorId) {
  const lines = await prisma.buyerOrderLine.findMany({
    where: { orderId, deletedAt: null },
    select: { id: true, orderQty: true },
  });

  await prisma.$transaction(
    lines.map((l) =>
      prisma.buyerOrderLine.update({
        where: { id: l.id },
        data: {
          effectiveQty: calculateEffectiveQty(l.orderQty, approvedPct),
          updatedById: actorId ?? null,
        },
      }),
    ),
  );
}

/** Rejects the excess. effectiveQty falls back to the plain order quantity. */
export async function rejectExcess(id, { reason }, actor) {
  const order = await prisma.buyerOrder.findFirst({ where: { id, deletedAt: null } });
  if (!order) throw ApiError.notFound('Order');
  if (order.excessApprovalStatus !== 'PENDING') {
    throw ApiError.badRequest('There is no pending excess request on this order.');
  }

  const updated = await prisma.buyerOrder.update({
    where: { id },
    data: {
      excessApprovalStatus: 'REJECTED',
      excessApprovedPct: 0,
      excessRejectionReason: reason,
      excessApprovedByName: actor.fullName,
      excessApprovedById: actor.userId,
      excessApprovedAt: null,
      effectiveQty: calculateEffectiveQty(order.orderQty, 0),
      updatedById: actor.userId,
    },
    include: LIST_INCLUDE,
  });

  // C13 - the lines fall back with the header.
  await recomputeLineCeilings(id, D(0), actor.userId);

  await recordApproval(updated, 'REJECTED', {
    fromStatus: 'PENDING',
    toStatus: 'REJECTED',
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks: reason,
  });

  return project(updated);
}

// ---------------------------------------------------------------------------
//  Status
// ---------------------------------------------------------------------------

/**
 * The Order sheet marks Status "Auto". Until the downstream stages exist to
 * drive it, it is set explicitly, with the transitions that make sense guarded:
 * nothing leaves CANCELLED, and nothing is cancelled once work has started.
 */
/**
 * The fulfilment status.
 *
 * This module used to keep its own copy of the transition table. It now uses
 * the central one in approvalEngine.js - a rule stated in two places is a
 * rule that will eventually be stated two different ways.
 */
export async function setStatus(id, status, actorId) {
  const order = await prisma.buyerOrder.findFirst({ where: { id, deletedAt: null } });
  if (!order) throw ApiError.notFound('Order');

  if (order.status === status) return project(order);
  engine.assertStatusTransition(order.status, status, { label: `Order ${order.orderNo}` });

  if (status === 'CANCELLED') {
    const usage = await downstreamUsage(id);
    if (usage.total > 0) {
      throw ApiError.conflict(
        `This order has ${usage.total} downstream document(s) and cannot be cancelled. Put it on hold instead.`,
        { usage },
      );
    }
  }

  const updated = await prisma.buyerOrder.update({
    where: { id },
    data: { status, updatedById: actorId },
    include: LIST_INCLUDE,
  });

  await recordApproval(updated, status === 'CANCELLED' ? 'CANCELLED' : 'SUBMITTED', {
    fromStatus: order.status,
    toStatus: status,
    actorId,
    remarks: `Status changed from ${order.status} to ${status}`,
  });

  return project(updated);
}

/** Soft delete. Refused once anything has been raised against the order. */
export async function remove(id, actorId) {
  const order = await prisma.buyerOrder.findFirst({ where: { id, deletedAt: null } });
  if (!order) throw ApiError.notFound('Order');

  const usage = await downstreamUsage(id);
  if (usage.total > 0) {
    throw ApiError.conflict(
      `This order has ${usage.total} downstream document(s) and cannot be deleted. Cancel or hold it instead.`,
      { usage },
    );
  }

  await prisma.buyerOrder.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId, status: 'CANCELLED' },
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

async function recordApproval(order, action, { fromStatus, toStatus, actorId, actorName, remarks }) {
  const previous = await prisma.approvalHistory.count({
    where: { documentType: 'BUYER_ORDER', documentId: order.id },
  });
  await prisma.approvalHistory.create({
    data: {
      documentType: 'BUYER_ORDER',
      documentId: order.id,
      documentNo: order.orderNo,
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

/** Order dropdown for the downstream modules. */
export async function options() {
  return prisma.buyerOrder.findMany({
    where: { deletedAt: null, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
    orderBy: { orderDate: 'desc' },
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      orderNo: true,
      orderQty: true,
      effectiveQty: true,
      colorCode: true,
      sizeGroup: true,
      status: true,
      buyerDeliveryDate: true,
      buyer: { select: { id: true, buyerName: true } },
      style: { select: { id: true, styleNo: true, styleDescription: true } },
    },
  });
}

/**
 * A requirement preview for a quantity and excess that have not been saved yet,
 * so the create form can show the merchandiser what an order will consume
 * BEFORE it exists - still calculated here, never in the browser.
 */
export async function previewRequirement({ styleId, orderQty, excessPct }) {
  const style = await prisma.style.findFirst({
    where: { id: styleId, deletedAt: null },
    include: { bomLines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
  });
  if (!style) throw ApiError.notFound('Style');

  const qty = D(orderQty);
  const requested = D(excessPct ?? 0);

  return {
    styleNo: style.styleNo,
    orderQty: qty.toFixed(4),
    excessPct: requested.toFixed(6),
    /** What the order can consume today - excess is not approved yet. */
    effectiveQty: calculateEffectiveQty(qty, 0).toFixed(4),
    /** What it would become if the Director grants the excess in full. */
    effectiveQtyIfExcessApproved: calculateEffectiveQty(qty, requested).toFixed(4),
    requirement: calculateRequirement(style, qty, calculateEffectiveQty(qty, requested)),
  };
}
