/**
 * Controllers for the shop-floor modules: Fabric Issue, Job Work, Fabric
 * Scrutiny, Plan Approval, Cutting Issue, the excess engine and the approval
 * engine.
 *
 * These are thin, on purpose. A controller here reads the request, calls one
 * service function and shapes the response - there is no business logic in this
 * file and none in the route definitions either. Every rule lives in a service,
 * which is what lets the same rule be called from a preview, from a post, and
 * from a test without being written three times.
 */

import * as fabricIssue from '../services/fabricIssue.service.js';
import * as jobWork from '../services/jobWork.service.js';
import * as scrutiny from '../services/fabricScrutiny.service.js';
import * as planApproval from '../services/planApproval.service.js';
import * as cuttingIssue from '../services/cuttingIssue.service.js';
import * as cuttingChallan from '../services/cuttingChallan.service.js';
import * as excess from '../services/excess.service.js';
import * as engine from '../services/approvalEngine.js';
import { asyncHandler, ok, okList, okListWithTotals, parseListQuery } from '../utils/http.js';
import { withApprovability } from '../utils/approvability.js';

const actor = (req) => req.auth.userId;
/** Anything that gets stamped with a name carries the whole identity. */
const who = (req) => ({ userId: req.auth.userId, fullName: req.auth.fullName });

// ===========================================================================
//  12. FABRIC ISSUE
// ===========================================================================

export const listFabricIssues = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: fabricIssue.SORTABLE,
    defaultSort: 'issueDate',
    defaultDir: 'desc',
  });
  const { purpose, status, orderId, styleId, rollId, vendorId, employeeId, dateFrom, dateTo } =
    req.query;
  return okListWithTotals(
    res,
    await fabricIssue.list({
      ...q,
      purpose,
      status,
      orderId,
      styleId,
      rollId,
      vendorId,
      employeeId,
      dateFrom,
      dateTo,
    }),
  );
});

export const getFabricIssue = asyncHandler(async (req, res) =>
  ok(res, await fabricIssue.getById(req.params.id)),
);

/** Issue and stock ledger OUT, in one transaction. 201, because it posted. */
export const createFabricIssue = asyncHandler(async (req, res) =>
  ok(res, await fabricIssue.create(req.body, who(req)), 201),
);

export const updateFabricIssue = asyncHandler(async (req, res) =>
  ok(res, await fabricIssue.update(req.params.id, req.body, actor(req))),
);

export const removeFabricIssue = asyncHandler(async (req, res) =>
  ok(res, await fabricIssue.remove(req.params.id, actor(req))),
);

/** Moves a fabric issue's fulfilment status, through the transition table. */
export const setFabricIssueStatus = asyncHandler(async (req, res) =>
  ok(res, await fabricIssue.setStatus(req.params.id, req.body, actor(req))),
);

/** "Can I issue this much off this roll?" - the shop floor's real question. */
export const printFabricIssue = asyncHandler(async (req, res) =>
  ok(res, await fabricIssue.printView(req.params.id)),
);

export const previewFabricIssue = asyncHandler(async (req, res) =>
  ok(res, await fabricIssue.preview(req.body)),
);

/** The roll picker: one call, everything a phone needs to render a list. */
export const rollOptions = asyncHandler(async (req, res) =>
  ok(res, await fabricIssue.rollOptions(req.query)),
);

// ===========================================================================
//  13. JOB WORK
// ===========================================================================

export const listJobWork = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: jobWork.SORTABLE,
    defaultSort: 'issueDate',
    defaultDir: 'desc',
  });
  const {
    process, status, vendorId, orderId, styleId, rollId, fabricStage,
    dateFrom, dateTo, pendingReturn, breachesOnly,
  } = req.query;

  return okListWithTotals(
    res,
    await jobWork.list({
      ...q,
      process,
      status,
      vendorId,
      orderId,
      styleId,
      rollId,
      fabricStage,
      dateFrom,
      dateTo,
      pendingReturn,
      breachesOnly,
    }),
  );
});

export const getJobWork = asyncHandler(async (req, res) =>
  // F-10 - see utils/approvability.js
  ok(res, withApprovability('DYE_ISSUE', await jobWork.getById(req.params.id), req.auth)),
);

export const createJobWork = asyncHandler(async (req, res) =>
  ok(res, await jobWork.create(req.body, actor(req)), 201),
);

export const updateJobWork = asyncHandler(async (req, res) =>
  ok(res, await jobWork.update(req.params.id, req.body, actor(req))),
);

export const removeJobWork = asyncHandler(async (req, res) =>
  ok(res, await jobWork.remove(req.params.id, actor(req))),
);

/** Moves a job's fulfilment status by hand, through the transition table. */
export const setJobWorkStatus = asyncHandler(async (req, res) =>
  ok(res, await jobWork.setStatus(req.params.id, req.body, actor(req))),
);

/** Booking a return: receipt, ledger IN, roll and running totals, atomically. */
export const receiveJobWork = asyncHandler(async (req, res) =>
  ok(res, await jobWork.receive(req.params.id, req.body, who(req)), 201),
);

export const previewJobWork = asyncHandler(async (req, res) =>
  ok(res, await jobWork.preview(req.body)),
);

export const previewJobWorkReceipt = asyncHandler(async (req, res) =>
  ok(res, await jobWork.previewReceipt(req.body)),
);

export const printJobWork = asyncHandler(async (req, res) =>
  ok(res, await jobWork.printView(req.params.id)),
);

/**
 * The four processes with their vocabulary. The UI reads this so that a
 * printing job is never labelled as a dyeing job, whatever they share
 * underneath.
 */
export const jobWorkProcesses = asyncHandler(async (_req, res) => ok(res, jobWork.processes()));

export const jobWorkOptions = asyncHandler(async (req, res) =>
  ok(res, await jobWork.options(req.query)),
);

// ===========================================================================
//  14. FABRIC SCRUTINY
// ===========================================================================

export const listScrutinies = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: scrutiny.SORTABLE,
    defaultSort: 'scrutinyDate',
    defaultDir: 'desc',
  });
  const { decision, rollId, orderId, styleId, defectType, checkedBy, isLocked, dateFrom, dateTo } =
    req.query;

  return okListWithTotals(
    res,
    await scrutiny.list({
      ...q,
      decision,
      rollId,
      orderId,
      styleId,
      defectType,
      checkedBy,
      isLocked,
      dateFrom,
      dateTo,
    }),
  );
});

export const getScrutiny = asyncHandler(async (req, res) =>
  ok(res, await scrutiny.getById(req.params.id)),
);

export const createScrutiny = asyncHandler(async (req, res) =>
  ok(res, await scrutiny.create(req.body, actor(req)), 201),
);

export const updateScrutiny = asyncHandler(async (req, res) =>
  ok(res, await scrutiny.update(req.params.id, req.body, actor(req))),
);

export const removeScrutiny = asyncHandler(async (req, res) =>
  ok(res, await scrutiny.remove(req.params.id, actor(req))),
);

/** The decision, which locks the record. A one-way door. */
export const finaliseScrutiny = asyncHandler(async (req, res) =>
  ok(res, await scrutiny.finalise(req.params.id, req.body, who(req))),
);

/** The only way a locked scrutiny changes - and it keeps the before/after set. */
export const amendScrutiny = asyncHandler(async (req, res) =>
  ok(res, await scrutiny.amend(req.params.id, req.body, who(req))),
);

export const previewScrutiny = asyncHandler(async (req, res) =>
  ok(res, await scrutiny.preview(req.body)),
);

/** The three decisions and what each does to the roll. */
export const scrutinyDecisions = asyncHandler(async (_req, res) => ok(res, scrutiny.decisions()));

// ===========================================================================
//  15. PLAN APPROVAL
// ===========================================================================

export const listPlanApprovals = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: planApproval.SORTABLE,
    defaultSort: 'submittedDate',
    defaultDir: 'desc',
  });
  const {
    approvalStatus, orderId, planningId, containerNo, isLocked,
    latestOnly, awaitingRectification, dateFrom, dateTo,
  } = req.query;

  return okList(
    res,
    await planApproval.list({
      ...q,
      approvalStatus,
      orderId,
      planningId,
      containerNo,
      isLocked,
      latestOnly,
      awaitingRectification,
      dateFrom,
      dateTo,
    }),
  );
});

export const getPlanApproval = asyncHandler(async (req, res) =>
  // F-10 - see utils/approvability.js
  ok(res, withApprovability('PLAN_APPROVAL', await planApproval.getById(req.params.id), req.auth)),
);

/** Version 1. Every later version is raised by rectify(), never here. */
export const createPlanApproval = asyncHandler(async (req, res) =>
  ok(res, await planApproval.create(req.body, actor(req)), 201),
);

export const updatePlanApproval = asyncHandler(async (req, res) =>
  ok(res, await planApproval.update(req.params.id, req.body, actor(req))),
);

export const removePlanApproval = asyncHandler(async (req, res) =>
  ok(res, await planApproval.remove(req.params.id, actor(req))),
);

/** Approves AND locks, in one write. There is no window between the two. */
export const approvePlanApproval = asyncHandler(async (req, res) =>
  ok(res, await planApproval.approve(req.params.id, req.body, who(req))),
);

export const rejectPlanApproval = asyncHandler(async (req, res) =>
  ok(res, await planApproval.reject(req.params.id, req.body, who(req))),
);

/** Raises the NEXT version and locks the rejected one. 201 - a new document. */
export const rectifyPlanApproval = asyncHandler(async (req, res) =>
  ok(res, await planApproval.rectify(req.params.id, req.body, who(req)), 201),
);

export const recallPlanApproval = asyncHandler(async (req, res) =>
  ok(res, await planApproval.recall(req.params.id, req.body, who(req))),
);

/** The version history for one order, grouped by container. */
export const planApprovalsForOrder = asyncHandler(async (req, res) =>
  ok(res, await planApproval.forOrder(req.params.orderId)),
);

/** What the next version will be numbered, before it is raised. */
export const nextPlanVersion = asyncHandler(async (req, res) =>
  ok(res, await planApproval.nextVersionFor(req.params.id)),
);

export const planApprovalOptions = asyncHandler(async (req, res) =>
  ok(res, await planApproval.options(req.query)),
);

// ===========================================================================
//  16. CUTTING ISSUE
// ===========================================================================

export const listCuttingIssues = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: cuttingIssue.SORTABLE,
    defaultSort: 'issueDate',
    defaultDir: 'desc',
  });
  const {
    status, orderId, styleId, firmName, containerNo, planApprovalId, isLocked,
    dateFrom, dateTo,
  } = req.query;

  return okListWithTotals(
    res,
    await cuttingIssue.list({
      ...q,
      status,
      orderId,
      styleId,
      firmName,
      containerNo,
      planApprovalId,
      isLocked,
      dateFrom,
      dateTo,
    }),
  );
});

export const getCuttingIssue = asyncHandler(async (req, res) =>
  ok(res, await cuttingIssue.getById(req.params.id)),
);

/** Drafts a challan. Not verified yet - the verification rides along with it. */
export const createCuttingIssue = asyncHandler(async (req, res) =>
  ok(res, await cuttingIssue.create(req.body, actor(req)), 201),
);

export const updateCuttingIssue = asyncHandler(async (req, res) =>
  ok(res, await cuttingIssue.update(req.params.id, req.body, actor(req))),
);

export const removeCuttingIssue = asyncHandler(async (req, res) =>
  ok(res, await cuttingIssue.remove(req.params.id, actor(req))),
);

/**
 * Posts the challan. The cloth is cut.
 *
 * All nine checks run again inside the transaction, the excess authorisation is
 * spent, and the document locks. There is no unpost.
 */
export const postCuttingIssue = asyncHandler(async (req, res) =>
  ok(res, await cuttingIssue.post(req.params.id, req.body, who(req))),
);

export const cancelCuttingIssue = asyncHandler(async (req, res) =>
  ok(res, await cuttingIssue.cancel(req.params.id, req.body, who(req))),
);

/** The nine checks, run against a challan that has not been saved yet. */
export const previewCuttingIssue = asyncHandler(async (req, res) =>
  ok(res, await cuttingIssue.preview(req.body)),
);

export const printCuttingIssue = asyncHandler(async (req, res) =>
  ok(res, await cuttingIssue.printView(req.params.id)),
);

/** The nine checks, described, for the UI to render as a checklist. */
export const cuttingChecklist = asyncHandler(async (_req, res) =>
  ok(res, cuttingIssue.checklist()),
);

// ===========================================================================
//  17. EXCESS RULES AND AUTHORISATIONS
// ===========================================================================

export const listExcessRules = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: excess.RULE_SORTABLE,
    defaultSort: 'priority',
    defaultDir: 'desc',
  });
  const { scope, documentType, isActive } = req.query;
  return okList(res, await excess.listRules({ ...q, scope, documentType, isActive }));
});

export const createExcessRule = asyncHandler(async (req, res) =>
  ok(res, await excess.createRule(req.body, actor(req)), 201),
);

export const updateExcessRule = asyncHandler(async (req, res) =>
  ok(res, await excess.updateRule(req.params.id, req.body, actor(req))),
);

export const removeExcessRule = asyncHandler(async (req, res) =>
  ok(res, await excess.removeRule(req.params.id, actor(req))),
);

/** The scopes and their precedence, so the rules screen can explain itself. */
export const excessScopes = asyncHandler(async (_req, res) => ok(res, excess.scopes()));

/**
 * Measures a quantity against its configured threshold, without saving.
 *
 * Returns all nine figures the brief asks to be identified: base quantity,
 * permitted percentage, permitted quantity, actual excess, excess percentage,
 * and the verdict that decides whether an authorisation is needed.
 */
export const assessExcess = asyncHandler(async (req, res) => ok(res, await excess.assess(req.body)));

export const listExcessApprovals = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: excess.APPROVAL_SORTABLE,
    defaultSort: 'requestedAt',
    defaultDir: 'desc',
  });
  const { status, documentType, orderId, pendingOnly } = req.query;
  return okList(res, await excess.listApprovals({ ...q, status, documentType, orderId, pendingOnly }));
});

export const getExcessApproval = asyncHandler(async (req, res) =>
  ok(res, await excess.getApproval(req.params.id)),
);

export const requestExcess = asyncHandler(async (req, res) =>
  ok(res, await excess.request(req.body, who(req)), 201),
);

export const approveExcess = asyncHandler(async (req, res) =>
  ok(res, await excess.approveRequest(req.params.id, req.body, who(req))),
);

export const rejectExcess = asyncHandler(async (req, res) =>
  ok(res, await excess.rejectRequest(req.params.id, req.body, who(req))),
);

// ===========================================================================
//  18. THE APPROVAL ENGINE
// ===========================================================================

/** The whole state machine, for a screen to draw a progress trail from. */
export const workflowStates = asyncHandler(async (_req, res) => ok(res, engine.describe()));

/** One document's workflow position, trail, and what it may do next. */
export const workflowStatus = asyncHandler(async (req, res) =>
  ok(res, await engine.statusOf(req.params.documentType, req.params.documentId)),
);

/**
 * Everything waiting on a decision, across every module, in one list.
 *
 * The Director is the last gate on orders, quotations, purchase orders, plans
 * and scrutinies. Without this they would open five screens to find out what is
 * waiting.
 */
export const workflowQueue = asyncHandler(async (req, res) =>
  ok(
    res,
    await engine.pendingQueue({
      documentTypes: req.query.documentTypes,
      limit: req.query.limit,
    }),
  ),
);

// ===========================================================================
//  C3 - JOB WORK APPROVAL   [A] of [A][S]
// ===========================================================================

export const submitJobWork = asyncHandler(async (req, res) =>
  ok(res, await jobWork.submitJob(req.params.id, req.body, who(req))),
);

export const approveJobWork = asyncHandler(async (req, res) =>
  ok(res, await jobWork.approveJob(req.params.id, req.body, who(req))),
);

export const rejectJobWork = asyncHandler(async (req, res) =>
  ok(res, await jobWork.rejectJob(req.params.id, req.body, who(req))),
);

// ===========================================================================
//  C5 - CUTTING CHALLAN
// ===========================================================================

export const listCuttingChallans = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, {
    sortable: cuttingChallan.SORTABLE,
    defaultSort: 'challanDate',
    defaultDir: 'desc',
  });
  const { status, orderId, styleId, planningId, containerNo, openOnly } = req.query;
  return okList(
    res,
    await cuttingChallan.list({ ...q, status, orderId, styleId, planningId, containerNo, openOnly }),
  );
});

export const getCuttingChallan = asyncHandler(async (req, res) =>
  // F-10: see utils/approvability.js
  ok(res, withApprovability('CUTTING_CHALLAN', await cuttingChallan.getById(req.params.id), req.auth)),
);

/** The printable cutting challan - the sheet the store draws materials against. */
export const printCuttingChallan = asyncHandler(async (req, res) =>
  ok(res, await cuttingChallan.printView(req.params.id)),
);

export const createCuttingChallan = asyncHandler(async (req, res) =>
  ok(res, await cuttingChallan.create(req.body, who(req)), 201),
);

export const updateCuttingChallan = asyncHandler(async (req, res) =>
  ok(res, await cuttingChallan.update(req.params.id, req.body, who(req))),
);

export const submitCuttingChallan = asyncHandler(async (req, res) =>
  ok(res, await cuttingChallan.submit(req.params.id, req.body, who(req))),
);

export const approveCuttingChallan = asyncHandler(async (req, res) =>
  ok(res, await cuttingChallan.approve(req.params.id, req.body, who(req))),
);

export const rejectCuttingChallan = asyncHandler(async (req, res) =>
  ok(res, await cuttingChallan.reject(req.params.id, req.body, who(req))),
);

/** C5 - abandoning the outstanding quantity, deliberately and on the record. */
export const closeCuttingChallanShort = asyncHandler(async (req, res) =>
  ok(res, await cuttingChallan.closeShort(req.params.id, req.body, who(req))),
);

export const cancelCuttingChallan = asyncHandler(async (req, res) =>
  ok(res, await cuttingChallan.cancel(req.params.id, req.body, who(req))),
);

export const deleteCuttingChallan = asyncHandler(async (req, res) =>
  ok(res, await cuttingChallan.remove(req.params.id, actor(req))),
);

/**
 * The challan lines a fabric issue may currently be raised against.
 *
 * Filtered to approved challans with something outstanding, so the Fabric
 * Issue form cannot offer a line the posting would refuse - a user shown an
 * option the server rejects learns to distrust the screen.
 */
export const issuableChallanLines = asyncHandler(async (req, res) =>
  ok(res, { rows: await cuttingChallan.issuableLines(req.query) }),
);

export const previewCuttingChallan = asyncHandler(async (req, res) =>
  ok(res, await cuttingChallan.preview(req.body)),
);

// ===========================================================================
//  C8 - STAGE TIMING
// ===========================================================================

/**
 * The transitions one document has been through, and how long each stage took.
 *
 * Read from the `document_stage_events` / `document_stage_durations` views,
 * which are derived from the approval trail the engine writes - so every
 * approval-enabled document has these whether or not its own module ever
 * thought about timing.
 */
export const documentStageEvents = asyncHandler(async (req, res) => {
  const { documentType, documentId } = req.params;
  const [events, durations] = await Promise.all([
    engine.stageEvents(documentType, documentId),
    engine.stageDurations(documentType, documentId),
  ]);
  return ok(res, { documentType, documentId, events, durations });
});

/** Average time in each stage, per document type - where the pipeline is slow. */
export const stageDurationSummary = asyncHandler(async (req, res) =>
  ok(res, await engine.stageDurationSummary(req.query)),
);
