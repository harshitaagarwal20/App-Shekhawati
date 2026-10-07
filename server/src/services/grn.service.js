/**
 * GRN - Goods Receipt Note. Sheet: "GRN" - GRNFormat
 * (Role Acess - Procurement Dept (Checker)).
 *
 * ===========================================================================
 *  POSTING A GRN IS ONE TRANSACTION OR IT IS NOTHING
 * ===========================================================================
 *
 * A receipt is not one write. It is at least five, and they are only true
 * together:
 *
 *      1. the GRN itself
 *      2. the inventory item, resolved or created
 *      3. one Fabric Roll per roll received      (roll-tracked items)
 *      4. one Stock Ledger IN per roll, or one for the lot
 *      5. the stock balance, recomputed from the ledger
 *      6. the PO's running received quantity, and the gate pass it came in on
 *
 * If any of those fails - a duplicate roll number, a bill already receipted,
 * a sequence that cannot be read - `prisma.$transaction` rolls back every one
 * of them. There is no state in which a roll exists without its receipt, or
 * stock exists without a roll, or a PO shows goods received that never reached
 * the ledger. The document numbers go back too, because both `nextNumber()`
 * calls run on the same transaction client.
 *
 * This is why `create()` posts rather than drafts: a half-posted receipt is a
 * worse thing to own than no receipt at all, and `postedAt` is set inside the
 * same transaction so it can only ever be true of a receipt that completed.
 *
 * ---------------------------------------------------------------------------
 *  AND THIS IS WHY THERE IS A REVERSAL  (F-04)
 *
 *  The consequence of posting on save is that a mis-keyed receipt is in the
 *  ledger before the storeman can re-read the screen. `setStatus()` and
 *  `remove()` both refuse to touch a posted receipt and both say it is
 *  "corrected by a reversal" - and for a long time no reversal existed, so the
 *  only remedy was SQL against production.
 *
 *  services/grnReversal.service.js is that document: an approved, reasoned
 *  counter-entry that posts equal and opposite OUT movements, writes off the
 *  rolls, gives the purchase order its quantity back and stamps
 *  `grns.reversedAt`. The receipt itself is never rewritten.
 *
 *  Two things in THIS file follow from it, and are easy to miss:
 *
 *    - a reversed receipt no longer holds its vendor bill number, so the same
 *      bill can be re-keyed correctly. See the clash checks in create() and
 *      update(), and the partial unique index `grns_live_bill_per_po`.
 *
 *    - `project()` exposes `reversed`, because `workflowState` and `status`
 *      both still read as a live receipt and always will.
 *
 * ---------------------------------------------------------------------------
 *  AMOUNT AND VARIATION ARE SERVER FORMULAS
 *
 *      amount       = receivingQty x inventoryRate
 *      variationPct = (receivingQty - orderQty) / orderQty
 *
 *  Neither appears in an input schema. Both are recomputed on every write and
 *  both are backed by a CHECK constraint.
 *
 *  RECEIPT TOLERANCE  (Process Documentation s.5)
 *
 *  "A 2% excess variation is accepted on material generally, accessories may be
 *  received up to 3% in excess and no more, and payment is made on the quantity
 *  actually received."
 *
 *  A breach is recorded on the row rather than refused: the goods are physically
 *  in the yard, and a system that refuses to record them just moves the problem
 *  off the books. What the system does do is mark it, and refuse to let it pass
 *  silently.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { duplicateMaterial, lineNumber } from '../domain/documentLines.js';
import { searchFilter } from '../utils/http.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber, peekNumber } from './documentNumber.service.js';
import * as tax from './tax.service.js';
import { env } from '../config/env.js';
import * as engine from './approvalEngine.js';
import {
  DEFAULT_LOCATION,
  assertRollNoAvailable,
  createRoll,
  describeFabricName,
  describeItem,
  postMovement,
  recomputeBalance,
  resolveOrCreateItem,
} from './inventory.service.js';

export const SORTABLE = [
  'grnNo',
  'grnDate',
  'billNo',
  'item',
  'orderQty',
  'receivingQty',
  'inventoryRate',
  'amount',
  'variationPct',
  'status',
  'createdAt',
];

const SEARCH = ['grnNo', 'billNo', 'rollNo', 'item', 'hsnCode', 'remarks'];

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

/**
 * Receipt tolerance, as fractions. Process Documentation s.5.
 *
 * Held as data next to the PO's excess ceilings so the two rules - what may be
 * ORDERED over requirement, and what may be RECEIVED over the order - stay
 * visibly distinct. They are different numbers for different reasons.
 */
/**
 * C2 SUPERSEDED THIS, and it is kept for the same two reasons the purchase
 * order's EXCESS_CEILING is: it is the fallback `toleranceFor()` uses when a
 * caller hands it no frozen tolerance - the pure-function unit tests - and it
 * is what every receipt raised before C2 was actually judged by, cited by name
 * in the migration that backfilled those rows.
 *
 * NOTHING ON THE LIVE PATH READS IT. A receipt is judged by the tolerance
 * FROZEN ON ITS PURCHASE ORDER at the moment the order was raised. That is the
 * point: a PO placed in March and delivered in May is judged by March's rules,
 * whatever the master says in May.
 */
export const RECEIPT_TOLERANCE = {
  ACCESSORIES: '0.03',
  GENERAL: '0.02',
};

const INCLUDE = {
  header: { select: { id: true, grnNo: true, billNo: true, _count: { select: { lines: { where: { deletedAt: null } } } } } },
  purchaseOrder: {
    select: {
      id: true,
      poId: true,
      poDate: true,
      item: true,
      subCategory: true,
      accessoriesItem: true,
      accessoryType: true,
      uom: true,
      orderQty: true,
      receivedQty: true,
      rate: true,
      amount: true,
      excessAllowed: true,
      hsnCode: true,
      gsm: true,
      content: true,
      colorCode: true,
      count: true,
      status: true,
      approvalStatus: true,
      orderMode: true,
      vendor: { select: { id: true, vendorCode: true, vendorName: true } },
      quotation: { select: { id: true, quotationNo: true, rateQuoted: true } },
      order: {
        select: {
          id: true,
          orderNo: true,
          buyer: { select: { id: true, buyerName: true } },
          style: { select: { id: true, styleNo: true } },
        },
      },
    },
  },
  vendor: {
    select: { id: true, vendorCode: true, vendorName: true, category: true, gstNo: true, address: true },
  },
  gatePass: {
    select: {
      id: true,
      gatePassNo: true,
      gatePassDate: true,
      type: true,
      qty: true,
      receivedQty: true,
      variationPct: true,
      status: true,
    },
  },
  inventoryItem: {
    select: { id: true, itemCode: true, description: true, uom: true, isRollTracked: true },
  },
  rolls: {
    where: { deletedAt: null },
    orderBy: { rollNo: 'asc' },
    select: {
      id: true,
      rollNo: true,
      receivedQty: true,
      balanceQty: true,
      stage: true,
      location: true,
      colorCode: true,
      gsm: true,
      width: true,
      uom: true,
    },
  },
};

const LIST_INCLUDE = {
  purchaseOrder: { select: { id: true, poId: true } },
  vendor: { select: { id: true, vendorName: true } },
  gatePass: { select: { id: true, gatePassNo: true } },
  inventoryItem: { select: { id: true, itemCode: true, description: true } },
};

// ===========================================================================
//  CALCULATIONS - the single place each GRN figure is derived
// ===========================================================================

/**
 * Excel: "Amount" (Auto = Receiving Qty x Inventory Rate).
 *
 * @param {Prisma.Decimal|string|number} receivingQty
 * @param {Prisma.Decimal|string|number} inventoryRate
 * @returns {Prisma.Decimal}
 */
export function calculateAmount(receivingQty, inventoryRate) {
  return D(receivingQty).mul(D(inventoryRate)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Receipt variance against the PO quantity, as a fraction.
 * Positive means more was received than ordered.
 *
 * @returns {Prisma.Decimal}
 */
export function calculateVariation(receivingQty, orderQty) {
  const ordered = D(orderQty);
  if (ordered.isZero()) return ZERO;
  return D(receivingQty)
    .minus(ordered)
    .div(ordered)
    .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * The tolerance that applies to a receipt.
 *
 * C2: `receiptTolerancePct` - the figure frozen on the purchase order when it
 * was raised - wins whenever it is supplied, which on every live path it is.
 * The category fallback below exists only for callers with no order in hand.
 *
 * Pure. No database, so the rule can be asserted without one.
 *
 * @param {{item?: string, accessoriesItem?: string|null, receiptTolerancePct?: *, toleranceBasis?: string|null}} line
 */
export function toleranceFor({ item, accessoriesItem, receiptTolerancePct, toleranceBasis }) {
  if (receiptTolerancePct !== undefined && receiptTolerancePct !== null) {
    return {
      fraction: D(receiptTolerancePct),
      /*
       * THE RULE IS SAID IN THE OFFICE'S WORDS, NOT THE MIGRATION'S.
       *
       * This used to be `toleranceBasis ?? <the sentence below>`, and
       * `toleranceBasis` is a PROVENANCE note rather than copy - on every order
       * the C2 migration backfilled it reads "Backfilled by the C2 migration
       * from the constants in force when this order was raised
       * (purchaseOrder.service.js EXCESS_CEILING, grn.service.js
       * RECEIPT_TOLERANCE)". That is a useful thing to keep and a poor thing to
       * show a storeman who is being told his receipt is over tolerance: it
       * names two source files and answers a question he did not ask.
       *
       * So the receipt is always explained by the figure that actually applies.
       * `toleranceBasis` stays on the row and is still returned as
       * `toleranceBasisNote` for anyone auditing where the number came from.
       */
      rule:
        `Receipt tolerance ${D(receiptTolerancePct).mul(100).toDecimalPlaces(2)}%, frozen on the `
        + 'purchase order when it was raised.',
      basis: toleranceBasis ?? null,
      source: 'PURCHASE_ORDER',
    };
  }

  const accessory = item === 'Accessories' || Boolean(accessoriesItem);
  return {
    fraction: D(accessory ? RECEIPT_TOLERANCE.ACCESSORIES : RECEIPT_TOLERANCE.GENERAL),
    rule: accessory
      ? 'Accessories may be received up to 3% in excess and no more.'
      : 'A 2% excess variation is accepted on material generally.',
    basis: null,
    source: 'COMPILED_FALLBACK',
  };
}

/**
 * The whole receipt picture for one GRN, computed in one place so the preview,
 * the create path and the stored row can never disagree.
 */
export function assessReceipt({
  receivingQty,
  orderQty,
  inventoryRate,
  item,
  accessoriesItem,
  alreadyReceived,
  /** C2 - the tolerance frozen on the purchase order. Preferred over category. */
  receiptTolerancePct,
  toleranceBasis,
}) {
  const received = D(receivingQty);
  const ordered = D(orderQty);
  const priorReceipts = D(alreadyReceived ?? 0);
  const cumulative = priorReceipts.plus(received);

  const amount = calculateAmount(received, inventoryRate);
  // Variance on THIS receipt, which is what the sheet's row shows...
  const variationPct = calculateVariation(received, ordered);
  // ...and on everything received to date, which is what actually matters for
  // tolerance: three receipts of 1% each are a 3% over-delivery.
  const cumulativeVariationPct = calculateVariation(cumulative, ordered);

  const { fraction, rule, basis, source } = toleranceFor({
    item,
    accessoriesItem,
    receiptTolerancePct,
    toleranceBasis,
  });

  // C2: THE COMPARISON IS CUMULATIVE, ALWAYS.
  //
  //     SUM(everything received against this PO line)  >  poQty x (1 + tol)
  //
  // Never this receipt on its own. Three deliveries of 1% each against a 2%
  // tolerance are a 3% over-delivery, and a per-GRN test waves all three
  // through while the store fills up with material nobody ordered.
  const maxReceivableQty = ordered.mul(D(1).plus(fraction)).toDecimalPlaces(4);
  const toleranceBreached = cumulative.greaterThan(maxReceivableQty);

  return {
    receivingQty: received.toFixed(4),
    orderQty: ordered.toFixed(4),
    inventoryRate: D(inventoryRate).toFixed(4),
    amount,
    amountFormula: 'Amount = Receiving Qty x Inventory Rate',
    variationPct,
    variationPctDisplay: variationPct.mul(100).toDecimalPlaces(2).toFixed(2),
    alreadyReceived: priorReceipts.toFixed(4),
    cumulativeReceived: cumulative.toFixed(4),
    cumulativeVariationPct: cumulativeVariationPct.toFixed(6),
    cumulativeVariationPctDisplay: cumulativeVariationPct.mul(100).toDecimalPlaces(2).toFixed(2),
    outstandingQty: (() => {
      const left = ordered.minus(cumulative);
      return (left.isNegative() ? ZERO : left).toFixed(4);
    })(),
    tolerance: fraction.toFixed(6),
    tolerancePct: fraction.mul(100).toDecimalPlaces(2).toFixed(2),
    toleranceRule: rule,
    /** Where the frozen figure came from. Provenance, not screen copy. */
    toleranceBasisNote: basis,
    toleranceSource: source,
    /** poQty x (1 + tolerance) - the figure the cumulative total is tested on. */
    maxReceivableQty: maxReceivableQty.toFixed(4),
    /** How much more may still be taken before the tolerance is breached. */
    headroomQty: (() => {
      const left = maxReceivableQty.minus(cumulative);
      return (left.isNegative() ? ZERO : left).toFixed(4);
    })(),
    toleranceBreached,
    /**
     * C2 - PAYABLE QUANTITY. Payment is made on what actually arrived, not on
     * what was ordered (Process Doc s.5). This is the cumulative received
     * figure, and it is what the posting transaction writes to
     * purchase_orders.payable_qty.
     */
    payableQty: cumulative.toFixed(4),
    payableAmount: amount.toFixed(2),
  };
}

// ===========================================================================
//  VALIDATION HELPERS
// ===========================================================================

async function validateDropdowns(data) {
  if (data.uom !== undefined) await assertValueInList('UOM', data.uom, { field: 'uom' });
  if (data.location !== undefined) {
    await assertValueInList('StockLocation', data.location, { field: 'location' });
  }
}

/**
 * The purchase order a receipt is against.
 *
 * A GRN is the point where money becomes owed, so the PO behind it has to be a
 * live, approved instruction. An unapproved or cancelled PO cannot receive.
 */
async function resolvePurchaseOrder(purchaseOrderId) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, deletedAt: null },
    include: {
      vendor: true,
      order: { select: { id: true, orderNo: true } },
    },
  });
  if (!po) throw ApiError.badRequest('Purchase order does not exist', { field: 'purchaseOrderId' });

  if (po.approvalStatus !== 'APPROVED') {
    throw ApiError.conflict(
      `PO ${po.poId} is ${po.approvalStatus.toLowerCase()}. Goods cannot be received against a ` +
        'purchase order that has not been approved.',
      { field: 'purchaseOrderId', approvalStatus: po.approvalStatus },
    );
  }
  if (po.status === 'CANCELLED') {
    throw ApiError.conflict(`PO ${po.poId} is cancelled and cannot receive goods.`, {
      field: 'purchaseOrderId',
    });
  }
  return po;
}

/** The gate pass the goods physically entered on, when one is named. */
async function resolveGatePass(gatePassId, po) {
  if (!gatePassId) return null;
  const gp = await prisma.gatePass.findFirst({ where: { id: gatePassId, deletedAt: null } });
  if (!gp) throw ApiError.badRequest('Gate pass does not exist', { field: 'gatePassId' });

  if (gp.type !== 'INWARD') {
    throw ApiError.badRequest(
      `Gate pass ${gp.gatePassNo} is an outward pass. Goods are received on an inward pass.`,
      { field: 'gatePassId' },
    );
  }
  if (gp.purchaseOrderId && gp.purchaseOrderId !== po.id) {
    throw ApiError.badRequest(
      `Gate pass ${gp.gatePassNo} was raised against ${gp.linkedDocNo}, not ${po.poId}.`,
      { field: 'gatePassId' },
    );
  }
  return gp;
}

/** Counts what has been built on top of a receipt. */
async function downstreamUsage(grnId) {
  const [rolls, movements] = await Promise.all([
    prisma.fabricRoll.count({ where: { grnId, deletedAt: null } }),
    prisma.stockLedger.count({ where: { grnId } }),
  ]);
  return { rolls, movements, total: rolls + movements };
}

/**
 * A posted receipt is a stock movement, and stock movements are not edited.
 *
 * Only the descriptive fields - remarks, bill number, the fulfilment status -
 * stay open. Anything that would change a quantity or a value has to be a
 * fresh document, because the ledger behind it is append-only.
 */
function editability(grn, usage) {
  const posted = Boolean(grn.postedAt);
  return {
    canEditDetails: true,
    canEditQuantities: !posted && usage.total === 0,
    canDelete: !posted && usage.total === 0,
    posted,
    lockedBy: posted
      ? [
          `${usage.movements} stock ledger entr${usage.movements === 1 ? 'y' : 'ies'}`,
          usage.rolls > 0 ? `${usage.rolls} fabric roll(s)` : null,
        ].filter(Boolean)
      : [],
  };
}

// ===========================================================================
//  PROJECTION
// ===========================================================================

function project(grn) {
  if (!grn) return grn;
  const variation = D(grn.variationPct);
  return {
    ...grn,
    amountCalculation: `${D(grn.receivingQty).toFixed(4)} x ${D(grn.inventoryRate).toFixed(4)}`,
    variationPctDisplay: variation.mul(100).toDecimalPlaces(2).toFixed(2),
    variationDirection: variation.isZero() ? 'EXACT' : variation.isPositive() ? 'EXCESS' : 'SHORT',
    posted: Boolean(grn.postedAt),
    /*
     * F-04 - a reversed receipt is still POSTED and still COMPLETED, because
     * both are true: it WAS posted, and the goods DID arrive. Neither column
     * is rewritten, so a screen reading them alone would show a live receipt.
     * This is the flag that says otherwise, and every list and detail view
     * reads it rather than working the answer out from two state machines.
     */
    reversed: Boolean(grn.reversedAt),
  };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    purchaseOrderId, vendorId, gatePassId, itemId, purpose, status,
    dateFrom, dateTo, breachesOnly,
    headerId,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(headerId ? { headerId } : {}),
    ...(purchaseOrderId ? { purchaseOrderId } : {}),
    ...(vendorId ? { vendorId } : {}),
    ...(gatePassId ? { gatePassId } : {}),
    ...(itemId ? { inventoryItemId: itemId } : {}),
    ...(purpose ? { purpose } : {}),
    ...(status ? { status } : {}),
    ...(breachesOnly ? { toleranceBreached: true } : {}),
    ...(dateFrom || dateTo
      ? {
          grnDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total, totals] = await Promise.all([
    prisma.grn.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.grn.count({ where }),
    prisma.grn.aggregate({ where, _sum: { receivingQty: true, amount: true } }),
  ]);

  return {
    rows: rows.map(project),
    total,
    page,
    pageSize,
    totals: {
      receivingQty: D(totals._sum.receivingQty ?? 0).toFixed(4),
      amount: D(totals._sum.amount ?? 0).toFixed(2),
    },
  };
}

/** What the receipt register can sort by - columns of the header itself. */
export const DOCUMENT_SORTABLE = ['grnNo', 'grnDate', 'billNo', 'createdAt'];

/**
 * The register as the store sees it: ONE ROW PER RECEIPT DOCUMENT.
 *
 * `list()` answers per LINE, which is right for a stock enquiry tracing one
 * item - but a delivery that received three lines of the same purchase order
 * read there as three goods receipts. It is one lorry, one vendor bill, one
 * GRN number; the lines are GRN-001, GRN-001/2, GRN-001/3 and belong together.
 * This pages the headers instead, so the register counts deliveries.
 *
 * Every line-level filter still applies, as "the document has at least one
 * line that matches", and the footer totals stay line-level: they add up the
 * MATCHING LINES of the matching documents, not whole documents, so filtering
 * to one item does not silently total its siblings in the same delivery.
 */
export async function listDocuments(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    purchaseOrderId, gatePassId, itemId, purpose, status, breachesOnly,
    vendorId, dateFrom, dateTo,
  } = query;

  const lineWhere = {
    deletedAt: null,
    ...(purchaseOrderId ? { purchaseOrderId } : {}),
    ...(gatePassId ? { gatePassId } : {}),
    ...(itemId ? { inventoryItemId: itemId } : {}),
    ...(purpose ? { purpose } : {}),
    ...(status ? { status } : {}),
    ...(breachesOnly ? { toleranceBreached: true } : {}),
    ...searchFilter(search, SEARCH),
  };

  // The vendor and the date are the HEADER's own - one delivery has one of
  // each, and every line repeats them - so they filter the document directly.
  const headerWhere = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(vendorId ? { vendorId } : {}),
    ...(dateFrom || dateTo
      ? {
          grnDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
  };
  const where = { ...headerWhere, lines: { some: lineWhere } };

  const [headers, total, totals] = await Promise.all([
    prisma.grnHeader.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        vendor: { select: { id: true, vendorName: true } },
        lines: {
          where: { deletedAt: null },
          orderBy: { lineNo: 'asc' },
          include: {
            ...LIST_INCLUDE,
            /*
             * Over LIST_INCLUDE's `{ id, poId }`: the register names the PO
             * DOCUMENT (hence `headerId`), and the Item column distinguishes
             * one line of a delivery from its siblings - which for an
             * accessory is the sub-category and the trim, not the category.
             */
            purchaseOrder: {
              select: {
                id: true,
                poId: true,
                headerId: true,
                subCategory: true,
                accessoriesItem: true,
                accessoryType: true,
              },
            },
          },
        },
      },
    }),
    prisma.grnHeader.count({ where }),
    prisma.grn.aggregate({
      where: { ...lineWhere, header: headerWhere },
      _sum: { receivingQty: true, amount: true },
    }),
  ]);

  // The PO DOCUMENT each line was received against. A line names its own PO
  // line (PO-001/2); the register shows the order the vendor was given, which
  // is its header - and one delivery may well serve two orders.
  const poHeaderIds = [
    ...new Set(headers.flatMap((h) => h.lines.map((l) => l.purchaseOrder?.headerId)).filter(Boolean)),
  ];
  const poHeaders = poHeaderIds.length
    ? await prisma.purchaseOrderHeader.findMany({
        where: { id: { in: poHeaderIds } },
        select: { id: true, poNo: true },
      })
    : [];
  const poNo = new Map(poHeaders.map((h) => [h.id, h.poNo]));

  const sumOf = (rows, field, dp) =>
    rows.reduce((a, r) => a.plus(D(r[field] ?? 0)), ZERO).toFixed(dp);

  const rows = headers.map((h) => {
    const lines = h.lines.map(project);
    /*
     * F-04 again: a reversed line's stock has been taken back out, so it adds
     * nothing to the delivery's quantity or value. It stays in `lines` - it
     * happened, and the register should show that it did - but out of the
     * sums, exactly as `getDocument()` treats it.
     */
    const live = lines.filter((l) => !l.reversed);
    const uoms = [...new Set(live.map((l) => l.uom))];
    return {
      id: h.id,
      grnNo: h.grnNo,
      grnDate: h.grnDate,
      billNo: h.billNo,
      billDate: h.billDate,
      location: h.location,
      vendor: h.vendor,
      lineCount: lines.length,
      lines,
      poNos: [...new Set(lines.map((l) => poNo.get(l.purchaseOrder?.headerId)).filter(Boolean))],
      /** Quantities only add up when every line is in the same unit. */
      uom: uoms.length === 1 ? uoms[0] : null,
      orderQty: uoms.length === 1 ? sumOf(live, 'orderQty', 4) : null,
      receivingQty: uoms.length === 1 ? sumOf(live, 'receivingQty', 4) : null,
      totalAmount: sumOf(live, 'amount', 2),
      /** One line over tolerance is a delivery worth opening. */
      toleranceBreached: live.some((l) => l.toleranceBreached),
      /** A receipt is born posted, so this is only ever false mid-repair. */
      posted: live.length > 0 && live.every((l) => l.posted),
      /** Nothing of this delivery is in stock any more. */
      reversed: lines.length > 0 && live.length === 0,
      partlyReversed: live.length > 0 && live.length < lines.length,
    };
  });

  return {
    rows,
    total,
    page,
    pageSize,
    totals: {
      receivingQty: D(totals._sum.receivingQty ?? 0).toFixed(4),
      amount: D(totals._sum.amount ?? 0).toFixed(2),
    },
  };
}

export async function getById(id) {
  const grn = await prisma.grn.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!grn) throw ApiError.notFound('GRN');

  const [usage, movements, reversal] = await Promise.all([
    downstreamUsage(id),
    prisma.stockLedger.findMany({
      where: { grnId: id },
      orderBy: { createdAt: 'asc' },
      include: {
        item: { select: { id: true, itemCode: true, description: true } },
        roll: { select: { id: true, rollNo: true } },
      },
    }),
    /*
     * F-04 - the correction standing against this receipt, if any.
     *
     * The LATEST one, not the posted one: a rejected reversal is part of the
     * story too - somebody thought this receipt was wrong and the approver
     * disagreed - and the screen shows what state it reached. `deletedAt`
     * filtered because a withdrawn draft is not a fact about the receipt.
     */
    prisma.grnReversal.findFirst({
      where: { grnId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reversalNo: true,
        reversalDate: true,
        workflowState: true,
        reason: true,
        reversedQty: true,
        postedAt: true,
        approvedByName: true,
        rejectionReason: true,
      },
    }),
  ]);

  const po = grn.purchaseOrder;

  return {
    ...project(grn),
    /**
     * F-04 - the correction against this receipt, and whether one is open.
     *
     * `reversalOpen` rather than leaving the screen to work it out from the
     * workflow state: "open" means submitted, pending or approved-not-yet-
     * posted, and spelling that set out in the browser would be the same rule
     * written twice.
     */
    reversal: reversal
      ? {
          ...reversal,
          stateLabel: engine.STATE_LABEL[reversal.workflowState] ?? reversal.workflowState,
        }
      : null,
    reversalOpen: Boolean(
      reversal && !['REJECTED', 'CANCELLED', 'POSTED'].includes(reversal.workflowState),
    ),
    /** The chain this receipt sits at the end of. */
    traceability: {
      chain: [po?.order?.orderNo, po?.quotation?.quotationNo, po?.poId, grn.grnNo]
        .filter(Boolean)
        .join(' → '),
      orderNo: po?.order?.orderNo ?? null,
      buyerName: po?.order?.buyer?.buyerName ?? null,
      styleNo: po?.order?.style?.styleNo ?? null,
      quotationNo: po?.quotation?.quotationNo ?? null,
      poId: po?.poId ?? null,
      gatePassNo: grn.gatePass?.gatePassNo ?? null,
    },
    assessment: assessReceipt({
      receivingQty: grn.receivingQty,
      orderQty: grn.orderQty,
      inventoryRate: grn.inventoryRate,
      item: grn.item,
      accessoriesItem: po?.accessoriesItem ?? null,
      // Everything received on this PO other than this receipt.
      alreadyReceived: D(po?.receivedQty ?? 0).minus(D(grn.receivingQty)),
      // The receipt's OWN stored tolerance, not the order's current one - a
      // detail screen has to keep showing what this receipt was judged by.
      receiptTolerancePct: grn.receiptTolerancePct,
      toleranceBasis: po?.toleranceBasis ?? null,
    }),
    movements,
    usage,
    editable: editability(grn, usage),
  };
}

// ===========================================================================
//  THE POSTING - one transaction, or nothing
// ===========================================================================

/**
 * Posts a goods receipt.
 *
 * Everything below happens on one transaction client. A failure anywhere -
 * a duplicate roll number in the middle of a five-roll delivery, a bill number
 * already receipted against this PO, an inactive inventory item - unwinds the
 * whole receipt, including the GRN number, the roll numbers and the item code,
 * because the sequences are incremented on the same client.
 *
 * @param {object} input
 * @param {{userId: string, fullName: string}} actor
 */
export async function create(input, actor) {
  // A single receipt is a one-line document, numbered exactly as it always was.
  const { lineIds } = await createDocumentInternal(
    {
      grnNo: input.grnNo,
      grnDate: input.grnDate,
      billNo: input.billNo,
      location: input.location,
      lines: [input],
    },
    actor,
  );
  return getById(lineIds[0]);
}

/**
 * MULTI-LINE: one delivery, one vendor bill, several PO lines received.
 *
 * Each line is exactly what a single GRN always was - its own PO line, its
 * own cumulative tolerance judgement, its own rolls and ledger IN - and the
 * whole receipt posts in ONE transaction: the lorry is booked in whole, or
 * not at all.
 */
export async function createDocument(input, actor) {
  const { header } = await createDocumentInternal(input, actor);
  return getDocument(header.id);
}

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

async function createDocumentInternal(input, actor) {
  if (!input.lines?.length) {
    throw ApiError.badRequest('A receipt needs at least one line', { field: 'lines' });
  }
  const dup = duplicateMaterial(input.lines, (l) => l.purchaseOrderId);
  if (dup) {
    throw ApiError.badRequest(
      `Lines ${dup.first + 1} and ${dup.second + 1} receive against the same PO line. Combine them.`,
      { field: `lines.${dup.second}.purchaseOrderId` },
    );
  }

  // What is true of the whole delivery, handed to every line that does not
  // say otherwise.
  const common = defined({
    grnDate: input.grnDate,
    billNo: input.billNo,
    location: input.location,
    purpose: input.purpose,
    gstRatePct: input.gstRatePct,
    acknowledgeToleranceBreach: input.acknowledgeToleranceBreach,
  });
  const lines = input.lines.map((l) => ({ ...common, ...defined(l) }));

  // A gate pass named on the document belongs to the line it was raised
  // against - or the first line, if it was never allocated to a PO.
  if (input.gatePassId && !lines.some((l) => l.gatePassId)) {
    const gp = await prisma.gatePass.findFirst({
      where: { id: input.gatePassId, deletedAt: null },
      select: { purchaseOrderId: true },
    });
    const i = lines.findIndex((l) => l.purchaseOrderId === gp?.purchaseOrderId);
    lines[i >= 0 ? i : 0].gatePassId = input.gatePassId;
  }

  const prepared = [];
  for (const [i, line] of lines.entries()) {
    try {
      prepared.push(await prepareLine(line));
    } catch (err) {
      if (lines.length > 1 && err?.message) err.message = `Line ${i + 1}: ${err.message}`;
      throw err;
    }
  }

  const vendorId = prepared[0].po.vendorId;
  const other = prepared.find((p) => p.po.vendorId !== vendorId);
  if (other) {
    throw ApiError.badRequest(
      `PO ${other.po.poId} is from a different vendor. One receipt is one vendor's delivery.`,
      { field: 'lines' },
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const grnNo = input.grnNo?.trim() || (await nextNumber('GRN', { tx }));
      const headerClash = await tx.grnHeader.findUnique({ where: { grnNo }, select: { id: true } });
      if (headerClash) throw ApiError.conflict('This GRN number already exists', { field: 'grnNo' });

      const header = await tx.grnHeader.create({
        data: {
          grnNo,
          grnDate: input.grnDate ? new Date(input.grnDate) : new Date(),
          vendorId,
          billNo: String(input.billNo ?? lines[0].billNo).trim(),
          billDate: input.billDate ? new Date(input.billDate) : null,
          location: input.location ?? prepared[0].location,
          remarks: input.headerRemarks ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });

      const lineIds = [];
      for (const [i, ctx] of prepared.entries()) {
        lineIds.push(await writeLine(tx, ctx, { header, lineNo: i + 1 }, actor));
      }
      return { header, lineIds };
    },
    // See the F-09 note in writeLine: a roll-tracked line is many writes.
    { timeout: 30_000 + 15_000 * (prepared.length - 1), maxWait: 10_000 },
  );
}

/** Every check a receipt line makes before anything is written. */
async function prepareLine(input) {
  await validateDropdowns(input);

  const po = await resolvePurchaseOrder(input.purchaseOrderId);
  const gatePass = await resolveGatePass(input.gatePassId, po);

  // A bill is receipted once. The unique index on (purchase_order_id, bill_no)
  // is the guarantee; this is the message.
  const billClash = await prisma.grn.findFirst({
    /*
     * F-04: a REVERSED receipt does not hold its bill number.
     *
     * The whole point of a reversal is that the storeman then keys the receipt
     * again, correctly, against the same vendor bill. Counting the reversed
     * one here would undo the stock and then block the correction, which is
     * worse than not having a reversal at all.
     *
     * Matched by the partial unique index `grns_live_bill_per_po`, so the rule
     * holds at the database too. This check exists to turn that constraint
     * into a sentence naming the receipt that already has the bill.
     */
    where: {
      purchaseOrderId: po.id,
      billNo: input.billNo.trim(),
      deletedAt: null,
      reversedAt: null,
    },
    select: { grnNo: true, grnDate: true },
  });
  if (billClash) {
    throw ApiError.conflict(
      `Bill ${input.billNo} has already been received against ${po.poId} on ${billClash.grnNo}.`,
      { field: 'billNo', existingGrnNo: billClash.grnNo },
    );
  }

  const receivingQty = D(input.receivingQty);
  if (!receivingQty.greaterThan(0)) {
    throw ApiError.badRequest('Receiving quantity must be greater than zero', {
      field: 'receivingQty',
    });
  }

  // Excel: "Inventory Rate" (Formula). The PO rate is what was agreed, so it is
  // the default; a store may value the receipt differently (freight, a short
  // shipment settled at a different price) and that is a deliberate override.
  const inventoryRate =
    input.inventoryRate !== undefined && input.inventoryRate !== null
      ? D(input.inventoryRate)
      : D(po.rate);

  const assessment = assessReceipt({
    receivingQty,
    orderQty: po.orderQty,
    inventoryRate,
    item: po.item,
    accessoriesItem: po.accessoriesItem,
    alreadyReceived: po.receivedQty,
    // C2: the tolerance FROZEN ON THE ORDER, not one re-resolved today. A PO
    // placed in March and delivered in May is judged by March's rules.
    receiptTolerancePct: po.receiptTolerancePct,
    toleranceBasis: po.toleranceBasis,
  });

  // The vendor's bill carries GST. The rate is chosen by whoever keys the
  // receipt - from the "GST Rate" master list, never defaulted here - and the
  // CGST/SGST vs IGST split falls out of the vendor's own GSTIN.
  const gstRatePct = await tax.resolveRate(input.gstRatePct);
  const supply = tax.resolveSupplyType(po.vendor?.gstNo, env.COMPANY_STATE_CODE);
  const gst = gstRatePct
    ? tax.calculateGst({
        taxableValue: assessment.amount,
        gstRatePct,
        supplyType: supply.supplyType,
      })
    : null;

  // A breach is recorded, not refused - the goods are in the yard either way -
  // unless the caller has not been told about it. `acknowledgeToleranceBreach`
  // makes the checker say, in the request, that they know.
  if (assessment.toleranceBreached && !input.acknowledgeToleranceBreach) {
    throw ApiError.conflict(
      `Receiving ${receivingQty.toFixed(4)} ${po.uom} takes the total received on ${po.poId} to ` +
        `${assessment.cumulativeReceived} against an order of ${assessment.orderQty} - ` +
        `${assessment.cumulativeVariationPctDisplay}% over. ${assessment.toleranceRule} ` +
        'Confirm the over-receipt to record it anyway.',
      { field: 'receivingQty', assessment, requiresAcknowledgement: true },
    );
  }

  const location = input.location ?? DEFAULT_LOCATION;
  const rollsIn = normaliseRolls(input, receivingQty, po);

  // Roll numbers are checked before the transaction as well as inside it, so a
  // five-roll delivery fails on the typo rather than halfway through the write.
  for (const roll of rollsIn) {
    if (roll.rollNo) await assertRollNoAvailable(prisma, roll.rollNo);
  }

  return { input, po, gatePass, receivingQty, inventoryRate, assessment, gst, location, rollsIn };
}

/**
 * Writes one prepared receipt line on the caller's transaction: the stock
 * item, the GRN row, its rolls and ledger INs, the PO totals, the gate pass,
 * and the trail entry.
 *
 * F-09 - a roll-tracked fabric receipt writes a roll and a ledger movement
 * PER ROLL, sequentially, which is why the caller gives the transaction an
 * explicit time budget rather than Prisma's five-second default.
 */
async function writeLine(tx, ctx, { header, lineNo }, actor) {
  const { input, po, gatePass, receivingQty, inventoryRate, assessment, gst, location, rollsIn } = ctx;
    // 1. The item this receipt stocks. Created on first purchase.
    const { item } = await resolveOrCreateItem(
      tx,
      {
        item: po.item,
        subCategory: po.subCategory,
        accessoriesItem: po.accessoriesItem,
        accessoryType: po.accessoryType,
        colorCode: po.colorCode,
        gsm: po.gsm,
        count: po.count,
        content: po.content,
        uom: po.uom,
        hsnCode: input.hsnCode ?? po.hsnCode,
      },
      actor.userId,
    );

    // 2. The GRN. Posted immediately - see the note at the top of this file.
    // Multi-line: line 1 carries the receipt number bare, later lines "/n".
    const grnNo = lineNumber(header.grnNo, lineNo);
    const clash = await tx.grn.findUnique({ where: { grnNo }, select: { id: true } });
    if (clash) throw ApiError.conflict('This GRN number already exists', { field: 'grnNo' });

    const postedAt = new Date();
    const grn = await tx.grn.create({
      data: {
        grnNo,
        headerId: header.id,
        lineNo,
        purchaseOrderId: po.id,
        billNo: input.billNo.trim(),
        rollNo: rollsIn.length === 1 ? (rollsIn[0].rollNo ?? null) : null,
        grnDate: input.grnDate ? new Date(input.grnDate) : new Date(),
        purpose: input.purpose,
        item: po.item,
        hsnCode: input.hsnCode ?? po.hsnCode ?? null,
        vendorId: po.vendorId,
        uom: po.uom,
        orderQty: D(po.orderQty),
        receivingQty,
        inventoryRate,
        amount: assessment.amount,
        variationPct: assessment.variationPct,
        toleranceBreached: assessment.toleranceBreached,
        // C2: what this receipt was judged by and where it left the order.
        // Stored rather than recomputed on read, so the decision stays
        // auditable after a sibling receipt is soft-deleted underneath it.
        category: po.category,
        receiptTolerancePct: D(po.receiptTolerancePct),
        cumulativeReceivedQty: D(assessment.cumulativeReceived),
        cumulativeVariationPct: D(assessment.cumulativeVariationPct),
        // GST as charged on the vendor's bill. All null / zero when no rate was
        // given, which is what a receipt from an unregistered vendor looks like.
        gstRatePct: gst ? gst.gstRatePct : null,
        supplyType: gst ? gst.supplyType : null,
        vendorGstin: gst ? (po.vendor?.gstNo ?? null) : null,
        cgstAmount: gst ? gst.cgstAmount : 0,
        sgstAmount: gst ? gst.sgstAmount : 0,
        igstAmount: gst ? gst.igstAmount : 0,
        invoiceTotal: gst ? gst.invoiceTotal : null,
        status: 'COMPLETED',
        // A receipt is born posted. It is written and posted in one
        // transaction - there is no draft GRN sitting between the goods
        // arriving and the stock existing - so it opens in POSTED rather than
        // in DRAFT and then moving. The approval entry below records the act.
        workflowState: 'POSTED',
        remarks: input.remarks ?? null,
        location,
        inventoryItemId: item.id,
        gatePassId: gatePass?.id ?? null,
        postedAt,
        postedById: actor.userId,
        postedByName: actor.fullName,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });

    // 3 and 4. Rolls, and one ledger IN per roll. A roll-tracked item receives
    //          roll by roll; anything else receives as a single lot.
    const snapshot = {
      itemCategory: item.itemCategory,
      colorCode: po.colorCode,
      gsm: po.gsm,
      content: po.content,
      uom: po.uom,
    };

    const createdRolls = [];
    if (item.isRollTracked) {
      for (const spec of rollsIn) {
        const roll = await createRoll(
          tx,
          {
            rollNo: spec.rollNo,
            grnId: grn.id,
            vendorId: po.vendorId,
            inventoryItemId: item.id,
            fabricName: spec.fabricName ?? describeFabricName({ ...po, itemCategory: po.item }),
            colorCode: po.colorCode,
            content: po.content,
            count: po.count,
            construction: spec.construction ?? null,
            width: spec.width ?? null,
            gsm: po.gsm,
            uom: po.uom,
            qty: spec.qty,
            rate: inventoryRate,
            location,
            shade: spec.shade ?? null,
            dyeLot: spec.dyeLot ?? null,
            shadeMarkedByName: spec.shade || spec.dyeLot ? actor.fullName ?? null : null,
            remarks: spec.remarks ?? null,
          },
          actor.userId,
        );
        createdRolls.push(roll);

        await postMovement(tx, {
          itemId: item.id,
          rollId: roll.id,
          direction: 'IN',
          // F-09: every roll on this receipt is the same item at the same
          // location, so the balance is recomputed ONCE after the loop rather
          // than once per roll. See below the loop.
          deferBalance: true,
          qty: spec.qty,
          rate: inventoryRate,
          entryDate: grn.grnDate,
          location,
          documentType: 'GRN',
          documentId: grn.id,
          documentNo: grn.grnNo,
          orderId: po.orderId,
          grnId: grn.id,
          snapshot,
          remarks: `Receipt of roll ${roll.rollNo} against PO ${po.poId}, bill ${grn.billNo}`,
          actor,
        });
      }

      /*
       * F-09 - the one balance refresh the loop above deferred.
       *
       * Inside the same transaction, so a reader never sees a balance that
       * lags the ledger it is derived from. Skipping this would leave the
       * cache short by the whole receipt.
       */
      await recomputeBalance(tx, item.id, location);
    } else {
      await postMovement(tx, {
        itemId: item.id,
        direction: 'IN',
        qty: receivingQty,
        rate: inventoryRate,
        entryDate: grn.grnDate,
        location,
        documentType: 'GRN',
        documentId: grn.id,
        documentNo: grn.grnNo,
        orderId: po.orderId,
        grnId: grn.id,
        snapshot,
        remarks: `Receipt against PO ${po.poId}, bill ${grn.billNo}`,
        actor,
      });
    }

    // 6. The PO's running total, its payable quantity, and its status.
    //
    //    C2: payableQty is the quantity ACTUALLY RECEIVED. It is written from
    //    the same cumulative figure the tolerance was judged on, inside this
    //    transaction, so a receipt that rolls back takes the payable figure
    //    back with it. Nothing else in this application writes it, and nothing
    //    at all spends it - there is no payment module.
    const cumulative = D(po.receivedQty).plus(receivingQty);
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        receivedQty: cumulative,
        payableQty: cumulative,
        // C2: an over-tolerance receipt that the checker explicitly accepted.
        // Recorded on the order so the database ceiling can defer to the
        // decision instead of refusing a delivery the business took.
        ...(assessment.toleranceBreached ? { receiptBreachAcknowledged: true } : {}),
        status: cumulative.greaterThanOrEqualTo(D(po.orderQty)) ? 'COMPLETED' : 'IN_PROGRESS',
        updatedById: actor.userId,
      },
    });

    // The gate pass the goods came in on is closed off by the receipt, if the
    // checker had not already cleared it at the gate.
    if (gatePass && gatePass.status !== 'CLEARED') {
      await tx.gatePass.update({
        where: { id: gatePass.id },
        data: {
          // What the gate pass admitted is what the receipt booked.
          receivedQty: receivingQty,
          variationPct: D(gatePass.qty).isZero()
            ? ZERO
            : D(gatePass.qty)
                .minus(receivingQty)
                .div(D(gatePass.qty))
                .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP),
          status: 'CLEARED',
          clearedAt: postedAt,
          clearedById: actor.userId,
          clearedByName: actor.fullName,
          updatedById: actor.userId,
        },
      });
    }

    await tx.approvalHistory.create({
      data: {
        documentType: 'GRN',
        documentId: grn.id,
        documentNo: grn.grnNo,
        sequenceNo: 1,
        // A receipt has no approval step. Posting it is the act, and POSTED is
        // the word for that - not SUBMITTED, which would tell a reader it was
        // waiting on somebody.
        action: 'POSTED',
        toStatus: 'POSTED',
        actedByName: actor.fullName,
        actedById: actor.userId,
        remarks:
          `Received ${receivingQty.toFixed(4)} ${po.uom} at ${inventoryRate.toFixed(4)} ` +
          `= ${assessment.amount.toFixed(2)} into ${location}` +
          (createdRolls.length ? `, as ${createdRolls.length} roll(s)` : '') +
          (assessment.toleranceBreached
            ? ` - OVER TOLERANCE at ${assessment.cumulativeVariationPctDisplay}%`
            : ''),
      },
    });

    return grn.id;
}

// ---------------------------------------------------------------------------
//  THE DOCUMENT - one delivery, one bill
// ---------------------------------------------------------------------------

export async function getDocument(headerId) {
  const header = await prisma.grnHeader.findFirst({
    where: { id: headerId, deletedAt: null },
    include: {
      vendor: { select: { id: true, vendorCode: true, vendorName: true, gstNo: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: 'asc' },
        include: {
          purchaseOrder: { select: { id: true, poId: true, headerId: true, subCategory: true, accessoriesItem: true, accessoryType: true, colorCode: true } },
          _count: { select: { rolls: true } },
        },
      },
    },
  });
  if (!header) throw ApiError.notFound('GRN');
  const lines = header.lines.map(project);
  const live = lines.filter((l) => !l.reversed);
  const sum = (f) => live.reduce((a, l) => a.plus(D(l[f] ?? 0)), ZERO).toFixed(2);
  return {
    ...header,
    lines,
    lineCount: lines.length,
    totalAmount: sum('amount'),
    totalCgst: sum('cgstAmount'),
    totalSgst: sum('sgstAmount'),
    totalIgst: sum('igstAmount'),
    invoiceTotal: live.every((l) => l.invoiceTotal != null) ? sum('invoiceTotal') : null,
    rollCount: header.lines.reduce((a, l) => a + (l._count?.rolls ?? 0), 0),
  };
}

/**
 * Works out what rolls this receipt creates.
 *
 * Three shapes are accepted, in decreasing order of how much the store knows:
 *   - an explicit list of rolls with their own numbers and quantities;
 *   - a single roll number for the whole receipt (the sheet's "Roll No");
 *   - nothing at all, in which case one roll is created and numbered FAB-nnn.
 *
 * The quantities must add up. A five-roll delivery whose rolls sum to something
 * other than the receiving quantity is a counting error, and letting it through
 * would put stock in the ledger that no roll accounts for.
 */
function normaliseRolls(input, receivingQty, po) {
  if (Array.isArray(input.rolls) && input.rolls.length > 0) {
    const total = input.rolls.reduce((a, r) => a.plus(D(r.qty)), ZERO);
    if (!total.equals(receivingQty)) {
      throw ApiError.badRequest(
        `The ${input.rolls.length} roll(s) listed add up to ${total.toFixed(4)} ${po.uom}, ` +
          `but the receipt is for ${receivingQty.toFixed(4)}.`,
        { field: 'rolls', rollTotal: total.toFixed(4), receivingQty: receivingQty.toFixed(4) },
      );
    }
    for (const r of input.rolls) {
      if (!D(r.qty).greaterThan(0)) {
        throw ApiError.badRequest('Every roll must have a quantity greater than zero', {
          field: 'rolls',
        });
      }
    }
    const numbered = input.rolls.filter((r) => r.rollNo).map((r) => r.rollNo.trim());
    const duplicated = numbered.find((n, i) => numbered.indexOf(n) !== i);
    if (duplicated) {
      throw ApiError.badRequest(
        `Roll number ${duplicated} appears twice in this receipt.`,
        { field: 'rolls' },
      );
    }
    return input.rolls.map((r) => ({
      rollNo: r.rollNo?.trim() || null,
      qty: D(r.qty),
      width: r.width ?? null,
      construction: r.construction ?? null,
      fabricName: r.fabricName ?? null,
      shade: r.shade ?? null,
      dyeLot: r.dyeLot ?? null,
      remarks: r.remarks ?? null,
    }));
  }

  return [
    {
      rollNo: input.rollNo?.trim() || null,
      qty: receivingQty,
      width: null,
      construction: null,
      fabricName: null,
      remarks: null,
    },
  ];
}

/**
 * Edits the descriptive part of a receipt.
 *
 * Quantities, rates and the item are deliberately absent. They are already in
 * the stock ledger, which is append-only; changing them here would leave the
 * receipt saying one thing and the ledger another. A receipt entered wrongly is
 * corrected by a reversal, not by editing history.
 */
export async function update(id, input, actorId) {
  const grn = await prisma.grn.findFirst({ where: { id, deletedAt: null } });
  if (!grn) throw ApiError.notFound('GRN');

  if (input.billNo !== undefined && input.billNo.trim() !== grn.billNo) {
    const clash = await prisma.grn.findFirst({
      where: {
        purchaseOrderId: grn.purchaseOrderId,
        billNo: input.billNo.trim(),
        id: { not: id },
        deletedAt: null,
        // F-04: a reversed receipt has given its bill number back. See create().
        reversedAt: null,
      },
      select: { grnNo: true },
    });
    if (clash) {
      throw ApiError.conflict(
        `Bill ${input.billNo} is already receipted on ${clash.grnNo}.`,
        { field: 'billNo' },
      );
    }
  }

  const updated = await prisma.grn.update({
    where: { id },
    data: {
      ...(input.billNo !== undefined ? { billNo: input.billNo.trim() } : {}),
      ...(input.grnDate !== undefined ? { grnDate: new Date(input.grnDate) } : {}),
      ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
      ...(input.hsnCode !== undefined ? { hsnCode: input.hsnCode } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  return project(updated);
}

/**
 * Moves a receipt's fulfilment status.
 *
 * Its own endpoint rather than a field on update(), because a status change
 * is a controlled transition: the table decides what may follow what, and a
 * screen cannot set an arbitrary value. Cancelling a posted receipt is
 * refused outright - the stock is in the ledger and the ledger is append-only.
 */
export async function setStatus(id, { status, remarks }, actorId) {
  const grn = await prisma.grn.findFirst({ where: { id, deletedAt: null } });
  if (!grn) throw ApiError.notFound('GRN');

  engine.assertStatusTransition(grn.status, status, { label: `GRN ${grn.grnNo}` });

  if (status === 'CANCELLED' && grn.postedAt) {
    /*
     * F-04 - THIS MESSAGE NOW NAMES SOMETHING THAT EXISTS.
     *
     * It said "corrected by a reversal" for months while there was no reversal
     * anywhere in the codebase, which left the user reading an instruction
     * they could not follow. There is one now, and the message says where.
     */
    throw ApiError.conflict(
      `${grn.grnNo} is posted to stock and cannot be cancelled. A posted receipt is ` +
        'corrected by a reversal, not by a status change: raise one against this receipt, ' +
        'give the reason, and have it approved. The reversal takes the goods back out of ' +
        'stock and returns the quantity to the purchase order.',
      { grnNo: grn.grnNo, remedy: 'GRN_REVERSAL', reversalPath: `/grn-reversals` },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.grn.update({
      where: { id },
      data: {
        status,
        ...(status === 'CANCELLED' ? { workflowState: 'CANCELLED' } : {}),
        ...(remarks !== undefined ? { remarks } : {}),
        updatedById: actorId,
      },
      include: LIST_INCLUDE,
    });

    await engine.record(tx, {
      documentType: 'GRN',
      documentId: id,
      documentNo: row.grnNo,
      action: status === 'CANCELLED' ? 'CANCELLED' : 'SUBMITTED',
      fromStatus: grn.status,
      toStatus: status,
      actor: { userId: actorId },
      remarks: remarks ?? `Fulfilment status moved to ${status.replace(/_/g, ' ').toLowerCase()}`,
    });

    return row;
  });

  return project(updated);
}

/**
 * Deletes a receipt that never reached stock.
 *
 * A posted GRN cannot be deleted, and there is no soft-delete escape hatch for
 * one either: its ledger entries are the stock, and hiding the document while
 * leaving the movements would make the balance unexplainable. In practice this
 * path only ever applies to a receipt whose posting failed, which by definition
 * rolled back and never existed.
 */
export async function remove(id, actorId) {
  const grn = await prisma.grn.findFirst({ where: { id, deletedAt: null } });
  if (!grn) throw ApiError.notFound('GRN');

  const usage = await downstreamUsage(id);
  if (grn.postedAt || usage.total > 0) {
    /* F-04 - as in setStatus() above: the named remedy now exists. */
    throw ApiError.conflict(
      `GRN ${grn.grnNo} is posted to stock: ${usage.movements} ledger entr` +
        `${usage.movements === 1 ? 'y' : 'ies'}` +
        (usage.rolls ? ` and ${usage.rolls} fabric roll(s)` : '') +
        ' depend on it. A posted receipt is corrected by a reversal, not by deletion: ' +
        'raise one against this receipt and have it approved.',
      { usage, postedAt: grn.postedAt, remedy: 'GRN_REVERSAL' },
    );
  }

  await prisma.grn.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId },
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
//  Previews and printing
// ---------------------------------------------------------------------------

/**
 * What the GRN form needs before anything is saved: the PO's own figures, the
 * amount, the variance, the tolerance it is measured against, and the number
 * the receipt will be given.
 *
 * The form asks for all of it rather than working any of it out, so what the
 * checker sees on screen is what the posting will write.
 */
export async function preview({ purchaseOrderId, receivingQty, inventoryRate }) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, deletedAt: null },
    include: {
      vendor: { select: { id: true, vendorName: true, vendorCode: true } },
      order: { select: { id: true, orderNo: true } },
      quotation: { select: { id: true, quotationNo: true, rateQuoted: true } },
    },
  });
  if (!po) throw ApiError.notFound('Purchase order');

  const rate =
    inventoryRate !== undefined && inventoryRate !== null ? D(inventoryRate) : D(po.rate);

  const assessment = assessReceipt({
    receivingQty: receivingQty ?? 0,
    orderQty: po.orderQty,
    inventoryRate: rate,
    item: po.item,
    accessoriesItem: po.accessoriesItem,
    alreadyReceived: po.receivedQty,
    // C2: the preview is judged by exactly what create() will judge by, so a
    // store keeper is never shown a headroom the posting then refuses.
    receiptTolerancePct: po.receiptTolerancePct,
    toleranceBasis: po.toleranceBasis,
  });

  return {
    purchaseOrder: {
      id: po.id,
      poId: po.poId,
      item: po.item,
      subCategory: po.subCategory,
      accessoriesItem: po.accessoriesItem,
      accessoryType: po.accessoryType,
      uom: po.uom,
      orderQty: D(po.orderQty).toFixed(4),
      receivedQty: D(po.receivedQty).toFixed(4),
      // C2 - what is payable so far, and what the order may still take.
      payableQty: D(po.payableQty ?? 0).toFixed(4),
      category: po.category,
      receiptTolerancePct: D(po.receiptTolerancePct).toFixed(6),
      receiptTolerancePctDisplay: D(po.receiptTolerancePct).mul(100).toDecimalPlaces(2).toFixed(2),
      rate: D(po.rate).toFixed(4),
      hsnCode: po.hsnCode,
      gsm: po.gsm,
      content: po.content,
      colorCode: po.colorCode,
      count: po.count,
      approvalStatus: po.approvalStatus,
      vendorName: po.vendor.vendorName,
      orderNo: po.order?.orderNo ?? null,
      quotationNo: po.quotation?.quotationNo ?? null,
    },
    ...assessment,
    amount: assessment.amount.toFixed(2),
    variationPct: assessment.variationPct.toFixed(6),
    /** The stock item this will land on, if it already exists. */
    item: await previewItem(po),
    isRollTracked: po.item === 'Fabric',
    nextGrnNo: await peekNumber('GRN'),
    nextRollNo: po.item === 'Fabric' ? await peekNumber('FABRIC_ROLL') : null,
  };
}

/** The existing stock item a receipt would land on, if the company has one. */
async function previewItem(po) {
  const existing = await prisma.inventoryItem.findUnique({
    where: {
      inventory_item_identity: {
        itemCategory: po.item,
        subCategory: po.subCategory ?? '',
        accessoriesItem: po.accessoriesItem ?? '',
        accessoryType: po.accessoryType ?? '',
        colorCode: po.colorCode ?? '',
        gsm: po.gsm ?? '',
        count: po.count ?? '',
        uom: po.uom,
      },
    },
    include: { balances: { select: { location: true, qty: true } } },
  });
  if (existing) {
    return {
      exists: true,
      id: existing.id,
      itemCode: existing.itemCode,
      description: existing.description,
      isRollTracked: existing.isRollTracked,
      balances: existing.balances,
    };
  }
  return {
    exists: false,
    itemCode: await peekNumber('INVENTORY_ITEM'),
    description: describeItem({ ...po, itemCategory: po.item }),
    isRollTracked: po.item === 'Fabric',
    balances: [],
    note: 'This is the first receipt of this item - a stock item will be created for it.',
  };
}

/** The printable goods receipt note. */
export async function printView(id) {
  const grn = await prisma.grn.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!grn) throw ApiError.notFound('GRN');

  const po = grn.purchaseOrder;
  const variation = D(grn.variationPct);

  return {
    documentTitle: 'GOODS RECEIPT NOTE',
    grnNo: grn.grnNo,
    grnDate: grn.grnDate,
    billNo: grn.billNo,
    purpose: grn.purpose,
    status: grn.status,
    posted: Boolean(grn.postedAt),
    postedAt: grn.postedAt,
    postedByName: grn.postedByName,
    vendor: {
      name: grn.vendor.vendorName,
      code: grn.vendor.vendorCode,
      address: grn.vendor.address,
      gstNo: grn.vendor.gstNo,
    },
    line: {
      item: grn.item,
      description: grn.inventoryItem?.description ?? grn.item,
      itemCode: grn.inventoryItem?.itemCode ?? null,
      hsnCode: grn.hsnCode,
      uom: grn.uom,
      orderQty: D(grn.orderQty).toFixed(4),
      receivingQty: D(grn.receivingQty).toFixed(4),
      inventoryRate: D(grn.inventoryRate).toFixed(4),
      amount: D(grn.amount).toFixed(2),
      variationPct: variation.toFixed(6),
      variationPctDisplay: variation.mul(100).toDecimalPlaces(2).toFixed(2),
      toleranceBreached: grn.toleranceBreached,
    },
    rolls: grn.rolls.map((r) => ({
      rollNo: r.rollNo,
      receivedQty: D(r.receivedQty).toFixed(4),
      uom: r.uom,
      colorCode: r.colorCode,
      gsm: r.gsm,
      width: r.width,
      location: r.location,
    })),
    location: grn.location,
    references: {
      poId: po?.poId ?? null,
      poDate: po?.poDate ?? null,
      orderNo: po?.order?.orderNo ?? null,
      buyerName: po?.order?.buyer?.buyerName ?? null,
      styleNo: po?.order?.style?.styleNo ?? null,
      quotationNo: po?.quotation?.quotationNo ?? null,
      gatePassNo: grn.gatePass?.gatePassNo ?? null,
      chain: [po?.order?.orderNo, po?.quotation?.quotationNo, po?.poId, grn.grnNo]
        .filter(Boolean)
        .join(' → '),
    },
    remarks: grn.remarks,
    signatures: ['Received By', 'Checked By', 'Store Manager'],
    printedAt: new Date().toISOString(),
  };
}

/**
 * The purchase invoice.
 *
 * =========================================================================
 *  A DIFFERENT DOCUMENT FROM THE GOODS RECEIPT NOTE
 * =========================================================================
 *
 *  The GRN says what arrived. The invoice says what it cost, including the tax
 *  the vendor charged. They come from the same row because in this business
 *  they describe the same event - but they are read by different people for
 *  different reasons, so they are two documents.
 *
 *  The invoice number is the VENDOR'S bill number. This system does not issue
 *  one: the invoice is the vendor's, and inventing a number for it would put a
 *  reference on paper that appears in nobody else's books.
 *
 *  Everything is read back from the stored row rather than recomputed. The
 *  receipt is immutable once posted, so the invoice reprinted next year shows
 *  what was charged - not what today's rates and today's vendor master would
 *  produce.
 * -------------------------------------------------------------------------
 */
export async function invoiceView(id) {
  const grn = await prisma.grn.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!grn) throw ApiError.notFound('GRN');

  const po = grn.purchaseOrder;
  const taxable = D(grn.amount);
  const cgst = D(grn.cgstAmount);
  const sgst = D(grn.sgstAmount);
  const igst = D(grn.igstAmount);
  const totalTax = cgst.plus(sgst).plus(igst);
  const rate = grn.gstRatePct === null ? null : D(grn.gstRatePct);
  const total = grn.invoiceTotal === null ? taxable : D(grn.invoiceTotal);

  // Said plainly on the page rather than left as an empty tax block. A reader
  // must not have to work out whether the tax is zero or simply missing.
  const taxRecorded = rate !== null;

  return {
    documentTitle: 'PURCHASE INVOICE',
    /** The vendor's bill is the invoice. */
    invoiceNo: grn.billNo,
    invoiceDate: grn.grnDate,
    grnNo: grn.grnNo,
    status: grn.status,
    posted: Boolean(grn.postedAt),
    postedAt: grn.postedAt,

    // A receipt that has not been posted has not brought anything into stock,
    // so its invoice is not a document anybody should be paying against.
    printable: Boolean(grn.postedAt),
    printWarning: grn.postedAt
      ? null
      : 'This receipt has not been posted. The invoice below is not a payable document.',

    company: {
      name: env.COMPANY_NAME,
      address: env.COMPANY_ADDRESS,
      gstin: env.COMPANY_GSTIN || null,
      stateName: env.COMPANY_STATE_NAME,
      stateCode: env.COMPANY_STATE_CODE,
    },

    vendor: {
      name: grn.vendor.vendorName,
      code: grn.vendor.vendorCode,
      address: grn.vendor.address,
      // The GSTIN AS IT STOOD when the receipt posted, falling back to the
      // master for receipts raised before the column existed.
      gstNo: grn.vendorGstin ?? grn.vendor.gstNo,
    },

    line: {
      description: grn.inventoryItem?.description ?? grn.item,
      hsnCode: grn.hsnCode,
      uom: grn.uom,
      qty: D(grn.receivingQty).toFixed(4),
      rate: D(grn.inventoryRate).toFixed(4),
      amount: taxable.toFixed(2),
    },

    tax: {
      recorded: taxRecorded,
      note: taxRecorded
        ? null
        : 'No GST rate was recorded on this receipt, so no tax is shown.',
      supplyType: grn.supplyType,
      supplyTypeLabel:
        grn.supplyType === 'INTER_STATE'
          ? 'Inter-state (IGST)'
          : grn.supplyType === 'INTRA_STATE'
            ? 'Intra-state (CGST + SGST)'
            : null,
      gstRatePct: rate ? rate.toFixed(6) : null,
      gstRateDisplay: rate ? rate.mul(100).toDecimalPlaces(3).toFixed(2) : null,
      // Half the rate each, and the display figure comes from the same halving
      // the money did - so 5% never prints as two lines of 2.5% that add to 4.99.
      halfRateDisplay: rate ? rate.dividedBy(2).mul(100).toDecimalPlaces(3).toFixed(2) : null,
      taxableValue: taxable.toFixed(2),
      cgstAmount: cgst.toFixed(2),
      sgstAmount: sgst.toFixed(2),
      igstAmount: igst.toFixed(2),
      totalTax: totalTax.toFixed(2),
    },

    invoiceTotal: total.toFixed(2),
    invoiceTotalInWords: tax.amountInWords(total),

    references: {
      poId: po?.poId ?? null,
      poDate: po?.poDate ?? null,
      orderNo: po?.order?.orderNo ?? null,
      gatePassNo: grn.gatePass?.gatePassNo ?? null,
      chain: [po?.order?.orderNo, po?.poId, grn.grnNo].filter(Boolean).join(' → '),
    },

    remarks: grn.remarks,
    signatures: ['Prepared By', 'Checked By', 'Authorised Signatory'],
    printedAt: new Date().toISOString(),
  };
}
