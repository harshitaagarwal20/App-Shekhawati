/**
 * The cut-pieces arithmetic: bags cut, times the style's panel list.
 *
 * ---------------------------------------------------------------------------
 *  ONE MULTIPLICATION, IN ONE PLACE
 *
 *  A tote is a front, a back, a gusset and two handles. Cutting 1,000 bags is
 *  5,000 pieces of cloth, 2,000 of them handles - and until the style carried
 *  its panel list, that second figure was worked out in somebody's head and
 *  typed on every cut-pieces receipt and cutting issue.
 *
 *  The receipt and the cutting issue both call `panelCounts()`, and both
 *  FREEZE what it returns, so a style whose panel list is corrected next month
 *  does not rewrite what an old receipt says was counted.
 *
 *  Pure, so it can be proved without a database.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v ?? 0);

/** The component types counted as handles rather than panels. */
export const HANDLE_TYPES = new Set(['HANDLE']);

/**
 * What one bag is cut into.
 *
 * @param {Array<{componentType: string, name: string, piecesPerBag: number}>} components
 * @returns {{panelsPerBag: number, handlesPerBag: number} | null}
 *   Null when the style has no panel list - the counts are then typed, as
 *   they always were, rather than silently treated as zero.
 */
export function perBag(components) {
  const live = (components ?? []).filter((c) => Number(c.piecesPerBag) > 0);
  if (live.length === 0) return null;
  return {
    panelsPerBag: live.reduce((a, c) => a + Number(c.piecesPerBag), 0),
    handlesPerBag: live
      .filter((c) => HANDLE_TYPES.has(c.componentType))
      .reduce((a, c) => a + Number(c.piecesPerBag), 0),
  };
}

/**
 * Every panel a quantity of bags is cut into, component by component.
 *
 * @param {Array} components   The style's panel list
 * @param {any}   bags         Bags cut (good pieces)
 * @returns {null | {
 *   panelsPerBag: number, handlesPerBag: number,
 *   panels: string, handles: string,
 *   breakdown: Array<{lineNo: number, name: string, componentType: string, piecesPerBag: number, pieces: string}>
 * }}
 */
export function panelCounts(components, bags) {
  const per = perBag(components);
  if (!per) return null;
  const qty = D(bags);
  const breakdown = [...components]
    .filter((c) => Number(c.piecesPerBag) > 0)
    .sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0))
    .map((c) => ({
      lineNo: c.lineNo ?? null,
      name: c.name,
      componentType: c.componentType,
      piecesPerBag: Number(c.piecesPerBag),
      pieces: qty.mul(c.piecesPerBag).toFixed(4),
    }));
  return {
    ...per,
    panels: qty.mul(per.panelsPerBag).toFixed(4),
    handles: qty.mul(per.handlesPerBag).toFixed(4),
    breakdown,
  };
}
