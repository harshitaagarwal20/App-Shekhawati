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
 *  challan they were cut for.
 *
 *  It is also where the FABRIC is accounted for (C6): the cloth those pieces
 *  were cut from - consumed, returned to the store on its roll, kept as
 *  remnants, wasted, damaged - has to add up to what came onto the floor, and
 *  posting the receipt takes it off the cutting floor in the ledger, in the
 *  same transaction. See cuttingFabric.service.js. The Cutting Issue that
 *  later sends the pieces to stitching moves no cloth.
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
import { DEFAULT_ACCEPT_LIMIT_PCT, judgeSample } from '../domain/cutCheck.js';
import * as excess from './excess.service.js';
import {
  assertFabricBalances,
  postCuttingFabric,
  reconcileFabric,
  resolveCuttingFabricIssue,
} from './cuttingFabric.service.js';

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
  defects: { orderBy: { lineNo: 'asc' } },
  fabricIssue: {
    select: {
      id: true,
      issueNo: true,
      fabricQtyIssued: true,
      uom: true,
      roll: { select: { id: true, rollNo: true, fabricName: true } },
    },
  },
};

/** The six fabric quantities, in the order the equation reads. */
const FABRIC_QTYS = [
  'issuedQty',
  'consumedQty',
  'remainderQty',
  'remnantQty',
  'wastageQty',
  'fabricDamageQty',
];

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
 * READY is the number that matters before stitching: pieces from lots whose
 * sample check PASSED, less the defective pieces pulled out of them, less what
 * has been issued. Pieces still waiting for a check, or from a lot that failed
 * one, are in hand but not ready.
 *
 * `defects` answers "which pieces will give trouble": every defect found in
 * the order's sample checks, by panel and type, worst first.
 *
 * Cancelled and unposted cutting issues are left out - they sent nothing.
 */
export async function summary({ orderId, styleId } = {}) {
  if (!orderId) throw ApiError.badRequest('Choose an order to see its cut pieces');
  return piecesPosition(prisma, { orderId, styleId });
}

/**
 * The arithmetic behind `summary()`, on any client, so the Cutting Issue can
 * run it inside its posting transaction. `excludeIssueId` leaves out the
 * issue being posted, which is not yet "already issued".
 */
export async function piecesPosition(client, { orderId, styleId, excludeIssueId } = {}) {
  const scope = { orderId, ...(styleId ? { styleId } : {}), deletedAt: null };

  const [byStatus, issued, defects] = await Promise.all([
    client.cutPiecesReceipt.groupBy({
      by: ['checkStatus'],
      where: scope,
      _sum: {
        pcsReceived: true,
        pcsRejected: true,
        handlesReceived: true,
        panelsReceived: true,
        defectivePcs: true,
      },
      _count: { _all: true },
    }),
    // POSTED challans only: a draft has not sent anything to stitching, and
    // counting it would let paperwork nobody posted hold checked pieces back.
    client.cuttingIssue.aggregate({
      where: {
        ...scope,
        status: { not: 'CANCELLED' },
        postedAt: { not: null },
        ...(excludeIssueId ? { id: { not: excludeIssueId } } : {}),
      },
      _sum: { cuttingPcsIssued: true },
    }),
    client.cutPieceDefect.groupBy({
      by: ['panel', 'defectType'],
      where: { receipt: scope },
      _sum: { qty: true },
      orderBy: { _sum: { qty: 'desc' } },
    }),
  ]);

  const groups = (status) => byStatus.filter((g) => !status || g.checkStatus === status);
  const sum = (field, status) => groups(status).reduce((a, g) => a.plus(D(g._sum[field])), D(0));
  const count = (status) => groups(status).reduce((a, g) => a + g._count._all, 0);

  const pcsReceived = sum('pcsReceived');
  const pcsIssued = D(issued._sum.cuttingPcsIssued);
  const pcsPassed = sum('pcsReceived', 'PASSED').minus(sum('defectivePcs', 'PASSED'));

  return {
    receipts: count(),
    pcsReceived: pcsReceived.toString(),
    pcsRejected: sum('pcsRejected').toString(),
    handlesReceived: sum('handlesReceived').toString(),
    /** Every cut panel counted in, where the style carried a panel list. */
    panelsReceived: sum('panelsReceived').toString(),
    pcsIssuedToStitching: pcsIssued.toString(),
    pcsInHand: pcsReceived.minus(pcsIssued).toString(),

    /** Lots not yet checked, and the pieces in them. */
    lotsPendingCheck: count('PENDING'),
    pcsPendingCheck: sum('pcsReceived', 'PENDING').toString(),
    /** Lots that failed their sample: to be sorted and checked again. */
    lotsFailedCheck: count('FAILED'),
    pcsFailedCheck: sum('pcsReceived', 'FAILED').toString(),
    /** Defective pieces found in samples and pulled out of their lots. */
    pcsDefective: sum('defectivePcs').toString(),
    /** Checked, passed, not yet issued: what may go to stitching now. */
    pcsReadyToIssue: pcsPassed.minus(pcsIssued).toString(),

    defects: defects.map((d) => ({
      panel: d.panel,
      defectType: d.defectType,
      qty: D(d._sum.qty).toString(),
    })),
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

/**
 * C6 - THE FABRIC ON THIS RECEIPT, TAKEN OFF THE CUTTING FLOOR.
 *
 * Runs inside the receipt's own transaction, so the receipt and its ledger
 * legs are saved together or not at all. Returns the columns to write - the
 * figures, and the stamp that proves the ledger moved - or nothing at all
 * when the receipt carries no fabric.
 */
async function postFabric(tx, { receipt, input, refs, actor }) {
  const figures = Object.fromEntries(FABRIC_QTYS.map((k) => [k, D(input[k])]));
  if (!figures.issuedQty.greaterThan(0)) {
    if (FABRIC_QTYS.some((k) => figures[k].greaterThan(0))) {
      throw ApiError.badRequest(
        'Enter the fabric received on the floor - the other quantities are parts of it.',
        { field: 'issuedQty' },
      );
    }
    return { fabricIssueId: input.fabricIssueId ?? null };
  }

  if (!input.fabricIssueId) {
    throw ApiError.badRequest(
      'Choose the fabric issue the cloth came from, so it can be taken off the right roll.',
      { field: 'fabricIssueId' },
    );
  }

  assertFabricBalances(reconcileFabric(figures), `Receipt ${receipt.receiptNo}`);

  const fabricIssue = await resolveCuttingFabricIssue(tx, input.fabricIssueId, {
    orderId: refs.orderId,
    label: 'this receipt',
  });
  const uom = input.fabricUom ?? fabricIssue.uom ?? 'Mtrs';

  const ledger = await postCuttingFabric(tx, {
    doc: {
      documentType: 'CUT_PIECES_RECEIPT',
      id: receipt.id,
      no: receipt.receiptNo,
      date: receipt.receiptDate,
      orderId: refs.orderId,
      uom,
    },
    fabricIssue,
    figures,
    actor,
  });

  return {
    fabricIssueId: fabricIssue.id,
    fabricUom: uom,
    ...figures,
    stockPostedAt: ledger.moved ? new Date() : null,
    remnantRollNo: ledger.remnantRollNo,
  };
}

/**
 * NO MORE GOOD PIECES THAN THE ORDER CAN EVER SEND TO STITCHING.
 *
 * A receipt used to take any count, and a slip of the keyboard - 5000 on a
 * 1000-piece order - surfaced only later, as a Cutting Issue that could not
 * be posted. The receipt is now held to the same ceiling the Cutting Issue
 * is: the planned pieces for this order and style (the order lines' ceiling
 * where nothing is planned yet), plus the hard ceiling of the CUTTING_ISSUE
 * excess rule - the most any authorisation could ever let through.
 *
 * Measured across every receipt for the order and style, so two receipts
 * cannot each pass while together exceeding it. A rule with no ceiling sets
 * no limit here either.
 */
async function assertWithinCuttable(tx, { orderId, styleId, label }) {
  const order = await tx.buyerOrder.findFirst({
    where: { id: orderId },
    select: { orderNo: true, buyerId: true },
  });

  const [plans, lines, received] = await Promise.all([
    tx.planning.aggregate({
      where: { orderId, styleId, deletedAt: null, status: { not: 'CANCELLED' } },
      _sum: { plannedQty: true },
    }),
    tx.buyerOrderLine.aggregate({
      where: { orderId, styleId, deletedAt: null },
      _sum: { effectiveQty: true },
    }),
    tx.cutPiecesReceipt.aggregate({
      where: { orderId, styleId, deletedAt: null },
      _sum: { pcsReceived: true },
    }),
  ]);

  const planned = D(plans._sum.plannedQty);
  const base = planned.greaterThan(0) ? planned : D(lines._sum.effectiveQty);
  if (!base.greaterThan(0)) return;

  const total = D(received._sum.pcsReceived);
  const assessment = await excess.assess({
    documentType: 'CUTTING_ISSUE',
    orderId,
    buyerId: order?.buyerId,
    baseQty: base,
    actualQty: total,
    uom: 'Pcs',
  });
  if (!assessment.beyondCeiling) return;

  const ceilingQty = base.mul(D(1).plus(D(assessment.hardCeilingPct))).toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR);
  throw ApiError.badRequest(
    `${label} would bring the good pieces received on ${order?.orderNo ?? 'this order'} to ` +
      `${total.toFixed(0)}, but at most ${ceilingQty.toFixed(0)} can ever go to stitching ` +
      `(${base.toFixed(0)} ${planned.greaterThan(0) ? 'planned' : 'ordered'} plus the ` +
      `${assessment.hardCeilingPctDisplay}% ceiling). Check the count.`,
    { field: 'pcsReceived' },
  );
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
      select: { id: true, receiptNo: true, receiptDate: true },
    });
    await assertWithinCuttable(tx, { ...refs, label: 'This receipt' });

    // The fabric, in the same transaction: a receipt whose cloth does not
    // reconcile, or cannot come off the floor, is not saved at all.
    const fabric = await postFabric(tx, { receipt: row, input, refs, actor });
    await tx.cutPiecesReceipt.update({ where: { id: row.id }, data: fabric });
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

  // A check was made on the lot as it was counted. A different count is a
  // different lot, and the old sample says nothing about it.
  const recount = !D(counts.pcsReceived).equals(D(existing.pcsReceived));

  /*
   * ONCE THE FABRIC HAS MOVED, IT STAYS AS POSTED.
   *
   * The ledger already says what came off the cutting floor; editing the
   * figures here would leave the receipt and the ledger disagreeing. The
   * pieces can still be recounted - that moves no cloth.
   */
  const fabricTouched =
    FABRIC_QTYS.some((k) => input[k] !== undefined && !D(input[k]).equals(D(existing[k]))) ||
    (input.fabricIssueId !== undefined && input.fabricIssueId !== existing.fabricIssueId);
  if (existing.stockPostedAt && fabricTouched) {
    throw ApiError.conflict(
      `${existing.receiptNo}'s fabric has already been taken off the cutting floor in the stock ` +
        'ledger, so its fabric figures cannot be changed. The piece counts can still be corrected.',
      { field: 'issuedQty' },
    );
  }

  await prisma.$transaction(async (tx) => {
    const refs = await resolveRefs(tx, input, existing);
    if (recount) await tx.cutPieceDefect.deleteMany({ where: { receiptId: id } });

    // Fabric added to a receipt that had none: account for it and post it now.
    const fabric = !existing.stockPostedAt && fabricTouched
      ? await postFabric(tx, {
          receipt: existing,
          input: {
            ...Object.fromEntries(FABRIC_QTYS.map((k) => [k, input[k] ?? existing[k]])),
            fabricIssueId: input.fabricIssueId !== undefined ? input.fabricIssueId : existing.fabricIssueId,
            fabricUom: input.fabricUom ?? existing.fabricUom,
          },
          refs,
          actor,
        })
      : {};
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
        ...fabric,
        ...(recount ? CHECK_CLEARED : {}),
        updatedById: actor.userId ?? null,
      },
    });
    await assertWithinCuttable(tx, { ...refs, label: `${existing.receiptNo} as corrected` });
  });

  return getById(id);
}

const CHECK_CLEARED = {
  checkStatus: 'PENDING',
  sampleQty: null,
  defectivePcs: null,
  defectRatePct: null,
  acceptLimitPct: null,
  checkedAt: null,
  checkedById: null,
  checkedByName: null,
  checkRemarks: null,
};

/**
 * Records the sample check on a lot: how many pieces were opened, and every
 * defect found, by panel and type.
 *
 * PASS OR FAIL IS WORKED OUT, NOT CHOSEN - see domain/cutCheck.js. Recording
 * the check again (after a failed lot has been sorted, or to correct a
 * mistake) replaces the previous result and its defect lines; the audit trail
 * keeps what was there before.
 *
 * Refused when it would leave the order having issued more pieces to
 * stitching than ever passed a check - those pieces are already sewn.
 */
export async function recordCheck(id, input, actor = {}) {
  const existing = await prisma.cutPiecesReceipt.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw ApiError.notFound('Cut pieces receipt');

  const defects = (input.defects ?? []).filter((d) => D(d.qty).greaterThan(0));
  const defectivePcs = defects.reduce((a, d) => a.plus(D(d.qty)), D(0));
  const acceptLimitPct = input.acceptLimitPct ?? DEFAULT_ACCEPT_LIMIT_PCT;

  let verdict;
  try {
    verdict = judgeSample({
      pcsReceived: existing.pcsReceived,
      sampleQty: input.sampleQty,
      defectivePcs,
      acceptLimitPct,
    });
  } catch (e) {
    if (e instanceof RangeError) throw ApiError.badRequest(e.message, { field: 'sampleQty' });
    throw e;
  }

  await prisma.$transaction(async (tx) => {
    await tx.cutPieceDefect.deleteMany({ where: { receiptId: id } });
    if (defects.length > 0) {
      await tx.cutPieceDefect.createMany({
        data: defects.map((d, i) => ({
          receiptId: id,
          lineNo: i + 1,
          panel: d.panel?.trim() || null,
          defectType: d.defectType.trim(),
          qty: D(d.qty),
          remarks: d.remarks?.trim() || null,
          createdById: actor.userId ?? null,
        })),
      });
    }
    await tx.cutPiecesReceipt.update({
      where: { id },
      data: {
        checkStatus: verdict.status,
        sampleQty: D(input.sampleQty),
        defectivePcs,
        defectRatePct: D(verdict.defectRatePct),
        acceptLimitPct: D(acceptLimitPct),
        checkedAt: new Date(),
        checkedById: actor.userId ?? null,
        checkedByName: actor.fullName ?? null,
        checkRemarks: input.remarks?.trim() || null,
        updatedById: actor.userId ?? null,
      },
    });

    const after = await piecesPosition(tx, { orderId: existing.orderId, styleId: existing.styleId });
    if (D(after.pcsReadyToIssue).lessThan(0)) {
      throw ApiError.conflict(
        'Pieces from this order have already gone to stitching on the strength of the earlier ' +
          `check; with this result ${D(after.pcsReadyToIssue).abs().toString()} more would have ` +
          'been issued than passed. Note the defects in the remarks instead.',
      );
    }
  });

  return getById(id);
}

/**
 * Soft delete - the row stays for the audit trail.
 *
 * Refused once the fabric has been posted: deleting the receipt would leave
 * its ledger entries standing with no document behind them.
 */
export async function remove(id, actorId) {
  const existing = await prisma.cutPiecesReceipt.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, receiptNo: true, stockPostedAt: true },
  });
  if (!existing) throw ApiError.notFound('Cut pieces receipt');
  if (existing.stockPostedAt) {
    throw ApiError.conflict(
      `${existing.receiptNo} has taken its fabric off the cutting floor in the stock ledger, so ` +
        'it cannot be deleted.',
    );
  }

  await prisma.cutPiecesReceipt.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId ?? null },
  });
  return { id, deleted: true };
}
