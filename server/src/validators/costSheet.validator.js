/**
 * Cost sheet validation. Only what a person types: rates, consumptions,
 * conversion costs and percentages. Every amount, total and FOB is computed
 * in domain/costing.js and never accepted from a client.
 */

import { z } from 'zod';
import { decimal, fraction, isoDate, listQuery, optionalText, uuid } from './common.validator.js';

const money = (label) => decimal(label, { min: 0 });

export const costSheetListQuery = listQuery.extend({
  styleId: uuid.optional(),
  orderId: uuid.optional(),
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUPERSEDED']).optional(),
});

const header = {
  currency: optionalText(10),
  exchangeRate: decimal('Exchange rate', { min: 0, allowZero: false }).optional(),
  targetPrice: money('Target price').nullish(),
  cmtCost: money('CMT cost').optional(),
  printCost: money('Print cost').optional(),
  dyeWashCost: money('Dye / wash cost').optional(),
  otherCost: money('Other cost').optional(),
  otherCostLabel: optionalText(120),
  overheadPct: fraction('Overhead').optional(),
  rejectionPct: fraction('Rejection allowance').optional(),
  commissionPct: fraction('Commission').optional(),
  marginPct: fraction('Margin').optional(),
  remarks: optionalText(2000),
};

export const createCostSheetSchema = z.object({
  styleId: uuid,
  orderId: uuid.nullish(),
  costDate: isoDate.optional(),
  ...header,
});

const lineSchema = z.object({
  /// Present: edit that line. Absent: add a new one.
  id: uuid.optional(),
  itemCategory: optionalText(60),
  subCategory: optionalText(60),
  accessoriesItem: optionalText(80),
  description: optionalText(200),
  uom: optionalText(20),
  consumption: decimal('Consumption', { min: 0 }).optional(),
  wastagePct: fraction('Wastage').optional(),
  rate: money('Rate').nullish(),
  rateSource: optionalText(200),
});

export const updateCostSheetSchema = z.object({
  ...header,
  lines: z.array(lineSchema).max(300).optional(),
  removeLineIds: z.array(uuid).max(300).optional(),
});

export const decideCostSheetSchema = z.object({ remarks: optionalText(2000) });

export const rejectCostSheetSchema = z.object({
  reason: z.string().trim().min(3, 'A rejection needs a reason').max(2000),
});
