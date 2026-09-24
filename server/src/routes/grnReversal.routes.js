import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/grnReversal.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  approveGrnReversalSchema,
  cancelGrnReversalSchema,
  createGrnReversalSchema,
  grnIdParam,
  grnReversalListQuery,
  rejectGrnReversalSchema,
  submitGrnReversalSchema,
  updateGrnReversalSchema,
} from '../validators/grnReversal.validator.js';

const router = Router();

/**
 * Static paths first, so "eligibility" is never read as a reversal id.
 *
 * Guarded by GRN.VIEW rather than GRN_REVERSAL.VIEW: this answers a question
 * ABOUT A RECEIPT - "can this one be corrected, and what would it cost" - and
 * it is the GRN screen that asks it, before any reversal exists.
 */
router.get(
  '/eligibility/:grnId',
  can('GRN.VIEW'),
  validate({ params: grnIdParam }),
  c.eligibility,
);

router.get('/', can('GRN_REVERSAL.VIEW'), validate({ query: grnReversalListQuery }), c.list);
router.post('/', can('GRN_REVERSAL.CREATE'), validate({ body: createGrnReversalSchema }), c.create);

router.get('/:id', can('GRN_REVERSAL.VIEW'), validate({ params: idParam }), c.get);

/** The words, and only while it is a draft. The figures are the receipt's. */
router.patch(
  '/:id',
  can('GRN_REVERSAL.EDIT'),
  validate({ params: idParam, body: updateGrnReversalSchema }),
  c.update,
);

router.delete('/:id', can('GRN_REVERSAL.DELETE'), validate({ params: idParam }), c.remove);

// ---------------------------------------------------------------------------
//  Approval flow
//
//  Raising and submitting the correction belongs to the store - they are the
//  ones who find the mistake. The decision does not: approving a reversal
//  takes stock back out and reduces what a vendor is owed, so it sits behind
//  GRN_REVERSAL.APPROVE, which the F-04 migration granted to whoever already
//  holds PURCHASE_ORDER.APPROVE and to nobody who merely holds GRN.CREATE.
//
//  Maker-checker is enforced on top of that by approvalEngine.transition() and
//  is NOT a permission: holding GRN_REVERSAL.APPROVE does not let you sign
//  your own reversal.
//
//  There is deliberately no `/post` route. Approving posts, in the same
//  transaction - see the service. A separate post step would be a state in
//  which the correction is authorised and the ledger is still wrong.
// ---------------------------------------------------------------------------
router.post(
  '/:id/submit',
  can('GRN_REVERSAL.EDIT', 'GRN_REVERSAL.CREATE'),
  validate({ params: idParam, body: submitGrnReversalSchema }),
  c.submit,
);
router.post(
  '/:id/approve',
  can('GRN_REVERSAL.APPROVE'),
  validate({ params: idParam, body: approveGrnReversalSchema }),
  c.approve,
);
router.post(
  '/:id/reject',
  can('GRN_REVERSAL.APPROVE'),
  validate({ params: idParam, body: rejectGrnReversalSchema }),
  c.reject,
);
router.post(
  '/:id/cancel',
  can('GRN_REVERSAL.EDIT'),
  validate({ params: idParam, body: cancelGrnReversalSchema }),
  c.cancel,
);

export default router;
