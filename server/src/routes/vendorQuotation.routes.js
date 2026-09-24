import { Router } from 'express';
import { z } from 'zod';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/vendorQuotation.controller.js';
import { idParam, uuid } from '../validators/common.validator.js';
import {
  approveQuotationSchema,
  createQuotationSchema,
  createQuotationDocumentSchema,
  previewAmountSchema,
  quotationListQuery,
  quotationOptionsQuery,
  rejectQuotationSchema,
  reopenQuotationSchema,
  updateQuotationSchema,
} from '../validators/vendorQuotation.validator.js';

const router = Router();

const orderIdParam = z.object({ orderId: uuid });

// Static paths first, so "options", "preview" and "compare" are not read as ids.
router.get(
  '/options',
  can('VENDOR_QUOTATION.VIEW'),
  validate({ query: quotationOptionsQuery }),
  c.options,
);

/** Amount for an unsaved quotation - the browser never multiplies. */
router.post(
  '/preview',
  can('VENDOR_QUOTATION.VIEW'),
  validate({ body: previewAmountSchema }),
  c.previewAmount,
);

/** The approver's screen: every quote for an order, cheapest rate marked. */
router.get(
  '/order/:orderId/compare',
  can('VENDOR_QUOTATION.VIEW'),
  validate({ params: orderIdParam }),
  c.compareForOrder,
);

router.get('/', can('VENDOR_QUOTATION.VIEW'), validate({ query: quotationListQuery }), c.list);

// ---------------------------------------------------------------------------
//  MULTI-LINE: the vendor's quote as one document. Before '/:id' so that
//  "documents" is never read as an id.
// ---------------------------------------------------------------------------
router.post(
  '/documents',
  can('VENDOR_QUOTATION.CREATE'),
  validate({ body: createQuotationDocumentSchema }),
  c.createDocument,
);
router.get('/documents/:id', can('VENDOR_QUOTATION.VIEW'), validate({ params: idParam }), c.getDocument);
router.post(
  '/documents/:id/approve',
  can('VENDOR_QUOTATION.APPROVE'),
  validate({ params: idParam, body: approveQuotationSchema }),
  c.approveDocument,
);
router.post(
  '/documents/:id/reject',
  can('VENDOR_QUOTATION.APPROVE'),
  validate({ params: idParam, body: rejectQuotationSchema }),
  c.rejectDocument,
);
router.post(
  '/',
  can('VENDOR_QUOTATION.CREATE'),
  validate({ body: createQuotationSchema }),
  c.create,
);

router.get('/:id', can('VENDOR_QUOTATION.VIEW'), validate({ params: idParam }), c.get);
router.patch(
  '/:id',
  can('VENDOR_QUOTATION.EDIT'),
  validate({ params: idParam, body: updateQuotationSchema }),
  c.update,
);
router.delete('/:id', can('VENDOR_QUOTATION.DELETE'), validate({ params: idParam }), c.remove);

// ---------------------------------------------------------------------------
//  The decision belongs to the Director ("Approved by Dinesh Sir"), so it sits
//  behind VENDOR_QUOTATION.APPROVE - which Procurement, who raise the
//  quotations, do not hold.
// ---------------------------------------------------------------------------
router.post(
  '/:id/approve',
  can('VENDOR_QUOTATION.APPROVE'),
  validate({ params: idParam, body: approveQuotationSchema }),
  c.approve,
);
router.post(
  '/:id/reject',
  can('VENDOR_QUOTATION.APPROVE'),
  validate({ params: idParam, body: rejectQuotationSchema }),
  c.reject,
);
router.post(
  '/:id/reopen',
  can('VENDOR_QUOTATION.APPROVE'),
  validate({ params: idParam, body: reopenQuotationSchema }),
  c.reopen,
);

export default router;
