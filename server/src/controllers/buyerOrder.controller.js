import * as service from '../services/buyerOrder.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';
import { withApprovability } from '../utils/approvability.js';

const actor = (req) => req.auth.userId;
const approver = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

export const list = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, { sortable: service.SORTABLE, defaultSort: 'orderDate', defaultDir: 'desc' });
  const { status, excessApprovalStatus, buyerId, styleId, currency, orderFrom, orderTo, deliveryFrom, deliveryTo } = req.query;
  return okList(
    res,
    await service.list({
      ...q,
      status,
      excessApprovalStatus,
      buyerId,
      styleId,
      currency,
      orderFrom,
      orderTo,
      deliveryFrom,
      deliveryTo,
    }),
  );
});

export const get = asyncHandler(async (req, res) =>
  // F-10: the screen is told whether THIS user may approve THIS document, so
  // it never offers a button the server will refuse.
  ok(res, withApprovability('BUYER_ORDER', await service.getById(req.params.id), req.auth)),
);

export const options = asyncHandler(async (_req, res) => ok(res, await service.options()));

export const create = asyncHandler(async (req, res) =>
  ok(res, await service.create(req.body, actor(req)), 201),
);

export const update = asyncHandler(async (req, res) =>
  ok(res, await service.update(req.params.id, req.body, actor(req))),
);

export const amend = asyncHandler(async (req, res) =>
  ok(res, await service.amend(req.params.id, req.body, actor(req))),
);

export const setPricing = asyncHandler(async (req, res) =>
  ok(res, await service.setPricing(req.params.id, req.body, actor(req))),
);

export const setStatus = asyncHandler(async (req, res) =>
  ok(res, await service.setStatus(req.params.id, req.body.status, actor(req))),
);

export const approveExcess = asyncHandler(async (req, res) =>
  ok(res, await service.approveExcess(req.params.id, req.body, approver(req))),
);

export const rejectExcess = asyncHandler(async (req, res) =>
  ok(res, await service.rejectExcess(req.params.id, req.body, approver(req))),
);

export const remove = asyncHandler(async (req, res) =>
  ok(res, await service.remove(req.params.id, actor(req))),
);

/**
 * Requirement preview for an unsaved order. Exists so the create form can show
 * what the order will consume without the browser doing any of the arithmetic.
 */
export const preview = asyncHandler(async (req, res) =>
  ok(res, await service.previewRequirement(req.body)),
);
