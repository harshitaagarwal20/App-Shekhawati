import { Router } from 'express';
import validate from '../middleware/validate.js';
import * as attachments from '../controllers/attachment.controller.js';
import { receiveFile } from '../middleware/receiveFile.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/buyerOrder.controller.js';
import { idParam, uuid } from '../validators/common.validator.js';
import { z } from 'zod';

/** Both ids on the attachment routes: the order, and the file hung off it. */
const attachmentParams = z.object({ id: uuid, attachmentId: uuid });
import {
  amendOrderSchema,
  approveExcessSchema,
  createOrderSchema,
  orderListQuery,
  previewSchema,
  rejectExcessSchema,
  setOrderStatusSchema,
  setPricingSchema,
  updateOrderSchema,
} from '../validators/buyerOrder.validator.js';

const router = Router();

// receiveFile: one file, field "file", in memory - see middleware/receiveFile.js.

// Static paths first, so "options" and "preview" are not read as an order id.
router.get('/options', can('BUYER_ORDER.VIEW'), c.options);
router.post('/preview', can('BUYER_ORDER.VIEW'), validate({ body: previewSchema }), c.preview);
router.get(
  '/excess-policy',
  can('BUYER_ORDER.VIEW'),
  validate({ query: z.object({ buyerId: uuid.optional(), orderId: uuid.optional() }) }),
  c.excessPolicy,
);

router.get('/', can('BUYER_ORDER.VIEW'), validate({ query: orderListQuery }), c.list);
router.post('/', can('BUYER_ORDER.CREATE'), validate({ body: createOrderSchema }), c.create);

router.get('/:id', can('BUYER_ORDER.VIEW'), validate({ params: idParam }), c.get);
router.patch('/:id', can('BUYER_ORDER.EDIT'), validate({ params: idParam, body: updateOrderSchema }), c.update);
router.post('/:id/amend', can('BUYER_ORDER.EDIT'), validate({ params: idParam, body: amendOrderSchema }), c.amend);
/**
 * Prices and commercial terms. EDIT, like the rest of the order - but open
 * after downstream documents exist, because a price is not structural.
 */
router.patch('/:id/pricing', can('BUYER_ORDER.EDIT'), validate({ params: idParam, body: setPricingSchema }), c.setPricing);
router.patch('/:id/status', can('BUYER_ORDER.EDIT'), validate({ params: idParam, body: setOrderStatusSchema }), c.setStatus);
router.delete('/:id', can('BUYER_ORDER.DELETE'), validate({ params: idParam }), c.remove);

// The excess decision belongs to the Director ("Approval from dinesh sir").
router.post('/:id/excess/approve', can('BUYER_ORDER.APPROVE'), validate({ params: idParam, body: approveExcessSchema }), c.approveExcess);
router.post('/:id/excess/reject', can('BUYER_ORDER.APPROVE'), validate({ params: idParam, body: rejectExcessSchema }), c.rejectExcess);

/*
 * ATTACHMENTS - the buyer's measurement sheet.
 *
 * Reading one is BUYER_ORDER.VIEW: whoever may see the order may see the sheet
 * its per-piece figures came from. Attaching and removing are EDIT, not
 * APPROVE - hanging a document off an order is clerical, and the excess
 * decision is the only thing on this record that needs a signature.
 */
router.get(
  '/:id/attachments',
  can('BUYER_ORDER.VIEW'),
  validate({ params: idParam }),
  attachments.list,
);
router.get(
  '/:id/attachments/:attachmentId',
  can('BUYER_ORDER.VIEW'),
  validate({ params: attachmentParams }),
  attachments.download,
);
/* `upload` runs before `validate`: the body is multipart and does not exist as
   fields until multer has parsed it. */
router.post(
  '/:id/attachments',
  can('BUYER_ORDER.EDIT'),
  validate({ params: idParam }),
  receiveFile,
  attachments.create,
);
router.delete(
  '/:id/attachments/:attachmentId',
  can('BUYER_ORDER.EDIT'),
  validate({ params: attachmentParams }),
  attachments.remove,
);

export default router;
