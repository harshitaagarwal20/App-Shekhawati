/**
 * External QC - /api/external-qc
 *
 *      GET    /context                       agencies, checkers, reasons
 *      GET    /orders                        orders and styles ironing has pressed
 *      GET    /position                      one order and style's finishing flow
 *      GET    /  POST /                      the register
 *      GET | PATCH | DELETE /:id             one entry
 *      GET | POST /:id/attachments           the inspection report (photo / PDF)
 *      GET | DELETE /:id/attachments/:aid
 *
 * Attaching the report is EDIT: hanging a document off an entry is clerical.
 */

import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import { receiveFile } from '../middleware/receiveFile.js';
import * as c from '../controllers/externalQc.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  attachmentParams,
  createExternalQcSchema,
  externalQcListQuery,
  orderStyleQuery,
  updateExternalQcSchema,
} from '../validators/externalQc.validator.js';

const router = Router();

router.get('/context', can('EXTERNAL_QC.VIEW'), c.context);
router.get('/orders', can('EXTERNAL_QC.VIEW'), c.orderOptions);
router.get('/position', can('EXTERNAL_QC.VIEW'), validate({ query: orderStyleQuery }), c.position);

router.get('/', can('EXTERNAL_QC.VIEW'), validate({ query: externalQcListQuery }), c.list);
router.post('/', can('EXTERNAL_QC.CREATE'), validate({ body: createExternalQcSchema }), c.create);
router.get('/:id', can('EXTERNAL_QC.VIEW'), validate({ params: idParam }), c.get);
router.patch('/:id', can('EXTERNAL_QC.EDIT'), validate({ params: idParam, body: updateExternalQcSchema }), c.update);
router.delete('/:id', can('EXTERNAL_QC.DELETE'), validate({ params: idParam }), c.remove);

router.get('/:id/attachments', can('EXTERNAL_QC.VIEW'), validate({ params: idParam }), c.listAttachments);
router.get('/:id/attachments/:attachmentId', can('EXTERNAL_QC.VIEW'), validate({ params: attachmentParams }), c.downloadAttachment);
router.post('/:id/attachments', can('EXTERNAL_QC.EDIT'), validate({ params: idParam }), receiveFile, c.addAttachment);
router.delete('/:id/attachments/:attachmentId', can('EXTERNAL_QC.EDIT'), validate({ params: attachmentParams }), c.removeAttachment);

export default router;
