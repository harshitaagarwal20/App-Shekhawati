import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/costSheet.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  costSheetListQuery,
  createCostSheetSchema,
  decideCostSheetSchema,
  rejectCostSheetSchema,
  updateCostSheetSchema,
} from '../validators/costSheet.validator.js';

/**
 * Style cost sheets. Merchandising prepares (CREATE / EDIT); the Director
 * signs (APPROVE). See services/costSheet.service.js for the lifecycle.
 */
const router = Router();

router.get('/', can('COST_SHEET.VIEW'), validate({ query: costSheetListQuery }), c.list);
router.post('/', can('COST_SHEET.CREATE'), validate({ body: createCostSheetSchema }), c.create);
router.get('/:id', can('COST_SHEET.VIEW'), validate({ params: idParam }), c.get);
router.patch(
  '/:id',
  can('COST_SHEET.EDIT'),
  validate({ params: idParam, body: updateCostSheetSchema }),
  c.update,
);
router.delete('/:id', can('COST_SHEET.DELETE'), validate({ params: idParam }), c.remove);

router.post('/:id/refresh-rates', can('COST_SHEET.EDIT'), validate({ params: idParam }), c.refreshRates);
router.post(
  '/:id/submit',
  can('COST_SHEET.EDIT'),
  validate({ params: idParam, body: decideCostSheetSchema }),
  c.submit,
);
router.post('/:id/revise', can('COST_SHEET.CREATE'), validate({ params: idParam }), c.revise);
router.post(
  '/:id/approve',
  can('COST_SHEET.APPROVE'),
  validate({ params: idParam, body: decideCostSheetSchema }),
  c.approve,
);
router.post(
  '/:id/reject',
  can('COST_SHEET.APPROVE'),
  validate({ params: idParam, body: rejectCostSheetSchema }),
  c.reject,
);

export default router;
