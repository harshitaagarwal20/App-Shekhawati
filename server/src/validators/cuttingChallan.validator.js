/**
 * C5 - input schemas for the cutting challan.
 *
 * ---------------------------------------------------------------------------
 *  WHAT IS DELIBERATELY ABSENT
 *
 *  No `issuedQty`, no `status`, no `workflowState`, no `closedShortAt`, no
 *  `computedRequirementQty`.
 *
 *  `issuedQty` is RE-DERIVED from the fabric issues that quote each line, in
 *  the transaction that posts them. `computedRequirementQty` comes from the
 *  shared requirement calculation and is frozen at creation. The rest are
 *  states and stamps owned by the approval engine and by the service. Zod
 *  strips unknown keys, so a client that posts any of them has it discarded
 *  before the service runs.
 * ---------------------------------------------------------------------------
 */

import { z } from 'zod';
import { decimal, isoDate, listQuery, optionalText, requiredText, uuid } from './common.validator.js';


const statusGeneral = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED']);

const challanLineSchema = z.object({
  lineNo: z.number().int().positive().optional(),
  itemCategory: requiredText(60, 'Item category'),
  subCategory: optionalText(60),
  accessoriesItem: optionalText(80),
  colorCode: optionalText(60),
  description: optionalText(200),
  /** Asking for nothing is not a requirement. Backed by a CHECK constraint. */
  requiredQty: decimal('Required quantity', { min: 0, allowZero: false }),
  uom: requiredText(20, 'UOM'),
  remarks: optionalText(2000),
});

export const createCuttingChallanSchema = z.object({
  challanNo: optionalText(40),
  challanDate: isoDate.optional(),
  orderId: uuid,
  styleId: uuid.optional(),
  /** C5 - the APPROVED planning version this requirement is drawn against. */
  planningId: uuid,
  planApprovalId: uuid.optional().nullable(),
  containerNo: optionalText(40),
  requiredBy: isoDate.optional().nullable(),
  remarks: optionalText(2000),
  lines: z.array(challanLineSchema).min(1, 'A cutting challan needs at least one required item'),
});

export const updateCuttingChallanSchema = createCuttingChallanSchema.partial().extend({
  lines: z.array(challanLineSchema).min(1).optional(),
});

export const submitChallanSchema = z.object({
  submittedTo: optionalText(120),
  remarks: optionalText(2000),
});

export const approveChallanSchema = z.object({
  remarks: optionalText(2000),
});

export const rejectChallanSchema = z.object({
  reason: requiredText(2000, 'Rejection reason'),
});

/**
 * C5 - closing short.
 *
 * The reason is REQUIRED. Abandoning an outstanding requirement is a decision
 * somebody takes and answers for, and a decision with no reason recorded is
 * indistinguishable later from a mistake.
 */
export const closeShortSchema = z.object({
  /** Absent closes every incomplete line; present closes just that one. */
  lineId: uuid.optional(),
  reason: requiredText(2000, 'Reason for closing short'),
});

export const cancelChallanSchema = z.object({
  reason: requiredText(2000, 'Cancellation reason'),
});

export const challanListQuery = listQuery.extend({
  status: statusGeneral.optional(),
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  planningId: uuid.optional(),
  containerNo: optionalText(40),
  openOnly: z.coerce.boolean().optional(),
});

export const issuableLinesQuery = z.object({
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  itemCategory: optionalText(60),
});

export const previewChallanSchema = z.object({
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  challanDate: isoDate.optional(),
  lines: z.array(challanLineSchema.partial().extend({ itemCategory: requiredText(60, 'Item category') })).default([]),
});
