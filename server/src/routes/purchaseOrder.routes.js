import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/purchaseOrder.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  approvePoSchema,
  createPoSchema,
  createPoDocumentSchema,
  poListQuery,
  poOptionsQuery,
  previewPoSchema,
  rejectPoSchema,
  reopenPoSchema,
  setPoStatusSchema,
  updatePoSchema,
} from '../validators/purchaseOrder.validator.js';

const router = Router();

// Static paths first, so "options" and "preview" are not read as ids.
router.get('/options', can('PURCHASE_ORDER.VIEW'), validate({ query: poOptionsQuery }), c.options);

/** Amount and both quantity ceilings for a PO that has not been saved yet. */
router.post(
  '/preview',
  can('PURCHASE_ORDER.VIEW'),
  validate({ body: previewPoSchema }),
  c.preview,
);

router.get('/', can('PURCHASE_ORDER.VIEW'), validate({ query: poListQuery }), c.list);

// ---------------------------------------------------------------------------
//  MULTI-LINE: the PO as the vendor receives it. Before '/:id'.
// ---------------------------------------------------------------------------
router.post(
  '/documents',
  can('PURCHASE_ORDER.CREATE'),
  validate({ body: createPoDocumentSchema }),
  c.createDocument,
);
router.get('/documents/:id', can('PURCHASE_ORDER.VIEW'), validate({ params: idParam }), c.getDocument);
router.get(
  '/documents/:id/print',
  can('PURCHASE_ORDER.EXPORT'),
  validate({ params: idParam }),
  c.printDocument,
);
router.post(
  '/documents/:id/approve',
  can('PURCHASE_ORDER.APPROVE'),
  validate({ params: idParam, body: approvePoSchema }),
  c.approveDocument,
);
router.post(
  '/documents/:id/reject',
  can('PURCHASE_ORDER.APPROVE'),
  validate({ params: idParam, body: rejectPoSchema }),
  c.rejectDocument,
);
router.post('/', can('PURCHASE_ORDER.CREATE'), validate({ body: createPoSchema }), c.create);

router.get('/:id', can('PURCHASE_ORDER.VIEW'), validate({ params: idParam }), c.get);

/**
 * Printing sits behind EXPORT rather than VIEW. Reading a PO on screen and
 * putting a signed instruction in front of a vendor are different acts, and the
 * Director role holds EXPORT everywhere for exactly this kind of reason.
 */
router.get('/:id/print', can('PURCHASE_ORDER.EXPORT'), validate({ params: idParam }), c.printView);

router.patch(
  '/:id',
  can('PURCHASE_ORDER.EDIT'),
  validate({ params: idParam, body: updatePoSchema }),
  c.update,
);
router.delete('/:id', can('PURCHASE_ORDER.DELETE'), validate({ params: idParam }), c.remove);

/** The fulfilment status - about goods, so it belongs to whoever edits the PO. */
router.patch(
  '/:id/status',
  can('PURCHASE_ORDER.EDIT'),
  validate({ params: idParam, body: setPoStatusSchema }),
  c.setStatus,
);

// ---------------------------------------------------------------------------
//  PO APPROVAL. The pipeline's second Director gate, and the one that turns a
//  draft into an instruction a vendor can act on - so it sits behind
//  PURCHASE_ORDER.APPROVE, which Procurement, who raise the POs, do not hold.
// ---------------------------------------------------------------------------
router.post(
  '/:id/approve',
  can('PURCHASE_ORDER.APPROVE'),
  validate({ params: idParam, body: approvePoSchema }),
  c.approve,
);
router.post(
  '/:id/reject',
  can('PURCHASE_ORDER.APPROVE'),
  validate({ params: idParam, body: rejectPoSchema }),
  c.reject,
);
router.post(
  '/:id/reopen',
  can('PURCHASE_ORDER.APPROVE'),
  validate({ params: idParam, body: reopenPoSchema }),
  c.reopen,
);

export default router;
