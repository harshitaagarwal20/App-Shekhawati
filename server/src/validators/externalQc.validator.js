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

const qty = (label) => decimal(label).optional();

const checkerLine = z.object({
  /** As written on the bag. */
  checkerCode: z.string().trim().max(30),
  pcs: decimal('Checker pcs'),
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
