/**
 * Dispatch - one order going out.
 *
 * ---------------------------------------------------------------------------
 *  THE FIELDS
 *
 *      Dispatch No                  AUTO - DSP-0001
 *      Date                         AUTO - today; may be moved back, never forward
 *      Order No                     DROPDOWN - orders with packed pieces not yet
 *                                   on a dispatch
 *      Buyer                        FORMULA - from the order
 *      Container No                 FORMULA - from the order's approved, current
 *                                   plan (Planning), else the order's own
 *      Invoice No                   MANUAL
 *      Total Boxes / Total Qty      AUTO - from packing: the packing lines chosen
 *                                   for the dispatch
 *      Ship Mode                    DROPDOWN - L_ShipMode, the order's by default
 *      Carrier / AWB-BL No          MANUAL
 *      ETA                          MANUAL
 *      Status                       DROPDOWN - Pending / Dispatched / Delivered
 *      Remarks                      TEXT
 *
 *  And the buyer's shipment details and address - buyer address, ship to,
 *  consignee, notify party, port of discharge, final destination, price and
 *  freight terms, buyer PO - from the buyer and the order, kept as printed.
 *
 *  THE RULES
 *
 *    - a dispatch takes the packing lines of the order chosen for it, each
 *      whole and on no other dispatch - so what is packed can go in more than
 *      one container; its lines and totals are those packing lines, and its
 *      packing list prints them
 *    - the lines are chosen while the dispatch is Pending, or in the save
 *      that marks it Dispatched; a save that does not choose them leaves them
 *      as they are, so a box packed later is never taken unasked. An edit to
 *      one of its packing lines changes its totals; once it is Dispatched or
 *      Delivered its packing lines cannot be changed
 *    - the order becomes Partially Shipped or Shipped from its Dispatched and
 *      Delivered dispatches, and goes back to the status it had before its
 *      first shipment if none is left
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { istDate, istIsoDate } from '../utils/dates.js';
import { nextNumber } from './documentNumber.service.js';
import { DISPATCH_STATUSES, SHIPPED_STATUSES, dispatchTotalsOf, shipStatusOf } from '../domain/shipping.js';
import { linesOfDispatch } from './packing.service.js';
import {
  FREE_PACKING,
  assertShippingFlow,
  labelOf,
  lockOrderStyle,
  releasePackingLines,
  shippingFlowsOfOrder,
  syncDispatch,
  takePackingLines,
} from './shippingFlow.service.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const dateOnly = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00.000Z`);

export const SORTABLE = ['dispatchDate', 'dispatchNo', 'containerNo', 'status', 'eta', 'createdAt'];

const BUYER_SELECT = {
  id: true,
  buyerName: true,
  address: true,
  country: true,
  consigneeName: true,
  consigneeAddress: true,
  notifyPartyName: true,
  notifyPartyAddress: true,
  portOfDischarge: true,
  finalDestination: true,
  priceTerms: true,
  freightTerms: true,
  shipMode: true,
};
const ORDER_SELECT = {
  id: true,
  orderNo: true,
  status: true,
  orderQty: true,
  shipTo: true,
  shipMode: true,
  buyerPoNo: true,
  containerNo: true,
  buyer: { select: BUYER_SELECT },
};
const STYLE_SELECT = { id: true, styleNo: true, styleDescription: true };

const INCLUDE = {
  order: { select: ORDER_SELECT },
  lines: { orderBy: { createdAt: 'asc' }, include: { style: { select: STYLE_SELECT } } },
};

function checkedDate(iso) {
  const today = istIsoDate();
  const day = iso ? String(iso).slice(0, 10) : today;
  if (day > today) throw ApiError.badRequest(`${istDate(dateOnly(day))} has not happened yet`, { field: 'dispatchDate' });
  return dateOnly(day);
}

function project(row) {
  return {
    ...row,
    totalPcs: D(row.totalPcs).toString(),
    order: row.order ? { ...row.order, orderQty: D(row.order.orderQty).toString() } : row.order,
    lines: (row.lines ?? []).map((l) => ({ ...l, pcs: D(l.pcs).toString() })),
  };
}

// ===========================================================================
//  WHAT COMES FROM THE ORDER
// ===========================================================================

/** "Container No" - the order's approved, current plan, else the order's own. */
async function containerOf(client, order) {
  const plan = await client.planApproval.findFirst({
    where: { orderId: order.id, deletedAt: null, approvalStatus: 'APPROVED', isCurrent: true, containerNo: { not: null } },
    orderBy: { approvalNo: 'desc' },
    select: { containerNo: true },
  });
  return plan?.containerNo ?? order.containerNo ?? null;
}

/** The buyer's shipment details and address, as they stand now. */
function shipmentOf(order) {
  const b = order.buyer ?? {};
  return {
    buyerName: b.buyerName ?? null,
    buyerPoNo: order.buyerPoNo ?? null,
    buyerAddress: [b.address, b.country].filter(Boolean).join(', ') || null,
    shipTo: order.shipTo ?? null,
    consigneeName: b.consigneeName ?? null,
    consigneeAddress: b.consigneeAddress ?? null,
    notifyPartyName: b.notifyPartyName ?? null,
    notifyPartyAddress: b.notifyPartyAddress ?? null,
    portOfDischarge: b.portOfDischarge ?? null,
    finalDestination: b.finalDestination ?? null,
    priceTerms: b.priceTerms ?? null,
    freightTerms: b.freightTerms ?? null,
  };
}

/**
 * Everything a dispatch of the order takes automatically - buyer, container,
 * shipment details - and the packing lines it may take: those on no other
 * dispatch, with their totals. `excluding` is the dispatch being saved: the
 * lines it already holds are its own, and marked `onThis`.
 *
 * @returns { view, entries } - the view for the screen, and the packing lines
 */
async function assemble(client, orderId, excluding) {
  const order = await client.buyerOrder.findFirst({ where: { id: orderId, deletedAt: null }, select: ORDER_SELECT });
  if (!order) throw ApiError.badRequest('That order does not exist', { field: 'orderId' });
  const [flows, entries] = await Promise.all([
    shippingFlowsOfOrder(client, orderId),
    client.packingEntry.findMany({
      where: { orderId, deletedAt: null, OR: [...FREE_PACKING, ...(excluding ? [{ dispatchId: excluding }] : [])] },
      orderBy: [{ packDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        dispatchId: true,
        styleId: true,
        packDate: true,
        boxNo: true,
        colorCode: true,
        pcsPerBox: true,
        pcsPacked: true,
        boxesPacked: true,
      },
    }),
  ]);
  const totals = dispatchTotalsOf(entries);
  const styles = await client.style.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.styleId))] } }, select: STYLE_SELECT });
  const style = new Map(styles.map((s) => [s.id, s]));
  const view = {
    orderId,
    orderNo: order.orderNo,
    orderStatus: order.status,
    orderQty: D(order.orderQty).toString(),
    containerNo: await containerOf(client, order),
    shipMode: order.shipMode ?? order.buyer?.shipMode ?? null,
    ...shipmentOf(order),
    totalPcs: totals.totalPcs.toString(),
    totalBoxes: totals.totalBoxes,
    lines: totals.lines.map((l) => ({ ...l, pcs: l.pcs.toString(), styleNo: style.get(l.styleId)?.styleNo ?? null, styleDescription: style.get(l.styleId)?.styleDescription ?? null })),
    // The packing lines to choose from.
    available: entries.map((e) => ({
      id: e.id,
      packDate: e.packDate,
      boxNo: e.boxNo,
      styleId: e.styleId,
      styleNo: style.get(e.styleId)?.styleNo ?? null,
      colorCode: e.colorCode,
      pcsPerBox: e.pcsPerBox,
      boxesPacked: e.boxesPacked,
      pcsPacked: D(e.pcsPacked).toString(),
      onThis: Boolean(excluding) && e.dispatchId === excluding,
    })),
    pcsPacked: flows.reduce((a, f) => a.plus(D(f.flow.packed)), D(0)).toString(),
    pcsShipped: flows.reduce((a, f) => a.plus(D(f.flow.shipped)), D(0)).toString(),
  };
  return { view, entries };
}

/**
 * The packing lines a save puts on the dispatch: those chosen, each one the
 * dispatch may take. Not choosing (undefined) takes them all - an API caller
 * that names no lines dispatches everything ready.
 */
async function chosenLines(tx, entries, ids) {
  if (ids === undefined) return entries;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) {
    const rows = await tx.packingEntry.findMany({
      where: { id: { in: unknown } },
      select: { boxNo: true, deletedAt: true, dispatch: { select: { dispatchNo: true, deletedAt: true } } },
    });
    const taken = rows.find((r) => !r.deletedAt && r.dispatch && !r.dispatch.deletedAt);
    throw ApiError.conflict(
      taken
        ? `Boxes ${taken.boxNo} are already on ${taken.dispatch.dispatchNo}. Choose the boxes again`
        : 'Some of the boxes chosen are no longer packed on this order. Choose the boxes again',
      { field: 'packingEntryIds' },
    );
  }
  return [...new Set(ids)].map((id) => byId.get(id));
}

/** What a dispatch of the order would take - the New / Edit dispatch screen. */
export async function preview(orderId, { excluding, client = prisma } = {}) {
  return (await assemble(client, orderId, excluding)).view;
}

// ===========================================================================
//  CONTEXT, OPTIONS
// ===========================================================================

export async function context(auth) {
  return { today: istIsoDate(), statuses: DISPATCH_STATUSES, canWrite: Boolean(auth?.has?.('DISPATCH.CREATE')) };
}

/** The Order No dropdown: every order with packed pieces, and what is ready to go. */
export async function orderOptions() {
  const [packed, free] = await Promise.all([
    prisma.packingEntry.groupBy({ by: ['orderId'], where: { deletedAt: null }, _sum: { pcsPacked: true } }),
    prisma.packingEntry.groupBy({ by: ['orderId'], where: { deletedAt: null, OR: FREE_PACKING }, _sum: { pcsPacked: true, boxesPacked: true } }),
  ]);
  const byOrder = new Map();
  for (const g of packed) {
    if (D(g._sum.pcsPacked).lessThanOrEqualTo(0)) continue;
    const f = free.find((x) => x.orderId === g.orderId);
    byOrder.set(g.orderId, { packed: D(g._sum.pcsPacked), ready: D(f?._sum.pcsPacked), boxesReady: f?._sum.boxesPacked ?? 0 });
  }
  if (!byOrder.size) return [];
  const orders = await prisma.buyerOrder.findMany({
    where: { id: { in: [...byOrder.keys()] }, deletedAt: null },
    select: { id: true, orderNo: true, status: true, buyer: { select: { buyerName: true, buyerCode: true } } },
  });
  return orders
    .map((o) => {
      const s = byOrder.get(o.id);
      return {
        orderId: o.id,
        orderNo: o.orderNo,
        orderStatus: o.status,
        buyerName: o.buyer?.buyerName ?? null,
        buyerCode: o.buyer?.buyerCode ?? null,
        pcsPacked: s.packed.toString(),
        pcsReady: s.ready.toString(),
        boxesReady: String(s.boxesReady),
      };
    })
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo));
}

// ===========================================================================
//  THE REGISTER
// ===========================================================================

export async function list(query) {
  const { page, pageSize, skip, take, orderBy } = query;
  const where = {
    deletedAt: null,
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.containerNo ? { containerNo: query.containerNo } : {}),
    ...(query.dateFrom || query.dateTo
      ? { dispatchDate: { ...(query.dateFrom ? { gte: dateOnly(query.dateFrom) } : {}), ...(query.dateTo ? { lte: dateOnly(query.dateTo) } : {}) } }
      : {}),
    ...searchFilter(query.search, ['dispatchNo', 'containerNo', 'invoiceNo', 'carrierRef', 'buyerName', 'remarks', 'order.orderNo']),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.dispatch.findMany({ where, orderBy: orderBy ?? [{ dispatchDate: 'desc' }, { createdAt: 'desc' }], skip, take, include: INCLUDE }),
    prisma.dispatch.count({ where }),
    prisma.dispatch.aggregate({ where, _sum: { totalPcs: true, totalBoxes: true } }),
  ]);
  return {
    rows: rows.map(project),
    total,
    page,
    pageSize,
    totals: { totalPcs: D(sums._sum.totalPcs).toString(), totalBoxes: sums._sum.totalBoxes ?? 0 },
  };
}

export async function getById(id) {
  const row = await prisma.dispatch.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!row) throw ApiError.notFound('Dispatch');
  return project(row);
}

// ===========================================================================
//  WRITES
// ===========================================================================

const SHIPPED_ORDER = ['PARTIALLY_SHIPPED', 'SHIPPED'];

/**
 * The status an order had before its first shipment - from the history this
 * module writes when it moves an order into a shipped status. In Progress if
 * that is not recorded.
 */
async function statusBeforeShipping(tx, orderId) {
  const moved = await tx.approvalHistory.findFirst({
    where: { documentType: 'BUYER_ORDER', documentId: orderId, toStatus: { in: SHIPPED_ORDER }, fromStatus: { notIn: SHIPPED_ORDER } },
    orderBy: [{ sequenceNo: 'desc' }, { actedAt: 'desc' }],
    select: { fromStatus: true },
  });
  const from = moved?.fromStatus;
  return from && !['COMPLETED', 'CANCELLED'].includes(from) ? from : 'IN_PROGRESS';
}

/**
 * The order's status from its Dispatched and Delivered dispatches. Only a
 * status this module set is taken back - to the one the order had before it
 * shipped: a Completed or Cancelled order is left alone.
 */
async function syncOrderStatus(tx, orderId, { actorId, actorName, dispatchNo }) {
  const order = await tx.buyerOrder.findUnique({ where: { id: orderId }, select: { id: true, orderNo: true, status: true, orderQty: true } });
  if (!order || ['COMPLETED', 'CANCELLED'].includes(order.status)) return;
  const sums = await tx.dispatchLine.aggregate({
    where: { orderId, dispatch: { deletedAt: null, status: { in: SHIPPED_STATUSES } } },
    _sum: { pcs: true },
  });
  const shipped = shipStatusOf(sums._sum.pcs, order.orderQty);
  const next = shipped ?? (SHIPPED_ORDER.includes(order.status) ? await statusBeforeShipping(tx, orderId) : order.status);
  if (next === order.status) return;
  await tx.buyerOrder.update({ where: { id: orderId }, data: { status: next, updatedById: actorId } });
  const previous = await tx.approvalHistory.count({ where: { documentType: 'BUYER_ORDER', documentId: orderId } });
  await tx.approvalHistory.create({
    data: {
      documentType: 'BUYER_ORDER',
      documentId: orderId,
      documentNo: order.orderNo,
      sequenceNo: previous + 1,
      action: shipped ? 'POSTED' : 'REOPENED',
      fromStatus: order.status,
      toStatus: next,
      actedById: actorId ?? null,
      actedByName: actorName ?? null,
      remarks: `Dispatch ${dispatchNo}: ${D(sums._sum.pcs)} of ${D(order.orderQty)} pcs shipped`,
    },
  });
}

/** Every style of the order, locked in key order. */
async function lockOrder(tx, orderId) {
  const styles = new Set();
  const [order, lines, packed] = await Promise.all([
    tx.buyerOrder.findFirst({ where: { id: orderId }, select: { styleId: true } }),
    tx.buyerOrderLine.findMany({ where: { orderId, deletedAt: null }, select: { styleId: true } }),
    tx.packingEntry.findMany({ where: { orderId, deletedAt: null }, select: { styleId: true }, distinct: ['styleId'] }),
  ]);
  if (order?.styleId) styles.add(order.styleId);
  for (const l of [...lines, ...packed]) styles.add(l.styleId);
  const pairs = [...styles].sort().map((styleId) => ({ orderId, styleId }));
  for (const p of pairs) await lockOrderStyle(tx, p.orderId, p.styleId);
  return pairs;
}

function assertEta(eta, dispatchDate) {
  if (eta && dispatchDate && dateOnly(eta) < dispatchDate) {
    throw ApiError.badRequest('ETA cannot be before the dispatch date', { field: 'eta' });
  }
}

/** The details a dispatch takes from the order. Its totals are its packing lines' (syncDispatch). */
const headerOf = (p) => ({
  buyerName: p.buyerName,
  containerNo: p.containerNo,
  buyerPoNo: p.buyerPoNo,
  buyerAddress: p.buyerAddress,
  shipTo: p.shipTo,
  consigneeName: p.consigneeName,
  consigneeAddress: p.consigneeAddress,
  notifyPartyName: p.notifyPartyName,
  notifyPartyAddress: p.notifyPartyAddress,
  portOfDischarge: p.portOfDischarge,
  finalDestination: p.finalDestination,
  priceTerms: p.priceTerms,
  freightTerms: p.freightTerms,
});

export async function create(auth, input) {
  const dispatchDate = checkedDate(input.dispatchDate);
  assertEta(input.eta, dispatchDate);

  const id = await prisma.$transaction(async (tx) => {
    const pairs = await lockOrder(tx, input.orderId);
    const { view: p, entries } = await assemble(tx, input.orderId, null);
    if (['CANCELLED', 'ON_HOLD'].includes(p.orderStatus)) {
      throw ApiError.conflict(`Order ${p.orderNo} is ${p.orderStatus === 'CANCELLED' ? 'cancelled' : 'on hold'} and cannot be dispatched`);
    }
    if (D(p.totalPcs).lessThanOrEqualTo(0)) {
      throw ApiError.conflict(`Nothing of order ${p.orderNo} is packed and waiting to be dispatched`, { field: 'orderId' });
    }
    const taking = await chosenLines(tx, entries, input.packingEntryIds);
    const totals = dispatchTotalsOf(taking);
    if (totals.totalPcs.lessThanOrEqualTo(0)) {
      throw ApiError.badRequest('Choose the boxes that go on this dispatch', { field: 'packingEntryIds' });
    }
    const dispatchNo = await nextNumber('DISPATCH', { tx });
    const row = await tx.dispatch.create({
      data: {
        dispatchNo,
        dispatchDate,
        orderId: input.orderId,
        ...headerOf(p),
        totalPcs: totals.totalPcs,
        totalBoxes: totals.totalBoxes,
        invoiceNo: input.invoiceNo ?? null,
        shipMode: input.shipMode !== undefined ? input.shipMode : p.shipMode,
        carrierRef: input.carrierRef ?? null,
        eta: input.eta ? dateOnly(input.eta) : null,
        status: input.status ?? 'PENDING',
        remarks: input.remarks ?? null,
        recordedById: auth.userId,
        recordedByName: auth.fullName,
        createdById: auth.userId,
        updatedById: auth.userId,
      },
    });
    await takePackingLines(tx, row.id, taking.map((e) => e.id));
    await syncDispatch(tx, row.id, auth.userId);
    for (const pair of pairs) await assertShippingFlow(tx, pair, await labelOf(tx, pair));
    await syncOrderStatus(tx, input.orderId, { actorId: auth.userId, actorName: auth.fullName, dispatchNo });
    return row.id;
  });
  return getById(id);
}

/** The order is what a dispatch IS. A Pending dispatch's boxes are those chosen for it. */
export async function update(auth, id, input) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.dispatch.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
    if (!existing) throw ApiError.notFound('Dispatch');
    const pairs = await lockOrder(tx, existing.orderId);
    const status = input.status ?? existing.status;
    const dispatchDate = input.dispatchDate ? checkedDate(input.dispatchDate) : existing.dispatchDate;
    const eta = input.eta !== undefined ? input.eta : existing.eta && istIsoDate(existing.eta);
    assertEta(eta, dispatchDate);

    // Pending, or leaving Pending now: its boxes may be chosen again, and its
    // details follow the order. Once it has left, what it carried is fixed.
    const refresh = existing.status === 'PENDING' || status === 'PENDING';
    if (input.packingEntryIds !== undefined && !refresh) {
      throw ApiError.conflict(
        `${existing.dispatchNo} has left and carries what its papers say. Set it back to Pending first to change its boxes`,
        { field: 'packingEntryIds' },
      );
    }
    const taken = refresh ? await assemble(tx, existing.orderId, id) : null;
    const p = taken?.view ?? null;
    const taking = taken && input.packingEntryIds !== undefined ? await chosenLines(tx, taken.entries, input.packingEntryIds) : null;

    await tx.dispatch.update({
      where: { id },
      data: {
        ...(p ? headerOf(p) : {}),
        dispatchDate,
        ...(input.invoiceNo !== undefined ? { invoiceNo: input.invoiceNo } : {}),
        ...(input.shipMode !== undefined ? { shipMode: input.shipMode } : {}),
        ...(input.carrierRef !== undefined ? { carrierRef: input.carrierRef } : {}),
        ...(input.eta !== undefined ? { eta: input.eta ? dateOnly(input.eta) : null } : {}),
        status,
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        updatedById: auth.userId,
      },
    });
    if (taking) {
      await releasePackingLines(tx, id, new Set(taking.map((e) => e.id)));
      await takePackingLines(tx, id, taking.filter((e) => e.dispatchId !== id).map((e) => e.id));
    }
    if (taken) {
      const totals = await syncDispatch(tx, id, auth.userId);
      if (totals.totalPcs.lessThanOrEqualTo(0)) {
        throw ApiError.badRequest(`Choose the boxes that go on ${existing.dispatchNo}, or delete it instead`, { field: 'packingEntryIds' });
      }
    }
    for (const pair of pairs) await assertShippingFlow(tx, pair, await labelOf(tx, pair));
    await syncOrderStatus(tx, existing.orderId, { actorId: auth.userId, actorName: auth.fullName, dispatchNo: existing.dispatchNo });
  });
  return getById(id);
}

export async function remove(auth, id) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.dispatch.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw ApiError.notFound('Dispatch');
    await lockOrder(tx, existing.orderId);
    // Its boxes are packed and waiting again.
    await releasePackingLines(tx, id);
    await tx.dispatch.update({ where: { id }, data: { deletedAt: new Date(), deletedById: auth.userId } });
    await syncOrderStatus(tx, existing.orderId, { actorId: auth.userId, actorName: auth.fullName, dispatchNo: `${existing.dispatchNo} (deleted)` });
    return { id, deleted: true };
  });
}

// ===========================================================================
//  THE PRINTS
// ===========================================================================

export const PRINTS = {
  'dispatch-note': 'Dispatch Note',
  'packing-list': 'Packing List',
};

function headOf(row, title) {
  return {
    documentTitle: title,
    dispatchNo: row.dispatchNo,
    dispatchDate: row.dispatchDate,
    status: row.status,
    orderNo: row.order?.orderNo ?? null,
    buyerPoNo: row.buyerPoNo,
    buyer: row.buyerName,
    buyerAddress: row.buyerAddress,
    shipTo: row.shipTo,
    consigneeName: row.consigneeName,
    consigneeAddress: row.consigneeAddress,
    notifyPartyName: row.notifyPartyName,
    notifyPartyAddress: row.notifyPartyAddress,
    portOfDischarge: row.portOfDischarge,
    finalDestination: row.finalDestination,
    priceTerms: row.priceTerms,
    freightTerms: row.freightTerms,
    containerNo: row.containerNo,
    invoiceNo: row.invoiceNo,
    shipMode: row.shipMode,
    carrierRef: row.carrierRef,
    eta: row.eta,
    remarks: row.remarks,
    totalPcs: D(row.totalPcs).toString(),
    totalBoxes: row.totalBoxes,
    printedAt: new Date(),
  };
}

async function dispatchNote(row) {
  return {
    lines: row.lines.map((l) => ({
      styleNo: l.style.styleNo,
      styleDescription: l.style.styleDescription,
      boxes: l.boxes,
      pcs: D(l.pcs).toString(),
    })),
    signatures: ['Dispatched By', 'Security (Gate)', 'Driver / Carrier', 'Authorised By'],
  };
}

async function packingList(row) {
  const lines = await linesOfDispatch(prisma, row.id);
  const sum = (k) => lines.reduce((a, l) => a.plus(D(l[k] ?? 0)), D(0)).toString();
  return {
    lines: lines.map((l) => ({
      boxNo: l.boxNo,
      styleNo: l.style.styleNo,
      name: l.style.styleDescription,
      orderQty: l.orderQty,
      colorCode: l.colorCode,
      pcsPerBox: l.pcsPerBox,
      packing: l.packing,
      boxes: l.boxesPacked,
      packets: l.packets,
      looseBags: l.looseBags,
      qty: l.pcsPacked,
      nwPerBoxKg: l.nwPerBoxKg,
      gwPerBoxKg: l.gwPerBoxKg,
      nwKg: l.nwKg,
      gwKg: l.gwKg,
      lengthCm: l.lengthCm,
      widthCm: l.widthCm,
      heightCm: l.heightCm,
      cbm: l.cbm,
      remarks: l.remarks,
    })),
    totals: {
      boxes: lines.reduce((a, l) => a + l.boxesPacked, 0),
      packets: lines.reduce((a, l) => a + (l.packets ?? 0), 0),
      looseBags: lines.reduce((a, l) => a + (l.looseBags ?? 0), 0),
      qty: sum('pcsPacked'),
      nwKg: sum('nwKg'),
      gwKg: sum('gwKg'),
      cbm: sum('cbm'),
    },
    signatures: ['Packed By', 'Checked By', 'Authorised By'],
  };
}

const BUILDERS = {
  'dispatch-note': dispatchNote,
  'packing-list': packingList,
};

export async function printView(id, kind) {
  const build = BUILDERS[kind];
  if (!build) throw ApiError.notFound('Print');
  const row = await prisma.dispatch.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!row) throw ApiError.notFound('Dispatch');
  return { ...headOf(row, PRINTS[kind]), ...(await build(row)) };
}
