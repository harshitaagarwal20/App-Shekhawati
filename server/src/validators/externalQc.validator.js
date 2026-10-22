/**
 * Input schemas for External QC.
 *
 * No totals of reasons and no bags - those are the service's (worked out from
 * the boxes). Zod strips unknown keys before the service runs, and the
 * arithmetic (boxes = offered, reasons = box) is checked there, where the
 * message can name the figures.
 */

import { z } from 'zod';
import { decimal, isoDate, listQuery, optionalText, uuid } from './common.validator.js';
import { pieces } from './productionRegister.validator.js';

const qty = (label) => decimal(label).optional();

const checkerLine = z.object({
  /** As written on the bag. */
  checkerCode: z.string().trim().max(30),
  pcs: decimal('Checker pcs'),
});

/**
 * One line of the agency's inspection report ("External Secondary
 * Checking"): a particular from L_InspDefect26 and its count by severity, in
 * whole pieces. The line's Total and the report's totals are the service's.
 */
const inspectionLine = z.object({
  particular: z.string().trim().min(1, 'Particulars is required').max(150),
  critical: pieces('Critical').optional(),
  major: pieces('Major').optional(),
  minor: pieces('Minor').optional(),
  remark: optionalText(500),
});

export const createExternalQcSchema = z.object({
  entryDate: isoDate.optional(),
  orderId: uuid,
  styleId: uuid,
  agencyId: uuid,
  inspectorName: optionalText(120),
  pcsOffered: decimal('Pcs offered'),
  pcsApproved: qty('Approved'),
  pcsAlteration: qty('Alteration'),
  pcsRejected: qty('Rejected'),
  altAlter: qty('Alteration - Alter'),
  altIron: qty('Alteration - Iron'),
  altDefected: qty('Alteration - Defected'),
  altSpoiled: qty('Alteration - Spoiled'),
  altOther: qty('Alteration - Other'),
  rejAlter: qty('Rejected - Alter'),
  rejIron: qty('Rejected - Iron'),
  rejDefected: qty('Rejected - Defected'),
  rejSpoiled: qty('Rejected - Spoiled'),
  rejOther: qty('Rejected - Other'),
  checkers: z.array(checkerLine).max(50).optional(),
  inspectionLines: z.array(inspectionLine).max(60, 'An inspection report cannot carry more than 60 lines').optional(),
  remarks: optionalText(2000),
});

/** The order and style are what an entry IS, so they do not change. */
export const updateExternalQcSchema = createExternalQcSchema.omit({ orderId: true, styleId: true }).partial();

export const externalQcListQuery = listQuery.extend({
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  agencyId: uuid.optional(),
  checkerCode: optionalText(30),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const orderStyleQuery = z.object({ orderId: uuid, styleId: uuid });

export const attachmentParams = z.object({ id: uuid, attachmentId: uuid });
