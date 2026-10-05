import * as service from '../services/inventory.service.js';
import * as openingStock from '../services/openingStock.service.js';
import { asyncHandler, ok, okList, okListWithTotals, parseListQuery } from '../utils/http.js';

const actor = (req) => req.auth.userId;

// --- Stock items ------------------------------------------------------------

export const listItems = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.ITEM_SORTABLE,
    defaultSort: 'itemCode',
    defaultDir: 'asc',
  });
  const { itemCategory, isActive, lowStock } = req.query;
  return okList(res, await service.listItems({ ...q, itemCategory, isActive, lowStock }));
});

export const getItem = asyncHandler(async (req, res) =>
  ok(res, await service.getItem(req.params.id)),
);

export const updateItem = asyncHandler(async (req, res) =>
  ok(res, await service.updateItem(req.params.id, req.body, actor(req))),
);

export const itemOptions = asyncHandler(async (req, res) =>
  ok(
    res,
    await service.itemOptions({
      itemCategory: req.query.itemCategory,
      rollTrackedOnly: req.query.rollTrackedOnly,
    }),
  ),
);

// --- Stock ------------------------------------------------------------------

/**
 * On-hand by item and location, valued, with low stock called out.
 *
 * Sent through `okListWithTotals` rather than `okList`: the screen shows three
 * figures above the table - lines, value, below reorder - that describe the
 * whole filter rather than the page, and they have to survive paging. The
 * service computes them by aggregate for exactly that reason.
 */
export const summary = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    // Sorting is fixed at item code then location: the balance table's own
    // columns are not what anybody scans this screen by.
    sortable: [],
    defaultSort: 'id',
  });

  const result = await service.stockSummary({
    ...q,
    location: req.query.location,
    itemCategory: req.query.itemCategory,
    lowStock: req.query.lowStock === true || req.query.lowStock === 'true',
  });

  return okListWithTotals(res, result);
});

/**
 * The stock ledger, as a register. There is no POST counterpart: the only way
 * stock moves is as a consequence of a document.
 */
export const ledger = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.LEDGER_SORTABLE,
    defaultSort: 'entryDate',
    defaultDir: 'desc',
  });
  const { itemId, rollId, orderId, location, documentType, direction, dateFrom, dateTo } = req.query;

  const result = await service.listLedger({
    ...q,
    itemId,
    rollId,
    orderId,
    location,
    documentType,
    direction,
    dateFrom,
    dateTo,
  });

  return res.status(200).json({
    success: true,
    data: result.rows,
    meta: {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      pageCount: result.pageSize > 0 ? Math.ceil(result.total / result.pageSize) : 0,
      hasNext: result.page * result.pageSize < result.total,
      hasPrev: result.page > 1,
      // In / out / net / value for the filtered register, summed on the server.
      totals: result.totals,
    },
  });
});

/**
 * Rebuilds every balance from the ledger, or - with ?dryRun=true - reports the
 * differences without writing.
 *
 * A derived cache should always be rebuildable. If it is not, it was never
 * really derived.
 */
export const reconcile = asyncHandler(async (req, res) =>
  ok(res, await service.rebuildBalances({ dryRun: req.query.dryRun })),
);

// --- Fabric rolls -----------------------------------------------------------

export const listRolls = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.ROLL_SORTABLE,
    defaultSort: 'rollNo',
    defaultDir: 'asc',
  });
  const { stage, location, vendorId, grnId, itemId, colorCode, inStockOnly, isHeld } = req.query;
  return okList(
    res,
    await service.listRolls({
      ...q,
      stage,
      location,
      vendorId,
      grnId,
      itemId,
      colorCode,
      inStockOnly,
      isHeld,
    }),
  );
});

/**
 * One roll, with the chain the brief asks it to retain:
 * GRN -> vendor -> PO -> order -> characteristics -> location -> issue history.
 */
export const getRoll = asyncHandler(async (req, res) =>
  ok(res, await service.rollTraceability(req.params.id)),
);

export const markRollShade = asyncHandler(async (req, res) =>
  ok(
    res,
    await service.markRollShade(req.params.id, req.body, {
      userId: req.auth.userId,
      fullName: req.auth.fullName ?? req.auth.username ?? null,
    }),
  ),
);

export const relocateRoll = asyncHandler(async (req, res) =>
  ok(res, await service.relocateRoll(req.params.id, req.body, actor(req))),
);

// ---------------------------------------------------------------------------
//  Opening stock
// ---------------------------------------------------------------------------

/** What the file would do, written nowhere. */
export const previewOpeningStock = asyncHandler(async (req, res) =>
  ok(res, await openingStock.preview(req.body.rows)),
);

/** Posts it. One transaction for the whole file - see the service. */
export const applyOpeningStock = asyncHandler(async (req, res) =>
  ok(
    res,
    await openingStock.apply(req.body.rows, {
      userId: req.auth.userId,
      fullName: req.auth.fullName ?? req.auth.username ?? null,
    }),
    201,
  ),
);
