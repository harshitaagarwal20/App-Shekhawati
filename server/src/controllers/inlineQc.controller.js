import * as service from '../services/inlineQc.service.js';
import { asyncHandler, ok, okList, okListWithTotals, parseListQuery } from '../utils/http.js';

/** Every read is held to the caller's unit, when they have one, by the service. */
const listQuery = (req, sortable, defaultSort, defaultDir) => ({
  ...req.query,
  ...parseListQuery(req, { sortable, defaultSort, defaultDir }),
});

export const context = asyncHandler(async (req, res) => ok(res, await service.context(req.auth)));

export const orderOptions = asyncHandler(async (req, res) => ok(res, await service.orderOptions(req.auth, req.query)));

export const list = asyncHandler(async (req, res) =>
  okListWithTotals(res, await service.list(listQuery(req, service.SORTABLE, 'entryDate', 'desc'), req.auth)),
);

export const get = asyncHandler(async (req, res) => ok(res, await service.getById(req.auth, req.params.id)));

export const create = asyncHandler(async (req, res) => ok(res, await service.create(req.auth, req.body), 201));

export const update = asyncHandler(async (req, res) => ok(res, await service.update(req.auth, req.params.id, req.body)));

export const remove = asyncHandler(async (req, res) => ok(res, await service.remove(req.auth, req.params.id)));

// --- The Action needed list ------------------------------------------------

export const actions = asyncHandler(async (req, res) =>
  okList(res, await service.actions(listQuery(req, service.ACTION_SORTABLE, 'createdAt', 'asc'), req.auth)),
);

export const resolve = asyncHandler(async (req, res) => ok(res, await service.resolve(req.auth, req.params.id, req.body)));

export const reopen = asyncHandler(async (req, res) => ok(res, await service.reopen(req.auth, req.params.id)));
