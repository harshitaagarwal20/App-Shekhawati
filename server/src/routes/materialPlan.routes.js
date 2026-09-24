import { Router } from 'express';
import { z } from 'zod';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/materialPlan.controller.js';
import { idParam, uuid } from '../validators/common.validator.js';
import {
  approveMaterialPlanSchema,
  cancelMaterialPlanSchema,
  createMaterialPlanSchema,
  materialPlanListQuery,
  previewMaterialPlanSchema,
  rejectMaterialPlanSchema,
  submitMaterialPlanSchema,
  updateMaterialPlanSchema,
} from '../validators/materialPlan.validator.js';

const router = Router();

const orderIdParam = z.object({ orderId: uuid });

/**
 * Static paths first, so "preview" is never read as a plan id.
 *
 * Preview runs the same explosion the save runs, so the figures a planner
 * reviews before committing are the figures that get stored - not a second
 * rendering of them that could disagree.
 */
router.post(
  '/preview',
  can('MATERIAL_PLAN.VIEW'),
  validate({ body: previewMaterialPlanSchema }),
  c.preview,
);

/**
 * C13 - the styles on an order, and which of them still need a plan.
 *
 * Static, and before "/:id", so "order" is never read as a plan id.
 */
router.get(
  '/order/:orderId/lines',
  can('MATERIAL_PLAN.VIEW'),
  validate({ params: orderIdParam }),
  c.plannableLines,
);

router.get('/', can('MATERIAL_PLAN.VIEW'), validate({ query: materialPlanListQuery }), c.list);
router.post('/', can('MATERIAL_PLAN.CREATE'), validate({ body: createMaterialPlanSchema }), c.create);

router.get('/:id', can('MATERIAL_PLAN.VIEW'), validate({ params: idParam }), c.get);

/**
 * Has the style BOM moved since this plan was raised?
 *
 * A read, not a repair. The plan is deliberately not updated - see the module
 * comment in materialPlan.service.js.
 */
router.get('/:id/drift', can('MATERIAL_PLAN.VIEW'), validate({ params: idParam }), c.drift);

/** Header only. The lines are the BOM's answer and cannot be overtyped. */
router.patch(
  '/:id',
  can('MATERIAL_PLAN.EDIT'),
  validate({ params: idParam, body: updateMaterialPlanSchema }),
  c.update,
);

router.delete('/:id', can('MATERIAL_PLAN.DELETE'), validate({ params: idParam }), c.remove);

// ---------------------------------------------------------------------------
//  Approval flow
//
//  Preparing and submitting the plan belongs to the planning desk; the
//  decision belongs to the GM / Director, the same office that signs every
//  other plan. So approve and reject sit behind MATERIAL_PLAN.APPROVE, which
//  the preparing roles do not hold.
//
//  Maker-checker is enforced on top of that and is NOT a permission: holding
//  MATERIAL_PLAN.APPROVE does not let you sign your own plan.
// ---------------------------------------------------------------------------
router.post(
  '/:id/submit',
  can('MATERIAL_PLAN.EDIT', 'MATERIAL_PLAN.CREATE'),
  validate({ params: idParam, body: submitMaterialPlanSchema }),
  c.submit,
);
router.post(
  '/:id/approve',
  can('MATERIAL_PLAN.APPROVE'),
  validate({ params: idParam, body: approveMaterialPlanSchema }),
  c.approve,
);
router.post(
  '/:id/reject',
  can('MATERIAL_PLAN.APPROVE'),
  validate({ params: idParam, body: rejectMaterialPlanSchema }),
  c.reject,
);
router.post(
  '/:id/cancel',
  can('MATERIAL_PLAN.EDIT'),
  validate({ params: idParam, body: cancelMaterialPlanSchema }),
  c.cancel,
);

export default router;
