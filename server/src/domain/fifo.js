/**
 * FIFO costing - the arithmetic, with no database in it.
 *
 * ---------------------------------------------------------------------------
 *  THE POLICY IN FOUR RULES (docs/STOCK-VALUATION-POLICY.md)
 *
 *   1. Every IN opens a cost layer at its own rate.
 *   2. Every OUT consumes the OLDEST layers at that (item, location) first -
 *      oldest by `layerDate`, then by when the layer was written.
 *   3. A TRANSFER carries the consumed layers to the new location with their
 *      ORIGINAL dates and rates, so moving cloth never changes its cost or
 *      makes it younger.
 *   4. A process loss absorbed on a transfer (job-work shrinkage) keeps the
 *      whole cost: the metres that came back carry the value of the metres
 *      that went out, as normal-loss costing requires.
 *
 *  `inventory.service.js` loads the layers under the (item, location) lock
 *  and writes what these functions return. Nothing here reads or writes.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

/** Layers in the order FIFO consumes them. */
export function fifoOrder(layers) {
  return [...layers].sort(
    (a, b) =>
      new Date(a.layerDate).getTime() - new Date(b.layerDate).getTime() ||
      new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime() ||
      String(a.id).localeCompare(String(b.id)),
  );
}

/**
 * Which layers an OUT of `qty` consumes, and at what cost.
 *
 * @param {Array<{id, layerDate, createdAt?, qtyRemaining, rate}>} layers
 * @param {any} qty
 * @param {{prefer?: (layer) => boolean}} [opts]
 *   `prefer` pulls matching layers to the front before FIFO order applies -
 *   used only by a GRN reversal, which must take back the receipt's own cost
 *   rather than whatever happens to be oldest.
 * @returns {{slices: Array<{layerId, layerDate, rate: string, qty: string, value: string}>,
 *   costedQty: string, shortfallQty: string, value: string}}
 */
export function planConsumption(layers, qty, { prefer } = {}) {
  const ordered = fifoOrder(layers.filter((l) => D(l.qtyRemaining).greaterThan(0)));
  const queue = prefer
    ? [...ordered.filter((l) => prefer(l)), ...ordered.filter((l) => !prefer(l))]
    : ordered;

  let need = D(qty);
  const slices = [];
  for (const layer of queue) {
    if (!need.greaterThan(0)) break;
    const take = Prisma.Decimal.min(need, D(layer.qtyRemaining));
    slices.push({
      layerId: layer.id,
      layerDate: layer.layerDate,
      rate: D(layer.rate).toFixed(4),
      qty: take.toFixed(4),
      value: take.mul(D(layer.rate)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
    });
    need = need.minus(take);
  }

  const value = slices.reduce((a, s) => a.plus(D(s.value)), ZERO);
  return {
    slices,
    costedQty: D(qty).minus(need).toFixed(4),
    /** Quantity with no layer behind it. Zero whenever the layers are in step with the ledger. */
    shortfallQty: need.toFixed(4),
    value: value.toFixed(2),
  };
}

/** The value of a set of slices, and the rate that value works out to over `qty`. */
export function costOf(slices, qty) {
  const value = slices.reduce((a, s) => a.plus(D(s.value)), ZERO);
  const q = D(qty);
  return {
    value: value.toFixed(2),
    rate: q.greaterThan(0) ? value.div(q).toDecimalPlaces(4).toFixed(4) : '0.0000',
  };
}

/**
 * Splits the NEWEST end off a set of consumed slices - what goes back into
 * stock when only part of an OUT was used.
 *
 * FIFO says the oldest cloth was used first, so what is left over is the
 * newest. Each quantity in `parts` is taken in turn from the newest end.
 *
 * @param {Array} slices   As returned by planConsumption, oldest first
 * @param {any[]} parts    Quantities to peel off, e.g. [remainder, remnant]
 * @returns {Array<Array>} One set of slices per part
 */
export function takeNewest(slices, parts) {
  const pool = [...slices].reverse().map((s) => ({ ...s, left: D(s.qty) }));
  return parts.map((part) => {
    let need = D(part);
    const out = [];
    for (const s of pool) {
      if (!need.greaterThan(0)) break;
      if (!s.left.greaterThan(0)) continue;
      const take = Prisma.Decimal.min(need, s.left);
      s.left = s.left.minus(take);
      need = need.minus(take);
      out.push({
        layerId: s.layerId,
        layerDate: s.layerDate,
        rate: s.rate,
        qty: take.toFixed(4),
        value: take.mul(D(s.rate)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
      });
    }
    return out.reverse();
  });
}

/**
 * The layers an IN opens, given the cost it carries in.
 *
 * - No carried cost: one layer at the movement's own rate, dated the movement.
 * - Carried slices covering exactly the quantity: one layer per slice, each
 *   keeping its original date and rate (rule 3).
 * - Carried slices covering MORE than the quantity (a shrinkage loss): one
 *   layer holding the whole carried value, at value / qty, dated as the
 *   oldest slice (rule 4).
 *
 * @returns {Array<{layerDate, qty: string, rate: string}>}
 */
export function layersForIn({ qty, rate, entryDate, carry }) {
  const q = D(qty);
  if (!carry || carry.length === 0) {
    return [{ layerDate: entryDate, qty: q.toFixed(4), rate: D(rate).toFixed(4) }];
  }
  const carriedQty = carry.reduce((a, s) => a.plus(D(s.qty)), ZERO);
  if (carriedQty.equals(q)) {
    return carry.map((s) => ({ layerDate: s.layerDate, qty: D(s.qty).toFixed(4), rate: D(s.rate).toFixed(4) }));
  }
  const value = carry.reduce((a, s) => a.plus(D(s.value)), ZERO);
  const oldest = fifoOrder(carry)[0].layerDate;
  return [{ layerDate: oldest, qty: q.toFixed(4), rate: value.div(q).toDecimalPlaces(4).toFixed(4) }];
}
