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
});

export const updateCutPiecesReceiptSchema = createCutPiecesReceiptSchema.partial();

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
