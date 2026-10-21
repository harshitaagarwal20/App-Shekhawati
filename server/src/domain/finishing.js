/**
 * External QC, the Alteration Unit and the finishing pipeline - the
 * arithmetic. Pure, no database: test/finishing.rules.test.js drives it
 * directly, and the services do no sums of their own.
 *
 * ---------------------------------------------------------------------------
 *  ONE EXTERNAL QC ENTRY
 *
 *      offered = approved + alteration + rejected
 *      alteration = Alter + Iron + Defected + Spoiled + Other   (its reasons)
 *      rejected   = Alter + Iron + Defected + Spoiled + Other   (its reasons)
 *
 *  Where each piece goes next:
 *
 *      approved                  -> Humidity Checking (Phase 5)
 *      Iron, in either box       -> back to Ironing, source Re-iron
 *      anything else in a box    -> the Alteration Unit, one bag per box+reason
 *
 *  Nothing from External QC ever goes back to a stitching unit.
 * ---------------------------------------------------------------------------
 *  THE PIPELINE OF ONE ORDER AND STYLE, AFTER THE STITCHING UNITS
 *
 *  Every piece received at ironing from the units is in exactly one of these
 *  places, and they add back up to what was received - no piece is counted at
 *  two stages, and none goes missing between them:
 *
 *      at ironing, waiting         received (all sources) - ironed - damaged + re-ironed
 *      at ironing, damage undecided  damaged - re-ironed - rejected at ironing
 *      ironed, waiting for QC      ironed - offered
 *      approved                    (waiting for Humidity Checking)
 *      sent back to re-iron        QC "Iron" - received at ironing as Re-iron
 *      at the Alteration Unit      bags - altered - not repairable
 *      altered, waiting to iron    altered - received at ironing from Alteration
 *      Rejected Register           not repairable
 *      -----------------------------------------------------------------
 *      = received at ironing from the stitching units
 *
 *  A bag sent back LEAVES the stage that sent it (it is no longer "ironed,
 *  waiting for QC") and re-enters the earlier one only when it is received
 *  there, so a stage balance is always net.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v ?? 0);

/** The reasons, in the order the form shows them, and their column suffix. */
export const QC_REASONS = [
  { key: 'Alter', suffix: 'Alter' },
  { key: 'Iron', suffix: 'Iron' },
  { key: 'Defected', suffix: 'Defected' },
  { key: 'Spoiled', suffix: 'Spoiled' },
  { key: 'Other', suffix: 'Other' },
];

/** The reason whose pieces go back to ironing rather than to alteration. */
export const IRON = 'Iron';

/** The two faulty boxes: their total field, and the prefix of their reasons. */
export const QC_BOXES = [
  { box: 'ALTERATION', label: 'Alteration', total: 'pcsAlteration', prefix: 'alt' },
  { box: 'REJECTED', label: 'Rejected', total: 'pcsRejected', prefix: 'rej' },
];

/** altAlter, altIron ... rejOther - every reason field on an entry. */
export const REASON_FIELDS = QC_BOXES.flatMap((b) => QC_REASONS.map((r) => `${b.prefix}${r.suffix}`));

export const reasonField = (box, reason) => {
  const b = QC_BOXES.find((x) => x.box === box);
  const r = QC_REASONS.find((x) => x.key === reason);
  return b && r ? `${b.prefix}${r.suffix}` : null;
};

/** The sum of one box's reasons. */
export function reasonSum(entry, box) {
  const b = QC_BOXES.find((x) => x.box === box);
  return QC_REASONS.reduce((a, r) => a.plus(D(entry[`${b.prefix}${r.suffix}`])), D(0));
}

/**
 * What one External QC entry must say about itself.
 * Returns a list of { field, message }, empty when the entry is sound.
 */
export function qcProblems(e) {
  const out = [];
  const offered = D(e.pcsOffered);
  const approved = D(e.pcsApproved);
  const alteration = D(e.pcsAlteration);
  const rejected = D(e.pcsRejected);

  if (offered.lessThanOrEqualTo(0)) out.push({ field: 'pcsOffered', message: 'Enter the pieces offered' });
  const boxes = approved.plus(alteration).plus(rejected);
  if (!boxes.equals(offered)) {
    out.push({
      field: 'pcsApproved',
      message: `Approved (${approved}) + Alteration (${alteration}) + Rejected (${rejected}) = ${boxes}, `
        + `but ${offered} were offered. The three boxes must add up to the pieces offered`,
    });
  }
  for (const b of QC_BOXES) {
    const total = D(e[b.total]);
    const sum = reasonSum(e, b.box);
    if (!sum.equals(total)) {
      out.push({
        field: `${b.prefix}Alter`,
        message: `The ${b.label} box holds ${total} but its reasons add up to ${sum}. `
          + 'Give every piece in the box exactly one reason',
      });
    }
  }
  const checkers = (e.checkers ?? []).reduce((a, c) => a.plus(D(c.pcs)), D(0));
  if (checkers.greaterThan(alteration.plus(rejected))) {
    out.push({
      field: 'checkers',
      message: `${checkers} pieces are traced to checker codes, but only ${alteration.plus(rejected)} `
        + 'were sent for alteration or rejected',
    });
  }
  return out;
}

/** Iron, across both boxes: the pieces going back to ironing. */
export const ironOf = (e) => D(e.altIron).plus(D(e.rejIron));

/**
 * The bags one entry sends to the Alteration Unit: every box and reason but
 * Iron, including the zeros, so a correction to nothing is seen.
 *
 * @returns [{ box, reason, qty: Decimal }]
 */
export function bagsOf(e) {
  return QC_BOXES.flatMap((b) =>
    QC_REASONS.filter((r) => r.key !== IRON).map((r) => ({
      box: b.box,
      reason: r.key,
      qty: D(e[`${b.prefix}${r.suffix}`]),
    })),
  );
}

/** Approved / alteration / rejected as a share of offered. Null when nothing was offered. */
export function shareOf(part, offered) {
  if (D(offered).lessThanOrEqualTo(0)) return null;
  return D(part).div(D(offered));
}

// ===========================================================================
//  THE ALTERATION UNIT
// ===========================================================================

/** Received - altered - not repairable. */
export const bagBalance = (bag) => D(bag.qty).minus(D(bag.pcsAltered)).minus(D(bag.pcsNotRepairable));

/** OPEN while pieces remain, CLOSED when all are worked, CANCELLED when the bag is empty. */
export function bagStatus(bag) {
  if (D(bag.qty).lessThanOrEqualTo(0)) return 'CANCELLED';
  return bagBalance(bag).greaterThan(0) ? 'OPEN' : 'CLOSED';
}

/** What one alteration entry must say about itself. */
export function alterationProblems(e) {
  const out = [];
  const altered = D(e.pcsAltered);
  const nr = D(e.pcsNotRepairable);
  if (altered.lessThan(0) || nr.lessThan(0)) out.push({ field: 'pcsAltered', message: 'Counts cannot be negative' });
  if (altered.plus(nr).lessThanOrEqualTo(0)) {
    out.push({ field: 'pcsAltered', message: 'Enter the pieces altered / cleaned, or not repairable' });
  }
  if (nr.greaterThan(0) && !String(e.notRepairableReason ?? '').trim()) {
    out.push({ field: 'notRepairableReason', message: 'Say why the pieces cannot be repaired' });
  }
  if (!e.staffId) out.push({ field: 'staffId', message: 'Choose the alteration staff' });
  return out;
}

// ===========================================================================
//  THE PIPELINE
// ===========================================================================

/**
 * Every stage balance of one order and style, from the raw sums.
 *
 * @param s {
 *   receivedFromUnits, receivedReIron, receivedFromAlteration,   (ironing, by source)
 *   ironed, damaged, reIroned, rejectedAtIroning,                (ironing, all sources)
 *   offered, approved, qcIron, qcToAlteration,                   (External QC)
 *   bagged, altered, notRepairable,                              (Alteration Unit bags)
 * }
 */
export function pipeline(s) {
  const v = Object.fromEntries(Object.entries(s).map(([k, x]) => [k, D(x)]));
  const receivedAtIroning = v.receivedFromUnits.plus(v.receivedReIron).plus(v.receivedFromAlteration);
  const p = {
    receivedFromUnits: v.receivedFromUnits,
    atIroning: receivedAtIroning.minus(v.ironed).minus(v.damaged).plus(v.reIroned),
    damageUndecided: v.damaged.minus(v.reIroned).minus(v.rejectedAtIroning),
    waitingForQc: v.ironed.minus(v.offered),
    approved: v.approved,
    reIronPending: v.qcIron.minus(v.receivedReIron),
    atAlteration: v.bagged.minus(v.altered).minus(v.notRepairable),
    alteredPending: v.altered.minus(v.receivedFromAlteration),
    rejected: v.notRepairable,
  };
  p.accounted = [
    p.atIroning, p.damageUndecided, p.waitingForQc, p.approved,
    p.reIronPending, p.atAlteration, p.alteredPending, p.rejected,
  ].reduce((a, x) => a.plus(x), D(0));
  /** Zero, always, while the bags equal what was sent to alteration. */
  p.difference = p.accounted.minus(p.receivedFromUnits);
  /** Pieces sent to alteration that no bag holds (or the reverse) - zero. */
  p.unbagged = v.qcToAlteration.plus(v.rejectedAtIroning).minus(v.bagged);
  return p;
}

export const pctText = (fraction) =>
  fraction == null ? '-' : `${D(fraction).mul(100).toDecimalPlaces(1).toFixed(1)}%`;
