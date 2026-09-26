/**
 * C9 - THE REQUIREMENT CALCULATION. ONE FUNCTION, THREE CALLERS.
 *
 * ===========================================================================
 *  WHY THIS FILE EXISTS
 * ===========================================================================
 *
 *      requirement = avgUtilisationPerPiece x orderQuantity
 *
 * That is one line of arithmetic, which is exactly why it was about to be
 * written three times. Planning needs it to say how much to buy, the purchase
 * order ceiling needs it to say how much may be bought, and the cutting
 * challan needs it to say how much may be drawn. Three copies of one formula
 * is three places for a wastage factor to be added to two of them.
 *
 * So it lives here, it is PURE, and it takes the BOM line and the quantity as
 * arguments rather than fetching anything. Purity is what lets the same
 * function run inside a transaction, inside a preview, and inside a unit test
 * with no database at all.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THE FORMULA ACTUALLY IS
 *
 *  The brief states it as utilisation x order quantity. Two refinements are
 *  applied, and both are visible in the returned `basis` string rather than
 *  hidden in the number:
 *
 *   1. The quantity is the order's EFFECTIVE quantity - order qty plus any
 *      approved excess - because that is what the factory will actually make
 *      and therefore what it will actually consume. Using the nominal order
 *      quantity would under-buy every order carrying an approved excess.
 *
 *   2. Process wastage, where the BOM line declares one, multiplies the
 *      result. A line that says a metre of canvas yields 0.98 metres of
 *      usable panel is stating a requirement of 1.02, not 1.00.
 *
 *  Both were already in the calculation this function replaces. They are
 *  documented here rather than reimplemented per caller.
 *
 *  ZERO IS NEVER SILENTLY RETURNED.
 *
 *  A style with no utilisation cannot have a requirement computed. This
 *  function returns null and names why. What it will not do is return 0,
 *  which would read as "this style needs no fabric" and would let an
 *  AS_PER_STYLE purchase order be capped at nothing - or, worse, pass a
 *  ceiling check by being compared against a ceiling of zero that nothing can
 *  exceed.
 *
 *  Whether null then REFUSES the document or merely reports it as unbounded
 *  is `assertRequirement()`'s decision, not this function's - see
 *  REPORTED_NOT_REFUSED. Callers that only report (Planning, the Cutting
 *  Challan) are unaffected either way.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError.js';

const D = (v) => new Prisma.Decimal(v ?? 0);

/** Why a requirement could not be computed. Rendered to the user verbatim. */
export const NO_REQUIREMENT = {
  NO_STYLE: 'NO_STYLE',
  NO_UTILISATION: 'NO_UTILISATION',
  NOT_IN_BOM: 'NOT_IN_BOM',
};

/**
 * THE FORMULA. Pure arithmetic, no lookups, no rounding surprises.
 *
 * Kept separate from `requirementFor()` below so that the multiplication
 * itself can be asserted in a unit test without constructing a style.
 *
 * @param {Prisma.Decimal|string|number} avgUtilisationPerPiece
 * @param {Prisma.Decimal|string|number} quantity
 * @param {Prisma.Decimal|string|number} [wastagePct]  Fraction, 0.02 = 2%
 * @returns {Prisma.Decimal}
 */
export function computeRequirement(avgUtilisationPerPiece, quantity, wastagePct = 0) {
  return D(avgUtilisationPerPiece)
    .mul(D(quantity))
    .mul(D(1).plus(D(wastagePct)))
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * The BOM line in force for a material on a date, or undefined.
 *
 * Shared by both branches of `requirementFor()` below - the Fabric branch
 * needs it to read the fabric line's declared wastage, and the general branch
 * needs it for everything. One resolver means one answer to "which revision
 * applies", rather than two that can drift apart.
 *
 * @param {object} style   Style with `bomLines` loaded
 * @param {object} [line]  { item | itemCategory, subCategory?, accessoriesItem?, accessoryType? }
 * @param {Date}   [at]    Resolve the line effective on this date
 */
function resolveBomLine(style, line, at) {
  const named = line?.item ?? line?.itemCategory ?? null;

  const candidates = (style.bomLines ?? []).filter(
    (b) =>
      b.itemCategory === named &&
      (line?.accessoriesItem ? b.accessoriesItem === line.accessoriesItem : true) &&
      (line?.subCategory ? b.subCategory === line.subCategory : true) &&
      b.deletedAt == null &&
      b.isActive !== false &&
      // C9: a line that has not started applying yet cannot bound a document
      // dated before it. Without the date test a revision entered in advance
      // would silently take over the moment it was saved.
      (!at || !b.effectiveFrom || new Date(b.effectiveFrom) <= at),
  );

  /*
   * The VARIETY narrows, it never excludes. A style with an 18L and a 24L
   * button line must bound an 18L PO by the 18L line. But a BOM that says only
   * "Button" still bounds a PO naming a variety - the BOM was written before
   * varieties were a list, or the style genuinely takes whichever the buyer
   * supplies - and refusing it would stop procurement over a missing detail.
   */
  const variety = line?.accessoryType || null;
  const exact = variety ? candidates.filter((b) => b.accessoryType === variety) : [];
  const pool = exact.length
    ? exact
    : variety
      ? candidates.filter((b) => !b.accessoryType)
      : candidates;

  // The version in force on the date asked about: latest effectiveFrom wins.
  return pool.sort(
    (a, b) => new Date(b.effectiveFrom ?? 0) - new Date(a.effectiveFrom ?? 0),
  )[0];
}

/**
 * Finds the BOM line that describes a material, and computes what the order
 * requires of it.
 *
 * THE ONLY requirement calculation in this application. Planning, the purchase
 * order ceiling and the cutting challan all call this, which is what makes the
 * figure they show identical by construction rather than by coincidence.
 *
 * @param {object}   args
 * @param {object}   args.style     Style with `bomLines` loaded
 * @param {object}   args.order     Buyer order (effectiveQty preferred over orderQty)
 * @param {object}   args.line      { item | itemCategory, subCategory?, accessoriesItem? }
 * @param {Date}     [args.on]      Resolve the BOM line effective on this date
 * @returns {{
 *   requirement: Prisma.Decimal,
 *   qty: Prisma.Decimal,
 *   perPiece: Prisma.Decimal,
 *   wastagePct: Prisma.Decimal,
 *   uom: string,
 *   basis: string,
 *   bomLineNo: number|null,
 *   source: 'STYLE_HEADER'|'BOM_LINE',
 * } | { requirement: null, reason: string, basis: string }}
 */
export function requirementFor({ style, order, line, on } = {}) {
  if (!style) {
    return {
      requirement: null,
      reason: NO_REQUIREMENT.NO_STYLE,
      basis: 'No style is linked, so nothing describes what one piece consumes.',
    };
  }

  // Effective quantity is what will actually be made. Falls back to the
  // nominal order quantity for the callers that have no order in hand.
  const qty = D(order?.effectiveQty ?? order?.orderQty ?? 0);
  const at = on ? new Date(on) : null;

  const named = line?.item ?? line?.itemCategory ?? null;

  // ---- Fabric: the style header is authoritative -------------------------
  //
  // The Style Master's own "Avg Fabric Utilization / Pc" is the number the
  // office negotiates and the number the buyer's measurement sheet carries.
  // Where a fabric BOM line also exists, style.service.js already keeps the
  // two in step, so reading the header is not a second source of truth - it
  // is the one the office maintains.
  //
  // WASTAGE IS STILL THE LINE'S. `syncFabricLine()` mirrors the utilisation
  // onto the Fabric BOM line and nothing else, so the header has no wastage
  // to carry and the line's is the only declaration of it. Hardcoding zero
  // here is what made the PO ceiling and the Cutting Challan enforce a figure
  // BELOW the one the order screen, the BOM explosion and Planning all show -
  // capping procurement by exactly the wastage factor on every AS_PER_STYLE
  // order. The line is read, so the three callers agree.
  if (named === 'Fabric') {
    const perPiece = D(style.avgFabricUtilizationPerPc);
    if (perPiece.lessThanOrEqualTo(0)) {
      return {
        requirement: null,
        reason: NO_REQUIREMENT.NO_UTILISATION,
        basis:
          `Style ${style.styleNo} carries no average fabric utilisation per piece. ` +
          'Set it on the Style Master before ordering or planning against this style.',
      };
    }

    // Absent a fabric line there is nothing declaring wastage, and zero is the
    // honest answer rather than a hardcoded one.
    const fabricLine = resolveBomLine(style, line, at);
    const wastagePct = D(fabricLine?.wastagePct ?? 0);

    return {
      requirement: computeRequirement(perPiece, qty, wastagePct),
      qty,
      perPiece,
      wastagePct,
      uom: style.avgUtilizationUom ?? 'Mtrs',
      bomLineNo: fabricLine?.lineNo ?? null,
      source: 'STYLE_HEADER',
      basis:
        `Style ${style.styleNo} average utilisation ${perPiece.toFixed(4)} ` +
        `${style.avgUtilizationUom ?? 'Mtrs'}/pc x ${qty.toFixed(4)} pcs` +
        (wastagePct.isZero()
          ? ''
          : ` x ${D(1).plus(wastagePct).toFixed(6)} (${wastagePct.mul(100).toDecimalPlaces(2)}% wastage, ` +
            `BOM line ${fabricLine.lineNo})`),
    };
  }

  // ---- Everything else: the matching BOM line ----------------------------
  const bom = resolveBomLine(style, line, at);

  if (!bom) {
    return {
      requirement: null,
      reason: NO_REQUIREMENT.NOT_IN_BOM,
      basis:
        `Style ${style.styleNo} has no BOM line for ${named ?? 'this material'}` +
        (line?.accessoriesItem ? ` / ${line.accessoriesItem}` : '') +
        (at ? ` effective on ${at.toISOString().slice(0, 10)}` : '') +
        '. The BOM cannot bound a material it does not mention.',
    };
  }

  const perPiece = D(bom.avgUtilisationPerPiece);
  if (perPiece.lessThanOrEqualTo(0)) {
    return {
      requirement: null,
      reason: NO_REQUIREMENT.NO_UTILISATION,
      basis:
        `Style ${style.styleNo} BOM line ${bom.lineNo} carries no utilisation per piece. ` +
        'A requirement cannot be computed from it.',
    };
  }

  const wastagePct = D(bom.wastagePct ?? 0);

  return {
    requirement: computeRequirement(perPiece, qty, wastagePct),
    qty,
    perPiece,
    wastagePct,
    uom: bom.uom,
    bomLineNo: bom.lineNo,
    source: 'BOM_LINE',
    basis:
      `Style ${style.styleNo} BOM line ${bom.lineNo}: ${perPiece.toFixed(4)} ${bom.uom}/pc ` +
      `x ${qty.toFixed(4)} pcs` +
      (wastagePct.isZero()
        ? ''
        : ` x ${D(1).plus(wastagePct).toFixed(6)} (${wastagePct.mul(100).toDecimalPlaces(2)}% wastage)`),
  };
}

/**
 * Reasons that are reported but NOT refused.
 *
 * A BOM that cannot state a requirement is a gap in the BOM, not a bad
 * purchase order. Two gaps are treated the same way:
 *
 *   NOT_IN_BOM       the BOM never mentions the material. Refusing here
 *                    stopped the office buying thread against a style whose
 *                    BOM had never listed thread.
 *
 *   NO_UTILISATION   the BOM names the material, or the style header names a
 *                    fabric, but the per-piece figure is blank or zero -
 *                    sampling has not decided it yet. Refusing here stopped
 *                    the same purchase one step further along, after the
 *                    line had been added.
 *
 * In both cases the only way past the refusal was to re-raise the line as
 * BULK, which mislabels a deliberate as-per-style purchase as an unplanned
 * one. So both now pass through: the document is written, and
 * `checkOrderCeiling()` reports it as UNBOUNDED (bounded: false) with a basis
 * saying the BOM could not bound it. Nothing is silently capped at zero, and
 * nothing pretends a requirement was checked when none existed.
 *
 * WHAT THIS COSTS. A zero utilisation no longer stops procurement, so nothing
 * now forces the sampling figure to be filled in before the material is
 * bought. The quantity on such a line is bounded by nobody. That is a
 * deliberate trade, recorded here rather than discovered later: the cap
 * returns the moment the BOM line carries a figure.
 *
 * NO_STYLE still refuses. "As per style" with no style is not a gap in the
 * data - it is a contradiction in the document.
 */
const REPORTED_NOT_REFUSED = new Set([
  NO_REQUIREMENT.NOT_IN_BOM,
  NO_REQUIREMENT.NO_UTILISATION,
]);

/**
 * The same, but refusing rather than reporting.
 *
 * C9 read: "Style without utilisation cannot create AS_PER_STYLE PO. Clear
 * validation error is returned. Requirement is never silently treated as
 * zero." The second half still holds everywhere - a missing requirement is
 * null, never 0. The first half was relaxed deliberately: see
 * REPORTED_NOT_REFUSED above for which gaps are now reported as unbounded
 * instead of refused, and what that costs.
 *
 * @param {object} args   Same as requirementFor()
 * @param {string} [args.forDocument]  What to name in the message
 */
export function assertRequirement(args) {
  const result = requirementFor(args);

  if (result.requirement === null && !REPORTED_NOT_REFUSED.has(result.reason)) {
    throw ApiError.badRequest(
      `${args.forDocument ?? 'This document'} cannot be raised: ${result.basis}`,
      {
        field: 'styleId',
        reason: result.reason,
        basis: result.basis,
        /** So a screen can link straight to the thing that needs fixing. */
        styleId: args.style?.id ?? null,
        styleNo: args.style?.styleNo ?? null,
      },
    );
  }

  return result;
}
