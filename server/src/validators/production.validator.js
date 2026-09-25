/**
 * Validation for the shop-floor modules: Fabric Issue, Job Work, Fabric
 * Scrutiny, Plan Approval and Cutting Issue.
 *
 * ---------------------------------------------------------------------------
 *  WHAT IS DELIBERATELY ABSENT FROM EVERY SCHEMA BELOW
 *
 *  No `amount`, no `shrinkagePct`, no `variationPct`, no `receivedQty` running
 *  total, no `postedAt`, no `isLocked`, no `lockedAt`, no `workflowState`, no
 *  `round`, no `supersedesId`.
 *
 *  Zod strips unknown keys, so a client that posts any of them has the field
 *  discarded before the service runs. Every one of them is either a formula
 *  (computed in the service, backed by a CHECK constraint), a stamp (set inside
 *  the transaction that earned it), or a state (owned by approvalEngine.js).
 *
 *  Backend validation is the authority. The React forms mirror the required
 *  fields and the positive-quantity rules for the sake of the person typing,
 *  and nothing more rests on them.
 * ---------------------------------------------------------------------------
 */

import { z } from 'zod';
import { decimal, fraction, isoDate, listQuery, optionalText, requiredText, uuid } from './common.validator.js';

/**
 * An ISO date (YYYY-MM-DD) or a full timestamp.
 *
 * Dates arrive and are stored in UTC. DD-MM-YYYY is a DISPLAY format, applied
 * in Asia/Kolkata by the client's formatter - it is never a wire format, because
 * "03-04-2026" is ambiguous the moment it leaves this country.
 */

const statusGeneral = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED']);
const issuePurpose = z.enum([
  'CUTTING',
  'DYEING',
  'PRINTING',
  'STITCHING',
  'RETURN',
  'SAMPLING',
  'OTHER',
]);
/*
 * No WASHING. The company does not wash: every job work order ever raised is
 * DYEING or PRINTING. It was offered, never used, and each process on the list
 * is a vendor category, a roll stage and a location somebody has to keep true.
 * The JobWorkProcess enum in Postgres still carries it - removing a value from
 * a live enum buys nothing when no row references it.
 */
const jobProcess = z.enum(['DYEING', 'PRINTING', 'FINISHING']);
const fabricStage = z.enum(['BEFORE_STITCHING', 'AFTER_STITCHING']);
const scrutinyDecision = z.enum(['ACCEPT', 'REJECT', 'REWORK']);
const rollStage = z.enum([
  'RAW',
  'ISSUED_FOR_DYEING',
  'ISSUED_FOR_PRINTING',
  'DYED',
  'PRINTED',
  'SCRUTINY_HOLD',
  'ISSUED_TO_CUTTING',
  'CONSUMED',
  'REJECTED',
]);

const boolQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

const flagQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

// ===========================================================================
//  12. FABRIC ISSUE
// ===========================================================================

export const fabricIssueListQuery = listQuery.extend({
  purpose: issuePurpose.optional(),
  status: statusGeneral.optional(),
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  rollId: uuid.optional(),
  vendorId: uuid.optional(),
  employeeId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const createFabricIssueSchema = z.object({
  /// System document number (FI-001). Left blank, the server issues one.
  issueNo: optionalText(40),
  /// Excel: "Date" (Auto) - defaults to today.
  issueDate: isoDate.optional(),

  /// Excel: "Roll No" -> FabricRoll. The whole issue hangs off this.
  rollId: uuid,
  /// Excel: "Purpose" (Dropdown -> L_Purpose). Routes the roll onward.
  purpose: issuePurpose,
  /// Excel: "Order No" and "Style No".
  orderId: uuid,
  styleId: uuid.nullish(),
  /// The job worker, when purpose is Dyeing or Printing. Required for those -
  /// the service refuses without one, because the fabric is leaving the factory.
  vendorId: uuid.nullish(),

  /// Excel: "Name" - the person issuing, from Employee Master where possible.
  issuedByEmployeeId: uuid.nullish(),
  issuedByName: optionalText(120),

  /// Excel: "Fabric Qty Issued" (Manual). The one number the storeman types.
  fabricQtyIssued: decimal('Issue quantity', { min: 0, allowZero: false }),

  /**
   * C5 - THE APPROVED CUTTING CHALLAN LINE THIS ISSUE FULFILS.
   *
   * Optional HERE and required in the SERVICE. Two reasons: a RETURN is exempt
   * (it fulfils no requirement, it puts cloth back), and the refusal for a
   * missing one needs to explain the whole rule rather than say "required" -
   * which a schema-level error cannot do.
   */
  cuttingChallanLineId: uuid.nullish(),

  /// Excel: "Fabric name" and "Color Code" - attributes of the ROLL. Left
  /// blank they are copied from it rather than retyped on a phone.
  fabricName: optionalText(120),
  colorCode: optionalText(60),
  uom: optionalText(20),

  /// Which store the fabric comes out of (-> L_StockLocation).
  location: optionalText(80),
  /**
   * Only when this roll's shade or dye lot differs from the one the cutting
   * line was started on. The reason IS the override - without it the issue is
   * refused - and it is stored on the issue. See domain/shade.js.
   */
  shadeMixReason: optionalText(1000),
  /// Excel: "Remarks" (Text)
  remarks: optionalText(2000),
});

/**
 * Editing an issue.
 *
 * The quantity, the roll and the order are absent: they are in the stock
 * ledger, which is append-only. An issue keyed wrongly is corrected by a
 * return, not by editing what the ledger already recorded.
 */
export const updateFabricIssueSchema = z.object({
  issueDate: isoDate.optional(),
  fabricName: optionalText(120),
  colorCode: optionalText(60),
  // `status` moves through POST /fabric-issues/:id/status, checked against
  // the fulfilment transition table.
  remarks: optionalText(2000),
});

/** Moving a fabric issue's fulfilment status. */
export const setFabricIssueStatusSchema = z.object({
  status: statusGeneral,
  remarks: optionalText(2000),
});

/** "Can I issue this much off this roll?" - answered before anything is saved. */
export const previewFabricIssueSchema = z.object({
  rollId: uuid,
  fabricQtyIssued: decimal('Issue quantity', { min: 0 }).optional(),
  purpose: issuePurpose.optional(),
  location: optionalText(80),
  /// When given, the preview also says whether this roll matches the shade
  /// and dye lot the line was started on.
  cuttingChallanLineId: uuid.nullish(),
});

/** The roll picker: one call, everything a phone needs to render a list. */
export const rollOptionsQuery = z.object({
  orderId: uuid.optional(),
  colorCode: z.string().trim().max(60).optional(),
  stage: rollStage.optional(),
  location: z.string().trim().max(80).optional(),
  includeEmpty: flagQuery,
});

// ===========================================================================
//  13. JOB WORK  (Dyeing / Printing / Washing / Finishing)
// ===========================================================================

export const jobWorkListQuery = listQuery.extend({
  process: jobProcess.optional(),
  status: statusGeneral.optional(),
  vendorId: uuid.optional(),
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  rollId: uuid.optional(),
  fabricStage: fabricStage.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  /** Still at the vendor - the register's most-asked question. */
  pendingReturn: flagQuery,
  breachesOnly: flagQuery,
});

const jobWorkBody = z.object({
  /// Job number, per process: DY-001 for dyeing, PJ-001 for printing.
  dyeIssueNo: optionalText(40),
  issueDate: isoDate.optional(),

  /// WHICH OF THE FOUR. The register is shared; the process is what makes a
  /// transaction a dyeing job rather than a printing one, so it is required
  /// and never defaulted.
  process: jobProcess,

  rollId: uuid,
  vendorId: uuid,

  /// Fabric characteristics. Left blank they are copied from the roll.
  colourCode: optionalText(60),
  content: optionalText(80),
  count: optionalText(20),
  construction: optionalText(20),
  width: decimal('Width', { min: 0, allowZero: false }).nullish(),
  gsm: optionalText(20),

  /// Excel: "Address" / "Pin Code" - snapshotted from the vendor at issue time.
  address: optionalText(2000),
  pinCode: optionalText(12),

  qty: decimal('Quantity', { min: 0, allowZero: false }),
  uom: optionalText(20),
  rate: decimal('Rate', { min: 0 }),

  /// Before or after stitching.
  fabricStage: fabricStage.optional(),
  /// Excel: "Standard Shrinkage Allowed" - note on the sheet "2-3%".
  /// Left blank, the process's own default is used, which is itself a row in
  /// excess_rules rather than a constant.
  standardShrinkageAllowed: fraction('Standard shrinkage').nullish(),

  fabricIssueId: uuid.nullish(),
  orderId: uuid.nullish(),
  styleId: uuid.nullish(),
  remark: optionalText(2000),
});

export const createJobWorkSchema = jobWorkBody;
/**
 * Editing a job. `status` is absent: a job moves to COMPLETED when the last
 * of its fabric comes back, which the return endpoint works out - not when
 * somebody ticks a box. Moving it by hand goes through
 * POST /job-works/:id/status and is checked against the table.
 */
export const updateJobWorkSchema = jobWorkBody.partial();

/** Moving a job's fulfilment status by hand - putting one on hold, mostly. */
export const setJobWorkStatusSchema = z.object({
  status: statusGeneral,
  remarks: optionalText(2000),
});

/**
 * Booking a return from the job worker.
 *
 * `shrinkagePct` and `variationFlag` are absent: both are formulas, computed
 * from the two quantities in jobWork.service.js and nowhere else.
 */
export const receiveJobWorkSchema = z.object({
  receiptNo: optionalText(40),
  receiptDate: isoDate.optional(),
  qtyReceived: decimal('Received quantity', { min: 0, allowZero: false }),
  /// Where the returned fabric is being put back (-> L_StockLocation).
  location: optionalText(80),
  /// The receipt's OWN outcome, not a document status: the sheet's
  /// "OK / Sent to Scrutiny" column. Computed from the shrinkage by default;
  /// supplying it overrides that, which a store occasionally needs when the
  /// fabric is visibly wrong despite being within tolerance.
  status: z.enum(['OK', 'SENT_TO_SCRUTINY']).optional(),
  /**
   * C3 - THE EXCEPTION PATH for a shortfall beyond tolerance.
   *
   * A return that loses more than the agreed shrinkage BLOCKS. It is not
   * recorded quietly with a flag on the roll, because that is what happened
   * before and it let out-of-tolerance cloth reach the cutting floor.
   *
   * Setting this is the receiver stating, in the request, that this return is
   * going to a Fabric Checking Report. C4 then holds the fabric until the
   * report exists.
   */
  requireScrutiny: z.coerce.boolean().optional(),
  /// The job worker's lot number for this return - from their challan.
  dyeLot: optionalText(40),
  /// The shade band, if it was graded on arrival.
  shade: optionalText(20),
  remarks: optionalText(2000),
});

export const previewJobWorkSchema = z.object({
  process: jobProcess,
  rollId: uuid.optional(),
  /// C3 - the vendor, so the preview resolves the SAME shrinkage rule the
  /// posting will: a job worker held to its own number must be previewed by it.
  vendorId: uuid.optional(),
  qty: decimal('Quantity', { min: 0 }).optional(),
  rate: decimal('Rate', { min: 0 }).optional(),
  standardShrinkageAllowed: fraction('Standard shrinkage').nullish(),
});

export const previewJobWorkReceiptSchema = z.object({
  dyeIssueId: uuid,
  qtyReceived: decimal('Received quantity', { min: 0 }).optional(),
});

export const jobWorkOptionsQuery = z.object({
  process: jobProcess.optional(),
  vendorId: uuid.optional(),
  pendingReturnOnly: flagQuery,
});

// ===========================================================================
//  14. FABRIC SCRUTINY
// ===========================================================================

export const scrutinyListQuery = listQuery.extend({
  decision: scrutinyDecision.optional(),
  rollId: uuid.optional(),
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  defectType: z.string().trim().max(80).optional(),
  checkedBy: uuid.optional(),
  isLocked: boolQuery,
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

/**
 * C4 - one structured defect finding: which roll, how much, and what.
 *
 * The scrutiny header keeps its single `defectType` / `qtyAffected` pair -
 * that is what the workbook prints - and these are the detail behind it. A
 * REWORK or REJECT decision cannot be posted without at least one, enforced by
 * the service AND by the fabric_scrutinies_decision_needs_defects trigger.
 */
const scrutinyDefectSchema = z.object({
  lineNo: z.number().int().positive().optional(),
  /// The two families C4 names, plus OTHER so a real finding is never dropped
  /// for want of a box.
  category: z.enum(['DYEING', 'WEAVING', 'OTHER']),
  defectType: requiredText(80, 'Defect type'),
  /// Defaults to the scrutiny's own roll. A checking report routinely covers a
  /// lot, so each line may name its own.
  rollId: uuid.nullish(),
  qty: decimal('Defect quantity', { min: 0, allowZero: false }),
  uom: optionalText(20),
  remarks: optionalText(2000),
});

const scrutinyBody = z.object({
  scrutinyNo: optionalText(40),
  scrutinyDate: isoDate.optional(),
  rollId: uuid,
  orderId: uuid,
  styleId: uuid.nullish(),
  /// Excel: "Defect Type" (Dropdown -> L_DefectType)
  defectType: requiredText(80, 'Defect type'),
  /// Excel: "Qty Affected" (Manual)
  qtyAffected: decimal('Quantity affected', { min: 0, allowZero: false }),
  uom: optionalText(20),
  /// Excel: "Checked By" (Dropdown -> Employee Master)
  checkedByEmployeeId: uuid.nullish(),
  checkedByName: optionalText(120),
  /// Excel: "Authorised By" (Dropdown -> L_AuthorisedBy)
  authorisedBy: optionalText(120),
  /// A FINDING, not a ruling. It means nothing until finalise() is called, and
  /// the roll is untouched until then.
  decision: scrutinyDecision.optional(),
  /// C4 - the structured findings.
  defects: z.array(scrutinyDefectSchema).optional(),
  remarks: optionalText(2000),
});

export const createScrutinySchema = scrutinyBody;
export const updateScrutinySchema = scrutinyBody.partial();

/**
 * The decision, which LOCKS the record.
 *
 * A one-way door: after this only an amendment can change anything, and an
 * amendment keeps the before/after set.
 */
export const finaliseScrutinySchema = z.object({
  decision: scrutinyDecision,
  authorisedBy: optionalText(120),
  /**
   * C4 - findings may be added with the decision itself.
   *
   * A director looking at cloth and deciding to reject it should not have to
   * save a draft first in order to record why. Lines supplied here are written
   * BEFORE the header update, so the trigger that enforces "REWORK or REJECT
   * needs a finding" can see them.
   */
  defects: z.array(scrutinyDefectSchema).optional(),
  remarks: optionalText(2000),
});

/**
 * Amending a finalised scrutiny.
 *
 * `changes` is a field-level patch rather than a whole body, because an
 * amendment is a record of WHAT changed - the before/after set is what goes
 * into document_amendments, and a full body would not say which fields the
 * amender actually meant to touch.
 */
export const amendScrutinySchema = z.object({
  reason: z.string().trim().min(3, 'An amendment needs a reason').max(2000),
  changes: z
    .object({
      defectType: z.string().trim().max(80).optional(),
      qtyAffected: decimal('Quantity affected', { min: 0, allowZero: false }).optional(),
      decision: scrutinyDecision.optional(),
      authorisedBy: z.string().trim().max(120).optional(),
      checkedByName: z.string().trim().max(120).optional(),
      remarks: z.string().trim().max(2000).optional(),
    })
    .refine((c) => Object.keys(c).length > 0, 'An amendment has to change something'),
  remarks: optionalText(2000),
});

export const previewScrutinySchema = z.object({
  rollId: uuid,
  qtyAffected: decimal('Quantity affected', { min: 0 }).optional(),
  decision: scrutinyDecision.optional(),
});

// ===========================================================================
//  15. PLAN APPROVAL
// ===========================================================================

export const planApprovalListQuery = listQuery.extend({
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  orderId: uuid.optional(),
  planningId: uuid.optional(),
  containerNo: z.string().trim().max(40).optional(),
  isLocked: boolQuery,
  /** The current version only - nothing has superseded it. */
  latestOnly: flagQuery,
  /** Rejected, and nobody has picked it up yet. */
  awaitingRectification: flagQuery,
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

/**
 * Submitting VERSION 1.
 *
 * `round` and `supersedesId` are absent deliberately: version 1 replaces
 * nothing, and every later version is raised by rectify() - a version that does
 * not say what it replaces is not a version, it is a duplicate.
 */
/**
 * C7 - one plan type on one versioned Plan Approval header.
 *
 * PLANNING RECORDS ONLY. A STITCHING line states how many pieces are planned
 * to be stitched, at which unit, by when. Nothing in this system records work
 * done, there is no stitching execution table, no dispatch and no packing, and
 * prisma/verify-scope.js carries an explicit allowlist saying exactly that.
 */
const planApprovalLineSchema = z.object({
  planType: z.enum(['CUTTING', 'STITCHING', 'SHIPPING']),
  plannedQty: decimal('Planned quantity', { min: 0, allowZero: false }),
  uom: optionalText(20),
  plannedStart: isoDate.optional().nullable(),
  plannedEnd: isoDate.optional().nullable(),
  plannedUnit: optionalText(120),
  remarks: optionalText(2000),
});

export const createPlanApprovalSchema = z.object({
  approvalNo: optionalText(40),
  submittedDate: isoDate.optional(),
  orderId: uuid,
  /// C7 - plans are style-number-wise as well as container-wise. Defaulted
  /// from the order, which names exactly one style.
  styleId: uuid.nullish(),
  /// Excel: "Container No" (Auto -> L_ContainerNo)
  containerNo: optionalText(40),
  /// C7 - the three plans, presented together for one signature.
  plans: z.array(planApprovalLineSchema).max(3).optional(),
  /// Excel: "Prepared By", e.g. "Vinay ji (GM)"
  preparedBy: requiredText(120, 'Prepared by'),
  /// Excel: "Submitted To" (-> L_AuthorisedBy), e.g. "Dinesh Sir"
  submittedTo: requiredText(120, 'Submitted to'),
  planningId: uuid.nullish(),
  rectificationRemarks: optionalText(2000),
});

export const updatePlanApprovalSchema = z.object({
  submittedDate: isoDate.optional(),
  styleId: uuid.nullish(),
  containerNo: optionalText(40),
  preparedBy: z.string().trim().min(1).max(120).optional(),
  submittedTo: z.string().trim().min(1).max(120).optional(),
  planningId: uuid.nullish(),
  plans: z.array(planApprovalLineSchema).max(3).optional(),
  rectificationRemarks: optionalText(2000),
});

/**
 * C3 - the approval half of Job Work's [A][S].
 *
 * Approving does not move stock. The fabric moves when it is ISSUED against
 * the approved order, and that issue is what transitions this document to
 * POSTED - in the same transaction as the ledger legs.
 */
export const submitJobWorkSchema = z.object({
  submittedTo: optionalText(120),
  remarks: optionalText(2000),
});

export const approveJobWorkSchema = z.object({
  remarks: optionalText(2000),
});

export const rejectJobWorkSchema = z.object({
  reason: requiredText(2000, 'Rejection reason'),
});

export const approvePlanApprovalSchema = z.object({
  remarks: optionalText(2000),
});

export const rejectPlanApprovalSchema = z.object({
  reason: z.string().trim().min(3, 'A rejection needs a reason').max(2000),
  /// Excel: "Rectification Remarks" - what the GM is being asked to change.
  rectificationRemarks: optionalText(2000),
});

/**
 * Rectifying a rejected version by raising the next one.
 *
 * `rectificationRemarks` is REQUIRED here and optional everywhere else: it is
 * the answer to "what did you do about the rejection?", and a version that
 * cannot answer that is not a rectification.
 */
export const rectifyPlanApprovalSchema = z.object({
  approvalNo: optionalText(40),
  submittedDate: isoDate.optional(),
  styleId: uuid.nullish(),
  containerNo: optionalText(40),
  /**
   * C7 - the three plans on the successor version.
   *
   * Omit them and the rejected version's plans are carried forward. A
   * rectification usually changes one plan of the three, and forcing the
   * office to retype the other two is how the other two end up wrong.
   */
  plans: z.array(planApprovalLineSchema).max(3).optional(),
  preparedBy: optionalText(120),
  submittedTo: optionalText(120),
  planningId: uuid.nullish(),
  rectificationRemarks: z
    .string()
    .trim()
    .min(3, 'Say what was done about the rejection')
    .max(2000),
});

export const recallPlanApprovalSchema = z.object({
  reason: optionalText(2000),
});

export const planApprovalOptionsQuery = z.object({
  orderId: uuid.optional(),
  approvedOnly: flagQuery,
});

// ===========================================================================
//  16. CUTTING ISSUE  (the last module)
// ===========================================================================

export const cuttingIssueListQuery = listQuery.extend({
  status: statusGeneral.optional(),
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  firmName: z.string().trim().max(120).optional(),
  containerNo: z.string().trim().max(40).optional(),
  planApprovalId: uuid.optional(),
  isLocked: boolQuery,
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

const cuttingIssueBody = z.object({
  /// Excel: "Challan No" (Manual) - CH-001. Left blank, the server issues one.
  challanNo: optionalText(40),
  issueDate: isoDate.optional(),

  orderId: uuid,
  styleId: uuid.nullish(),

  /// Excel: "Planned Cutting" (Auto, from the approved plan).
  plannedCutting: decimal('Planned cutting', { min: 0 }).optional(),
  /// Excel: "Firm Name" (-> L_StitchingUnit) - the receiving unit. No longer
  /// asked for: the business does not track cutting by unit. Stored as '' when
  /// absent, since the column predates that and is NOT NULL.
  firmName: optionalText(120),
  /// Excel: "Unit wise Cutting Pcs to be issued" (Auto, from the plan).
  unitWiseCuttingPcsToBeIssued: decimal('Unit-wise pieces', { min: 0 }).optional(),
  /// Excel: "Cutting Pcs Issued" (Manual).
  cuttingPcsIssued: decimal('Good pieces issued to stitching', { min: 0 }),
  cuttingPcsDamaged: decimal('Cut pieces damaged', { min: 0 }).optional(),
  /// Excel: "Handle issued" (Manual). DERIVED from the style's panel list
  /// (pieces x handles per bag) when the style has one; typed only when not.
  handleIssued: decimal('Handle issued', { min: 0 }).optional(),

  /**
   * C6 - THE FABRIC EQUATION.
   *
  *     issuedQty = consumedQty + remainderQty + remnantQty + wastageQty + fabricDamageQty
   *
   * All four are optional HERE and all four are required to POST. A supervisor
   * fills these in as the count comes off the table, and refusing a
   * half-entered draft would stop them saving work in progress. The balance is
   * enforced by the REMAINDER_RECONCILES check at posting and by the
   * cutting_issues_remainder_reconciles CHECK constraint on every write.
   *
   * WASTAGE IS TYPED, NEVER INFERRED. Deriving it as the leftover would make
   * the equation balance by construction and check nothing at all.
   */
  issuedQty: decimal('Fabric issued to the cutting floor', { min: 0 }).optional(),
  consumedQty: decimal('Fabric consumed', { min: 0 }).optional(),
  remainderQty: decimal('Remainder returned', { min: 0 }).optional(),
  /** End-bits kept as remnants - booked back as a short roll at REMNANT STORE. */
  remnantQty: decimal('Remnants', { min: 0 }).optional(),
  wastageQty: decimal('Wastage', { min: 0 }).optional(),
  fabricDamageQty: decimal('Fabric damaged', { min: 0 }).optional(),
  fabricUom: optionalText(20),

  /// Excel: "Container No" (-> L_ContainerNo).
  containerNo: optionalText(40),
  remarks: optionalText(2000),

  /// The four documents the nine checks verify against.
  planningId: uuid.nullish(),
  planApprovalId: uuid.nullish(),
  fabricIssueId: uuid.nullish(),
  /// An approved excess authorisation, where the challan cuts more than the
  /// plan permits. Checks 8 and 9.
  excessApprovalId: uuid.nullish(),
});

export const createCuttingIssueSchema = cuttingIssueBody;
export const updateCuttingIssueSchema = cuttingIssueBody.partial();

/**
 * Posting the challan. The cloth is cut.
 *
 * Almost nothing to supply: everything that matters was already on the draft,
 * and re-supplying it here would let a supervisor post something other than
 * what the checks were run against.
 */
export const postCuttingIssueSchema = z.object({
  /// Lets an authorisation be attached at the moment of posting, if one was
  /// obtained after the draft was saved.
  excessApprovalId: uuid.nullish(),
  remarks: optionalText(2000),
});

export const cancelCuttingIssueSchema = z.object({
  reason: z.string().trim().min(3, 'A cancellation needs a reason').max(2000),
});

/** Runs the nine checks against a challan that has not been saved yet. */
export const previewCuttingIssueSchema = z.object({
  orderId: uuid,
  styleId: uuid.nullish(),
  planningId: uuid.nullish(),
  planApprovalId: uuid.nullish(),
  fabricIssueId: uuid.nullish(),
  excessApprovalId: uuid.nullish(),
  containerNo: optionalText(40),
  firmName: optionalText(120),
  unitWiseCuttingPcsToBeIssued: decimal('Unit-wise pieces', { min: 0 }).optional(),
  cuttingPcsIssued: decimal('Cutting pieces issued', { min: 0 }).optional(),
  excludeId: uuid.optional(),
});

// ===========================================================================
//  17. EXCESS RULES AND AUTHORISATIONS
// ===========================================================================

const excessScope = z.enum(['GLOBAL', 'DOCUMENT_TYPE', 'ITEM_CATEGORY', 'BUYER', 'ORDER']);
const documentType = z.enum([
  'BUYER',
  'VENDOR',
  'EMPLOYEE',
  'STYLE',
  'BUYER_ORDER',
  'PLANNING',
  'VENDOR_QUOTATION',
  'PURCHASE_ORDER',
  'GATE_PASS',
  'GRN',
  'FABRIC_ROLL',
  'INVENTORY_ITEM',
  'FABRIC_ISSUE',
  'DYE_ISSUE',
  'DYEING_RECEIPT',
  'PRINTING',
  'FABRIC_SCRUTINY',
  'PLAN_APPROVAL',
  'CUTTING_ISSUE',
]);

export const excessRuleListQuery = listQuery.extend({
  scope: excessScope.optional(),
  documentType: documentType.optional(),
  isActive: boolQuery,
});

const excessRuleBody = z.object({
  scope: excessScope,
  /// An order id, a buyer id, an item category, a DocumentType name. Empty for
  /// GLOBAL, which matches everything.
  scopeKey: optionalText(80),
  documentType: documentType.nullish(),
  /// THE THRESHOLD, as a fraction. 0.02 = 2%.
  excessPct: fraction('Permitted excess'),
  /// Past this, no authorisation can help - only a smaller quantity.
  hardCeilingPct: fraction('Hard ceiling').nullish(),
  requiresApproval: z.boolean().optional(),
  /// Why this number. Shown next to it so nobody has to guess where it came from.
  basis: optionalText(255),
  priority: z.coerce.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
  effectiveFrom: isoDate.nullish(),
  effectiveTo: isoDate.nullish(),
});

export const createExcessRuleSchema = excessRuleBody;
/** Scope and key identify WHICH rule this is, so neither may be edited. */
export const updateExcessRuleSchema = excessRuleBody.omit({
  scope: true,
  scopeKey: true,
  documentType: true,
}).partial();

/** Measures a quantity against its threshold without saving anything. */
export const assessExcessSchema = z.object({
  documentType,
  orderId: uuid.nullish(),
  buyerId: uuid.nullish(),
  itemCategory: optionalText(60),
  baseQty: decimal('Base quantity', { min: 0 }),
  actualQty: decimal('Actual quantity', { min: 0 }),
  uom: optionalText(20),
});

export const excessApprovalListQuery = listQuery.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  documentType: documentType.optional(),
  orderId: uuid.optional(),
  pendingOnly: flagQuery,
});

/** Raising an authorisation request. All nine figures are computed, not sent. */
export const requestExcessSchema = z.object({
  documentType,
  documentId: uuid.nullish(),
  documentNo: optionalText(60),
  orderId: uuid.nullish(),
  buyerId: uuid.nullish(),
  itemCategory: optionalText(60),
  baseQty: decimal('Base quantity', { min: 0 }),
  actualQty: decimal('Actual quantity', { min: 0, allowZero: false }),
  uom: optionalText(20),
  reason: z.string().trim().min(3, 'An excess request needs a reason').max(2000),
});

export const approveExcessSchema = z.object({
  remarks: optionalText(2000),
});

export const rejectExcessSchema = z.object({
  reason: z.string().trim().min(3, 'A rejection needs a reason').max(2000),
});

// ===========================================================================
//  18. THE APPROVAL ENGINE
// ===========================================================================

export const workflowQueueQuery = z.object({
  documentTypes: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

/**
 * C8 - the stage-duration report's filter.
 *
 * Every field optional: the most-asked version of this question is "where is
 * the pipeline slow", which takes no filter at all.
 */
export const stageDurationQuery = z.object({
  documentType: z.string().trim().max(40).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const workflowParams = z.object({
  documentType,
  documentId: uuid,
});
