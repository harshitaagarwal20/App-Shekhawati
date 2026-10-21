import * as service from '../services/productionRegister.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';

const actor = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

/**
 * The five handlers of one register. Every register after cutting is served
 * by the same engine, so the only thing that differs between them is `key`.
 */
export function handlersFor(key) {
  return {
    list: asyncHandler(async (req, res) => {
      const q = parseListQuery(req, {
        sortable: service.sortableOf(key),
        defaultSort: service.defaultSortOf(key),
        defaultDir: 'desc',
      });
      return okList(res, await service.list(key, { ...req.query, ...q }));
    }),
    get: asyncHandler(async (req, res) => ok(res, await service.getById(key, req.params.id))),
    create: asyncHandler(async (req, res) => ok(res, await service.create(key, req.body, actor(req)), 201)),
    update: asyncHandler(async (req, res) =>
      ok(res, await service.update(key, req.params.id, req.body, actor(req))),
    ),
    remove: asyncHandler(async (req, res) => ok(res, await service.remove(key, req.params.id, req.auth.userId))),
  };
}

export const orderOptions = asyncHandler(async (_req, res) => ok(res, await service.orderOptions()));

export const styleOptions = asyncHandler(async (_req, res) => ok(res, await service.styleOptions()));

export const employeeOptions = asyncHandler(async (_req, res) => ok(res, await service.employeeOptions()));

export const orderContext = asyncHandler(async (req, res) => ok(res, await service.orderContext(req.query.orderId)));
