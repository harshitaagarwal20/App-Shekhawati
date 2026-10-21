import * as service from '../services/ironing.service.js';
import { asyncHandler, ok, okListWithTotals, parseListQuery } from '../utils/http.js';

export const context = asyncHandler(async (req, res) => ok(res, await service.context(req.auth)));

export const orderOptions = asyncHandler(async (_req, res) => ok(res, await service.orderOptions()));

export const position = asyncHandler(async (req, res) => ok(res, await service.position(req.query)));

export const pendingRejects = asyncHandler(async (req, res) => ok(res, await service.pendingRejects(req.query)));

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
