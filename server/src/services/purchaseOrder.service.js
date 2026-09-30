/**
 * Purchase Order. Sheet: "PO" - PO Format
 * (Role Acess - Procurement Dept (Manager); approved by Dinesh Sir).
 *
 * ---------------------------------------------------------------------------
 *  THE PO IS THE LAST LINK IN A CHAIN, NOT A FREE-STANDING DOCUMENT
 *
 *      Buyer Order  ->  Vendor Quotation  ->  Purchase Order
 *
 *  Everything downstream - gate pass, GRN, roll, stock - hangs off the PO, so
 *  the PO has to be able to say where its authority came from. `traceability()`
 *  walks that chain in one query and is returned with every detail read; the
 *  screens render it rather than reconstructing it.
 * ---------------------------------------------------------------------------
 *
 *  AMOUNT IS A SERVER FORMULA
 *
 *      amount = orderQty x rate
 *
 *  `amount` appears in no input schema - Zod strips it - is recomputed on every
 *  write, and a CHECK constraint refuses any row where it disagrees with the
 *  two numbers behind it. Same rule, same reasons, as the quotation amount.
 *
 *  TWO CEILINGS ON THE QUANTITY  (Process Documentation s.5)
 *
 *   1. Excess Allowed. The sheet notes "2-3%" against the column, and the
 *      process document adds that accessories may be ordered only 1% over
 *      requirement. Both caps are enforced here, by item category.
 *
 *   2. Order mode (C1). AS_PER_STYLE means the quantity is bounded by what the
 *      style consumes: style requirement x order quantity, plus the excess
 *      allowed, less whatever other purchase orders have already claimed
 *      against the same order and item. BULK is deliberately exempt -
 *      that is what choosing it means - but it is recorded as a decision rather
 *      than left as an absence of one.
 *
 * ---------------------------------------------------------------------------
 *  C1: THE CEILING IS DECIDED ONCE, BY ONE FUNCTION
 *
 *  `checkOrderCeiling()` is pure: it takes a line, a mode, a category and the
 *  tolerance map, and returns a verdict. It touches no database.
 *
 *  Everything that needs the verdict calls it:
 *
 *      preview()  ->  quantityCeiling()  ->  checkOrderCeiling()
 *      create()   ->  quantityCeiling()  ->  checkOrderCeiling()
 *      update()   ->  quantityCeiling()  ->  checkOrderCeiling()
 *
 *  and create()/update() call it AGAIN inside the transaction, against rows
 *  the transaction has read, immediately before the row is written. The gap
 *  between "the form said it was fine" and "the row was committed" is where a
 *  second PO for the same fabric slips through, so the last word belongs to
 *  the transaction and not to the preview.
 *
 *  The requirement the verdict was reached against is then PERSISTED on the
 *  row (`computedRequirementQty`). It is never recomputed on read: a BOM is
 *  allowed to change, and a ceiling that has already been applied to a signed
 *  document is not.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { OPTIONS_LIMIT, searchFilter } from '../utils/http.js';
import * as masterLists from './masterList.service.js';
import { assertAccessoryVariety, assertValueInList } from './masterList.service.js';
import { nextNumber, peekNumber } from './documentNumber.service.js';
import * as engine from './approvalEngine.js';
import { env } from '../config/env.js';
import { documentStatus, duplicateMaterial, lineNumber } from '../domain/documentLines.js';
// C2 / C9 - the category, the tolerance master, and the one requirement formula.
import { categoryOfLine, isStationery, STATIONERY_ITEM, subCategoryListFor } from '../domain/itemCategory.js';
import { assertRequirement, requirementFor } from '../domain/requirement.js';
// Named `toleranceMaster`, not `tolerance`: `checkOrderCeiling()` already has a
// local `tolerance` holding the resolved fraction, and a module alias that
// shadowed it would be a trap for the next reader.
import * as toleranceMaster from './tolerance.service.js';

export const SORTABLE = [
  'poId',
  'poDate',
  'item',
  'orderQty',
  'rate',
  'amount',
  'receivedQty',
  // C2 - a buyer sorting by what is actually payable is the whole point of
  // separating it from what was ordered.
  'payableQty',
  'category',
  'status',
  'approvalStatus',
  'createdAt',
];

const SEARCH = ['poId', 'item', 'subCategory', 'accessoriesItem', 'accessoryType', 'size', 'hsnCode', 'remarks', 'address'];

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

/**
 * Excess ceilings, as fractions.
 *
 * The PO sheet writes "2-3%" beside the Excess Allowed column, and the process
 * document is stricter about accessories: "accessories may be ordered only 1%
 * over requirement". Held here as data so the rule is legible and lives in one
 * place; the same two numbers are quoted back to the client on refusal.
 */
/**
 * C2 SUPERSEDED THIS. It is kept for two reasons and neither is convenience.
 *
 * First, it is the LAST-RESORT shape `checkOrderCeiling()` falls back to when
 * a caller hands it no resolved tolerance - a pure function cannot go to the
 * database, and refusing to compute at all would leave the unit tests unable
 * to drive it. Second, the two numbers are what every purchase order raised
 * before C2 was actually judged by, and the migration wrote them onto those
 * rows citing this constant by name; deleting it would orphan that citation.
 *
 * NOTHING ON THE LIVE PATH READS IT ANY MORE. create() and update() resolve
 * the tolerance out of `tolerance_rules` (falling back to the approved
 * `excess_rules`) and persist the answer on the row, and the GRN reads the
 * persisted figure rather than re-resolving. See tolerance.service.js.
 */
export const EXCESS_CEILING = {
  ACCESSORIES: '0.01',
  GENERAL: '0.03',
};

/** True when the line is an accessory, and so takes the stricter 1% ceiling. */
export function isAccessoryLine({ item, accessoriesItem }) {
  return item === 'Accessories' || Boolean(accessoriesItem);
}

const INCLUDE = {
  header: { select: { id: true, poNo: true, deliveryDate: true, paymentTerms: true, remarks: true, _count: { select: { lines: { where: { deletedAt: null } } } } } },
  vendor: {
    select: {
      id: true,
      vendorCode: true,
      vendorName: true,
      category: true,
      status: true,
      address: true,
      pinCode: true,
      gstNo: true,
      contactPerson: true,
      phone: true,
      email: true,
      bankDetails: true,
      poInitials: true,
    },
  },
  order: {
    select: {
      id: true,
      orderNo: true,
      orderQty: true,
      effectiveQty: true,
      excessPct: true,
      excessApprovedPct: true,
      excessApprovalStatus: true,
      colorCode: true,
      status: true,
      buyerDeliveryDate: true,
      buyer: { select: { id: true, buyerCode: true, buyerName: true } },
      style: { select: { id: true, styleNo: true, styleDescription: true } },
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
  quotation: {
    select: {
      id: true,
      quotationNo: true,
      quotationDate: true,
      item: true,
      subCategory: true,
      accessoriesItem: true,
      accessoryType: true,
      uom: true,
      qty: true,
      rateQuoted: true,
      amount: true,
      authorisationStatus: true,
      approvedByName: true,
      approvedAt: true,
      vendor: { select: { id: true, vendorName: true } },
    },
  },
};

const LIST_INCLUDE = {
  vendor: { select: { id: true, vendorCode: true, vendorName: true, category: true } },
  order: { select: { id: true, orderNo: true } },
  quotation: { select: { id: true, quotationNo: true, authorisationStatus: true } },
  // Multi-line: the document this row is one line of.
  header: { select: { id: true, poNo: true, _count: { select: { lines: { where: { deletedAt: null } } } } } },
};

// ===========================================================================
//  CALCULATION - the single place a PO amount is derived
// ===========================================================================

/**
 * Excel: "Amount" (Auto: Order Qty x Rate).
 *
 * Rounded to 2 decimals, the scale the column stores, so what is written back
 * always equals what the table's CHECK constraint recomputes.
 *
 * @param {Prisma.Decimal|string|number} orderQty
 * @param {Prisma.Decimal|string|number} rate
 * @returns {Prisma.Decimal}
 */
export function calculateAmount(orderQty, rate) {
  return D(orderQty).mul(D(rate)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * The excess ceiling that applies to a line, as a fraction.
 *
 * @param {{item: string, accessoriesItem?: string|null}} line
 * @returns {Prisma.Decimal}
 */
export function excessCeilingFor(line) {
  return D(isAccessoryLine(line) ? EXCESS_CEILING.ACCESSORIES : EXCESS_CEILING.GENERAL);
}

/** The two modes a purchase order may run in. C1. */
export const ORDER_MODES = ['AS_PER_STYLE', 'BULK'];

/**
 * C1: the order tolerance that actually applies to a line, as a fraction.
 *
 * Two numbers can bound a line, and the TIGHTER of them wins:
 *
 *   - the category ceiling, which is policy - accessories 1%, everything else
 *     3% (the sheet's "2-3%");
 *   - the line's own `orderTolerancePct`, which is what this PO contracted for.
 *
 * A line may contract for less than policy permits. It may not contract for
 * more, so a posted 5% on an accessory line resolves to 1% rather than being
 * honoured or throwing here - refusing it with a message is `create()`'s job,
 * via assertExcessWithinCeiling().
 *
 * Pure. No database.
 *
 * @param {string} category            L_ItemCategory value, e.g. "Fabric"
 * @param {{ACCESSORIES: string, GENERAL: string}} tolerances
 * @param {{accessoriesItem?: string|null, orderTolerancePct?: *}} [line]
 * @returns {Prisma.Decimal}
 */
export function resolveOrderTolerance(category, tolerances = EXCESS_CEILING, line = {}) {
  const accessory = isAccessoryLine({ item: category, accessoriesItem: line.accessoriesItem });
  const policy = D(accessory ? tolerances.ACCESSORIES : tolerances.GENERAL);
  if (line.orderTolerancePct === undefined || line.orderTolerancePct === null) return policy;
  const asked = D(line.orderTolerancePct);
  return asked.lessThan(policy) ? asked : policy;
}

/**
 * C1: THE ceiling rule. Pure, and the only place the cap is decided.
 *
 * Used by preview(), by create() and update() before the transaction, and
 * again by both INSIDE the transaction immediately before the row is written.
 * Because it takes the requirement as an argument rather than looking a BOM
 * up, the figure a PO was judged against is the figure stored on the PO - a
 * later BOM edit cannot move a ceiling that has already been applied.
 *
 *      AS_PER_STYLE   qty + alreadyOrdered <= requirement x (1 + tolerance)
 *                     A HARD CAP. There is no authorisation past it.
 *
 *      BULK           unbounded. Where a style is linked for reference the
 *                     variance is measured and returned for recording, and
 *                     `withinCeiling` is true regardless.
 *
 * @param {{
 *   qty: *,
 *   computedRequirementQty: *|null,
 *   orderTolerancePct?: *,
 *   alreadyOrderedQty?: *,
 *   accessoriesItem?: string|null,
 *   uom?: string,
 *   requirementBasis?: string|null,
 * }} line
 * @param {'AS_PER_STYLE'|'BULK'} mode
 * @param {string} category    L_ItemCategory value
 * @param {{ACCESSORIES: string, GENERAL: string}} [tolerances]
 * @returns {object} the verdict
 */
export function checkOrderCeiling(line, mode, category, tolerances = EXCESS_CEILING) {
  if (!ORDER_MODES.includes(mode)) {
    throw new TypeError(
      `Order mode must be one of ${ORDER_MODES.join(' / ')} - received ${JSON.stringify(mode)}. ` +
        'C1 requires the mode to be explicit; there is no default.',
    );
  }

  const qty = D(line.qty ?? 0);
  const hasRequirement =
    line.computedRequirementQty !== null && line.computedRequirementQty !== undefined;
  const requirement = hasRequirement ? D(line.computedRequirementQty).toDecimalPlaces(4) : null;
  const tolerance = resolveOrderTolerance(category, tolerances, line);

  const base = {
    mode,
    category,
    qty: qty.toFixed(4),
    tolerance: tolerance.toFixed(6),
    tolerancePct: tolerance.mul(100).toDecimalPlaces(4).toFixed(2),
    requirement: requirement ? requirement.toFixed(4) : null,
    requirementBasis: line.requirementBasis ?? null,
  };

  // ---- BULK: never blocked. Variance is a measurement, not a gate. --------
  if (mode === 'BULK') {
    const varianceQty = requirement ? qty.minus(requirement).toDecimalPlaces(4) : null;
    return {
      ...base,
      bounded: false,
      withinCeiling: true,
      ceiling: null,
      alreadyOrdered: null,
      remaining: null,
      exceedsBy: null,
      varianceQty: varianceQty ? varianceQty.toFixed(4) : null,
      variancePct:
        varianceQty && requirement && !requirement.isZero()
          ? varianceQty.div(requirement).toDecimalPlaces(6).toFixed(6)
          : null,
      basis: requirement
        ? 'Bulk order - the quantity is deliberately not bounded by the style requirement. ' +
          'The style is linked for reference and the variance is recorded. Process Doc s.5.'
        : 'Bulk order - the quantity is deliberately not bounded, and no style is linked ' +
          'to measure a variance against. Process Doc s.5.',
    };
  }

  // ---- AS_PER_STYLE with nothing to bound it against ---------------------
  if (!requirement) {
    return {
      ...base,
      bounded: false,
      withinCeiling: true,
      ceiling: null,
      alreadyOrdered: null,
      remaining: null,
      exceedsBy: null,
      varianceQty: null,
      variancePct: null,
      basis:
        'No style requirement could be computed for this line, so the BOM cannot bound ' +
        'this quantity. The order is allowed and recorded as unbounded - add the material ' +
        'to the style BOM if it should be capped.',
    };
  }

  // ---- AS_PER_STYLE: the hard cap ----------------------------------------
  const alreadyOrdered = D(line.alreadyOrderedQty ?? 0);
  const ceiling = requirement.mul(D(1).plus(tolerance)).toDecimalPlaces(4);
  const remaining = ceiling.minus(alreadyOrdered).toDecimalPlaces(4);
  const exceedsBy = qty.greaterThan(remaining) ? qty.minus(remaining).toDecimalPlaces(4) : ZERO;

  return {
    ...base,
    bounded: true,
    withinCeiling: exceedsBy.isZero(),
    ceiling: ceiling.toFixed(4),
    alreadyOrdered: alreadyOrdered.toFixed(4),
    remaining: remaining.toFixed(4),
    exceedsBy: exceedsBy.toFixed(4),
    varianceQty: null,
    variancePct: null,
    basis:
      `${line.requirementBasis ? `${line.requirementBasis}, plus ` : 'Requirement plus '}` +
      `${tolerance.mul(100).toDecimalPlaces(2).toFixed(2)}% order tolerance`,
  };
}

/**
 * What the style permits to be bought for an order, for one PO line.
 *
 * C9: THIS IS NOW A THIN ADAPTER over `domain/requirement.js`, which is the
 * single requirement calculation shared by Planning, this ceiling check and
 * the Cutting Challan. The formula used to live here in full and was about to
 * be copied into two more services; it lives in one file now and this function
 * only reshapes the result into the {requirement, basis, uom} triple that
 * `quantityCeiling()` and its callers already expect.
 *
 * Returns null when the style says nothing about this item: an order for a
 * material the BOM does not mention cannot be bounded by the BOM, and is
 * reported as unbounded rather than silently capped at zero.
 *
 * @param {object} style   Style with bomLines loaded
 * @param {object} order   Buyer order (effectiveQty is the Phase 3 ceiling)
 * @param {{item: string, subCategory?: string|null, accessoriesItem?: string|null, uom: string}} line
 * @param {Date|string} [on]  Resolve the BOM version effective on this date
 * @returns {{ requirement: Prisma.Decimal, basis: string, uom: string } | null}
 */
export function styleRequirementFor(style, order, line, on) {
  const result = requirementFor({ style: style ?? null, order, line, on });
  if (result.requirement === null) return null;
  return { requirement: result.requirement, basis: result.basis, uom: result.uom };
}

// ===========================================================================
//  VALIDATION HELPERS
// ===========================================================================

const LIST_FIELDS = [
  ['item', 'ItemCategory'],
  ['accessoriesItem', 'AccessoriesItem'],
  ['uom', 'UOM'],
  ['gsm', 'GSM'],
  ['content', 'FabricContent'],
  ['colorCode', 'ColorCode'],
  ['count', 'Count'],
];

async function validateDropdowns(data, existing = null) {
  for (const [field, listCode] of LIST_FIELDS) {
    if (data[field] === undefined) continue;
    await assertValueInList(listCode, data[field], { field });
  }

  // Sub-category follows the item: a fabric weight, or the stationery article.
  // The value the row already holds is kept only while the item is unchanged.
  const item = data.item !== undefined ? data.item : existing?.item;
  if (data.subCategory !== undefined) {
    await assertValueInList(subCategoryListFor(item), data.subCategory, {
      field: 'subCategory',
      allow: existing?.subCategory && existing.item === item ? [existing.subCategory] : null,
    });
  }

  /*
   * The variety must be a listed one that belongs to the item. On an edit the
   * value the row already holds is kept even if it is not in the list - the
   * free text typed before varieties were a dropdown.
   */
  if (data.accessoryType !== undefined) {
    await assertAccessoryVariety(
      data.accessoriesItem !== undefined ? data.accessoriesItem : existing?.accessoriesItem,
      data.accessoryType,
      { allow: existing?.accessoryType ? [existing.accessoryType] : null },
    );
  }
}

/** Loads the vendor a PO is placed on, and refuses one who cannot be bought from. */
async function resolveVendor(vendorId) {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, deletedAt: null } });
  if (!vendor) throw ApiError.badRequest('Vendor does not exist', { field: 'vendorId' });
  if (vendor.status !== 'ACTIVE') {
    throw ApiError.badRequest(`Vendor "${vendor.vendorName}" is inactive`, { field: 'vendorId' });
  }
  return vendor;
}

/** The buyer order the PO procures for, with the style and BOM behind it. */
async function resolveOrder(orderId) {
  if (!orderId) return null;
  const order = await prisma.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: {
      style: { include: { bomLines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } } },
    },
  });
  if (!order) throw ApiError.badRequest('Order does not exist', { field: 'orderId' });
  if (order.status === 'CANCELLED') {
    throw ApiError.badRequest(
      `Order ${order.orderNo} is cancelled - nothing can be purchased against it`,
      { field: 'orderId' },
    );
  }
  return order;
}

/** The style, either named directly or inherited from the order. */
async function resolveStyle(styleId) {
  if (!styleId) return null;
  const style = await prisma.style.findFirst({
    where: { id: styleId, deletedAt: null },
    include: { bomLines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
  });
  if (!style) throw ApiError.badRequest('Style does not exist', { field: 'styleId' });
  return style;
}

/**
 * The quotation a PO is raised from.
 *
 * Only an APPROVED quotation may become a purchase order - that is the whole
 * point of the authorisation step - and it must be a quotation on the same
 * vendor, or the approved rate belongs to somebody else.
 */
async function resolveQuotation(quotationId, vendorId) {
  if (!quotationId) return null;
  const quotation = await prisma.vendorQuotation.findFirst({
    where: { id: quotationId, deletedAt: null },
    include: { vendor: { select: { id: true, vendorName: true } } },
  });
  if (!quotation) throw ApiError.badRequest('Quotation does not exist', { field: 'quotationId' });

  if (quotation.authorisationStatus !== 'APPROVED') {
    throw ApiError.badRequest(
      `Quotation ${quotation.quotationNo} is ${quotation.authorisationStatus.toLowerCase()}. ` +
        'Only an approved quotation can become a purchase order.',
      { field: 'quotationId', authorisationStatus: quotation.authorisationStatus },
    );
  }
  if (vendorId && quotation.vendorId !== vendorId) {
    throw ApiError.badRequest(
      `Quotation ${quotation.quotationNo} was approved for ${quotation.vendor.vendorName}. ` +
        'A purchase order cannot borrow another vendor’s approved rate.',
      { field: 'quotationId' },
    );
  }
  return quotation;
}

// ===========================================================================
//  THE TWO CEILINGS
// ===========================================================================

/**
 * Refuses an excess allowance above what the item category permits.
 *
 * @param {{item: string, accessoriesItem?: string|null, excessAllowed?: any}} line
 */
/**
 * C1: a purchase order must state its mode. There is no default anywhere -
 * not in the validator, not in the service, not on the column - because the
 * mode decides whether the quantity is bounded at all.
 */
function assertOrderMode(mode) {
  if (!ORDER_MODES.includes(mode)) {
    throw ApiError.badRequest(
      'A purchase order must say which mode it runs in: AS_PER_STYLE (bounded by the style ' +
        'requirement) or BULK (deliberately unbounded).',
      { field: 'orderMode', received: mode ?? null, allowed: ORDER_MODES },
    );
  }
  return mode;
}

/**
 * Stationery is bought for the office, never against a style, so there is no
 * requirement for AS_PER_STYLE to be bounded by. Said plainly here rather than
 * left to surface as a "no requirement" refusal that would not explain why.
 */
function assertStationeryIsBulk(line, orderMode) {
  if (isStationery(line.item) && orderMode !== 'BULK') {
    throw ApiError.badRequest(
      'Stationery is not ordered against a style, so it can only be ordered in BULK mode.',
      { field: 'orderMode', received: orderMode, allowed: ['BULK'] },
    );
  }
}

function assertExcessWithinCeiling(line, resolvedTolerance) {
  const allowed = D(line.excessAllowed ?? 0);
  // C2: the ceiling is the resolved category tolerance where one has been
  // resolved. The hardcoded pair is the fallback for the pure-function callers
  // only, and the message says which was used so a refusal is arguable.
  const ceiling = resolvedTolerance ? resolvedTolerance.orderTolerance : excessCeilingFor(line);

  if (allowed.greaterThan(ceiling)) {
    throw ApiError.badRequest(
      `Excess allowed is ${allowed.mul(100).toFixed(2)}%, and the order tolerance for ` +
        `${resolvedTolerance?.categoryLabel ?? (isAccessoryLine(line) ? 'accessories' : 'this material')} ` +
        `is ${ceiling.mul(100).toFixed(2)}%.` +
        (resolvedTolerance ? ` ${resolvedTolerance.basis}` : ''),
      {
        field: 'excessAllowed',
        requested: allowed.toFixed(6),
        ceiling: ceiling.toFixed(6),
        category: resolvedTolerance?.category ?? null,
        source: resolvedTolerance?.source ?? 'COMPILED_FALLBACK',
        rule: resolvedTolerance?.basis ?? (isAccessoryLine(line) ? 'accessories 1%' : 'general 2-3%'),
      },
    );
  }
}

/**
 * STILL LIVE AGAINST THE REQUIREMENT.
 *
 * A purchase order carries TWO independent status axes, and only an order that
 * is dead on NEITHER still consumes the ceiling:
 *
 *   workflowState  the authority axis - was this order allowed?
 *   status         the fulfilment axis - are the goods coming?
 *
 * Reading one alone under-counts in one direction and over-counts in the
 * other. `setStatus()` cancels a PO by writing `status: 'CANCELLED'` and
 * `workflowState: 'CANCELLED'` while deliberately LEAVING `approvalStatus`
 * at 'APPROVED' - the approval genuinely happened and the record of it stands.
 * So a filter that tests approval alone keeps counting the quantity of an
 * order nobody will ever fulfil, and blocks the re-order that the
 * cancellation exists to allow.
 *
 * All three columns are tested rather than the one the transitions imply,
 * because a live order is dead on none of them: the predicate stays right
 * even for a row whose axes were left out of step by an older write path.
 */
const LIVE_AGAINST_REQUIREMENT = {
  workflowState: { notIn: ['CANCELLED', 'REJECTED'] },
  approvalStatus: { not: 'REJECTED' },
  status: { not: 'CANCELLED' },
};

/**
 * What is already on order against the same buyer order for the same item,
 * excluding this PO. Two purchase orders for the same fabric on the same buyer
 * order share one requirement; neither may be judged in isolation.
 *
 * Cancelled and rejected orders are NOT counted - see
 * `LIVE_AGAINST_REQUIREMENT` above for why that takes three columns.
 */
async function alreadyOrderedQty_({ orderId, item, subCategory, accessoriesItem, excludeId, tx }) {
  if (!orderId) return ZERO;
  const db = tx ?? prisma;
  const rows = await db.purchaseOrder.findMany({
    where: {
      deletedAt: null,
      orderId,
      item,
      subCategory: subCategory ?? null,
      accessoriesItem: accessoriesItem ?? null,
      ...LIVE_AGAINST_REQUIREMENT,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { orderQty: true },
  });
  return rows.reduce((a, r) => a.plus(D(r.orderQty)), ZERO);
}

/**
 * The whole quantity story for one PO line, computed in one place so that the
 * form preview, the create path and the edit path can never disagree.
 *
 * Returns `null` for `ceiling` when nothing bounds the line - a bulk order, or
 * an item the style says nothing about - and says so in `basis`.
 */
export async function quantityCeiling({
  order,
  style,
  orderMode,
  item,
  subCategory,
  accessoriesItem,
  uom,
  orderQty,
  excessAllowed,
  excludeId,
  /**
   * C2 - the resolved category tolerance, from tolerance.service.js.
   *
   * Passed IN rather than looked up here, for the same reason
   * `computedRequirementQty` is: this function runs three times for one PO -
   * preview, pre-transaction, and again inside the transaction - and all
   * three have to be judged by ONE resolution. Resolving per call would let
   * a master edit land between the preview a buyer saw and the check that
   * refused them.
   *
   * Omitted only by the pure-function unit tests, which fall back to
   * EXCESS_CEILING deliberately.
   */
  resolvedTolerance,
  poDate,
  tx,
}) {
  const line = { item, subCategory, accessoriesItem, uom };

  // The category tolerance, as a two-key map in the shape checkOrderCeiling
  // expects. When one has been resolved it applies to the line whatever the
  // category, because it IS this line's category's number.
  const tolerances = resolvedTolerance
    ? {
        ACCESSORIES: resolvedTolerance.orderTolerance.toFixed(6),
        GENERAL: resolvedTolerance.orderTolerance.toFixed(6),
      }
    : EXCESS_CEILING;

  // What the style requires, where it says anything at all. This is the ONLY
  // place a BOM is read on this path, and its result is handed to the pure
  // function below and then persisted - never re-derived on read.
  const need = order ? styleRequirementFor(style ?? order.style, order, line, poDate) : null;

  // What is already claimed against the same order and item. A single-row
  // CHECK constraint cannot see this, which is why the service rule is
  // strictly tighter than the database one.
  const alreadyOrderedQty =
    need && orderMode === 'AS_PER_STYLE'
      ? await alreadyOrderedQty_({
          orderId: order.id,
          item,
          subCategory,
          accessoriesItem,
          excludeId,
          tx,
        })
      : ZERO;

  const verdict = checkOrderCeiling(
    {
      qty: orderQty ?? 0,
      computedRequirementQty: need ? need.requirement.toDecimalPlaces(4) : null,
      requirementBasis: need?.basis ?? null,
      orderTolerancePct: excessAllowed ?? 0,
      alreadyOrderedQty,
      accessoriesItem,
      uom,
    },
    orderMode,
    item,
    tolerances,
  );

  // The shape the form and the detail screen read. `requested` and
  // `excessAllowed` are kept under their existing names so the React side does
  // not have to change vocabulary to gain the C1 fields.
  return {
    ...verdict,
    orderMode,
    requested: verdict.qty,
    requirementUom: need?.uom ?? null,
    excessAllowed: D(excessAllowed ?? 0).toFixed(6),
    excessCeiling: (resolvedTolerance
      ? resolvedTolerance.orderTolerance
      : excessCeilingFor(line)
    ).toFixed(6),
    /** C2 - where the tolerance came from, for the screen and for the row. */
    tolerance: resolvedTolerance
      ? {
          category: resolvedTolerance.category,
          source: resolvedTolerance.source,
          isFallback: resolvedTolerance.isFallback,
          orderTolerancePct: resolvedTolerance.orderTolerancePct,
          receiptTolerancePct: resolvedTolerance.receiptTolerancePct,
          basis: resolvedTolerance.basis,
        }
      : null,
    /** Persisted verbatim onto the row by create()/update(). */
    persist: {
      computedRequirementQty: need ? need.requirement.toDecimalPlaces(4) : null,
      requirementBasis: need?.basis ?? null,
      bulkVarianceQty:
        orderMode === 'BULK' && verdict.varianceQty !== null ? D(verdict.varianceQty) : null,
      ...(resolvedTolerance
        ? {
            category: resolvedTolerance.category,
            orderTolerancePct: resolvedTolerance.orderTolerance,
            receiptTolerancePct: resolvedTolerance.receiptTolerance,
            toleranceRuleId: resolvedTolerance.ruleId,
            toleranceBasis: resolvedTolerance.basis,
          }
        : {}),
    },
  };
}

/**
 * What a purchase order must carry before it can be approved.
 *
 * An approved PO is an instruction sent to a vendor, and a vendor cannot act on
 * one that does not say where to deliver, what the tax code is, or what the
 * fabric actually is. Catching that at approval - rather than when the goods
 * turn up wrong - is a large part of what the approval step is FOR.
 *
 * Each entry is [field, label, appliesTo]. `appliesTo` decides whether the
 * field is required for THIS line: an HSN code is needed on everything, but a
 * GSM and a content only mean anything on fabric.
 */
const APPROVAL_REQUIREMENTS = [
  ['address', 'a delivery address', () => true],
  ['hsnCode', 'an HSN code', () => true],
  ['gsm', 'a GSM', (po) => po.item === 'Fabric'],
  ['content', 'a fabric content', (po) => po.item === 'Fabric'],
  ['colorCode', 'a colour', (po) => po.item === 'Fabric'],
  ['subCategory', 'a sub-category', (po) => po.item === 'Fabric'],
  ['accessoriesItem', 'an accessory item', (po) => po.item === 'Accessories'],
  ['subCategory', 'a stationery item', (po) => isStationery(po.item)],
];

/** Everything this PO still has to say before a vendor could act on it. */
function missingForApproval(po) {
  return APPROVAL_REQUIREMENTS.filter(([field, , appliesTo]) => appliesTo(po) && !po[field]).map(
    ([field, label]) => ({ field, label }),
  );
}

/**
 * Refuses to approve a PO that is not complete enough to send.
 *
 * Reports EVERY missing field at once. A buyer told about one gap, who fixes it
 * and is then told about the next, has been sent round the loop for nothing.
 */
function assertApprovable(po) {
  const missing = missingForApproval(po);
  if (missing.length === 0) return;

  throw ApiError.badRequest(
    `${po.poId} cannot be approved: it does not specify ` +
      `${missing.map((m) => m.label).join(', ')}. ` +
      'A vendor cannot act on a purchase order that does not say these things.',
    { field: missing[0].field, missing },
  );
}

/** Turns a breached ceiling into the refusal the client sees. */
function assertWithinCeiling(check, { item, subCategory, accessoriesItem, uom }) {
  if (!check.bounded || check.withinCeiling) return;
  const what = [item, subCategory, accessoriesItem].filter(Boolean).join(' / ');
  throw ApiError.badRequest(
    `${check.requested} ${uom} of ${what} exceeds what this order permits by ` +
      `${check.exceedsBy} ${uom}. The style requires ${check.requirement} and ` +
      `${check.alreadyOrdered} is already on order, leaving ${check.remaining}. ` +
      'Raise it as a bulk order if the quantity is deliberate.',
    { field: 'orderQty', ceiling: check },
  );
}

// ===========================================================================
//  PROJECTION
// ===========================================================================

function project(po) {
  if (!po) return po;
  const ordered = D(po.orderQty);
  const received = D(po.receivedQty);
  const pending = ordered.minus(received);
  return {
    ...po,
    /** Restated so no screen multiplies a rate by a quantity to show a total. */
    amountCalculation: `${ordered.toFixed(4)} x ${D(po.rate).toFixed(4)}`,
    pendingQty: (pending.isNegative() ? ZERO : pending).toFixed(4),
    /** Over-receipt is possible and legitimate within tolerance; report it. */
    overReceivedQty: (pending.isNegative() ? pending.negated() : ZERO).toFixed(4),
    receivedPct: ordered.isZero()
      ? '0.000000'
      : received.div(ordered).toDecimalPlaces(6).toFixed(6),
    fullyReceived: !ordered.isZero() && received.greaterThanOrEqualTo(ordered),
    decided: po.approvalStatus !== 'PENDING',
    approved: po.approvalStatus === 'APPROVED',
    excessAllowedPct: D(po.excessAllowed).mul(100).toFixed(2),

    // --- C2 -------------------------------------------------------------
    orderTolerancePctDisplay: D(po.orderTolerancePct).mul(100).toDecimalPlaces(4).toFixed(2),
    receiptTolerancePctDisplay: D(po.receiptTolerancePct).mul(100).toDecimalPlaces(4).toFixed(2),
    /** poQty x (1 + receipt tolerance) - the cumulative receipt ceiling. */
    maxReceivableQty: ordered
      .mul(D(1).plus(D(po.receiptTolerancePct)))
      .toDecimalPlaces(4)
      .toFixed(4),
    /**
     * C2 - the payable quantity, restated beside the received quantity.
     *
     * They are equal by construction today and a CHECK constraint says
     * payable can never exceed received. Both are exposed because they answer
     * different questions: received drives this order's fulfilment status,
     * payable is the figure a payment system would settle. NOTHING IN THIS
     * SYSTEM SPENDS IT - see the C11 Decision 2 report.
     */
    payableQty: D(po.payableQty ?? 0).toFixed(4),
    payableAmount: D(po.payableQty ?? 0)
      .mul(D(po.rate))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2),
    payableBasis: 'Payable quantity is the quantity actually received, not the quantity ordered.',
  };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    approvalStatus, status, vendorId, orderId, quotationId, item, orderMode,
    uom, dateFrom, dateTo, pendingReceipt, headerId,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(headerId ? { headerId } : {}),
    ...(approvalStatus ? { approvalStatus } : {}),
    ...(status ? { status } : {}),
    ...(vendorId ? { vendorId } : {}),
    ...(orderId ? { orderId } : {}),
    ...(quotationId ? { quotationId } : {}),
    ...(item ? { item } : {}),
    ...(orderMode ? { orderMode } : {}),
    ...(uom ? { uom } : {}),
    ...(dateFrom || dateTo
      ? {
          poDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    // "Still expecting goods" - approved, and not yet closed off.
    ...(pendingReceipt
      ? { approvalStatus: 'APPROVED', status: { notIn: ['COMPLETED', 'CANCELLED'] } }
      : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return { rows: rows.map(project), total, page, pageSize };
}

/** What the document register can sort by - columns of the header itself. */
export const DOCUMENT_SORTABLE = ['poNo', 'poDate', 'createdAt'];

/**
 * The register as the vendor sees it: ONE ROW PER PURCHASE ORDER DOCUMENT.
 *
 * `list()` answers per line, which is right for a GRN picking what to receive
 * against, but a three-item PO read there as three purchase orders. This pages
 * the headers instead; every line-level filter still applies, as "the document
 * has at least one line that matches".
 */
export async function listDocuments(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    approvalStatus, status, vendorId, orderId, quotationId, item, orderMode,
    uom, dateFrom, dateTo, pendingReceipt,
  } = query;

  const lineWhere = {
    deletedAt: null,
    ...(approvalStatus ? { approvalStatus } : {}),
    ...(status ? { status } : {}),
    ...(orderId ? { orderId } : {}),
    ...(quotationId ? { quotationId } : {}),
    ...(item ? { item } : {}),
    ...(orderMode ? { orderMode } : {}),
    ...(uom ? { uom } : {}),
    ...(pendingReceipt
      ? { approvalStatus: 'APPROVED', status: { notIn: ['COMPLETED', 'CANCELLED'] } }
      : {}),
    ...searchFilter(search, SEARCH),
  };

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(vendorId ? { vendorId } : {}),
    ...(dateFrom || dateTo
      ? {
          poDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    lines: { some: lineWhere },
  };

  const [headers, total] = await Promise.all([
    prisma.purchaseOrderHeader.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        vendor: LIST_INCLUDE.vendor,
        lines: {
          where: { deletedAt: null },
          orderBy: { lineNo: 'asc' },
          select: {
            id: true, poId: true, lineNo: true, item: true, subCategory: true,
            accessoriesItem: true, accessoryType: true, uom: true, orderQty: true,
            receivedQty: true, rate: true, amount: true, status: true, approvalStatus: true,
            workflowState: true, orderId: true,
          },
        },
      },
    }),
    prisma.purchaseOrderHeader.count({ where }),
  ]);

  const orderIds = [...new Set(headers.flatMap((h) => [h.orderId, ...h.lines.map((l) => l.orderId)]).filter(Boolean))];
  const orders = orderIds.length
    ? await prisma.buyerOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNo: true } })
    : [];
  const orderNo = new Map(orders.map((o) => [o.id, o.orderNo]));

  const rows = headers.map((h) => {
    const live = h.lines.filter((l) => l.approvalStatus !== 'REJECTED' && l.status !== 'CANCELLED');
    // With every line rejected, the fulfilment status is still the lines' own.
    const notCancelled = h.lines.filter((l) => l.status !== 'CANCELLED');
    const statuses = [...new Set((live.length ? live : notCancelled).map((l) => l.status))];
    const uoms = [...new Set(h.lines.map((l) => l.uom))];
    const sum = (key) => live.reduce((a, l) => a.plus(D(l[key])), ZERO).toFixed(4);
    return {
      id: h.id,
      poNo: h.poNo,
      poDate: h.poDate,
      vendor: h.vendor,
      deliveryDate: h.deliveryDate,
      lineCount: h.lines.length,
      lines: h.lines,
      totalAmount: live.reduce((a, l) => a.plus(D(l.amount)), ZERO).toFixed(2),
      /** Quantities only add up when every line is in the same unit. */
      uom: uoms.length === 1 ? uoms[0] : null,
      orderQty: uoms.length === 1 ? sum('orderQty') : null,
      receivedQty: uoms.length === 1 ? sum('receivedQty') : null,
      orderNos: [...new Set([h.orderId, ...h.lines.map((l) => l.orderId)].filter(Boolean).map((id) => orderNo.get(id)).filter(Boolean))],
      approvalStatus: documentStatus(h.lines.map((l) => ({ status: l.status === 'CANCELLED' ? 'CANCELLED' : l.approvalStatus }))),
      /**
       * Fulfilment: the one status every live line shares, or "in progress"
       * when they differ. A rejected PO is not a cancelled one - its lines keep
       * their own fulfilment status; only all-cancelled lines read Cancelled.
       */
      status: statuses.length === 1 ? statuses[0] : statuses.length ? 'IN_PROGRESS' : 'CANCELLED',
      workflowState: h.lines.length === 1 ? h.lines[0].workflowState : null,
    };
  });

  return { rows, total, page, pageSize };
}

/**
 * Full detail: the PO, the chain it came from, what has been received against
 * it, whether it may still be changed, and the trail.
 */
export async function getById(id) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!po) throw ApiError.notFound('Purchase order');

  const [usage, history, receipts, gatePasses, workflow] = await Promise.all([
    downstreamUsage(id),
    prisma.approvalHistory.findMany({
      where: { documentType: 'PURCHASE_ORDER', documentId: id },
      orderBy: { actedAt: 'asc' },
    }),
    receiptSummary(id),
    prisma.gatePass.findMany({
      where: { purchaseOrderId: id, deletedAt: null },
      orderBy: { gatePassDate: 'asc' },
      select: {
        id: true,
        gatePassNo: true,
        gatePassDate: true,
        type: true,
        qty: true,
        receivedQty: true,
        variationPct: true,
        uom: true,
        status: true,
        purpose: true,
      },
    }),
    // The shared workflow position, so this screen draws the same progress
    // trail as every other approvable document in the system.
    engine.statusOf('PURCHASE_ORDER', id),
  ]);

  return {
    ...project(po),
    // F-10: read by withApprovability() in the controller, then removed.
    createdById: po.createdById,
    workflow,
    workflowProgress: workflow.progress,
    traceability: traceability(po),
    receipts,
    gatePasses,
    usage,
    editable: editability(po, usage),
    history,
  };
}

/**
 * Order -> Quotation -> PO, as one object.
 *
 * The brief asks for a PO that is traceable back through the chain. Rather than
 * leave three screens to join it up, the chain is assembled here from what the
 * detail query already loaded, and each link says whether it is actually
 * present - a PO raised without a quotation is legitimate, and should look
 * different from one whose quotation was deleted.
 */
function traceability(po) {
  return {
    complete: Boolean(po.orderId && po.quotationId),
    order: po.order
      ? {
          id: po.order.id,
          orderNo: po.order.orderNo,
          orderQty: po.order.orderQty,
          effectiveQty: po.order.effectiveQty,
          status: po.order.status,
          buyerName: po.order.buyer?.buyerName ?? null,
          styleNo: po.order.style?.styleNo ?? null,
          deliveryDate: po.order.buyerDeliveryDate,
        }
      : null,
    quotation: po.quotation
      ? {
          id: po.quotation.id,
          quotationNo: po.quotation.quotationNo,
          quotationDate: po.quotation.quotationDate,
          rateQuoted: po.quotation.rateQuoted,
          qty: po.quotation.qty,
          amount: po.quotation.amount,
          authorisationStatus: po.quotation.authorisationStatus,
          approvedByName: po.quotation.approvedByName,
          approvedAt: po.quotation.approvedAt,
          /** Did the PO actually buy at the rate that was approved? */
          rateMatchesPo: D(po.quotation.rateQuoted).equals(D(po.rate)),
        }
      : null,
    purchaseOrder: {
      id: po.id,
      poId: po.poId,
      poDate: po.poDate,
      approvalStatus: po.approvalStatus,
      approvedByName: po.approvedByName,
      approvedAt: po.approvedAt,
    },
    /** Rendered as a breadcrumb by the detail screen. */
    chain: [po.order?.orderNo, po.quotation?.quotationNo, po.poId].filter(Boolean).join(' → '),
  };
}

/** What has been received against a PO, and how it stands against tolerance. */
async function receiptSummary(purchaseOrderId) {
  const grns = await prisma.grn.findMany({
    where: { purchaseOrderId, deletedAt: null },
    orderBy: { grnDate: 'asc' },
    select: {
      id: true,
      grnNo: true,
      grnDate: true,
      billNo: true,
      rollNo: true,
      receivingQty: true,
      inventoryRate: true,
      amount: true,
      variationPct: true,
      toleranceBreached: true,
      purpose: true,
      status: true,
      postedAt: true,
      location: true,
    },
  });

  const receivedQty = grns.reduce((a, g) => a.plus(D(g.receivingQty)), ZERO);
  const receivedValue = grns.reduce((a, g) => a.plus(D(g.amount)), ZERO);

  return {
    grns,
    count: grns.length,
    receivedQty: receivedQty.toFixed(4),
    receivedValue: receivedValue.toFixed(2),
    breaches: grns.filter((g) => g.toleranceBreached).length,
  };
}

/** Counts what has been raised against a PO. */
async function downstreamUsage(purchaseOrderId) {
  const [gatePasses, grns] = await Promise.all([
    prisma.gatePass.count({ where: { purchaseOrderId, deletedAt: null } }),
    prisma.grn.count({ where: { purchaseOrderId, deletedAt: null } }),
  ]);
  return { gatePasses, grns, total: gatePasses + grns };
}

/** Explains, in one place, whether and how a PO may be changed. */
function editability(po, usage) {
  const decided = po.approvalStatus !== 'PENDING';
  const cancelled = po.status === 'CANCELLED';
  const missing = missingForApproval(po);

  return {
    /** A decided PO is what the vendor was sent; it stops moving. */
    canEdit: !decided && !cancelled && usage.total === 0,
    /** Not decidable until it says everything a vendor would need. */
    canDecide: !decided && !cancelled && missing.length === 0,
    missingForApproval: missing,
    canDelete: !decided && usage.total === 0,
    /** Only an approved PO admits goods. */
    canRaiseGatePass: po.approvalStatus === 'APPROVED' && !cancelled,
    canReceive: po.approvalStatus === 'APPROVED' && !cancelled,
    canReopen: decided && usage.total === 0,
    lockedBy: [
      usage.gatePasses > 0 ? `${usage.gatePasses} gate pass(es)` : null,
      usage.grns > 0 ? `${usage.grns} GRN(s)` : null,
    ].filter(Boolean),
  };
}

// ===========================================================================
//  COMMANDS
// ===========================================================================

/**
 * Raises a purchase order.
 *
 * poId follows the PO sheet's note beside the column - "Vendor initial + no" -
 * so the number is drawn from the vendor's own counter (RF-001, MA-001) rather
 * than one global series. Procurement may still type the vendor's own reference
 * and have it kept.
 */
export async function create(input, actorId) {
  // A single PO is a one-line document, numbered exactly as it always was.
  const { lines } = await createDocumentInternal(
    {
      poNo: input.poId,
      poDate: input.poDate,
      vendorId: input.vendorId,
      address: input.address,
      orderId: input.orderId,
      lines: [input],
    },
    actorId,
  );
  return project(lines[0]);
}

/**
 * MULTI-LINE: one purchase order, many items, one vendor.
 *
 * Every line is judged exactly as a single PO always was - its own order
 * mode, requirement ceiling, frozen tolerances - and all of it happens in ONE
 * transaction, so a document is either raised whole or not at all. Two lines
 * for the same material on the same buyer order are judged cumulatively,
 * because the in-transaction ceiling check sees the line written before it.
 */
export async function createDocument(input, actorId) {
  const { header } = await createDocumentInternal(input, actorId);
  return getDocument(header.id);
}

async function createDocumentInternal(input, actorId) {
  if (!input.lines?.length) {
    throw ApiError.badRequest('A purchase order needs at least one item', { field: 'lines' });
  }
  const vendor = await resolveVendor(input.vendorId);
  const poDate = input.poDate ? new Date(input.poDate) : new Date();

  const dup = duplicateMaterial(input.lines, (l) =>
    // Two sizes of one material are two lines, not a duplicate.
    [l.item, l.subCategory ?? '', l.accessoriesItem ?? '', l.accessoryType ?? '', l.size ?? '', l.colorCode ?? '',
      l.uom, l.orderId ?? input.orderId ?? '', l.styleId ?? ''].join('|'),
  );
  if (dup) {
    throw ApiError.badRequest(
      `Lines ${dup.first + 1} and ${dup.second + 1} order the same material. Combine them into one line.`,
      { field: `lines.${dup.second}` },
    );
  }

  // Every line checked BEFORE a number is drawn, so a document with one bad
  // line is refused whole and burns nothing from the vendor's series.
  const prepared = [];
  for (const [i, line] of input.lines.entries()) {
    try {
      prepared.push(await prepareLine({ ...line, orderId: line.orderId ?? input.orderId }, { vendor, poDate }));
    } catch (err) {
      if (input.lines.length > 1 && err?.message) err.message = `Line ${i + 1}: ${err.message}`;
      throw err;
    }
  }

  const created = await prisma.$transaction(
    async (tx) => {
      const poNo =
        input.poNo?.trim() || (await nextNumber('PURCHASE_ORDER', { scopeKey: poSeriesKey(vendor), tx }));
      const [clash, headerClash] = await Promise.all([
        tx.purchaseOrder.findUnique({ where: { poId: poNo }, select: { id: true } }),
        tx.purchaseOrderHeader.findUnique({ where: { poNo }, select: { id: true } }),
      ]);
      if (clash || headerClash) throw ApiError.conflict('This PO ID already exists', { field: 'poId' });

      const header = await tx.purchaseOrderHeader.create({
        data: {
          poNo,
          poDate,
          vendorId: vendor.id,
          // Excel: "Address" (Auto, from Vendor Master). Snapshotted, because the
          // PO is a document that was sent.
          address: input.address ?? vendor.address ?? null,
          orderId: input.orderId ?? prepared[0].order?.id ?? null,
          deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : null,
          paymentTerms: input.paymentTerms ?? null,
          remarks: input.headerRemarks ?? null,
          createdById: actorId,
          updatedById: actorId,
        },
      });

      const lines = [];
      for (const [i, ctx] of prepared.entries()) {
        lines.push(await writeLine(tx, ctx, { header, lineNo: i + 1, actorId }));
      }
      return { header, lines };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  for (const [i, po] of created.lines.entries()) {
    const { amount, quotation, order } = prepared[i];
    await recordHistory(po, 'SUBMITTED', {
      toStatus: 'PENDING',
      actorId,
      remarks:
        `PO raised on ${vendor.vendorName}: ${D(po.orderQty).toFixed(4)} ${po.uom} at ` +
        `${D(po.rate).toFixed(4)} = ${amount.toFixed(2)}` +
        (quotation ? ` (quotation ${quotation.quotationNo})` : '') +
        (order ? ` for order ${order.orderNo}` : '') +
        (created.lines.length > 1 ? ` - line ${po.lineNo} of ${created.lines.length}` : ''),
    });
  }

  return created;
}

/**
 * Everything about one PO line that can be decided before the transaction:
 * the dropdowns, the order and quotation it rests on, the mode, the frozen
 * tolerance, a first (fast) pass of both ceilings, and the amount.
 */
async function prepareLine(input, { vendor, poDate }) {
  await validateDropdowns(input);

  const order = await resolveOrder(input.orderId);
  const quotation = await resolveQuotation(input.quotationId, vendor.id);
  const style = (await resolveStyle(input.styleId)) ?? order?.style ?? null;

  const line = {
    item: input.item,
    subCategory: input.subCategory ?? null,
    accessoriesItem: input.accessoriesItem ?? null,
    uom: input.uom,
    excessAllowed: input.excessAllowed ?? 0,
  };

  // C1: the mode is explicit. There is no default here and none on the column.
  const orderMode = assertOrderMode(input.orderMode);
  assertStationeryIsBulk(line, orderMode);

  // ---- C2: THE TOLERANCE, RESOLVED ONCE ---------------------------------
  //
  // Resolved here, before anything is written, and then handed to all three
  // ceiling passes AND stored on the row. A purchase order is received against
  // for weeks; the receipt tolerance the GRN will judge those deliveries by is
  // frozen at this moment, so an edit to the master in between cannot change
  // the rules mid-flight.
  const category = categoryOfLine(line);
  const resolvedTolerance = await toleranceMaster.resolveCategoryTolerance(null, {
    category,
    on: poDate,
    orderId: order?.id,
    buyerId: order?.buyerId ?? order?.buyer?.id,
    itemCategory: input.item,
  });

  assertExcessWithinCeiling(line, resolvedTolerance);

  // A first pass outside the transaction, so an over-ceiling PO is refused
  // before a document number is drawn. The authoritative pass is the one
  // inside the transaction (writeLine).
  assertWithinCeiling(
    await quantityCeiling({
      order,
      style,
      orderMode,
      ...line,
      orderQty: input.orderQty,
      excessAllowed: input.excessAllowed ?? 0,
      resolvedTolerance,
      poDate,
    }),
    line,
  );

  // C9: an AS_PER_STYLE order has to have a requirement to be bounded by.
  if (orderMode === 'AS_PER_STYLE') {
    assertRequirement({
      style: style ?? order?.style ?? null,
      order,
      line,
      on: poDate,
      forDocument: 'An "as per style" purchase order',
    });
  }

  // THE formula. Nothing the client sent contributes to it but qty and rate.
  const amount = calculateAmount(input.orderQty, input.rate);

  return { input, vendor, order, quotation, style, line, orderMode, resolvedTolerance, poDate, amount };
}

/** Writes one prepared line on the caller's transaction, after the authoritative ceiling. */
async function writeLine(tx, ctx, { header, lineNo, actorId }) {
  const { input, vendor, order, quotation, style, line, orderMode, resolvedTolerance, poDate, amount } = ctx;

  // ---- C1: THE AUTHORITATIVE CHECK ------------------------------------
  //
  // Re-run inside the transaction, against rows this transaction can see -
  // including the lines of this same document written just before this one.
  const ceiling = await quantityCeiling({
    order,
    style,
    orderMode,
    ...line,
    orderQty: input.orderQty,
    excessAllowed: input.excessAllowed ?? 0,
    resolvedTolerance,
    poDate,
    tx,
  });
  assertWithinCeiling(ceiling, line);

  return tx.purchaseOrder.create({
    data: {
      headerId: header.id,
      lineNo,
      poId: lineNumber(header.poNo, lineNo),
      poDate,
      item: input.item,
      subCategory: input.subCategory ?? null,
      accessoriesItem: input.accessoriesItem ?? null,
      accessoryType: input.accessoryType ?? null,
      size: input.size ?? null,
      excessAllowed: D(input.excessAllowed ?? 0),
      vendorId: vendor.id,
      address: header.address,
      uom: input.uom,
      orderQty: D(input.orderQty),
      rate: D(input.rate),
      amount,
      hsnCode: input.hsnCode ?? null,
      gsm: input.gsm ?? null,
      content: input.content ?? null,
      colorCode: input.colorCode ?? null,
      count: input.count ?? null,
      status: 'PENDING',
      remarks: input.remarks ?? null,
      orderMode,
      // C1: frozen at creation. Never recomputed on read, so a later BOM
      // edit cannot move a ceiling that has already been applied here.
      computedRequirementQty: ceiling.persist.computedRequirementQty,
      requirementBasis: ceiling.persist.requirementBasis,
      bulkVarianceQty: ceiling.persist.bulkVarianceQty,
      // C2: category and BOTH tolerances, frozen. The GRN reads these rather
      // than re-resolving, which is what makes a receipt weeks later
      // reproducible.
      category: ceiling.persist.category,
      orderTolerancePct: ceiling.persist.orderTolerancePct,
      receiptTolerancePct: ceiling.persist.receiptTolerancePct,
      toleranceRuleId: ceiling.persist.toleranceRuleId,
      toleranceBasis: ceiling.persist.toleranceBasis,
      orderId: order?.id ?? null,
      styleId: style?.id ?? null,
      quotationId: quotation?.id ?? null,
      // A PO is always raised pending; nobody self-approves on create.
      approvalStatus: 'PENDING',
      createdById: actorId,
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });
}

// ---------------------------------------------------------------------------
//  THE DOCUMENT - what the vendor receives
// ---------------------------------------------------------------------------

export async function getDocument(headerId) {
  const header = await prisma.purchaseOrderHeader.findFirst({
    where: { id: headerId, deletedAt: null },
    include: {
      vendor: INCLUDE.vendor,
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: 'asc' },
        include: LIST_INCLUDE,
      },
    },
  });
  if (!header) throw ApiError.notFound('Purchase order');
  const order = header.orderId
    ? await prisma.buyerOrder.findUnique({ where: { id: header.orderId }, select: { id: true, orderNo: true } })
    : null;
  const lines = header.lines.map(project);
  const history = await prisma.approvalHistory.findMany({
    where: { documentType: 'PURCHASE_ORDER', documentId: { in: header.lines.map((l) => l.id) } },
    orderBy: { actedAt: 'asc' },
  });
  const live = lines.filter((l) => l.approvalStatus !== 'REJECTED' && l.status !== 'CANCELLED');
  return {
    ...header,
    order,
    lines,
    lineCount: lines.length,
    totalAmount: live.reduce((a, l) => a.plus(D(l.amount)), ZERO).toFixed(2),
    status: documentStatus(lines.map((l) => ({ status: l.status === 'CANCELLED' ? 'CANCELLED' : l.approvalStatus }))),
    pendingLines: lines.filter((l) => l.approvalStatus === 'PENDING').length,
    history,
    createdById: header.createdById,
  };
}

/**
 * Approves every pending line of a document.
 *
 * Every line is checked first - complete enough to send, and resting on a
 * quotation that is still approved - so one bad line refuses the whole
 * decision instead of leaving the document half approved.
 */
export async function approveDocument(headerId, { remarks } = {}, actor) {
  const doc = await getDocument(headerId);
  const pending = doc.lines.filter((l) => l.approvalStatus === 'PENDING' && l.status !== 'CANCELLED');
  if (!pending.length) throw ApiError.badRequest('Nothing on this purchase order is waiting for a decision.');
  for (const line of pending) {
    try {
      assertApprovable(line);
    } catch (err) {
      if (err?.message) err.message = `Line ${line.lineNo} (${line.poId}): ${err.message}`;
      throw err;
    }
  }
  for (const line of pending) await approve(line.id, { remarks }, actor);
  return getDocument(headerId);
}

export async function rejectDocument(headerId, { reason }, actor) {
  const doc = await getDocument(headerId);
  const pending = doc.lines.filter((l) => l.approvalStatus === 'PENDING');
  if (!pending.length) throw ApiError.badRequest('Nothing on this purchase order is waiting for a decision.');
  for (const line of pending) await reject(line.id, { reason }, actor);
  return getDocument(headerId);
}

/** The whole document as the vendor receives it - every live line. */
export async function printDocument(headerId) {
  const doc = await getDocument(headerId);
  const lines = doc.lines.filter((l) => l.approvalStatus !== 'REJECTED' && l.status !== 'CANCELLED');
  const total = lines.reduce((a, l) => a.plus(D(l.amount)), ZERO);
  return {
    header: {
      poNo: doc.poNo,
      poDate: doc.poDate,
      deliveryDate: doc.deliveryDate,
      paymentTerms: doc.paymentTerms,
      remarks: doc.remarks,
      address: doc.address,
      orderNo: doc.order?.orderNo ?? null,
    },
    vendor: doc.vendor,
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      poId: l.poId,
      item: l.item,
      subCategory: l.subCategory,
      accessoriesItem: l.accessoriesItem,
      accessoryType: l.accessoryType,
      size: l.size,
      colorCode: l.colorCode,
      gsm: l.gsm,
      content: l.content,
      hsnCode: l.hsnCode,
      uom: l.uom,
      orderQty: l.orderQty,
      rate: l.rate,
      amount: l.amount,
      approvalStatus: l.approvalStatus,
      orderNo: l.order?.orderNo ?? null,
      // Single-form POs keep their remarks on the line, not the header.
      remarks: l.remarks && l.remarks !== doc.remarks ? l.remarks : null,
    })),
    totalAmount: total.toFixed(2),
    amountInWords: amountInWords(total),
    /** Printable as the vendor's copy only once every line on it is approved. */
    fullyApproved: lines.length > 0 && lines.every((l) => l.approvalStatus === 'APPROVED'),
    company: {
      name: env.COMPANY_NAME,
      address: env.COMPANY_ADDRESS,
      gstin: env.COMPANY_GSTIN,
    },
  };
}

/** Header and line remarks as one printed note, without repeating a shared one. */
function joinRemarks(...parts) {
  const unique = [...new Set(parts.map((p) => p?.trim()).filter(Boolean))];
  return unique.length ? unique.join('\n') : null;
}

/** The vendor's PO series key - "Vendor initial + no" on the PO sheet. */
function poSeriesKey(vendor) {
  const key = vendor.poInitials?.trim().toUpperCase();
  if (!key) {
    throw ApiError.badRequest(
      `Vendor "${vendor.vendorName}" has no PO initials set, so no PO series exists for it. ` +
        'Set them on the Vendor Master.',
      { field: 'vendorId' },
    );
  }
  return key;
}

/**
 * Edits a purchase order while it is still pending.
 *
 * Any move in quantity or rate recomputes the amount, and both ceilings are
 * re-checked - an edit is as capable of over-ordering as a create. An approved
 * PO is the document the vendor holds and does not move at all.
 */
export async function update(id, input, actorId) {
  const existing = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw ApiError.notFound('Purchase order');

  const usage = await downstreamUsage(id);
  const editable = editability(existing, usage);
  if (!editable.canEdit) {
    throw ApiError.conflict(
      existing.approvalStatus !== 'PENDING'
        ? `This PO was already ${existing.approvalStatus.toLowerCase()} and cannot be edited. ` +
          'Reopen it first, or raise a fresh PO.'
        : existing.status === 'CANCELLED'
          ? 'This PO is cancelled.'
          : `This PO already has ${editable.lockedBy.join(' and ')} against it.`,
      { approvalStatus: existing.approvalStatus, status: existing.status, usage },
    );
  }

  await validateDropdowns(input, existing);

  const vendorId = input.vendorId ?? existing.vendorId;
  const vendor = await resolveVendor(vendorId);
  const order = await resolveOrder(
    input.orderId !== undefined ? input.orderId : existing.orderId,
  );
  const quotation = await resolveQuotation(
    input.quotationId !== undefined ? input.quotationId : existing.quotationId,
    vendor.id,
  );
  const style =
    (await resolveStyle(input.styleId !== undefined ? input.styleId : existing.styleId)) ??
    order?.style ??
    null;

  const merged = {
    item: input.item ?? existing.item,
    subCategory: input.subCategory !== undefined ? input.subCategory : existing.subCategory,
    accessoriesItem:
      input.accessoriesItem !== undefined ? input.accessoriesItem : existing.accessoriesItem,
    uom: input.uom ?? existing.uom,
    excessAllowed:
      input.excessAllowed !== undefined ? input.excessAllowed : existing.excessAllowed,
  };
  // C1: an edit may switch mode, but it may not leave it unstated.
  const orderMode = assertOrderMode(input.orderMode ?? existing.orderMode);
  assertStationeryIsBulk(merged, orderMode);
  const orderQty = input.orderQty !== undefined ? D(input.orderQty) : D(existing.orderQty);
  const rate = input.rate !== undefined ? D(input.rate) : D(existing.rate);

  // ---- C2: RE-RESOLVE ON EDIT, AND RE-FREEZE -----------------------------
  //
  // An edit may legitimately change the item and therefore the category, so
  // the tolerance is resolved again - as at the PO's OWN date, not today's, so
  // correcting a typo on last month's order does not silently re-judge it by
  // this month's master.
  const poDate = input.poDate ? new Date(input.poDate) : existing.poDate;
  const category = categoryOfLine(merged);
  const resolvedTolerance = await toleranceMaster.resolveCategoryTolerance(null, {
    category,
    on: poDate,
    orderId: order?.id,
    buyerId: order?.buyerId ?? order?.buyer?.id,
    itemCategory: merged.item,
  });

  assertExcessWithinCeiling(merged, resolvedTolerance);

  if (orderMode === 'AS_PER_STYLE') {
    assertRequirement({
      style: style ?? order?.style ?? null,
      order,
      line: merged,
      on: poDate,
      forDocument: 'An "as per style" purchase order',
    });
  }

  // A first pass before the transaction, so an over-ceiling edit is refused
  // early. The authoritative pass is inside the transaction below.
  assertWithinCeiling(
    await quantityCeiling({
      order,
      style,
      orderMode,
      ...merged,
      orderQty,
      excludeId: id,
      resolvedTolerance,
      poDate,
    }),
    merged,
  );

  // Recomputed on every write, whether or not qty or rate were what moved - so
  // the amount can never drift away from the two numbers behind it.
  const amount = calculateAmount(orderQty, rate);

  const po = await prisma.$transaction(async (tx) => {
    // ---- C1: THE AUTHORITATIVE CHECK ------------------------------------
    // Re-run inside the transaction against rows it can see. An edit is as
    // capable of over-ordering as a create, and just as exposed to a
    // concurrent PO landing against the same requirement in between.
    const ceiling = await quantityCeiling({
      order,
      style,
      orderMode,
      ...merged,
      orderQty,
      excludeId: id,
      resolvedTolerance,
      poDate,
      tx,
    });
    assertWithinCeiling(ceiling, merged);

    return tx.purchaseOrder.update({
    where: { id },
    data: {
      ...(input.poId !== undefined ? { poId: input.poId } : {}),
      ...(input.poDate !== undefined ? { poDate: new Date(input.poDate) } : {}),
      ...(input.item !== undefined ? { item: input.item } : {}),
      ...(input.subCategory !== undefined ? { subCategory: input.subCategory } : {}),
      ...(input.accessoriesItem !== undefined ? { accessoriesItem: input.accessoriesItem } : {}),
      ...(input.accessoryType !== undefined ? { accessoryType: input.accessoryType } : {}),
      ...(input.size !== undefined ? { size: input.size } : {}),
      ...(input.excessAllowed !== undefined ? { excessAllowed: D(input.excessAllowed) } : {}),
      ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.uom !== undefined ? { uom: input.uom } : {}),
      ...(input.hsnCode !== undefined ? { hsnCode: input.hsnCode } : {}),
      ...(input.gsm !== undefined ? { gsm: input.gsm } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.colorCode !== undefined ? { colorCode: input.colorCode } : {}),
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      orderMode,
      ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
      ...(input.styleId !== undefined ? { styleId: input.styleId } : {}),
      ...(input.quotationId !== undefined ? { quotationId: quotation?.id ?? null } : {}),
      orderQty,
      rate,
      amount,
      // C1: the frozen requirement is re-stamped on edit, because an edit may
      // legitimately change the item, the style or the mode - and the ceiling
      // the row is judged by must be the one actually applied to it. It is
      // still never recomputed on READ: only a write moves it.
      computedRequirementQty: ceiling.persist.computedRequirementQty,
      requirementBasis: ceiling.persist.requirementBasis,
      bulkVarianceQty: ceiling.persist.bulkVarianceQty,
      // C2: re-frozen for the same reason the requirement is. An edit that
      // changed the item changed the category, and the row must be judged -
      // now and by every future GRN - by the tolerance that was actually
      // applied to it.
      category: ceiling.persist.category,
      orderTolerancePct: ceiling.persist.orderTolerancePct,
      receiptTolerancePct: ceiling.persist.receiptTolerancePct,
      toleranceRuleId: ceiling.persist.toleranceRuleId,
      toleranceBasis: ceiling.persist.toleranceBasis,
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
    });
  });

  return project(po);
}

// ---------------------------------------------------------------------------
//  PO APPROVAL - the pipeline's second Director gate
// ---------------------------------------------------------------------------

/**
 * Approves the PO. The amount is recomputed one last time and stamped, so what
 * is approved is provably qty x rate and not whatever a stale row held.
 */
export async function approve(id, { remarks }, actor) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!po) throw ApiError.notFound('Purchase order');

  if (po.approvalStatus !== 'PENDING') {
    throw ApiError.badRequest(`This PO is already ${po.approvalStatus.toLowerCase()}.`);
  }
  if (po.status === 'CANCELLED') {
    throw ApiError.badRequest('This PO is cancelled and cannot be approved.');
  }

  // Complete enough to send to a vendor? Checked before the decision is taken,
  // not after the goods turn up wrong.
  assertApprovable(po);

  // An approval that rests on a quotation is only as good as that quotation.
  if (po.quotationId) {
    const quotation = await prisma.vendorQuotation.findFirst({
      where: { id: po.quotationId, deletedAt: null },
      select: { quotationNo: true, authorisationStatus: true },
    });
    if (quotation && quotation.authorisationStatus !== 'APPROVED') {
      throw ApiError.conflict(
        `Quotation ${quotation.quotationNo} is now ` +
          `${quotation.authorisationStatus.toLowerCase()}. This PO rests on it and cannot be ` +
          'approved until the quotation is settled.',
        { quotationStatus: quotation.authorisationStatus },
      );
    }
  }

  const amount = calculateAmount(po.orderQty, po.rate);
  const decidedAt = new Date();

  // ONE TRANSACTION. The decision, the stamp, the workflow state and the
  // trail entry are a single act; a PO that reads "approved" with no trail
  // behind it - or a trail entry for an approval that failed to save - is a
  // worse thing to own than a PO that is still pending.
  await prisma.$transaction(async (tx) => {
    // approvalEngine writes workflowState AND approvalStatus in one update,
    // refusing the move if the transition table does not permit it, and
    // appends the trail entry itself.
    await engine.approve(tx, {
      documentType: 'PURCHASE_ORDER',
      documentId: id,
      actor,
      remarks: remarks ?? `Approved at ${amount.toFixed(2)}`,
      data: {
        approvedByName: actor.fullName,
        approvedById: actor.userId,
        approvedAt: decidedAt,
        decidedAt,
        rejectionReason: null,
        // Recomputed and stamped one last time, so what is approved is
        // provably qty x rate and not whatever a stale row held.
        amount,
        // An approved PO is live procurement, not a pending draft.
        status: po.status === 'PENDING' ? 'IN_PROGRESS' : po.status,
      },
    });
  });

  const updated = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: LIST_INCLUDE,
  });
  return project(updated);
}

/** Rejects the PO, with a reason. Nothing can be received against it. */
export async function reject(id, { reason }, actor) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!po) throw ApiError.notFound('Purchase order');

  if (po.approvalStatus !== 'PENDING') {
    throw ApiError.badRequest(`This PO is already ${po.approvalStatus.toLowerCase()}.`);
  }
  if (!D(po.receivedQty).isZero()) {
    throw ApiError.conflict(
      `${D(po.receivedQty).toFixed(4)} ${po.uom} has already been received against this PO. ` +
        'It cannot be rejected after the fact.',
    );
  }

  const decidedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await engine.reject(tx, {
      documentType: 'PURCHASE_ORDER',
      documentId: id,
      actor,
      reason,
      data: {
        approvedByName: actor.fullName,
        approvedById: actor.userId,
        approvedAt: null,
        decidedAt,
        rejectionReason: reason,
        status: 'CANCELLED',
      },
    });
  });

  const updated = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: LIST_INCLUDE,
  });
  return project(updated);
}

/**
 * Reopens a decided PO for a fresh decision.
 *
 * Refused once a gate pass or a GRN exists: those documents were raised on the
 * strength of this approval, and undoing it underneath them would leave goods
 * in the store with nothing authorising them.
 */
export async function reopen(id, { reason }, actor) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!po) throw ApiError.notFound('Purchase order');
  if (po.approvalStatus === 'PENDING') {
    throw ApiError.badRequest('This PO has not been decided yet.');
  }

  const usage = await downstreamUsage(id);
  if (usage.total > 0) {
    throw ApiError.conflict(
      `This PO has ${[
        usage.gatePasses ? `${usage.gatePasses} gate pass(es)` : null,
        usage.grns ? `${usage.grns} GRN(s)` : null,
      ]
        .filter(Boolean)
        .join(' and ')} raised on the strength of its approval and cannot be reopened.`,
      { usage },
    );
  }

  // Reopening does NOT go through the engine: APPROVED is terminal in the
  // transition table, deliberately, and this is the module-specific escape
  // that has just proved nothing was built on the approval. The state is
  // wound back to PENDING_APPROVAL by hand, in the same transaction as the
  // trail entry that explains why.
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.purchaseOrder.update({
      where: { id },
      data: {
        workflowState: 'PENDING_APPROVAL',
        approvalStatus: 'PENDING',
        approvedByName: null,
        approvedById: null,
        approvedAt: null,
        decidedAt: null,
        rejectionReason: null,
        status: 'PENDING',
        updatedById: actor.userId,
      },
      include: LIST_INCLUDE,
    });

    await engine.record(tx, {
      documentType: 'PURCHASE_ORDER',
      documentId: id,
      documentNo: row.poId,
      action: 'REOPENED',
      fromStatus: po.approvalStatus,
      toStatus: 'PENDING_APPROVAL',
      actor,
      remarks: reason,
    });

    return row;
  });

  return project(updated);
}

/**
 * The fulfilment status - Excel's "Status" column, which is about goods rather
 * than authority. Kept apart from approvalStatus for exactly that reason.
 */
export async function setStatus(id, status, actorId) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!po) throw ApiError.notFound('Purchase order');

  // The move itself has to be one the fulfilment table permits: a cancelled
  // PO does not go back to in-progress, and a completed one is finished.
  engine.assertStatusTransition(po.status, status, { label: `PO ${po.poId}` });

  if (status !== 'PENDING' && po.approvalStatus !== 'APPROVED') {
    throw ApiError.badRequest(
      `This PO is ${po.approvalStatus.toLowerCase()}. Its fulfilment status cannot be moved on ` +
        'until it is approved.',
    );
  }
  if (status === 'CANCELLED') {
    const usage = await downstreamUsage(id);
    if (usage.grns > 0) {
      throw ApiError.conflict(
        `${usage.grns} GRN(s) have been received against this PO; it cannot be cancelled.`,
        { usage },
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.purchaseOrder.update({
      where: { id },
      data: {
        status,
        // The fulfilment status is about GOODS, not authority, so it does not
        // move the workflow state - except a cancellation, which ends the
        // document either way.
        ...(status === 'CANCELLED' ? { workflowState: 'CANCELLED' } : {}),
        updatedById: actorId,
      },
      include: LIST_INCLUDE,
    });

    await engine.record(tx, {
      documentType: 'PURCHASE_ORDER',
      documentId: id,
      documentNo: row.poId,
      action: status === 'CANCELLED' ? 'CANCELLED' : 'SUBMITTED',
      fromStatus: po.status,
      toStatus: status,
      actor: { userId: actorId },
      remarks: `Fulfilment status moved to ${status.replace(/_/g, ' ').toLowerCase()}`,
    });

    return row;
  });

  return project(updated);
}

/** Soft delete. Refused once anything has been raised against the PO. */
export async function remove(id, actorId) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!po) throw ApiError.notFound('Purchase order');

  const usage = await downstreamUsage(id);
  if (usage.total > 0) {
    throw ApiError.conflict(
      `This PO has ${usage.gatePasses} gate pass(es) and ${usage.grns} GRN(s) against it and ` +
        'cannot be deleted.',
      { usage },
    );
  }
  if (po.approvalStatus !== 'PENDING') {
    throw ApiError.conflict(
      'A decided purchase order is the record of that decision and cannot be deleted. ' +
        'Cancel it instead.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actorId },
    });
    // The last live line takes its document with it.
    const left = await tx.purchaseOrder.count({ where: { headerId: po.headerId, deletedAt: null } });
    if (left === 0) {
      await tx.purchaseOrderHeader.update({
        where: { id: po.headerId },
        data: { deletedAt: new Date(), deletedById: actorId },
      });
    }
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
//  Helpers, previews and printing
// ---------------------------------------------------------------------------

async function recordHistory(po, action, { fromStatus, toStatus, actorId, actorName, remarks }) {
  const previous = await prisma.approvalHistory.count({
    where: { documentType: 'PURCHASE_ORDER', documentId: po.id },
  });
  await prisma.approvalHistory.create({
    data: {
      documentType: 'PURCHASE_ORDER',
      documentId: po.id,
      documentNo: po.poId,
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
 * Everything the PO form needs to know before anything is saved: the amount,
 * both ceilings, and the number the PO will be given.
 *
 * The form calls this rather than working any of it out itself, for the same
 * reason the saved values are computed here - the figure on screen and the
 * figure in the database must come from one piece of code.
 */
export async function preview(input) {
  const vendor = input.vendorId ? await resolveVendor(input.vendorId) : null;
  const order = await resolveOrder(input.orderId);
  const style = (await resolveStyle(input.styleId)) ?? order?.style ?? null;

  const line = {
    item: input.item,
    subCategory: input.subCategory ?? null,
    accessoriesItem: input.accessoriesItem ?? null,
    uom: input.uom ?? '',
  };

  const amount = calculateAmount(input.orderQty ?? 0, input.rate ?? 0);
  // C1: the preview reflects whichever mode the form currently has selected.
  // Nothing is assumed on its behalf - an unstated mode previews as
  // AS_PER_STYLE only because that is the stricter of the two, and create()
  // will still refuse to save without an explicit choice.
  const orderMode = ORDER_MODES.includes(input.orderMode) ? input.orderMode : 'AS_PER_STYLE';

  // C2: the preview resolves the SAME way create() will, so a buyer is never
  // shown one tolerance and refused by another.
  const poDate = input.poDate ? new Date(input.poDate) : new Date();
  const resolvedTolerance = input.item
    ? await toleranceMaster.resolveCategoryTolerance(null, {
        category: categoryOfLine(line),
        on: poDate,
        orderId: order?.id,
        buyerId: order?.buyerId ?? order?.buyer?.id,
        itemCategory: input.item,
      })
    : null;

  const ceiling = await quantityCeiling({
    order,
    style,
    orderMode,
    ...line,
    orderQty: input.orderQty ?? 0,
    excessAllowed: input.excessAllowed ?? 0,
    excludeId: input.excludeId,
    resolvedTolerance,
    poDate,
  });

  // C9: what the shared requirement calculation says, and - when it says
  // nothing - WHY. Surfaced on the preview so the form can refuse before the
  // user presses save rather than after.
  const requirement = requirementFor({ style, order, line, on: poDate });

  const excessAllowed = D(input.excessAllowed ?? 0);
  const excessCeiling = resolvedTolerance
    ? resolvedTolerance.orderTolerance
    : excessCeilingFor(line);

  return {
    orderQty: D(input.orderQty ?? 0).toFixed(4),
    rate: D(input.rate ?? 0).toFixed(4),
    amount: amount.toFixed(2),
    formula: 'Amount = Order Qty x Rate',
    excess: {
      allowed: excessAllowed.toFixed(6),
      allowedPct: excessAllowed.mul(100).toFixed(2),
      ceiling: excessCeiling.toFixed(6),
      ceilingPct: excessCeiling.mul(100).toFixed(2),
      withinCeiling: !excessAllowed.greaterThan(excessCeiling),
      rule:
        resolvedTolerance?.basis ??
        (isAccessoryLine(line)
          ? 'Accessories may be ordered at most 1% over requirement.'
          : 'Materials may be ordered at most 3% over requirement (sheet note: 2-3%).'),
    },
    /** C2 - the resolved category tolerance, and where it came from. */
    tolerance: resolvedTolerance
      ? {
          category: resolvedTolerance.category,
          categoryLabel: resolvedTolerance.categoryLabel,
          source: resolvedTolerance.source,
          isFallback: resolvedTolerance.isFallback,
          orderTolerancePct: resolvedTolerance.orderTolerancePct,
          receiptTolerancePct: resolvedTolerance.receiptTolerancePct,
          effectiveFrom: resolvedTolerance.effectiveFrom,
          basis: resolvedTolerance.basis,
        }
      : null,
    /** C9 - the shared requirement calculation's answer, or its refusal. */
    requirement: {
      qty: requirement.requirement ? requirement.requirement.toFixed(4) : null,
      uom: requirement.uom ?? null,
      basis: requirement.basis,
      reason: requirement.reason ?? null,
      /** An AS_PER_STYLE order cannot be saved while this is false. */
      available: requirement.requirement !== null,
      source: requirement.source ?? null,
    },
    quantity: ceiling,
    /** What the PO will be numbered, without consuming the number. */
    nextPoId: vendor?.poInitials
      ? await peekNumber('PURCHASE_ORDER', { scopeKey: vendor.poInitials.toUpperCase() })
      : null,
  };
}

/**
 * The printable purchase order.
 *
 * Assembled on the server so the printed document and the stored document are
 * the same document: every figure below is read from the row, never recomputed
 * in the browser, and the amount in words is spelled out here rather than by a
 * client-side library that might round differently.
 */
export async function printView(id) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!po) throw ApiError.notFound('Purchase order');

  const amount = D(po.amount);

  return {
    documentTitle: 'PURCHASE ORDER',
    poId: po.poId,
    poDate: po.poDate,
    orderMode: po.orderMode,
    status: po.status,
    approvalStatus: po.approvalStatus,
    /** A PO that has not been approved must not print as though it had been. */
    printable: po.approvalStatus === 'APPROVED',
    printWarning:
      po.approvalStatus === 'APPROVED'
        ? null
        : `This purchase order is ${po.approvalStatus.toLowerCase()}. It is a draft, not an ` +
          'instruction to a vendor.',
    vendor: {
      name: po.vendor.vendorName,
      code: po.vendor.vendorCode,
      /** The address as it stood when the PO was raised, not as it stands now. */
      address: po.address ?? po.vendor.address ?? null,
      pinCode: po.vendor.pinCode,
      gstNo: po.vendor.gstNo,
      contactPerson: po.vendor.contactPerson,
      phone: po.vendor.phone,
      email: po.vendor.email,
    },
    line: {
      item: po.item,
      subCategory: po.subCategory,
      accessoriesItem: po.accessoriesItem,
      accessoryType: po.accessoryType,
      size: po.size,
      description: [po.item, po.subCategory, po.accessoriesItem, po.accessoryType,
        po.size ? `Size ${po.size}` : null, po.content, po.gsm, po.count, po.colorCode]
        .filter(Boolean)
        .join(' / '),
      hsnCode: po.hsnCode,
      gsm: po.gsm,
      content: po.content,
      colorCode: po.colorCode,
      count: po.count,
      uom: po.uom,
      orderQty: D(po.orderQty).toFixed(4),
      rate: D(po.rate).toFixed(4),
      amount: amount.toFixed(2),
      excessAllowedPct: D(po.excessAllowed).mul(100).toFixed(2),
    },
    totals: {
      amount: amount.toFixed(2),
      amountInWords: amountInWords(amount),
    },
    references: {
      orderNo: po.order?.orderNo ?? null,
      buyerName: po.order?.buyer?.buyerName ?? null,
      styleNo: po.style?.styleNo ?? po.order?.style?.styleNo ?? null,
      quotationNo: po.quotation?.quotationNo ?? null,
      chain: traceability(po).chain,
    },
    approval: {
      status: po.approvalStatus,
      approvedByName: po.approvedByName,
      approvedAt: po.approvedAt,
      decidedAt: po.decidedAt,
      rejectionReason: po.rejectionReason,
    },
    // A PO raised on the multi-line form keeps its remarks on the header, one
    // raised on the single form keeps them on the line: print whichever exist.
    remarks: joinRemarks(po.header?.remarks, po.remarks),
    printedAt: new Date().toISOString(),
  };
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** Under a hundred, spelled out. */
function twoDigits(n) {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

/**
 * Rupees in words, on the Indian numbering system - crore, lakh, thousand -
 * because that is how a purchase order reads in Jaipur.
 *
 * @param {Prisma.Decimal} value
 */
export function amountInWords(value) {
  const rounded = D(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const negative = rounded.isNegative();
  const abs = negative ? rounded.negated() : rounded;

  const rupees = Number(abs.floor().toString());
  const paise = Number(abs.minus(abs.floor()).mul(100).toDecimalPlaces(0).toString());

  const words = `${negative ? 'Minus ' : ''}Rupees ${indianWords(rupees) || 'Zero'}`;
  return paise > 0 ? `${words} and ${twoDigits(paise)} Paise Only` : `${words} Only`;
}

/**
 * A whole number in words on the Indian system, '' for zero.
 *
 * The crore count is itself written with this function, because it can pass
 * 99 - 150 crore is "One Hundred Fifty Crore", and twoDigits() alone printed
 * "undefined Crore" for it.
 */
function indianWords(n) {
  const groups = [
    [Math.floor(n / 10000000), 'Crore'],
    [Math.floor((n % 10000000) / 100000), 'Lakh'],
    [Math.floor((n % 100000) / 1000), 'Thousand'],
    [Math.floor((n % 1000) / 100), 'Hundred'],
  ];

  const parts = groups
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${label === 'Crore' ? indianWords(count) : twoDigits(count)} ${label}`);

  const tail = n % 100;
  if (tail > 0) parts.push(twoDigits(tail));
  return parts.join(' ');
}

/**
 * Adds a stationery article to L_StationeryItem from the PO screen, so whoever
 * raises the PO can buy something new without holding MASTER_LIST.EDIT.
 *
 * Idempotent: an article already listed (in any letter case) is returned as it
 * is spelt there, and one withdrawn earlier is brought back - two spellings of
 * "Pen" would become two stock items with two balances.
 */
export async function addStationeryItem({ value }, actorId) {
  const list = await prisma.masterList.findFirst({ where: { code: 'StationeryItem', deletedAt: null } });
  if (!list) throw ApiError.notFound('Master list "StationeryItem"');

  const name = value.trim();
  // Every spelling, live or withdrawn: a live one must win, or a withdrawn
  // "pen" could be revived beside an active "Pen".
  const matches = await prisma.masterListValue.findMany({
    where: { listId: list.id, value: { equals: name, mode: 'insensitive' } },
  });
  const existing = matches.find((m) => !m.deletedAt) ?? matches[0];

  if (existing && !existing.deletedAt) {
    if (!existing.isActive) await masterLists.setValueActive(existing.id, true, actorId);
    return { item: STATIONERY_ITEM, value: existing.value, created: false };
  }

  const row = await masterLists.addValue(list.id, { value: existing?.value ?? name }, actorId);
  return { item: STATIONERY_ITEM, value: row.value, created: true };
}

/** Approved-PO dropdown for the Gate Pass and GRN modules. */
export async function options({ vendorId, orderId, approvedOnly, openOnly } = {}) {
  const rows = await prisma.purchaseOrder.findMany({
    where: {
      deletedAt: null,
      ...(vendorId ? { vendorId } : {}),
      ...(orderId ? { orderId } : {}),
      ...(approvedOnly ? { approvalStatus: 'APPROVED' } : {}),
      ...(openOnly ? { status: { notIn: ['CANCELLED', 'COMPLETED'] } } : {}),
    },
    orderBy: { poDate: 'desc' },
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      poId: true,
      poDate: true,
      item: true,
      subCategory: true,
      accessoriesItem: true,
      accessoryType: true,
      size: true,
      uom: true,
      orderQty: true,
      receivedQty: true,
      rate: true,
      amount: true,
      hsnCode: true,
      gsm: true,
      content: true,
      colorCode: true,
      count: true,
      excessAllowed: true,
      status: true,
      approvalStatus: true,
      address: true,
      vendor: { select: { id: true, vendorName: true, vendorCode: true, address: true } },
      order: { select: { id: true, orderNo: true } },
      // The multi-line PO the line belongs to, so a dropdown can say "PO-003".
      header: { select: { poNo: true } },
    },
  });

  // The pending quantity is what a gate pass or a GRN actually needs, so it is
  // computed once here rather than in each consuming screen.
  return rows.map((po) => {
    const pending = D(po.orderQty).minus(D(po.receivedQty));
    return { ...po, pendingQty: (pending.isNegative() ? ZERO : pending).toFixed(4) };
  });
}
