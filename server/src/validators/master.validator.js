/**
 * Zod schemas for the Phase 2 masters.
 *
 * Dropdown fields are validated here only for shape (a trimmed string of the
 * right length). Membership of the correct Master List is checked in the
 * service layer against the database, because the list content is data, not
 * code - a value added to a list this morning must be accepted this afternoon
 * without a redeploy.
 */

import { z } from 'zod';
import {
  decimal,
  email,
  fraction,
  listQuery,
  optionalText,
  requiredText,
  statusActive,
  uuid,
} from './common.validator.js';

const dropdown = (max = 80) => optionalText(max);
const requiredDropdown = (max, label) => requiredText(max, label);

// --- List Master -----------------------------------------------------------

export const masterListQuery = listQuery;

export const createMasterListSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Code must start with a letter and contain only letters, numbers and underscore'),
  name: requiredText(120, 'List name'),
  description: optionalText(255),
});

export const updateMasterListSchema = createMasterListSchema.partial();

export const createValueSchema = z.object({
  value: requiredText(150, 'Value'),
  code: optionalText(60),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
  attributes: z.record(z.any()).optional(),
});

export const updateValueSchema = createValueSchema.partial();

export const setActiveSchema = z.object({ isActive: z.boolean() });
export const setStatusSchema = z.object({ status: statusActive });

// --- Buyer -----------------------------------------------------------------

export const buyerListQuery = listQuery.extend({
  country: z.string().trim().max(80).optional(),
});

/**
 * One entry in a buyer's address book.
 *
 * `label` and `address` are both required: an address with no label cannot be
 * told apart in the picker, and a label with no address is a heading over
 * nothing. Everything else is optional, because a buyer's warehouse abroad
 * often has no contact name the office knows.
 */
const buyerAddressSchema = z.object({
  label: requiredText(80, 'Address label'),
  name: optionalText(200),
  address: requiredText(1000, 'Address'),
  country: optionalText(80),
});

export const createBuyerSchema = z.object({
  /*
   * The whole book, replaced as one. The order of the array IS the order the
   * picker offers them in, so it is meaningful and is stored as `lineNo`.
   *
   * Twenty is not a technical limit - it is the point past which a dropdown
   * stops being quicker than typing, and a buyer with more destinations than
   * that is telling us something the address book is the wrong shape for.
   */
  addresses: z.array(buyerAddressSchema).max(20, 'A buyer can hold at most 20 addresses').optional(),
  // Typed by the user, not derived. A buyer's code is how the office refers
  // to them on paper, so it is theirs to choose and theirs to keep stable.
  buyerCode: requiredText(20, 'Buyer code'),
  buyerName: requiredText(150, 'Buyer name'),
  address: optionalText(1000),
  country: dropdown(80),
  contactPerson: optionalText(120),
  email: email.nullish(),
  phone: optionalText(40),
  currency: dropdown(10),
  paymentTerms: dropdown(150),
  status: statusActive.default('ACTIVE'),
  consigneeName: optionalText(200),
  consigneeAddress: optionalText(1000),
  notifyPartyName: optionalText(200),
  notifyPartyAddress: optionalText(1000),
  destination: optionalText(120),
  portOfDischarge: optionalText(120),
  finalDestination: optionalText(120),
  priceTerms: dropdown(150),
  shipMode: dropdown(40),
  freightTerms: dropdown(40),
});

export const updateBuyerSchema = createBuyerSchema.partial();

// --- Vendor ----------------------------------------------------------------

export const vendorListQuery = listQuery.extend({
  category: z.string().trim().max(60).optional(),
});

export const createVendorSchema = z.object({
  vendorCode: optionalText(20),
  vendorName: requiredText(150, 'Vendor name'),
  category: requiredDropdown(60, 'Category'),
  address: optionalText(1000),
  city: optionalText(120),
  vendorLocation: optionalText(120),
  gstNo: z
    .string()
    .trim()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/, 'Must be a valid 15-character GSTIN')
    .nullish()
    .or(z.literal('').transform(() => null)),
  contactPerson: optionalText(120),
  phone: optionalText(40),
  email: email.nullish(),
  bankDetails: optionalText(200),
  status: statusActive.default('ACTIVE'),
  remarks: optionalText(2000),
  poInitials: optionalText(10),
  pinCode: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'Pin code must be 6 digits')
    .nullish()
    .or(z.literal('').transform(() => null)),
});

export const updateVendorSchema = createVendorSchema.partial();

// --- Employee --------------------------------------------------------------

export const employeeListQuery = listQuery.extend({
  department: z.string().trim().max(60).optional(),
  designation: z.string().trim().max(60).optional(),
});

export const createEmployeeSchema = z.object({
  empId: optionalText(20),
  empName: requiredText(120, 'Employee name'),
  department: requiredDropdown(60, 'Department'),
  designation: requiredDropdown(60, 'Designation'),
  unitLine: optionalText(80),
  status: statusActive.default('ACTIVE'),
});

export const updateEmployeeSchema = createEmployeeSchema.partial();

// --- Style + BOM -----------------------------------------------------------

export const styleListQuery = listQuery.extend({
  buyerId: uuid.optional(),
  category: z.string().trim().max(60).optional(),
});

/**
 * C9 - the BOM line, with `qtyPerPc` kept as a DEPRECATED ALIAS.
 *
 * ---------------------------------------------------------------------------
 *  WHY BOTH NAMES ARE ACCEPTED
 *
 *  The column was renamed from `qty_per_pc` to `avg_utilisation_per_piece`
 *  because that is what it always held and what C9 asks for. A rename inside
 *  one repository is cheap; a rename on a live API contract is not, and there
 *  is no way to know from here what else is posting to this endpoint.
 *
 *  So the schema takes either, normalises to the new name, and refuses only
 *  the case that is genuinely ambiguous: both supplied, disagreeing. Silently
 *  preferring one of two conflicting figures for how much cloth a bag takes
 *  is exactly the kind of quiet wrong answer this system is built to avoid.
 * ---------------------------------------------------------------------------
 */
const bomLineSchema = z
  .object({
    itemCategory: requiredDropdown(60, 'Item category'),
    subCategory: dropdown(60),
    accessoriesItem: dropdown(80),
    description: optionalText(200),
    colorCode: dropdown(60),
    content: dropdown(80),
    gsm: dropdown(20),
    count: dropdown(20),
    construction: dropdown(20),
    /** The size or spec - "25 mm", "1.25\"", "5/1000 mtr". Free text. */
    variant: optionalText(60),
    uom: requiredDropdown(20, 'UOM'),
    /**
     * C9's name.
     *
     * ZERO IS ALLOWED, AND MEANS "NOT DECIDED YET".
     *
     * It used to be refused, on the reasoning that a requirement is never
     * silently zero. The reasoning holds; the refusal was in the wrong place.
     * `requirementFor()` already treats a per-piece figure of <= 0 as NO
     * REQUIREMENT rather than as a requirement of nothing - it returns
     * NO_UTILISATION naming this very line - and `assertRequirement()` turns
     * that into a refusal on the purchase order and the cutting challan. So a
     * zero here is not silent: it stops the two documents that would otherwise
     * be bounded by a number nobody has worked out.
     *
     * What the old rule actually prevented was REGISTERING a style before its
     * sampling decided the average, which forced somebody to invent a figure -
     * and an invented figure IS silent, because it caps procurement without
     * anything ever saying so.
     */
    avgUtilisationPerPiece: decimal('Average utilisation per piece', {
      min: 0,
    }).optional(),
    /** Deprecated alias for the field above. Same rule, for the same reason. */
    qtyPerPc: decimal('Qty per piece', { min: 0 }).optional(),
    /** C9 - the day this figure starts applying. Defaults to today. */
    effectiveFrom: z.coerce.date().optional(),
    /**
     * A FRACTION, like every other percentage in this system: 0.02 is 2%.
     *
     * It used `decimal({ min: 0 })`, which has no upper bound - so "5" for five
     * percent passed validation, reached the database, and died against
     * `style_bom_lines_wastage_range` (>= 0 AND < 1) with a constraint name
     * instead of a sentence. `fraction()` is the helper every other
     * fraction-stored percentage uses, and it refuses the same values the
     * column does, one layer earlier, saying what the figure should look like.
     */
    wastagePct: fraction('Wastage %').default('0'),
    hsnCode: optionalText(20),
    remarks: optionalText(2000),
  })
  .superRefine((line, ctx) => {
    const preferred = line.avgUtilisationPerPiece;
    const legacy = line.qtyPerPc;

    if (preferred === undefined && legacy === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['avgUtilisationPerPiece'],
        message:
          'Average utilisation per piece is required. A style BOM line with no utilisation ' +
          'cannot have a requirement computed from it, and a requirement is never treated as zero.',
      });
      return;
    }

    if (preferred !== undefined && legacy !== undefined && String(preferred) !== String(legacy)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['avgUtilisationPerPiece'],
        message:
          `avgUtilisationPerPiece (${preferred}) and the deprecated qtyPerPc (${legacy}) are ` +
          'the same field and disagree. Send one of them.',
      });
    }
  })
  .transform((line) => {
    const { qtyPerPc, ...rest } = line;
    return {
      ...rest,
      avgUtilisationPerPiece: line.avgUtilisationPerPiece ?? qtyPerPc,
      // C9: the day the figure starts applying. Today unless the office is
      // entering a revision that takes effect later.
      effectiveFrom: line.effectiveFrom ?? new Date(),
    };
  });

/**
 * A tech-pack measurement: positive, or blank.
 *
 * Blank is NULL, not zero - a bag of zero height is an empty cell that got
 * coerced, and `styles_dimensions_positive` would refuse it with a constraint
 * name. Refused here with a sentence instead.
 */
const measurement = (label) =>
  z
    .union([z.literal(''), z.null(), decimal(label, { min: 0, allowZero: false, max: 1e8 })])
    .optional()
    .transform((v) => (v === '' ? null : v));

/**
 * One panel of the bag. The component TYPE is closed because two rules read
 * it (handles are counted apart); the NAME is the tech pack's own wording.
 */
export const styleComponentSchema = z.object({
  componentType: z.enum(
    ['FRONT_PANEL', 'BACK_PANEL', 'GUSSET', 'BASE', 'HANDLE', 'STRAP', 'POCKET', 'FLAP', 'LINING', 'OTHER'],
    { errorMap: () => ({ message: 'Choose what kind of panel this is' }) },
  ),
  name: requiredText(80, 'Panel name'),
  piecesPerBag: z.coerce
    .number({ invalid_type_error: 'Pieces per bag must be a whole number' })
    .int('Pieces per bag must be a whole number')
    .min(1, 'A bag needs at least one of every panel it lists')
    .max(40, 'Pieces per bag cannot be more than 40'),
  cutLength: measurement('Cut length'),
  cutWidth: measurement('Cut width'),
  bomLineNo: z.coerce.number().int().positive().optional().nullable(),
  remarks: optionalText(500),
});

export const createStyleSchema = z.object({
  styleNo: requiredText(40, 'Style number'),
  styleDescription: requiredText(200, 'Style description'),
  buyerId: uuid,
  /**
   * Optional. The Style screen no longer asks for it, so a style created there
   * carries none; `validateHeader()` only checks the value when one is sent,
   * and the column takes '' rather than null because it is NOT NULL and no
   * migration is worth a field nobody fills in.
   *
   * Styles created before this still hold their category, and the list column
   * and filter still read it.
   */
  category: dropdown(60),
  fabricContent: dropdown(80),
  /**
   * The colourway this style number IS - "Natural", "Black", "Smoke Blue".
   *
   * Membership of L_ColorCode is checked in the service against the live list,
   * like every other dropdown here.
   */
  colorCode: dropdown(60),
  /**
   * Zero means the sampling has not decided it yet. See the BOM line's
   * avgUtilisationPerPiece above: the guard that matters lives in
   * requirementFor(), which refuses to compute against <= 0, so a style can be
   * registered before its average is known without that gap reaching a
   * purchase order or a cutting challan unannounced.
   */
  avgFabricUtilizationPerPc: decimal('Average fabric utilisation', { min: 0 }),
  avgUtilizationUom: requiredDropdown(20, 'Utilisation UOM').default('Mtrs'),
  sizeGroup: dropdown(40),
  /**
   * "Qty/ctn" - finished pieces per export carton, as the buyer states it.
   *
   * NOT `z.coerce.number()`, which reads an empty cell as 0. A blank column on
   * an imported file means "clear this", and rule 3 of the importer turns that
   * into '' - so '' has to become null explicitly. Coercing it would store a
   * carton of nothing and the operator would never be told.
   */
  qtyPerCarton: z
    .union([z.literal(''), z.null(), z.string().trim(), z.number()])
    .optional()
    .transform((v, ctx) => {
      if (v === '' || v === null || v === undefined) return v === undefined ? undefined : null;
      // Not Number(): it reads '0x10' as 16 and ' ' as 0. A carton quantity is
      // digits, and anything else is a mistyped cell that should be named.
      if (typeof v === 'string' && !/^\d+$/.test(v)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Qty per carton must be a whole number of pieces',
        });
        return z.NEVER;
      }
      const n = Number(v);
      if (!Number.isInteger(n)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Qty per carton must be a whole number of pieces',
        });
        return z.NEVER;
      }
      if (n <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Qty per carton must be greater than zero. Leave it blank if the buyer has not stated it - '
            + 'a carton of nothing is an empty cell that got coerced, not a specification.',
        });
        return z.NEVER;
      }
      if (n > 1000000) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Qty per carton is too large' });
        return z.NEVER;
      }
      return n;
    }),
  imageRef: optionalText(200),
  status: statusActive.default('ACTIVE'),
  remarks: optionalText(2000),

  // --- The tech pack -------------------------------------------------------
  bagLength: measurement('Length'),
  bagWidth: measurement('Width'),
  bagHeight: measurement('Height'),
  gussetWidth: measurement('Gusset'),
  handleDrop: measurement('Handle drop'),
  strapLength: measurement('Strap length'),
  dimensionUom: z.enum(['cm', 'inch'], {
    errorMap: () => ({ message: 'Measurements are in cm or inch' }),
  }).optional(),
  closure: dropdown(60),
  lining: dropdown(60),
  printPlacement: optionalText(1000),
  artworkVersion: optionalText(40),

  bom: z.array(bomLineSchema).default([]),
  /**
   * The panel list. Optional and NOT defaulted: an update that leaves it out
   * keeps the panels the style already has, and `[]` clears them on purpose.
   */
  components: z.array(styleComponentSchema).max(40).optional(),
});

export const updateStyleSchema = createStyleSchema.partial();

export const requirementQuery = z.object({
  qty: z.coerce.number().positive('Quantity must be greater than zero'),
});
