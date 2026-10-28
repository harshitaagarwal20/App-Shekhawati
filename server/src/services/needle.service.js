/**
 * Needle Checking - the "Size Assortment Carton" sheet.
 *
 * ---------------------------------------------------------------------------
 *  THE FIELDS
 *
 *      Order No / Style                 DROPDOWN - once, at the top of the sheet:
 *                                       the orders External QC has approved
 *      Carton                           AUTO - the run of carton numbers the row
 *                                       covers, 1-10, 11-15 ..., given when the
 *                                       row is made and kept
 *      Carton Qty                       MANUAL - cartons of this assortment
 *      Color                            DROPDOWN - the order's colours for the style
 *      Size 1 .. Size 10                MANUAL - pieces of each size in ONE carton
 *      Weight                           MANUAL - kg, one carton
 *      Pcs/Carton                       FORMULA - Size 1 + ... + Size 10
 *      Sign.                            MANUAL - who checked and signed
 *
 *  THE RULES
 *
 *    - the cartons of an order and style never hold more than External QC
 *      approved (Pcs/Carton x Carton Qty, summed)
 *    - a row's colour, sizes or cartons cannot be cut below what Packing has
 *      already packed of that colour (the flow check)
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { istDate, istIsoDate } from '../utils/dates.js';
import {
  SIZE_COUNT,
  SIZE_KEYS,
  cartonLabel,
  cartonProblems,
  cartonTotalOf,
  nextCartons,
  packetsOfMany,
  pcsPerCartonOf,
  pcsPerFullCartonOf,
  rangesOverlap,
  shippingFlow,
} from '../domain/shipping.js';
import {
  assertOrderLive,
  assertShippingFlow,
  labelOf,
  lockOrderStyle,
  orderColors,
  orderQtys,
  shippingFlowFor,
  shippingJson,
  shippingSums,
} from './shippingFlow.service.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const dateOnly = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00.000Z`);

export const SORTABLE = ['checkDate', 'seq', 'cartonQty', 'totalPcs', 'createdAt'];

const ORDER_SELECT = { id: true, orderNo: true, status: true, buyer: { select: { buyerName: true, buyerCode: true } } };
const STYLE_SELECT = { id: true, styleNo: true, styleDescription: true, sizeGroup: true, bagsPerPacket: true, packetsPerCarton: true };
const INCLUDE = { order: { select: ORDER_SELECT }, style: { select: STYLE_SELECT } };

function checkedDate(iso) {
  const today = istIsoDate();
  const day = iso ? String(iso).slice(0, 10) : today;
  if (day > today) throw ApiError.badRequest(`${istDate(dateOnly(day))} has not happened yet`, { field: 'checkDate' });
  return dateOnly(day);
}

function problemsOrThrow(row) {
  const problems = cartonProblems(row);
  if (problems.length) throw ApiError.badRequest(problems[0].message, { field: problems[0].field, problems });
}

/** Each size as sent - blank is none - or, where not sent, as it was. */
const sizesOf = (input, base = {}) =>
  Object.fromEntries(SIZE_KEYS.map((k) => [k, Number((input[k] !== undefined ? input[k] : base[k]) ?? 0) || 0]));

async function assertColor(client, pair, colorCode) {
  const colors = await orderColors(client, pair);
  if (colors.length && !colors.includes(colorCode ?? '')) {
    throw ApiError.badRequest(`Choose one of the order's colours for this style: ${colors.join(', ')}`, { field: 'colorCode' });
  }
}

/** Each row with its Carton range, and its cartons as packets and bags at the style's bags a packet. */
async function withCartons(rows) {
  if (!rows.length) return [];
  const styles = await prisma.style.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.styleId))] } },
    select: { id: true, bagsPerPacket: true },
  });
  const bagsPerPacket = new Map(styles.map((st) => [st.id, st.bagsPerPacket]));
  return rows.map((r) => {
    const p = packetsOfMany(r.pcsPerCarton, r.cartonQty, bagsPerPacket.get(r.styleId));
    return {
      ...r,
      // One carton as packets and bags, and the row's cartons together.
      packing: p.perCarton.label,
      packetsPerCarton: p.perCarton.packets,
      looseBagsPerCarton: p.perCarton.looseBags,
      packets: p.packets,
      looseBags: p.looseBags,
      bags: p.bags,
      totalPcs: D(r.totalPcs).toString(),
      weightKg: r.weightKg == null ? null : D(r.weightKg).toString(),
      carton: cartonLabel(r.cartonFrom, r.cartonTo),
    };
  });
}

/** The highest carton number the live rows of the order and style hold. */
async function lastCarton(tx, pair) {
  const last = await tx.needleCheckCarton.aggregate({ where: { ...pair, deletedAt: null }, _max: { cartonTo: true } });
  return last._max.cartonTo ?? 0;
}

/**
 * The carton numbers an edited row covers. It keeps its first number; more
 * cartons may not run into the numbers of another row - those cartons are
 * labelled already - so the extra cartons go on a new row.
 */
async function editedCartons(tx, row, cartonQty) {
  if (row.cartonFrom == null) return nextCartons(await lastCarton(tx, { orderId: row.orderId, styleId: row.styleId }), cartonQty);
  const wanted = { cartonFrom: row.cartonFrom, cartonTo: row.cartonFrom + Number(cartonQty) - 1 };
  if (wanted.cartonTo <= (row.cartonTo ?? wanted.cartonTo)) return wanted;
  const others = await tx.needleCheckCarton.findMany({
    where: { orderId: row.orderId, styleId: row.styleId, deletedAt: null, id: { not: row.id }, cartonFrom: { not: null } },
    select: { cartonFrom: true, cartonTo: true },
  });
  const clash = others.find((o) => rangesOverlap({ from: wanted.cartonFrom, to: wanted.cartonTo }, { from: o.cartonFrom, to: o.cartonTo }));
  if (clash) {
    throw ApiError.badRequest(
      `Carton ${cartonLabel(clash.cartonFrom, clash.cartonTo)} is already numbered on another row. Add the extra cartons as a new row`,
      { field: 'cartonQty' },
    );
  }
  return wanted;
}

// ===========================================================================
//  CONTEXT, OPTIONS, POSITION
// ===========================================================================

export async function context(auth) {
  return { today: istIsoDate(), sizeCount: SIZE_COUNT, canWrite: Boolean(auth?.has?.('NEEDLE_DETECTION.CREATE')) };
}

/** Every order and style External QC has approved, with what is still to be checked. */
export async function orderOptions() {
  const sums = await shippingSums(prisma, {});
  const flows = [...sums.values()]
    .map((s) => ({ ...s, flow: shippingFlow(s) }))
    .filter((s) => s.flow.approved.greaterThan(0) || s.flow.needleChecked.greaterThan(0));
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
    .map((f) => ({
      key: `${f.orderId}:${f.styleId}`,
      orderId: f.orderId,
      orderNo: order.get(f.orderId).orderNo,
      orderStatus: order.get(f.orderId).status,
      buyerName: order.get(f.orderId).buyer?.buyerName ?? null,
      buyerCode: order.get(f.orderId).buyer?.buyerCode ?? null,
      styleId: f.styleId,
      styleNo: style.get(f.styleId)?.styleNo ?? null,
      orderQty: qtys.get(`${f.orderId}:${f.styleId}`)?.orderQty?.toString() ?? null,
      pcsApproved: f.flow.approved.toString(),
      pcsChecked: f.flow.needleChecked.toString(),
      pcsAvailable: f.flow.awaitingNeedle.toString(),
    }))
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo) || String(a.styleNo).localeCompare(String(b.styleNo)));
}

/** The sheet of one order and style: its figures, its colours and every row so far. */
export async function position({ orderId, styleId, dateFrom, dateTo }) {
  const pair = { orderId, styleId };
  const [flow, colors, qtys, style, rows] = await Promise.all([
    shippingFlowFor(prisma, pair),
    orderColors(prisma, pair),
    orderQtys(prisma, [pair]),
    prisma.style.findFirst({ where: { id: styleId }, select: STYLE_SELECT }),
    prisma.needleCheckCarton.findMany({
      where: {
        ...pair,
        deletedAt: null,
        ...(dateFrom || dateTo
          ? { checkDate: { ...(dateFrom ? { gte: dateOnly(dateFrom) } : {}), ...(dateTo ? { lte: dateOnly(dateTo) } : {}) } }
          : {}),
      },
      orderBy: { seq: 'asc' },
    }),
  ]);
  const projected = await withCartons(rows);
  return {
    flow: shippingJson(flow),
    orderQty: qtys.get(`${orderId}:${styleId}`)?.orderQty?.toString() ?? null,
    sizeGroup: style?.sizeGroup ?? null,
    bagsPerPacket: style?.bagsPerPacket ?? null,
    packetsPerCarton: style?.packetsPerCarton ?? null,
    pcsPerFullCarton: pcsPerFullCartonOf(style),
    colors,
    rows: projected,
    totals: {
      cartons: rows.reduce((a, r) => a + r.cartonQty, 0),
      packets: projected.reduce((a, r) => a + (r.packets ?? 0), 0),
      looseBags: projected.reduce((a, r) => a + (r.looseBags ?? 0), 0),
      bags: projected.reduce((a, r) => a + r.bags, 0),
      pcs: rows.reduce((a, r) => a.plus(D(r.totalPcs)), D(0)).toString(),
      ...Object.fromEntries(SIZE_KEYS.map((k) => [k, rows.reduce((a, r) => a + r[k] * r.cartonQty, 0)])),
    },
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
      ? { checkDate: { ...(query.dateFrom ? { gte: dateOnly(query.dateFrom) } : {}), ...(query.dateTo ? { lte: dateOnly(query.dateTo) } : {}) } }
      : {}),
    ...searchFilter(query.search, ['colorCode', 'signedBy', 'order.orderNo', 'style.styleNo']),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.needleCheckCarton.findMany({ where, orderBy: orderBy ?? [{ checkDate: 'desc' }, { seq: 'desc' }], skip, take, include: INCLUDE }),
    prisma.needleCheckCarton.count({ where }),
    prisma.needleCheckCarton.aggregate({ where, _sum: { cartonQty: true, totalPcs: true } }),
  ]);
  return {
    rows: await withCartons(rows),
    total,
    page,
    pageSize,
    totals: { cartonQty: sums._sum.cartonQty ?? 0, totalPcs: D(sums._sum.totalPcs).toString() },
  };
}

export async function getById(id) {
  const row = await prisma.needleCheckCarton.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!row) throw ApiError.notFound('Needle checking carton');
  const [projected] = await withCartons([row]);
  return projected;
}

// ===========================================================================
//  WRITES
// ===========================================================================

export async function create(auth, input) {
  const pair = { orderId: input.orderId, styleId: input.styleId };
  const checkDate = checkedDate(input.checkDate);
  const sizes = sizesOf(input);
  const row = { ...sizes, cartonQty: input.cartonQty, signedBy: input.signedBy };
  problemsOrThrow(row);

  const id = await prisma.$transaction(async (tx) => {
    await lockOrderStyle(tx, pair.orderId, pair.styleId);
    const label = await labelOf(tx, pair);
    await assertOrderLive(tx, pair.orderId, 'needle-checked');
    await assertColor(tx, pair, input.colorCode ?? null);
    const before = await shippingFlowFor(tx, pair);
    const adding = cartonTotalOf(row);
    if (adding.greaterThan(before.awaitingNeedle)) {
      throw ApiError.badRequest(
        `Only ${before.awaitingNeedle} External QC approved pcs of ${label} are waiting for Needle Checking; `
          + `these cartons hold ${adding}`,
        { field: 'cartonQty', flow: shippingJson(before) },
      );
    }
    const last = await tx.needleCheckCarton.aggregate({ where: { ...pair, deletedAt: null }, _max: { seq: true } });
    const created = await tx.needleCheckCarton.create({
      data: {
        ...pair,
        checkDate,
        seq: (last._max.seq ?? 0) + 1,
        cartonQty: Number(input.cartonQty),
        ...nextCartons(await lastCarton(tx, pair), input.cartonQty),
        colorCode: input.colorCode ?? null,
        ...sizes,
        weightKg: input.weightKg ?? null,
        pcsPerCarton: pcsPerCartonOf(sizes),
        totalPcs: adding,
        signedBy: String(input.signedBy).trim(),
        recordedById: auth.userId,
        recordedByName: auth.fullName,
        createdById: auth.userId,
        updatedById: auth.userId,
      },
    });
    await assertShippingFlow(tx, pair, label);
    return created.id;
  });
  return getById(id);
}

export async function update(auth, id, input) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.needleCheckCarton.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw ApiError.notFound('Needle checking carton');
    const pair = { orderId: existing.orderId, styleId: existing.styleId };
    await lockOrderStyle(tx, pair.orderId, pair.styleId);
    const label = await labelOf(tx, pair);
    const fresh = await tx.needleCheckCarton.findUnique({ where: { id } });
    const sizes = sizesOf(input, fresh);
    const row = {
      ...sizes,
      cartonQty: input.cartonQty ?? fresh.cartonQty,
      signedBy: input.signedBy ?? fresh.signedBy,
    };
    problemsOrThrow(row);
    const colorCode = input.colorCode !== undefined ? input.colorCode : fresh.colorCode;
    if (input.colorCode !== undefined && input.colorCode !== fresh.colorCode) await assertColor(tx, pair, colorCode);
    const totalPcs = cartonTotalOf(row);
    if (totalPcs.greaterThan(D(fresh.totalPcs))) await assertOrderLive(tx, pair.orderId, 'needle-checked');
    await tx.needleCheckCarton.update({
      where: { id },
      data: {
        ...(input.checkDate !== undefined ? { checkDate: checkedDate(input.checkDate) } : {}),
        cartonQty: Number(row.cartonQty),
        ...(Number(row.cartonQty) !== fresh.cartonQty || fresh.cartonFrom == null ? await editedCartons(tx, fresh, row.cartonQty) : {}),
        colorCode,
        ...sizes,
        ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
        pcsPerCarton: pcsPerCartonOf(sizes),
        totalPcs,
        signedBy: String(row.signedBy).trim(),
        updatedById: auth.userId,
      },
    });
    await assertShippingFlow(tx, pair, label);
  });
  return getById(id);
}

export async function remove(auth, id) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.needleCheckCarton.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw ApiError.notFound('Needle checking carton');
    await lockOrderStyle(tx, existing.orderId, existing.styleId);
    const label = await labelOf(tx, existing);
    await tx.needleCheckCarton.update({ where: { id }, data: { deletedAt: new Date(), deletedById: auth.userId } });
    // Refused if its pieces have been packed.
    await assertShippingFlow(tx, existing, label);
    return { id, deleted: true };
  });
}
