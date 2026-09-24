/**
 * Audit trail query validation.
 *
 * Read-only throughout - there is no body schema in this file because there is
 * no endpoint that writes.
 */

import { z } from 'zod';
import { AUDITED } from '../config/auditedTables.js';
import { isRealCalendarDate } from './common.validator.js';

const uuid = z.string().uuid('Must be a valid id');
// Shape AND calendar: the regex alone accepts 2026-02-31, which the audit log
// would then silently widen to 3 March when it built the range.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(isRealCalendarDate, 'Must be a real date - check the day exists in that month');

/**
 * The table name is checked against the audited list rather than accepted as
 * free text. It reaches a Prisma `where` clause, and a name nobody audits can
 * only ever return nothing - better to say so than to return an empty page.
 */
const auditedTable = z.enum(Object.keys(AUDITED));

export const auditListQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  sort: z.string().trim().max(40).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  search: z.string().trim().max(120).optional(),
  tableName: auditedTable.optional(),
  recordId: uuid.optional(),
  userId: uuid.optional(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const auditTrailParams = z.object({
  tableName: auditedTable,
  recordId: uuid,
});

export const auditSummaryQuery = z.object({
  // A fortnight is the longest window worth summarising on a screen; anything
  // beyond it is a question for the list with a date filter.
  days: z.coerce.number().int().min(1).max(90).optional(),
});

export const idParam = z.object({ id: uuid });
