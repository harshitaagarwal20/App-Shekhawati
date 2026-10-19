/**
 * Input schemas for the cut pieces receipt.
 *
 * No `receiptNo` (numbered by the server) and no `receivedByName` (stamped
 * from the logged-in user). Zod strips unknown keys, so a client that posts
 * either has it discarded before the service runs.
 */

import { z } from 'zod';
import { decimal, isoDate, listQuery, optionalText, uuid } from './common.validator.js';

export const createCutPiecesReceiptSchema = z.object({
  receiptDate: isoDate.optional(),
  orderId: uuid,
  styleId: uuid.optional(),
  cuttingChallanId: uuid.optional().nullable(),
  cuttingMasterId: uuid.optional().nullable(),
  cuttingMasterName: optionalText(120),
  colorCode: optionalText(60),
  lotNo: optionalText(40),
  pcsReceived: decimal('Good pieces received'),
  pcsRejected: decimal('Rejected pieces').optional(),
  handlesReceived: decimal('Handles received').optional(),
  remarks: optionalText(2000),

  // C6 - the fabric the pieces were cut from. Optional as a set: a lot whose
  // cloth was accounted for on another receipt of the same cut carries none.
  // The service holds the six to the equation and posts them to the ledger.
  fabricIssueId: uuid.optional().nullable(),
  fabricUom: optionalText(20),
  issuedQty: decimal('Fabric received on the floor').optional(),
  consumedQty: decimal('Fabric consumed').optional(),
  remainderQty: decimal('Remainder returned').optional(),
  remnantQty: decimal('Remnants kept').optional(),
  wastageQty: decimal('Wastage').optional(),
  fabricDamageQty: decimal('Fabric damaged').optional(),
});

export const updateCutPiecesReceiptSchema = createCutPiecesReceiptSchema.partial();

/**
 * The sample check on a lot. No pass/fail field: the service works it out
 * from the defects against the limit, so it cannot be posted.
 */
export const recordCutCheckSchema = z.object({
  sampleQty: decimal('Pieces checked'),
  acceptLimitPct: decimal('Accept limit %').optional(),
  defects: z
    .array(
      z.object({
        panel: optionalText(80),
        defectType: z.string().trim().min(1, 'Choose the defect').max(80),
        qty: decimal('Defective pieces'),
        remarks: optionalText(500),
      }),
    )
    .max(100)
    .default([]),
  remarks: optionalText(2000),
});

export const cutPiecesReceiptListQuery = listQuery.extend({
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  cuttingChallanId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const cutPiecesSummaryQuery = z.object({
  orderId: uuid,
  styleId: uuid.optional(),
});
