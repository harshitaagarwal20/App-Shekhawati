/**
 * Input schemas for the Alteration Unit and the Rejected Register.
 *
 * No bag is ever posted: bags are kept by External QC and ironing. An entry
 * names the bag it worked, and the Rejected Register takes no input at all.
 */

import { z } from 'zod';
import { decimal, isoDate, listQuery, optionalText, uuid } from './common.validator.js';

const qty = (label) => decimal(label).optional();

const line = z.object({
  receiptId: uuid,
  pcsAltered: qty('Pcs altered / cleaned'),
  pcsNotRepairable: qty('Pcs not repairable'),
  notRepairableReason: optionalText(200),
});

export const createAlterationSchema = z.object({
  entryDate: isoDate.optional(),
  staffId: uuid,
  remarks: optionalText(2000),
  /** One per bag worked; every bag of one order and style. */
  lines: z.array(line).min(1, 'Work at least one bag').max(100),
});

/** One entry: counts, reason, staff, date, remarks. Its bag does not change. */
export const updateAlterationSchema = z
  .object({
    entryDate: isoDate.optional(),
    staffId: uuid,
    pcsAltered: qty('Pcs altered / cleaned'),
    pcsNotRepairable: qty('Pcs not repairable'),
    notRepairableReason: optionalText(200),
    remarks: optionalText(2000),
  })
  .partial();

export const alterationListQuery = listQuery.extend({
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  staffId: uuid.optional(),
  receiptId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const bagListQuery = listQuery.extend({
  status: z.enum(['OPEN', 'CLOSED', 'CANCELLED', 'ALL']).optional(),
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  source: z.enum(['EXTERNAL_QC', 'IRONING']).optional(),
  reason: optionalText(60),
});

export const orderStyleQuery = z.object({ orderId: uuid, styleId: uuid });

export const rejectedListQuery = listQuery.extend({
  stage: z.enum(['ALTERATION_UNIT']).optional(),
  origin: z.enum(['EXTERNAL_QC', 'IRONING']).optional(),
  reason: optionalText(60),
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});
