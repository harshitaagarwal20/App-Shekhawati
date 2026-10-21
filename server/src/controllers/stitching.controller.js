import * as service from '../services/stitching.service.js';
import { asyncHandler, ok, okList, okListWithTotals, parseListQuery } from '../utils/http.js';

/** Every stitching read and write is held to the caller's unit by the service. */
const listQuery = (req, sortable, defaultSort) => ({
  ...req.query,
  ...parseListQuery(req, { sortable, defaultSort, defaultDir: 'desc' }),
});

// --- Shared ---------------------------------------------------------------

export const context = asyncHandler(async (req, res) => ok(res, await service.context(req.auth)));

export const orderOptions = asyncHandler(async (req, res) =>
  ok(res, await service.orderOptions(req.auth, req.query)),
);

// --- Stitching record -----------------------------------------------------

export const dayContext = asyncHandler(async (req, res) => ok(res, await service.dayContext(req.auth, req.query)));

export const list = asyncHandler(async (req, res) =>
  okListWithTotals(res, await service.list(listQuery(req, service.SORTABLE, 'recordDate'), req.auth)),
);

export const get = asyncHandler(async (req, res) => ok(res, await service.getById(req.auth, req.params.id)));

export const create = asyncHandler(async (req, res) => ok(res, await service.create(req.auth, req.body), 201));

export const update = asyncHandler(async (req, res) =>
  ok(res, await service.update(req.auth, req.params.id, req.body)),
);

export const remove = asyncHandler(async (req, res) => ok(res, await service.remove(req.auth, req.params.id)));

// --- Hourly monitoring ----------------------------------------------------

export const hourlyGrid = asyncHandler(async (req, res) => ok(res, await service.hourlyGrid(req.auth, req.query)));

export const saveSlot = asyncHandler(async (req, res) => ok(res, await service.saveSlot(req.auth, req.body)));

export const listHourly = asyncHandler(async (req, res) =>
  okList(res, await service.listHourly(listQuery(req, service.HOURLY_SORTABLE, 'entryDate'), req.auth)),
);

// --- Printing after stitching ---------------------------------------------

export const printingOrderOptions = asyncHandler(async (_req, res) => ok(res, await service.printingOrderOptions()));

export const printingSummary = asyncHandler(async (req, res) => ok(res, await service.printingSummary(req.query)));

export const listPrintings = asyncHandler(async (req, res) =>
  okList(res, await service.listPrintings(listQuery(req, service.PRINTING_SORTABLE, 'printingDate'))),
);

export const getPrinting = asyncHandler(async (req, res) => ok(res, await service.getPrinting(req.params.id)));

export const createPrinting = asyncHandler(async (req, res) =>
  ok(res, await service.createPrinting(req.body, req.auth.userId), 201),
);

export const updatePrinting = asyncHandler(async (req, res) =>
  ok(res, await service.updatePrinting(req.params.id, req.body, req.auth.userId)),
);

export const removePrinting = asyncHandler(async (req, res) =>
  ok(res, await service.removePrinting(req.params.id, req.auth.userId)),
);
