/**
 * Input schemas for Stitching Record, Hourly Monitoring and printing after
 * stitching.
 *
 * No `remaining` (Deliverable - Actual, worked out by the server), no
 * `recordedByName` (stamped from the login) and no printing `status`
 * (follows from sent and received). Zod strips unknown keys, so a client
 * that posts any of them has it discarded before the service runs.
 */

import { z } from 'zod';
import { decimal, isoDate, listQuery, optionalText, uuid } from './common.validator.js';

const unit = optionalText(80);

// --- Stitching record -----------------------------------------------------

export const createStitchingRecordSchema = z.object({
  unit,
  recordDate: isoDate.optional(),
  orderId: uuid,
  styleId: uuid,
  /** Omitted: taken from the approved stitching plan for the unit and date. */
  deliverableQty: decimal('Deliverable qty').optional().nullable(),
  actualStitched: decimal('Actual stitched'),
  remarks: optionalText(2000),
});

/** What the row IS (unit, date, order, style) is not editable. */
export const updateStitchingRecordSchema = z.object({
  deliverableQty: decimal('Deliverable qty').optional(),
  actualStitched: decimal('Actual stitched').optional(),
  remarks: optionalText(2000),
});

export const stitchingListQuery = listQuery.extend({
  unit,
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const unitQuery = z.object({ unit });

export const dayQuery = z.object({
  unit,
  date: isoDate.optional(),
  orderId: uuid,
  styleId: uuid,
});

// --- Hourly monitoring ----------------------------------------------------

/**
 * One cell. `pcs` null (or an empty box) clears it.
 */
export const saveSlotSchema = z.object({
  unit,
  date: isoDate.optional(),
  orderId: uuid,
  styleId: uuid,
  employeeId: uuid,
  slot: z.string().trim().min(1, 'Choose the time slot').max(20),
  pcs: z
    .union([z.literal(''), z.null(), decimal('Pieces')])
    .transform((v) => (v === '' ? null : v)),
});

export const hourlyListQuery = listQuery.extend({
  unit,
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  employeeId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

// --- Printing after stitching ---------------------------------------------

export const createPrintingSchema = z.object({
  printingDate: isoDate.optional(),
  orderId: uuid,
  styleId: uuid,
  /** The stitching unit the pieces leave. They are held against it while out. */
  fromUnit: z.string().trim().min(1, 'Choose the unit the pieces are sent from').max(80),
  vendorId: uuid,
  qty: decimal('Pcs sent', { allowZero: false }),
  qtyReceived: decimal('Pcs received back').optional(),
  receivedDate: isoDate.optional(),
  uom: optionalText(20),
  remarks: optionalText(2000),
});

export const updatePrintingSchema = z.object({
  printingDate: isoDate.optional(),
  /** Only for an older row that never named its unit. */
  fromUnit: optionalText(80),
  vendorId: uuid.optional(),
  qty: decimal('Pcs sent', { allowZero: false }).optional(),
  qtyReceived: decimal('Pcs received back').optional(),
  receivedDate: isoDate.optional(),
  uom: optionalText(20),
  remarks: optionalText(2000),
});

export const printingListQuery = listQuery.extend({
  orderId: uuid.optional(),
  styleId: uuid.optional(),
  vendorId: uuid.optional(),
  fromUnit: optionalText(80),
  openOnly: z.enum(['true', 'false']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const printingSummaryQuery = z.object({ orderId: uuid, styleId: uuid, unit: z.string().trim().min(1).max(80) });
