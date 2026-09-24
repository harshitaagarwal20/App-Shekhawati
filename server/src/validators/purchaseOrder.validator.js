/**
 * Purchase Order validation.
 *
 * There is deliberately no `amount` in any schema below, and no
 * `approvalStatus`, `approvedAt`, `approvedByName`, `decidedAt` or
 * `receivedQty` either. Zod strips unknown keys, so a client that posts a total
 * - or posts itself an approval, or posts goods it has not received - has the
 * field silently discarded before the service runs.
 *
 * Amount is `orderQty x rate`, computed in purchaseOrder.service.js and nowhere
 * else. The decision fields are set only by the approve / reject endpoints,
 * which sit behind PURCHASE_ORDER.APPROVE. `receivedQty` is maintained by the
 * GRN posting transaction and by nothing else at all.
 */

import { z } from 'zod';
import { decimal, fraction, isoDate, listQuery, optionalText, uuid } from './common.validator.js';

/// C1: the two modes a PO may run in. Deliberately has no `.default()` -
/// see the create schema below.
const orderMode = z.enum(['AS_PER_STYLE', 'BULK']);
const statusGeneral = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED']);

export const poListQuery = listQuery.extend({
  /// Only the lines of one PO document.
  headerId: uuid.optional(),
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  status: statusGeneral.optional(),
  vendorId: uuid.optional(),
  orderId: uuid.optional(),
  quotationId: uuid.optional(),
  item: z.string().trim().max(60).optional(),
  uom: z.string().trim().max(20).optional(),
  orderMode: orderMode.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  pendingReceipt: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const poBody = z.object({
  /// Excel: "PO ID" (Auto - "Vendor initial + no"). Left blank, the server
  /// draws the next number from that vendor's own series.
  poId: optionalText(40),
  /// Excel: "Date" (Auto) - defaults to today.
  poDate: isoDate.optional(),

  /// Excel: "Item" (Dropdown -> L_ItemCategory)
  item: z.string().trim().min(1, 'Item is required').max(60),
  /// Excel: "sub - category" (Dropdown -> L_FabricSubCat), e.g. "10 oz"
  subCategory: optionalText(60),
  /// Excel: "Accessories item" - shown only when Item = Accessories
  accessoriesItem: optionalText(80),
  /// Free-text type of the accessory - "4-hole horn, 18L" for a Button.
  accessoryType: optionalText(120),

  /// Excel: "Vender Name" (Dropdown -> Vendor Master)
  vendorId: uuid,
  /// Excel: "Address" (Auto, from Vendor Master). Left blank, the vendor's
  /// current address is snapshotted onto the PO.
  address: optionalText(2000),

  /// Excel: "UOM" (Dropdown -> L_UOM)
  uom: z.string().trim().min(1, 'UOM is required').max(20),
  /// Excel: "Order Qty" (Manual)
  orderQty: decimal('Order quantity', { min: 0, allowZero: false }),
  /// Excel: "Rate" (Manual)
  rate: decimal('Rate', { min: 0 }),

  /// Excel: "Excess Allowed" - sheet note "2-3%". A fraction (0.02 = 2%).
  /// The ceiling by item category is enforced by the service, not here: it
  /// depends on whether the line is an accessory, which is another field.
  excessAllowed: fraction('Excess allowed').optional(),

  /// Excel: "HSN Code" (Manual)
  hsnCode: optionalText(20),
  /// Excel: "GSM" (Dropdown -> L_GSM)
  gsm: optionalText(20),
  /// Excel: "Content" (Text -> L_FabricContent)
  content: optionalText(80),
  /// Excel: "Color code" (Dropdown -> L_ColorCode)
  colorCode: optionalText(60),
  /// Excel: "Count" (Manual -> L_Count)
  count: optionalText(20),

  /// C1 / Process Doc s.5. BULK exempts the quantity from the style ceiling,
  /// so it is an explicit choice rather than a default.
  ///
  /// REQUIRED on the body, and optional only on the partial update schema
  /// below - where an omitted mode means "leave the stored one alone", not
  /// "assume one". There is no `.default()` here, no default in the service
  /// and no DEFAULT on the column: a PO that does not say how it should be
  /// bounded is refused rather than guessed at.
  orderMode,

  /// The chain: Order -> Quotation -> PO.
  orderId: uuid.nullish(),
  styleId: uuid.nullish(),
  quotationId: uuid.nullish(),

  /// Excel: "Remarks" (Text)
  remarks: optionalText(2000),
});

export const createPoSchema = poBody;

/**
 * MULTI-LINE: one PO, many items, one vendor. The header carries the vendor,
 * date, number and delivery terms; every line is what a single PO always was
 * and is judged by the same ceilings.
 */
const poLine = poBody.omit({ poId: true, poDate: true, vendorId: true, address: true });

export const createPoDocumentSchema = z.object({
  poNo: optionalText(40),
  poDate: isoDate.optional(),
  vendorId: uuid,
  address: optionalText(2000),
  /// The buyer order most lines are for. A line may name its own.
  orderId: uuid.nullish(),
  deliveryDate: isoDate.nullish(),
  paymentTerms: optionalText(150),
  headerRemarks: optionalText(2000),
  lines: z.array(poLine).min(1, 'Add at least one item').max(100),
});

/** Every field optional on edit; the service decides what may actually move. */
export const updatePoSchema = poBody.partial();

// --- The decision ----------------------------------------------------------

export const approvePoSchema = z.object({
  remarks: optionalText(2000),
});

export const rejectPoSchema = z.object({
  reason: z.string().trim().min(3, 'A rejection needs a reason').max(2000),
});

export const reopenPoSchema = z.object({
  reason: z.string().trim().min(3, 'Reopening a decided PO needs a reason').max(2000),
});

/** The fulfilment status - about goods, not about authority. */
export const setPoStatusSchema = z.object({
  status: statusGeneral,
});

// --- Previews --------------------------------------------------------------

/**
 * Everything the form needs for a PO that has not been saved yet: the amount,
 * the excess ceiling and the style ceiling. The browser asks rather than
 * calculating, so the figures on screen are the figures that will be stored.
 */
export const previewPoSchema = z.object({
  item: z.string().trim().min(1, 'Item is required').max(60),
  subCategory: optionalText(60),
  accessoriesItem: optionalText(80),
  uom: optionalText(20),
  vendorId: uuid.optional(),
  orderQty: decimal('Order quantity', { min: 0 }).optional(),
  rate: decimal('Rate', { min: 0 }).optional(),
  excessAllowed: fraction('Excess allowed').optional(),
  orderMode: orderMode.optional(),
  orderId: uuid.nullish(),
  styleId: uuid.nullish(),
  /** When editing, the PO being edited does not count against its own ceiling. */
  excludeId: uuid.optional(),
});

export const poOptionsQuery = z.object({
  vendorId: uuid.optional(),
  orderId: uuid.optional(),
  approvedOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  openOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
