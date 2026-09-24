/**
 * Cut Pieces Receipt - what the cutting department hands over.
 *
 * ---------------------------------------------------------------------------
 *  WHERE IT SITS
 *
 *      Cutting Challan  ->  fabric cut  ->  CUT PIECES RECEIPT  ->  Cutting Issue
 *      (what cutting         on the floor    (pieces counted in)     (pieces out to
 *       asked for)                                                     stitching)
 *
 *  The receipt is a count, signed for: good pieces, rejected pieces and
 *  handles, from a named cutting master, against an order and normally the
 *  challan they were cut for. It does not touch the stock ledger - fabric
 *  leaves stock on the Cutting Issue, where the fabric equation is checked.
 *
 *  THE NUMBER THE STORE WANTS is "pieces in hand": good pieces received for
 *  the order and style, less what Cutting Issues have already sent out to
 *  stitching. `summary()` answers it, and the screens show it next to every
 *  receipt.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { nextNumber, peekNumber } from './documentNumber.service.js';
import { panelCounts } from '../domain/panels.js';

export const SORTABLE = ['receiptNo', 'receiptDate', 'pcsReceived', 'createdAt'];

const SEARCH = [
  'receiptNo',
  'cuttingMasterName',
  'colorCode',
  'lotNo',
  'remarks',
  'order.orderNo',
  'style.styleNo',
];

const INCLUDE = {
  order: { select: { id: true, orderNo: true, buyer: { select: { id: true, buyerName: true } } } },
  style: {
    select: {
      id: true,
      styleNo: true,
      components: { orderBy: { lineNo: 'asc' } },
    },
  },
  cuttingChallan: { select: { id: true, challanNo: true, challanDate: true } },
  cuttingMaster: { select: { id: true, empId: true, empName: true } },
};

const D = (v) => new Prisma.Decimal(v ?? 0);

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    orderId, styleId, cuttingChallanId, dateFrom, dateTo,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(orderId ? { orderId } : {}),
    ...(styleId ? { styleId } : {}),
    ...(cuttingChallanId ? { cuttingChallanId } : {}),
    ...(dateFrom || dateTo
      ? {
          receiptDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total] = await Promise.all([
    prisma.cutPiecesReceipt.findMany({ where, orderBy, skip, take, include: INCLUDE }),
    prisma.cutPiecesReceipt.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export async function getById(id) {
  const row = await prisma.cutPiecesReceipt.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!row) throw ApiError.notFound('Cut pieces receipt');

  return { ...row, summary: await summary({ orderId: row.orderId, styleId: row.styleId }) };
}

/**
 * Pieces in hand for an order (and style): good pieces counted in from the
 * cutting floor, less the pieces Cutting Issues have sent out to stitching.
 *
 * Cancelled cutting issues are left out - they sent nothing anywhere.
 */
export async function summary({ orderId, styleId } = {}) {
  if (!orderId) throw ApiError.badRequest('Choose an order to see its cut pieces');

  const scope = { orderId, ...(styleId ? { styleId } : {}), deletedAt: null };

  const [received, issued] = await Promise.all([
    prisma.cutPiecesReceipt.aggregate({
      where: scope,
      _sum: { pcsReceived: true, pcsRejected: true, handlesReceived: true, panelsReceived: true },
      _count: { _all: true },
    }),
    prisma.cuttingIssue.aggregate({
      where: { ...scope, status: { not: 'CANCELLED' } },
      _sum: { cuttingPcsIssued: true },
    }),
  ]);

  const pcsReceived = D(received._sum.pcsReceived);
  const pcsIssued = D(issued._sum.cuttingPcsIssued);

  return {
    receipts: received._count._all,
    pcsReceived: pcsReceived.toString(),
    pcsRejected: D(received._sum.pcsRejected).toString(),
    handlesReceived: D(received._sum.handlesReceived).toString(),
    /** Every cut panel counted in, where the style carried a panel list. */
    panelsReceived: D(received._sum.panelsReceived).toString(),
    pcsIssuedToStitching: pcsIssued.toString(),
    pcsInHand: pcsReceived.minus(pcsIssued).toString(),
  };
}

/** The number the next receipt will take, for the form's "will be" hint. */
export async function nextReceiptNo() {
  return { receiptNo: await peekNumber('CUT_PIECES_RECEIPT') };
}

// ===========================================================================
//  WRITES
// ===========================================================================

/**
 * Resolves and checks the references a receipt carries: the order, the style
 * (given, else the challan's, else the order's), the challan (must be for the
 * same order) and the cutting master (an employee, whose name is kept).
 */
async function resolveRefs(tx, input, existing = {}) {
  const orderId = input.orderId ?? existing.orderId;

  const order = await tx.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, orderNo: true, styleId: true, status: true },
  });
  if (!order) throw ApiError.badRequest('That order does not exist', { field: 'orderId' });
  if (order.status === 'CANCELLED') {
    throw ApiError.conflict(`${order.orderNo} is cancelled - pieces cannot be received against it`);
  }

  const challanId = input.cuttingChallanId !== undefined
    ? input.cuttingChallanId
    : existing.cuttingChallanId;

  let challan = null;
  if (challanId) {
    challan = await tx.cuttingChallan.findFirst({
      where: { id: challanId, deletedAt: null },
      select: { id: true, challanNo: true, orderId: true, styleId: true, status: true },
    });
    if (!challan) throw ApiError.badRequest('That cutting challan does not exist', { field: 'cuttingChallanId' });
    if (challan.orderId !== order.id) {
      throw ApiError.badRequest(
        `${challan.challanNo} belongs to a different order than ${order.orderNo}`,
        { field: 'cuttingChallanId' },
      );
    }
    if (challan.status === 'CANCELLED') {
      throw ApiError.conflict(`${challan.challanNo} is cancelled - choose another challan`);
    }
  }

  const styleId = input.styleId ?? challan?.styleId ?? existing.styleId ?? order.styleId;

  const masterId = input.cuttingMasterId !== undefined ? input.cuttingMasterId : existing.cuttingMasterId;
  let masterName = input.cuttingMasterName ?? existing.cuttingMasterName ?? null;
  if (masterId) {
    const emp = await tx.employee.findFirst({
      where: { id: masterId, deletedAt: null },
      select: { id: true, empName: true },
    });
    if (!emp) throw ApiError.badRequest('That employee does not exist', { field: 'cuttingMasterId' });
    if (input.cuttingMasterId !== undefined || !masterName) masterName = emp.empName;
  }
  if (!masterName) {
    throw ApiError.badRequest('Say who handed the pieces over - the cutting master', {
      field: 'cuttingMasterName',
    });
  }

  return {
    orderId: order.id,
    styleId,
    cuttingChallanId: challan?.id ?? null,
    cuttingMasterId: masterId ?? null,
    cuttingMasterName: masterName,
  };
}

/**
 * THE HANDLE AND PANEL COUNTS COME FROM THE STYLE, NOT FROM THE KEYBOARD.
 *
 * Where the style has a panel list, handles received is good pieces x handles
 * per bag, and the panels are counted component by component. Both are frozen
 * on the receipt together with the multiplier, so a later correction to the
 * style does not rewrite what this receipt says was counted.
 *
 * A style with no panel list keeps the typed handle count it always had -
 * treating it as zero would under-count every receipt for an old style.
 */
async function derivePanels(tx, styleId, pcsReceived, typedHandles) {
  const components = await tx.styleComponent.findMany({
    where: { styleId },
    orderBy: { lineNo: 'asc' },
  });
  const counts = panelCounts(components, pcsReceived);
  if (!counts) {
    return {
      handlesReceived: D(typedHandles),
      panelsPerBag: null,
      handlesPerBag: null,
      panelsReceived: null,
      panelBreakdown: Prisma.DbNull,
    };
  }
  return {
    handlesReceived: D(counts.handles),
    panelsPerBag: counts.panelsPerBag,
    handlesPerBag: counts.handlesPerBag,
    panelsReceived: D(counts.panels),
    panelBreakdown: counts.breakdown,
  };
}

function assertCounts({ pcsReceived, pcsRejected, handlesReceived }) {
  if (D(pcsReceived).plus(D(pcsRejected)).plus(D(handlesReceived)).lte(0)) {
    throw ApiError.badRequest('Enter the pieces received - a receipt of nothing is not a receipt', {
      field: 'pcsReceived',
    });
  }
}

export async function create(input, actor = {}) {
  assertCounts(input);

  const id = await prisma.$transaction(async (tx) => {
    const refs = await resolveRefs(tx, input);
    const receiptNo = await nextNumber('CUT_PIECES_RECEIPT', { tx });
    const panels = await derivePanels(tx, refs.styleId, input.pcsReceived, input.handlesReceived);

    const row = await tx.cutPiecesReceipt.create({
      data: {
        receiptNo,
        receiptDate: input.receiptDate ? new Date(input.receiptDate) : new Date(),
        ...refs,
        colorCode: input.colorCode ?? null,
        lotNo: input.lotNo ?? null,
        pcsReceived: D(input.pcsReceived),
        pcsRejected: D(input.pcsRejected),
        ...panels,
        receivedByName: actor.fullName ?? null,
        remarks: input.remarks ?? null,
        createdById: actor.userId ?? null,
        updatedById: actor.userId ?? null,
      },
      select: { id: true },
    });
    return row.id;
  });

  return getById(id);
}

export async function update(id, input, actor = {}) {
  const existing = await prisma.cutPiecesReceipt.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw ApiError.notFound('Cut pieces receipt');

  const counts = {
    pcsReceived: input.pcsReceived ?? existing.pcsReceived,
    pcsRejected: input.pcsRejected ?? existing.pcsRejected,
    handlesReceived: input.handlesReceived ?? existing.handlesReceived,
  };
  assertCounts(counts);

  await prisma.$transaction(async (tx) => {
    const refs = await resolveRefs(tx, input, existing);
    const panels = await derivePanels(tx, refs.styleId, counts.pcsReceived, counts.handlesReceived);
    await tx.cutPiecesReceipt.update({
      where: { id },
      data: {
        ...refs,
        ...(input.receiptDate ? { receiptDate: new Date(input.receiptDate) } : {}),
        ...(input.colorCode !== undefined ? { colorCode: input.colorCode } : {}),
        ...(input.lotNo !== undefined ? { lotNo: input.lotNo } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        pcsReceived: D(counts.pcsReceived),
        pcsRejected: D(counts.pcsRejected),
        ...panels,
        updatedById: actor.userId ?? null,
      },
    });
  });

  return getById(id);
}

/** Soft delete - the row stays for the audit trail. */
export async function remove(id, actorId) {
  const existing = await prisma.cutPiecesReceipt.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw ApiError.notFound('Cut pieces receipt');

  await prisma.cutPiecesReceipt.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId ?? null },
  });
  return { id, deleted: true };
}
