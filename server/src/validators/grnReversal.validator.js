/**
 * F-04 - GRN Reversal input schemas.
 *
 * ===========================================================================
 *  WHAT A CALLER MAY SAY, AND WHAT IT MAY NOT
 * ===========================================================================
 *
 * A reversal takes exactly three things from the outside world: WHICH receipt,
 * WHY, and optionally a date and a remark. Everything else about it - the
 * quantity, the amount, the item, the location, the roll count - is copied off
 * the receipt by the service.
 *
 * That is not an omission to be tidied up later. It is the whole safety
 * property of the document: a reversal that let a caller state its own
 * quantity would be a way to move arbitrary stock with a reason attached, and
 * the approver signing it would have no way to tell "undo GRN-005" from "take
 * 900 metres out of the store". The approver is shown figures the system
 * derived, so what they sign is what happens.
 *
 * `reversalNo`, `workflowState`, `approvalStatus`, `postedAt` and every stamp
 * are likewise absent, for the reason they are absent from every other module:
 * the engine writes them.
 * ===========================================================================
 */

import { z } from 'zod';
import { isoDate, listQuery, optionalText, requiredText, uuid } from './common.validator.js';


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
 * WHY, in words, and a real sentence of them.
 *
 * Ten characters is matched by the `grn_reversals_reason_is_a_sentence` CHECK
 * constraint, so the rule holds whatever writes the row. It is not a hurdle so
 * much as a floor under "x" and ".": this field is the only account of what
 * went wrong that anybody will have in a year, and it is what the approver
 * reads before deciding.
 */
const reason = requiredText(2000, 'Reason').refine(
  (v) => v.length >= 10,
  'Say what was wrong with the receipt - a few words at least, so the reason still reads in a year.',
);

export const createGrnReversalSchema = z.object({
  /** The posted receipt being undone. */
  grnId: uuid,
  reason,
  /**
   * Defaults to today. Accepted because a correction discovered on Monday for
   * a receipt keyed on Friday is dated when the correction was decided, and
   * the store is entitled to say so.
   */
  reversalDate: isoDate.optional(),
  remarks: optionalText(2000),
  /** Who it goes to for signature. Free text, as every other submission is. */
  submittedTo: optionalText(120),
  /**
   * Raise it and leave it as a draft.
   *
   * Defaults to submitting, because two round trips to say "this receipt is
   * wrong" are two chances to leave the correction sitting in a drawer while
   * the ledger stays wrong. A caller who genuinely wants to draft one - to
   * gather the roll numbers first, say - passes false.
   */
  submit: z.boolean().optional(),
});

/**
 * Editing. Only the words, and only while it is a draft.
 *
 * There is nothing else to edit: the figures are the receipt's, and the
 * receipt it points at is what the document IS. A reversal aimed at the wrong
 * GRN is deleted, not repointed.
 */
export const updateGrnReversalSchema = z
  .object({
    reason: reason.optional(),
    remarks: optionalText(2000),
    reversalDate: isoDate.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const submitGrnReversalSchema = z.object({
  submittedTo: optionalText(120),
  remarks: optionalText(2000),
});

export const approveGrnReversalSchema = z.object({
  remarks: optionalText(2000),
});

export const rejectGrnReversalSchema = z.object({
  reason: requiredText(2000, 'Rejection reason'),
});

export const cancelGrnReversalSchema = z.object({
  reason: requiredText(2000, 'Cancellation reason'),
});

export const grnReversalListQuery = listQuery.extend({
  workflowState: documentState.optional(),
  grnId: uuid.optional(),
  purchaseOrderId: uuid.optional(),
});

/** `GET /grn-reversals/eligibility/:grnId` - the receipt, not the reversal. */
export const grnIdParam = z.object({ grnId: uuid });
