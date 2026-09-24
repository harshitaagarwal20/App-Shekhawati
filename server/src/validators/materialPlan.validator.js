/**
 * C12 - input schemas for the raw material plan.
 *
 * ---------------------------------------------------------------------------
 *  THERE IS NO LINE SCHEMA, AND THAT IS THE POINT
 *
 *  A material plan's lines are not typed in. They are the Style BOM exploded
 *  through the one requirement calculation this application has, frozen onto
 *  the document at creation. A client cannot post a line, an item, a quantity,
 *  a wastage percentage or a unit - there is nowhere in these schemas to put
 *  one, so Zod strips every attempt before the service runs.
 *
 *  That is what makes the plan trustworthy. A quantity a planner could
 *  overtype would be a figure no other document in the system agrees with:
 *  the PO ceiling, the cutting challan and the order screen all read the same
 *  calculation, and only the Style Master can move it.
 *
 *  ALSO DELIBERATELY ABSENT: `planNo`, `version`, `workflowState`,
 *  `approvalStatus`, `orderQty`, `effectiveQty`, and every approval stamp.
 *  The number comes from the sequence, the version from the plan that came
 *  before, the quantities from the order, and the states and stamps from the
 *  approval engine.
 * ---------------------------------------------------------------------------
 */

import { z } from 'zod';
import { isoDate, listQuery, optionalText, requiredText, uuid } from './common.validator.js';


const statusApproval = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

const documentState = z.enum([
  'DRAFT',
  'SUBMITTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'POSTED',
  'COMPLETED',
  'REJECTED',
  'RECTIFICATION',
  'RESUBMITTED',
  'CANCELLED',
]);

/**
 * Raising a plan.
 *
 * The order is the whole input. Everything the plan will contain follows from
 * it - the style, the quantities, and the materials.
 */
export const createMaterialPlanSchema = z.object({
  orderId: uuid,
  /**
   * C13 - WHICH STYLE ON THE ORDER THIS PLAN IS FOR.
   *
   * Optional only because an order with exactly one line needs no choice made.
   * With several the service refuses rather than guessing, and hands back the
   * lines to choose from: silently planning one style and ignoring the rest is
   * the failure C13 exists to end.
   */
  orderLineId: uuid.optional(),
  planDate: isoDate.optional(),
  containerNo: optionalText(40),
  remarks: optionalText(2000),
});

/** Header only. The lines are the BOM's answer and are not editable here. */
export const updateMaterialPlanSchema = z.object({
  planDate: isoDate.optional(),
  containerNo: optionalText(40).nullable(),
  remarks: optionalText(2000).nullable(),
});

export const previewMaterialPlanSchema = z.object({
  orderId: uuid,
  orderLineId: uuid.optional(),
});

export const submitMaterialPlanSchema = z.object({
  submittedTo: optionalText(120),
  remarks: optionalText(2000),
});

export const approveMaterialPlanSchema = z.object({
  remarks: optionalText(2000),
});

export const rejectMaterialPlanSchema = z.object({
  reason: requiredText(2000, 'Rejection reason'),
});

export const cancelMaterialPlanSchema = z.object({
  reason: requiredText(2000, 'Cancellation reason'),
});

export const materialPlanListQuery = listQuery.extend({
  approvalStatus: statusApproval.optional(),
  workflowState: documentState.optional(),
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  containerNo: optionalText(40),
});
