/**
 * Where one order and style's pieces are after External QC, and the check
 * every write that moves them has to pass.
 *
 * Needle Checking, Packing and Dispatch move the same pieces, so they share
 * one lock - the finishing lock External QC already takes for the order and
 * style, because External QC's Approved is what the cartons draw on - and one
 * check:
 *
 *      needle-checked                  <= External QC approved
 *      packed, colour by colour        <= needle-checked of the colour
 *      on a dispatch                   <= packed, in pieces and in boxes
 *
 * Each caller takes the lock, writes, then calls assertShippingFlow().
 *
 * LOCK ORDER. A write over several styles of one order (a dispatch) takes
 * their locks in key order. Nothing takes them the other way round.
 */

import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError.js';
import { SHIPPED_STATUSES, colorKey, dispatchTotalsOf, shippingFlow } from '../domain/shipping.js';

const D = (v) => new Prisma.Decimal(v ?? 0);

export { lockFinishingFlow as lockOrderStyle } from './finishingFlow.service.js';

const ZERO = () => ({
  approved: D(0),
  checked: D(0),
  cartons: D(0),
  packed: D(0),
  boxesPacked: D(0),
  dispatched: D(0),
  boxesDispatched: D(0),
  shipped: D(0),
  colors: new Map(),
});

/**
 * The raw sums, grouped by order and style. `where` narrows every table the
 * same way ({} for all, { orderId }, { orderId, styleId } or
 * { orderId: { in: [...] } }).
 *
 * @returns Map<"orderId:styleId", sums>
 */
export async function shippingSums(client, where = {}) {
  const live = { ...where, deletedAt: null };
  const [qc, cartons, packed, dispatched] = await Promise.all([
    client.externalQcEntry.groupBy({ by: ['orderId', 'styleId'], where: live, _sum: { pcsApproved: true } }),
    client.needleCheckCarton.groupBy({
      by: ['orderId', 'styleId', 'colorCode'],
      where: live,
      _sum: { totalPcs: true, cartonQty: true },
    }),
    client.packingEntry.groupBy({
      by: ['orderId', 'styleId', 'colorCode'],
      where: live,
      _sum: { pcsPacked: true, boxesPacked: true },
    }),
    client.dispatchLine.groupBy({
      by: ['orderId', 'styleId', 'dispatchId'],
      where: { ...where, dispatch: { deletedAt: null } },
      _sum: { pcs: true, boxes: true },
    }),
  ]);
  const shippedIds = new Set(
    dispatched.length
      ? (await client.dispatch.findMany({
        where: { id: { in: [...new Set(dispatched.map((g) => g.dispatchId))] }, status: { in: SHIPPED_STATUSES } },
        select: { id: true },
      })).map((d) => d.id)
      : [],
  );

  const out = new Map();
  const at = (orderId, styleId) => {
    const key = `${orderId}:${styleId}`;
    if (!out.has(key)) out.set(key, { orderId, styleId, ...ZERO() });
    return out.get(key);
  };
  const colorOf = (s, c) => {
    const k = colorKey(c);
    if (!s.colors.has(k)) s.colors.set(k, { checked: D(0), packed: D(0) });
    return s.colors.get(k);
  };

  for (const g of qc) at(g.orderId, g.styleId).approved = D(g._sum.pcsApproved);
  for (const g of cartons) {
    const s = at(g.orderId, g.styleId);
    s.checked = s.checked.plus(D(g._sum.totalPcs));
    s.cartons = s.cartons.plus(D(g._sum.cartonQty));
    const c = colorOf(s, g.colorCode);
    c.checked = c.checked.plus(D(g._sum.totalPcs));
  }
  for (const g of packed) {
    const s = at(g.orderId, g.styleId);
    s.packed = s.packed.plus(D(g._sum.pcsPacked));
    s.boxesPacked = s.boxesPacked.plus(D(g._sum.boxesPacked));
    const c = colorOf(s, g.colorCode);
    c.packed = c.packed.plus(D(g._sum.pcsPacked));
  }
  for (const g of dispatched) {
    const s = at(g.orderId, g.styleId);
    s.dispatched = s.dispatched.plus(D(g._sum.pcs));
    s.boxesDispatched = s.boxesDispatched.plus(D(g._sum.boxes));
    if (shippedIds.has(g.dispatchId)) s.shipped = s.shipped.plus(D(g._sum.pcs));
  }
  return out;
}

/** The flow of one order and style. */
export async function shippingFlowFor(client, { orderId, styleId }) {
  const sums = await shippingSums(client, { orderId, styleId });
  return shippingFlow(sums.get(`${orderId}:${styleId}`) ?? ZERO());
}

/** Every style of one order: [{ styleId, flow }]. */
export async function shippingFlowsOfOrder(client, orderId) {
  const sums = await shippingSums(client, { orderId });
  return [...sums.values()].map((s) => ({ styleId: s.styleId, flow: shippingFlow(s) }));
}

/** Plain figures for an API response. */
export function shippingJson(f) {
  return Object.fromEntries(
    Object.entries(f).map(([k, v]) => {
      if (k === 'colors') {
        return [k, v.map((c) => ({ color: c.color, checked: c.checked.toString(), packed: c.packed.toString(), awaitingPacking: c.awaitingPacking.toString() }))];
      }
      return [k, typeof v === 'number' ? v : D(v).toString()];
    }),
  );
}

/**
 * Throws if the write just made breaks the flow. Call it inside the write's
 * transaction, after the write, holding the order and style's lock.
 *
 * @param label   "B9641IS / TR-0751-008" - for the message
 */
export async function assertShippingFlow(tx, { orderId, styleId }, label) {
  const f = await shippingFlowFor(tx, { orderId, styleId });
  const details = { flow: shippingJson(f) };

  if (f.needleChecked.greaterThan(f.approved)) {
    throw ApiError.conflict(
      `The needle-checked cartons of ${label} would hold ${f.needleChecked} pcs, but External QC approved only ${f.approved}. `
        + 'Cartons cannot hold more than External QC approved.',
      details,
    );
  }
  for (const c of f.colors) {
    if (c.packed.greaterThan(c.checked)) {
      throw ApiError.conflict(
        `${label}${c.color ? ` (${c.color})` : ''} would have ${c.packed} pcs packed but only ${c.checked} needle-checked. `
          + 'Total packed can never exceed the needle-checked qty.',
        details,
      );
    }
  }
  if (f.dispatched.greaterThan(f.packed)) {
    throw ApiError.conflict(
      `${label} would have ${f.dispatched} pcs on dispatches but only ${f.packed} packed. `
        + 'Remove them from the pending dispatch first.',
      details,
    );
  }
  if (f.boxesDispatched.greaterThan(f.boxesPacked)) {
    throw ApiError.conflict(
      `${label} would have ${f.boxesDispatched} boxes on dispatches but only ${f.boxesPacked} packed.`,
      details,
    );
  }
  return f;
}

// ===========================================================================
//  THE PACKING LINES ON A DISPATCH
//
//  A dispatch takes the packing lines chosen for it, whole. Its lines and totals are those
//  packing lines summed, so what the dispatch note says and what its packing
//  list prints are the same boxes.
// ===========================================================================

/** Packing lines on no dispatch - or on one since deleted. */
export const FREE_PACKING = [{ dispatchId: null }, { dispatch: { deletedAt: { not: null } } }];

/** Puts packing lines on a dispatch, row by row so the audit trail sees each. */
export async function takePackingLines(tx, dispatchId, entryIds) {
  for (const id of entryIds) await tx.packingEntry.update({ where: { id }, data: { dispatchId } });
}

/** Takes packing lines off a dispatch - all of them when it is being deleted, else those `keep` leaves out. */
export async function releasePackingLines(tx, dispatchId, keep = null) {
  const held = await tx.packingEntry.findMany({
    where: { dispatchId, ...(keep ? { id: { notIn: [...keep] } } : {}) },
    select: { id: true },
  });
  for (const { id } of held) await tx.packingEntry.update({ where: { id }, data: { dispatchId: null } });
}

/**
 * A dispatch's lines and Total Boxes / Total Qty, worked out again from the
 * packing lines it holds. Called whenever those change.
 */
export async function syncDispatch(tx, dispatchId, actorId) {
  // One at a time: two packing edits on different styles of one dispatch
  // would otherwise each total it without the other's change.
  await tx.$queryRaw`SELECT "id" FROM "dispatches" WHERE "id" = ${dispatchId}::uuid FOR UPDATE`;
  const [dispatch, entries, existing] = await Promise.all([
    tx.dispatch.findUnique({ where: { id: dispatchId }, select: { orderId: true } }),
    tx.packingEntry.findMany({ where: { dispatchId, deletedAt: null }, select: { styleId: true, pcsPacked: true, boxesPacked: true } }),
    tx.dispatchLine.findMany({ where: { dispatchId } }),
  ]);
  const totals = dispatchTotalsOf(entries);
  const by = new Map(totals.lines.map((l) => [l.styleId, l]));
  for (const old of existing) if (!by.has(old.styleId)) await tx.dispatchLine.delete({ where: { id: old.id } });
  for (const l of totals.lines) {
    const old = existing.find((o) => o.styleId === l.styleId);
    if (old && D(old.pcs).equals(l.pcs) && old.boxes === l.boxes) continue;
    if (old) await tx.dispatchLine.update({ where: { id: old.id }, data: { pcs: l.pcs, boxes: l.boxes, updatedById: actorId } });
    else {
      await tx.dispatchLine.create({
        data: { dispatchId, orderId: dispatch.orderId, styleId: l.styleId, pcs: l.pcs, boxes: l.boxes, createdById: actorId, updatedById: actorId },
      });
    }
  }
  await tx.dispatch.update({ where: { id: dispatchId }, data: { totalPcs: totals.totalPcs, totalBoxes: totals.totalBoxes, updatedById: actorId } });
  return totals;
}

/**
 * Each order and style's Order Qty, and its ceiling - the order qty plus the
 * order's approved excess (the order line's effective qty). A style with no
 * line of its own is the order's header style, with the header's figures.
 *
 * @returns Map<"orderId:styleId", { orderQty, ceilingQty }>
 */
export async function orderQtys(client, pairs) {
  const orderIds = [...new Set(pairs.map((p) => p.orderId))];
  if (!orderIds.length) return new Map();
  const [orders, lines] = await Promise.all([
    client.buyerOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, styleId: true, orderQty: true, effectiveQty: true } }),
    client.buyerOrderLine.groupBy({
      by: ['orderId', 'styleId'],
      where: { orderId: { in: orderIds }, deletedAt: null },
      _sum: { orderQty: true, effectiveQty: true },
    }),
  ]);
  const out = new Map();
  for (const p of pairs) {
    const key = `${p.orderId}:${p.styleId}`;
    const line = lines.find((l) => l.orderId === p.orderId && l.styleId === p.styleId);
    const order = orders.find((o) => o.id === p.orderId);
    if (line) out.set(key, { orderQty: D(line._sum.orderQty), ceilingQty: D(line._sum.effectiveQty) });
    else if (order && order.styleId === p.styleId) out.set(key, { orderQty: D(order.orderQty), ceilingQty: D(order.effectiveQty) });
    else out.set(key, { orderQty: null, ceilingQty: null });
  }
  return out;
}

/**
 * The colours of an order for one style - the order lines' colours, else the
 * order's own, else the style's. The Color dropdown on Needle Checking.
 */
export async function orderColors(client, { orderId, styleId }) {
  const [lines, order, style] = await Promise.all([
    client.buyerOrderLine.findMany({
      where: { orderId, styleId, deletedAt: null, colorCode: { not: null } },
      orderBy: { lineNo: 'asc' },
      select: { colorCode: true },
    }),
    client.buyerOrder.findFirst({ where: { id: orderId }, select: { styleId: true, colorCode: true } }),
    client.style.findFirst({ where: { id: styleId }, select: { colorCode: true } }),
  ]);
  const out = [...new Set(lines.map((l) => l.colorCode).filter(Boolean))];
  if (!out.length && order?.styleId === styleId && order.colorCode) out.push(order.colorCode);
  if (!out.length && style?.colorCode) out.push(style.colorCode);
  return out;
}

/** "B9641IS / TR-0751-008". */
export async function labelOf(client, { orderId, styleId }) {
  const [order, style] = await Promise.all([
    client.buyerOrder.findFirst({ where: { id: orderId, deletedAt: null }, select: { orderNo: true } }),
    client.style.findFirst({ where: { id: styleId, deletedAt: null }, select: { styleNo: true } }),
  ]);
  if (!order) throw ApiError.badRequest('That order does not exist', { field: 'orderId' });
  if (!style) throw ApiError.badRequest('That style does not exist', { field: 'styleId' });
  return `${order.orderNo} / ${style.styleNo}`;
}

/** Refuses a write against a cancelled or on-hold order. */
export async function assertOrderLive(tx, orderId, what) {
  const o = await tx.buyerOrder.findFirst({ where: { id: orderId, deletedAt: null }, select: { orderNo: true, status: true } });
  if (o && ['CANCELLED', 'ON_HOLD'].includes(o.status)) {
    throw ApiError.conflict(`Order ${o.orderNo} is ${o.status === 'CANCELLED' ? 'cancelled' : 'on hold'} and cannot be ${what}`);
  }
}
