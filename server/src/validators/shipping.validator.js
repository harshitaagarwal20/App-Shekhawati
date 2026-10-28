/**
 * Input schemas for Needle Checking, Packing and Dispatch.
 *
 * No Auto or Formula fields: Carton, Pcs/Carton, Qty, N.W, G.W, CBM, Buyer,
 * Container No, the totals and Dispatch No are the services' - Zod strips
 * them before the service runs. The arithmetic is checked there, where the
 * message can name the figures.
 */

import { z } from 'zod';
import { decimal, isoDate, listQuery, optionalText, requiredText, uuid } from './common.validator.js';

const dateRange = { dateFrom: isoDate.optional(), dateTo: isoDate.optional() };
const orderStyle = { orderId: uuid, styleId: uuid };

export const orderStyleQuery = z.object({ ...orderStyle, ...dateRange });

/** A whole count - cartons, boxes, pieces in a carton or box. */
const count = (label, { min = 0 } = {}) =>
  z.coerce.number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, min > 0 ? `Enter the ${label.toLowerCase()}` : `${label} cannot be negative`)
    .max(1_000_000);

/** A figure that may be left blank: '' and null clear it. */
const blankable = (schema) => z.union([z.literal(''), z.null(), schema]).optional().transform((v) => (v === '' ? null : v));

const colorCode = blankable(z.string().trim().max(60));

// --- Needle Checking ---------------------------------------------------------

const sizes = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`size${i + 1}`, blankable(count(`Size ${i + 1}`))]),
);

const carton = {
  cartonQty: count('Carton qty', { min: 1 }),
  colorCode,
  ...sizes,
  weightKg: blankable(decimal('Weight', { allowZero: false, max: 100000 })),
  signedBy: requiredText(120, 'Sign.'),
};

export const createCartonSchema = z.object({ ...orderStyle, checkDate: isoDate.optional(), ...carton });

/** The order and style are what the sheet IS. */
export const updateCartonSchema = z.object(carton).partial();

export const needleListQuery = listQuery.extend({ orderId: uuid.optional(), styleId: uuid.optional(), ...dateRange });

// --- Packing -----------------------------------------------------------------

const box = {
  boxNo: requiredText(40, 'Box No'),
  colorCode,
  pcsPerBox: count('Packing', { min: 1 }),
  boxesPacked: count('Boxes', { min: 1 }),
  nwPerBoxKg: blankable(decimal('N.W per box', { allowZero: false, max: 100000 })),
  gwPerBoxKg: blankable(decimal('G.W per box', { allowZero: false, max: 100000 })),
  lengthCm: blankable(decimal('Length', { allowZero: false, max: 100000 })),
  widthCm: blankable(decimal('Width', { allowZero: false, max: 100000 })),
  heightCm: blankable(decimal('Height', { allowZero: false, max: 100000 })),
  remarks: optionalText(2000),
};

export const createPackingSchema = z.object({ ...orderStyle, packDate: isoDate.optional(), ...box });

/** The order, style and day are what an entry IS. */
export const updatePackingSchema = z.object(box).partial();

export const packingListQuery = listQuery.extend({ orderId: uuid.optional(), styleId: uuid.optional(), ...dateRange });

// --- Dispatch ----------------------------------------------------------------

const dispatchStatus = z.enum(['PENDING', 'DISPATCHED', 'DELIVERED']);

const dispatchFields = {
  dispatchDate: isoDate.optional(),
  invoiceNo: optionalText(60),
  shipMode: optionalText(40),
  carrierRef: optionalText(120),
  eta: blankable(isoDate),
  status: dispatchStatus.optional(),
  remarks: optionalText(2000),
  /** The packing lines that go. Left out on create: everything ready; on an edit: as they are. */
  packingEntryIds: z.array(uuid).min(1, 'Choose the boxes that go on this dispatch').max(5000).optional(),
};

export const createDispatchSchema = z.object({ orderId: uuid, ...dispatchFields });

/** The order is what a dispatch IS. */
export const updateDispatchSchema = z.object(dispatchFields).partial();

export const dispatchListQuery = listQuery.extend({
  orderId: uuid.optional(),
  status: dispatchStatus.optional(),
  containerNo: optionalText(40),
  ...dateRange,
});

/** The dispatch being edited, left out of "already on a dispatch". */
export const dispatchPreviewQuery = z.object({ orderId: uuid, excluding: uuid.optional() });

export const printParams = z.object({
  id: uuid,
  kind: z.enum(['dispatch-note', 'packing-list']),
});
