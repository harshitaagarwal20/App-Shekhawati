/**
 * The assistant - questions answered from the reports and the uploaded
 * reference documents. See services/assistant.service.js.
 *
 *   GET    /                         is it on, and what may this user do
 *   POST   /ask                      one question (with the conversation so far)
 *   GET    /documents                the documents this user may read
 *   POST   /documents                upload a PDF or .txt (multipart, field "file")
 *   GET    /documents/:id/file       the original file
 *   DELETE /documents/:id            remove a document
 *
 * ASSISTANT.VIEW opens the assistant; what it can look up inside is then
 * decided tool by tool from the caller's other permissions (assistantTools.js).
 */

import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { receiveFile } from '../middleware/receiveFile.js';
import * as c from '../controllers/assistant.controller.js';
import { idParam } from '../validators/common.validator.js';
import { askSchema, uploadSchema } from '../validators/assistant.validator.js';

const router = Router();

router.get('/', can('ASSISTANT.VIEW'), c.status);

/*
 * Every question is a paid call to the API, and a few of them each. Thirty a
 * quarter of an hour is more than anybody types, and stops a stuck script
 * from running up a bill.
 */
router.post(
  '/ask',
  can('ASSISTANT.VIEW'),
  rateLimit({ windowMs: 15 * 60_000, max: 30, key: (req) => `assistant:${req.auth.userId}` }),
  validate({ body: askSchema }),
  c.ask,
);

router.get('/documents', can('ASSISTANT.VIEW'), c.listDocuments);
// receiveFile before validate: the body is multipart and has no fields until
// multer has parsed it.
router.post('/documents', can('ASSISTANT.CREATE'), receiveFile, validate({ body: uploadSchema }), c.uploadDocument);
router.get('/documents/:id/file', can('ASSISTANT.VIEW'), validate({ params: idParam }), c.downloadDocument);
router.delete('/documents/:id', can('ASSISTANT.DELETE'), validate({ params: idParam }), c.removeDocument);

export default router;
