/**
 * C2 / C3 - input schemas for the tolerance masters.
 *
 * Every percentage on these endpoints is a FRACTION, not a percentage: 0.01 is
 * one per cent. The bound at 1 is deliberate and is the single most valuable
 * validation on this file - somebody typing "5" meaning five per cent would
 * otherwise configure a five-hundred-per-cent tolerance, and the first anyone
 * would know is a delivery six times the size of the order being waved through.
 * The same bound exists as a CHECK constraint on both tables.
 */

import { z } from 'zod';
import { fraction, optionalText, requiredText, uuid } from './common.validator.js';

export const ITEM_CATEGORIES = ['FABRIC', 'ACCESSORIES', 'PACKAGING', 'STATIONERY'];
export const JOB_WORK_PROCESSES = ['DYEING', 'PRINTING', 'FINISHING'];

// `fraction` from common.validator.js already refuses anything outside [0, 1)
// with the message "must be a fraction between 0 and 1 (0.02 = 2%)". Reused
// rather than redefined: one wording for one rule, across the whole API.

export const itemCategoryEnum = z.enum(ITEM_CATEGORIES);

export const createToleranceSchema = z.object({
  category: itemCategoryEnum,
  orderTolerancePct: fraction('Order tolerance'),
  receiptTolerancePct: fraction('Receipt tolerance'),
  /**
   * The day this version starts applying. Required, and deliberately not
   * defaulted to today: a tolerance version is a dated agreement, and the date
   * it takes effect from is part of what was agreed.
   */
  effectiveFrom: z.coerce.date(),
  basis: requiredText(255, 'Basis'),
});

export const createShrinkageSchema = z.object({
  process: z.enum(JOB_WORK_PROCESSES),
  /** Null / absent means the process-wide standard, not "no vendor". */
  vendorId: uuid.optional().nullable(),
  shrinkageTolerancePct: fraction('Shrinkage tolerance'),
  effectiveFrom: z.coerce.date(),
  basis: requiredText(255, 'Basis'),
});

export const toleranceQuery = z.object({
  category: itemCategoryEnum.optional(),
  on: z.coerce.date().optional(),
});

export const shrinkageQuery = z.object({
  process: z.enum(JOB_WORK_PROCESSES).optional(),
  vendorId: uuid.optional(),
  on: z.coerce.date().optional(),
});

export const resolveToleranceQuery = z.object({
  category: itemCategoryEnum,
  on: z.coerce.date().optional(),
  orderId: uuid.optional(),
  buyerId: uuid.optional(),
  itemCategory: optionalText(60),
});

export const resolveShrinkageQuery = z.object({
  process: z.enum(JOB_WORK_PROCESSES),
  vendorId: uuid.optional(),
  on: z.coerce.date().optional(),
});
