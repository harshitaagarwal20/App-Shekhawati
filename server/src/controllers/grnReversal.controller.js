import * as service from '../services/grnReversal.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';
import { withApprovability } from '../utils/approvability.js';

/** Raising and editing record an id; approvals record a name as well. */
const actor = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

export const list = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.SORTABLE,
    defaultSort: 'reversalDate',
    defaultDir: 'desc',
  });
  const { workflowState, grnId, purchaseOrderId } = req.query;
  return okList(res, await service.list({ ...q, workflowState, grnId, purchaseOrderId }));
});

export const get = asyncHandler(async (req, res) =>
  /*
   * F-10: the screen is told whether THIS user may approve THIS document, so
   * it never offers a button the server will refuse. It matters more here than
   * anywhere else: the person who raised the reversal is by definition the
   * person who noticed the mistake, so they are the likeliest reader of this
   * screen and the one who must not be offered the button.
   */
  ok(res, withApprovability('GRN_REVERSAL', await service.getById(req.params.id), req.auth)),
);

/**
 * Whether a receipt can be reversed, and what a reversal would undo.
 *
 * Read-only. The GRN screen calls it to decide whether to offer the action at
 * all, and to show the storeman what they are about to ask for.
 */
export const eligibility = asyncHandler(async (req, res) =>
  ok(res, await service.eligibility(req.params.grnId)),
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

/** Approves AND posts, in one transaction. See the service. */
export const approve = asyncHandler(async (req, res) =>
  ok(res, await service.approve(req.params.id, req.body, actor(req))),
);

export const reject = asyncHandler(async (req, res) =>
  ok(res, await service.reject(req.params.id, req.body, actor(req))),
);

export const cancel = asyncHandler(async (req, res) =>
  ok(res, await service.cancel(req.params.id, req.body, actor(req))),
);
