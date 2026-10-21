import * as service from '../services/externalQc.service.js';
import { asyncHandler, ok, okListWithTotals, parseListQuery } from '../utils/http.js';

export const context = asyncHandler(async (req, res) => ok(res, await service.context(req.auth)));

export const orderOptions = asyncHandler(async (_req, res) => ok(res, await service.orderOptions()));

export const position = asyncHandler(async (req, res) => ok(res, await service.position(req.query)));

export const list = asyncHandler(async (req, res) =>
  okListWithTotals(
    res,
    await service.list({
      ...req.query,
      ...parseListQuery(req, { sortable: service.SORTABLE, defaultSort: 'entryDate', defaultDir: 'desc' }),
    }),
  ),
);

export const get = asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id)));

export const create = asyncHandler(async (req, res) => ok(res, await service.create(req.auth, req.body), 201));

export const update = asyncHandler(async (req, res) => ok(res, await service.update(req.auth, req.params.id, req.body)));

export const remove = asyncHandler(async (req, res) => ok(res, await service.remove(req.auth, req.params.id)));

// --- The inspection report -------------------------------------------------

export const listAttachments = asyncHandler(async (req, res) => ok(res, await service.listAttachments(req.params.id)));

export const addAttachment = asyncHandler(async (req, res) =>
  ok(res, await service.addAttachment(req.params.id, req.file, { id: req.auth.userId, fullName: req.auth.fullName }), 201),
);

/** Answers with the file, not the JSON envelope - see attachment.controller.js. */
export const downloadAttachment = asyncHandler(async (req, res) => {
  const file = await service.fetchAttachment(req.params.id, req.params.attachmentId);
  const body = Buffer.from(file.data);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', body.length);
  const safe = file.fileName.replace(/["\\\r\n]/g, '_');
  res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.end(body);
});

export const removeAttachment = asyncHandler(async (req, res) =>
  ok(res, await service.removeAttachment(req.params.id, req.params.attachmentId, req.auth.userId)),
);
