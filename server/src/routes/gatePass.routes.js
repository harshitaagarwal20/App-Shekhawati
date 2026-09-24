import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/gatePass.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  allocateGatePassSchema,
  clearGatePassSchema,
  createGatePassSchema,
  gatePassListQuery,
  gatePassOptionsQuery,
  previewGatePassSchema,
  reopenGatePassSchema,
  updateGatePassSchema,
} from '../validators/gatePass.validator.js';

const router = Router();

// Static paths first, so "options" and "preview" are not read as ids.
router.get('/options', can('GATE_PASS.VIEW'), validate({ query: gatePassOptionsQuery }), c.options);

/**
 * Resolves the linked document and works out the quantity and variation before
 * anything is saved - the form asks rather than guessing what the PO expects.
 */
router.post(
  '/preview',
  can('GATE_PASS.VIEW'),
  validate({ body: previewGatePassSchema }),
  c.preview,
);

router.get('/', can('GATE_PASS.VIEW'), validate({ query: gatePassListQuery }), c.list);
router.post('/', can('GATE_PASS.CREATE'), validate({ body: createGatePassSchema }), c.create);

router.get('/:id', can('GATE_PASS.VIEW'), validate({ params: idParam }), c.get);

/** The printed slip the security desk keeps. */
router.get('/:id/print', can('GATE_PASS.EXPORT'), validate({ params: idParam }), c.printView);

router.patch(
  '/:id',
  can('GATE_PASS.EDIT'),
  validate({ params: idParam, body: updateGatePassSchema }),
  c.update,
);
router.delete('/:id', can('GATE_PASS.DELETE'), validate({ params: idParam }), c.remove);

// ---------------------------------------------------------------------------
//  At the gate.
//
//  Clearing a pass asserts that goods physically moved and fixes the received
//  quantity, so it sits behind GATE_PASS.APPROVE rather than EDIT: the checker
//  who raises the paperwork and the person who signs off the count are not
//  required to be the same person.
// ---------------------------------------------------------------------------
/*
 * Matching a delivery to its document.
 *
 * Behind GATE_PASS.EDIT rather than APPROVE: allocating is desk work done by
 * whoever holds the paperwork, not a sign-off. Clearing - the act that says
 * how much actually arrived - keeps APPROVE.
 */
router.post(
  '/:id/allocate',
  can('GATE_PASS.EDIT'),
  validate({ params: idParam, body: allocateGatePassSchema }),
  c.allocate,
);

router.post(
  '/:id/clear',
  can('GATE_PASS.APPROVE'),
  validate({ params: idParam, body: clearGatePassSchema }),
  c.clear,
);
router.post(
  '/:id/reopen',
  can('GATE_PASS.APPROVE'),
  validate({ params: idParam, body: reopenGatePassSchema }),
  c.reopen,
);

export default router;
