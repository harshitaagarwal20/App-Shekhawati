/**
 * Input schemas for the registers kept after cutting.
 *
 * Only what a person types is accepted. Every Formula / Auto column - the
 * remaining quantity, the day's total, the defect percentages, the scrap
 * percentage, the rejected quantity, the alter time - is worked out by the
 * service, and Zod strips it if a client posts it anyway.
 *
 * Counts are whole pieces: `pieces()` refuses 2.5 rather than rounding it.
 */

import { z } from 'zod';
import { isoDate, listQuery, optionalText, uuid } from './common.validator.js';
import { FINISHED_CHECKER_DEFECTS, HOURLY_SLOTS } from '../domain/production.js';

/** A whole number of pieces, zero or more, sent as a number or a numeral. */
const pieces = (label) =>
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

const stitching = z.object({
  ...head,
  cuttingIssueId: optionalId,
  unitName: listValue,
  deliverableSize: pieces('Deliverable Size').optional(),
  actualQty: pieces('Actual'),
});

const hourly = z.object({
  ...head,
  employeeId: uuid,
  ...Object.fromEntries(HOURLY_SLOTS.map((s) => [s.key, pieces(`Pieces at ${s.label}`).optional()])),
});

const tailor = {
  tailorId: optionalId,
  tailorName: optionalText(120),
};

const qcSize = z.object({
  ...head,
  ...tailor,
  unitName: listValue,
  operation: listValue,
  size: optionalText(60),
  pcsCheckedRejected: pieces('Pcs Checked/Reject'),
  defectFound: listValue,
  informTo: listValue,
});

const qcDefect = z.object({
  ...head,
  ...tailor,
  unitName: listValue,
  pcsCheckedRejected: pieces('Pcs Checked/Reject'),
  defectFound: listValue,
  informTo: listValue,
});

const internalQc = z.object({
  ...head,
  unitName: listValue,
  checkerId: uuid,
  totalPcsChecked: pieces('Total Pcs Checked'),
  totalDefectPcs: pieces('Total Defect Pcs'),
  defectType: listValue,
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

const externalCheck = z.object({
  ...head,
  agencyName: optionalText(150),
  personIncharge: optionalText(120),
  inspectionQty: pieces('Total Inspection Qty'),
  lines: z
    .array(
      z.object({
        particular: z.string().trim().min(1, 'Particulars is required').max(150),
        critical: pieces('Critical').optional(),
        major: pieces('Major').optional(),
        minor: pieces('Minor').optional(),
        remark: optionalText(500),
      }),
    )
    .max(60, 'An inspection report cannot carry more than 60 lines'),
});

/** No date: the alter report's Time is captured by the server on submit. */
const alter = z.object({
  orderId: uuid,
  styleId: uuid.optional(),
  remarks: optionalText(2000),
  outputPcs: pieces('Output'),
  passPcs: pieces('Pass/ok'),
  alterPcs: pieces('Alter piece'),
});

const spotRectification = z.object({
  ...head,
  qtyReceived: pieces('Qty Received for Rectification'),
  soldOnlineQty: pieces('Sold Online-Domestic Qty').optional(),
  scrapQty: pieces('Scrap Qty').optional(),
  authorisedBy: listValue,
});

const rejected = z.object({
  ...head,
  cuttingQty: pieces('Cutting Qty').optional(),
  packedQty: pieces('Packed Qty'),
  checkedById: optionalId,
  checkedByName: optionalText(120),
  rejectReason: listValue,
});

const reconciliation = z.object({
  orderId: uuid,
  styleId: uuid.optional(),
  reconStatus: listValue,
  remarks: optionalText(2000),
});

const CREATE = {
  stitching,
  hourly,
  qcSize,
  qcDefect,
  internalQc,
  finalChecker,
  finishedChecker,
  externalCheck,
  alter,
  spotRectification,
  rejected,
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
  employeeId: uuid.optional(),
  tailorId: uuid.optional(),
  checkerId: uuid.optional(),
  cuttingIssueId: uuid.optional(),
  qcStatus: z.string().trim().max(40).optional(),
  reconStatus: z.string().trim().max(40).optional(),
  rejectReason: z.string().trim().max(120).optional(),
});

export const orderContextQuery = z.object({ orderId: uuid });
