import * as service from '../services/vendorQuotation.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';
import { withApprovability } from '../utils/approvability.js';

const actor = (req) => req.auth.userId;
/** The decision records a name, so it carries the whole identity. */
const approver = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

export const list = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.SORTABLE,
    defaultSort: 'quotationDate',
    defaultDir: 'desc',
  });
  const { authorisationStatus, vendorId, orderId, item, uom, dateFrom, dateTo } = req.query;
  return okList(
    res,
    await service.list({ ...q, authorisationStatus, vendorId, orderId, item, uom, dateFrom, dateTo }),
  );
});

export const get = asyncHandler(async (req, res) =>
  // F-10: the screen is told whether THIS user may approve THIS document, so
  // it never offers a button the server will refuse.
  ok(res, withApprovability('VENDOR_QUOTATION', await service.getById(req.params.id), req.auth)),
);

export const options = asyncHandler(async (req, res) =>
  ok(
    res,
    await service.options({
      orderId: req.query.orderId,
      vendorId: req.query.vendorId,
      approvedOnly: req.query.approvedOnly,
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

// --- The decision ("Approved by Dinesh Sir") --------------------------------

export const approve = asyncHandler(async (req, res) =>
  ok(res, await service.approve(req.params.id, req.body, approver(req))),
);

export const reject = asyncHandler(async (req, res) =>
  ok(res, await service.reject(req.params.id, req.body, approver(req))),
);

export const reopen = asyncHandler(async (req, res) =>
  ok(res, await service.reopen(req.params.id, req.body, approver(req))),
);

// --- Previews and comparison ------------------------------------------------

/**
 * Amount for an unsaved quotation. Exists so the create form never multiplies
 * a rate by a quantity in the browser.
 */
export const previewAmount = asyncHandler(async (req, res) =>
  ok(res, await service.previewAmount(req.body)),
);

/** Every quotation for one order, grouped by item, cheapest rate marked. */
export const compareForOrder = asyncHandler(async (req, res) =>
  ok(res, await service.compareForOrder(req.params.orderId)),
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
