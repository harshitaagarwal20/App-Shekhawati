import * as service from '../services/purchaseOrder.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';
import { withApprovability } from '../utils/approvability.js';

const actor = (req) => req.auth.userId;
/** A decision records a name, so it carries the whole identity. */
const approver = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

export const list = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.SORTABLE,
    defaultSort: 'poDate',
    defaultDir: 'desc',
  });
  const {
    approvalStatus, status, vendorId, orderId, quotationId, item, orderMode, uom,
    dateFrom, dateTo, pendingReceipt,
  } = req.query;

  return okList(
    res,
    await service.list({
      ...q,
      approvalStatus,
      status,
      vendorId,
      orderId,
      quotationId,
      item,
      orderMode,
      uom,
      dateFrom,
      dateTo,
      pendingReceipt,
    }),
  );
});

export const get = asyncHandler(async (req, res) =>
  // F-10: the screen is told whether THIS user may approve THIS document, so
  // it never offers a button the server will refuse.
  ok(res, withApprovability('PURCHASE_ORDER', await service.getById(req.params.id), req.auth)),
);

export const options = asyncHandler(async (req, res) =>
  ok(
    res,
    await service.options({
      vendorId: req.query.vendorId,
      orderId: req.query.orderId,
      approvedOnly: req.query.approvedOnly,
      openOnly: req.query.openOnly,
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

// --- PO Approval ------------------------------------------------------------

export const approve = asyncHandler(async (req, res) =>
  ok(res, await service.approve(req.params.id, req.body, approver(req))),
);

export const reject = asyncHandler(async (req, res) =>
  ok(res, await service.reject(req.params.id, req.body, approver(req))),
);

export const reopen = asyncHandler(async (req, res) =>
  ok(res, await service.reopen(req.params.id, req.body, approver(req))),
);

/** The fulfilment status - about goods, not about authority. */
export const setStatus = asyncHandler(async (req, res) =>
  ok(res, await service.setStatus(req.params.id, req.body.status, actor(req))),
);

// --- Preview and printing ---------------------------------------------------

/**
 * Amount and both ceilings for a PO that has not been saved yet. Exists so the
 * form never multiplies a rate by a quantity, and never has to guess what the
 * style permits.
 */
export const preview = asyncHandler(async (req, res) => ok(res, await service.preview(req.body)));

/** The printable purchase order, assembled on the server. */
export const printView = asyncHandler(async (req, res) =>
  ok(res, await service.printView(req.params.id)),
);

// --- Multi-line documents -----------------------------------------------------

export const createDocument = asyncHandler(async (req, res) =>
  ok(res, await service.createDocument(req.body, actor(req)), 201),
);

export const getDocument = asyncHandler(async (req, res) =>
  ok(res, await service.getDocument(req.params.id)),
);

export const approveDocument = asyncHandler(async (req, res) =>
  ok(res, await service.approveDocument(req.params.id, req.body, approver(req))),
);

export const rejectDocument = asyncHandler(async (req, res) =>
  ok(res, await service.rejectDocument(req.params.id, req.body, approver(req))),
);

export const printDocument = asyncHandler(async (req, res) =>
  ok(res, await service.printDocument(req.params.id)),
);
