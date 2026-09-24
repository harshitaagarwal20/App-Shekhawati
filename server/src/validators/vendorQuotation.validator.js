/**
 * Vendor Quotation validation.
 *
 * There is deliberately no `amount` in any schema below, and no
 * `authorisationStatus`, `approvedAt` or `approvedByName` either. Zod strips
 * unknown keys, so a client that posts a total - or posts itself an approval -
 * has the field silently discarded before the service runs.
 *
 * Amount is `qty x rateQuoted`, computed in vendorQuotation.service.js and
 * nowhere else. The decision fields are set only by the approve / reject
 * endpoints, which sit behind VENDOR_QUOTATION.APPROVE.
 */

import { z } from 'zod';
import { decimal, isoDate, listQuery, optionalText, uuid } from './common.validator.js';

export const quotationListQuery = listQuery.extend({
  /// Only the lines of one quote document.
  headerId: uuid.optional(),
  authorisationStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  vendorId: uuid.optional(),
  orderId: uuid.optional(),
  item: z.string().trim().max(60).optional(),
  uom: z.string().trim().max(20).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

const quotationBody = z.object({
  /// Excel: "Quotation No" (Auto - QT-001). Left blank, the server issues one.
  quotationNo: optionalText(40),
  /// Excel: "Date" (Auto) - defaults to today.
  quotationDate: isoDate.optional(),
  /// Excel: "Item" (Dropdown -> L_ItemCategory)
  item: z.string().trim().min(1, 'Item is required').max(60),
  /// Fabric detail, mirroring the PO sheet (-> L_FabricSubCat).
  subCategory: optionalText(60),
  /// Accessory detail, mirroring the PO sheet (-> L_AccessoriesItem).
  accessoriesItem: optionalText(80),
  /// Free-text type of the accessory - "4-hole horn, 18L" for a Button.
  accessoryType: optionalText(120),
  /// Excel: "Vendor Name" (Dropdown -> Vendor Master)
  vendorId: uuid,
  /// Excel: "Qty" (Manual)
  qty: decimal('Quantity', { min: 0, allowZero: false }),
  /// Excel: "UOM" (Dropdown -> L_UOM)
  uom: z.string().trim().min(1, 'UOM is required').max(20),
  /// Excel: "Rate Quoted" (Manual)
  rateQuoted: decimal('Rate', { min: 0 }),
  /// Excel: "Authorised By" (Auto -> L_AuthorisedBy), e.g. "Dinesh Sir".
  /// Who the quotation is being put in front of; the decision itself is taken
  /// on the approve / reject endpoints and stamps its own name.
  authorisedBy: optionalText(120),
  /// Excel: "Remarks" (Text), e.g. "Lowest of 3 quotes"
  remarks: optionalText(2000),
  /// The buyer order this quotation was raised for.
  orderId: uuid.nullish(),
});

export const createQuotationSchema = quotationBody;

/**
 * MULTI-LINE: one vendor quote, several items. The header carries the vendor,
 * date and number; each line is what a single quotation always was.
 */
const quotationLine = quotationBody
  .omit({ quotationNo: true, quotationDate: true, vendorId: true })
  .extend({ orderId: uuid.nullish() });

export const createQuotationDocumentSchema = z.object({
  quotationNo: optionalText(40),
  quotationDate: isoDate.optional(),
  vendorId: uuid,
  orderId: uuid.nullish(),
  /// The vendor's own reference on their quote.
  vendorRefNo: optionalText(60),
  /// Prices held until.
  validUntil: isoDate.nullish(),
  authorisedBy: optionalText(120),
  remarks: optionalText(2000),
  lines: z.array(quotationLine).min(1, 'Add at least one item').max(100),
});

/** Every field optional on edit; the service decides what may actually move. */
export const updateQuotationSchema = quotationBody.partial();

// --- The decision ----------------------------------------------------------

export const approveQuotationSchema = z.object({
  remarks: optionalText(2000),
});

export const rejectQuotationSchema = z.object({
  reason: z.string().trim().min(3, 'A rejection needs a reason').max(2000),
});

export const reopenQuotationSchema = z.object({
  reason: z.string().trim().min(3, 'Reopening a decided quotation needs a reason').max(2000),
});

// --- Previews --------------------------------------------------------------

/**
 * Amount for a quotation that has not been saved yet. The form asks for this
 * rather than multiplying in the browser, so the figure on screen and the
 * figure in the database come from one piece of code.
 */
export const previewAmountSchema = z.object({
  qty: decimal('Quantity', { min: 0, allowZero: false }),
  rateQuoted: decimal('Rate', { min: 0 }),
});

export const quotationOptionsQuery = z.object({
  orderId: uuid.optional(),
  vendorId: uuid.optional(),
  approvedOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
