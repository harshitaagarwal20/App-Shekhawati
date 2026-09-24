import { Router } from 'express';
import { z } from 'zod';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/planning.controller.js';
import { idParam, uuid } from '../validators/common.validator.js';
import {
  approvePlanSchema,
  createPlanSchema,
  lineParams,
  orderAllocationQuery,
  planListQuery,
  planOptionsQuery,
  previewAllocationSchema,
  recallPlanSchema,
  rejectPlanSchema,
  revisePlanSchema,
  setLineStatusSchema,
  setLinesSchema,
  setPlanStatusSchema,
  submitPlanSchema,
  updatePlanSchema,
} from '../validators/planning.validator.js';

const router = Router();

const orderIdParam = z.object({ orderId: uuid });

// Static paths first, so "options" and "preview" are not read as a plan id.
router.get('/options', can('PLANNING.VIEW'), validate({ query: planOptionsQuery }), c.options);

/**
 * The ceiling an order imposes, and what is already planned against it. Read
 * before the planner types anything, so the limit is never a surprise at save.
 */
router.get(
  '/order/:orderId/allocation',
  can('PLANNING.VIEW'),
  validate({ params: orderIdParam, query: orderAllocationQuery }),
  c.orderAllocation,
);

/** Checks an unsaved grid through exactly the code path the save uses. */
router.post(
  '/preview',
  can('PLANNING.VIEW'),
  validate({ body: previewAllocationSchema }),
  c.previewAllocation,
);

router.get('/', can('PLANNING.VIEW'), validate({ query: planListQuery }), c.list);
router.post('/', can('PLANNING.CREATE'), validate({ body: createPlanSchema }), c.create);

router.get('/:id', can('PLANNING.VIEW'), validate({ params: idParam }), c.get);
router.patch(
  '/:id',
  can('PLANNING.EDIT'),
  validate({ params: idParam, body: updatePlanSchema }),
  c.update,
);
router.put(
  '/:id/lines',
  can('PLANNING.EDIT'),
  validate({ params: idParam, body: setLinesSchema }),
  c.setLines,
);
/** The floor marking a day's allotment done. Touches no quantity. */
router.patch(
  '/:id/lines/:lineId',
  can('PLANNING.EDIT'),
  validate({ params: lineParams, body: setLineStatusSchema }),
  c.setLineStatus,
);
router.patch(
  '/:id/status',
  can('PLANNING.EDIT'),
  validate({ params: idParam, body: setPlanStatusSchema }),
  c.setStatus,
);
router.delete('/:id', can('PLANNING.DELETE'), validate({ params: idParam }), c.remove);

// ---------------------------------------------------------------------------
//  Approval flow
//
//  Preparing and submitting a plan belongs to the Planning Dept; the decision
//  belongs to the GM / Director ("Approved by Vinay ji (GM) / Dinesh Sir"), so
//  approve and reject sit behind PLANNING.APPROVE, which the planner roles do
//  not hold. Recalling an undecided plan is the planner's own move.
// ---------------------------------------------------------------------------
router.post(
  '/:id/submit',
  can('PLANNING.EDIT', 'PLANNING.CREATE'),
  validate({ params: idParam, body: submitPlanSchema }),
  c.submit,
);
router.post(
  '/:id/recall',
  can('PLANNING.EDIT'),
  validate({ params: idParam, body: recallPlanSchema }),
  c.recall,
);
router.post(
  '/:id/approve',
  can('PLANNING.APPROVE'),
  validate({ params: idParam, body: approvePlanSchema }),
  c.approve,
);
router.post(
  '/:id/reject',
  can('PLANNING.APPROVE'),
  validate({ params: idParam, body: rejectPlanSchema }),
  c.reject,
);
/** Reopening a rejected plan to revise it - the planner's move, not the GM's. */
router.post(
  '/:id/revise',
  can('PLANNING.EDIT'),
  validate({ params: idParam, body: revisePlanSchema }),
  c.revise,
);

export default router;
