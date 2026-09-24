import * as service from '../services/audit.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';

export const list = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.SORTABLE,
    defaultSort: 'createdAt',
    defaultDir: 'desc',
  });
  const { tableName, recordId, userId, action, dateFrom, dateTo } = req.query;
  return okList(
    res,
    await service.list({ ...q, tableName, recordId, userId, action, dateFrom, dateTo }),
  );
});

export const getById = asyncHandler(async (req, res) =>
  ok(res, await service.getById(req.params.id)),
);

/** Everything that ever happened to one record, from all three sources. */
export const trail = asyncHandler(async (req, res) =>
  ok(res, await service.trail(req.params.tableName, req.params.recordId)),
);

export const tables = asyncHandler(async (_req, res) => ok(res, service.tables()));

export const actors = asyncHandler(async (_req, res) => ok(res, await service.actors()));

export const summary = asyncHandler(async (req, res) =>
  ok(res, await service.summary({ days: req.query.days ? Number(req.query.days) : undefined })),
);
