import { Router } from 'express';
import multer from 'multer';
import validate from '../middleware/validate.js';
import * as attachments from '../controllers/attachment.controller.js';
import { MAX_BYTES } from '../services/attachment.service.js';
import { ApiError } from '../utils/ApiError.js';
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

/*
 * MEMORY STORAGE, DELIBERATELY.
 *
 * The file's destination is a bytea column, so writing it to a temp directory
 * first would only add a file to clean up and a failure mode where the row is
 * written and the temp file is not removed. `limits.fileSize` is the real
 * guard - it aborts the request mid-stream rather than buffering 500 MB to
 * discover it is too big - and the service checks the size again on the way
 * in, because a limit enforced in one place is a limit that moves when the
 * upload route does.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

/**
 * Multer's own failures, said in words.
 *
 * A MulterError carries a `code` and no status, so it would fall through the
 * error handler to a bare 500 - "the ERP is broken" for what is really "that
 * file is too big". The limit is stated in the message because a refusal that
 * does not say the ceiling leaves the user to find it by bisection.
 */
const receiveFile = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const said = {
        LIMIT_FILE_SIZE: `That file is larger than the ${MAX_BYTES / 1024 / 1024} MB limit.`,
        LIMIT_FILE_COUNT: 'Attach one file at a time.',
        LIMIT_UNEXPECTED_FILE: 'The upload field must be named "file".',
      }[err.code];
      return next(ApiError.badRequest(said ?? `Upload failed: ${err.code}`, { field: 'file' }));
    }
    return next(err);
  });

// Static paths first, so "options" and "preview" are not read as an order id.
router.get('/options', can('BUYER_ORDER.VIEW'), c.options);
router.post('/preview', can('BUYER_ORDER.VIEW'), validate({ body: previewSchema }), c.preview);

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
