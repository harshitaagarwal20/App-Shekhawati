/**
 * Input schemas for Inline QC.
 *
 * No unit (it is the tailor's), no Inform To name (read from the login) and
 * no defect status (only Resolve and Reopen change it). Zod strips unknown
 * keys before the service runs. The rules that tie fields together - Size
 * needs Operation and Size, rejected <= checked, a defect needs Inform To -
 * are domain/inlineQc.js's, where the message can name the figures.
 */

import { z } from 'zod';
import { decimal, isoDate, listQuery, optionalText, uuid } from './common.validator.js';

const checkType = z.enum(['SIZE', 'WORKMANSHIP'], { errorMap: () => ({ message: 'Choose Size or Workmanship' }) });

const fields = {
  entryDate: isoDate.optional(),
  checkType,
  /** Size checks only - dropped for Workmanship by the service. */
  operation: optionalText(60),
  sizeMeasurement: optionalText(60),
  pcsChecked: decimal('Pcs checked', { allowZero: false }),
  pcsRejected: decimal('Pcs rejected').optional(),
  defects: z.array(z.string().trim().max(120)).max(30).optional(),
  informToUserId: z.union([uuid, z.literal(''), z.null()]).optional(),
  remarks: optionalText(2000),
};

export const createInlineQcSchema = z.object({
  ...fields,
  tailorId: uuid,
  orderId: uuid,
  styleId: uuid,
});

/** The tailor, order and style are what a check IS, so they do not change. */
export const updateInlineQcSchema = z.object(fields).partial();

export const inlineQcListQuery = listQuery.extend({
  unit: optionalText(80),
  checkType: checkType.optional(),
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  tailorId: uuid.optional(),
  informToUserId: uuid.optional(),
  defect: optionalText(120),
  openOnly: z.enum(['true', 'false']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const unitQuery = z.object({ unit: optionalText(80) });

export const actionListQuery = listQuery.extend({
  /** mine (default): addressed to the caller. all: everyone's. */
  scope: z.enum(['mine', 'all']).optional(),
  status: z.enum(['OPEN', 'RESOLVED', 'ALL']).optional(),
  unit: optionalText(80),
  orderId: uuid.optional(),
  informToUserId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const resolveSchema = z.object({ note: optionalText(500) });
