/**
 * Gate Pass validation.
 *
 * `variationPct` appears in no schema below. It is
 * `(qty - receivedQty) / qty`, computed in gatePass.service.js and nowhere
 * else; Zod strips a posted one before the service runs, and a CHECK constraint
 * refuses a stored one that disagrees with the two quantities.
 *
 * `clearedAt`, `clearedById` and `clearedByName` are absent for the same reason
 * an approval is absent from the quotation schemas: clearing a gate pass is an
 * act with a name attached, and the name is stamped by the /clear endpoint from
 * the authenticated session rather than typed into a form.
 */

import { z } from 'zod';
import { decimal, isoDate, listQuery, optionalText, uuid } from './common.validator.js';


/**
 * What a number plate can actually look like.
 *
 * ---------------------------------------------------------------------------
 *  A SHAPE, NOT JUST A CHARACTER SET
 *
 *  This was "letters, digits and spaces", which let a hand resting on the
 *  keyboard through - ASKLJKYHTGREWQQWEYUHGFDSA is all letters and all spaces
 *  are fine, so it saved. A gate pass whose vehicle number is noise is worse
 *  than one with the field left blank: blank says "we did not record it",
 *  noise says "this lorry" and names nothing.
 *
 *  FOUR SHAPES, because India issues four and all four reach a gate:
 *
 *    STANDARD    RJ 14 GA 1234 - state, district, series, number. The series
 *                is 0-3 letters: MH 01 1234 and DL 1 CAA 1234 are both real.
 *    BH SERIES   26 BH 1234 AA - the all-India registration.
 *    DEFENCE     10 EF 123456 K - army and paramilitary.
 *    DIPLOMATIC  33 CD 0001 - corps diplomatique, consular, UN.
 *
 *  Anything else is refused with an example rather than a rule, because a
 *  checker copying a plate needs to see what a good one looks like, not read a
 *  grammar. If a real plate is ever refused, widen this list - do not remove
 *  it and go back to accepting noise.
 * ---------------------------------------------------------------------------
 */
const PLATE_PATTERNS = [
  /^[A-Z]{2} ?\d{1,2} ?[A-Z]{0,3} ?\d{1,4}$/,      // RJ 14 GA 1234
  /^\d{2} ?BH ?\d{4} ?[A-Z]{1,2}$/,                // 26 BH 1234 AA
  /^\d{2} ?[A-Z]{1,2} ?\d{6} ?[A-Z]?$/,            // 10 EF 123456 K
  /^\d{1,3} ?(CD|CC|UN) ?\d{1,4}$/,                // 33 CD 0001
];

/** True for a plate somebody could actually be looking at. */
export function looksLikeAPlate(value) {
  const v = String(value ?? '').toUpperCase().replace(/[\s-]+/g, ' ').trim();
  return PLATE_PATTERNS.some((re) => re.test(v));
}

const gatePassType = z.enum(['INWARD', 'OUTWARD']);
const gatePassStatus = z.enum(['PENDING', 'CLEARED']);
const purpose = z.enum([
  'CUTTING',
  'DYEING',
  'PRINTING',
  'STITCHING',
  'RETURN',
  'SAMPLING',
  'OTHER',
]);

export const gatePassListQuery = listQuery.extend({
  type: gatePassType.optional(),
  status: gatePassStatus.optional(),
  purpose: purpose.optional(),
  vendorId: uuid.optional(),
  purchaseOrderId: uuid.optional(),
  linkedDocNo: z.string().trim().max(40).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  /** The checker's daily view: everything that did not match. */
  withVariation: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const gatePassBody = z.object({
  /// Excel: "Gate Pass No" (Auto - GP-001). Left blank, the server issues one.
  gatePassNo: optionalText(40),
  /// Excel: "Date" (Auto) - defaults to today.
  gatePassDate: isoDate.optional(),

  /**
   * C8 - WHEN THE GOODS ACTUALLY CROSSED THE GATE.
   *
   * Required on both directions, inward and outward. Not defaulted to now():
   * the whole reason this column exists is that a lorry cleared at 21:40 is
   * routinely written up the next morning, and quietly stamping the moment the
   * record was typed would reintroduce exactly the error C8 removes.
   *
   * Optional at the schema level and required by the service, so the refusal
   * can explain that difference rather than just saying "required". A future
   * time is refused by the service and by the
   * gate_passes_movement_time_not_future trigger.
   */
  movementTime: isoDate.optional(),

  /// Excel: "Type" (Dropdown -> Inward / Outward)
  type: gatePassType,

  /// Excel: "Linked PO / Challan No" - RF-001, DY-001, CH-001.
  ///
  /// Optional HERE and conditional in the SERVICE. An INWARD pass may be raised
  /// on the vendor and the time alone and allocated afterwards - the gate does
  /// not know the order number while the lorry is standing there. An OUTWARD
  /// pass still needs it, and the service says so in a sentence rather than
  /// with "required", because the refusal has to explain which of the two
  /// cases the user is in.
  linkedDocNo: optionalText(40),

  /// Excel: "Item" - free text on this sheet ("Dyed Fabric", "Cut Panels").
  /// Left blank, it is copied from the linked document.
  item: optionalText(80),
  /// Excel: "Vendor / Unit Name". Left blank, both are copied from the link.
  vendorId: uuid.nullish(),
  partyName: optionalText(150),

  /// Excel: "Qty" (Auto - from the linked document). Supplying it narrows the
  /// pass to part of the delivery; the service refuses a value that widens it.
  qty: decimal('Quantity', { min: 0, allowZero: false }).optional(),
  /// Excel: "Received Qty" (Manual) - the one number only the gate can know.
  receivedQty: decimal('Received quantity', { min: 0 }).nullish(),
  /// Excel: "UOM" (Auto -> L_UOM). Left blank, copied from the linked document.
  uom: optionalText(20),

  /// Excel: "Purpose" (Dropdown -> L_Purpose). Optional on an unallocated
  /// inward pass: what the goods are FOR is a property of the document they
  /// answer, which is not known yet.
  purpose: purpose.optional(),

  /**
   * The vehicle the goods crossed on. Optional - not always knowable at the
   * gate, and a mandatory field the checker cannot answer gets answered "NA".
   *
   * NORMALISED, NOT POLICED. Case and spacing are cleaned up so the same lorry
   * is not filed three ways ("rj14ga1234", "RJ 14 GA 1234", "RJ-14-GA-1234"),
   * and characters that cannot appear on a plate are refused.
   *
   * The SHAPE is checked too - see `looksLikeAPlate` above. Character
   * filtering alone let a hand resting on the keyboard through.
   */
  vehicleNo: optionalText(30)
    .transform((v) => (v == null ? v : v.toUpperCase().replace(/[\s-]+/g, ' ').trim()))
    .refine((v) => v == null || v === '' || looksLikeAPlate(v), {
      message:
        'That does not look like a vehicle number. Use the number as printed on '
        + 'the plate, for example "RJ 14 GA 1234". Leave it blank if there is no vehicle.',
    }),

  /// Who was driving. Optional, like the vehicle, and for the same reason.
  driverName: optionalText(120),

  /// Excel: "Authorised By" - either an L_AuthorisedBy value ("Dinesh Sir") or
  /// an employee name. Naming the employee resolves the link properly.
  authorisedBy: optionalText(120),
  authorisedEmployeeId: uuid.nullish(),

  /// Excel: "Status" (Dropdown -> Pending / Cleared).
  ///
  /// Accepted ONLY on create, and only alongside a received quantity - it is
  /// how a checker who counted at the gate raises and clears a pass in one
  /// action. It is stripped from the update schema below: once a pass exists,
  /// clearing it is POST /:id/clear, which stamps who did it.
  status: gatePassStatus.optional(),

  /// Excel: "Remarks" (Text)
  remarks: optionalText(2000),
});

export const createGatePassSchema = gatePassBody;

/**
 * Every field optional on edit; the service decides what may actually move.
 *
 * `status` is omitted: clearing a gate pass asserts that goods physically
 * moved, and that is POST /:id/clear - which requires a counted quantity and
 * stamps who counted it. An edit that could set CLEARED would let a pass be
 * cleared by somebody who never went to the gate.
 */
export const updateGatePassSchema = gatePassBody.partial().omit({ status: true });

// --- Clearing the pass -----------------------------------------------------

/**
 * The goods have been counted at the gate.
 *
 * `receivedQty` is required here and optional everywhere else, because this is
 * the moment it stops being a guess.
 */
export const clearGatePassSchema = z.object({
  receivedQty: decimal('Received quantity', { min: 0 }),
  remarks: optionalText(2000),
});

export const reopenGatePassSchema = z.object({
  reason: z.string().trim().min(3, 'Reopening a cleared gate pass needs a reason').max(2000),
});

// --- Previews --------------------------------------------------------------

/**
 * Resolves the linked document and works out the quantity and the variation for
 * a gate pass that has not been saved yet - so the checker sees what the PO is
 * still expecting before typing anything.
 */
export const previewGatePassSchema = z.object({
  linkedDocNo: z.string().trim().min(1, 'A linked document is required').max(40),
  type: gatePassType.optional(),
  qty: decimal('Quantity', { min: 0 }).optional(),
  receivedQty: decimal('Received quantity', { min: 0 }).nullish(),
});

export const gatePassOptionsQuery = z.object({
  purchaseOrderId: uuid.optional(),
  type: gatePassType.optional(),
  clearedOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  withoutGrn: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/**
 * Attaching the document a delivery answers.
 *
 * `qty` narrows the pass to part of the delivery, exactly as it does on create;
 * left out, the document's own outstanding quantity is taken.
 */
export const allocateGatePassSchema = z.object({
  linkedDocNo: z.string().trim().min(1, 'Name the document this delivery answers').max(40),
  qty: decimal('Quantity', { min: 0, allowZero: false }).optional(),
  purpose: purpose.optional(),
  remarks: optionalText(2000),
});
