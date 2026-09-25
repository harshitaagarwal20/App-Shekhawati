/**
 * Vendor Quotation. Sheet: "Vendor Quotation-Approval"
 * (Role Acess - Procurement Dept (Manager) - Approved by Dinesh Sir).
 *
 * ---------------------------------------------------------------------------
 *  AMOUNT IS A SERVER FORMULA, NOT A FIELD
 *
 *      amount = qty x rateQuoted
 *
 *  The workbook holds Amount as a spreadsheet formula. Here it is recomputed
 *  on every write from the quantity and the rate, and `amount` is not present
 *  in ANY input schema - Zod strips it, so a client that posts an amount has it
 *  discarded before this file runs. There is no code path in the application
 *  that writes a client-supplied amount, and a CHECK constraint on the table
 *  refuses any row where amount <> round(rate x qty, 2) as a last defence.
 *
 *  This matters because the amount is what the Director approves and what the
 *  purchase order is later raised against. A number the browser worked out is
 *  a number a user can tamper with.
 * ---------------------------------------------------------------------------
 *
 * The decision workflow mirrors the sheet's "Authorisation Status" column:
 *
 *   PENDING   raised by Procurement, waiting on Dinesh Sir
 *   APPROVED  may be converted into a purchase order
 *   REJECTED  reasoned, and cannot be converted
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { OPTIONS_LIMIT, searchFilter } from '../utils/http.js';
import { assertAccessoryVariety, assertValueInList } from './masterList.service.js';
import { nextNumber } from './documentNumber.service.js';
import * as engine from './approvalEngine.js';
import { documentStatus, duplicateMaterial, lineNumber } from '../domain/documentLines.js';

export const SORTABLE = [
  'quotationNo',
  'quotationDate',
  'item',
  'qty',
  'rateQuoted',
  'amount',
  'authorisationStatus',
  'createdAt',
];

const SEARCH = ['quotationNo', 'item', 'subCategory', 'accessoriesItem', 'accessoryType', 'remarks'];

/** Filtering the line list down to one document. */
const byHeader = (headerId) => (headerId ? { headerId } : {});

const D = (v) => new Prisma.Decimal(v ?? 0);

const INCLUDE = {
  header: {
    select: {
      id: true,
      quotationNo: true,
      vendorRefNo: true,
      validUntil: true,
      _count: { select: { lines: { where: { deletedAt: null } } } },
    },
  },
  vendor: {
    select: {
      id: true,
      vendorCode: true,
      vendorName: true,
      category: true,
      status: true,
      gstNo: true,
    },
  },
  order: {
    select: {
      id: true,
      orderNo: true,
      orderQty: true,
      effectiveQty: true,
      status: true,
      buyer: { select: { id: true, buyerName: true } },
      style: { select: { id: true, styleNo: true } },
    },
  },
};

const LIST_INCLUDE = {
  vendor: { select: { id: true, vendorCode: true, vendorName: true, category: true } },
  order: { select: { id: true, orderNo: true } },
  // Multi-line: the vendor quote document this row is one item of.
  header: { select: { id: true, quotationNo: true, _count: { select: { lines: { where: { deletedAt: null } } } } } },
};

// ===========================================================================
//  CALCULATION - the single place an amount is derived
// ===========================================================================

/**
 * Excel: "Amount" (Formula: Rate x Qty).
 *
 * Rounded to 2 decimals, which is the scale the column stores, so what is
 * written back always equals what the table's CHECK constraint recomputes.
 *
 * @param {Prisma.Decimal|string|number} qty
 * @param {Prisma.Decimal|string|number} rateQuoted
 * @returns {Prisma.Decimal}
 */
export function calculateAmount(qty, rateQuoted) {
  return D(qty).mul(D(rateQuoted)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

// ===========================================================================
//  VALIDATION HELPERS
// ===========================================================================

const LIST_FIELDS = [
  ['item', 'ItemCategory'],
  ['uom', 'UOM'],
  ['authorisedBy', 'AuthorisedBy'],
];

async function validateDropdowns(data, existing = null) {
  for (const [field, listCode] of LIST_FIELDS) {
    if (data[field] === undefined) continue;
    await assertValueInList(listCode, data[field], { field });
  }
  // Sub-category and accessory detail follow the item, exactly as on the PO sheet.
  if (data.subCategory !== undefined) {
    await assertValueInList('FabricSubCat', data.subCategory, { field: 'subCategory' });
  }
  if (data.accessoriesItem !== undefined) {
    await assertValueInList('AccessoriesItem', data.accessoriesItem, { field: 'accessoriesItem' });
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

/** Loads the vendor being quoted, and refuses one who cannot be bought from. */
async function resolveVendor(vendorId) {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, deletedAt: null } });
  if (!vendor) throw ApiError.badRequest('Vendor does not exist', { field: 'vendorId' });
  if (vendor.status !== 'ACTIVE') {
    throw ApiError.badRequest(`Vendor "${vendor.vendorName}" is inactive`, { field: 'vendorId' });
  }
  return vendor;
}

/** The order a quotation is raised for, when one is named. */
async function resolveOrder(orderId) {
  if (!orderId) return null;
  const order = await prisma.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, orderNo: true, status: true },
  });
  if (!order) throw ApiError.badRequest('Order does not exist', { field: 'orderId' });
  if (order.status === 'CANCELLED') {
    throw ApiError.badRequest(
      `Order ${order.orderNo} is cancelled - a quotation cannot be raised against it`,
      { field: 'orderId' },
    );
  }
  return order;
}

/** Counts what has been raised against a quotation. */
async function downstreamUsage(quotationId) {
  const purchaseOrders = await prisma.purchaseOrder.count({
    where: { quotationId, deletedAt: null },
  });
  return { purchaseOrders, total: purchaseOrders };
}

/** Explains, in one place, whether and how a quotation may be changed. */
function editability(quotation, usage) {
  const decided = quotation.authorisationStatus !== 'PENDING';
  return {
    /** A decided quotation is a record of what was decided; it stops moving. */
    canEdit: !decided && usage.total === 0,
    canDecide: !decided,
    canDelete: usage.total === 0 && !decided,
    /** Only an approved quotation can become a purchase order. */
    canConvertToPo: quotation.authorisationStatus === 'APPROVED',
    lockedBy: usage.purchaseOrders > 0 ? [`${usage.purchaseOrders} purchase order(s)`] : [],
  };
}

// ===========================================================================
//  PROJECTION
// ===========================================================================

function project(q) {
  if (!q) return q;
  return {
    ...q,
    /** Restated so the client never multiplies anything to show the total. */
    amountCalculation: `${D(q.qty).toFixed(4)} x ${D(q.rateQuoted).toFixed(4)}`,
    decided: q.authorisationStatus !== 'PENDING',
    approved: q.authorisationStatus === 'APPROVED',
  };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    authorisationStatus, vendorId, orderId, item, uom, dateFrom, dateTo, headerId,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...byHeader(headerId),
    ...(authorisationStatus ? { authorisationStatus } : {}),
    ...(vendorId ? { vendorId } : {}),
    ...(orderId ? { orderId } : {}),
    ...(item ? { item } : {}),
    ...(uom ? { uom } : {}),
    ...(dateFrom || dateTo
      ? {
          quotationDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total] = await Promise.all([
    prisma.vendorQuotation.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.vendorQuotation.count({ where }),
  ]);

  return { rows: rows.map(project), total, page, pageSize };
}

/** Full detail: the quotation, its competitors, editability and the trail. */
export async function getById(id) {
  const quotation = await prisma.vendorQuotation.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!quotation) throw ApiError.notFound('Quotation');

  const [usage, history, competing] = await Promise.all([
    downstreamUsage(id),
    prisma.approvalHistory.findMany({
      where: { documentType: 'VENDOR_QUOTATION', documentId: id },
      orderBy: { actedAt: 'asc' },
    }),
    competingQuotations(quotation),
  ]);

  return {
    ...project(quotation),
    // F-10: read by withApprovability() in the controller, then removed.
    createdById: quotation.createdById,
    competing,
    usage,
    editable: editability(quotation, usage),
    history,
  };
}

/**
 * The other quotations for the same thing, cheapest first.
 *
 * The sheet's "Lowest of 3 quotes" remark is the whole reason this document
 * exists in triplicate. Rather than leave the approver to eyeball it, the
 * comparison is computed - on the server, from the stored amounts.
 */
async function competingQuotations(quotation) {
  const siblings = await prisma.vendorQuotation.findMany({
    where: {
      deletedAt: null,
      id: { not: quotation.id },
      item: quotation.item,
      ...(quotation.orderId ? { orderId: quotation.orderId } : { orderId: null }),
      ...(quotation.subCategory ? { subCategory: quotation.subCategory } : {}),
      ...(quotation.accessoriesItem ? { accessoriesItem: quotation.accessoriesItem } : {}),
    },
    include: LIST_INCLUDE,
    orderBy: { rateQuoted: 'asc' },
  });

  const all = [quotation, ...siblings];
  const lowest = all.reduce((a, q) => (D(q.rateQuoted).lessThan(D(a.rateQuoted)) ? q : a), all[0]);

  return {
    count: siblings.length,
    /** True when this quotation is the cheapest rate on the table. */
    isLowestRate: lowest.id === quotation.id,
    lowestRate: D(lowest.rateQuoted).toFixed(4),
    lowestRateVendor: lowest.vendor?.vendorName ?? null,
    /** What picking this one costs over the cheapest, on this quantity. */
    premiumOverLowest: calculateAmount(quotation.qty, D(quotation.rateQuoted).minus(D(lowest.rateQuoted))).toFixed(2),
    quotations: siblings.map(project),
  };
}

// ===========================================================================
//  COMMANDS
// ===========================================================================

/**
 * Raises a quotation.
 *
 * quotationNo comes from the VENDOR_QUOTATION sequence (QT-001) unless
 * Procurement supplies the vendor's own reference.
 */
export async function create(input, actorId) {
  // A single quotation is a one-line document, numbered exactly as before.
  const { lines } = await createDocumentInternal(
    {
      quotationNo: input.quotationNo,
      quotationDate: input.quotationDate,
      vendorId: input.vendorId,
      orderId: input.orderId,
      authorisedBy: input.authorisedBy,
      lines: [input],
    },
    actorId,
  );
  return project(lines[0].quotation);
}

/**
 * MULTI-LINE: one vendor quote covering several items.
 *
 * One header and N lines in one transaction. Each line is exactly what a
 * single quotation always was - its own amount, its own authorisation - so
 * the Director may approve the zipper and refuse the webbing on the same
 * quote. Line 1 carries the document number bare; see domain/documentLines.js.
 */
export async function createDocument(input, actorId) {
  const { header } = await createDocumentInternal(input, actorId);
  return getDocument(header.id);
}

async function createDocumentInternal(input, actorId) {
  if (!input.lines?.length) {
    throw ApiError.badRequest('A quotation needs at least one item', { field: 'lines' });
  }
  const vendor = await resolveVendor(input.vendorId);
  const order = await resolveOrder(input.orderId);
  for (const line of input.lines) await validateDropdowns(line);

  const dup = duplicateMaterial(input.lines, (l) =>
    [l.item, l.subCategory ?? '', l.accessoriesItem ?? '', l.accessoryType ?? '', l.uom].join('|'),
  );
  if (dup) {
    throw ApiError.badRequest(
      `Lines ${dup.first + 1} and ${dup.second + 1} quote the same item. Combine them into one line.`,
      { field: `lines.${dup.second}` },
    );
  }

  const quotationNo = input.quotationNo?.trim() || (await nextNumber('VENDOR_QUOTATION'));
  const [clash, headerClash] = await Promise.all([
    prisma.vendorQuotation.findUnique({ where: { quotationNo }, select: { id: true } }),
    prisma.vendorQuotationHeader.findUnique({ where: { quotationNo }, select: { id: true } }),
  ]);
  if (clash || headerClash) {
    throw ApiError.conflict('This quotation number already exists', { field: 'quotationNo' });
  }

  const quotationDate = input.quotationDate ? new Date(input.quotationDate) : new Date();

  const created = await prisma.$transaction(async (tx) => {
    const header = await tx.vendorQuotationHeader.create({
      data: {
        quotationNo,
        quotationDate,
        vendorId: vendor.id,
        orderId: order?.id ?? null,
        vendorRefNo: input.vendorRefNo ?? null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        remarks: input.remarks ?? null,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    const lines = [];
    for (const [i, line] of input.lines.entries()) {
      const lineOrder = line.orderId && line.orderId !== order?.id ? await resolveOrder(line.orderId) : order;
      lines.push(
        await createLine(tx, line, {
          header,
          lineNo: i + 1,
          vendor,
          order: lineOrder,
          authorisedBy: line.authorisedBy ?? input.authorisedBy,
          actorId,
        }),
      );
    }
    return { header, lines };
  });

  for (const { quotation, amount, input: line } of created.lines) {
    await recordHistory(quotation, 'SUBMITTED', {
      toStatus: 'PENDING',
      actorId,
      remarks:
        `Quotation raised: ${D(line.qty).toFixed(4)} ${line.uom} at ${D(line.rateQuoted).toFixed(4)} ` +
        `= ${amount.toFixed(2)}` +
        (created.lines.length > 1 ? ` (line ${quotation.lineNo} of ${created.lines.length})` : ''),
    });
  }

  return created;
}

/** One line of a quote document, on the caller's transaction. */
async function createLine(tx, input, { header, lineNo, vendor, order, authorisedBy, actorId }) {
  // THE formula. Nothing the client sent contributes to it but qty and rate.
  const amount = calculateAmount(input.qty, input.rateQuoted);

  const quotation = await tx.vendorQuotation.create({
    data: {
      headerId: header.id,
      lineNo,
      quotationNo: lineNumber(header.quotationNo, lineNo),
      quotationDate: header.quotationDate,
      item: input.item,
      subCategory: input.subCategory ?? null,
      accessoriesItem: input.accessoriesItem ?? null,
      accessoryType: input.accessoryType ?? null,
      vendorId: vendor.id,
      rateQuoted: D(input.rateQuoted),
      uom: input.uom,
      qty: D(input.qty),
      amount,
      authorisedBy: authorisedBy ?? null,
      // A quotation is always raised pending; nobody self-approves on create.
      authorisationStatus: 'PENDING',
      remarks: input.remarks ?? null,
      orderId: order?.id ?? null,
      createdById: actorId,
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  return { quotation, amount, input };
}

// ---------------------------------------------------------------------------
//  THE DOCUMENT - header, lines, totals, and decisions on all of it at once
// ---------------------------------------------------------------------------

export async function getDocument(headerId) {
  const header = await prisma.vendorQuotationHeader.findFirst({
    where: { id: headerId, deletedAt: null },
    include: {
      vendor: INCLUDE.vendor,
      lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' }, include: { order: { select: { id: true, orderNo: true } } } },
    },
  });
  if (!header) throw ApiError.notFound('Quotation');
  const order = header.orderId
    ? await prisma.buyerOrder.findUnique({ where: { id: header.orderId }, select: { id: true, orderNo: true } })
    : null;
  const lines = header.lines.map(project);
  const history = await prisma.approvalHistory.findMany({
    where: { documentType: 'VENDOR_QUOTATION', documentId: { in: header.lines.map((l) => l.id) } },
    orderBy: { actedAt: 'asc' },
  });
  return {
    ...header,
    order,
    lines,
    lineCount: lines.length,
    totalAmount: lines.reduce((a, l) => a.plus(D(l.amount)), D(0)).toFixed(2),
    status: documentStatus(lines.map((l) => ({ status: l.authorisationStatus }))),
    pendingLines: lines.filter((l) => l.authorisationStatus === 'PENDING').length,
    history,
  };
}

/** Approves every pending line of a quote. Each line is decided as it always was. */
export async function approveDocument(headerId, { remarks } = {}, actor) {
  const doc = await getDocument(headerId);
  const pending = doc.lines.filter((l) => l.authorisationStatus === 'PENDING');
  if (!pending.length) throw ApiError.badRequest('Nothing on this quotation is waiting for a decision.');
  for (const line of pending) await approve(line.id, { remarks }, actor);
  return getDocument(headerId);
}

export async function rejectDocument(headerId, { reason }, actor) {
  const doc = await getDocument(headerId);
  const pending = doc.lines.filter((l) => l.authorisationStatus === 'PENDING');
  if (!pending.length) throw ApiError.badRequest('Nothing on this quotation is waiting for a decision.');
  for (const line of pending) await reject(line.id, { reason }, actor);
  return getDocument(headerId);
}

/**
 * Edits a quotation while it is still pending.
 *
 * Any move in quantity or rate recomputes the amount. A quotation that has been
 * decided is a record of what was decided and does not move at all - the
 * vendor is asked for a fresh quotation instead.
 */
export async function update(id, input, actorId) {
  const existing = await prisma.vendorQuotation.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw ApiError.notFound('Quotation');

  const usage = await downstreamUsage(id);
  const editable = editability(existing, usage);
  if (!editable.canEdit) {
    throw ApiError.conflict(
      existing.authorisationStatus !== 'PENDING'
        ? `This quotation was already ${existing.authorisationStatus.toLowerCase()} and cannot be ` +
          'edited. Raise a fresh quotation instead.'
        : `This quotation already has ${usage.purchaseOrders} purchase order(s) against it.`,
      { authorisationStatus: existing.authorisationStatus, usage },
    );
  }

  await validateDropdowns(input, existing);
  if (input.vendorId !== undefined) await resolveVendor(input.vendorId);
  if (input.orderId !== undefined) await resolveOrder(input.orderId);

  const qty = input.qty !== undefined ? D(input.qty) : D(existing.qty);
  const rateQuoted =
    input.rateQuoted !== undefined ? D(input.rateQuoted) : D(existing.rateQuoted);

  // Recomputed on every write, whether or not qty or rate were the fields that
  // moved - so the amount can never drift away from the two numbers behind it.
  const amount = calculateAmount(qty, rateQuoted);

  const quotation = await prisma.vendorQuotation.update({
    where: { id },
    data: {
      ...(input.quotationNo !== undefined ? { quotationNo: input.quotationNo } : {}),
      ...(input.quotationDate !== undefined
        ? { quotationDate: new Date(input.quotationDate) }
        : {}),
      ...(input.item !== undefined ? { item: input.item } : {}),
      ...(input.subCategory !== undefined ? { subCategory: input.subCategory } : {}),
      ...(input.accessoriesItem !== undefined ? { accessoriesItem: input.accessoriesItem } : {}),
      ...(input.accessoryType !== undefined ? { accessoryType: input.accessoryType } : {}),
      ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
      ...(input.uom !== undefined ? { uom: input.uom } : {}),
      ...(input.authorisedBy !== undefined ? { authorisedBy: input.authorisedBy } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
      qty,
      rateQuoted,
      amount,
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  return project(quotation);
}

// ---------------------------------------------------------------------------
//  The decision - "Approved by Dinesh Sir"
// ---------------------------------------------------------------------------

/**
 * Approves the quotation. The amount is recomputed one last time and stamped,
 * so what is approved is provably rate x qty and not whatever a stale row held.
 */
export async function approve(id, { remarks }, actor) {
  const quotation = await prisma.vendorQuotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) throw ApiError.notFound('Quotation');

  if (quotation.authorisationStatus !== 'PENDING') {
    throw ApiError.badRequest(
      `This quotation is already ${quotation.authorisationStatus.toLowerCase()}.`,
    );
  }

  const amount = calculateAmount(quotation.qty, quotation.rateQuoted);
  const decidedAt = new Date();

  /*
   * THE DECISION GOES THROUGH THE ENGINE.
   *
   * It used to be written here by hand - `authorisationStatus` and the stamps,
   * and nothing else. `workflowState` was never touched, so an approved
   * quotation kept sitting at PENDING_APPROVAL for ever: the approval queue
   * reads the workflow column and went on offering quotations that had already
   * been decided days earlier, while the pending-quotations report - which
   * reads `authorisationStatus` - correctly showed none. Two screens, two
   * answers, one document.
   *
   * `engine.approve()` writes BOTH columns in one guarded update through the
   * registry's legacy mapping, applies the maker-checker rule this document
   * type declares, and appends the trail entry itself. That is also what makes
   * the decision safe against a second approver clicking at the same moment.
   */
  await prisma.$transaction(async (tx) => {
    await engine.approve(tx, {
      documentType: 'VENDOR_QUOTATION',
      documentId: id,
      actor,
      remarks: remarks ?? `Approved at ${amount.toFixed(2)}`,
      data: {
        authorisedBy: quotation.authorisedBy ?? actor.fullName,
        approvedByName: actor.fullName,
        approvedById: actor.userId,
        approvedAt: decidedAt,
        decidedAt,
        rejectionReason: null,
        // Recomputed and stamped one last time, so what is authorised is
        // provably qty x rate and not whatever a stale row held.
        amount,
      },
    });
  });

  const updated = await prisma.vendorQuotation.findUnique({
    where: { id },
    include: LIST_INCLUDE,
  });
  return project(updated);
}

/** Rejects the quotation, with a reason. It can never become a purchase order. */
export async function reject(id, { reason }, actor) {
  const quotation = await prisma.vendorQuotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) throw ApiError.notFound('Quotation');

  if (quotation.authorisationStatus !== 'PENDING') {
    throw ApiError.badRequest(
      `This quotation is already ${quotation.authorisationStatus.toLowerCase()}.`,
    );
  }

  const decidedAt = new Date();

  // Through the engine, for the same reason approve() is - a rejected
  // quotation has to leave the approval queue too.
  await prisma.$transaction(async (tx) => {
    await engine.reject(tx, {
      documentType: 'VENDOR_QUOTATION',
      documentId: id,
      actor,
      reason,
      data: {
        authorisedBy: quotation.authorisedBy ?? actor.fullName,
        approvedByName: actor.fullName,
        approvedById: actor.userId,
        approvedAt: null,
        decidedAt,
        rejectionReason: reason,
      },
    });
  });

  const updated = await prisma.vendorQuotation.findUnique({
    where: { id },
    include: LIST_INCLUDE,
  });
  return project(updated);
}

/**
 * Reopens a decided quotation for a fresh decision.
 *
 * Refused once a purchase order has been raised: that PO was authorised by this
 * approval, and undoing the approval underneath it would leave the PO standing
 * on nothing.
 */
export async function reopen(id, { reason }, actor) {
  const quotation = await prisma.vendorQuotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) throw ApiError.notFound('Quotation');
  if (quotation.authorisationStatus === 'PENDING') {
    throw ApiError.badRequest('This quotation has not been decided yet.');
  }

  const usage = await downstreamUsage(id);
  if (usage.purchaseOrders > 0) {
    throw ApiError.conflict(
      `This quotation has ${usage.purchaseOrders} purchase order(s) raised on the strength of its ` +
        'approval and cannot be reopened.',
      { usage },
    );
  }

  // Reopening does NOT go through the engine: APPROVED is terminal in the
  // transition table, deliberately, and this is the module-specific escape
  // that has just proved no purchase order was built on the approval. The
  // state is wound back to PENDING_APPROVAL by hand, in the same transaction
  // as the trail entry that explains why - and `workflowState` is wound back
  // WITH `authorisationStatus`, so the quotation genuinely returns to the
  // approval queue rather than only looking undecided on the report.
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.vendorQuotation.update({
      where: { id },
      data: {
        workflowState: 'PENDING_APPROVAL',
        authorisationStatus: 'PENDING',
        approvedByName: null,
        approvedById: null,
        approvedAt: null,
        decidedAt: null,
        rejectionReason: null,
        updatedById: actor.userId,
      },
      include: LIST_INCLUDE,
    });

    await engine.record(tx, {
      documentType: 'VENDOR_QUOTATION',
      documentId: id,
      documentNo: row.quotationNo,
      action: 'REOPENED',
      fromStatus: quotation.authorisationStatus,
      toStatus: 'PENDING_APPROVAL',
      actor,
      remarks: reason,
    });

    return row;
  });

  return project(updated);
}

/** Soft delete. Refused once a purchase order exists or a decision was taken. */
export async function remove(id, actorId) {
  const quotation = await prisma.vendorQuotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) throw ApiError.notFound('Quotation');

  const usage = await downstreamUsage(id);
  if (usage.purchaseOrders > 0) {
    throw ApiError.conflict(
      `This quotation has ${usage.purchaseOrders} purchase order(s) against it and cannot be deleted.`,
      { usage },
    );
  }
  if (quotation.authorisationStatus !== 'PENDING') {
    throw ApiError.conflict(
      'A decided quotation is the record of that decision and cannot be deleted.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.vendorQuotation.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actorId },
    });
    // The last live line takes its document with it.
    const left = await tx.vendorQuotation.count({ where: { headerId: quotation.headerId, deletedAt: null } });
    if (left === 0) {
      await tx.vendorQuotationHeader.update({
        where: { id: quotation.headerId },
        data: { deletedAt: new Date(), deletedById: actorId },
      });
    }
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
//  Helpers and previews
// ---------------------------------------------------------------------------

async function recordHistory(q, action, { fromStatus, toStatus, actorId, actorName, remarks }) {
  const previous = await prisma.approvalHistory.count({
    where: { documentType: 'VENDOR_QUOTATION', documentId: q.id },
  });
  await prisma.approvalHistory.create({
    data: {
      documentType: 'VENDOR_QUOTATION',
      documentId: q.id,
      documentNo: q.quotationNo,
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
 * The amount for a quantity and rate that have not been saved yet.
 *
 * The create form calls this rather than multiplying in the browser, for the
 * same reason the saved amount is computed here: the figure the user sees and
 * the figure the server stores must come from one piece of code.
 */
export async function previewAmount({ qty, rateQuoted }) {
  const amount = calculateAmount(qty, rateQuoted);
  return {
    qty: D(qty).toFixed(4),
    rateQuoted: D(rateQuoted).toFixed(4),
    amount: amount.toFixed(2),
    formula: 'Amount = Qty x Rate',
  };
}

/**
 * Every quotation raised for one order, grouped by what was being bought, with
 * the cheapest rate in each group marked. This is the approver's screen.
 */
export async function compareForOrder(orderId) {
  const order = await prisma.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, orderNo: true, orderQty: true, effectiveQty: true },
  });
  if (!order) throw ApiError.notFound('Order');

  const quotations = await prisma.vendorQuotation.findMany({
    where: { orderId, deletedAt: null },
    include: LIST_INCLUDE,
    orderBy: [{ item: 'asc' }, { rateQuoted: 'asc' }],
  });

  const groups = new Map();
  for (const q of quotations) {
    const key = [q.item, q.subCategory, q.accessoriesItem].filter(Boolean).join(' / ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  return {
    order,
    groups: [...groups.entries()].map(([key, rows]) => {
      const lowest = rows.reduce(
        (a, q) => (D(q.rateQuoted).lessThan(D(a.rateQuoted)) ? q : a),
        rows[0],
      );
      return {
        item: key,
        count: rows.length,
        lowestRate: D(lowest.rateQuoted).toFixed(4),
        lowestRateVendor: lowest.vendor?.vendorName ?? null,
        approvedCount: rows.filter((q) => q.authorisationStatus === 'APPROVED').length,
        quotations: rows.map((q) => ({
          ...project(q),
          isLowestRate: q.id === lowest.id,
        })),
      };
    }),
  };
}

/** Approved-quotation dropdown for the Purchase Order module. */
export async function options({ orderId, vendorId, approvedOnly } = {}) {
  return prisma.vendorQuotation.findMany({
    where: {
      deletedAt: null,
      ...(orderId ? { orderId } : {}),
      ...(vendorId ? { vendorId } : {}),
      ...(approvedOnly ? { authorisationStatus: 'APPROVED' } : {}),
    },
    orderBy: { quotationDate: 'desc' },
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      quotationNo: true,
      item: true,
      subCategory: true,
      accessoriesItem: true,
      accessoryType: true,
      uom: true,
      qty: true,
      rateQuoted: true,
      amount: true,
      authorisationStatus: true,
      vendor: { select: { id: true, vendorName: true, vendorCode: true } },
      order: { select: { id: true, orderNo: true } },
    },
  });
}
