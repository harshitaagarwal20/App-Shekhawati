import * as service from '../services/costSheet.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';

const actor = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

export const list = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, { sortable: service.SORTABLE, defaultSort: 'costDate', defaultDir: 'desc' });
  const { styleId, orderId, status } = req.query;
  return okList(res, await service.list({ ...q, styleId, orderId, status }));
});

export const get = asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id)));

export const create = asyncHandler(async (req, res) =>
  ok(res, await service.create(req.body, actor(req)), 201),
);

export const update = asyncHandler(async (req, res) =>
  ok(res, await service.update(req.params.id, req.body, actor(req))),
);

export const submit = asyncHandler(async (req, res) =>
  ok(res, await service.submit(req.params.id, req.body, actor(req))),
);

export const approve = asyncHandler(async (req, res) =>
  ok(res, await service.approve(req.params.id, req.body, actor(req))),
);

export const reject = asyncHandler(async (req, res) =>
  ok(res, await service.reject(req.params.id, req.body, actor(req))),
);

export const revise = asyncHandler(async (req, res) =>
  ok(res, await service.revise(req.params.id, actor(req)), 201),
);

export const refreshRates = asyncHandler(async (req, res) =>
  ok(res, await service.refreshRates(req.params.id, actor(req))),
);

export const remove = asyncHandler(async (req, res) =>
  ok(res, await service.remove(req.params.id, actor(req))),
);
