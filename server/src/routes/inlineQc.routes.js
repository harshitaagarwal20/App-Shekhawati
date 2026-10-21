/**
 * Phase 3 - Inline QC - /api/inline-qc
 *
 *      GET    /context                    tailors, Inform To people, check types
 *      GET    /orders?unit=               orders and styles cut for the unit
 *      GET    /  POST /                   the register
 *      GET | PATCH | DELETE /:id          one check
 *      GET    /actions                    the Action needed list (mine, or all)
 *      POST   /actions/:id/resolve        mark one defect Resolved
 *      POST   /actions/:id/reopen         undo that
 *
 * Resolving is guarded by VIEW only: the right to resolve a defect is being
 * the person it was sent to (domain/inlineQc.js mayResolve), not a role.
 * Who CAN be sent one is INLINE_QC.RESOLVE.
 */

import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/inlineQc.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  actionListQuery,
  createInlineQcSchema,
  inlineQcListQuery,
  resolveSchema,
  unitQuery,
  updateInlineQcSchema,
} from '../validators/inlineQc.validator.js';

const router = Router();

router.get('/context', can('INLINE_QC.VIEW'), c.context);
router.get('/orders', can('INLINE_QC.VIEW'), validate({ query: unitQuery }), c.orderOptions);

// Literal paths before /:id.
router.get('/actions', can('INLINE_QC.VIEW'), validate({ query: actionListQuery }), c.actions);
router.post('/actions/:id/resolve', can('INLINE_QC.VIEW'), validate({ params: idParam, body: resolveSchema }), c.resolve);
router.post('/actions/:id/reopen', can('INLINE_QC.VIEW'), validate({ params: idParam }), c.reopen);

router.get('/', can('INLINE_QC.VIEW'), validate({ query: inlineQcListQuery }), c.list);
router.post('/', can('INLINE_QC.CREATE'), validate({ body: createInlineQcSchema }), c.create);
router.get('/:id', can('INLINE_QC.VIEW'), validate({ params: idParam }), c.get);
router.patch('/:id', can('INLINE_QC.EDIT'), validate({ params: idParam, body: updateInlineQcSchema }), c.update);
router.delete('/:id', can('INLINE_QC.DELETE'), validate({ params: idParam }), c.remove);

export default router;
