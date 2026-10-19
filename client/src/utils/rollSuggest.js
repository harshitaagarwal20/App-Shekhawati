/**
 * Which rolls to offer for a cutting challan line.
 *
 * ===========================================================================
 *  A SUGGESTION, NOT AN ISSUE
 * ===========================================================================
 *
 *  "Issue fabric" on a challan line opens the issue screen with the rolls
 *  already picked, so the storeman only checks them against the rack and
 *  confirms. Nothing posts until they do - the rolls on the rack, not the
 *  ones in the database, are what actually leave.
 *
 *  The rules, in order:
 *
 *    1  same colour and UOM as the line - anything else is not this fabric
 *    2  one shade / dye lot - the first group that covers the outstanding
 *       quantity on its own, so the cutting floor is not handed a mix and the
 *       shade check has nothing to ask about. Where no single group covers
 *       it, the group that covers most, and the screen says what is short.
 *    3  within the group, rolls bought for this order first, then by roll
 *       number - the older roll leaves the rack first
 *    4  whole rolls until the quantity is covered; the last roll gives only
 *       what is still needed
 * ===========================================================================
 */

const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase());

const byRack = (a, b) =>
  Number(b.forThisOrder === true) - Number(a.forThisOrder === true) ||
  String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true });

/** Four decimals, the precision every quantity in the system is held at. */
const q4 = (n) => Math.round(n * 10000) / 10000;

/**
 * @param rolls       the roll picker's rows (`GET /fabric-issues/rolls`)
 * @param line        an `issuableLines` row: colorCode, uom, outstandingQty
 * @param maxRolls    the batch limit
 * @returns {{ picks: {id, qty}[], suggestedQty: number, shortQty: number }}
 */
export function suggestRolls(rolls, line, maxRolls = 30) {
  const need = Number(line?.outstandingQty ?? 0);
  const none = { picks: [], suggestedQty: 0, shortQty: need > 0 ? need : 0 };
  if (!(need > 0)) return none;

  const candidates = (rolls ?? []).filter(
    (r) =>
      Number(r.balanceQty) > 0 &&
      (!line.colorCode || norm(r.colorCode) === norm(line.colorCode)) &&
      (!line.uom || norm(r.uom) === norm(line.uom)),
  );
  if (!candidates.length) return none;

  // Group by shade and dye lot, each group in rack order.
  const groups = new Map();
  for (const r of candidates) {
    const key = `${norm(r.shade)}|${norm(r.dyeLot)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const ranked = [...groups.values()]
    .map((g) => {
      const sorted = [...g].sort(byRack);
      return {
        rolls: sorted,
        total: sorted.slice(0, maxRolls).reduce((s, r) => s + Number(r.balanceQty), 0),
        forOrder: sorted.some((r) => r.forThisOrder === true),
        first: sorted[0],
      };
    })
    .sort(
      (a, b) =>
        Number(b.total >= need) - Number(a.total >= need) ||
        // Among groups that cover it, this order's own fabric, then the
        // older roll. Among those that do not, the one that covers most.
        (a.total >= need
          ? Number(b.forOrder) - Number(a.forOrder) || byRack(a.first, b.first)
          : b.total - a.total),
    );

  const picks = [];
  let left = need;
  for (const r of ranked[0].rolls) {
    if (left <= 0 || picks.length >= maxRolls) break;
    const qty = q4(Math.min(Number(r.balanceQty), left));
    picks.push({ id: r.id, qty });
    left = q4(left - qty);
  }

  return {
    picks,
    suggestedQty: q4(need - left),
    shortQty: left > 0 ? left : 0,
  };
}
