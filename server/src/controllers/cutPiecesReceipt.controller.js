import * as service from '../services/cutPiecesReceipt.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';

/** The receipt records who counted the pieces in. */
const actor = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

export const list = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.SORTABLE,
    defaultSort: 'receiptDate',
    defaultDir: 'desc',
  });
  const { orderId, styleId, cuttingChallanId, dateFrom, dateTo } = req.query;
  return okList(res, await service.list({ ...q, orderId, styleId, cuttingChallanId, dateFrom, dateTo }));
});

export const get = asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id)));

export const summary = asyncHandler(async (req, res) => ok(res, await service.summary(req.query)));

export const nextNo = asyncHandler(async (_req, res) => ok(res, await service.nextReceiptNo()));

export const create = asyncHandler(async (req, res) =>
  ok(res, await service.create(req.body, actor(req)), 201),
);

export const update = asyncHandler(async (req, res) =>
  ok(res, await service.update(req.params.id, req.body, actor(req))),
);

export const remove = asyncHandler(async (req, res) =>
  ok(res, await service.remove(req.params.id, req.auth.userId)),
);
