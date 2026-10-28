import * as service from '../services/assistant.service.js';
import * as documents from '../services/assistantDocuments.service.js';
import { asyncHandler, ok } from '../utils/http.js';

export const status = asyncHandler(async (req, res) => ok(res, service.status(req.auth.has)));

export const ask = asyncHandler(async (req, res) =>
  ok(res, await service.ask(req.body, { userId: req.auth.userId, has: req.auth.has })),
);

export const listDocuments = asyncHandler(async (req, res) => ok(res, await documents.list(req.auth.has)));

export const uploadDocument = asyncHandler(async (req, res) =>
  ok(res, await documents.upload(req.file, req.body, { id: req.auth.userId, fullName: req.auth.fullName }), 201),
);

/** Answers with the file, not the JSON envelope - see attachment.controller.js. */
export const downloadDocument = asyncHandler(async (req, res) => {
  const file = await documents.fetchFile(req.params.id, req.auth.has);
  const body = Buffer.from(file.data);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', body.length);
  const safe = file.fileName.replace(/["\\\r\n]/g, '_');
  res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.end(body);
});

export const removeDocument = asyncHandler(async (req, res) =>
  ok(res, await documents.remove(req.params.id, { id: req.auth.userId })),
);
