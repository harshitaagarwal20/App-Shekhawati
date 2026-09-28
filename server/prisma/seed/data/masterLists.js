/**
 * Master Lists - seeded verbatim from the "Master Lists" sheet of
 * "Shekwati Impex formats.xlsx" (row 4 = list name, rows 5+ = values).
 *
 * Only the lists consumed by an IN-SCOPE module are seeded. The workbook also
 * carries Operation, InformTo, RejectReason, SentFor, StatusDispatch,
 * StatusRecon, StatusQC, YesNo and InspDefect26, all of which belong to the
 * post-Cutting-Issue modules that are explicitly out of scope; they are
 * deliberately left out.
 *
 * Lists whose values drive workflow logic (StatusGeneral, StatusApproval,
 * StatusActive, GatePassType, Decision, StatusGatePass, StatusDyeRecv,
 * FabricStage, Process, Purpose, GRNPurpose, PlanDept) are Prisma enums in
 * schema.prisma and are therefore not duplicated here.
 */

/**
 * The statutory GST slabs.
 *
 * These are not workbook data - the workbook records no tax at all - and they
 * are not invented either: they are the rates the GST Council publishes. The
 * label is what a person reads on a bill; `attributes.rate` is the FRACTION the
 * arithmetic uses, so that no percentage is ever written into code.
 *
 * Head Office edits this list when a slab changes. Nothing is deployed.
 */
const gstRateValues = [
  { value: '0%',  attributes: { rate: '0' } },
  { value: '5%',  attributes: { rate: '0.05' } },
  { value: '12%', attributes: { rate: '0.12' } },
  { value: '18%', attributes: { rate: '0.18' } },
  { value: '28%', attributes: { rate: '0.28' } },
];

export const masterLists = [
  {
    code: 'GST Rate',
    name: 'GST Rate',
    description: 'Purchase invoice - the GST slab charged on a vendor bill',
    values: gstRateValues,
  },
  {
    code: 'Country',
    name: 'Country',
    description: 'Buyer Master - Country dropdown (L_Country)',
    values: ['India', 'USA', 'UK', 'Netherlands', 'Germany', 'France', 'Sweden', 'Australia', 'UAE'],
  },
  {
    code: 'Currency',
    name: 'Currency',
    description: 'Buyer Master / Order - Currency dropdown (L_Currency)',
    values: ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'AED'],
  },
  {
    code: 'ShipMode',
    name: 'Ship Mode',
    description: 'Buyer Master / Order - Ship Mode dropdown (L_ShipMode)',
    // Ship / Air / Road exactly as the reference specification lists them.
    // 'Courier' was carried here in an earlier phase and is NOT in the source
    // data; it has been removed rather than left as invented master data.
    // Nothing seeded referenced it. If the office does courier shipments, the
    // value is added on the List Master screen, which is where master values
    // belong.
    values: ['Ship', 'Air', 'Road'],
  },
  {
    code: 'UOM',
    name: 'Unit of Measure',
    description: 'Quotation / PO / Gate Pass / GRN / Dye issue / Printing (L_UOM)',
    values: ['Mtrs', 'Kg', 'Pcs', 'Roll', 'Box', 'Set', 'Dozen', 'Gruse'],
  },
  {
    code: 'ItemCategory',
    name: 'Item Category',
    description: 'Quotation / PO / GRN - Item dropdown (L_ItemCategory)',
    /*
     * FABRIC AND ACCESSORIES, NOT SEVEN.
     *
     * Handle, Zipper, Label, Thread and Button used to sit here as categories
     * AND in L_AccessoriesItem as items, so one black zipper could be recorded
     * two ways - ("Zipper", no item) or ("Accessories", "Zipper"). Those are
     * different tuples in the inventory identity key, so they became two stock
     * items for one physical thing, with two balances and two reorder levels,
     * and nothing downstream noticed because categoryOf() resolves all five to
     * ACCESSORIES anyway.
     *
     * Trim is now recorded one way: Accessories, plus the item. Stationery
     * follows the same shape: Stationery, plus the L_StationeryItem article.
     */
    values: [
      'Fabric',
      'Accessories',
      'Stationery',
    ],
  },
  {
    code: 'StationeryItem',
    name: 'Stationery Item',
    description: 'PO - the stationery article, shown only when Item = Stationery (Pen, Register, A4 Paper)',
    values: [
      'Pen',
      'Pencil',
      'Marker',
      'Register',
      'A4 Paper',
      'File / Folder',
      'Stapler',
      'Stapler Pins',
      'Tape',
      'Printer Toner',
    ],
  },
  {
    code: 'FabricSubCat',
    name: 'Fabric Sub Category',
    description: 'PO - sub-category dropdown (L_FabricSubCat)',
    values: ['8 oz', '10 oz', '12 oz', '14 oz', '16 oz', 'Canvas 10x6', 'Canvas 12x12'],
  },
  {
    code: 'AccessoriesItem',
    name: 'Accessories Item',
    description: 'PO - Accessories item dropdown, shown only when Item = Accessories',
    values: [
      'Button',
      'Zipper',
      'Cotton Handle',
      'Jute Handle',
      'Woven Label',
      'Care Label',
      'Hang Tag',
      'Rivet',
      'D-Ring',
    ],
  },
  {
    /*
     * Which button, which zipper. Each value names the Accessories Item it
     * belongs to in `attributes.item`, and the Variety dropdown shows only the
     * values of the item chosen beside it.
     */
    code: 'AccessoryVariety',
    name: 'Accessory Variety',
    description: 'Which kind of an accessories item - Button: 4-hole horn 18L. Each value belongs to one item.',
    values: [
      { value: '4-hole horn 18L', attributes: { item: 'Button' } },
      { value: '2-hole plastic 24L', attributes: { item: 'Button' } },
      { value: 'Metal shank 20L', attributes: { item: 'Button' } },
      { value: '#5 metal 20cm', attributes: { item: 'Zipper' } },
      { value: '#3 nylon 15cm', attributes: { item: 'Zipper' } },
      { value: '1.25" webbing', attributes: { item: 'Cotton Handle' } },
      { value: '1.5" webbing', attributes: { item: 'Cotton Handle' } },
    ],
  },
  {
    code: 'ColorCode',
    name: 'Color Code',
    description: 'Order / PO / Fabric Issue / Dye issue - Colour dropdown (L_ColorCode)',
    values: [
      'Natural',
      'Night Black',
      'Navy Blue',
      'Olive Green',
      'Burgundy',
      'Off White',
      'Khaki',
      'Rust',
      'Black',
      'Mustard',
      'Purple',
      'Smoke Blue',
      'Smoke Pink',
      'Olive',
      'Royal Blue',
      'Red',
      'Mid Night Blue',
      'Sky Gray',
      'Dark Green',
      'Sand Gbeige',
      'White',
      'Wine Red',
      'Pink',
      'Light Blue',
      'Indigo',
      'Wash Blue',
      'Vintage Blue',
      'Orange',
      'Turquoise Blue',
      'Vivid Pink',
      'Midnight Blue',
      'Navy',
    ],
  },
  {
    code: 'FabricContent',
    name: 'Fabric Content',
    description: 'Style Master / PO / Dye issue - Content dropdown (L_FabricContent)',
    values: [
      '100% Cotton',
      '100% Jute',
      'Cotton-Poly 80:20',
      'Recycled Cotton',
      'Canvas Cotton',
    ],
  },
  {
    code: 'GSM',
    name: 'GSM',
    description: 'PO / Dye issue - GSM dropdown (L_GSM)',
    values: ['220 GSM', '260 GSM', '280 GSM', '320 GSM', '340 GSM', '400 GSM'],
  },
  {
    code: 'Count',
    name: 'Count',
    description: 'PO / Dye issue - Count (L_Count)',
    values: ['10x6', '12x12', '16x12', '20x20', '8x4'],
  },
  {
    code: 'Construction',
    name: 'Construction',
    description: 'Dye issue - Construction (L_Construction)',
    values: ['76x28', '60x60', '48x28', '68x38'],
  },
  {
    code: 'SizeGroup',
    name: 'Size Group',
    description: 'Style Master / Order - Size Group (L_SizeGroup)',
    values: ['Free Size', 'Small', 'Medium', 'Large', 'XL'],
  },
  {
    code: 'Department',
    name: 'Department',
    description: 'Employee Master - Department (L_Department)',
    values: [
      'Procurement',
      'Planning',
      'Cutting',
      'Stitching',
      'Printing',
      'QC',
      'Packing',
      'Dispatch',
    ],
  },
  {
    code: 'Designation',
    name: 'Designation',
    description: 'Employee Master - Designation (L_Designation)',
    values: ['Checker', 'Operator', 'Tailor', 'Supervisor', 'Manager', 'GM', 'Director'],
  },
  {
    code: 'StitchingUnit',
    name: 'Stitching Unit',
    description: 'Planning Unit / Cutting Issue Firm Name / Employee Unit (L_StitchingUnit)',
    values: [
      'Unit 1 - Anil Kumar',
      'Unit 2 - Mahipal',
      'Unit 3 - Ramesh',
      'Unit 4 - Suresh',
    ],
  },
  {
    code: 'ContainerNo',
    name: 'Container No',
    description: 'Planning / Plan Approval / Cutting Issue - Container No (L_ContainerNo)',
    values: ['CN-91', 'CN-92', 'CN-93', 'CN-94', 'CN-95'],
  },
  {
    code: 'VendorCategory',
    name: 'Vendor Category',
    description: 'Vendor Master - Category (L_VendorCategory)',
    values: [
      'Fabric',
      'Accessories',
      'Dyeing',
      'Printing',
      'Stitching Unit',
      'External QC',
      'Transport',
      'Other',
    ],
  },
  {
    code: 'StyleCategory',
    name: 'Style Category',
    description: 'Style Master - Category (L_StyleCategory)',
    values: ['Tote Bag', 'Basic Bag', 'Purse', 'Pouch', 'Shopper'],
  },
  {
    code: 'AuthorisedBy',
    name: 'Authorised By',
    description: 'Quotation / Gate Pass / Fabric Scrutiny - Authorised By (L_AuthorisedBy)',
    values: ['Dinesh Sir', 'Vinay ji (GM)'],
  },
  {
    code: 'DefectType',
    name: 'Defect Type',
    description:
      'Fabric Scrutiny Report - Defect Type (L_DefectType). The workbook keeps one shared defect list; the fabric-side values are the ones used in scope.',
    values: [
      'Dyeing Shade Variation',
      'Weaving Defect',
      'Cut/Hole',
      'Stain',
      'Torn',
      'Improper Hem',
      'Untrimmed Thread',
      'Handle Out',
      'Handle Size',
      'Without Label',
      'Slanted Label',
      'Double Lupi',
      'Without Lupi',
      'Wrong Side Lupi',
      'Double Stitch',
      'Without Stitch',
    ],
  },
  {
    code: 'PaymentTerms',
    name: 'Payment Terms',
    description: 'Buyer Master - Payment Terms (L_PaymentTerms)',
    values: [
      'Advance 30% + 70% on BL',
      'LC 60 Days',
      'TT 30 Days',
      'TT 45 Days',
      'Net 90',
    ],
  },
  {
    code: 'FreightTerms',
    name: 'Freight Terms',
    description:
      'Buyer Master - Freight Terms dropdown. The column is marked "Dropdown" on the Buyer Master sheet but has no column on Master Lists; values taken from the sample rows.',
    values: ['Prepaid', 'Collect'],
  },
  {
    code: 'PriceTerms',
    name: 'Price Terms (Incoterm)',
    description:
      'Buyer Master - Price Terms (Incoterm). Marked Manual on the sheet; seeded as a list so it can be standardised.',
    values: ['FOB Jaipur, India', 'CIF', 'CFR', 'EXW Jaipur, India'],
  },
  {
    code: 'StockLocation',
    name: 'Stock Location',
    description:
      'Inventory location. Not present in the workbook (which has no inventory sheet); minimum list needed to hold a stock balance.',
    values: ['MAIN STORE', 'CUTTING FLOOR', 'AT DYEING VENDOR', 'AT PRINTING VENDOR', 'REMNANT STORE'],
  },
  {
    code: 'Closure',
    name: 'Closure',
    description: 'Style Master - how the bag closes (L_Closure)',
    values: ['Zip', 'Magnetic Snap', 'Snap Button', 'Drawstring', 'Velcro', 'Buckle', 'Open Top'],
  },
  {
    code: 'Lining',
    name: 'Lining',
    description: 'Style Master - what the bag is lined with (L_Lining)',
    values: ['Unlined', 'Cotton', 'Polyester', 'PU Coated', 'Jute'],
  },
  {
    code: 'StyleComponent',
    name: 'Style Component',
    description: 'Style Master - panel names for the cutting list (L_StyleComponent)',
    values: ['Front Panel', 'Back Panel', 'Gusset', 'Base', 'Handle', 'Strap', 'Pocket', 'Flap', 'Lining'],
  },
];
