/**
 * Buyer Order validation.
 *
 * The schemas below accept ONLY what a human types. There is deliberately no
 * `effectiveQty`, no `excessApprovedPct` and no requirement line in any input
 * schema: Zod strips unknown keys, so a client that tries to post a calculated
 * quantity has it silently discarded before the service runs. Those values are
 * derived in buyerOrder.service.js and nowhere else.
 */

import { z } from 'zod';
import { decimal, fraction, isoDate, listQuery, optionalText, uuid } from './common.validator.js';

/**
 * An order is counted in finished pieces, and there is no half a bag. The
 * column is Decimal(18, 4) because it shares its type with metres and kilos,
 * so the whole-number rule has to be stated here.
 */
const pieces = (label) =>
  decimal(label, { min: 0, allowZero: false }).refine(
    (v) => Number.isInteger(Number(v)),
    `${label} must be a whole number of pieces`,
  );

export const orderListQuery = listQuery.extend({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED']).optional(),
  excessApprovalStatus: z.enum(['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
  buyerId: uuid.optional(),
  styleId: uuid.optional(),
  currency: z.string().trim().max(10).optional(),
  orderFrom: isoDate.optional(),
  orderTo: isoDate.optional(),
  deliveryFrom: isoDate.optional(),
  deliveryTo: isoDate.optional(),
});

/**
 * C13 - one style on an order, and how many pieces of it.
 *
 * No `effectiveQty`: the per-style ceiling is derived from the APPROVED excess
 * in buyerOrder.service.js, the same rule that keeps it off the header.
 */
/** A selling price per piece. Zero is a sample or a free replacement; null is "not priced yet". */
const price = (label) => decimal(label, { min: 0 }).nullish();

/** Rupees per unit of the order currency. */
const exchangeRate = decimal('Exchange rate', { min: 0, allowZero: false }).nullish();

const orderLineSchema = z.object({
  styleId: uuid,
  orderQty: pieces('Line quantity'),
  colorCode: optionalText(60),
  sizeGroup: optionalText(40),
  unitPrice: price('Unit price'),
  remarks: optionalText(2000),
});

/**
 * The commercial terms. Never structural - a price does not change what gets
 * cut or bought - so they may be sent on create, on edit, and on the separate
 * pricing call that stays open after the order's structure has closed.
 */
const commercialTerms = {
  /// The buyer's own PO number - `orderNo` is ours.
  buyerPoNo: optionalText(60),
  buyerPoDate: isoDate.nullish(),
  /// When the goods must leave the factory. Checked against the delivery date.
  exFactoryDate: isoDate.nullish(),
  /// Incoterm - FOB, CIF, EXW. Defaults from the buyer.
  priceTerms: optionalText(150),
  paymentTerms: optionalText(150),
  exchangeRate,
};

const orderBody = z.object({
  /// Excel: "Order No" (Manual) - "Buyer PO num is their order no".
  /// Left blank, the server draws one from the BUYER_ORDER sequence.
  orderNo: optionalText(40),
  /// Excel: "Order Date" (Auto) - defaults to today.
  orderDate: isoDate.optional(),
  /// Excel: "Item Description" (Text) - defaults to the style description.
  itemDescription: optionalText(200),
  /// Excel: "Buyer" (Dropdown -> Buyer Master)
  buyerId: uuid,
  /// Excel: "Bill To" (Auto) - defaults from the Buyer Master.
  billTo: optionalText(1000),
  /// Excel: "Ship to" - defaults to the buyer consignee address.
  shipTo: optionalText(1000),
  /// Excel: "Buyer Delivery Date" (Manual)
  buyerDeliveryDate: isoDate.nullish(),
  ...commercialTerms,
  /// The single-style form's price per piece. With `lines`, each line carries its own.
  unitPrice: price('Unit price'),
  /**
   * C13 - THE STYLES ON THIS ORDER. One line per style, each with its own
   * quantity, colour and size group.
   *
   * `orderQty` and `styleId` below are the pre-C13 single-style form and stay
   * accepted: the service normalises them into a one-line order, which is what
   * the migration did to every order that already existed. Supply `lines` OR
   * that pair - the refinement at the bottom of this file insists on one.
   */
  lines: z.array(orderLineSchema).min(1, 'An order needs at least one style').optional(),
  /// Excel: "Order Qty" (Manual) - finished pieces. C13: the single-style form;
  /// with `lines` the header quantity is their sum and this is ignored.
  orderQty: pieces('Order quantity').optional(),
  /// Excel: "Style No" (Dropdown -> Style Master). C13: the single-style form.
  styleId: uuid.optional(),
  /// Excel: "Color Code" (Dropdown -> L_ColorCode)
  colorCode: optionalText(60),
  /// Excel: "Currency" (Dropdown -> L_Currency) - defaults from the buyer.
  currency: optionalText(10),
  /// Excel: "Ship Mode" (Dropdown -> L_ShipMode) - defaults from the buyer.
  shipMode: optionalText(40),
  /// Excel: "Size Group" (Manual -> L_SizeGroup) - defaults from the style.
  sizeGroup: optionalText(40),
  /// Excel: "Remarks" (Manual)
  remarks: optionalText(2000),
  /// Excel: "Excess" - a fraction (0.02 = 2%). Requested, not granted.
  excessPct: fraction('Excess').optional(),
  /// Required whenever excessPct > 0 - it goes to the Director.
  excessJustification: optionalText(2000),
});

export const createOrderSchema = orderBody
  .refine((d) => (d.lines?.length ?? 0) > 0 || (Boolean(d.styleId) && d.orderQty != null), {
    message: 'An order needs at least one style and quantity',
    path: ['lines'],
  })
  .refine(
  (d) => !d.excessPct || Number(d.excessPct) === 0 || Boolean(d.excessJustification),
  { message: 'A justification is required when an excess is requested', path: ['excessJustification'] },
);

/** Every field optional on edit; the service decides what may actually move. */
export const updateOrderSchema = orderBody.partial();

export const amendOrderSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(2000),
  buyerId: uuid.optional(),
  styleId: uuid.optional(),
  orderQty: pieces('Order quantity').optional(),
  colorCode: optionalText(60),
  sizeGroup: optionalText(40),
  buyerDeliveryDate: isoDate.nullish(),
  excessPct: fraction('Excess').optional(),
  excessJustification: optionalText(2000),
});

/**
 * Excess approval. `approvedPct` is optional - omitting it grants exactly what
 * was requested. The service refuses anything above the requested figure.
 */
export const approveExcessSchema = z.object({
  approvedPct: fraction('Approved excess').optional(),
  remarks: optionalText(2000),
});

export const rejectExcessSchema = z.object({
  reason: z.string().trim().min(3, 'A rejection needs a reason').max(2000),
});

/**
 * Pricing an order: a price per line, and the commercial terms.
 *
 * Lines are named by id, because a price belongs to one particular line and
 * an order may hold the same style twice in different colours.
 */
export const setPricingSchema = z.object({
  ...commercialTerms,
  currency: optionalText(10),
  lines: z
    .array(z.object({ id: uuid, unitPrice: price('Unit price') }))
    .max(500)
    .optional(),
});

export const setOrderStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED']),
});

/** Requirement preview for an order that has not been saved yet. */
export const previewSchema = z.object({
  styleId: uuid,
  orderQty: pieces('Order quantity'),
  excessPct: fraction('Excess').optional(),
});
