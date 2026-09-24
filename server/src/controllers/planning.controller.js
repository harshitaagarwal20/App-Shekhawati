import * as service from '../services/planning.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';
import { withApprovability } from '../utils/approvability.js';

const actor = (req) => req.auth.userId;
/** Approvals and submissions record a name, so they carry the whole identity. */
const signer = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

export const list = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: service.SORTABLE,
    defaultSort: 'planDate',
    defaultDir: 'desc',
  });
  const {
    status, approvalStatus, state, orderId, planDepartment, containerNo, planFrom, planTo,
  } = req.query;
  return okList(
    res,
    await service.list({
      ...q,
      status,
      approvalStatus,
      state,
      orderId,
      planDepartment,
      containerNo,
      planFrom,
      planTo,
    }),
  );
});

export const get = asyncHandler(async (req, res) =>
  // F-10: the screen is told whether THIS user may approve THIS document, so
  // it never offers a button the server will refuse.
  ok(res, withApprovability('PLANNING', await service.getById(req.params.id), req.auth)),
);

export const options = asyncHandler(async (req, res) =>
  ok(res, await service.options({ orderId: req.query.orderId, approvedOnly: req.query.approvedOnly })),
);

export const create = asyncHandler(async (req, res) =>
  ok(res, await service.create(req.body, actor(req)), 201),
);

export const update = asyncHandler(async (req, res) =>
  ok(res, await service.update(req.params.id, req.body, actor(req))),
);

export const setLines = asyncHandler(async (req, res) =>
  ok(res, await service.setLines(req.params.id, req.body.lines, actor(req))),
);

export const setLineStatus = asyncHandler(async (req, res) =>
  ok(res, await service.setLineStatus(req.params.id, req.params.lineId, req.body, actor(req))),
);

export const setStatus = asyncHandler(async (req, res) =>
  ok(res, await service.setStatus(req.params.id, req.body.status, actor(req))),
);

export const remove = asyncHandler(async (req, res) =>
  ok(res, await service.remove(req.params.id, actor(req))),
);

// --- Approval flow ---------------------------------------------------------

export const submit = asyncHandler(async (req, res) =>
  ok(res, await service.submit(req.params.id, req.body, signer(req))),
);

export const recall = asyncHandler(async (req, res) =>
  ok(res, await service.recall(req.params.id, req.body, signer(req))),
);

export const approve = asyncHandler(async (req, res) =>
  ok(res, await service.approve(req.params.id, req.body, signer(req))),
);

export const reject = asyncHandler(async (req, res) =>
  ok(res, await service.reject(req.params.id, req.body, signer(req))),
);

export const revise = asyncHandler(async (req, res) =>
  ok(res, await service.revise(req.params.id, req.body, signer(req))),
);

// --- Previews --------------------------------------------------------------

/**
 * What an order permits and what is already planned against it. The Planning
 * form calls this the moment an order is picked, so the ceiling is on screen
 * before the first deliverable size is typed.
 */
export const orderAllocation = asyncHandler(async (req, res) =>
  ok(
    res,
    await service.orderAllocation(req.params.orderId, { excludePlanId: req.query.excludePlanId }),
  ),
);

/**
 * Checks an unsaved grid. Runs the same ceiling code the save runs, so the
 * browser never has to work out - or be trusted with - the answer.
 */
export const previewAllocation = asyncHandler(async (req, res) =>
  ok(res, await service.previewAllocation(req.body)),
);
