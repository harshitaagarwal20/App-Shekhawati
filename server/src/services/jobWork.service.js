/**
 * Job Work - Dyeing and Printing. See `processes()` for why not Finishing.
 * Sheets: "Dye issue" and "Dyeing Receipt" (Shekwati4.xlsx).
 *
 * ===========================================================================
 *  ONE REGISTER, FOUR PROCESSES
 * ===========================================================================
 *
 * The workbook has a "Dye issue" sheet whose Process column already reads
 * Dyeing / Printing / Washing / Finishing. That is the job-work register, and
 * this module is its service; the table is still called `dye_issues` because
 * that is what Phase 0 named it and there are migrations and seed data behind
 * that name. Everywhere a person can see - the API path, the screens, the
 * printed slip - it is Job Work, and `process` is what distinguishes one kind
 * from another.
 *
 * Sharing the structure is the point: a dyeing job and a printing job differ in
 * one column and in nothing else. What must NOT be shared is the presentation.
 * `processMeta()` gives each process its own vocabulary - what the document is
 * called, what the vendor is called, what "shrinkage" means for it - so a
 * printing job never shows up on screen labelled as a dyeing job.
 *
 * ---------------------------------------------------------------------------
 *  AMOUNT AND SHRINKAGE ARE SERVER FORMULAS
 *
 *      amount       = qty x rate
 *      shrinkagePct = (qty - receivedQty) / qty
 *
 *  Neither is in an input schema. `receivedQty` and `shrinkagePct` are running
 *  totals recomputed from the receipts on every return - never typed - and both
 *  are backed by CHECK constraints, including one that refuses a return larger
 *  than what was sent out. Fabric shrinks; it does not multiply.
 *
 *  WHERE THE STOCK IS WHILE THE JOB RUNS
 *
 *  The fabric left the store on a Fabric Issue, which wrote the ledger OUT.
 *  A job-work issue does NOT move stock again - it records the job. The return
 *  does: a Dyeing Receipt writes the ledger IN for what actually came back, and
 *  the difference is the shrinkage, which is a real loss and stays out of stock.
 *  That is the flow the workbook implies and the one the seeder replays.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError, ERROR_CODES } from '../utils/ApiError.js';
import { normaliseShade } from '../domain/shade.js';
import { OPTIONS_LIMIT, searchFilter } from '../utils/http.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber, peekNumber } from './documentNumber.service.js';
import { DEFAULT_LOCATION, postMovement } from './inventory.service.js';
import * as engine from './approvalEngine.js';
import { assertNotSelfApproval } from '../domain/makerChecker.js';
// C3 - the shrinkage master, and the two pure functions that judge a return.
import { assessReturn, expectedReturnQty, resolveShrinkage } from './tolerance.service.js';

export const SORTABLE = [
  'dyeIssueNo',
  'issueDate',
  'process',
  'qty',
  'rate',
  'amount',
  'receivedQty',
  'shrinkagePct',
  'status',
  'createdAt',
];

export const RECEIPT_SORTABLE = ['receiptNo', 'receiptDate', 'qtyReceived', 'shrinkagePct', 'status'];

const SEARCH = ['dyeIssueNo', 'colourCode', 'content', 'count', 'construction', 'gsm', 'remark'];

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

/**
 * What each process is called, and what its numbers mean.
 *
 * Held as data rather than scattered through the screens: the UI must say
 * plainly which of the four a transaction is, and the words for that belong
 * next to the rule, not in a template.
 */
export const PROCESS_META = {
  DYEING: {
    label: 'Dyeing',
    documentName: 'Dyeing Job Work Issue',
    vendorLabel: 'Dyeing unit',
    vendorCategory: 'Dyeing',
    sequenceScope: 'DYEING',
    lossLabel: 'Shrinkage',
    rollStage: 'ISSUED_FOR_DYEING',
    returnedStage: 'DYED',
    location: 'AT DYEING VENDOR',
  },
  PRINTING: {
    label: 'Printing',
    documentName: 'Printing Job Work Issue',
    vendorLabel: 'Printing unit',
    vendorCategory: 'Printing',
    sequenceScope: 'PRINTING',
    lossLabel: 'Process loss',
    rollStage: 'ISSUED_FOR_PRINTING',
    returnedStage: 'PRINTED',
    location: 'AT PRINTING VENDOR',
  },
  FINISHING: {
    label: 'Finishing',
    documentName: 'Finishing Job Work Issue',
    vendorLabel: 'Finishing unit',
    vendorCategory: 'Dyeing',
    sequenceScope: 'DYEING',
    lossLabel: 'Process loss',
    rollStage: 'ISSUED_FOR_DYEING',
    returnedStage: 'DYED',
    location: 'AT DYEING VENDOR',
  },
};

/**
 * NOTE ON WHAT IS NO LONGER HERE.
 *
 * PROCESS_META used to carry a `standardLoss` per process - 3% dyeing, 2%
 * printing, 5% washing, 2% finishing. Those four numbers are now rows in
 * `shrinkage_rules`, resolved per process and per vendor and versioned by
 * date, and `resolveShrinkage()` is the only thing that answers the question.
 *
 * They were removed rather than left as a fallback because a fallback is
 * exactly what goes stale: when the office moved washing from 5% to 3%, a
 * surviving constant would have kept showing 5% on the preview form while the
 * posting refused at 3%. This file now describes what each process is CALLED;
 * what it is allowed to lose is the master's business.
 */

/** The vocabulary for one process. The UI renders this rather than guessing. */
export function processMeta(process) {
  const meta = PROCESS_META[process];
  if (!meta) throw ApiError.badRequest(`Unknown job work process "${process}"`, { field: 'process' });
  return { process, ...meta };
}

const INCLUDE = {
  roll: {
    select: {
      id: true,
      rollNo: true,
      fabricName: true,
      colorCode: true,
      content: true,
      count: true,
      construction: true,
      width: true,
      gsm: true,
      uom: true,
      receivedQty: true,
      balanceQty: true,
      rate: true,
      stage: true,
      location: true,
      isHeld: true,
      inventoryItemId: true,
      inventoryItem: { select: { id: true, itemCode: true, description: true, itemCategory: true } },
    },
  },
  vendor: {
    select: {
      id: true,
      vendorCode: true,
      vendorName: true,
      category: true,
      address: true,
      pinCode: true,
      gstNo: true,
      phone: true,
      contactPerson: true,
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
  fabricIssue: {
    select: { id: true, issueNo: true, issueDate: true, purpose: true, fabricQtyIssued: true },
  },
  // Every challan that sent fabric out on this PO.
  challans: {
    where: { deletedAt: null },
    orderBy: [{ issueDate: 'asc' }, { issueNo: 'asc' }],
    select: { id: true, issueNo: true, issueDate: true, fabricQtyIssued: true, uom: true },
  },
  receipts: {
    where: { deletedAt: null },
    orderBy: { receiptDate: 'asc' },
    select: {
      id: true,
      receiptNo: true,
      receiptDate: true,
      qtyIssued: true,
      qtyReceived: true,
      shrinkagePct: true,
      standardShrinkageAllowed: true,
      variationFlag: true,
      status: true,
      remarks: true,
    },
  },
};

const LIST_INCLUDE = {
  roll: { select: { id: true, rollNo: true, fabricName: true } },
  vendor: { select: { id: true, vendorName: true } },
  order: { select: { id: true, orderNo: true } },
  style: { select: { id: true, styleNo: true } },
};

// ===========================================================================
//  CALCULATIONS
// ===========================================================================

/** Excel: "Amount" (Auto = Qty x Rate). */
export function calculateAmount(qty, rate) {
  return D(qty).mul(D(rate)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Excel: "Shrinkage %" = (Qty Issued - Qty Received) / Qty Issued.
 *
 * Nothing back yet is shrinkage of ZERO, not of 100%: a lot still at the vendor
 * has not shrunk, it has simply not returned. The CHECK constraint on the table
 * carries the same exception, for the same reason.
 */
export function calculateShrinkage(qtyIssued, qtyReceived) {
  const issued = D(qtyIssued);
  const received = D(qtyReceived);
  if (issued.isZero() || received.isZero()) return ZERO;
  return issued.minus(received).div(issued).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
}

// ===========================================================================
//  VALIDATION HELPERS
// ===========================================================================

const LIST_FIELDS = [
  ['colourCode', 'ColorCode'],
  ['content', 'FabricContent'],
  ['count', 'Count'],
  ['construction', 'Construction'],
  ['gsm', 'GSM'],
  ['uom', 'UOM'],
];

async function validateDropdowns(data) {
  for (const [field, listCode] of LIST_FIELDS) {
    if (data[field] === undefined) continue;
    await assertValueInList(listCode, data[field], { field });
  }
}

/** The roll going out to the job worker. */
async function resolveRoll(rollId, tx = prisma) {
  const roll = await tx.fabricRoll.findFirst({
    where: { id: rollId, deletedAt: null },
    include: { inventoryItem: true },
  });
  if (!roll) throw ApiError.badRequest('Fabric roll does not exist', { field: 'rollId' });
  if (roll.isHeld) {
    throw ApiError.conflict(
      `Roll ${roll.rollNo} is on hold and cannot be sent out for job work.`,
      { field: 'rollId' },
    );
  }
  return roll;
}

/**
 * The job worker.
 *
 * Checked against the category the process needs: sending fabric to be printed
 * to a vendor the master says only dyes is the kind of mistake a dropdown ought
 * to catch, and the vendor category column exists precisely to catch it.
 */
async function resolveVendor(vendorId, process) {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, deletedAt: null } });
  if (!vendor) throw ApiError.badRequest('Vendor does not exist', { field: 'vendorId' });
  if (vendor.status !== 'ACTIVE') {
    throw ApiError.badRequest(`Vendor "${vendor.vendorName}" is inactive`, { field: 'vendorId' });
  }
  const meta = processMeta(process);
  if (vendor.category !== meta.vendorCategory && vendor.category !== 'Other') {
    throw ApiError.badRequest(
      `${vendor.vendorName} is a "${vendor.category}" vendor. ${meta.label} work goes to a ` +
        `"${meta.vendorCategory}" vendor.`,
      { field: 'vendorId', expectedCategory: meta.vendorCategory },
    );
  }
  return vendor;
}

async function resolveOrder(orderId) {
  if (!orderId) return null;
  const order = await prisma.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, orderNo: true, status: true, styleId: true, colorCode: true },
  });
  if (!order) throw ApiError.badRequest('Order does not exist', { field: 'orderId' });
  return order;
}

/**
 * The colour on the buyer order is what decides whether dyeing happens at all.
 *
 * Dyeing turns natural fabric into the colour the buyer asked for. Where the
 * order is itself for Natural, there is nothing to dye - raising a dye issue
 * books a vendor's rate, a gate pass and a receipt against a step the order
 * never called for, and the fabric comes back a colour nobody ordered.
 *
 * Read off the ORDER rather than the roll: the roll says what is in the store
 * today, the order says what the buyer is owed, and it is the buyer's
 * requirement that decides whether the step is needed. Printing is untouched -
 * a printed panel goes onto natural fabric perfectly happily.
 *
 * Where no order is linked the check cannot run and does not block: a job work
 * may legitimately be raised against a fabric issue that names no order, and
 * refusing those would stop work the rule has nothing to say about.
 */
async function assertDyeingWanted(process, orderId, tx = prisma) {
  if (process !== 'DYEING' || !orderId) return;

  const order = await tx.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { orderNo: true, colorCode: true },
  });
  if (!order) return;

  if ((order.colorCode ?? '').trim().toLowerCase() === 'natural') {
    throw ApiError.badRequest(
      `Order ${order.orderNo} is for Natural fabric, which is not dyed. A dyeing job ` +
        `can only be raised where the order calls for a colour.`,
      { field: 'process', orderNo: order.orderNo, orderColour: order.colorCode },
    );
  }
}

/** Counts what has been raised against a job. */
async function downstreamUsage(dyeIssueId) {
  const [receipts, gatePasses] = await Promise.all([
    prisma.dyeingReceipt.count({ where: { dyeIssueId, deletedAt: null } }),
    prisma.gatePass.count({ where: { dyeIssueId, deletedAt: null } }),
  ]);
  return { receipts, gatePasses, total: receipts + gatePasses };
}

function editability(job, usage) {
  const closed = job.status === 'COMPLETED' || job.status === 'CANCELLED';
  return {
    canEdit: !closed && usage.receipts === 0,
    canReceive: !closed && D(job.receivedQty).lessThan(D(job.issuedQty ?? 0)),
    canDelete: usage.total === 0 && job.status === 'PENDING',
    lockedBy: [
      usage.receipts > 0 ? `${usage.receipts} return(s)` : null,
      usage.gatePasses > 0 ? `${usage.gatePasses} gate pass(es)` : null,
    ].filter(Boolean),
  };
}

// ===========================================================================
//  PROJECTION
// ===========================================================================

function project(job) {
  if (!job) return job;
  const ordered = D(job.qty);
  // What has actually gone out on challans - a PO may be sent in parts.
  const issued = D(job.issuedQty ?? 0);
  const received = D(job.receivedQty);
  const shrinkage = D(job.shrinkagePct);
  const standard = D(job.standardShrinkageAllowed);
  const pending = issued.minus(received);
  const toSend = ordered.minus(issued);

  return {
    ...job,
    // The UI must never have to work out which of the four this is.
    meta: processMeta(job.process),
    amountCalculation: `${ordered.toFixed(4)} x ${D(job.rate).toFixed(4)}`,
    /** At the vendor now: sent on challans and not yet back. */
    pendingQty: (pending.isNegative() ? ZERO : pending).toFixed(4),
    /** Still to go out on a further challan against this PO. */
    toSendQty: (toSend.isNegative() ? ZERO : toSend).toFixed(4),
    shrinkagePctDisplay: shrinkage.mul(100).toDecimalPlaces(2).toFixed(2),
    standardShrinkagePctDisplay: standard.mul(100).toDecimalPlaces(2).toFixed(2),
    /** Over the allowance the job was raised with - the sheet's Variation Flag. */
    shrinkageBreached: !received.isZero() && shrinkage.greaterThan(standard),
    fullyReturned: !issued.isZero() && received.greaterThanOrEqualTo(issued),
  };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    process, status, vendorId, orderId, styleId, rollId, fabricStage,
    dateFrom, dateTo, pendingReturn, breachesOnly,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(process ? { process } : {}),
    ...(status ? { status } : {}),
    ...(vendorId ? { vendorId } : {}),
    ...(orderId ? { orderId } : {}),
    ...(styleId ? { styleId } : {}),
    ...(rollId ? { rollId } : {}),
    ...(fabricStage ? { fabricStage } : {}),
    ...(dateFrom || dateTo
      ? {
          issueDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    // "Still at the vendor" - the register's most-asked question.
    ...(pendingReturn ? { status: { notIn: ['COMPLETED', 'CANCELLED'] } } : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total, totals] = await Promise.all([
    prisma.dyeIssue.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.dyeIssue.count({ where }),
    prisma.dyeIssue.aggregate({ where, _sum: { qty: true, receivedQty: true, amount: true } }),
  ]);

  const projected = rows.map(project);

  return {
    rows: breachesOnly ? projected.filter((j) => j.shrinkageBreached) : projected,
    total,
    page,
    pageSize,
    totals: {
      qty: D(totals._sum.qty ?? 0).toFixed(4),
      receivedQty: D(totals._sum.receivedQty ?? 0).toFixed(4),
      amount: D(totals._sum.amount ?? 0).toFixed(2),
    },
  };
}

export async function getById(id) {
  const job = await prisma.dyeIssue.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!job) throw ApiError.notFound('Job work issue');

  const [usage, gatePasses, movements] = await Promise.all([
    downstreamUsage(id),
    prisma.gatePass.findMany({
      where: { dyeIssueId: id, deletedAt: null },
      orderBy: { gatePassDate: 'asc' },
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
    }),
    prisma.stockLedger.findMany({
      where: { rollId: (await prisma.dyeIssue.findUnique({ where: { id }, select: { rollId: true } }))?.rollId },
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
      take: 50,
      select: {
        id: true,
        entryDate: true,
        documentType: true,
        documentNo: true,
        direction: true,
        qty: true,
        balanceQty: true,
        location: true,
      },
    }),
  ]);

  return {
    ...project(job),
    // F-10: read by withApprovability() in the controller, then removed.
    createdById: job.createdById,
    /** The roll's whole movement history, which is the job's real context. */
    rollMovements: movements,
    gatePasses,
    usage,
    editable: editability(job, usage),
  };
}

// ===========================================================================
//  COMMANDS
// ===========================================================================

/**
 * Raises a job work issue.
 *
 * The job number comes from a per-process counter - DY-001 for dyeing, PJ-001
 * for printing - which is what the workbook does, and which is another way the
 * register makes the process visible rather than burying it in a column.
 */
export async function create(input, actorId) {
  await validateDropdowns(input);

  const meta = processMeta(input.process);
  const roll = await resolveRoll(input.rollId);
  const vendor = await resolveVendor(input.vendorId, input.process);
  const order = await resolveOrder(input.orderId);

  const qty = D(input.qty);
  if (!qty.greaterThan(0)) {
    throw ApiError.badRequest('Quantity must be greater than zero', { field: 'qty' });
  }

  // A job cannot send out more of a roll than was issued off it. The Fabric
  // Issue is what put the fabric in the vendor's hands; this records the work.
  const fabricIssue = input.fabricIssueId
    ? await prisma.fabricIssue.findFirst({
        where: { id: input.fabricIssueId, deletedAt: null },
        select: { id: true, issueNo: true, fabricQtyIssued: true, rollId: true, orderId: true, styleId: true },
      })
    : null;
  if (input.fabricIssueId && !fabricIssue) {
    throw ApiError.badRequest('Fabric issue does not exist', { field: 'fabricIssueId' });
  }
  if (fabricIssue && fabricIssue.rollId !== roll.id) {
    throw ApiError.badRequest(
      `Fabric issue ${fabricIssue.issueNo} released a different roll.`,
      { field: 'fabricIssueId' },
    );
  }
  if (fabricIssue && qty.greaterThan(D(fabricIssue.fabricQtyIssued))) {
    throw ApiError.badRequest(
      `Fabric issue ${fabricIssue.issueNo} released ${D(fabricIssue.fabricQtyIssued).toFixed(4)} ` +
        `${roll.uom}. A ${meta.label.toLowerCase()} job cannot be raised for ${qty.toFixed(4)}.`,
      { field: 'qty' },
    );
  }

  // The order the job actually belongs to - named directly, or inherited from
  // the fabric issue that released the roll. This is the same fallback the
  // created row uses for `orderId` below, so the rule is checked against the
  // order the job will end up filed under.
  await assertDyeingWanted(input.process, order?.id ?? fabricIssue?.orderId ?? null);

  const amount = calculateAmount(qty, input.rate);

  /**
   * C3 - THE SHRINKAGE TOLERANCE, RESOLVED FROM THE MASTER AND FROZEN.
   *
   * `standardShrinkageAllowed` used to default to 0.03 on the column, so a job
   * that never stated a tolerance silently inherited three per cent - exactly
   * the "do not assume a tolerance" failure the brief forbids. The default is
   * gone. Every job resolves its own figure here, per process and per vendor,
   * as at its own date, and stores it.
   *
   * A caller may still name a tolerance explicitly, but only a TIGHTER one: a
   * job cannot contract for more slack than the master permits, which is the
   * same rule the purchase order applies to its order tolerance.
   */
  const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
  const resolved = await resolveShrinkage(null, {
    process: input.process,
    vendorId: vendor.id,
    on: issueDate,
  });

  const asked =
    input.shrinkageTolerancePct ?? input.standardShrinkageAllowed ?? null;
  if (asked !== null && D(asked).greaterThan(resolved.tolerance)) {
    throw ApiError.badRequest(
      `A shrinkage tolerance of ${D(asked).mul(100).toFixed(2)}% was asked for, and the ` +
        `approved tolerance for ${String(input.process).toLowerCase()}` +
        `${resolved.scope === 'VENDOR' ? ` at ${resolved.vendorName}` : ''} is ` +
        `${resolved.tolerancePct.display}%. ${resolved.basis}`,
      {
        field: 'shrinkageTolerancePct',
        requested: D(asked).toFixed(6),
        ceiling: resolved.tolerance.toFixed(6),
        basis: resolved.basis,
      },
    );
  }

  const shrinkageTolerancePct = asked !== null ? D(asked) : resolved.tolerance;

  const job = await prisma.$transaction(async (tx) => {
    const dyeIssueNo =
      input.dyeIssueNo?.trim() ||
      (await nextNumber('DYE_ISSUE', { scopeKey: meta.sequenceScope, tx }));

    const clash = await tx.dyeIssue.findUnique({
      where: { dyeIssueNo },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict('This job number already exists', { field: 'dyeIssueNo' });

    const created = await tx.dyeIssue.create({
      data: {
        dyeIssueNo,
        issueDate: input.issueDate ? new Date(input.issueDate) : new Date(),
        process: input.process,
        rollId: roll.id,
        // Fabric characteristics travel with the roll, not with the typist.
        colourCode: input.colourCode ?? roll.colorCode,
        content: input.content ?? roll.content,
        count: input.count ?? roll.count,
        construction: input.construction ?? roll.construction,
        width: input.width !== undefined && input.width !== null ? D(input.width) : roll.width,
        gsm: input.gsm ?? roll.gsm,
        vendorId: vendor.id,
        // Snapshotted, like the PO address: where the goods were sent on the day.
        address: input.address ?? vendor.address ?? null,
        pinCode: input.pinCode ?? vendor.pinCode ?? null,
        qty,
        uom: input.uom ?? roll.uom,
        rate: D(input.rate),
        amount,
        remark: input.remark ?? null,
        fabricStage: input.fabricStage ?? 'BEFORE_STITCHING',
        // C3 - resolved above, frozen here. Never re-resolved: a lot at the
        // vendor is judged by the bar it left under.
        shrinkageTolerancePct,
        shrinkageRuleId: resolved.ruleId,
        shrinkageRuleBasis: resolved.basis,
        // C3 - what the job worker is expected to send back. Computed on the
        // server from the two numbers above and never typed.
        expectedReturnQty: expectedReturnQty(qty, shrinkageTolerancePct),
        fabricIssueId: fabricIssue?.id ?? null,
        orderId: order?.id ?? fabricIssue?.orderId ?? null,
        styleId: input.styleId ?? order?.styleId ?? fabricIssue?.styleId ?? null,
        // Nothing back yet: both running totals start at zero, and the CHECK on
        // the table treats zero returned as zero shrinkage rather than 100%.
        receivedQty: ZERO,
        shrinkagePct: ZERO,
        /**
         * C3 - A JOB WORK ORDER STARTS AS A DRAFT, NOT AS WORK IN PROGRESS.
         *
         * It is [A][S] now: it has to be approved before fabric may be issued
         * against it, and the fabric issue is what moves the stock and posts
         * it. Creating it IN_PROGRESS would have said the cloth was already at
         * the vendor, which is what C3 exists to stop.
         */
        workflowState: 'DRAFT',
        status: 'PENDING',
        createdById: actorId,
        updatedById: actorId,
      },
      include: LIST_INCLUDE,
    });

    /**
     * C3 - THE ROLL DOES NOT MOVE HERE ANY MORE.
     *
     * Raising a job work order is paperwork. The fabric moves when it is
     * ISSUED against the approved order, and `fabricIssue.create()` is what
     * writes both the ledger legs and the roll's new stage and location -
     * atomically, with the movement.
     *
     * Moving the roll here as well would have marked cloth as being at a dye
     * house on the strength of an unapproved draft.
     */
    await engine.record(tx, {
      documentType: 'DYE_ISSUE',
      documentId: created.id,
      documentNo: created.dyeIssueNo,
      action: 'SUBMITTED',
      toStatus: 'DRAFT',
      actor: { userId: actorId },
      remarks:
        `${meta.documentName} raised on ${vendor.vendorName}: ${qty.toFixed(4)} ` +
        `${input.uom ?? roll.uom} of roll ${roll.rollNo}, shrinkage tolerance ` +
        `${shrinkageTolerancePct.mul(100).toFixed(2)}%.`,
    });

    return created;
  });

  return project(job);
}

/** Edits a job that has had nothing returned against it yet. */
export async function update(id, input, actorId) {
  const existing = await prisma.dyeIssue.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw ApiError.notFound('Job work issue');

  const usage = await downstreamUsage(id);
  const editable = editability(existing, usage);
  if (!editable.canEdit) {
    throw ApiError.conflict(
      usage.receipts > 0
        ? `${usage.receipts} return(s) have been booked against this job; it cannot be edited.`
        : `This job is ${existing.status.toLowerCase().replace(/_/g, ' ')}.`,
      { usage, status: existing.status },
    );
  }

  await validateDropdowns(input);
  if (input.vendorId !== undefined) {
    await resolveVendor(input.vendorId, input.process ?? existing.process);
  }

  // Re-checked on edit, not only on create: switching a printing job to dyeing,
  // or re-pointing a dyeing job at a Natural order, would otherwise walk around
  // the rule that create() enforces.
  await assertDyeingWanted(
    input.process ?? existing.process,
    input.orderId !== undefined ? input.orderId : existing.orderId,
  );

  const qty = input.qty !== undefined ? D(input.qty) : D(existing.qty);
  const rate = input.rate !== undefined ? D(input.rate) : D(existing.rate);
  if (qty.lessThan(D(existing.issuedQty))) {
    throw ApiError.badRequest(
      `${D(existing.issuedQty).toFixed(4)} ${existing.uom} has already gone out on challans ` +
        `against ${existing.dyeIssueNo}. The order cannot be reduced below that.`,
      { field: 'qty' },
    );
  }

  const job = await prisma.dyeIssue.update({
    where: { id },
    data: {
      ...(input.issueDate !== undefined ? { issueDate: new Date(input.issueDate) } : {}),
      ...(input.process !== undefined ? { process: input.process } : {}),
      ...(input.colourCode !== undefined ? { colourCode: input.colourCode } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.construction !== undefined ? { construction: input.construction } : {}),
      ...(input.width !== undefined ? { width: input.width === null ? null : D(input.width) } : {}),
      ...(input.gsm !== undefined ? { gsm: input.gsm } : {}),
      ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.pinCode !== undefined ? { pinCode: input.pinCode } : {}),
      ...(input.uom !== undefined ? { uom: input.uom } : {}),
      ...(input.remark !== undefined ? { remark: input.remark } : {}),
      ...(input.fabricStage !== undefined ? { fabricStage: input.fabricStage } : {}),
      ...(input.standardShrinkageAllowed !== undefined
        ? { standardShrinkageAllowed: D(input.standardShrinkageAllowed) }
        : {}),
      ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
      ...(input.styleId !== undefined ? { styleId: input.styleId } : {}),
      qty,
      rate,
      // Recomputed on every write, whether or not qty or rate were what moved.
      amount: calculateAmount(qty, rate),
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  return project(job);
}

// ===========================================================================
//  C3 - THE APPROVAL HALF OF [A][S]
// ===========================================================================

/**
 * Hands a job work order in for approval.
 *
 * A job work order is a purchase: the company is buying dyeing, and it is
 * putting several lakh rupees of its own cloth in somebody else's building to
 * get it. It goes through the same gate as any other purchase.
 */
export async function submitJob(id, { submittedTo, remarks } = {}, actor = {}) {
  await engine.submit(null, {
    documentType: 'DYE_ISSUE',
    documentId: id,
    submittedTo,
    actor,
    remarks,
  });
  return getById(id);
}

/**
 * Approves a job work order.
 *
 * MAKER-CHECKER: the person who raised it may not be the person who authorises
 * it. Sending fabric out of the building on one signature is exactly the risk
 * an approval step exists to cover.
 *
 * Approving does NOT move stock. The fabric moves when it is ISSUED against
 * this order, and `fabricIssue.create()` is what posts both ledger legs and
 * transitions this document to POSTED - in one transaction, so an approved
 * order never shows fabric at a vendor that has not left the store.
 */
export async function approveJob(id, { remarks } = {}, actor = {}) {
  const job = await prisma.dyeIssue.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, dyeIssueNo: true, createdById: true, qty: true, uom: true },
  });
  if (!job) throw ApiError.notFound('Job work order');

  assertNotSelfApproval(job, actor, 'job work order');

  await engine.approve(null, {
    documentType: 'DYE_ISSUE',
    documentId: id,
    actor,
    remarks:
      remarks ??
      `Approved to send ${D(job.qty).toFixed(4)} ${job.uom} to the job worker.`,
  });
  return getById(id);
}

/** Rejects a job work order, with a reason. */
export async function rejectJob(id, { reason } = {}, actor = {}) {
  await engine.reject(null, { documentType: 'DYE_ISSUE', documentId: id, actor, reason });
  return getById(id);
}

/**
 * Moves a job's fulfilment status by hand - putting one on hold, mostly.
 *
 * The ordinary transitions are automatic: a job goes IN_PROGRESS when it is
 * raised and COMPLETED when the last of its fabric comes back, both worked out
 * by the return endpoint. This is for the cases the arithmetic cannot see, and
 * it is checked against the same table.
 */
export async function setStatus(id, { status, remarks }, actorId) {
  const job = await prisma.dyeIssue.findFirst({ where: { id, deletedAt: null } });
  if (!job) throw ApiError.notFound('Job work issue');

  engine.assertStatusTransition(job.status, status, { label: job.dyeIssueNo });

  if (status === 'CANCELLED' && D(job.receivedQty).greaterThan(0)) {
    throw ApiError.conflict(
      `${D(job.receivedQty).toFixed(4)} ${job.uom} has already come back on ` +
        `${job.dyeIssueNo}. It cannot be cancelled after the fact.`,
    );
  }
  if (status === 'COMPLETED' && D(job.receivedQty).lessThan(D(job.qty))) {
    throw ApiError.conflict(
      `${job.dyeIssueNo} still has ${D(job.qty).minus(D(job.receivedQty)).toFixed(4)} ` +
        `${job.uom} at the vendor. Book the return rather than marking it complete.`,
    );
  }

  const updated = await prisma.dyeIssue.update({
    where: { id },
    data: {
      status,
      ...(remarks !== undefined ? { remark: remarks } : {}),
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  return project(updated);
}

/**
 * Books a return from the job worker.
 *
 * ONE TRANSACTION: the receipt, the stock ledger IN for what actually came
 * back, the roll's balance and stage, and the job's running totals. The
 * shrinkage is the difference, and it is a real loss - it never re-enters
 * stock, which is exactly why the ledger IN is for the RECEIVED quantity and
 * not the issued one.
 *
 * @param {{userId: string, fullName: string}} actor
 */
export async function receive(id, input, actor) {
  const job = await prisma.dyeIssue.findFirst({
    where: { id, deletedAt: null },
    include: { roll: { include: { inventoryItem: true } }, vendor: true },
  });
  if (!job) throw ApiError.notFound('Job work issue');
  if (job.status === 'CANCELLED') {
    throw ApiError.conflict('This job is cancelled; nothing can be returned against it.');
  }

  const meta = processMeta(job.process);
  const received = D(input.qtyReceived);
  if (!received.greaterThan(0)) {
    throw ApiError.badRequest('Received quantity must be greater than zero', {
      field: 'qtyReceived',
    });
  }

  /**
   * WHAT WAS SENT, NOT WHAT WAS ORDERED.
   *
   * A PO for 10,000 may have gone out as one challan of 5,000 so far. Returns,
   * shrinkage and closing are all measured against the 5,000 at the vendor -
   * 4,900 back is 2% shrinkage, not 51%.
   */
  const sent = D(job.issuedQty);
  if (!sent.greaterThan(0)) {
    throw ApiError.conflict(
      `Nothing has been sent to the vendor on ${job.dyeIssueNo} yet - issue the fabric on a ` +
        'challan before booking a return.',
      { field: 'qtyReceived' },
    );
  }

  const alreadyBack = D(job.receivedQty);
  const cumulative = alreadyBack.plus(received);
  if (cumulative.greaterThan(sent)) {
    throw ApiError.conflict(
      `${sent.toFixed(4)} ${job.uom} went out on ${job.dyeIssueNo} and ` +
        `${alreadyBack.toFixed(4)} has already come back. Receiving ${received.toFixed(4)} more ` +
        `would return ${cumulative.toFixed(4)} - more than was ever sent. ` +
        'Fabric shrinks; it does not multiply. Check the roll numbers.',
      {
        field: 'qtyReceived',
        issued: sent.toFixed(4),
        alreadyReceived: alreadyBack.toFixed(4),
        wouldTotal: cumulative.toFixed(4),
      },
    );
  }

  if (!job.roll?.inventoryItemId) {
    throw ApiError.conflict(
      `Roll ${job.roll?.rollNo ?? ''} is not linked to a stock item, so the return could not be ` +
        'recorded in the stock ledger.',
    );
  }

  /**
   * C3 - THE RETURN TEST, from the pure function in tolerance.service.js.
   *
   *     passes when returnedQty >= issuedQty x (1 - shrinkageTolerancePct)
   *
   * The tolerance is the one FROZEN ON THE JOB, not one re-resolved today: a
   * lot at the vendor is judged by the bar it left under.
   */
  const standard = D(job.shrinkageTolerancePct);
  const assessment = assessReturn({
    issuedQty: sent,
    returnedQty: cumulative,
    shrinkageTolerancePct: standard,
  });

  const shrinkage = calculateShrinkage(sent, cumulative);
  const expectedBack = D(assessment.expectedReturnQty);
  const breached = !assessment.within;

  /**
   * C3 - A SHORTFALL BEYOND TOLERANCE BLOCKS THE POSTING.
   *
   * The brief is explicit: "If shortfall exceeds tolerance: block posting,
   * require scrutiny/exception path." Recording it quietly and flagging the
   * roll - which is what happened before - is not blocking.
   *
   * The exception path is `requireScrutiny`: the receiver states, in the
   * request, that this return is going to a Fabric Checking Report. That is
   * the scrutiny requirement C4 then enforces at the cutting floor, so the
   * fabric cannot be cut until the report exists.
   */
  if (breached && !input.requireScrutiny) {
    throw new ApiError(
      409,
      `${sent.toFixed(4)} ${job.uom} went out on ${job.dyeIssueNo} and ` +
        `${cumulative.toFixed(4)} has come back - a shortfall of ` +
        `${assessment.variationPctDisplay}% against a tolerance of ` +
        `${assessment.tolerancePct}%. At least ${assessment.expectedReturnQty} was expected. ` +
        'This return cannot be posted as routine: it needs scrutiny. Confirm that a Fabric ' +
        'Checking Report will be raised.',
      {
        code: ERROR_CODES.VERIFICATION_FAILED,
        details: {
          field: 'qtyReceived',
          assessment,
          requiresScrutiny: true,
          jobWorkNo: job.dyeIssueNo,
          basis: job.shrinkageRuleBasis,
        },
      },
    );
  }

  // The sheet's own rule: an out-of-tolerance return goes to scrutiny, and the
  // roll is held there until QC and the Director have looked at it.
  const status = input.status ?? (breached ? 'SENT_TO_SCRUTINY' : 'OK');
  const location = input.location ?? DEFAULT_LOCATION;

  /**
   * C3 - where the fabric is coming BACK FROM.
   *
   * A job posted under C3 put the cloth at the job worker's location in the
   * ledger, so the return has to take it out of there and put it back in the
   * store: two legs, one transaction.
   *
   * A job issued BEFORE C3 has no job-worker leg - `stockPostedAt` is null -
   * and its fabric left stock entirely on the fabric issue. Those returns keep
   * behaving exactly as they always did: a single IN, no OUT from a location
   * that never received anything. History is not rewritten and nothing
   * double-counts.
   */
  const returningFrom = job.stockPostedAt ? job.jobWorkerLocation : null;

  const receiptId = await prisma.$transaction(async (tx) => {
    const receiptNo = input.receiptNo?.trim() || (await nextNumber('DYEING_RECEIPT', { tx }));
    const clash = await tx.dyeingReceipt.findUnique({
      where: { receiptNo },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict('This receipt number already exists', { field: 'receiptNo' });

    const receiptDate = input.receiptDate ? new Date(input.receiptDate) : new Date();

    const receipt = await tx.dyeingReceipt.create({
      data: {
        receiptNo,
        receiptDate,
        dyeIssueId: job.id,
        rollId: job.rollId,
        qtyIssued: sent,
        qtyReceived: received,
        // Excel: "Shrinkage %" on the receipt is for the lot as a whole.
        shrinkagePct: shrinkage,
        standardShrinkageAllowed: standard,
        // Excel: "Variation Flag" = Shrinkage % > Standard Shrinkage Allowed.
        variationFlag: breached,
        /**
         * C4 - THE SCRUTINY DECISION, TAKEN HERE AND RECORDED HERE.
         *
         * Whether this fabric needs a Fabric Checking Report is decided on the
         * RETURN, from the variation against the standard - not inferred later
         * by whoever happens to be looking at the roll. The cutting floor's
         * FABRIC_PROCESS_COMPLETE check reads `requiresScrutiny`, and a return
         * within standard passes it as COMPLETE rather than as "nothing found
         * yet".
         */
        variationPct: D(assessment.variationPct),
        requiresScrutiny: breached,
        status,
        remarks: input.remarks ?? null,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });

    /**
     * C3 - LEG ONE: out of the job worker's location.
     *
     * The FULL issued quantity leaves once the lot closes, not just what came
     * back: the shrinkage is a real loss and it is lost AT THE VENDOR, so it
     * has to stop being counted as company stock held there. One OUT for what
     * was sent, one IN for what returned, and the difference IS the loss -
     * visible as the gap between the two rows, which is what a store keeper
     * reading the ledger wants to see.
     *
     * A partial return takes only its own quantity, so a lot coming back in
     * three lorries does not write the balance off twice.
     *
     * "What is still there" is what was sent less what has ALREADY LEFT the
     * vendor's location in the ledger - not less what came back. When a PO
     * goes out on two challans, the first one's shrinkage was written off
     * when it closed, and must not be counted as still at the vendor.
     */
    /** FIFO - the cost of what leaves the job worker, carried onto the return. */
    let carried = null;
    if (returningFrom) {
      const priorReceipts = await tx.dyeingReceipt.findMany({
        where: { dyeIssueId: job.id, id: { not: receipt.id } },
        select: { id: true },
      });
      const left = priorReceipts.length
        ? await tx.stockLedger.aggregate({
            where: {
              documentType: 'DYEING_RECEIPT',
              documentId: { in: priorReceipts.map((r) => r.id) },
              direction: 'OUT',
              location: returningFrom,
            },
            _sum: { qty: true },
          })
        : { _sum: { qty: 0 } };
      const stillThere = sent.minus(D(left._sum.qty ?? 0));

      const closesLot = cumulative.greaterThanOrEqualTo(expectedBack);
      const leavingJobWorker = Prisma.Decimal.max(
        0,
        closesLot ? stillThere : Prisma.Decimal.min(received, stillThere),
      );

      if (leavingJobWorker.greaterThan(0)) ({ consumed: carried } = await postMovement(tx, {
        itemId: job.roll.inventoryItemId,
        rollId: job.rollId,
        direction: 'OUT',
        qty: leavingJobWorker,
        rate: job.roll.rate ?? 0,
        entryDate: receiptDate,
        location: returningFrom,
        documentType: 'DYEING_RECEIPT',
        documentId: receipt.id,
        documentNo: receipt.receiptNo,
        orderId: job.orderId,
        snapshot: {
          itemCategory: job.roll.inventoryItem?.itemCategory ?? 'Fabric',
          colorCode: job.roll.colorCode,
          gsm: job.roll.gsm,
          content: job.roll.content,
          uom: job.roll.uom,
        },
        remarks:
          `Released from ${returningFrom} on ${receipt.receiptNo}` +
          (leavingJobWorker.greaterThan(received)
            ? ` - ${leavingJobWorker.minus(received).toFixed(4)} ${job.uom} lost as ` +
              `${meta.lossLabel.toLowerCase()}`
            : ''),
        actor,
      }));
    }

    // LEG TWO. Stock comes back in - only what actually arrived. The shrinkage
    // is gone and the ledger says so by never recording it as returning.
    await postMovement(tx, {
      itemId: job.roll.inventoryItemId,
      rollId: job.rollId,
      direction: 'IN',
      qty: received,
      rate: job.roll.rate ?? 0,
      // FIFO - what came back carries the whole cost of what left the job
      // worker, shrinkage included: a normal process loss is absorbed by the
      // good metres, not written off at cost. Null for a lot issued before
      // the job-worker leg existed, which is then valued at the roll's rate.
      carryCost: carried,
      entryDate: receiptDate,
      location,
      documentType: 'DYEING_RECEIPT',
      documentId: receipt.id,
      documentNo: receipt.receiptNo,
      orderId: job.orderId,
      snapshot: {
        itemCategory: job.roll.inventoryItem?.itemCategory ?? 'Fabric',
        colorCode: job.roll.colorCode,
        gsm: job.roll.gsm,
        content: job.roll.content,
        uom: job.roll.uom,
      },
      remarks:
        `Returned from ${meta.label.toLowerCase()} at ${job.vendor?.vendorName ?? 'vendor'} ` +
        `on ${job.dyeIssueNo}` +
        (breached ? ` - ${meta.lossLabel.toLowerCase()} over tolerance` : ''),
      actor,
    });

    /*
     * SHADE AND LOT AFTER JOB WORK.
     *
     * Dyeing makes a new shade: whatever the roll was graded as before is no
     * longer true, so it is cleared unless this return grades it again, and
     * the lot becomes the dye house's. Printing and washing leave the base
     * shade alone unless the receiver says otherwise.
     */
    const reshaded = job.process === 'DYEING';
    const shadePatch = {
      ...(input.dyeLot !== undefined || reshaded
        ? { dyeLot: normaliseShade(input.dyeLot) ?? (reshaded ? null : job.roll.dyeLot) }
        : {}),
      ...(input.shade !== undefined || reshaded
        ? { shade: normaliseShade(input.shade) ?? (reshaded ? null : job.roll.shade) }
        : {}),
      ...(input.shade || input.dyeLot
        ? { shadeMarkedAt: new Date(), shadeMarkedByName: actor.fullName ?? null }
        : {}),
    };

    // The roll: what is on it, where it is, and whether it is held for scrutiny.
    await tx.fabricRoll.update({
      where: { id: job.rollId },
      data: {
        ...shadePatch,
        balanceQty: D(job.roll.balanceQty).plus(received),
        stage: breached ? 'SCRUTINY_HOLD' : meta.returnedStage,
        location,
        isHeld: breached,
        remarks: breached
          ? `Held: ${meta.lossLabel.toLowerCase()} ${shrinkage.mul(100).toDecimalPlaces(2)}% on ` +
            `${job.dyeIssueNo}, allowance ${standard.mul(100).toDecimalPlaces(2)}%`
          : job.roll.remarks,
        updatedById: actor.userId,
      },
    });

    // The job's running totals - DERIVED from the returns, not typed. A job is
    // finished when the whole PO has gone out AND come back within tolerance;
    // a PO with a challan still to go is not finished however much returned.
    const finished =
      sent.greaterThanOrEqualTo(D(job.qty)) &&
      cumulative.greaterThanOrEqualTo(D(job.expectedReturnQty));

    await tx.dyeIssue.update({
      where: { id: job.id },
      data: {
        receivedQty: cumulative,
        shrinkagePct: shrinkage,
        updatedById: actor.userId,
        // Only moved directly for the lots that predate C3 and so never
        // entered the workflow. Everything else closes through the engine
        // below, which writes this column as its legacy mapping.
        ...(job.workflowState === 'POSTED'
          ? {}
          : { status: finished ? 'COMPLETED' : 'IN_PROGRESS' }),
      },
    });

    /**
     * C3 - the lot closes through the approval engine, so a completed job work
     * order leaves a stage event and a trail entry like every other document.
     *
     * "Finished" is measured against the EXPECTED return, not against the
     * issued quantity: a lot that came back 2% short of what went out IS
     * complete, because 2% was the agreed shrinkage. Waiting for the full
     * issued quantity would leave every job open for ever.
     */
    if (finished && job.workflowState === 'POSTED') {
      await engine.complete(tx, {
        documentType: 'DYE_ISSUE',
        documentId: job.id,
        actor,
        remarks:
          `${cumulative.toFixed(4)} ${job.uom} returned against ${sent.toFixed(4)} sent - ` +
          `${assessment.variationPctDisplay}% ${meta.lossLabel.toLowerCase()} against a ` +
          `${assessment.tolerancePct}% tolerance.`,
      });
    }

    return receipt.id;
  });

  return {
    receipt: await prisma.dyeingReceipt.findUnique({ where: { id: receiptId } }),
    job: await getById(id),
  };
}

/** Cancels a job that never went out. */
export async function remove(id, actorId) {
  const job = await prisma.dyeIssue.findFirst({ where: { id, deletedAt: null } });
  if (!job) throw ApiError.notFound('Job work issue');

  const usage = await downstreamUsage(id);
  if (usage.receipts > 0) {
    throw ApiError.conflict(
      `${usage.receipts} return(s) have been booked against ${job.dyeIssueNo}; it cannot be deleted.`,
      { usage },
    );
  }
  if (usage.gatePasses > 0) {
    throw ApiError.conflict(
      `${usage.gatePasses} gate pass(es) reference ${job.dyeIssueNo}; it cannot be deleted.`,
      { usage },
    );
  }

  await prisma.dyeIssue.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId },
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
//  Previews, printing and options
// ---------------------------------------------------------------------------

/**
 * The amount and the process vocabulary for a job that has not been saved yet,
 * plus everything the roll already knows - so the form fills itself in and the
 * screen can say "Printing Job Work Issue" before anything is typed.
 */
export async function preview({ process, rollId, qty, rate, standardShrinkageAllowed, vendorId, on }) {
  const meta = processMeta(process);
  const roll = rollId ? await resolveRoll(rollId) : null;
  const amount = calculateAmount(qty ?? 0, rate ?? 0);

  /**
   * C3 - THE PREVIEW RESOLVES THE SAME WAY create() WILL.
   *
   * It used to fall back to `meta.standardLoss`, a constant in this file. The
   * moment the office moved washing from 5% to 3% in the master, that constant
   * became a figure the form would SHOW and the posting would then contradict -
   * a supervisor told 5% and refused at 3%. A preview that can disagree with
   * the rule it is previewing is worse than no preview.
   */
  const resolved = await resolveShrinkage(null, { process, vendorId, on });
  const standard = D(standardShrinkageAllowed ?? resolved.tolerance);

  return {
    meta,
    roll: roll
      ? {
          id: roll.id,
          rollNo: roll.rollNo,
          fabricName: roll.fabricName,
          colorCode: roll.colorCode,
          content: roll.content,
          count: roll.count,
          construction: roll.construction,
          width: roll.width,
          gsm: roll.gsm,
          uom: roll.uom,
          balanceQty: D(roll.balanceQty).toFixed(4),
          stage: roll.stage,
          location: roll.location,
        }
      : null,
    qty: D(qty ?? 0).toFixed(4),
    rate: D(rate ?? 0).toFixed(4),
    amount: amount.toFixed(2),
    formula: 'Amount = Qty x Rate',
    standardShrinkageAllowed: standard.toFixed(6),
    standardShrinkagePctDisplay: standard.mul(100).toDecimalPlaces(2).toFixed(2),
    /** What comes back if the lot shrinks exactly to the allowance. */
    expectedReturnQty: D(qty ?? 0).mul(D(1).minus(standard)).toDecimalPlaces(4).toFixed(4),
    nextJobNo: await peekNumber('DYE_ISSUE', { scopeKey: meta.sequenceScope }),
  };
}

/** What a return of a given quantity would mean, before it is booked. */
export async function previewReceipt({ dyeIssueId, qtyReceived }) {
  const job = await prisma.dyeIssue.findFirst({
    where: { id: dyeIssueId, deletedAt: null },
    include: { roll: { select: { rollNo: true, balanceQty: true, uom: true } }, vendor: true },
  });
  if (!job) throw ApiError.notFound('Job work issue');

  const meta = processMeta(job.process);
  const received = D(qtyReceived ?? 0);
  const cumulative = D(job.receivedQty).plus(received);
  const sent = D(job.issuedQty);
  const shrinkage = calculateShrinkage(sent, cumulative);
  const standard = D(job.standardShrinkageAllowed);
  const breached = shrinkage.greaterThan(standard);

  return {
    meta,
    dyeIssueNo: job.dyeIssueNo,
    rollNo: job.roll?.rollNo ?? null,
    uom: job.uom,
    qtyIssued: sent.toFixed(4),
    alreadyReceived: D(job.receivedQty).toFixed(4),
    qtyReceived: received.toFixed(4),
    cumulativeReceived: cumulative.toFixed(4),
    exceedsIssued: cumulative.greaterThan(sent),
    shrinkagePct: shrinkage.toFixed(6),
    shrinkagePctDisplay: shrinkage.mul(100).toDecimalPlaces(2).toFixed(2),
    standardShrinkageAllowed: standard.toFixed(6),
    standardShrinkagePctDisplay: standard.mul(100).toDecimalPlaces(2).toFixed(2),
    variationFlag: breached,
    lossLabel: meta.lossLabel,
    /** What the sheet does with an out-of-tolerance return. */
    willStatus: breached ? 'SENT_TO_SCRUTINY' : 'OK',
    willHoldRoll: breached,
    formula: `${meta.lossLabel} % = (Qty Issued - Qty Received) / Qty Issued`,
    nextReceiptNo: await peekNumber('DYEING_RECEIPT'),
  };
}

/** The printable job work issue - the slip that travels with the fabric. */
export async function printView(id) {
  const job = await prisma.dyeIssue.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!job) throw ApiError.notFound('Job work issue');

  const meta = processMeta(job.process);

  return {
    // The printed slip names the process. A dyeing job never prints as a
    // printing job, whatever they share underneath.
    documentTitle: meta.documentName.toUpperCase(),
    process: job.process,
    processLabel: meta.label,
    jobNo: job.dyeIssueNo,
    issueDate: job.issueDate,
    status: job.status,
    fabricStage: job.fabricStage,
    vendor: {
      label: meta.vendorLabel,
      name: job.vendor.vendorName,
      code: job.vendor.vendorCode,
      address: job.address ?? job.vendor.address,
      pinCode: job.pinCode ?? job.vendor.pinCode,
      gstNo: job.vendor.gstNo,
      phone: job.vendor.phone,
    },
    fabric: {
      rollNo: job.roll.rollNo,
      fabricName: job.roll.fabricName,
      colourCode: job.colourCode,
      content: job.content,
      count: job.count,
      construction: job.construction,
      width: job.width,
      gsm: job.gsm,
    },
    line: {
      qty: D(job.qty).toFixed(4),
      issuedQty: D(job.issuedQty).toFixed(4),
      toSendQty: D(job.qty).minus(D(job.issuedQty)).toFixed(4),
      uom: job.uom,
      rate: D(job.rate).toFixed(4),
      amount: D(job.amount).toFixed(2),
      receivedQty: D(job.receivedQty).toFixed(4),
      lossLabel: meta.lossLabel,
      shrinkagePctDisplay: D(job.shrinkagePct).mul(100).toDecimalPlaces(2).toFixed(2),
      standardShrinkagePctDisplay: D(job.standardShrinkageAllowed)
        .mul(100)
        .toDecimalPlaces(2)
        .toFixed(2),
    },
    references: {
      orderNo: job.order?.orderNo ?? null,
      buyerName: job.order?.buyer?.buyerName ?? null,
      styleNo: job.style?.styleNo ?? null,
      fabricIssueNo: job.fabricIssue?.issueNo ?? null,
      chain: [job.order?.orderNo, job.fabricIssue?.issueNo, job.dyeIssueNo]
        .filter(Boolean)
        .join(' → '),
    },
    returns: job.receipts,
    challans: job.challans,
    remarks: job.remark,
    signatures: ['Issued By', 'Authorised By', 'Received By (Vendor)'],
    printedAt: new Date().toISOString(),
  };
}

/**
 * The processes the office is OFFERED, with their vocabulary, for the UI.
 *
 * ---------------------------------------------------------------------------
 *  TWO, NOT THREE
 *
 *  Cloth leaves this store to be dyed or printed. Finishing was offered and is
 *  not done here - and every process a screen offers is a vendor category, a
 *  roll stage and a location somebody has to keep correct, so offering one
 *  that is never used is a wrong entry waiting to be made.
 *
 *  PROCESS_META still holds it, deliberately, and so does the IssueProcess
 *  enum. Nothing in the database is rewritten by this: a Finishing job raised
 *  before today still opens, still prints and still reads correctly, because
 *  its vocabulary is still here to render it. This decides what may be
 *  RAISED, which is a different question from what may exist.
 *
 *  To offer it again, put it back in OFFERED. Nothing else needs to change.
 * ---------------------------------------------------------------------------
 */
const OFFERED = ['DYEING', 'PRINTING'];

export function processes() {
  return OFFERED.map((p) => processMeta(p));
}

/** Open jobs, for the gate pass and return screens. */
export async function options({ process, vendorId, pendingReturnOnly } = {}) {
  return prisma.dyeIssue.findMany({
    where: {
      deletedAt: null,
      ...(process ? { process } : {}),
      ...(vendorId ? { vendorId } : {}),
      ...(pendingReturnOnly ? { status: { notIn: ['COMPLETED', 'CANCELLED'] } } : {}),
    },
    orderBy: { issueDate: 'desc' },
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      dyeIssueNo: true,
      issueDate: true,
      process: true,
      qty: true,
      receivedQty: true,
      uom: true,
      status: true,
      fabricStage: true,
      roll: { select: { id: true, rollNo: true, fabricName: true } },
      vendor: { select: { id: true, vendorName: true } },
      order: { select: { id: true, orderNo: true } },
    },
  });
}
