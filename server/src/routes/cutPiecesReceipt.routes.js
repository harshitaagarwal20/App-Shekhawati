import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/cutPiecesReceipt.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  createCutPiecesReceiptSchema,
  cutPiecesReceiptListQuery,
  cutPiecesSummaryQuery,
  updateCutPiecesReceiptSchema,
} from '../validators/cutPiecesReceipt.validator.js';

const router = Router();

router.get('/', can('CUT_PIECES_RECEIPT.VIEW'), validate({ query: cutPiecesReceiptListQuery }), c.list);

/** Pieces in hand for an order: received from cutting, less issued to stitching. */
router.get('/summary', can('CUT_PIECES_RECEIPT.VIEW'), validate({ query: cutPiecesSummaryQuery }), c.summary);

router.get('/next-number', can('CUT_PIECES_RECEIPT.CREATE'), c.nextNo);

router.post('/', can('CUT_PIECES_RECEIPT.CREATE'), validate({ body: createCutPiecesReceiptSchema }), c.create);

router.get('/:id', can('CUT_PIECES_RECEIPT.VIEW'), validate({ params: idParam }), c.get);

router.patch(
  '/:id',
  can('CUT_PIECES_RECEIPT.EDIT'),
  validate({ params: idParam, body: updateCutPiecesReceiptSchema }),
  c.update,
);

router.delete('/:id', can('CUT_PIECES_RECEIPT.DELETE'), validate({ params: idParam }), c.remove);

export default router;
