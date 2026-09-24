/**
 * Planning validation.
 *
 * As with Buyer Order, these schemas accept ONLY what a human types. There is
 * deliberately no `plannedQty`, no `plannedCuttingPcs`, no `orderQty` and no
 * `styleNo` in any input schema: Zod strips unknown keys, so a client that
 * posts a total has it silently discarded before the service runs. Those values
 * are derived in planning.service.js from the lines and the linked order, and
 * nowhere else.
 */

import { z } from 'zod';
import { decimal, isoDate, listQuery, optionalText, uuid } from './common.validator.js';

const statusGeneral = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED']);
const planDepartment = z.enum(['CUTTING', 'STITCHING', 'SHIPPING', 'PACKING', 'IRON']);

export const planListQuery = listQuery.extend({
  status: statusGeneral.optional(),
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  /** DRAFT and SUBMITTED both sit at approvalStatus PENDING; this splits them. */
  state: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
  orderId: uuid.optional(),
  planDepartment: planDepartment.optional(),
  containerNo: z.string().trim().max(40).optional(),
  planFrom: isoDate.optional(),
  planTo: isoDate.optional(),
});

/**
 * One allotment row of the grid.
 *
 * Excel: Date / Unit / Deliverable Size / Cutting Pcs alloted / Status / Remark.
 * `lineNo` is not accepted - the service numbers the rows in date order so the
 * grid always reads like the sheet.
 */
const planLine = z.object({
  /// Excel: "Date" (calendar open) - the day this quantity is due.
  lineDate: isoDate,
  /// Excel: "Unit" (Dropdown -> L_StitchingUnit), units 1-4.
  unit: optionalText(80),
  /// THE ROW'S ALLOTMENT IN PIECES - stitching, packing and dispatch.
  ///
  /// Optional here because a cutting plan has none; the service requires it for
  /// the three departments that do, and refuses it on the one that does not.
  /// The ORDER quantity is not entered on a line at all - it is read from the
  /// order and shown once.
  deliverableSize: decimal('Allotted pieces', { min: 0, allowZero: false }).nullish(),
  /// Excel: "Cutting Pcs alloted" (Manual). Never more than the deliverable size.
  /// CUTTING. The fabric to be issued to this unit on this date; what is handed
  /// to a cutting floor is cloth, and what comes back is panels.
  fabricQty: decimal('Fabric to issue', { min: 0 }).nullish(),
  /// L_UOM, required whenever fabricQty is given.
  fabricUom: optionalText(20),
  /// Excel: "Status" (Auto -> L_StatusGeneral)
  status: statusGeneral.optional(),
  /// Excel: "Remark" (Text)
  remark: optionalText(2000),
});

/** At least one row - a plan that allots nothing is not a plan. */
const planLines = z
  .array(planLine)
  .min(1, 'A plan needs at least one allotment line')
  .max(400, 'A plan cannot hold more than 400 allotment lines');

const planHeader = z.object({
  /// Excel: "Order No" (Dropdown -> Order).
  orderId: uuid,
  /// WHICH STYLE OF THAT ORDER this plan is for.
  ///
  /// An order carries a line per style / colour / size, and planning is done
  /// style by style, so a plan names the line it covers. Style No and Order Qty
  /// follow the LINE, not the order header - which on a multi-style order names
  /// only the first style and carries every style's quantity.
  orderLineId: uuid,
  /// Excel: "Planning Department" (Dropdown -> L_PlanDept)
  planDepartment,
  /// Excel: "Container No" (Manual / Dropdown -> L_ContainerNo)
  containerNo: optionalText(40),
  /// Excel: "Date" on the flat Planning sheet (Auto) - defaults to today.
  planDate: isoDate.optional(),
  /// Excel: "Remarks" (Text)
  remarks: optionalText(2000),
});

export const createPlanSchema = planHeader.extend({ lines: planLines });

/**
 * Every field optional on edit; the service decides what may actually move.
 * When `lines` is present the whole grid is replaced.
 */
export const updatePlanSchema = planHeader
  .partial()
  .extend({ lines: planLines.optional() })
  // Both are fixed once the plan exists: a plan belongs to its order, and to
  // the one style of that order it was raised for. Moving a plan to another
  // style would silently re-measure every quantity on it against a different
  // ceiling - that is a new plan, not an edit.
  .omit({ orderId: true, orderLineId: true });

/** Replaces the allotment grid on its own. */
export const setLinesSchema = z.object({ lines: planLines });

/** The floor reporting a day done. Quantities are untouched, so no re-check. */
export const setLineStatusSchema = z
  .object({
    status: statusGeneral.optional(),
    remark: optionalText(2000),
  })
  .refine((d) => d.status !== undefined || d.remark !== undefined, {
    message: 'Give a status or a remark to change',
  });

export const setPlanStatusSchema = z.object({ status: statusGeneral });

// --- Approval flow ---------------------------------------------------------

/**
 * Excel: "Submitted To" (-> L_AuthorisedBy), e.g. "Dinesh Sir".
 *
 * OPTIONAL, because the screen no longer asks. Every plan goes to the same
 * place - see DEFAULT_APPROVER in planning.service.js - and making the
 * planner pick that one destination from a dropdown was a question with one
 * real answer. It stays accepted rather than removed: the field is on the
 * Excel sheet and in the approval record, and an API caller that names a
 * recipient explicitly is still honoured and still validated against
 * L_AuthorisedBy.
 */
export const submitPlanSchema = z.object({
  submittedTo: z.string().trim().min(1).max(120).optional(),
  remarks: optionalText(2000),
});

export const recallPlanSchema = z.object({
  reason: z.string().trim().min(3, 'A recall needs a reason').max(2000),
});

export const approvePlanSchema = z.object({
  remarks: optionalText(2000),
});

export const rejectPlanSchema = z.object({
  /// Excel: "Rejection Reason"
  reason: z.string().trim().min(3, 'A rejection needs a reason').max(2000),
  /// Excel: "Rectification Remarks", e.g. "Shift 1500 pcs to Unit 4".
  rectification: optionalText(2000),
});

export const revisePlanSchema = z.object({
  remarks: optionalText(2000),
});

// --- Previews --------------------------------------------------------------

/** What an order permits, for the form's header panel. */
export const orderAllocationQuery = z.object({
  excludePlanId: uuid.optional(),
});

/**
 * Checks an unsaved grid against the order ceiling. Same code path as the save,
 * so the answer the planner sees while typing is the answer they will get.
 */
export const previewAllocationSchema = z.object({
  orderId: uuid,
  orderLineId: uuid,
  /* The department decides which column a line carries and whether the plan is
     measured against the order at all, so the preview has to know it. */
  planDepartment: planDepartment.optional(),
  lines: z.array(planLine).max(400).default([]),
});

export const planOptionsQuery = z.object({
  orderId: uuid.optional(),
  approvedOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const lineParams = z.object({ id: uuid, lineId: uuid });
