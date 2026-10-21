/**
 * Input schemas for Ironing.
 *
 * No balance (worked out from the entries) and no reject reason (always
 * "Ironing damage"). Zod strips unknown keys before the service runs.
 */

import { z } from 'zod';
import { decimal, isoDate, listQuery, optionalText, uuid } from './common.validator.js';

const qty = (label) => decimal(label).optional();

/** Stitching unit, Re-iron (from External QC), From Alteration Unit. */
const source = z.enum(['STITCHING_UNIT', 'RE_IRON', 'ALTERATION_UNIT']);

export const createIroningSchema = z.object({
  entryDate: isoDate.optional(),
  orderId: uuid,
  styleId: uuid,
  source: source.optional(),
  /** Required for a stitching unit (the service says so); ignored otherwise. */
  fromUnit: z.string().trim().min(1, 'Choose the unit the pieces came from').max(80).optional().nullable(),
  ironerId: uuid.optional().nullable(),
  pcsReceived: qty('Pcs received for ironing'),
  pcsIroned: qty('Pcs ironed'),
  pcsDamaged: qty('Pcs damaged in ironing'),
  damageType: optionalText(60),
  /** How the damaged pieces were decided. Either may be left for later. */
  pcsReIroned: qty('Re-iron'),
  pcsRejected: qty('Rejected'),
  remarks: optionalText(2000),
});

/** Source, unit, order and style are what an entry IS, so they do not change. */
export const updateIroningSchema = createIroningSchema
  .omit({ orderId: true, styleId: true, fromUnit: true, source: true })
  .partial();

export const ironingListQuery = listQuery.extend({
  source: source.optional(),
  fromUnit: optionalText(80),
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  ironerId: uuid.optional(),
  undecidedOnly: z.enum(['true', 'false']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const ironingPositionQuery = z.object({
  source: source.optional(),
  /** Required for a stitching unit's lane. */
  unit: z.string().trim().min(1).max(80).optional(),
  orderId: uuid,
  styleId: uuid,
});

export const pendingRejectQuery = z.object({
  status: z.enum(['PENDING', 'TRANSFERRED', 'CANCELLED']).optional(),
  orderId: uuid.optional(),
});
