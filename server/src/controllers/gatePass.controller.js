import * as service from '../services/gatePass.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';

const actor = (req) => req.auth.userId;
/** Clearing a gate pass records a name, so it carries the whole identity. */
const clearer = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

export const list = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.SORTABLE,
    defaultSort: 'gatePassDate',
    defaultDir: 'desc',
  });
  const {
    type, status, purpose, vendorId, purchaseOrderId, linkedDocNo,
    dateFrom, dateTo, withVariation,
  } = req.query;

  return okList(
    res,
    await service.list({
      ...q,
      type,
      status,
      purpose,
      vendorId,
      purchaseOrderId,
      linkedDocNo,
      dateFrom,
      dateTo,
      withVariation,
    }),
  );
});

export const get = asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id)));

export const options = asyncHandler(async (req, res) =>
  ok(
    res,
    await service.options({
      purchaseOrderId: req.query.purchaseOrderId,
      type: req.query.type,
      clearedOnly: req.query.clearedOnly,
      withoutGrn: req.query.withoutGrn,
    }),
  ),
);

export const create = asyncHandler(async (req, res) =>
  ok(res, await service.create(req.body, actor(req)), 201),
);

export const update = asyncHandler(async (req, res) =>
  ok(res, await service.update(req.params.id, req.body, actor(req))),
);

export const remove = asyncHandler(async (req, res) =>
  ok(res, await service.remove(req.params.id, actor(req))),
);

// --- At the gate ------------------------------------------------------------

/** The goods have been counted. Variation is computed from what was counted. */
export const allocate = asyncHandler(async (req, res) =>
  ok(res, await service.allocate(req.params.id, req.body, clearer(req))),
);

export const clear = asyncHandler(async (req, res) =>
  ok(res, await service.clear(req.params.id, req.body, clearer(req))),
);

export const reopen = asyncHandler(async (req, res) =>
  ok(res, await service.reopen(req.params.id, req.body, clearer(req))),
);

// --- Preview and printing ---------------------------------------------------

/**
 * Resolves the linked document and works out the quantity and the variation
 * before anything is saved, so the checker sees what the PO is still expecting.
 */
export const preview = asyncHandler(async (req, res) => ok(res, await service.preview(req.body)));

/** The printable gate pass - the slip the security desk keeps. */
export const printView = asyncHandler(async (req, res) =>
  ok(res, await service.printView(req.params.id)),
);
