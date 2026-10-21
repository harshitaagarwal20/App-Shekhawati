/**
 * The Alteration Unit - /api/alteration
 *
 *      GET    /context            alteration staff
 *      GET    /orders             orders and styles with bags still open
 *      GET    /position           one order and style's finishing flow
 *      GET    /bags               the pending list (bags, oldest first)
 *      GET    /bags/:id           one bag and what was done with it
 *      GET    /  POST /           the entries (POST: one per bag worked)
 *      GET | PATCH | DELETE /:id  one entry
 *
 * And the Rejected Register - /api/rejected-register - read-only: every row
 * is written by the stage that rejected the pieces.
 */

import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/alteration.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  alterationListQuery,
  bagListQuery,
  createAlterationSchema,
  orderStyleQuery,
  rejectedListQuery,
  updateAlterationSchema,
} from '../validators/alteration.validator.js';

const router = Router();

router.get('/context', can('ALTERATION.VIEW'), c.context);
router.get('/orders', can('ALTERATION.VIEW'), c.orderOptions);
router.get('/position', can('ALTERATION.VIEW'), validate({ query: orderStyleQuery }), c.position);
router.get('/bags', can('ALTERATION.VIEW'), validate({ query: bagListQuery }), c.bags);
router.get('/bags/:id', can('ALTERATION.VIEW'), validate({ params: idParam }), c.bag);

router.get('/', can('ALTERATION.VIEW'), validate({ query: alterationListQuery }), c.list);
router.post('/', can('ALTERATION.CREATE'), validate({ body: createAlterationSchema }), c.create);
router.get('/:id', can('ALTERATION.VIEW'), validate({ params: idParam }), c.get);
router.patch('/:id', can('ALTERATION.EDIT'), validate({ params: idParam, body: updateAlterationSchema }), c.update);
router.delete('/:id', can('ALTERATION.DELETE'), validate({ params: idParam }), c.remove);

export const rejectedRegisterRoutes = Router();
rejectedRegisterRoutes.get('/', can('REJECTED_REGISTER.VIEW'), validate({ query: rejectedListQuery }), c.rejectedList);
rejectedRegisterRoutes.get('/:id', can('REJECTED_REGISTER.VIEW'), validate({ params: idParam }), c.rejectedGet);

export default router;
