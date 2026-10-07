import * as service from '../services/grn.service.js';
import * as tax from '../services/tax.service.js';
import { asyncHandler, ok, parseListQuery } from '../utils/http.js';

const actor = (req) => req.auth.userId;
/**
 * Posting a receipt stamps who posted it, inside the transaction that posts it,
 * so it carries the whole identity rather than just an id.
 */
const poster = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

export const list = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.SORTABLE,
    defaultSort: 'grnDate',
    defaultDir: 'desc',
  });
  const {
    purchaseOrderId, vendorId, gatePassId, itemId, purpose, status,
    dateFrom, dateTo, breachesOnly,
  } = req.query;

  const result = await service.list({
    ...q,
    purchaseOrderId,
    vendorId,
    gatePassId,
    itemId,
    purpose,
    status,
    dateFrom,
    dateTo,
    breachesOnly,
  });

  // The standard paging envelope, with the receipt totals riding alongside it
  // so the screen never adds up a column itself. Written out rather than going
  // through okList() for exactly that one extra key.
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
      totals: result.totals,
    },
  });
});

/**
 * One row per receipt DOCUMENT rather than per line - same filters as `list`,
 * and the same totals envelope, because the footer is the same footer.
 */
export const listDocuments = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.DOCUMENT_SORTABLE,
    defaultSort: 'grnDate',
    defaultDir: 'desc',
  });
  const {
    purchaseOrderId, vendorId, gatePassId, itemId, purpose, status,
    dateFrom, dateTo, breachesOnly,
  } = req.query;

  const result = await service.listDocuments({
    ...q,
    purchaseOrderId,
    vendorId,
    gatePassId,
    itemId,
    purpose,
    status,
    dateFrom,
    dateTo,
    breachesOnly,
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
      totals: result.totals,
    },
  });
});

export const get = asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id)));

/**
 * Posts a receipt: GRN, fabric rolls and stock ledger IN, in one transaction.
 * 201, because a receipt that returns anything else did not happen.
 */
export const create = asyncHandler(async (req, res) =>
  ok(res, await service.create(req.body, poster(req)), 201),
);

export const update = asyncHandler(async (req, res) =>
  ok(res, await service.update(req.params.id, req.body, actor(req))),
);

export const remove = asyncHandler(async (req, res) =>
  ok(res, await service.remove(req.params.id, actor(req))),
);

/**
 * Moves a receipt's fulfilment status.
 *
 * Its own endpoint rather than a field on PATCH, because a status change is a
 * controlled transition rather than an edit.
 */
export const setStatus = asyncHandler(async (req, res) =>
  ok(res, await service.setStatus(req.params.id, req.body, actor(req))),
);

/** The receipt figures for a GRN that has not been saved yet. */
export const preview = asyncHandler(async (req, res) => ok(res, await service.preview(req.body)));

/** The printable goods receipt note. */
export const printView = asyncHandler(async (req, res) =>
  ok(res, await service.printView(req.params.id)),
);

/** The purchase invoice - what it cost, with the tax the vendor charged. */
export const invoiceView = asyncHandler(async (req, res) =>
  ok(res, await service.invoiceView(req.params.id)),
);

/** The GST slabs, for the rate dropdown. */
export const gstRates = asyncHandler(async (_req, res) => ok(res, await tax.rateOptions()));;

// --- Multi-line documents -----------------------------------------------------

export const createDocument = asyncHandler(async (req, res) =>
  ok(res, await service.createDocument(req.body, poster(req)), 201),
);

export const getDocument = asyncHandler(async (req, res) =>
  ok(res, await service.getDocument(req.params.id)),
);
