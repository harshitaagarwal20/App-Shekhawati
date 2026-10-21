/**
 * Stitching and Hourly Monitoring - the arithmetic and the unit rule.
 *
 * Pure functions, no database, so test/stitching.rules.test.js can prove each
 * one on a bare Node install. stitching.service.js calls these and nothing
 * else does the sums.
 *
 * ---------------------------------------------------------------------------
 *  THE THREE NUMBERS ON A STITCHING RECORD
 *
 *      Deliverable   what the approved stitching plan asked of this unit on
 *                    this date (editable - the supervisor may know better)
 *      Actual        what the unit stitched
 *      Remaining     Deliverable - Actual
 *
 *  The workbook's sample row reads 10,000 / 900 / 100, which satisfies no
 *  formula. Remaining is Deliverable - Actual here, and negative when the
 *  unit beat the day's target.
 *
 *  THE CEILING
 *
 *  A unit cannot have stitched more pieces of an order and style than the
 *  cutting issues posted to it carried. "Stitched" is the running total of
 *  every live record for that unit, order and style.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v ?? 0);

/** Remaining = Deliverable - Actual, as a Decimal. */
export function remainingOf(deliverableQty, actualStitched) {
  return D(deliverableQty).minus(D(actualStitched));
}

/**
 * Would recording `actual` keep the unit within the pieces it was issued?
 *
 * @param issued         cut pieces posted to the unit for the order and style
 * @param stitchedOthers stitched on every OTHER live record (this one excluded)
 * @param actual         the count being saved
 */
export function stitchCeiling({ issued, stitchedOthers, actual }) {
  const issuedD = D(issued);
  const totalAfter = D(stitchedOthers).plus(D(actual));
  const canStillRecord = issuedD.minus(D(stitchedOthers));
  return {
    ok: totalAfter.lessThanOrEqualTo(issuedD),
    issued: issuedD,
    totalAfter,
    /** The most this record may carry. Never below zero. */
    maxForThisRecord: canStillRecord.greaterThan(0) ? canStillRecord : D(0),
    excess: totalAfter.minus(issuedD),
  };
}

/**
 * The position of a unit on an order and style: issued, stitched, the
 * balance still to stitch.
 */
export function unitPosition({ issued, stitched }) {
  const issuedD = D(issued);
  const stitchedD = D(stitched);
  return {
    pcsIssued: issuedD.toString(),
    pcsStitched: stitchedD.toString(),
    pcsBalance: issuedD.minus(stitchedD).toString(),
  };
}

// What a unit still holds - stitched, less out for printing, less gone to
// ironing - is availableToReceive() in domain/ironing.js, and the check every
// write passes is unitFlow.service.js.

/** A printing row's status follows from its two counts. */
export function printingStatusOf(qty, qtyReceived) {
  const received = D(qtyReceived);
  if (received.lessThanOrEqualTo(0)) return 'PENDING';
  if (received.greaterThanOrEqualTo(D(qty))) return 'COMPLETED';
  return 'IN_PROGRESS';
}

/** A slot is short when the style has a target and the count is under it. */
export function belowTarget(pcs, hourlyTarget) {
  if (hourlyTarget == null || pcs == null || pcs === '') return false;
  const target = D(hourlyTarget);
  if (target.lessThanOrEqualTo(0)) return false;
  return D(pcs).lessThan(target);
}

/**
 * The Hourly Monitoring grid for one date and order/style.
 *
 * @param slots    the slot labels, in column order
 * @param tailors  [{ id, empId, empName }]
 * @param entries  [{ employeeId, slot, pcs, hourlyTarget? }]
 * @param target   the style's hourly target, or null. A cell that froze its
 *                 own target when it was saved is judged against that one.
 *
 * Entries for a tailor no longer on the roster (moved unit, made inactive)
 * still count: they become rows of their own, so the totals never drop a
 * piece that was stitched. Entries in a slot no longer configured are kept
 * the same way.
 */
export function buildGrid({ slots, tailors, entries, target = null, extraTailors = [] }) {
  const slotList = [...slots];
  for (const e of entries) if (!slotList.includes(e.slot)) slotList.push(e.slot);

  const roster = [...tailors];
  const known = new Set(roster.map((t) => t.id));
  for (const t of extraTailors) {
    if (!known.has(t.id)) {
      roster.push({ ...t, offRoster: true });
      known.add(t.id);
    }
  }

  const byTailor = new Map(roster.map((t) => [t.id, {}]));
  for (const e of entries) {
    if (!byTailor.has(e.employeeId)) {
      byTailor.set(e.employeeId, {});
      roster.push({ id: e.employeeId, empId: '?', empName: 'Unknown employee', offRoster: true });
    }
    byTailor.get(e.employeeId)[e.slot] = { pcs: D(e.pcs), target: e.hourlyTarget ?? target };
  }

  const slotTotals = Object.fromEntries(slotList.map((s) => [s, D(0)]));
  let total = D(0);

  const rows = roster.map((t) => {
    const cells = byTailor.get(t.id) ?? {};
    let rowTotal = D(0);
    const out = {};
    for (const s of slotList) {
      if (cells[s] === undefined) continue;
      const { pcs, target: cellTarget } = cells[s];
      rowTotal = rowTotal.plus(pcs);
      slotTotals[s] = slotTotals[s].plus(pcs);
      out[s] = { pcs: pcs.toString(), short: belowTarget(pcs, cellTarget) };
    }
    total = total.plus(rowTotal);
    return {
      employeeId: t.id,
      empId: t.empId,
      empName: t.empName,
      offRoster: Boolean(t.offRoster),
      cells: out,
      total: rowTotal.toString(),
    };
  });

  return {
    slots: slotList,
    rows,
    slotTotals: Object.fromEntries(Object.entries(slotTotals).map(([k, v]) => [k, v.toString()])),
    total: total.toString(),
    hourlyTarget: target == null ? null : D(target).toString(),
  };
}

/**
 * WHICH UNIT THIS LOGIN WORKS FOR.
 *
 * The rule the brief states - "AUTO from the logged-in supervisor; DROPDOWN
 * for Admin" - made precise:
 *
 *   - A login tied to an employee whose Unit / Line is a stitching unit works
 *     for that unit and no other, for reads and writes alike. Admin excepted.
 *   - Admin chooses any unit.
 *   - Anyone else (the Director, the office) may READ any unit, and may not
 *     write: there is no unit to record for, and choosing one would let a
 *     login record a count for a floor it does not run.
 *
 * @returns {{ fixedUnit: string|null, canChoose: boolean, canWrite: boolean }}
 */
export function unitScopeFor({ isAdmin, employeeUnit, units }) {
  const own = employeeUnit && units.includes(employeeUnit) ? employeeUnit : null;
  if (isAdmin) return { fixedUnit: null, canChoose: true, canWrite: true };
  if (own) return { fixedUnit: own, canChoose: false, canWrite: true };
  return { fixedUnit: null, canChoose: true, canWrite: false };
}
