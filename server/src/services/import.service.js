/**
 * Importing a master from a CSV file.
 *
 * ===========================================================================
 *  THE IMPORT IS THE EXPORT, TRAVELLING THE OTHER WAY
 * ===========================================================================
 *
 *  The office's actual workflow is: download the buyers, fix forty phone
 *  numbers in Excel, send the file back. That round trip only holds if one
 *  place decides what a master's importable columns are - so the field specs
 *  below are also what `dataset.registry.js` declares as those masters' EXPORT
 *  columns, via `importColumns()`. There is no second list to keep in step.
 *
 * ---------------------------------------------------------------------------
 *  THE FOUR RULES  (README: "Importing a master")
 *
 *  1. NOTHING IS WRITTEN UNTIL EVERY ROW HAS BEEN CHECKED.
 *     Schemas, dropdown membership, buyer lookups and duplicate keys inside
 *     the file are all validated first, against every row. One bad row and
 *     nothing at all is written.
 *
 *     A half-applied import is the worst outcome available here: the operator
 *     cannot tell which rows landed, re-running the file re-applies the ones
 *     that did, and the master is left in a state nobody chose. Refusing the
 *     whole file costs one more edit in Excel and is always recoverable.
 *
 *  2. A COLUMN THAT IS NOT IN THE FILE IS NOT TOUCHED.
 *     A two-column file of `Buyer Code, Phone` changes thirty phone numbers
 *     and nothing else. This is why the row is built from the HEADERS PRESENT
 *     rather than from the field list: an absent key stays `undefined`, and
 *     every service here is written as
 *     `...(input.field !== undefined ? { field: input.field } : {})`.
 *
 *  3. A COLUMN THAT IS IN THE FILE AND EMPTY CLEARS THAT FIELD.
 *     On a round trip that is what a deleted cell means. `optionalText` turns
 *     '' into an explicit null for exactly this reason, so most fields need no
 *     special handling - the exceptions are declared per field as `blank`:
 *
 *       'pass'  (default)  '' reaches the schema, which stores null
 *       'null'              '' becomes null before the schema sees it, for
 *                           fields whose schema would reject '' on its way
 *                           (an email regex has no opinion about "clear this")
 *       'omit'              '' is dropped, for a field that is NOT NULL with a
 *                           default - a blank Status cannot mean "no status",
 *                           so it means "leave it alone"
 *
 *     Required fields are the exception the README names: blank is refused,
 *     never stored.
 *
 *  4. THE IMPORTER GOES THROUGH THE SAME SERVICES THE SCREEN DOES.
 *     `create` and `update` below are the master's own service functions - the
 *     ones the form posts to. Auto-numbering, code-clash detection, the PO
 *     sequence a new vendor needs, the audit columns: all of it happens
 *     because the importer did not write its own path into these tables.
 *     There is no back door.
 *
 * ---------------------------------------------------------------------------
 *  WHAT IS DELIBERATELY NOT IMPORTABLE
 *
 *  A STYLE'S BOM LINES. The header is one row; the BOM is a grid. Flattening
 *  a variable number of material lines into columns produces a file nobody can
 *  edit, and the obvious alternative - "the file replaces the BOM" - deletes a
 *  bill of materials because a column was left out. Importing a style header
 *  leaves its existing BOM untouched.
 *
 *  RENAMING A DROPDOWN VALUE. The identity of a list value IS its text, so an
 *  edited cell is indistinguishable from a new value and the importer would
 *  have to guess. Rename it on the Master Lists screen, which knows the
 *  difference because it holds the row's id.
 * ---------------------------------------------------------------------------
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { CSV_BOM, normaliseHeader, parseCsvRecords, toCsv } from '../utils/csv.js';
import * as buyerService from './buyer.service.js';
import * as vendorService from './vendor.service.js';
import * as employeeService from './employee.service.js';
import * as styleService from './style.service.js';
import * as masterListService from './masterList.service.js';
import {
  createBuyerSchema,
  createEmployeeSchema,
  createStyleSchema,
  createValueSchema,
  createVendorSchema,
  updateBuyerSchema,
  updateEmployeeSchema,
  updateStyleSchema,
  updateValueSchema,
  updateVendorSchema,
} from '../validators/master.validator.js';

/**
 * The most rows one file will carry.
 *
 * Rule 1 holds every row in memory before writing any of them, and the whole
 * file is then applied one service call at a time. Past a few thousand rows
 * that is a request that outlives its own timeout, and the honest answer is to
 * say so and name the number rather than to start work that cannot finish.
 */
export const MAX_IMPORT_ROWS = 5_000;

/**
 * Problems reported before the list is cut short.
 *
 * A file with 900 broken rows is a file with one mistake made 900 times, and a
 * report that lists all of them buries that. The count of what was left out is
 * returned beside them so the number is never hidden.
 */
const MAX_ISSUES = 200;

// ===========================================================================
//  FIELD SPECS
// ===========================================================================

/**
 * One importable column.
 *
 * @param key    The name the SERVICE knows the field by (`buyerCode`).
 * @param label  The header, which is also the export's column heading.
 * @param path   Where the value lives on an exported row, when that differs
 *               from `key` - a style's buyer arrives as `buyer.buyerCode`.
 *               `export.service.js` reads columns by this path.
 * @param blank  What an empty cell means. See rule 3 at the head of the file.
 * @param hint   Shown against the column on the import dialog.
 */
const f = (key, label, opts = {}) => ({
  key,
  label,
  path: opts.path ?? key,
  required: opts.required ?? false,
  blank: opts.blank ?? 'pass',
  hint: opts.hint ?? '',
});

/** Headers match on shape, not spelling: "Buyer Code", "buyer_code", "buyerCode". */
const DROPDOWN_HINT = 'Must already be on its Master List.';
const STATUS_HINT = 'ACTIVE or INACTIVE. Blank leaves it unchanged.';

const BUYER_FIELDS = [
  f('buyerCode', 'Buyer Code', { required: true, hint: 'How the office refers to this buyer. Rows are matched on it.' }),
  f('buyerName', 'Buyer Name', { required: true }),
  f('address', 'Address'),
  f('country', 'Country', { hint: DROPDOWN_HINT }),
  f('contactPerson', 'Contact Person'),
  f('email', 'Email', { blank: 'null' }),
  f('phone', 'Phone'),
  f('currency', 'Currency', { hint: DROPDOWN_HINT }),
  f('paymentTerms', 'Payment Terms', { hint: DROPDOWN_HINT }),
  f('status', 'Status', { blank: 'omit', hint: STATUS_HINT }),
  f('consigneeName', 'Consignee Name'),
  f('consigneeAddress', 'Consignee Address'),
  f('notifyPartyName', 'Notify Party Name'),
  f('notifyPartyAddress', 'Notify Party Address'),
  f('destination', 'Destination'),
  f('portOfDischarge', 'Port Of Discharge'),
  f('finalDestination', 'Final Destination'),
  f('priceTerms', 'Price Terms', { hint: DROPDOWN_HINT }),
  f('shipMode', 'Ship Mode', { hint: DROPDOWN_HINT }),
  f('freightTerms', 'Freight Terms', { hint: DROPDOWN_HINT }),
];

const VENDOR_FIELDS = [
  f('vendorCode', 'Vendor Code', { hint: 'Rows are matched on it. Leave blank on a new vendor and one is allotted.' }),
  f('vendorName', 'Vendor Name', { required: true }),
  f('category', 'Category', { required: true, hint: DROPDOWN_HINT }),
  f('address', 'Address'),
  f('city', 'City'),
  f('vendorLocation', 'Vendor Location'),
  f('gstNo', 'Gst No', { hint: '15-character GSTIN, or blank.' }),
  f('contactPerson', 'Contact Person'),
  f('phone', 'Phone'),
  f('email', 'Email', { blank: 'null' }),
  f('bankDetails', 'Bank Details'),
  f('status', 'Status', { blank: 'omit', hint: STATUS_HINT }),
  f('remarks', 'Remarks'),
  f('poInitials', 'Po Initials', { hint: 'The prefix this vendor’s PO numbers carry. Derived from the name if blank.' }),
  f('pinCode', 'Pin Code', { hint: '6 digits, or blank.' }),
];

const EMPLOYEE_FIELDS = [
  f('empId', 'Emp Id', { hint: 'Rows are matched on it. Leave blank on a new employee and one is allotted.' }),
  f('empName', 'Emp Name', { required: true }),
  f('department', 'Department', { required: true, hint: DROPDOWN_HINT }),
  f('designation', 'Designation', { required: true, hint: DROPDOWN_HINT }),
  f('unitLine', 'Unit Line'),
  f('status', 'Status', { blank: 'omit', hint: STATUS_HINT }),
];

const STYLE_FIELDS = [
  f('styleNo', 'Style No', { required: true, hint: 'Rows are matched on it.' }),
  f('styleDescription', 'Style Description', { required: true }),
  f('buyerCode', 'Buyer Code', {
    path: 'buyer.buyerCode',
    required: true,
    hint: 'The buyer’s code, not its name. That buyer must already exist.',
  }),
  /*
   * `blank: 'omit'`, and it is the export round trip that forces it.
   *
   * `styles.category` is NOT NULL and the Style screen no longer asks for it,
   * so every style created there carries ''. The export writes that as an
   * empty cell - and the service's own dropdown check treats a category that
   * is PRESENT as required, so sending that cell straight back refused the
   * very file the application had just produced. A blank Category cannot mean
   * "no category" on a NOT NULL column; it means "leave it alone".
   */
  f('category', 'Category', { blank: 'omit', hint: DROPDOWN_HINT }),
  f('fabricContent', 'Fabric Content', { hint: DROPDOWN_HINT }),
  f('colorCode', 'Color Code', { hint: DROPDOWN_HINT }),
  f('avgFabricUtilizationPerPc', 'Avg Fabric Utilization Per Pc', {
    required: true,
    hint: 'Per finished piece. 0 is allowed and means the sampling has not decided it yet.',
  }),
  f('avgUtilizationUom', 'Avg Utilization Uom', { blank: 'omit', hint: 'Mtrs unless the style is bought by weight.' }),
  f('sizeGroup', 'Size Group', { hint: DROPDOWN_HINT }),
  f('qtyPerCarton', 'Qty Per Carton', { hint: 'Finished pieces per export carton. A whole number.' }),
  f('imageRef', 'Image Ref'),
  f('status', 'Status', { blank: 'omit', hint: STATUS_HINT }),
  f('remarks', 'Remarks'),
];

const LIST_VALUE_FIELDS = [
  f('listCode', 'List Code', { required: true, hint: 'The list this value belongs to, e.g. ColorCode. It must already exist.' }),
  f('value', 'Value', { required: true, hint: 'The text the dropdown shows. Rows are matched on List Code + Value.' }),
  f('code', 'Code', { hint: 'A short code for the value. The value itself is used if blank.' }),
  f('sortOrder', 'Sort Order', { blank: 'omit', hint: 'Where it sits in the dropdown. Left alone if blank.' }),
  f('isActive', 'Is Active', { blank: 'omit', hint: 'Yes or No. An inactive value stays on old documents but is offered on no new one.' }),
];

// ===========================================================================
//  THE MASTERS
// ===========================================================================

/**
 * Looks a record up by the column rows are matched on.
 *
 * Soft-deleted rows are NOT matched. A buyer that was deleted and whose code
 * is typed again is a new buyer as far as the office is concerned; matching it
 * would silently resurrect a record with its old address, contacts and terms
 * still attached, which is not what anybody typing a code into a spreadsheet
 * is asking for.
 */
const findBy = (model, field, { insensitive = false } = {}) => async (values) => {
  const key = values[field];
  if (!key) return null;
  const match = insensitive ? { equals: key, mode: 'insensitive' } : key;
  return prisma[model].findFirst({ where: { [field]: match, deletedAt: null }, select: { id: true } });
};

/**
 * The five importable masters.
 *
 * `dataTransfer.controller.js` reads `module` off this to authorise a request,
 * and `dataset.registry.js` reads `fields` off it (through `importColumns`) to
 * shape the matching export. Both deliberately read from here rather than
 * naming a module or a column list of their own.
 */
export const MASTER_IMPORTS = {
  buyers: {
    key: 'buyers',
    title: 'Buyers',
    module: 'BUYER',
    fields: BUYER_FIELDS,
    identityFields: ['buyerCode'],
    identityLabel: 'Buyer Code',
    createSchema: createBuyerSchema,
    updateSchema: updateBuyerSchema,
    assertDropdowns: buyerService.assertDropdowns,
    // Buyer codes are unique regardless of case - see buyer.service.js.
    findExisting: findBy('buyer', 'buyerCode', { insensitive: true }),
    create: (data, actorId) => buyerService.create(data, actorId),
    update: (id, data, actorId) => buyerService.update(id, data, actorId),
  },

  vendors: {
    key: 'vendors',
    title: 'Vendors',
    module: 'VENDOR',
    fields: VENDOR_FIELDS,
    identityFields: ['vendorCode'],
    identityLabel: 'Vendor Code',
    note: 'A row with no Vendor Code is a new vendor and is allotted one.',
    createSchema: createVendorSchema,
    updateSchema: updateVendorSchema,
    assertDropdowns: vendorService.assertDropdowns,
    findExisting: findBy('vendor', 'vendorCode'),
    create: (data, actorId) => vendorService.create(data, actorId),
    update: (id, data, actorId) => vendorService.update(id, data, actorId),
  },

  employees: {
    key: 'employees',
    title: 'Employees',
    module: 'EMPLOYEE',
    fields: EMPLOYEE_FIELDS,
    identityFields: ['empId'],
    identityLabel: 'Emp Id',
    note: 'A row with no Emp Id is a new employee and is allotted one.',
    createSchema: createEmployeeSchema,
    updateSchema: updateEmployeeSchema,
    assertDropdowns: employeeService.assertDropdowns,
    findExisting: findBy('employee', 'empId'),
    create: (data, actorId) => employeeService.create(data, actorId),
    update: (id, data, actorId) => employeeService.update(id, data, actorId),
  },

  styles: {
    key: 'styles',
    title: 'Styles',
    module: 'STYLE',
    fields: STYLE_FIELDS,
    identityFields: ['styleNo'],
    identityLabel: 'Style No',
    /*
     * The schema knows this field as `buyerId`; the file calls it Buyer Code.
     * Without this, a style row missing its buyer reported a problem against a
     * column heading that is nowhere in the operator's spreadsheet.
     */
    schemaLabels: { buyerId: 'Buyer Code' },
    note: 'BOM lines are not importable, and an imported header leaves the style’s existing BOM untouched.',
    createSchema: createStyleSchema,
    updateSchema: updateStyleSchema,
    assertDropdowns: styleService.assertDropdowns,
    findExisting: findBy('style', 'styleNo'),

    /**
     * `Buyer Code` on the file is `buyerId` to the service.
     *
     * The export writes the buyer's CODE, because a spreadsheet full of UUIDs
     * is a spreadsheet nobody can edit - so the import has to turn it back.
     * Done here rather than in the schema because it is a database lookup, and
     * `createStyleSchema` correctly insists on a real uuid.
     */
    prepare: async (input) => {
      if (input.buyerCode === undefined) return input;
      const { buyerCode, ...rest } = input;
      if (!buyerCode) throw ApiError.badRequest('Buyer Code is required', { field: 'buyerCode' });

      const buyer = await prisma.buyer.findFirst({
        where: { buyerCode, deletedAt: null },
        select: { id: true },
      });
      if (!buyer) {
        throw ApiError.badRequest(
          `No buyer has the code "${buyerCode}". Add the buyer first, or correct the code.`,
          { field: 'buyerCode' },
        );
      }
      return { ...rest, buyerId: buyer.id };
    },

    create: (data, actorId) => styleService.create(data, actorId),
    update: (id, data, actorId) => styleService.update(id, data, actorId),
  },

  'master-list-values': {
    key: 'master-list-values',
    title: 'Master list values',
    module: 'MASTER_LIST',
    fields: LIST_VALUE_FIELDS,
    identityFields: ['listCode', 'value'],
    identityLabel: 'List Code + Value',
    note: 'A value cannot be RENAMED through a file - an edited cell reads as a new value. Rename it on the Master Lists screen.',
    createSchema: createValueSchema,
    updateSchema: updateValueSchema,

    /**
     * Identity is the pair, because the same text lives in several lists:
     * "Black" is a ColorCode and could as easily be a FabricContent.
     */
    findExisting: async (values) => {
      if (!values.listCode || !values.value) return null;
      return prisma.masterListValue.findFirst({
        where: {
          value: values.value,
          deletedAt: null,
          list: { code: values.listCode, deletedAt: null },
        },
        select: { id: true },
      });
    },

    /** The list has to exist; this importer creates values, never lists. */
    prepare: async (input, { raw }) => {
      const listCode = raw.listCode;
      if (!listCode) throw ApiError.badRequest('List Code is required', { field: 'listCode' });

      const list = await prisma.masterList.findFirst({
        where: { code: listCode, deletedAt: null },
        select: { id: true },
      });
      if (!list) {
        throw ApiError.badRequest(
          `There is no master list with the code "${listCode}". Create the list first on the Master Lists screen.`,
          { field: 'listCode' },
        );
      }
      /*
       * "Yes"/"No" is what the export writes for a boolean, so a round trip
       * hands those straight back and `z.boolean()` would refuse both.
       * Converted here, before the schema, rather than by loosening the schema
       * the screen also posts to.
       */
      const out = { ...input };
      if (out.isActive !== undefined && out.isActive !== null) {
        out.isActive = parseBoolean(out.isActive, 'Is Active');
      }
      return out;
    },

    create: async (data, actorId, raw) => {
      const list = await prisma.masterList.findFirst({
        where: { code: raw.listCode, deletedAt: null },
        select: { id: true },
      });
      return masterListService.addValue(list.id, data, actorId);
    },
    update: (id, data, actorId) => masterListService.updateValue(id, data, actorId),
  },
};

/** The export column set for a master, so its download IS its import template. */
export function importColumns(key) {
  const master = MASTER_IMPORTS[key];
  if (!master) throw new Error(`No import spec for "${key}"`);
  return master.fields.map((field) => ({ key: field.path, label: field.label }));
}

/** Every master that can be imported. Used by the registry. */
export function importableMasters() {
  return Object.values(MASTER_IMPORTS);
}

// ===========================================================================
//  THE CATALOGUE, THE SPEC AND THE TEMPLATE
// ===========================================================================

/** The master, or a 404 - never a silent no-op. */
export function specFor(key) {
  const master = MASTER_IMPORTS[key];
  if (!master) throw ApiError.notFound(`Import "${key}"`);
  return master;
}

/**
 * What this user may import.
 *
 * `canCreate` / `canEdit` are returned rather than left for the screen to work
 * out, because the dialog uses them to decide which of the three modes to
 * offer: somebody with EDIT but not CREATE is shown "Update existing only" and
 * nothing else, instead of choosing a mode the server will then refuse.
 */
export function importCatalogue(has) {
  return importableMasters()
    .filter((m) => has(`${m.module}.CREATE`) || has(`${m.module}.EDIT`))
    .map((m) => ({
      key: m.key,
      title: m.title,
      module: m.module,
      identityLabel: m.identityLabel,
      note: m.note ?? '',
      canCreate: has(`${m.module}.CREATE`),
      canEdit: has(`${m.module}.EDIT`),
    }));
}

/** Its columns, which are required, and why - for the import dialog. */
export function importSpec(key) {
  const master = specFor(key);
  return {
    key: master.key,
    title: master.title,
    module: master.module,
    identityLabel: master.identityLabel,
    note: master.note ?? '',
    maxRows: MAX_IMPORT_ROWS,
    fields: master.fields.map(({ key: field, label, required, hint }) => ({ key: field, label, required, hint })),
  };
}

/** A blank file with just the header row - the export's own columns. */
export function template(key) {
  specFor(key);
  return CSV_BOM + toCsv(importColumns(key), []);
}

// ===========================================================================
//  READING A ROW
// ===========================================================================

/**
 * "Yes"/"No", as the export writes them, and everything else a person types.
 *
 * `formatCell` renders a boolean as Yes or No, so a round trip hands those
 * back and `z.boolean()` would refuse both. Anything unrecognised is named
 * rather than guessed - reading a stray word as `false` would quietly
 * deactivate a dropdown value.
 */
function parseBoolean(text, label) {
  const t = String(text).trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'active'].includes(t)) return true;
  if (['no', 'n', 'false', '0', 'inactive'].includes(t)) return false;
  throw ApiError.badRequest(`${label} must be Yes or No.`, { field: label });
}

/**
 * Header cell -> field, on shape rather than spelling.
 *
 * `normaliseHeader` folds case, spaces, underscores and dots, so "Buyer Code",
 * "buyer_code" and "buyerCode" are one header. The person editing the file is
 * working in Excel, where a header is a caption; refusing their file over a
 * capital letter would be the system being difficult about something it can
 * see perfectly well.
 */
function mapHeaders(master, headers) {
  const byName = new Map();
  for (const field of master.fields) {
    for (const alias of [field.label, field.key, field.path]) byName.set(normaliseHeader(alias), field);
  }

  const mapped = [];
  const unknown = [];
  const duplicated = [];
  const claimed = new Set();

  for (const header of headers) {
    if (String(header ?? '').trim() === '') continue;
    const field = byName.get(normaliseHeader(header));
    if (!field) {
      unknown.push(header);
      continue;
    }
    if (claimed.has(field.key)) {
      duplicated.push(header);
      continue;
    }
    claimed.add(field.key);
    mapped.push({ header, field });
  }

  return { mapped, unknown, duplicated };
}

/** The row, keyed by FIELD name rather than by whatever the header said. */
function rowValues(mapped, record) {
  const values = {};
  for (const { header, field } of mapped) values[field.key] = record.values[header] ?? '';
  return values;
}

const identityTextOf = (master, values) => {
  const parts = master.identityFields.map((k) => values[k] ?? '').filter((v) => v !== '');
  return parts.length ? parts.join(' / ') : '(new)';
};

const identityKeyOf = (master, values) =>
  master.identityFields.map((k) => normaliseHeader(values[k] ?? '')).join(' ');

const hasIdentity = (master, values) => master.identityFields.every((k) => (values[k] ?? '') !== '');

/**
 * The row as the service wants it, applying rules 2 and 3.
 *
 * Only fields whose COLUMN is in the file are set, so an absent one stays
 * `undefined` and every partial update leaves it alone. An empty cell is an
 * explicit clear, except where the field is required (refused) or declares
 * `blank: 'omit'` - a NOT NULL column with a default, where blank can only
 * sensibly mean "unchanged".
 */
function buildInput(master, values, report, isCreate) {
  const input = {};

  for (const field of master.fields) {
    if (!(field.key in values)) {
      /*
       * A required column the file does not have at all.
       *
       * Zod catches this too, but its message for an absent key is the bare
       * word "Required" against a field name the operator has never seen -
       * `buyerId` for a column headed Buyer Code. Naming the COLUMN, and
       * saying that adding a record is what needs it, is the difference
       * between a report somebody can act on and one they bring to us.
       */
      if (field.required && isCreate) {
        report(field.label, `${field.label} is needed to add a new record, and this file has no ${field.label} column.`);
      }
      continue;
    }
    const cell = values[field.key];

    if (cell !== '') {
      input[field.key] = cell;
      continue;
    }

    if (field.required) {
      report(
        field.label,
        `${field.label} cannot be blank. To keep what is already stored, leave the column out of the file altogether.`,
      );
      continue;
    }
    if (field.blank === 'omit') continue;
    input[field.key] = field.blank === 'null' ? null : '';
  }

  return input;
}

/** Zod's complaints, named by the column heading the file actually shows. */
function zodIssues(error, master) {
  const labelOf = (path) =>
    master.schemaLabels?.[path]
    ?? master.fields.find((spec) => spec.key === path)?.label
    ?? String(path ?? '');
  return error.issues.map((issue) => ({
    field: labelOf(issue.path[0]),
    message: issue.message,
  }));
}

/** An ApiError's field, whatever shape the thrower used. */
const fieldOf = (err) => err?.details?.field ?? err?.field ?? null;

// ===========================================================================
//  THE RUN
// ===========================================================================

/**
 * Checks a file, and applies it unless this is a dry run.
 *
 * @param {string} key      A master key from MASTER_IMPORTS
 * @param {string} csvText  The uploaded file, as text
 * @param {object} options  { mode, dryRun, has }
 * @param {string} actorId  Whose name goes on every row this writes
 */
export async function runImport(key, csvText, { mode = 'upsert', dryRun = true, has } = {}, actorId) {
  const master = specFor(key);
  const { headers, records } = parseCsvRecords(csvText);

  if (headers.length === 0) {
    throw ApiError.badRequest('That file is empty - it has no header row.', { field: 'file' });
  }

  const { mapped, unknown, duplicated } = mapHeaders(master, headers);

  /*
   * The matching column is not optional even where its VALUE is.
   *
   * A vendor may arrive without a code and be allotted one, but a file with no
   * Vendor Code column at all cannot say which vendors it means - and in
   * upsert mode that file would silently create a duplicate of every row.
   * Refused here, before anything is read.
   */
  const missing = master.identityFields.filter((k) => !mapped.some((m) => m.field.key === k));
  if (missing.length > 0) {
    throw ApiError.badRequest(
      `This file has no ${master.identityLabel} column, so there is no way to tell which records it means. `
        + 'Download the blank template, or export the table and edit that.',
      { field: 'file', missing },
    );
  }

  if (records.length === 0) {
    throw ApiError.badRequest('That file has a header row and no data rows.', { field: 'file' });
  }
  if (records.length > MAX_IMPORT_ROWS) {
    throw ApiError.badRequest(
      `That file has ${records.length.toLocaleString('en-IN')} rows, and ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} `
        + 'is the most one import will take. Split it and send it in parts.',
      { rows: records.length, limit: MAX_IMPORT_ROWS },
    );
  }

  const issues = [];
  const add = (line, identity, field, message) => issues.push({ line, identity, field: field ?? null, message });

  for (const header of unknown) {
    add(1, '(header row)', header, `${master.title} has no "${header}" column. Remove it, or correct the spelling.`);
  }
  for (const header of duplicated) {
    add(1, '(header row)', header, `"${header}" appears twice. Keep one of them.`);
  }

  // -------------------------------------------------------------------------
  //  PASS ONE - check every row, write nothing (rule 1)
  // -------------------------------------------------------------------------

  const plans = [];
  const seen = new Map(); // identity -> the line that first claimed it

  for (const record of records) {
    const { line } = record;
    const values = rowValues(mapped, record);
    const identity = identityTextOf(master, values);
    const before = issues.length;

    /*
     * ONE MISTAKE, ONE MESSAGE.
     *
     * A blank required cell was being reported twice - once here in the
     * operator's own words, and again by Zod as "... is required" - and a row
     * whose Buyer Code could not be resolved was reported once for the code
     * and again for the `buyerId` the lookup never produced. A report that
     * says the same thing twice reads as two separate problems, and the
     * second one names a field that is not on the file.
     *
     * So a field that has already been spoken for on this row is not spoken
     * for again, and a failed `prepare` stops the row there: its input is
     * incomplete by construction, and everything Zod would go on to say about
     * it is a consequence rather than a cause.
     */
    const spokenFor = new Set();
    const report = (field, message) => {
      if (field !== null && field !== undefined) spokenFor.add(field);
      add(line, identity, field, message);
    };

    // A key repeated inside one file is two rows fighting over one record, and
    // whichever lands second wins silently. Named as a pair, so both are found.
    if (hasIdentity(master, values)) {
      const dupKey = identityKeyOf(master, values);
      const first = seen.get(dupKey);
      if (first !== undefined) {
        report(master.identityLabel, `${identity} is also on row ${first}. One record, one row.`);
      } else {
        seen.set(dupKey, line);
      }
    }

    let existing = null;
    try {
      existing = hasIdentity(master, values) ? await master.findExisting(values) : null;
    } catch (err) {
      report(fieldOf(err), err.message);
    }

    const isCreate = !existing;

    if (isCreate && mode === 'update') {
      report(master.identityLabel, `${identity} does not exist, and this import was set to update existing records only.`);
    }
    if (!isCreate && mode === 'create') {
      report(master.identityLabel, `${identity} already exists, and this import was set to add new records only.`);
    }

    let input = buildInput(master, values, report, isCreate);
    let prepared = true;

    if (master.prepare) {
      try {
        input = await master.prepare(input, { raw: values, isCreate });
      } catch (err) {
        report(fieldOf(err), err.message);
        prepared = false;
      }
    }

    const parsed = prepared
      ? (isCreate ? master.createSchema : master.updateSchema).safeParse(input)
      : { success: false, error: { issues: [] } };

    if (!parsed.success) {
      for (const problem of zodIssues(parsed.error, master)) {
        if (spokenFor.has(problem.field)) continue;
        report(problem.field, problem.message);
      }
    } else if (master.assertDropdowns) {
      /*
       * Master List membership is a DATABASE question, not a schema one - the
       * list content is data, and a value added this morning must be accepted
       * this afternoon. So the check the screen runs is run here too, in the
       * checking pass, rather than being discovered halfway through writing.
       */
      try {
        await master.assertDropdowns(parsed.data);
      } catch (err) {
        report(fieldOf(err), err.message);
      }
    }

    if (issues.length === before && parsed.success) {
      plans.push({ line, identity, isCreate, existingId: existing?.id ?? null, data: parsed.data, raw: values });
    }
  }

  const willCreate = plans.filter((p) => p.isCreate).length;
  const willUpdate = plans.length - willCreate;

  /*
   * PERMISSION IS CHECKED AGAINST WHAT THE FILE DOES, not against what the URL
   * names. The route could only establish that this user may import this master
   * at all; which of CREATE and EDIT the file needs is knowable only now, and a
   * file that does both needs both. Checked on the dry run as well, so the
   * screen says so before the operator agrees to a number.
   */
  if (typeof has === 'function') {
    const required = [];
    if (willCreate > 0 && !has(`${master.module}.CREATE`)) required.push(`${master.module}.CREATE`);
    if (willUpdate > 0 && !has(`${master.module}.EDIT`)) required.push(`${master.module}.EDIT`);
    if (required.length > 0) {
      throw ApiError.forbidden(
        `This file adds ${willCreate} and changes ${willUpdate} record(s), which needs ${required.join(' and ')}.`,
        { required },
      );
    }
  }

  const truncate = () => ({
    issues: issues.slice(0, MAX_ISSUES),
    issuesTruncated: Math.max(0, issues.length - MAX_ISSUES),
  });

  const base = {
    key: master.key,
    title: master.title,
    mode,
    rowCount: records.length,
    willCreate,
    willUpdate,
    failed: issues.length,
  };

  // One bad row and nothing at all is written (rule 1).
  if (dryRun || issues.length > 0) {
    return { ...base, dryRun: true, created: 0, updated: 0, ...truncate() };
  }

  // -------------------------------------------------------------------------
  //  PASS TWO - apply, through the master's own service (rule 4)
  // -------------------------------------------------------------------------

  let created = 0;
  let updated = 0;

  for (const plan of plans) {
    try {
      if (plan.isCreate) {
        await master.create(plan.data, actorId, plan.raw);
        created += 1;
      } else {
        await master.update(plan.existingId, plan.data, actorId, plan.raw);
        updated += 1;
      }
    } catch (err) {
      /*
       * Pass one cleared every row, so reaching here means the database moved
       * underneath the check - somebody else added the same buyer code between
       * the two passes, or deleted a record this file was about to update.
       * Rare, and reported as the row it happened on rather than as a 500 that
       * loses the other 400 rows that did land.
       */
      add(plan.line, plan.identity, fieldOf(err), err.message);
    }
  }

  return { ...base, dryRun: false, failed: issues.length, created, updated, ...truncate() };
}
