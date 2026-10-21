/**
 * Ironing - /api/ironing
 *
 *      GET    /context            units, damage types, ironers
 *      GET    /orders             (order, style, unit) that have stitched pieces
 *      GET    /position           one unit's flow and its challans' status
 *      GET    /pending-rejects    rejected at ironing, waiting for Phase 3
 *      GET    /  POST /           the register
 *      GET | PATCH | DELETE /:id  one entry (PATCH also decides damage)
 */

import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/ironing.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  createIroningSchema,
  ironingListQuery,
  ironingPositionQuery,
  pendingRejectQuery,
  updateIroningSchema,
} from '../validators/ironing.validator.js';

const router = Router();

router.get('/context', can('IRONING.VIEW'), c.context);
router.get('/orders', can('IRONING.VIEW'), c.orderOptions);
router.get('/position', can('IRONING.VIEW'), validate({ query: ironingPositionQuery }), c.position);
router.get('/pending-rejects', can('IRONING.VIEW'), validate({ query: pendingRejectQuery }), c.pendingRejects);

router.get('/', can('IRONING.VIEW'), validate({ query: ironingListQuery }), c.list);
router.post('/', can('IRONING.CREATE'), validate({ body: createIroningSchema }), c.create);
router.get('/:id', can('IRONING.VIEW'), validate({ params: idParam }), c.get);
router.patch('/:id', can('IRONING.EDIT'), validate({ params: idParam, body: updateIroningSchema }), c.update);
router.delete('/:id', can('IRONING.DELETE'), validate({ params: idParam }), c.remove);

export default router;
