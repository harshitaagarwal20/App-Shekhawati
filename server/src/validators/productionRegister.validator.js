/**
 * Input schemas for the Phase 5 registers.
 *
 * Only what a person types is accepted. Every Formula / Auto column - the
 * defect totals and percentages, the scrap percentage, the reconciliation
 * counts - is worked out by the service, and Zod strips it if a client posts
 * it anyway.
 *
 * Counts are whole pieces: `pieces()` refuses 2.5 rather than rounding it.
 */

import { z } from 'zod';
import { isoDate, listQuery, optionalText, uuid } from './common.validator.js';
import { FINISHED_CHECKER_DEFECTS } from '../domain/quality.js';

/** A whole number of pieces, zero or more, sent as a number or a numeral. */
export const pieces = (label) =>
  z
    .union([z.string().trim(), z.number()])
    .transform((v, ctx) => {
      const n = typeof v === 'number' ? v : v === '' ? NaN : Number(v);
      if (!Number.isInteger(n) || n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a whole number, zero or more` });
        return z.NEVER;
      }
      if (n > 100_000_000) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is too large` });
        return z.NEVER;
      }
      return n;
    });

const optionalId = uuid.optional().nullable();
const listValue = optionalText(150);

/** Every register is dated, kept against an order, and for one of its styles. */
const head = {
  recordDate: isoDate.optional(),
  orderId: uuid,
  styleId: uuid.optional(),
  remarks: optionalText(2000),
};

/**
 * One defect type found and how many pieces had it. Total Defect Pcs is the
 * sum of these, so it is not accepted.
 */
const internalQcDefect = z.object({
  defectType: z.string().trim().min(1, 'Choose the defect type').max(120),
  qty: pieces('Defect Pcs').refine((v) => v > 0, 'Defect Pcs must be at least 1'),
});

const internalQc = z.object({
  ...head,
  unitName: listValue,
  checkerId: uuid,
  totalPcsChecked: pieces('Total Pcs Checked'),
  defects: z.array(internalQcDefect).max(100, 'Too many defect lines').optional(),
  qcStatus: listValue,
  transferredBackToUnit: listValue,
});

/** The sheet has no order column: the order is optional, the style is not. */
const finalChecker = z.object({
  ...head,
  orderId: optionalId,
  checkerId: uuid,
  totalPcsChecked: pieces('Total Pcs Checked'),
  totalDefect: pieces('Total Defect'),
  defectType: listValue,
});

const finishedChecker = z.object({
  ...head,
  checkerId: uuid,
  checkedPcs: pieces('Checked Psc'),
  ...Object.fromEntries(FINISHED_CHECKER_DEFECTS.map((d) => [d.key, pieces(d.label).optional()])),
});

const spotRectification = z.object({
  ...head,
  qtyReceived: pieces('Qty Received for Rectification'),
  soldOnlineQty: pieces('Sold Online-Domestic Qty').optional(),
  scrapQty: pieces('Scrap Qty').optional(),
  authorisedBy: listValue,
});

const reconciliation = z.object({
  orderId: uuid,
  styleId: uuid.optional(),
  reconStatus: listValue,
  remarks: optionalText(2000),
});

const CREATE = {
  internalQc,
  finalChecker,
  finishedChecker,
  spotRectification,
  reconciliation,
};

/** `{ create, update }` for one register. An update may send any subset. */
export function schemasFor(key) {
  const create = CREATE[key];
  if (!create) throw new Error(`No input schema for register "${key}"`);
  return { create, update: create.partial() };
}

/** Every register lists the same way: by order, style, date and its own keys. */
export const registerListQuery = listQuery.extend({
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  unitName: z.string().trim().max(120).optional(),
  checkerId: uuid.optional(),
  qcStatus: z.string().trim().max(40).optional(),
  reconStatus: z.string().trim().max(40).optional(),
});

export const orderContextQuery = z.object({ orderId: uuid });
