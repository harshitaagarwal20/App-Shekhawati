/**
 * Routes for Fabric Issue, Job Work, Fabric Scrutiny, Plan Approval, Cutting
 * Issue, the excess engine and the approval engine.
 *
 * REST throughout, and the same shape in every module:
 *
 *      GET    /api/<module>            list
 *      GET    /api/<module>/:id        one
 *      POST   /api/<module>            create
 *      PATCH  /api/<module>/:id        edit          (partial, hence PATCH)
 *      DELETE /api/<module>/:id        soft delete
 *      POST   /api/<module>/:id/<verb> the state changes - submit, approve,
 *                                      reject, post, finalise, rectify
 *
 * A state change is a POST to a named verb rather than a PATCH that sets a
 * status field, because "approve" is an act with rules and a trail, not a
 * column somebody assigns. That is also why no update schema in this system
 * contains a status.
 *
 * There is no business logic in this file. Every route is `can()` for
 * authorisation, `validate()` for shape, and one controller call.
 */

import { Router } from 'express';
import { z } from 'zod';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/production.controller.js';
import { idParam, uuid } from '../validators/common.validator.js';
// C5 - the cutting challan has its own validator module, like every other
// document of its size.
import {
  approveChallanSchema,
  cancelChallanSchema,
  challanListQuery,
  closeShortSchema,
  createCuttingChallanSchema,
  issuableLinesQuery,
  previewChallanSchema,
  rejectChallanSchema,
  submitChallanSchema,
  updateCuttingChallanSchema,
} from '../validators/cuttingChallan.validator.js';
import {
  amendScrutinySchema,
  approveExcessSchema,
  approvePlanApprovalSchema,
  assessExcessSchema,
  cancelCuttingIssueSchema,
  createCuttingIssueSchema,
  createExcessRuleSchema,
  createFabricIssueSchema,
  createJobWorkSchema,
  createPlanApprovalSchema,
  createScrutinySchema,
  cuttingIssueListQuery,
  excessApprovalListQuery,
  excessRuleListQuery,
  fabricIssueListQuery,
  finaliseScrutinySchema,
  jobWorkListQuery,
  jobWorkOptionsQuery,
  planApprovalListQuery,
  planApprovalOptionsQuery,
  postCuttingIssueSchema,
  previewCuttingIssueSchema,
  previewFabricIssueSchema,
  previewJobWorkReceiptSchema,
  previewJobWorkSchema,
  previewScrutinySchema,
  recallPlanApprovalSchema,
  approveJobWorkSchema,
  receiveJobWorkSchema,
  rectifyPlanApprovalSchema,
  rejectJobWorkSchema,
  submitJobWorkSchema,
  rejectExcessSchema,
  rejectPlanApprovalSchema,
  requestExcessSchema,
  rollOptionsQuery,
  scrutinyListQuery,
  setFabricIssueStatusSchema,
  setJobWorkStatusSchema,
  updateCuttingIssueSchema,
  updateExcessRuleSchema,
  updateFabricIssueSchema,
  updateJobWorkSchema,
  updatePlanApprovalSchema,
  updateScrutinySchema,
  stageDurationQuery,
  workflowParams,
  workflowQueueQuery,
} from '../validators/production.validator.js';

const orderIdParam = z.object({ orderId: uuid });

// ===========================================================================
//  12. FABRIC ISSUE  →  /api/fabric-issues
// ===========================================================================

export const fabricIssueRoutes = Router();

/** The roll picker. One call, everything a phone needs to render a list. */
fabricIssueRoutes.get(
  '/rolls',
  can('FABRIC_ISSUE.VIEW'),
  validate({ query: rollOptionsQuery }),
  c.rollOptions,
);

/** "Can I issue this much off this roll?" - before anything is saved. */
fabricIssueRoutes.post(
  '/preview',
  can('FABRIC_ISSUE.VIEW'),
  validate({ body: previewFabricIssueSchema }),
  c.previewFabricIssue,
);

fabricIssueRoutes.get(
  '/',
  can('FABRIC_ISSUE.VIEW'),
  validate({ query: fabricIssueListQuery }),
  c.listFabricIssues,
);

/**
 * Creating a fabric issue POSTS it: the issue and its stock ledger OUT are one
 * transaction. There is no draft state, because fabric that has left the rack
 * has left the rack.
 */
fabricIssueRoutes.post(
  '/',
  can('FABRIC_ISSUE.CREATE'),
  validate({ body: createFabricIssueSchema }),
  c.createFabricIssue,
);

fabricIssueRoutes.get('/:id', can('FABRIC_ISSUE.VIEW'), validate({ params: idParam }), c.getFabricIssue);

/** The challan that goes with the fabric to the job worker. */
fabricIssueRoutes.get(
  '/:id/print',
  can('FABRIC_ISSUE.EXPORT'),
  validate({ params: idParam }),
  c.printFabricIssue,
);

/** Descriptive fields only - the quantity is in the ledger and stays there. */
fabricIssueRoutes.patch(
  '/:id',
  can('FABRIC_ISSUE.EDIT'),
  validate({ params: idParam, body: updateFabricIssueSchema }),
  c.updateFabricIssue,
);

/** The fulfilment status, checked against the transition table. */
fabricIssueRoutes.post(
  '/:id/status',
  can('FABRIC_ISSUE.EDIT'),
  validate({ params: idParam, body: setFabricIssueStatusSchema }),
  c.setFabricIssueStatus,
);

fabricIssueRoutes.delete(
  '/:id',
  can('FABRIC_ISSUE.DELETE'),
  validate({ params: idParam }),
  c.removeFabricIssue,
);

// ===========================================================================
//  13. JOB WORK  →  /api/job-works
//
//  One register, four processes. The path says "job work" rather than "dye
//  issue" because that is what it is; the table keeps its Phase 0 name.
// ===========================================================================

export const jobWorkRoutes = Router();

/** The four processes with their vocabulary, so the UI labels each correctly. */
jobWorkRoutes.get('/processes', can('DYE_ISSUE.VIEW'), c.jobWorkProcesses);

jobWorkRoutes.get(
  '/options',
  can('DYE_ISSUE.VIEW'),
  validate({ query: jobWorkOptionsQuery }),
  c.jobWorkOptions,
);

jobWorkRoutes.post(
  '/preview',
  can('DYE_ISSUE.VIEW'),
  validate({ body: previewJobWorkSchema }),
  c.previewJobWork,
);

/** What a return of a given quantity would mean, before it is booked. */
jobWorkRoutes.post(
  '/preview-receipt',
  can('DYEING_RECEIPT.VIEW'),
  validate({ body: previewJobWorkReceiptSchema }),
  c.previewJobWorkReceipt,
);

jobWorkRoutes.get('/', can('DYE_ISSUE.VIEW'), validate({ query: jobWorkListQuery }), c.listJobWork);
jobWorkRoutes.post(
  '/',
  can('DYE_ISSUE.CREATE'),
  validate({ body: createJobWorkSchema }),
  c.createJobWork,
);

jobWorkRoutes.get('/:id', can('DYE_ISSUE.VIEW'), validate({ params: idParam }), c.getJobWork);
jobWorkRoutes.get('/:id/print', can('DYE_ISSUE.EXPORT'), validate({ params: idParam }), c.printJobWork);

jobWorkRoutes.patch(
  '/:id',
  can('DYE_ISSUE.EDIT'),
  validate({ params: idParam, body: updateJobWorkSchema }),
  c.updateJobWork,
);
/** The fulfilment status, checked against the transition table. */
jobWorkRoutes.post(
  '/:id/status',
  can('DYE_ISSUE.EDIT'),
  validate({ params: idParam, body: setJobWorkStatusSchema }),
  c.setJobWorkStatus,
);

jobWorkRoutes.delete(
  '/:id',
  can('DYE_ISSUE.DELETE'),
  validate({ params: idParam }),
  c.removeJobWork,
);

/**
 * Booking a return. Receipt, stock ledger IN, roll balance and stage, and the
 * job's running totals - one transaction.
 *
 * Behind DYEING_RECEIPT.CREATE rather than DYE_ISSUE.EDIT: receiving goods back
 * is the store's act, not the buyer's.
 */
jobWorkRoutes.post(
  '/:id/receive',
  can('DYEING_RECEIPT.CREATE'),
  validate({ params: idParam, body: receiveJobWorkSchema }),
  c.receiveJobWork,
);

// ===========================================================================
//  14. FABRIC SCRUTINY  →  /api/scrutinies
// ===========================================================================

export const scrutinyRoutes = Router();

/** The three decisions and what each does to the roll. */
scrutinyRoutes.get('/decisions', can('FABRIC_SCRUTINY.VIEW'), c.scrutinyDecisions);

scrutinyRoutes.post(
  '/preview',
  can('FABRIC_SCRUTINY.VIEW'),
  validate({ body: previewScrutinySchema }),
  c.previewScrutiny,
);

scrutinyRoutes.get(
  '/',
  can('FABRIC_SCRUTINY.VIEW'),
  validate({ query: scrutinyListQuery }),
  c.listScrutinies,
);

/** QC records a finding. It is not a ruling and the roll is untouched. */
scrutinyRoutes.post(
  '/',
  can('FABRIC_SCRUTINY.CREATE'),
  validate({ body: createScrutinySchema }),
  c.createScrutiny,
);

scrutinyRoutes.get('/:id', can('FABRIC_SCRUTINY.VIEW'), validate({ params: idParam }), c.getScrutiny);

scrutinyRoutes.patch(
  '/:id',
  can('FABRIC_SCRUTINY.EDIT'),
  validate({ params: idParam, body: updateScrutinySchema }),
  c.updateScrutiny,
);
scrutinyRoutes.delete(
  '/:id',
  can('FABRIC_SCRUTINY.DELETE'),
  validate({ params: idParam }),
  c.removeScrutiny,
);

/**
 * The decision, which LOCKS the record and moves the roll.
 *
 * QC records; the Director decides. So this sits behind
 * FABRIC_SCRUTINY.APPROVE, which the QC role deliberately does not hold - a
 * checker filling in a form at the inspection table must not be able to reject
 * a roll by accident.
 */
scrutinyRoutes.post(
  '/:id/finalise',
  can('FABRIC_SCRUTINY.APPROVE'),
  validate({ params: idParam, body: finaliseScrutinySchema }),
  c.finaliseScrutiny,
);

/** The only way a locked scrutiny changes - and it keeps the before/after set. */
scrutinyRoutes.post(
  '/:id/amend',
  can('FABRIC_SCRUTINY.APPROVE'),
  validate({ params: idParam, body: amendScrutinySchema }),
  c.amendScrutiny,
);

// ===========================================================================
//  15. PLAN APPROVAL  →  /api/plan-approvals
// ===========================================================================

export const planApprovalRoutes = Router();

planApprovalRoutes.get(
  '/options',
  can('PLAN_APPROVAL.VIEW'),
  validate({ query: planApprovalOptionsQuery }),
  c.planApprovalOptions,
);

/** The version history for one order, grouped by container. */
planApprovalRoutes.get(
  '/order/:orderId',
  can('PLAN_APPROVAL.VIEW'),
  validate({ params: orderIdParam }),
  c.planApprovalsForOrder,
);

planApprovalRoutes.get(
  '/',
  can('PLAN_APPROVAL.VIEW'),
  validate({ query: planApprovalListQuery }),
  c.listPlanApprovals,
);

/** Version 1. Every later version is raised by /rectify, never here. */
planApprovalRoutes.post(
  '/',
  can('PLAN_APPROVAL.CREATE'),
  validate({ body: createPlanApprovalSchema }),
  c.createPlanApproval,
);

planApprovalRoutes.get(
  '/:id',
  can('PLAN_APPROVAL.VIEW'),
  validate({ params: idParam }),
  c.getPlanApproval,
);

/** What the next version will be numbered, before it is raised. */
planApprovalRoutes.get(
  '/:id/next-version',
  can('PLAN_APPROVAL.VIEW'),
  validate({ params: idParam }),
  c.nextPlanVersion,
);

planApprovalRoutes.patch(
  '/:id',
  can('PLAN_APPROVAL.EDIT'),
  validate({ params: idParam, body: updatePlanApprovalSchema }),
  c.updatePlanApproval,
);
planApprovalRoutes.delete(
  '/:id',
  can('PLAN_APPROVAL.DELETE'),
  validate({ params: idParam }),
  c.removePlanApproval,
);

/** Approves AND locks, in one write. Immutable from that moment. */
planApprovalRoutes.post(
  '/:id/approve',
  can('PLAN_APPROVAL.APPROVE'),
  validate({ params: idParam, body: approvePlanApprovalSchema }),
  c.approvePlanApproval,
);
planApprovalRoutes.post(
  '/:id/reject',
  can('PLAN_APPROVAL.APPROVE'),
  validate({ params: idParam, body: rejectPlanApprovalSchema }),
  c.rejectPlanApproval,
);

/**
 * Rectifies a rejection by raising the NEXT version.
 *
 * Behind EDIT rather than APPROVE: correcting a rejected plan is the planner's
 * job, and deciding the corrected one is the Director's.
 */
planApprovalRoutes.post(
  '/:id/rectify',
  can('PLAN_APPROVAL.EDIT'),
  validate({ params: idParam, body: rectifyPlanApprovalSchema }),
  c.rectifyPlanApproval,
);

planApprovalRoutes.post(
  '/:id/recall',
  can('PLAN_APPROVAL.EDIT'),
  validate({ params: idParam, body: recallPlanApprovalSchema }),
  c.recallPlanApproval,
);

// ===========================================================================
//  16. CUTTING ISSUE  →  /api/cutting-issues     THE LAST MODULE
// ===========================================================================

export const cuttingIssueRoutes = Router();

/** The nine checks, described, for the UI to render as a checklist. */
cuttingIssueRoutes.get('/checklist', can('CUTTING_ISSUE.VIEW'), c.cuttingChecklist);

/** Runs the nine checks against a challan that has not been saved yet. */
cuttingIssueRoutes.post(
  '/preview',
  can('CUTTING_ISSUE.VIEW'),
  validate({ body: previewCuttingIssueSchema }),
  c.previewCuttingIssue,
);

cuttingIssueRoutes.get(
  '/',
  can('CUTTING_ISSUE.VIEW'),
  validate({ query: cuttingIssueListQuery }),
  c.listCuttingIssues,
);

/** Drafts a challan. Nothing is verified until it is posted. */
cuttingIssueRoutes.post(
  '/',
  can('CUTTING_ISSUE.CREATE'),
  validate({ body: createCuttingIssueSchema }),
  c.createCuttingIssue,
);

cuttingIssueRoutes.get(
  '/:id',
  can('CUTTING_ISSUE.VIEW'),
  validate({ params: idParam }),
  c.getCuttingIssue,
);
cuttingIssueRoutes.get(
  '/:id/print',
  can('CUTTING_ISSUE.EXPORT'),
  validate({ params: idParam }),
  c.printCuttingIssue,
);

cuttingIssueRoutes.patch(
  '/:id',
  can('CUTTING_ISSUE.EDIT'),
  validate({ params: idParam, body: updateCuttingIssueSchema }),
  c.updateCuttingIssue,
);
cuttingIssueRoutes.delete(
  '/:id',
  can('CUTTING_ISSUE.DELETE'),
  validate({ params: idParam }),
  c.removeCuttingIssue,
);

/**
 * POST THE CHALLAN. The cloth is cut.
 *
 * All nine checks run again inside the transaction, any excess authorisation is
 * spent, and the document locks permanently. Behind CUTTING_ISSUE.APPROVE
 * rather than EDIT, because this is the point of no return in the whole
 * application and it deserves the same authority as an approval.
 */
cuttingIssueRoutes.post(
  '/:id/post',
  can('CUTTING_ISSUE.APPROVE'),
  validate({ params: idParam, body: postCuttingIssueSchema }),
  c.postCuttingIssue,
);

cuttingIssueRoutes.post(
  '/:id/cancel',
  can('CUTTING_ISSUE.APPROVE'),
  validate({ params: idParam, body: cancelCuttingIssueSchema }),
  c.cancelCuttingIssue,
);

// ===========================================================================
//  17. EXCESS  →  /api/excess
// ===========================================================================

export const excessRoutes = Router();

/** The scopes and their precedence, so the rules screen can explain itself. */
excessRoutes.get('/scopes', can('REPORT.VIEW'), c.excessScopes);

/**
 * Measures a quantity against its configured threshold without saving.
 *
 * Open to anyone who can see a report: knowing what the permitted quantity IS
 * is not a privilege, and every module's form calls this.
 */
excessRoutes.post('/assess', can('REPORT.VIEW'), validate({ body: assessExcessSchema }), c.assessExcess);

// --- The rules themselves --------------------------------------------------

excessRoutes.get(
  '/rules',
  can('MASTER_LIST.VIEW'),
  validate({ query: excessRuleListQuery }),
  c.listExcessRules,
);

/**
 * Changing a threshold is a MASTER_LIST act, not a transaction one.
 *
 * It is configuration - the same kind of thing as adding a colour to a
 * dropdown - and it belongs to Head Office, who own the masters, rather than to
 * the store that would benefit from a looser limit.
 */
excessRoutes.post(
  '/rules',
  can('MASTER_LIST.CREATE'),
  validate({ body: createExcessRuleSchema }),
  c.createExcessRule,
);
excessRoutes.patch(
  '/rules/:id',
  can('MASTER_LIST.EDIT'),
  validate({ params: idParam, body: updateExcessRuleSchema }),
  c.updateExcessRule,
);
excessRoutes.delete(
  '/rules/:id',
  can('MASTER_LIST.DELETE'),
  validate({ params: idParam }),
  c.removeExcessRule,
);

// --- The authorisations ----------------------------------------------------

excessRoutes.get(
  '/approvals',
  can('REPORT.VIEW'),
  validate({ query: excessApprovalListQuery }),
  c.listExcessApprovals,
);

excessRoutes.post(
  '/approvals',
  can('REPORT.VIEW'),
  validate({ body: requestExcessSchema }),
  c.requestExcess,
);

excessRoutes.get(
  '/approvals/:id',
  can('REPORT.VIEW'),
  validate({ params: idParam }),
  c.getExcessApproval,
);

/**
 * The decision on an excess request.
 *
 * BUYER_ORDER.APPROVE because the Order sheet's own note - "Approval from
 * dinesh sir" - is where the excess rule in this business comes from, and the
 * Director is the only role that holds it.
 */
excessRoutes.post(
  '/approvals/:id/approve',
  can('BUYER_ORDER.APPROVE'),
  validate({ params: idParam, body: approveExcessSchema }),
  c.approveExcess,
);
excessRoutes.post(
  '/approvals/:id/reject',
  can('BUYER_ORDER.APPROVE'),
  validate({ params: idParam, body: rejectExcessSchema }),
  c.rejectExcess,
);

// ===========================================================================
//  18. THE APPROVAL ENGINE  →  /api/workflow
// ===========================================================================

export const workflowRoutes = Router();

/** The whole state machine, for a screen to draw a progress trail from. */
workflowRoutes.get('/states', can('REPORT.VIEW'), c.workflowStates);

/** Everything waiting on a decision, across every module, in one list. */
workflowRoutes.get(
  '/queue',
  can('REPORT.VIEW'),
  validate({ query: workflowQueueQuery }),
  c.workflowQueue,
);

/** One document's position, its trail, and what it may do next. */
workflowRoutes.get(
  '/:documentType/:documentId',
  can('REPORT.VIEW'),
  validate({ params: workflowParams }),
  c.workflowStatus,
);

// ===========================================================================
//  C3 - JOB WORK APPROVAL
// ===========================================================================
//
//  A state change is a POST to a named verb, not a PATCH that sets a column -
//  the same shape every other module in this file uses. "Approve" is an act
//  with rules and a trail, not a field somebody assigns.

jobWorkRoutes.post(
  '/:id/submit',
  can('DYE_ISSUE.EDIT'),
  validate({ params: idParam, body: submitJobWorkSchema }),
  c.submitJobWork,
);

jobWorkRoutes.post(
  '/:id/approve',
  can('DYE_ISSUE.APPROVE'),
  validate({ params: idParam, body: approveJobWorkSchema }),
  c.approveJobWork,
);

jobWorkRoutes.post(
  '/:id/reject',
  can('DYE_ISSUE.APPROVE'),
  validate({ params: idParam, body: rejectJobWorkSchema }),
  c.rejectJobWork,
);

// ===========================================================================
//  C5 - CUTTING CHALLAN
// ===========================================================================

export const cuttingChallanRoutes = Router();

/**
 * The lines a fabric issue may be raised against, right now.
 *
 * Before /:id, or Express reads "issuable-lines" as an id.
 */
cuttingChallanRoutes.get(
  '/issuable-lines',
  can('FABRIC_ISSUE.VIEW'),
  validate({ query: issuableLinesQuery }),
  c.issuableChallanLines,
);

cuttingChallanRoutes.post(
  '/preview',
  can('CUTTING_CHALLAN.VIEW'),
  validate({ body: previewChallanSchema }),
  c.previewCuttingChallan,
);

cuttingChallanRoutes.get(
  '/',
  can('CUTTING_CHALLAN.VIEW'),
  validate({ query: challanListQuery }),
  c.listCuttingChallans,
);

cuttingChallanRoutes.post(
  '/',
  can('CUTTING_CHALLAN.CREATE'),
  validate({ body: createCuttingChallanSchema }),
  c.createCuttingChallan,
);

cuttingChallanRoutes.get(
  '/:id',
  can('CUTTING_CHALLAN.VIEW'),
  validate({ params: idParam }),
  c.getCuttingChallan,
);

cuttingChallanRoutes.patch(
  '/:id',
  can('CUTTING_CHALLAN.EDIT'),
  validate({ params: idParam, body: updateCuttingChallanSchema }),
  c.updateCuttingChallan,
);

cuttingChallanRoutes.delete(
  '/:id',
  can('CUTTING_CHALLAN.DELETE'),
  validate({ params: idParam }),
  c.deleteCuttingChallan,
);

cuttingChallanRoutes.post(
  '/:id/submit',
  can('CUTTING_CHALLAN.EDIT'),
  validate({ params: idParam, body: submitChallanSchema }),
  c.submitCuttingChallan,
);

cuttingChallanRoutes.post(
  '/:id/approve',
  can('CUTTING_CHALLAN.APPROVE'),
  validate({ params: idParam, body: approveChallanSchema }),
  c.approveCuttingChallan,
);

cuttingChallanRoutes.post(
  '/:id/reject',
  can('CUTTING_CHALLAN.APPROVE'),
  validate({ params: idParam, body: rejectChallanSchema }),
  c.rejectCuttingChallan,
);

/**
 * C5 - closing short. Behind APPROVE, not EDIT: abandoning an outstanding
 * requirement is a decision, not a correction.
 */
cuttingChallanRoutes.post(
  '/:id/close-short',
  can('CUTTING_CHALLAN.APPROVE'),
  validate({ params: idParam, body: closeShortSchema }),
  c.closeCuttingChallanShort,
);

cuttingChallanRoutes.post(
  '/:id/cancel',
  can('CUTTING_CHALLAN.APPROVE'),
  validate({ params: idParam, body: cancelChallanSchema }),
  c.cancelCuttingChallan,
);

// ===========================================================================
//  C8 - STAGE TIMING
// ===========================================================================
//
//  Hung off the workflow router because that is where the approval engine
//  already lives, and stage events ARE the approval engine's output. Read-only
//  and behind REPORT.VIEW, like the rest of the workflow endpoints.

workflowRoutes.get(
  '/stage-durations',
  can('REPORT.VIEW'),
  validate({ query: stageDurationQuery }),
  c.stageDurationSummary,
);

workflowRoutes.get(
  '/:documentType/:documentId/stage-events',
  can('REPORT.VIEW'),
  validate({ params: workflowParams }),
  c.documentStageEvents,
);
