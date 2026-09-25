/**
 * Master screen descriptors.
 *
 * Each master declares its columns, its form fields and its validation once.
 * MasterPage renders all of them, so Buyers, Vendors, Employees and Styles
 * behave identically - same search, same filters, same sorting, same
 * active/inactive control, same delete guard.
 *
 * Every dropdown field carries a `listCode`, which is a Master List code read
 * at runtime. No business option list is written into this file or any other
 * React file.
 *
 * Field labels are kept exactly as the workbook column captions read, so a user
 * who knows the Excel recognises the screen.
 */

import { z } from 'zod';
import { buyers, employees, styles, vendors } from '../services/erp.js';
import { StatusBadge } from '../components/ui.jsx';

// --- shared zod pieces -----------------------------------------------------

const req = (label, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const opt = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const optEmail = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Must be a valid email address');

const status = z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE');

/**
 * A number field where zero is a legitimate answer meaning "not decided yet".
 *
 * Blank is still refused: leaving a field empty is not the same statement as
 * typing 0, and only one of the two is a decision.
 */
const zeroOrPositive = (label) =>
  z
    .union([z.string(), z.number()])
    .refine(
      (v) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0,
      `${label} must be zero or greater`,
    )
    .transform((v) => String(Number(v)));

/**
 * A whole-number count that may legitimately be left blank.
 *
 * Unlike zeroOrPositive above, blank is an ANSWER here and means "the buyer has
 * not stated it". Zero is not: nobody packs zero pieces in a carton, so a 0
 * that reached the server would be an empty cell that got coerced somewhere
 * along the way, and the database refuses it.
 */
const optCount = (label) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === '' || v === undefined || v === null ? null : v))
    .refine(
      (v) => v === null || (Number.isInteger(Number(v)) && Number(v) > 0),
      `${label} must be a whole number greater than zero`,
    )
    .transform((v) => (v === null ? null : Number(v)));

/**
 * Bill To and Ship To, as the Buyer Master shows them.
 *
 * Neither is a stored column. An order builds Bill To from the buyer's own name
 * and address, and picks Ship To from the consignee, the notify party or the
 * buyer - see OrderForm. Deriving them the same way here means the master and
 * the order can never disagree about what an unedited order would say.
 *
 * Addresses are Text, so the cell truncates and keeps the whole thing in the
 * tooltip rather than letting one buyer set the row height for the table.
 */
const joinAddr = (...parts) => parts.filter(Boolean).join(', ');

const buyerBillTo = (b) => joinAddr(b.buyerName, b.address);

const buyerShipTo = (b) =>
  b.consigneeAddress || joinAddr(b.notifyPartyName, b.notifyPartyAddress) || buyerBillTo(b);

const addrCell = (text) =>
  text ? (
    <span
      title={text}
      style={{ display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}
    >
      {text}
    </span>
  ) : (
    '-'
  );

// ===========================================================================
//  BUYERS
// ===========================================================================

export const buyerMaster = {
  key: 'buyers',
  module: 'BUYER',
  api: buyers,
  title: 'Buyers',
  singular: 'Buyer',
  idField: 'id',
  titleField: 'buyerName',
  defaultSort: 'buyerName',
  searchPlaceholder: 'Search code, name, contact, email, country...',
  filters: [{ name: 'country', label: 'Country', listCode: 'Country' }],
  columns: [
    { field: 'buyerCode', label: 'Buyer Code', sortable: true, className: 'code' },
    { field: 'buyerName', label: 'Buyer Name', sortable: true },
    { field: 'country', label: 'Country', sortable: true },
    { field: 'billTo', label: 'Bill To', optional: true, render: (r) => addrCell(buyerBillTo(r)) },
    { field: 'shipTo', label: 'Ship To', optional: true, render: (r) => addrCell(buyerShipTo(r)) },
    { field: 'contactPerson', label: 'Contact Person', optional: true  },
    { field: 'currency', label: 'Currency', optional: true  },
    { field: 'shipMode', label: 'Ship Mode', optional: true  },
    { field: 'status', label: 'Status', sortable: true, render: (r) => <StatusBadge status={r.status} /> },
  ],
  sections: [
    {
      title: 'Identification',
      fields: [
        {
          name: 'buyerCode',
          label: 'Buyer Code',
          type: 'text',
          required: true,
          hint: 'The code the office uses for this buyer. Must be unique.',
        },
        { name: 'buyerName', label: 'Buyer Name', type: 'text', required: true },
        { name: 'address', label: 'Address', type: 'textarea', span: 2 },
        { name: 'country', label: 'Country', type: 'master', listCode: 'Country' },
        { name: 'status', label: 'Status', type: 'status' },
      ],
    },
    {
      title: 'Contact',
      fields: [
        { name: 'contactPerson', label: 'Contact Person', type: 'text' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'phone', label: 'Phone', type: 'text' },
      ],
    },
    {
      title: 'Commercial',
      fields: [
        { name: 'currency', label: 'Currency', type: 'master', listCode: 'Currency' },
        { name: 'paymentTerms', label: 'Payment Terms', type: 'master', listCode: 'PaymentTerms' },
        { name: 'priceTerms', label: 'Price Terms (Incoterm)', type: 'master', listCode: 'PriceTerms' },
        { name: 'shipMode', label: 'Ship Mode', type: 'master', listCode: 'ShipMode' },
        { name: 'freightTerms', label: 'Freight Terms', type: 'master', listCode: 'FreightTerms' },
      ],
    },
    {
      title: 'Consignee & Notify Party',
      fields: [
        { name: 'consigneeName', label: 'Consignee Name', type: 'text' },
        { name: 'consigneeAddress', label: 'Consignee Address', type: 'textarea', span: 2 },
        { name: 'notifyPartyName', label: 'Notify Party Name', type: 'text' },
        { name: 'notifyPartyAddress', label: 'Notify Party Address', type: 'textarea', span: 2 },
      ],
    },
    {
      title: 'Destination',
      fields: [
        { name: 'destination', label: 'Destination', type: 'text' },
        { name: 'portOfDischarge', label: 'Port of Discharge', type: 'text' },
        { name: 'finalDestination', label: 'Final Destination', type: 'text' },
      ],
    },
  ],
  schema: z.object({
    buyerCode: req('Buyer code', 20),
    buyerName: req('Buyer name', 150),
    address: opt(1000),
    country: opt(80),
    contactPerson: opt(120),
    email: optEmail,
    phone: opt(40),
    currency: opt(10),
    paymentTerms: opt(150),
    status,
    consigneeName: opt(200),
    consigneeAddress: opt(1000),
    notifyPartyName: opt(200),
    notifyPartyAddress: opt(1000),
    destination: opt(120),
    portOfDischarge: opt(120),
    finalDestination: opt(120),
    priceTerms: opt(150),
    shipMode: opt(40),
    freightTerms: opt(40),
  }),
};

// ===========================================================================
//  VENDORS
// ===========================================================================

export const vendorMaster = {
  key: 'vendors',
  module: 'VENDOR',
  api: vendors,
  title: 'Vendors',
  singular: 'Vendor',
  idField: 'id',
  titleField: 'vendorName',
  defaultSort: 'vendorName',
  searchPlaceholder: 'Search code, name, contact, GST, category, city, location...',
  filters: [{ name: 'category', label: 'Category', listCode: 'VendorCategory' }],
  /*
   * The six columns the Vendor Master sheet names, and only those.
   *
   * Category, Pin Code, PO Prefix and Status are still on the FORM and still
   * do their jobs - the category guard on job work, the pin code on the dye
   * issue, the initials on the PO number. They are off the table because the
   * office reads this screen to find a vendor, not to audit one.
   */
  columns: [
    { field: 'vendorCode', label: 'Vendor Code', sortable: true, className: 'code' },
    { field: 'vendorName', label: 'Vendor Name', sortable: true },
    { field: 'address', label: 'Address', optional: true, render: (r) => addrCell(r.address) },
    { field: 'city', label: 'City' },
    { field: 'vendorLocation', label: 'Vendor Location', optional: true  },
    { field: 'gstNo', label: 'GSTN', optional: true, className: 'code' },
  ],
  sections: [
    {
      title: 'Identification',
      fields: [
        { name: 'vendorCode', label: 'Vendor Code', type: 'text', hint: 'Auto-numbered (VEN-001) if left blank.' },
        { name: 'vendorName', label: 'Vendor Name', type: 'text', required: true },
        { name: 'category', label: 'Category', type: 'master', listCode: 'VendorCategory', required: true },
        {
          name: 'poInitials',
          label: 'PO Prefix',
          type: 'text',
          hint: 'Purchase orders read "vendor initial + no" (Rajasthan Fabrics -> RF-001). Derived if blank.',
        },
        { name: 'status', label: 'Status', type: 'status' },
      ],
    },
    {
      title: 'Address & Contact',
      fields: [
        { name: 'address', label: 'Address', type: 'textarea', span: 2 },
        { name: 'city', label: 'City', type: 'text' },
        {
          name: 'vendorLocation',
          label: 'Vendor Location',
          type: 'text',
          hint: 'Where the work is done, when that is not where the vendor bills from.',
        },
        { name: 'pinCode', label: 'Pin Code', type: 'text', hint: '6 digits. Printed on the dye issue.' },
        { name: 'contactPerson', label: 'Contact Person', type: 'text' },
        { name: 'phone', label: 'Phone', type: 'text' },
        { name: 'email', label: 'Email', type: 'email' },
      ],
    },
    {
      title: 'Statutory & Banking',
      fields: [
        { name: 'gstNo', label: 'GST No', type: 'text', hint: '15-character GSTIN.' },
        { name: 'bankDetails', label: 'Bank Details', type: 'text' },
        { name: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
      ],
    },
  ],
  schema: z.object({
    vendorCode: opt(20),
    vendorName: req('Vendor name', 150),
    category: req('Category', 60),
    address: opt(1000),
    city: opt(120),
    vendorLocation: opt(120),
    gstNo: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.toUpperCase() : null))
      .refine(
        (v) => v === null || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(v),
        'Must be a valid 15-character GSTIN',
      ),
    contactPerson: opt(120),
    phone: opt(40),
    email: optEmail,
    bankDetails: opt(200),
    status,
    remarks: opt(2000),
    poInitials: opt(10),
    pinCode: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^[0-9]{6}$/.test(v), 'Pin code must be 6 digits'),
  }),
};

// ===========================================================================
//  EMPLOYEES
// ===========================================================================

export const employeeMaster = {
  key: 'employees',
  module: 'EMPLOYEE',
  api: employees,
  title: 'Employees',
  singular: 'Employee',
  idField: 'id',
  titleField: 'empName',
  defaultSort: 'empId',
  searchPlaceholder: 'Search ID, name, department, unit...',
  filters: [
    { name: 'department', label: 'Department', listCode: 'Department' },
    { name: 'designation', label: 'Designation', listCode: 'Designation' },
  ],
  columns: [
    { field: 'empId', label: 'Emp ID', sortable: true, className: 'code' },
    { field: 'empName', label: 'Emp Name', sortable: true },
    { field: 'department', label: 'Department', sortable: true },
    { field: 'designation', label: 'Designation', optional: true, sortable: true },
    { field: 'unitLine', label: 'Unit / Line', optional: true  },
    { field: 'status', label: 'Status', sortable: true, render: (r) => <StatusBadge status={r.status} /> },
  ],
  sections: [
    {
      title: 'Employee',
      fields: [
        { name: 'empId', label: 'Emp ID', type: 'text', hint: 'Auto-numbered (EMP-001) if left blank.' },
        { name: 'empName', label: 'Emp Name', type: 'text', required: true },
        { name: 'department', label: 'Department', type: 'master', listCode: 'Department', required: true },
        { name: 'designation', label: 'Designation', type: 'master', listCode: 'Designation', required: true },
        {
          name: 'unitLine',
          label: 'Unit / Line',
          type: 'text',
          hint: 'A stitching unit or a floor location - free text, as in the workbook.',
        },
        { name: 'status', label: 'Status', type: 'status' },
      ],
    },
  ],
  schema: z.object({
    empId: opt(20),
    empName: req('Employee name', 120),
    department: req('Department', 60),
    designation: req('Designation', 60),
    unitLine: opt(80),
    status,
  }),
};

// ===========================================================================
//  STYLES  (header; the BOM grid is rendered by StyleBomEditor)
// ===========================================================================

export const styleMaster = {
  key: 'styles',
  module: 'STYLE',
  api: styles,
  title: 'Styles & BOM',
  singular: 'Style',
  idField: 'id',
  titleField: 'styleNo',
  defaultSort: 'styleNo',
  modalSize: 'wide',
  searchPlaceholder: 'Search style no, description, category, colour...',
  filters: [{ name: 'category', label: 'Category', listCode: 'StyleCategory' }],
  columns: [
    { field: 'styleNo', label: 'Style No', sortable: true, className: 'code' },
    { field: 'styleDescription', label: 'Style Description', sortable: true },
    { field: 'buyer', label: 'Buyer', render: (r) => r.buyer?.buyerName ?? '-' },
    { field: 'category', label: 'Category', sortable: true },
    { field: 'fabricContent', label: 'Fabric Content', optional: true  },
    { field: 'colorCode', label: 'Color', optional: true  },
    {
      field: 'avgFabricUtilizationPerPc',
      label: 'Avg Util / Pc',
      className: 'num',
      render: (r) => `${Number(r.avgFabricUtilizationPerPc)} ${r.avgUtilizationUom ?? ''}`.trim(),
    },
    { field: 'bomLineCount', label: 'BOM Lines', optional: true, className: 'num', render: (r) => r.bomLineCount ?? (r.bomLines?.length ?? 0) },
    { field: 'status', label: 'Status', sortable: true, render: (r) => <StatusBadge status={r.status} /> },
  ],
  sections: [
    {
      title: 'Style',
      fields: [
        { name: 'styleNo', label: 'Style No', type: 'text', required: true, hint: 'e.g. TR-0751-008' },
        { name: 'styleDescription', label: 'Style Description', type: 'text', required: true },
        { name: 'buyerId', label: 'Buyer', type: 'record', resource: 'buyers', required: true },
        { name: 'fabricContent', label: 'Fabric Content', type: 'master', listCode: 'FabricContent' },
        /*
         * The colourway the STYLE NUMBER is - not the colour of a material and
         * not the colour of an order line. TP-0007-008 is the Natural pouch
         * and TP-0007-009 the Black one; the buyer decides that when the style
         * is registered, so it is asked for here.
         */
        { name: 'colorCode', label: 'Color', type: 'master', listCode: 'ColorCode' },
        {
          name: 'avgFabricUtilizationPerPc',
          label: 'Avg Fabric Utilization / Pc',
          type: 'number',
          step: '0.0001',
        },
        {
          name: 'qtyPerCarton',
          label: 'Qty / Ctn',
          type: 'number',
          step: '1',
        },
        { name: 'status', label: 'Status', type: 'status' },
        { name: 'remarks', label: 'Remarks', type: 'textarea', span: 2 },
      ],
    },
  ],
  schema: z.object({
    styleNo: req('Style number', 40),
    styleDescription: req('Style description', 200),
    buyerId: z.string().uuid('Select a buyer'),
    fabricContent: opt(80),
    colorCode: opt(60),
    avgFabricUtilizationPerPc: zeroOrPositive('Average fabric utilisation'),
    qtyPerCarton: optCount('Qty / Ctn'),
    status,
    remarks: opt(2000),
    /*
     * No spec sheet (measurements, closure, lining, artwork) on this form, by
     * request. The columns are still on the style and still print on the
     * cutting challan where a style already has them; leaving them out of the
     * form sends nothing for them, so an edit here does not blank them.
     */
  }),
};

export const MASTERS = {
  buyers: buyerMaster,
  vendors: vendorMaster,
  employees: employeeMaster,
  styles: styleMaster,
};
