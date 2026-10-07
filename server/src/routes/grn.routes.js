import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/grn.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  createGrnSchema,
  createGrnDocumentSchema,
  grnListQuery,
  previewGrnSchema,
  setGrnStatusSchema,
  updateGrnSchema,
} from '../validators/grn.validator.js';

const router = Router();

/** The receipt figures for a GRN that has not been saved yet. */
router.post('/preview', can('GRN.VIEW'), validate({ body: previewGrnSchema }), c.preview);

router.get('/', can('GRN.VIEW'), validate({ query: grnListQuery }), c.list);

/**
 * Posting a receipt. One request, one transaction:
 * GRN -> Fabric Roll -> Stock Ledger IN -> balance -> PO received quantity.
 * There is no separate "post" endpoint, because a GRN that has not reached the
 * ledger is not a state this system is willing to hold.
 */
router.post('/', can('GRN.CREATE'), validate({ body: createGrnSchema }), c.create);

/** MULTI-LINE: one delivery, one bill, several PO lines. Before '/:id'. */
router.post('/documents', can('GRN.CREATE'), validate({ body: createGrnDocumentSchema }), c.createDocument);
/**
 * The register: one row per receipt document. Declared BEFORE '/documents/:id'
 * so the bare path is not read as a receipt whose id is the empty string.
 */
router.get('/documents', can('GRN.VIEW'), validate({ query: grnListQuery }), c.listDocuments);
router.get('/documents/:id', can('GRN.VIEW'), validate({ params: idParam }), c.getDocument);

router.get('/:id', can('GRN.VIEW'), validate({ params: idParam }), c.get);
router.get('/:id/print', can('GRN.EXPORT'), validate({ params: idParam }), c.printView);

/**
 * The purchase invoice.
 *
 * A separate document from the goods receipt note, and separate on purpose:
 * the GRN says what arrived, the invoice says what it cost. Same permission,
 * because anybody who may export a receipt may see what was paid for it.
 */
router.get('/:id/invoice', can('GRN.EXPORT'), validate({ params: idParam }), c.invoiceView);

/** The GST slabs, from the master list. Any GRN user needs them to key a bill. */
router.get('/meta/gst-rates', can('GRN.VIEW'), c.gstRates);

/** Descriptive fields only - the quantities are in the ledger and stay there. */
router.patch(
  '/:id',
  can('GRN.EDIT'),
  validate({ params: idParam, body: updateGrnSchema }),
  c.update,
);
/**
 * The fulfilment status - about goods, not authority.
 *
 * A named endpoint rather than a field on PATCH: the move is checked against
 * the transition table, so a screen cannot set an arbitrary value.
 */
router.post(
  '/:id/status',
  can('GRN.EDIT'),
  validate({ params: idParam, body: setGrnStatusSchema }),
  c.setStatus,
);

router.delete('/:id', can('GRN.DELETE'), validate({ params: idParam }), c.remove);

export default router;
