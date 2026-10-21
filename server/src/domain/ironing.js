/**
 * Ironing - the arithmetic. Pure, no database: test/ironing.rules.test.js
 * drives it directly, and ironing.service.js does no sums of its own.
 *
 * ---------------------------------------------------------------------------
 *  THE FLOW OF ONE UNIT'S PIECES OF ONE ORDER AND STYLE
 *
 *      stitched by the unit
 *        - out for printing (sent - received back)
 *        - received at ironing
 *        = still at the unit, available to send to ironing       >= 0
 *
 *      received at ironing
 *        - ironed
 *        - damaged
 *        + re-ironed (damaged pieces decided "Re-iron" come back)
 *        = balance waiting at ironing                            >= 0
 *
 *  Both must hold after every write - stitching, printing and ironing alike -
 *  which is what "received cannot exceed stitched less out for printing" and
 *  "ironed + damaged cannot exceed received" mean once re-ironing exists.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v ?? 0);

/** Received - ironed - damaged + re-ironed. */
export function balanceAtIroning({ received, ironed, damaged, reIroned }) {
  return D(received).minus(D(ironed)).minus(D(damaged)).plus(D(reIroned));
}

/** Stitched - out for printing - already received at ironing. */
export function availableToReceive({ stitched, outForPrinting, receivedAtIroning }) {
  return D(stitched).minus(D(outForPrinting)).minus(D(receivedAtIroning));
}

/** Damaged pieces not yet decided either way. */
export function undecidedOf({ damaged, reIroned, rejected }) {
  return D(damaged).minus(D(reIroned)).minus(D(rejected));
}

/**
 * Damage as a share of the pieces that went under the iron: damaged over
 * (ironed + damaged). Null when nothing was ironed or damaged.
 */
export function damageFraction(ironed, damaged) {
  const attempts = D(ironed).plus(D(damaged));
  if (attempts.lessThanOrEqualTo(0)) return null;
  return D(damaged).div(attempts);
}

export const pctText = (fraction) =>
  fraction == null ? '-' : `${D(fraction).mul(100).toDecimalPlaces(1).toFixed(1)}%`;

/**
 * What one entry must say about itself, whatever the totals.
 * Returns a list of { field, message }, empty when the entry is sound.
 */
export function entryProblems(e) {
  const out = [];
  const received = D(e.pcsReceived);
  const ironed = D(e.pcsIroned);
  const damaged = D(e.pcsDamaged);
  const reIroned = D(e.pcsReIroned);
  const rejected = D(e.pcsRejected);

  if (received.plus(ironed).plus(damaged).lessThanOrEqualTo(0)) {
    out.push({ field: 'pcsReceived', message: 'Enter the pieces received, ironed or damaged' });
  }
  if (damaged.greaterThan(0) && !e.damageType) {
    out.push({ field: 'damageType', message: 'Choose the damage type' });
  }
  if (reIroned.plus(rejected).greaterThan(damaged)) {
    out.push({
      field: 'pcsRejected',
      message: `Re-iron (${reIroned}) and rejected (${rejected}) cannot be more than the ${damaged} damaged`,
    });
  }
  if (ironed.plus(damaged).greaterThan(0) && !e.ironerId) {
    out.push({ field: 'ironerId', message: 'Choose the ironer' });
  }
  return out;
}

/**
 * The pieces a unit has sent to ironing, shared across its cutting challans
 * for the order and style, oldest challan first. A challan is Closed when
 * every piece it carried has come back stitched, Partially received when
 * some have, Not received when none have.
 *
 * Anything beyond what the challans carried (it cannot happen while the
 * ceilings hold) stays on the newest, so no piece is ever dropped.
 *
 * @param challans [{ id, pcsIssued }] oldest first
 * @returns [{ id, received: Decimal, status }]
 */
export function allocateReceipts(challans, received) {
  let left = D(received);
  return challans.map((c, i) => {
    const issued = D(c.pcsIssued);
    const last = i === challans.length - 1;
    const take = last ? left : Prisma.Decimal.min(left, issued);
    left = left.minus(take);
    let status = 'NOT_RECEIVED';
    if (take.greaterThan(0)) status = take.greaterThanOrEqualTo(issued) ? 'CLOSED' : 'PARTIALLY_RECEIVED';
    return { id: c.id, received: take, status };
  });
}
