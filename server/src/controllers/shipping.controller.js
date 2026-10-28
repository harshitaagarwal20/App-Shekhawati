import * as needle from '../services/needle.service.js';
import * as packing from '../services/packing.service.js';
import * as dispatch from '../services/dispatch.service.js';
import { asyncHandler, ok, okListWithTotals, parseListQuery } from '../utils/http.js';

const listOf = (req, sortable, defaultSort, defaultDir = 'desc') => ({
  ...req.query,
  ...parseListQuery(req, { sortable, defaultSort, defaultDir }),
});

// --- Needle Checking ---------------------------------------------------------

export const needleContext = asyncHandler(async (req, res) => ok(res, await needle.context(req.auth)));
export const needleOrders = asyncHandler(async (_req, res) => ok(res, await needle.orderOptions()));
export const needlePosition = asyncHandler(async (req, res) => ok(res, await needle.position(req.query)));
export const needleList = asyncHandler(async (req, res) =>
  okListWithTotals(res, await needle.list(listOf(req, needle.SORTABLE, 'checkDate'))));
export const needleGet = asyncHandler(async (req, res) => ok(res, await needle.getById(req.params.id)));
export const needleCreate = asyncHandler(async (req, res) => ok(res, await needle.create(req.auth, req.body), 201));
export const needleUpdate = asyncHandler(async (req, res) => ok(res, await needle.update(req.auth, req.params.id, req.body)));
export const needleRemove = asyncHandler(async (req, res) => ok(res, await needle.remove(req.auth, req.params.id)));

// --- Packing -----------------------------------------------------------------

export const packingContext = asyncHandler(async (req, res) => ok(res, await packing.context(req.auth)));
export const packingOrders = asyncHandler(async (_req, res) => ok(res, await packing.orderOptions()));
export const packingPosition = asyncHandler(async (req, res) => ok(res, await packing.position(req.query)));
export const packingList = asyncHandler(async (req, res) =>
  okListWithTotals(res, await packing.list(listOf(req, packing.SORTABLE, 'packDate'))));
export const packingGet = asyncHandler(async (req, res) => ok(res, await packing.getById(req.params.id)));
export const packingCreate = asyncHandler(async (req, res) => ok(res, await packing.create(req.auth, req.body), 201));
export const packingUpdate = asyncHandler(async (req, res) => ok(res, await packing.update(req.auth, req.params.id, req.body)));
export const packingRemove = asyncHandler(async (req, res) => ok(res, await packing.remove(req.auth, req.params.id)));

// --- Dispatch ----------------------------------------------------------------

export const dispatchContext = asyncHandler(async (req, res) => ok(res, await dispatch.context(req.auth)));
export const dispatchOrders = asyncHandler(async (_req, res) => ok(res, await dispatch.orderOptions()));
export const dispatchPreview = asyncHandler(async (req, res) =>
  ok(res, await dispatch.preview(req.query.orderId, { excluding: req.query.excluding })));
export const dispatchList = asyncHandler(async (req, res) =>
  okListWithTotals(res, await dispatch.list(listOf(req, dispatch.SORTABLE, 'dispatchDate'))));
export const dispatchGet = asyncHandler(async (req, res) => ok(res, await dispatch.getById(req.params.id)));
export const dispatchCreate = asyncHandler(async (req, res) => ok(res, await dispatch.create(req.auth, req.body), 201));
export const dispatchUpdate = asyncHandler(async (req, res) => ok(res, await dispatch.update(req.auth, req.params.id, req.body)));
export const dispatchRemove = asyncHandler(async (req, res) => ok(res, await dispatch.remove(req.auth, req.params.id)));
export const dispatchPrint = asyncHandler(async (req, res) => ok(res, await dispatch.printView(req.params.id, req.params.kind)));
