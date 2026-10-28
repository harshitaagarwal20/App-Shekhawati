/**
 * Needle Checking, Packing and Dispatch - the arithmetic.
 * Pure, no database: test/shipping.rules.test.js drives it directly, and the
 * services do no sums of their own.
 *
 * ---------------------------------------------------------------------------
 *  THE PIPELINE OF ONE ORDER AND STYLE, AFTER EXTERNAL QC
 *
 *      approved at External QC
 *        - needle-checked                      cartons never hold more than approved
 *      needle-checked, colour by colour
 *        - packed                              never more than needle-checked of the colour
 *      packed
 *        - on a dispatch                       never more than packed
 *
 *  A dispatch takes the packing lines of its order chosen for it, each line
 *  whole and on one dispatch only. Only Dispatched and Delivered dispatches count as shipped for
 *  the order's status; a Pending one holds its pieces but has not left, and
 *  the lines on one that has left cannot be changed.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v ?? 0);

/** How many size columns the Size Assortment Carton sheet has. */
export const SIZE_COUNT = 10;
export const SIZE_KEYS = Array.from({ length: SIZE_COUNT }, (_, i) => `size${i + 1}`);

/** A colour as a map key: no colour is a colour of its own. */
export const colorKey = (c) => String(c ?? '').trim();

// ===========================================================================
//  PACKETS AND BAGS
//
//  One bag holds one piece. The style says how many bags make a packet and
//  how many packets a carton - 10 and 10 unless it says otherwise.
// ===========================================================================

/** Pieces in a full carton: packets x bags. */
export const pcsPerFullCartonOf = (style) => (Number(style?.packetsPerCarton) || 0) * (Number(style?.bagsPerPacket) || 0);

/**
 * Some pieces (one carton or box) as packets and bags: 100 at 10 a packet is
 * "10 pkts × 10"; 95 is "9 pkts × 10 + 5 bags".
 * @returns { bags, packets, looseBags, label }
 */
export function packetsOf(pcs, bagsPerPacket) {
  const per = Number(bagsPerPacket) || 0;
  const bags = Number(pcs) || 0;
  if (per <= 0) return { bags, packets: null, looseBags: null, label: null };
  const packets = Math.floor(bags / per);
  const looseBags = bags - packets * per;
  const parts = [`${packets} pkt${packets === 1 ? '' : 's'} × ${per}`];
  if (looseBags) parts.push(`${looseBags} bag${looseBags === 1 ? '' : 's'}`);
  return { bags, packets, looseBags, label: parts.join(' + ') };
}

/** Each of `count` cartons (or boxes) holds `pcsEach`: the packets and bags of them all. */
export function packetsOfMany(pcsEach, count, bagsPerPacket) {
  const one = packetsOf(pcsEach, bagsPerPacket);
  const n = Number(count) || 0;
  return {
    perCarton: one,
    packets: one.packets == null ? null : one.packets * n,
    looseBags: one.looseBags == null ? null : one.looseBags * n,
    bags: one.bags * n,
  };
}

// ===========================================================================
//  NEEDLE CHECKING
// ===========================================================================

/** "Pcs/Carton" = Size 1 + ... + Size 10. */
export const pcsPerCartonOf = (row) => SIZE_KEYS.reduce((a, k) => a + (Number(row?.[k]) || 0), 0);

/** The pieces a row passes on: Pcs/Carton x Carton Qty. */
export const cartonTotalOf = (row) => D(pcsPerCartonOf(row)).times(D(row?.cartonQty));

/** "Carton" as printed on the sheet: "7", or "1-10". */
export const cartonLabel = (from, to) => (from == null ? null : to == null || to <= from ? String(from) : `${from}-${to}`);

/**
 * "Carton" (Auto): the carton numbers a new row takes - on from the highest
 * number any live row of the order and style holds. Stored on the row, so a
 * row deleted later leaves a gap rather than renumbering cartons that are
 * already labelled.
 *
 * @param lastTo    the highest cartonTo of the live rows, or null
 * @returns         { cartonFrom, cartonTo }
 */
export function nextCartons(lastTo, cartonQty) {
  const from = (Number(lastTo) || 0) + 1;
  return { cartonFrom: from, cartonTo: from + (Number(cartonQty) || 0) - 1 };
}

/** Whether two runs of numbers share one. */
export const rangesOverlap = (a, b) => a.from <= b.to && b.from <= a.to;

export function cartonProblems(row) {
  const out = [];
  const qty = Number(row.cartonQty);
  if (!Number.isInteger(qty) || qty <= 0) out.push({ field: 'cartonQty', message: 'Enter the carton qty' });
  for (const [i, k] of SIZE_KEYS.entries()) {
    const v = row[k];
    if (v == null || v === '') continue;
    if (!Number.isInteger(Number(v)) || Number(v) < 0) {
      out.push({ field: k, message: `Size ${i + 1} must be a whole number of pieces` });
    }
  }
  if (pcsPerCartonOf(row) <= 0) out.push({ field: 'size1', message: 'Enter the pieces of at least one size' });
  if (!String(row.signedBy ?? '').trim()) out.push({ field: 'signedBy', message: 'Sign for the cartons' });
  return out;
}

// ===========================================================================
//  PACKING
// ===========================================================================

/** "Qty (In pcs)" = Packing x Boxes. */
export const packedQtyOf = (e) => D(e?.pcsPerBox).times(D(e?.boxesPacked));

/** CBM of the boxes: L x W x H (cm) / 1,000,000, times the boxes. */
export function cbmOf(e) {
  if (e?.lengthCm == null || e?.widthCm == null || e?.heightCm == null) return null;
  return D(e.lengthCm).times(D(e.widthCm)).times(D(e.heightCm)).dividedBy(1_000_000).times(D(e.boxesPacked));
}

/**
 * The packing list's formula columns: Qty, N.W (kg), G.W (kg) and CBM.
 * N.W and G.W are the per-box weight times the boxes; blank if the per-box
 * weight is.
 */
export function packingFigures(e) {
  const boxes = D(e?.boxesPacked);
  const cbm = cbmOf(e);
  return {
    qty: packedQtyOf(e),
    nwKg: e?.nwPerBoxKg == null ? null : D(e.nwPerBoxKg).times(boxes),
    gwKg: e?.gwPerBoxKg == null ? null : D(e.gwPerBoxKg).times(boxes),
    cbm: cbm == null ? null : cbm.toDecimalPlaces(4),
  };
}

/**
 * "Box No" as the box numbers it covers: "7", "1-20", or with a marking in
 * front, "C-1-20" or "DEMO-001-015". Null when it is not written that way.
 *
 * @returns { prefix, from, to, count } | null
 */
export function parseBoxNo(text) {
  const m = /^(.*?)(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const from = Number(m[2]);
  const to = m[3] === undefined ? from : Number(m[3]);
  if (from < 1 || to < from) return null;
  return { prefix: m[1].trim().toUpperCase(), from, to, count: to - from + 1 };
}

/**
 * @param opts.boxNoKept  the line's Box No is the one it was saved with, so an
 *                        old one not written as box numbers may stay
 */
export function packingProblems(e, { boxNoKept = false } = {}) {
  const out = [];
  const per = Number(e.pcsPerBox);
  const boxes = Number(e.boxesPacked);
  const boxNo = String(e.boxNo ?? '').trim();
  const run = parseBoxNo(boxNo);
  if (!boxNo) out.push({ field: 'boxNo', message: 'Enter the box no' });
  else if (!run && !boxNoKept) out.push({ field: 'boxNo', message: 'Enter the box no as box numbers: 7, or 1-20' });
  else if (run && Number.isInteger(boxes) && boxes > 0 && run.count !== boxes) {
    out.push({ field: 'boxNo', message: `Box No ${boxNo} is ${run.count} box${run.count === 1 ? '' : 'es'}, but Boxes is ${boxes}` });
  }
  if (!Number.isInteger(per) || per <= 0) out.push({ field: 'pcsPerBox', message: 'Enter the pieces in each box' });
  if (!Number.isInteger(boxes) || boxes <= 0) out.push({ field: 'boxesPacked', message: 'Enter the boxes' });
  if (e.nwPerBoxKg != null && e.gwPerBoxKg != null && D(e.gwPerBoxKg).lessThan(D(e.nwPerBoxKg))) {
    out.push({ field: 'gwPerBoxKg', message: 'G.W per box cannot be less than N.W per box' });
  }
  return out;
}

// ===========================================================================
//  THE FLOW OF ONE ORDER AND STYLE
// ===========================================================================

/**
 * Every figure from the raw sums.
 *
 * @param s {
 *   approved,                                 (External QC)
 *   checked, cartons,                         (Needle Checking)
 *   packed, boxesPacked,                      (Packing)
 *   dispatched, boxesDispatched, shipped,     (Dispatch - shipped: Dispatched / Delivered only)
 *   colors: Map<colour, { checked, packed }>,
 * }
 */
export function shippingFlow(s) {
  const v = (k) => D(s[k]);
  const colors = [...(s.colors ?? new Map()).entries()]
    .map(([color, c]) => ({
      color,
      checked: D(c.checked),
      packed: D(c.packed),
      awaitingPacking: D(c.checked).minus(D(c.packed)),
    }))
    .sort((a, b) => a.color.localeCompare(b.color));
  return {
    approved: v('approved'),
    needleChecked: v('checked'),
    cartons: v('cartons'),
    awaitingNeedle: v('approved').minus(v('checked')),
    packed: v('packed'),
    boxesPacked: v('boxesPacked'),
    awaitingPacking: v('checked').minus(v('packed')),
    dispatched: v('dispatched'),
    boxesDispatched: v('boxesDispatched'),
    shipped: v('shipped'),
    packedNotDispatched: v('packed').minus(v('dispatched')),
    boxesNotDispatched: v('boxesPacked').minus(v('boxesDispatched')),
    colors,
  };
}

// ===========================================================================
//  DISPATCH
// ===========================================================================

/** The Status dropdown. */
export const DISPATCH_STATUSES = ['PENDING', 'DISPATCHED', 'DELIVERED'];

/** The statuses whose pieces have left - what the order counts as shipped. */
export const SHIPPED_STATUSES = ['DISPATCHED', 'DELIVERED'];

/**
 * What a buyer order's status becomes from the pieces that have left, across
 * all its styles, against its order qty. Null: nothing has left.
 */
export function shipStatusOf(shipped, orderQty) {
  const d = D(shipped);
  if (d.lessThanOrEqualTo(0)) return null;
  return d.greaterThanOrEqualTo(D(orderQty)) ? 'SHIPPED' : 'PARTIALLY_SHIPPED';
}

/**
 * "Total Boxes" / "Total Qty" (Auto - from packing): the packing lines the
 * dispatch takes, summed style by style. A packing line goes on one dispatch,
 * whole, so the boxes on a dispatch are always boxes that were packed.
 *
 * @param entries  [{ styleId, pcsPacked, boxesPacked }] - the packing lines
 * @returns        { lines: [{ styleId, pcs, boxes }], totalPcs, totalBoxes }
 */
export function dispatchTotalsOf(entries) {
  const by = new Map();
  for (const e of entries) {
    const l = by.get(e.styleId) ?? { styleId: e.styleId, pcs: D(0), boxes: 0 };
    l.pcs = l.pcs.plus(D(e.pcsPacked));
    l.boxes += Number(e.boxesPacked) || 0;
    by.set(e.styleId, l);
  }
  const lines = [...by.values()].filter((l) => l.pcs.greaterThan(0));
  return {
    lines,
    totalPcs: lines.reduce((a, l) => a.plus(l.pcs), D(0)),
    totalBoxes: lines.reduce((a, l) => a + l.boxes, 0),
  };
}
