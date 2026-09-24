/**
 * C2 / C3 - the tolerance masters.
 *
 * Behind MASTER_LIST.* rather than a permission of their own, because that is
 * exactly what these are - masters - and it is the permission the Excess Rules
 * screen already runs on. Adding a fourth near-identical permission would give
 * the office one more thing to keep in step for no gain.
 *
 * `/gaps` is deliberately on VIEW and not EDIT. Knowing which categories have
 * no agreed tolerance is something everyone raising a purchase order needs to
 * be able to see; deciding one is not.
 */

import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/tolerance.controller.js';
import {
  createShrinkageSchema,
  createToleranceSchema,
  resolveShrinkageQuery,
  resolveToleranceQuery,
  shrinkageQuery,
  toleranceQuery,
} from '../validators/tolerance.validator.js';

const router = Router();

/** The three commercial categories, and which dropdown values each governs. */
router.get('/categories', can('MASTER_LIST.VIEW'), c.categories);

/**
 * C2 - THE GAP REPORT.
 *
 * "Do not silently invent missing tolerance values. Report missing values
 * instead of inventing them." This is that report: every category with no
 * explicit dated version, and what it is being judged by in the meantime.
 */
router.get('/gaps', can('MASTER_LIST.VIEW'), validate({ query: toleranceQuery }), c.gaps);

/** What tolerance WOULD apply, without writing anything. */
router.get(
  '/resolve',
  can('MASTER_LIST.VIEW'),
  validate({ query: resolveToleranceQuery }),
  c.resolve,
);

router.get(
  '/shrinkage/resolve',
  can('MASTER_LIST.VIEW'),
  validate({ query: resolveShrinkageQuery }),
  c.resolveShrinkageFor,
);

router.get(
  '/shrinkage',
  can('MASTER_LIST.VIEW'),
  validate({ query: shrinkageQuery }),
  c.listShrinkage,
);

/**
 * A new dated version. POST, never PATCH: a tolerance version is not edited,
 * it is superseded - and superseding closes the predecessor in the same
 * transaction, so the two periods abut exactly.
 */
router.post(
  '/shrinkage',
  can('MASTER_LIST.CREATE'),
  validate({ body: createShrinkageSchema }),
  c.addShrinkage,
);

router.get('/', can('MASTER_LIST.VIEW'), validate({ query: toleranceQuery }), c.listTolerances);

router.post(
  '/',
  can('MASTER_LIST.CREATE'),
  validate({ body: createToleranceSchema }),
  c.addTolerance,
);

export default router;
