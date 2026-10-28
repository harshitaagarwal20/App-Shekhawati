/**
 * Packing - the "Packing Details" sheet, one line per run of boxes.
 *
 * ---------------------------------------------------------------------------
 *  THE FIELDS
 *
 *      Box No                       MANUAL - the box numbers: 7, 1-20, C-1-20;
 *                                   as many as Boxes, none on another line
 *                                   of the order
 *      OrderNo / Style No.          DROPDOWN - orders and styles Needle Checking passed
 *      Order size                   AUTO - the order qty of the style
 *      Name                         AUTO - the style's description
 *      Color                        DROPDOWN - the colours Needle Checking passed
 *      Packing                      MANUAL - pieces in each box; filled from the
 *                                   style's packets x bags (10 x 10 = 100)
 *      Boxes                        MANUAL
 *      Qty (In pcs)                 FORMULA - Packing x Boxes
 *      N.W per Box / G.W per Box    MANUAL - kg
 *      N.W (kg) / G.W (kg)          FORMULA - per box x Boxes
 *      Dim (in cms) L / W / H       MANUAL - one box
 *      CBM                          FORMULA - L x W x H / 1,000,000 x Boxes
 *      Remarks                      TEXT
 *
 *  THE RULES
 *
 *    - total packed of a colour never more than Needle Checking passed of it
 *      (here and in the flow check)
 *    - a line on a Dispatched or Delivered dispatch cannot be changed or
 *      deleted; one on a Pending dispatch can be changed (the dispatch's
 *      totals follow) but not deleted
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { istDate, istIsoDate } from '../utils/dates.js';
import {
  colorKey,
  packedQtyOf,
  packetsOfMany,
  packingFigures,
  packingProblems,
  parseBoxNo,
  pcsPerFullCartonOf,
  rangesOverlap,
  shippingFlow,
} from '../domain/shipping.js';
import {
  assertOrderLive,
  assertShippingFlow,
  labelOf,
  lockOrderStyle,
  orderQtys,
  shippingFlowFor,
  shippingJson,
  shippingSums,
  syncDispatch,
} from './shippingFlow.service.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const dateOnly = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00.000Z`);
const str = (v) => (v == null ? null : D(v).toString());

export const SORTABLE = ['packDate', 'boxNo', 'pcsPacked', 'boxesPacked', 'createdAt'];

const ORDER_SELECT = { id: true, orderNo: true, status: true, buyer: { select: { buyerName: true, buyerCode: true } } };
const STYLE_SELECT = { id: true, styleNo: true, styleDescription: true, bagsPerPacket: true, packetsPerCarton: true };
const DISPATCH_SELECT = { id: true, dispatchNo: true, status: true };
const INCLUDE = { order: { select: ORDER_SELECT }, style: { select: STYLE_SELECT }, dispatch: { select: DISPATCH_SELECT } };

function checkedDate(iso) {
  const today = istIsoDate();
  const day = iso ? String(iso).slice(0, 10) : today;
  if (day > today) throw ApiError.badRequest(`${istDate(dateOnly(day))} has not happened yet`, { field: 'packDate' });
  return dateOnly(day);
}

function problemsOrThrow(e, opts) {
  const problems = packingProblems(e, opts);
  if (problems.length) throw ApiError.badRequest(problems[0].message, { field: problems[0].field, problems });
}

/**
 * The boxes of one order are numbered once across all its styles: no two
 * lines may claim the same box. Every write to the order's box numbers takes
 * the order's box lock, after its order-and-style lock.
 */
async function assertBoxesFree(tx, orderId, boxNo, exceptId = null) {
  const run = parseBoxNo(boxNo);
  if (!run) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`boxes::${orderId}`}, 0))`;
  const others = await tx.packingEntry.findMany({
    where: { orderId, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { boxNo: true },
  });
  const clash = others.find((o) => {
    const r = parseBoxNo(o.boxNo);
    return r && r.prefix === run.prefix && rangesOverlap(r, run);
  });
  if (clash) {
    throw ApiError.badRequest(`Box No ${String(boxNo).trim()} overlaps boxes ${clash.boxNo} already packed on this order`, { field: 'boxNo' });
  }
}

/** A row with its formula columns, its boxes as packets and bags, and its Order size. */
function project(row, qtys) {
  const f = packingFigures(row);
  const p = packetsOfMany(row.pcsPerBox, row.boxesPacked, row.style?.bagsPerPacket);
  return {
    ...row,
    packing: p.perCarton.label,
    packetsPerBox: p.perCarton.packets,
    looseBagsPerBox: p.perCarton.looseBags,
    packets: p.packets,
    looseBags: p.looseBags,
    bags: p.bags,
    pcsPacked: D(row.pcsPacked).toString(),
    nwPerBoxKg: str(row.nwPerBoxKg),
    gwPerBoxKg: str(row.gwPerBoxKg),
    lengthCm: str(row.lengthCm),
    widthCm: str(row.widthCm),
    heightCm: str(row.heightCm),
    nwKg: str(f.nwKg),
    gwKg: str(f.gwKg),
    cbm: str(f.cbm),
    orderQty: qtys?.get(`${row.orderId}:${row.styleId}`)?.orderQty?.toString() ?? null,
  };
}

async function projectAll(rows) {
  const pairs = [...new Map(rows.map((r) => [`${r.orderId}:${r.styleId}`, { orderId: r.orderId, styleId: r.styleId }])).values()];
  const qtys = await orderQtys(prisma, pairs);
  return rows.map((r) => project(r, qtys));
}

// ===========================================================================
//  CONTEXT, OPTIONS, POSITION
// ===========================================================================

export async function context(auth) {
  return { today: istIsoDate(), canWrite: Boolean(auth?.has?.('PACKING.CREATE')) };
}

/** Every order and style with needle-checked pieces, with what is still to pack. */
export async function orderOptions() {
  const sums = await shippingSums(prisma, {});
  const flows = [...sums.values()]
    .map((s) => ({ ...s, flow: shippingFlow(s) }))
    .filter((s) => s.flow.needleChecked.greaterThan(0) || s.flow.packed.greaterThan(0));
  if (!flows.length) return [];
  const [orders, styles, qtys] = await Promise.all([
    prisma.buyerOrder.findMany({ where: { id: { in: [...new Set(flows.map((f) => f.orderId))] }, deletedAt: null }, select: ORDER_SELECT }),
    prisma.style.findMany({ where: { id: { in: [...new Set(flows.map((f) => f.styleId))] } }, select: STYLE_SELECT }),
    orderQtys(prisma, flows),
  ]);
  const order = new Map(orders.map((o) => [o.id, o]));
  const style = new Map(styles.map((s) => [s.id, s]));
  return flows
    .filter((f) => order.has(f.orderId))
    .map((f) => {
      const st = style.get(f.styleId);
      return {
        key: `${f.orderId}:${f.styleId}`,
        orderId: f.orderId,
        orderNo: order.get(f.orderId).orderNo,
        orderStatus: order.get(f.orderId).status,
        buyerName: order.get(f.orderId).buyer?.buyerName ?? null,
        buyerCode: order.get(f.orderId).buyer?.buyerCode ?? null,
        styleId: f.styleId,
        styleNo: st?.styleNo ?? null,
        styleDescription: st?.styleDescription ?? null,
        pcsPerFullCarton: pcsPerFullCartonOf(st),
        orderQty: qtys.get(`${f.orderId}:${f.styleId}`)?.orderQty?.toString() ?? null,
        pcsNeedleChecked: f.flow.needleChecked.toString(),
        pcsPacked: f.flow.packed.toString(),
        boxesPacked: f.flow.boxesPacked.toString(),
        pcsAvailable: f.flow.awaitingPacking.toString(),
      };
    })
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo) || String(a.styleNo).localeCompare(String(b.styleNo)));
}

export async function position({ orderId, styleId }) {
  const pair = { orderId, styleId };
  const [flow, qtys, style] = await Promise.all([
    shippingFlowFor(prisma, pair),
    orderQtys(prisma, [pair]),
    prisma.style.findFirst({ where: { id: styleId }, select: STYLE_SELECT }),
  ]);
  return {
    flow: shippingJson(flow),
    orderQty: qtys.get(`${orderId}:${styleId}`)?.orderQty?.toString() ?? null,
    styleDescription: style?.styleDescription ?? null,
    // "Packing" is filled from these: a full carton is packets x bags.
    bagsPerPacket: style?.bagsPerPacket ?? null,
    packetsPerCarton: style?.packetsPerCarton ?? null,
    pcsPerFullCarton: pcsPerFullCartonOf(style),
    // The Color dropdown: what Needle Checking passed, colour by colour.
    colors: flow.colors.filter((c) => c.checked.greaterThan(0) || c.packed.greaterThan(0)).map((c) => ({
      color: c.color,
      checked: c.checked.toString(),
      packed: c.packed.toString(),
      available: c.awaitingPacking.toString(),
    })),
  };
}

// ===========================================================================
//  THE REGISTER
// ===========================================================================

export async function list(query) {
  const { page, pageSize, skip, take, orderBy } = query;
  const where = {
    deletedAt: null,
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.styleId ? { styleId: query.styleId } : {}),
    ...(query.dateFrom || query.dateTo
      ? { packDate: { ...(query.dateFrom ? { gte: dateOnly(query.dateFrom) } : {}), ...(query.dateTo ? { lte: dateOnly(query.dateTo) } : {}) } }
      : {}),
    ...searchFilter(query.search, ['boxNo', 'colorCode', 'remarks', 'order.orderNo', 'style.styleNo']),
  };
  const [rows, total, all] = await Promise.all([
    prisma.packingEntry.findMany({ where, orderBy: orderBy ?? [{ packDate: 'desc' }, { createdAt: 'desc' }], skip, take, include: INCLUDE }),
    prisma.packingEntry.count({ where }),
    // Every matching row for the totals: N.W, G.W and CBM are worked out per row.
    prisma.packingEntry.findMany({
      where,
      select: {
        pcsPacked: true,
        pcsPerBox: true,
        boxesPacked: true,
        nwPerBoxKg: true,
        gwPerBoxKg: true,
        lengthCm: true,
        widthCm: true,
        heightCm: true,
        style: { select: { bagsPerPacket: true } },
      },
    }),
  ]);
  const totals = all.reduce(
    (t, r) => {
      const f = packingFigures(r);
      const p = packetsOfMany(r.pcsPerBox, r.boxesPacked, r.style?.bagsPerPacket);
      return {
        pcsPacked: t.pcsPacked.plus(D(r.pcsPacked)),
        boxesPacked: t.boxesPacked + r.boxesPacked,
        packets: t.packets + (p.packets ?? 0),
        looseBags: t.looseBags + (p.looseBags ?? 0),
        nwKg: t.nwKg.plus(f.nwKg ?? 0),
        gwKg: t.gwKg.plus(f.gwKg ?? 0),
        cbm: t.cbm.plus(f.cbm ?? 0),
      };
    },
    { pcsPacked: D(0), boxesPacked: 0, packets: 0, looseBags: 0, nwKg: D(0), gwKg: D(0), cbm: D(0) },
  );
  return {
    rows: await projectAll(rows),
    total,
    page,
    pageSize,
    totals: {
      pcsPacked: totals.pcsPacked.toString(),
      boxesPacked: totals.boxesPacked,
      packets: totals.packets,
      looseBags: totals.looseBags,
      nwKg: totals.nwKg.toString(),
      gwKg: totals.gwKg.toString(),
      cbm: totals.cbm.toDecimalPlaces(4).toString(),
    },
  };
}

export async function getById(id) {
  const row = await prisma.packingEntry.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!row) throw ApiError.notFound('Packing entry');
  const [projected] = await projectAll([row]);
  return { ...projected, position: await position(row) };
}

// ===========================================================================
//  WRITES
// ===========================================================================

const dims = (input) => ({
  nwPerBoxKg: input.nwPerBoxKg ?? null,
  gwPerBoxKg: input.gwPerBoxKg ?? null,
  lengthCm: input.lengthCm ?? null,
  widthCm: input.widthCm ?? null,
  heightCm: input.heightCm ?? null,
});

/**
 * The dispatch a packing line is on, if it is still live. Boxes on a dispatch
 * that has left are what its papers say left, so they are not changed; boxes
 * on a Pending one may be, and the dispatch follows.
 */
async function dispatchOf(tx, entry, doing) {
  if (!entry.dispatchId) return null;
  const d = await tx.dispatch.findFirst({ where: { id: entry.dispatchId, deletedAt: null }, select: DISPATCH_SELECT });
  if (d && d.status !== 'PENDING') {
    throw ApiError.conflict(
      `Boxes ${entry.boxNo} are on ${d.dispatchNo}, which is ${d.status === 'DELIVERED' ? 'delivered' : 'dispatched'}, `
        + `and cannot be ${doing}. Set ${d.dispatchNo} back to Pending first if they were packed wrong.`,
      { dispatchId: d.id },
    );
  }
  return d;
}

/** The colour must be one Needle Checking passed, with enough of it left. */
function assertColorRoom(flow, colorCode, adding, label) {
  const c = flow.colors.find((x) => x.color === colorKey(colorCode));
  const name = colorKey(colorCode) ? ` (${colorKey(colorCode)})` : '';
  if (!c || c.checked.lessThanOrEqualTo(0)) {
    throw ApiError.badRequest(`Needle Checking has passed nothing of ${label}${name}. Choose a colour it has passed`, { field: 'colorCode' });
  }
  if (adding.greaterThan(c.awaitingPacking)) {
    throw ApiError.badRequest(
      `Only ${c.awaitingPacking} needle-checked pcs of ${label}${name} are waiting to be packed; these boxes hold ${adding}`,
      { field: 'boxesPacked', flow: shippingJson(flow) },
    );
  }
}

export async function create(auth, input) {
  const pair = { orderId: input.orderId, styleId: input.styleId };
  const packDate = checkedDate(input.packDate);
  const entry = { ...input, ...dims(input) };
  problemsOrThrow(entry);
  const pcsPacked = packedQtyOf(entry);

  const id = await prisma.$transaction(async (tx) => {
    await lockOrderStyle(tx, pair.orderId, pair.styleId);
    const label = await labelOf(tx, pair);
    await assertOrderLive(tx, pair.orderId, 'packed');
    assertColorRoom(await shippingFlowFor(tx, pair), input.colorCode ?? null, pcsPacked, label);
    await assertBoxesFree(tx, pair.orderId, input.boxNo);
    const row = await tx.packingEntry.create({
      data: {
        ...pair,
        packDate,
        boxNo: String(input.boxNo).trim(),
        colorCode: input.colorCode ?? null,
        pcsPerBox: Number(input.pcsPerBox),
        boxesPacked: Number(input.boxesPacked),
        pcsPacked,
        ...dims(input),
        remarks: input.remarks ?? null,
        recordedById: auth.userId,
        recordedByName: auth.fullName,
        createdById: auth.userId,
        updatedById: auth.userId,
      },
    });
    await assertShippingFlow(tx, pair, label);
    return row.id;
  });
  return getById(id);
}

export async function update(auth, id, input) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.packingEntry.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw ApiError.notFound('Packing entry');
    const pair = { orderId: existing.orderId, styleId: existing.styleId };
    await lockOrderStyle(tx, pair.orderId, pair.styleId);
    const label = await labelOf(tx, pair);
    const fresh = await tx.packingEntry.findUnique({ where: { id } });
    const onDispatch = await dispatchOf(tx, fresh, 'changed');
    const merged = { ...fresh };
    if (input.packDate !== undefined) merged.packDate = checkedDate(input.packDate);
    for (const k of ['boxNo', 'colorCode', 'pcsPerBox', 'boxesPacked', 'nwPerBoxKg', 'gwPerBoxKg', 'lengthCm', 'widthCm', 'heightCm', 'remarks']) {
      if (input[k] !== undefined) merged[k] = input[k];
    }
    const boxNoKept = String(merged.boxNo ?? '').trim() === String(fresh.boxNo).trim();
    problemsOrThrow(merged, { boxNoKept });
    if (!boxNoKept) await assertBoxesFree(tx, pair.orderId, merged.boxNo, id);
    const pcsPacked = packedQtyOf(merged);
    const sameColor = colorKey(merged.colorCode) === colorKey(fresh.colorCode);
    const adding = sameColor ? pcsPacked.minus(D(fresh.pcsPacked)) : pcsPacked;
    if (adding.greaterThan(0)) {
      await assertOrderLive(tx, pair.orderId, 'packed');
      assertColorRoom(await shippingFlowFor(tx, pair), merged.colorCode, adding, label);
    }
    await tx.packingEntry.update({
      where: { id },
      data: {
        packDate: merged.packDate,
        boxNo: String(merged.boxNo).trim(),
        colorCode: merged.colorCode ?? null,
        pcsPerBox: Number(merged.pcsPerBox),
        boxesPacked: Number(merged.boxesPacked),
        pcsPacked,
        nwPerBoxKg: merged.nwPerBoxKg ?? null,
        gwPerBoxKg: merged.gwPerBoxKg ?? null,
        lengthCm: merged.lengthCm ?? null,
        widthCm: merged.widthCm ?? null,
        heightCm: merged.heightCm ?? null,
        remarks: merged.remarks ?? null,
        updatedById: auth.userId,
      },
    });
    // A Pending dispatch's totals are its packing lines.
    if (onDispatch) await syncDispatch(tx, onDispatch.id, auth.userId);
    await assertShippingFlow(tx, pair, label);
  });
  return getById(id);
}

export async function remove(auth, id) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.packingEntry.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw ApiError.notFound('Packing entry');
    await lockOrderStyle(tx, existing.orderId, existing.styleId);
    const label = await labelOf(tx, existing);
    // Boxes on a Pending dispatch stay on it: delete the dispatch first.
    const onDispatch = await dispatchOf(tx, existing, 'deleted');
    if (onDispatch) {
      throw ApiError.conflict(
        `Boxes ${existing.boxNo} are on pending dispatch ${onDispatch.dispatchNo}. Correct the boxes instead, `
          + `or take them off ${onDispatch.dispatchNo} first.`,
        { dispatchId: onDispatch.id },
      );
    }
    await tx.packingEntry.update({ where: { id }, data: { deletedAt: new Date(), deletedById: auth.userId } });
    await assertShippingFlow(tx, existing, label);
    return { id, deleted: true };
  });
}

/** The packing lines a dispatch took, for its packing list. */
export async function linesOfDispatch(client, dispatchId) {
  const rows = await client.packingEntry.findMany({
    where: { dispatchId, deletedAt: null },
    orderBy: [{ packDate: 'asc' }, { createdAt: 'asc' }],
    include: INCLUDE,
  });
  const pairs = [...new Map(rows.map((r) => [`${r.orderId}:${r.styleId}`, { orderId: r.orderId, styleId: r.styleId }])).values()];
  const qtys = await orderQtys(client, pairs);
  return rows.map((r) => project(r, qtys));
}
