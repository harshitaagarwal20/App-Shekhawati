import * as service from '../services/materialPlan.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';
import { withApprovability } from '../utils/approvability.js';

/** Raising and editing record an id; approvals record a name as well. */
const actor = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

export const list = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.SORTABLE,
    defaultSort: 'planDate',
    defaultDir: 'desc',
  });
  const { approvalStatus, workflowState, orderId, styleId, containerNo } = req.query;
  return okList(
    res,
    await service.list({ ...q, approvalStatus, workflowState, orderId, styleId, containerNo }),
  );
});

export const get = asyncHandler(async (req, res) =>
  // F-10: the screen is told whether THIS user may approve THIS document, so
  // it never offers a button the server will refuse.
  ok(res, withApprovability('MATERIAL_PLAN', await service.getById(req.params.id), req.auth)),
);

/** What a plan for this order would contain, through the code path save uses. */
export const preview = asyncHandler(async (req, res) =>
  ok(res, await service.preview(req.body)),
);

/**
 * Whether the style BOM has moved since this plan was signed. Reports only -
 * a signed figure is never silently corrected.
 */
export const drift = asyncHandler(async (req, res) =>
  ok(res, await service.drift(req.params.id)),
);

/** C13 - the order's styles, and which of them still need a plan. */
export const plannableLines = asyncHandler(async (req, res) =>
  ok(res, await service.plannableLines(req.params.orderId)),
);

export const create = asyncHandler(async (req, res) =>
  ok(res, await service.create(req.body, actor(req)), 201),
);

export const update = asyncHandler(async (req, res) =>
  ok(res, await service.update(req.params.id, req.body, actor(req))),
);

export const remove = asyncHandler(async (req, res) =>
  ok(res, await service.remove(req.params.id, req.auth.userId)),
);

// --- Approval flow ---------------------------------------------------------

export const submit = asyncHandler(async (req, res) =>
  ok(res, await service.submit(req.params.id, req.body, actor(req))),
);

export const approve = asyncHandler(async (req, res) =>
  ok(res, await service.approve(req.params.id, req.body, actor(req))),
);

export const reject = asyncHandler(async (req, res) =>
  ok(res, await service.reject(req.params.id, req.body, actor(req))),
);

export const cancel = asyncHandler(async (req, res) =>
  ok(res, await service.cancel(req.params.id, req.body, actor(req))),
);
