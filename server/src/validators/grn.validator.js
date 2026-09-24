/**
 * GRN and inventory validation.
 *
 * Absent from every schema below, deliberately: `amount`, `variationPct`,
 * `toleranceBreached`, `postedAt`, `postedByName`, `inventoryItemId`, and every
 * column of the stock ledger and the stock balance.
 *
 * The first three are formulas (grn.service.js). The posting stamp is set
 * inside the transaction that actually posts. The item is resolved from the PO.
 * And the ledger has no input schema at all, because there is no endpoint that
 * writes a movement directly - the only way stock moves in this application is
 * as a consequence of a document, through `postMovement()`.
 */

import { z } from 'zod';
import { decimal, isoDate, listQuery, optionalText, requiredText, uuid } from './common.validator.js';


const grnPurpose = z.enum([
  'RAW_MATERIAL',
  'DYEING',
  'PRINTING',
  'JOB_WORK_RETURN',
  'ACCESSORIES',
]);
const statusGeneral = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED']);

export const grnListQuery = listQuery.extend({
  /// Only the lines of one receipt document.
  headerId: uuid.optional(),
  purchaseOrderId: uuid.optional(),
  vendorId: uuid.optional(),
  gatePassId: uuid.optional(),
  itemId: uuid.optional(),
  purpose: grnPurpose.optional(),
  status: statusGeneral.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  /** Receipts that came in over tolerance - the thing worth looking at. */
  breachesOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/**
 * One roll on a multi-roll delivery.
 *
 * A fabric receipt is usually several rolls, each with its own number and its
 * own length. The service refuses a list whose quantities do not add up to the
 * receiving quantity: stock that no roll accounts for is stock nobody can find.
 */
const rollLine = z.object({
  /// Left blank, the server issues FAB-nnn from the roll sequence.
  rollNo: optionalText(40),
  qty: decimal('Roll quantity', { min: 0, allowZero: false }),
  /// Excel: "Width" (Dye issue, in inches)
  width: decimal('Width', { min: 0, allowZero: false }).nullish(),
  construction: optionalText(20),
  fabricName: optionalText(120),
  /// Shade band and dye lot, from the mill's packing list. Optional - see
  /// FabricRoll.shade for why an ungraded roll stays honestly blank.
  shade: optionalText(20),
  dyeLot: optionalText(40),
  remarks: optionalText(500),
});

export const createGrnSchema = z.object({
  /// System GRN number (GRN-001). Left blank, the server issues one.
  grnNo: optionalText(40),
  /// Excel: "PO ID" (Dropdown -> PO). The receipt's whole authority.
  purchaseOrderId: uuid,
  /// Excel: "Bill No" (Manual) - the vendor's invoice. Unique per PO.
  /// Must not be blank, must be uppercase, max 60 chars
  billNo: requiredText(60, 'Bill number')
    .transform((v) => v.toUpperCase().trim())
    .refine((v) => /^[A-Z0-9\-/.]+$/.test(v), 'Bill number can only contain letters, numbers, and -/.'),
  /// Excel: "Date" (Auto) - defaults to today.
  /// Cannot be a future date
  grnDate: isoDate
    .optional()
    .refine((date) => !date || new Date(date) <= new Date(), 'GRN date cannot be in the future'),
  /// Excel: "purpose" (Dropdown -> L_GRNPurpose)
  purpose: grnPurpose,
  /// Excel: "Receiving Qty" (Manual)
  /// Must be > 0, reasonable upper limit
  receivingQty: decimal('Receiving quantity', { min: 0, allowZero: false })
    // decimal() hands back a string, not a Decimal - compare it as a number.
    .refine((qty) => Number(qty) <= 999999, 'Receiving quantity seems unreasonably high'),
  /// Excel: "Inventory Rate" (Formula). Left blank, the PO rate is used.
  /// Must be positive if provided
  inventoryRate: decimal('Inventory rate', { min: 0 }).nullish(),
  /// Excel: "HSN Code" (Auto, from PO). Overridable when the bill differs.
  /// Must be valid HSN format if provided
  hsnCode: optionalText(20)
    .refine((code) => !code || /^(\d{4}|\d{6}|\d{8})$/.test(code), 'HSN code must be 4, 6 or 8 digits'),

  /// The GST the vendor charged on this bill.
  gstRatePct: optionalText(20),

  /// Excel: "Roll No" (Manual) - for a single-roll receipt.
  rollNo: optionalText(40),
  /// Several rolls, when the delivery came as several.
  rolls: z.array(rollLine).max(200).optional(),

  /// Where the goods were put (-> L_StockLocation). Defaults to the main store.
  location: optionalText(80),
  /// The inward gate pass the goods entered on.
  gatePassId: uuid.nullish(),

  /**
   * Over-tolerance receipts are recorded, not refused - the goods are in the
   * yard either way. What is refused is recording one SILENTLY: the first
   * attempt comes back with the numbers and this flag unset, and the checker
   * has to send it again saying they know.
   */
  acknowledgeToleranceBreach: z.boolean().optional(),

  /// Excel: "Remarks" (Text)
  remarks: optionalText(2000),
}).strict();

/**
 * MULTI-LINE: one delivery against one vendor bill, receiving several PO
 * lines. The bill, date, location and gate pass are the document's; each
 * line is what a single GRN always was.
 */
const grnLine = createGrnSchema
  .omit({ grnNo: true, billNo: true, grnDate: true, location: true, gatePassId: true })
  .extend({ purpose: grnPurpose.optional() });

export const createGrnDocumentSchema = z
  .object({
    grnNo: optionalText(40),
    billNo: requiredText(60, 'Bill number')
      .transform((v) => v.toUpperCase().trim())
      .refine((v) => /^[A-Z0-9\-/.]+$/.test(v), 'Bill number can only contain letters, numbers, and -/.'),
    billDate: isoDate.nullish(),
    grnDate: isoDate
      .optional()
      .refine((date) => !date || new Date(date) <= new Date(), 'GRN date cannot be in the future'),
    /// The purpose for every line that does not state its own.
    purpose: grnPurpose.optional(),
    gstRatePct: optionalText(20),
    location: optionalText(80),
    gatePassId: uuid.nullish(),
    acknowledgeToleranceBreach: z.boolean().optional(),
    headerRemarks: optionalText(2000),
    lines: z.array(grnLine).min(1, 'Add at least one line').max(50),
  })
  .refine((d) => d.purpose || d.lines.every((l) => l.purpose), {
    message: 'Give the purpose on the receipt or on every line',
    path: ['purpose'],
  });

/**
 * Editing a receipt.
 *
 * Quantities, rates, the PO and the rolls are all absent. They are in the stock
 * ledger, which is append-only; a receipt entered wrongly is corrected by a
 * reversal, not by editing what the ledger already recorded.
 */
export const updateGrnSchema = z.object({
  billNo: z.string().trim().min(1).max(60).optional(),
  grnDate: isoDate.optional(),
  purpose: grnPurpose.optional(),
  hsnCode: optionalText(20),
  // `status` is deliberately absent. A fulfilment status is a controlled
  // transition, not a field: it moves through POST /grns/:id/status, which
  // checks the move against the table in approvalEngine.js. Letting it be
  // set here would allow a screen to mark a cancelled receipt completed.
  remarks: optionalText(2000),
});

/** Moving a receipt's fulfilment status. The transition is checked server-side. */
export const setGrnStatusSchema = z.object({
  status: statusGeneral,
  remarks: optionalText(2000),
});

/**
 * The receipt figures for a GRN that has not been saved yet: amount, variance,
 * the tolerance it is measured against, and the stock item it will land on.
 */
export const previewGrnSchema = z.object({
  purchaseOrderId: uuid,
  receivingQty: decimal('Receiving quantity', { min: 0 }).optional(),
  inventoryRate: decimal('Inventory rate', { min: 0 }).nullish(),
});

// ===========================================================================
//  INVENTORY, LEDGER AND ROLLS
// ===========================================================================

export const itemListQuery = listQuery.extend({
  itemCategory: z.string().trim().max(60).optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  lowStock: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/**
 * What may be edited on a stock item.
 *
 * Not the identity columns - category, sub-category, colour, GSM, count, UOM.
 * Those seven are what makes the item that item, they are the unique key on the
 * table, and every receipt and every ledger row already points at them. An item
 * that needs different ones is a different item.
 */
export const updateItemSchema = z.object({
  description: z.string().trim().min(1).max(200).optional(),
  reorderLevel: decimal('Reorder level', { min: 0 }).optional(),
  hsnCode: optionalText(20),
  isActive: z.boolean().optional(),
});

export const ledgerListQuery = listQuery.extend({
  itemId: uuid.optional(),
  rollId: uuid.optional(),
  orderId: uuid.optional(),
  location: z.string().trim().max(80).optional(),
  documentType: z
    .enum([
      'GRN',
      'FABRIC_ISSUE',
      'DYE_ISSUE',
      'DYEING_RECEIPT',
      'PRINTING',
      'FABRIC_SCRUTINY',
      'CUTTING_ISSUE',
    ])
    .optional(),
  direction: z.enum(['IN', 'OUT']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const rollListQuery = listQuery.extend({
  stage: z
    .enum([
      'RAW',
      'ISSUED_FOR_DYEING',
      'ISSUED_FOR_PRINTING',
      'DYED',
      'PRINTED',
      'SCRUTINY_HOLD',
      'ISSUED_TO_CUTTING',
      'CONSUMED',
      'REJECTED',
    ])
    .optional(),
  location: z.string().trim().max(80).optional(),
  vendorId: uuid.optional(),
  grnId: uuid.optional(),
  itemId: uuid.optional(),
  colorCode: z.string().trim().max(60).optional(),
  shade: z.string().trim().max(20).optional(),
  dyeLot: z.string().trim().max(40).optional(),
  inStockOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  isHeld: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

/**
 * Grading a roll's shade and dye lot. Empty clears. `remarks` says how it was
 * judged - "light box, against buyer's standard".
 */
export const markRollShadeSchema = z.object({
  shade: optionalText(20),
  dyeLot: optionalText(40),
  remarks: optionalText(500),
});

/** Moving a roll between store locations. The stock does not move, the shelf does. */
export const relocateRollSchema = z.object({
  location: requiredText(80, 'Location'),
  remarks: optionalText(500),
});

/**
 * The stock screen is a list, so it accepts the list query every other list
 * accepts - page, pageSize, search - rather than a bespoke pair of filters.
 *
 * `lowStock` is a string here because it arrives in a query string; the same
 * true/false shape the item list already uses.
 */
export const stockSummaryQuery = listQuery.extend({
  location: z.string().trim().max(80).optional(),
  itemCategory: z.string().trim().max(60).optional(),
  lowStock: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/**
 * Reconciling the balance cache against the ledger.
 *
 * `dryRun` reports the differences without writing, which is the form an
 * auditor wants. Without it the balances are rebuilt from the movements.
 */
export const reconcileQuery = z.object({
  dryRun: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const itemOptionsQuery = z.object({
  itemCategory: z.string().trim().max(60).optional(),
  rollTrackedOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
