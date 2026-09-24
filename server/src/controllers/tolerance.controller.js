/**
 * C2 / C3 - the tolerance masters, and the gap report.
 *
 * `gaps` is the endpoint the brief actually asks for: "Report missing values
 * instead of inventing them." It names every purchase category with no explicit
 * dated tolerance version, says what those categories are currently being
 * judged by instead, and says plainly that the fallback is an existing approved
 * rule rather than an assumption.
 */

import { asyncHandler, ok } from '../utils/http.js';
import * as tolerance from '../services/tolerance.service.js';
import { ITEM_CATEGORIES, CATEGORY_LABEL, mappingByCategory } from '../domain/itemCategory.js';

/** Anything that gets stamped with a name carries the whole identity. */
const who = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

export const listTolerances = asyncHandler(async (req, res) =>
  ok(res, { rows: await tolerance.listTolerances(req.query) }),
);

export const listShrinkage = asyncHandler(async (req, res) =>
  ok(res, { rows: await tolerance.listShrinkage(req.query) }),
);

export const gaps = asyncHandler(async (req, res) => ok(res, await tolerance.gaps(req.query)));

/** The categories themselves, and which dropdown values each one governs. */
export const categories = asyncHandler(async (_req, res) =>
  ok(res, {
    categories: ITEM_CATEGORIES.map((c) => ({
      value: c,
      label: CATEGORY_LABEL[c],
      coversDropdownValues: mappingByCategory()[c],
    })),
    note:
      'Tolerance is agreed per commercial category, not per L_ItemCategory dropdown value. ' +
      'src/domain/itemCategory.js is the only place the two are mapped.',
  }),
);

/**
 * What tolerance WOULD apply, without writing anything.
 *
 * Exists so a form can show the buyer the figure their order will be judged by
 * before they commit to it - and show where it came from, which for FABRIC and
 * PACKAGING today is a reported fallback rather than an explicit rule.
 */
export const resolve = asyncHandler(async (req, res) => {
  const result = await tolerance.resolveCategoryTolerance(null, req.query);
  return ok(res, {
    ...result,
    orderTolerance: result.orderTolerance.toFixed(6),
    receiptTolerance: result.receiptTolerance.toFixed(6),
  });
});

export const resolveShrinkageFor = asyncHandler(async (req, res) => {
  const result = await tolerance.resolveShrinkage(null, req.query);
  return ok(res, { ...result, tolerance: result.tolerance.toFixed(6) });
});

/** Adds a new dated version, closing the one it supersedes in one transaction. */
export const addTolerance = asyncHandler(async (req, res) =>
  ok(res, await tolerance.addToleranceVersion(req.body, who(req)), 201),
);

export const addShrinkage = asyncHandler(async (req, res) =>
  ok(res, await tolerance.addShrinkageVersion(req.body, who(req)), 201),
);
