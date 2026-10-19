/**
 * The sample check on cut pieces: is this lot fit to go to stitching?
 *
 * ---------------------------------------------------------------------------
 *  WHY IT EXISTS
 *
 *  A hole, a stain or a mis-cut panel found at the stitching machine has
 *  already cost a bag: the other panels are sewn to it, the thread and the
 *  labour are spent. Found on the cutting table it costs one panel, re-cut.
 *
 *  So every lot the cutting master hands over is checked on a SAMPLE before
 *  it may be issued to stitching. The checker opens N pieces, writes down
 *  every defect by panel and type, and the rate decides the lot:
 *
 *      defect rate = defective pieces / pieces checked
 *      rate <= accept limit  ->  PASSED  (defective pieces are pulled out)
 *      rate >  accept limit  ->  FAILED  (the lot is sorted and checked again)
 *
 *  THE CHECKER DOES NOT CHOOSE PASS OR FAIL. They record what they found and
 *  the arithmetic decides, so a lot cannot be waved through by a tick-box.
 *
 *  Pure, so it can be proved without a database.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v ?? 0);

/** Pieces opened out of every hundred handed over, unless the checker says otherwise. */
export const DEFAULT_SAMPLE_PCT = 10;

/** Defective pieces per hundred checked above which a lot fails. */
export const DEFAULT_ACCEPT_LIMIT_PCT = 2.5;

/**
 * How many pieces to open for a lot: the sample percentage, rounded UP so a
 * small lot is still checked, never more than the lot itself.
 */
export function suggestedSample(pcs, pct = DEFAULT_SAMPLE_PCT) {
  const n = Math.floor(Number(pcs) || 0);
  if (n <= 0) return 0;
  return Math.min(n, Math.max(1, Math.ceil((n * Number(pct)) / 100)));
}

/**
 * Decides a lot from what the checker found.
 *
 * @param {object} p
 * @param {any} p.pcsReceived     Good pieces handed over on the receipt
 * @param {any} p.sampleQty       Pieces opened and checked
 * @param {any} p.defectivePcs    Of those, pieces with a defect
 * @param {any} [p.acceptLimitPct]
 * @returns {{status: 'PASSED'|'FAILED', defectRatePct: string, readyPcs: string}}
 *   `readyPcs` is what may go to stitching: the lot less the defective pieces
 *   pulled out of it, and nothing at all from a failed lot.
 */
export function judgeSample({ pcsReceived, sampleQty, defectivePcs, acceptLimitPct = DEFAULT_ACCEPT_LIMIT_PCT }) {
  const lot = D(pcsReceived);
  const sample = D(sampleQty);
  const bad = D(defectivePcs);
  const limit = D(acceptLimitPct);

  if (sample.lte(0)) throw new RangeError('Check at least one piece');
  if (sample.greaterThan(lot)) {
    throw new RangeError(`Only ${lot.toString()} pieces were received - ${sample.toString()} cannot be checked`);
  }
  if (bad.lessThan(0)) throw new RangeError('Defective pieces cannot be negative');
  if (bad.greaterThan(sample)) {
    throw new RangeError(
      `${bad.toString()} defective pieces is more than the ${sample.toString()} checked`,
    );
  }

  const rate = bad.div(sample).times(100);
  const passed = rate.lte(limit);
  return {
    status: passed ? 'PASSED' : 'FAILED',
    defectRatePct: rate.toFixed(3),
    readyPcs: passed ? lot.minus(bad).toString() : '0',
  };
}
