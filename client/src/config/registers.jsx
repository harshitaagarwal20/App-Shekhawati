/**
 * The registers kept after cutting - one descriptor per workbook sheet.
 *
 * RegisterPage renders every one of them, the way MasterPage renders the
 * masters: the list, its filters, the form and its dropdowns all come from
 * here, so the twelve screens behave identically.
 *
 * Labels are the workbook's own column captions, misspellings included where
 * the floor knows them that way ("Psc", "Stiching"), so a person who kept the
 * sheet recognises the screen.
 *
 * Every Formula / Auto column is worked out by the server. The `preview`
 * fields below show the same arithmetic while the form is being keyed, and
 * are never sent: what is stored is what the server calculates.
 *
 * FIELD TYPES
 *   date, int, text, textarea      plain inputs
 *   master                         a Master List dropdown (`listCode`)
 *   order                          the order picker; loads the order's context
 *   style                          one of the order's styles (Auto)
 *   employee                       the Employee Master; `typedName` allows a
 *                                  name to be typed for someone not on it
 *   cuttingIssue                   one of the order's cutting issues
 *   preview                        read-only, `compute(form, ctx)`
 *   figures                        the reconciliation counts for the style
 *   inspectionGrid                 the 26-defect inspection report
 *
 * `onContext({ ctx, form })` names the values the order (and style) fill in.
 * They land only in a field that is empty or still holds the last value
 * filled for it, so nothing a person typed is ever overwritten.
 */

import { fmtDate, fmtDateTime, fmtNum, fmtPctFromFraction } from '../utils/format.js';

// --- the sheets' formulas, for the previews only ----------------------------

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pct = (a, b) => (num(b) === 0 ? '0.00%' : `${((num(a) / num(b)) * 100).toFixed(2)}%`);

/** The sheet's hour columns: 10, 11, 12, 1, 2, 3, 4, 5:30, 6:30. */
export const HOURLY_SLOTS = [
  { key: 'pcsAt10', label: '10:00' },
  { key: 'pcsAt11', label: '11:00' },
  { key: 'pcsAt12', label: '12:00' },
  { key: 'pcsAt13', label: '1:00' },
  { key: 'pcsAt14', label: '2:00' },
  { key: 'pcsAt15', label: '3:00' },
  { key: 'pcsAt16', label: '4:00' },
  { key: 'pcsAt1730', label: '5:30' },
  { key: 'pcsAt1830', label: '6:30' },
];

/** The Finished Checker's seventeen defect columns, in the sheet's order. */
export const FINISHED_CHECKER_DEFECTS = [
  { key: 'untrimmedThread', label: 'Untrimmed Thread' },
  { key: 'handleOut', label: 'Handle out' },
  { key: 'handleSize', label: 'Handle size' },
  { key: 'handleAlter', label: 'Handle Alter' },
  { key: 'withoutLabel', label: 'Without Label' },
  { key: 'slantedLabel', label: 'Slanted Lable' },
  { key: 'doubleLupi', label: 'Double Lupi' },
  { key: 'withoutLupi', label: 'Without Lupi' },
  { key: 'wrongSideLupi', label: 'Wrong side lupi' },
  { key: 'weavingDefect', label: 'Weaving defect' },
  { key: 'cutHole', label: 'Cut/hole' },
  { key: 'improperHem', label: 'Improper Hem' },
  { key: 'doubleStitch', label: 'Double Stitch' },
  { key: 'withoutStitch', label: 'without stich' },
  { key: 'torn', label: 'Torn' },
  { key: 'stain', label: 'Strain' },
  { key: 'alter', label: 'Alter' },
];

const finishedTotal = (f) => FINISHED_CHECKER_DEFECTS.reduce((s, d) => s + num(f[d.key]), 0);

/** The chosen style's entry in the order context, if any. */
const styleCtx = (form, ctx) => ctx?.styles?.find((s) => s.id === form.styleId) ?? ctx?.styles?.[0] ?? null;

// --- shared fields and columns ----------------------------------------------

const DATE = { name: 'recordDate', label: 'Date', type: 'date', defaultToday: true };
const ORDER = { name: 'orderId', label: 'Order No', type: 'order', required: true };
const STYLE = { name: 'styleId', label: 'Style No', type: 'style', hint: "Auto: the order's style." };
const REMARKS = { name: 'remarks', label: 'Remarks', type: 'textarea', span: 2 };
const UNIT = { name: 'unitName', label: 'Unit', type: 'master', listCode: 'StitchingUnit', required: true };

const col = {
  date: (field = 'recordDate', label = 'Date') => ({
    key: field, label, sort: field, render: (r) => fmtDate(r[field]), className: 'nowrap',
  }),
  order: { key: 'order', label: 'Order No', render: (r) => r.order?.orderNo ?? '-', className: 'code' },
  style: { key: 'style', label: 'Style No', render: (r) => r.style?.styleNo ?? '-', className: 'code' },
  num: (field, label, { sort = true, strong = false } = {}) => ({
    key: field,
    label,
    sort: sort ? field : undefined,
    className: 'num',
    render: (r) => (strong ? <strong>{fmtNum(r[field])}</strong> : fmtNum(r[field])),
  }),
  pct: (field, label) => ({
    key: field, label, sort: field, className: 'num', render: (r) => fmtPctFromFraction(r[field]),
  }),
  text: (field, label, opts = {}) => ({ key: field, label, render: (r) => r[field] ?? '-', ...opts }),
  emp: (rel, label = 'Name') => ({ key: `${rel}Name`, label, render: (r) => r[rel]?.empName ?? '-' }),
  empCode: (rel, label = 'Checker Code') => ({
    key: `${rel}Code`, label, className: 'code', render: (r) => r[rel]?.empId ?? '-',
  }),
};

const unitFilter = { name: 'unitName', label: 'Unit', listCode: 'StitchingUnit' };

// ===========================================================================
//  STITCHING
// ===========================================================================

export const stitchingRecord = {
  key: 'stitching',
  path: 'stitching-records',
  module: 'STITCHING_RECORD',
  title: 'Stitching Record',
  singular: 'stitching record',
  sheet: 'Stiching Record - Role Acess: Stitching Dept (Supervisor)',
  intro: "What each unit stitched against the pieces it was issued. Choose the cutting issue the lot came on and the unit and deliverable size fill themselves.",
  filters: [unitFilter],
  columns: [
    col.text('unitName', 'Unit Name', { sort: 'unitName' }),
    col.date(),
    col.order,
    col.style,
    { key: 'challan', label: 'Challan', className: 'code', render: (r) => r.cuttingIssue?.challanNo ?? '-' },
    col.num('deliverableSize', 'Deliverable Size'),
    col.num('actualQty', 'Actual', { strong: true }),
    col.num('remainingQty', 'Remaining'),
    col.text('remarks', 'Remarks', { optional: true }),
  ],
  sections: [
    {
      title: 'Lot',
      fields: [
        DATE,
        ORDER,
        STYLE,
        {
          name: 'cuttingIssueId',
          label: 'Cutting Issue (challan)',
          type: 'cuttingIssue',
          hint: 'The challan the pieces were issued on. Fills the unit and the deliverable size.',
          onPick: (issue) => ({
            unitName: issue.firmName,
            deliverableSize: String(Math.round(num(issue.cuttingPcsIssued))),
            styleId: issue.styleId,
          }),
        },
        { ...UNIT, label: 'Unit Name' },
      ],
    },
    {
      title: 'Output',
      fields: [
        { name: 'deliverableSize', label: 'Deliverable Size', type: 'int', required: true },
        { name: 'actualQty', label: 'Actual', type: 'int', required: true },
        {
          name: '_remaining',
          label: 'Remaining',
          type: 'preview',
          compute: (f) => fmtNum(num(f.deliverableSize) - num(f.actualQty)),
          hint: 'Deliverable Size - Actual',
        },
        REMARKS,
      ],
    },
  ],
};

export const hourlyMonitoring = {
  key: 'hourly',
  path: 'hourly-monitoring',
  module: 'HOURLY_MONITORING',
  title: 'Hourly Monitoring',
  singular: 'hourly row',
  sheet: 'Stitching Hourly Format - Role Acess: Stitching Dept (Supervisor)',
  intro: 'One row per operator, per order, per day. Open the day\'s row and fill the next hour; the time each hour was keyed is captured.',
  modalSize: 'wide',
  columns: [
    col.date(),
    col.order,
    col.empCode('employee', 'Emp Id'),
    col.emp('employee'),
    ...HOURLY_SLOTS.map((s) => col.num(s.key, s.label, { sort: false })),
    col.num('totalPcs', 'Total', { strong: true }),
  ],
  sections: [
    {
      title: 'Operator',
      fields: [DATE, ORDER, STYLE, { name: 'employeeId', label: 'Emp Id', type: 'employee', required: true }],
    },
    {
      title: 'Pieces per hour',
      fields: [
        ...HOURLY_SLOTS.map((s) => ({ name: s.key, label: s.label, type: 'int', captured: true })),
        {
          name: '_total',
          label: 'Total',
          type: 'preview',
          compute: (f) => fmtNum(HOURLY_SLOTS.reduce((sum, s) => sum + num(f[s.key]), 0)),
        },
        REMARKS,
      ],
    },
  ],
};

export const alterReport = {
  key: 'alter',
  path: 'alter-reports',
  module: 'ALTER_REPORT',
  title: 'Alter Report',
  singular: 'alter record',
  sheet: 'Alter Record - Role Acess: Stitching Dept (Supervisor)',
  intro: 'Pieces sent for alteration and what passed after it. The time is captured when the record is saved.',
  dateField: 'capturedAt',
  columns: [
    col.order,
    col.style,
    { key: 'capturedAt', label: 'Time', sort: 'capturedAt', className: 'nowrap', render: (r) => fmtDateTime(r.capturedAt) },
    col.num('outputPcs', 'Output'),
    col.num('passPcs', 'Pass/ok'),
    col.num('alterPcs', 'Alter piece', { strong: true }),
    col.pct('alterPct', 'Alter%'),
    col.text('remarks', 'Remarks', { optional: true }),
  ],
  sections: [
    {
      title: 'Alteration',
      fields: [
        ORDER,
        STYLE,
        { name: 'outputPcs', label: 'Output', type: 'int', required: true },
        { name: 'passPcs', label: 'Pass/ok', type: 'int', required: true, hint: 'Pieces passed after alteration.' },
        { name: 'alterPcs', label: 'Alter piece', type: 'int', required: true },
        { name: '_alterPct', label: 'Alter%', type: 'preview', compute: (f) => pct(f.alterPcs, f.outputPcs), hint: 'Alter piece / Output' },
        REMARKS,
      ],
    },
  ],
};

// ===========================================================================
//  QUALITY
// ===========================================================================

const TAILOR = { name: 'tailorId', label: 'Tailor Name', type: 'employee', typedName: 'tailorName', required: true };

export const qcSizeRecord = {
  key: 'qcSize',
  path: 'qc-size-records',
  module: 'QC_SIZE_RECORD',
  title: 'QC Size',
  singular: 'QC size record',
  sheet: 'Daily QC Record (Tailor Size) - Role Acess: QC Dept (Checker)',
  filters: [unitFilter],
  columns: [
    col.date(),
    col.order,
    col.text('unitName', 'Unit', { sort: 'unitName' }),
    col.text('tailorName', 'Tailor Name', { sort: 'tailorName' }),
    col.style,
    col.text('operation', 'Operation', { sort: 'operation' }),
    col.text('size', 'Size'),
    col.num('pcsCheckedRejected', 'Psc Checked/Reject'),
    col.text('defectFound', 'Defects found'),
    col.text('informTo', 'Inform To'),
  ],
  sections: [
    {
      title: 'Check',
      fields: [
        DATE,
        ORDER,
        UNIT,
        TAILOR,
        STYLE,
        { name: 'operation', label: 'Operation', type: 'master', listCode: 'Operation', required: true },
        { name: 'size', label: 'Size', type: 'text', hint: "Defaults to the order's size group." },
        { name: 'pcsCheckedRejected', label: 'Psc Checked/Reject', type: 'int', required: true },
        { name: 'defectFound', label: 'Defects found', type: 'master', listCode: 'DefectType' },
        { name: 'informTo', label: 'Inform To', type: 'master', listCode: 'InformTo' },
        REMARKS,
      ],
    },
  ],
  onContext: ({ ctx }) => (ctx?.order?.sizeGroup ? { size: ctx.order.sizeGroup } : null),
};

export const qcDefectRecord = {
  key: 'qcDefect',
  path: 'qc-defect-records',
  module: 'QC_DEFECT_RECORD',
  title: 'QC Defects',
  singular: 'QC defect record',
  sheet: 'Daily QC Record (Tailor Defects) - Role Acess: QC Dept (Checker)',
  filters: [unitFilter],
  columns: [
    col.date(),
    col.order,
    col.text('unitName', 'Unit', { sort: 'unitName' }),
    col.text('tailorName', 'Tailor Name', { sort: 'tailorName' }),
    col.style,
    col.num('pcsCheckedRejected', 'Pcs Checked/Reject'),
    col.text('defectFound', 'Defects Found'),
    col.text('informTo', 'Inform To'),
  ],
  sections: [
    {
      title: 'Check',
      fields: [
        DATE,
        ORDER,
        UNIT,
        TAILOR,
        { ...STYLE, label: 'Style' },
        { name: 'pcsCheckedRejected', label: 'Pcs Checked/Reject', type: 'int', required: true },
        { name: 'defectFound', label: 'Defects Found', type: 'master', listCode: 'DefectType' },
        { name: 'informTo', label: 'Inform To', type: 'master', listCode: 'InformTo' },
        REMARKS,
      ],
    },
  ],
};

export const internalQualityCheck = {
  key: 'internalQc',
  path: 'internal-quality-checks',
  module: 'INTERNAL_QUALITY_CHECK',
  title: 'Internal Quality Check',
  singular: 'internal quality check',
  sheet: 'Internal Quality Check (Finishing & Trimming), hourly basis - Role Acess: QC Dept (Checker)',
  filters: [unitFilter, { name: 'qcStatus', label: 'Status', listCode: 'StatusQC' }],
  columns: [
    col.date(),
    col.order,
    col.style,
    col.text('unitName', 'Stitching Unit', { sort: 'unitName' }),
    col.empCode('checker'),
    col.num('totalPcsChecked', 'Total Pcs Checked'),
    col.num('totalDefectPcs', 'Total Defect Pcs', { strong: true }),
    col.text('defectType', 'Defect Type'),
    col.text('qcStatus', 'Status', { sort: 'qcStatus' }),
    col.text('transferredBackToUnit', 'Transferred Back To Unit', { optional: true }),
    col.text('remarks', 'Remarks', { optional: true }),
  ],
  sections: [
    {
      title: 'Check',
      fields: [
        DATE,
        ORDER,
        STYLE,
        { ...UNIT, label: 'Stitching Unit' },
        { name: 'checkerId', label: 'Checker Code', type: 'employee', required: true },
        { name: 'totalPcsChecked', label: 'Total Pcs Checked', type: 'int', required: true },
        { name: 'totalDefectPcs', label: 'Total Defect Pcs', type: 'int', required: true },
        { name: 'defectType', label: 'Defect Type', type: 'master', listCode: 'DefectType' },
        { name: 'qcStatus', label: 'Status', type: 'master', listCode: 'StatusQC', required: true },
        {
          name: 'transferredBackToUnit',
          label: 'Transferred Back To Unit',
          type: 'master',
          listCode: 'StitchingUnit',
          hint: 'Required when the status is Rejected.',
          requiredIf: (f) => f.qcStatus === 'Rejected',
        },
        REMARKS,
      ],
    },
  ],
};

export const finalCheckerReport = {
  key: 'finalChecker',
  path: 'final-checker-reports',
  module: 'FINAL_CHECKER_REPORT',
  title: 'Final Checker Report',
  singular: 'final checker report',
  sheet: 'Internal Record - Role Acess: QC Dept (Checker)',
  intro: 'The sheet carries no order. Choose one only to fill the style.',
  orderOptional: true,
  columns: [
    col.date(),
    col.empCode('checker'),
    col.emp('checker'),
    col.style,
    col.num('totalPcsChecked', 'Total Pcs Checked'),
    col.num('totalDefect', 'Total Defect', { strong: true }),
    col.text('defectType', 'Defect Type', { optional: true }),
    { ...col.order, optional: true },
  ],
  sections: [
    {
      title: 'Check',
      fields: [
        DATE,
        { name: 'checkerId', label: 'Name', type: 'employee', required: true, hint: 'The checker code fills from the name.' },
        { ...ORDER, required: false, hint: 'Optional - fills the style.' },
        { ...STYLE, required: true, hint: 'From the order, or chosen.' },
        { name: 'totalPcsChecked', label: 'Total Pcs Checked', type: 'int', required: true },
        { name: 'totalDefect', label: 'Total Defect', type: 'int', required: true },
        { name: 'defectType', label: 'Defect Type', type: 'master', listCode: 'DefectType' },
        REMARKS,
      ],
    },
  ],
};

export const finishedChecker = {
  key: 'finishedChecker',
  path: 'finished-checker-records',
  module: 'FINISHED_CHECKER',
  title: 'Finished Checker',
  singular: 'finished checker record',
  sheet: 'Daily QC Record - Role Acess: QC Dept (Checker)',
  intro: 'A count per defect type. Projected, pieces passed and the defect percentage are worked out on save.',
  modalSize: 'wide',
  columns: [
    col.order,
    col.empCode('checker'),
    col.emp('checker'),
    col.date(),
    col.num('checkedPcs', 'Checked Psc'),
    col.num('totalDefects', 'Projected', { strong: true }),
    col.num('piecesPassed', 'Total pieces passed'),
    col.pct('defectPct', 'Defects %'),
  ],
  sections: [
    {
      title: 'Check',
      fields: [
        ORDER,
        { name: 'checkerId', label: 'Checker Code / Name', type: 'employee', required: true },
        DATE,
        STYLE,
        { name: 'checkedPcs', label: 'Checked Psc', type: 'int', required: true },
      ],
    },
    {
      title: 'Defects (pieces)',
      fields: [
        ...FINISHED_CHECKER_DEFECTS.map((d) => ({ name: d.key, label: d.label, type: 'int' })),
      ],
    },
    {
      title: 'Totals',
      fields: [
        { name: '_projected', label: 'Projected', type: 'preview', compute: (f) => fmtNum(finishedTotal(f)), hint: 'Sum of the defects' },
        { name: '_passed', label: 'Total pieces passed', type: 'preview', compute: (f) => fmtNum(num(f.checkedPcs) - finishedTotal(f)), hint: 'Checked - Projected' },
        { name: '_pct', label: 'Defects %', type: 'preview', compute: (f) => pct(finishedTotal(f), f.checkedPcs) },
        REMARKS,
      ],
    },
  ],
};

export const externalSecondaryCheck = {
  key: 'externalCheck',
  path: 'external-secondary-checks',
  module: 'EXTERNAL_SECONDARY_CHECK',
  title: 'External Secondary Checking',
  singular: 'inspection report',
  sheet: 'External Secondary Checking - Inspection Report - Role Acess: QC Dept (External Agency)',
  intro: 'The agency\'s inspection, line by line over the 26 inspection defects. Totals, pass quantity and defect ratio are worked out on save.',
  modalSize: 'wide',
  columns: [
    col.date(),
    col.order,
    col.style,
    col.num('inspectionQty', 'Inspection Qty'),
    col.num('criticalTotal', 'Critical', { sort: false }),
    col.num('majorTotal', 'Major', { sort: false }),
    col.num('minorTotal', 'Minor', { sort: false }),
    col.num('totalDefects', 'Total Defect', { strong: true }),
    col.num('passQty', 'Pass Qty'),
    col.pct('defectRatio', 'Defect Ratio'),
    col.text('personIncharge', 'Person Incharge', { optional: true }),
  ],
  sections: [
    {
      title: 'Inspection',
      fields: [
        DATE,
        ORDER,
        STYLE,
        { name: 'agencyName', label: 'Agency', type: 'text' },
        { name: 'personIncharge', label: 'Person Incharge', type: 'text' },
        { name: 'inspectionQty', label: 'Total Inspection Qty', type: 'int', required: true },
      ],
    },
    {
      title: 'Particulars',
      fields: [{ name: 'lines', type: 'inspectionGrid', listCode: 'InspDefect26', span: 2 }, REMARKS],
    },
  ],
};

export const spotRectification = {
  key: 'spotRectification',
  path: 'spot-rectifications',
  module: 'SPOT_RECTIFICATION',
  title: 'Spot Rectification & Scrap',
  singular: 'spot rectification',
  sheet: 'Spot Rectification & Scrap / Online Sale - Role Acess: QC / Packing Dept',
  columns: [
    col.date(),
    col.order,
    col.style,
    col.num('qtyReceived', 'Qty Received for Rectification'),
    col.num('soldOnlineQty', 'Sold Online-Domestic Qty'),
    col.num('scrapQty', 'Scrap Qty', { strong: true }),
    col.pct('scrapPct', 'Scrap % of Consignment'),
    col.text('authorisedBy', 'Authorised By'),
    col.text('remarks', 'Remarks', { optional: true }),
  ],
  sections: [
    {
      title: 'Rectification',
      fields: [
        DATE,
        ORDER,
        STYLE,
        { name: 'qtyReceived', label: 'Qty Received for Rectification', type: 'int', required: true },
        { name: 'soldOnlineQty', label: 'Sold Online-Domestic Qty', type: 'int' },
        { name: 'scrapQty', label: 'Scrap Qty', type: 'int' },
        {
          name: '_scrapPct',
          label: 'Scrap % of Consignment',
          type: 'preview',
          compute: (f, ctx) => pct(f.scrapQty, styleCtx(f, ctx)?.orderQty),
          hint: 'Scrap Qty / Order Qty from the order (2-3% norm)',
        },
        { name: 'authorisedBy', label: 'Authorised By', type: 'master', listCode: 'AuthorisedBy' },
        REMARKS,
      ],
    },
  ],
};

export const rejectedRecord = {
  key: 'rejected',
  path: 'rejected-records',
  module: 'REJECTED_RECORD',
  title: 'Rejected',
  singular: 'rejected record',
  sheet: 'Rejected Record Format - Role Acess: QC Dept (Checker)',
  filters: [{ name: 'rejectReason', label: 'Reason', listCode: 'RejectReason' }],
  columns: [
    col.date(),
    col.order,
    col.style,
    col.num('orderQty', 'Order Qty', { sort: false }),
    col.num('cuttingQty', 'Cutting Qty'),
    col.num('packedQty', 'Packed Qty'),
    col.num('rejectedQty', 'Rejected Qty', { strong: true }),
    col.text('checkedByName', 'Check By'),
    col.text('rejectReason', 'Reason of Defects'),
    col.text('remarks', 'Remarks', { optional: true }),
  ],
  sections: [
    {
      title: 'Rejection',
      fields: [
        DATE,
        ORDER,
        STYLE,
        {
          name: '_orderQty',
          label: 'Order Qty',
          type: 'preview',
          compute: (f, ctx) => fmtNum(styleCtx(f, ctx)?.orderQty),
          hint: 'From the order.',
        },
        { name: 'cuttingQty', label: 'Cutting Qty', type: 'int', hint: 'From the cutting issues - correct it if the floor count differs.' },
        { name: 'packedQty', label: 'Packed Qty', type: 'int', required: true },
        {
          name: '_rejected',
          label: 'Rejected Qty',
          type: 'preview',
          compute: (f) => fmtNum(num(f.cuttingQty) === 0 ? 0 : num(f.cuttingQty) - num(f.packedQty)),
          hint: 'Cutting Qty - Packed Qty',
        },
        { name: 'checkedById', label: 'Check By', type: 'employee', typedName: 'checkedByName' },
        { name: 'rejectReason', label: 'Reason of Defects', type: 'master', listCode: 'RejectReason' },
        REMARKS,
      ],
    },
  ],
  onContext: ({ ctx, form }) => {
    const s = styleCtx(form, ctx);
    return s ? { cuttingQty: String(Math.round(num(s.figures?.cuttingIssued))) } : null;
  },
};

// ===========================================================================
//  RECONCILIATION
// ===========================================================================

const fig = (key, label, opts = {}) => ({
  key: `figures.${key}`,
  label,
  className: 'num',
  render: (r) => (opts.strong ? <strong>{fmtNum(r.figures?.[key])}</strong> : fmtNum(r.figures?.[key])),
});

export const reconciliationReport = {
  key: 'reconciliation',
  path: 'reconciliation-reports',
  module: 'RECONCILIATION_REPORT',
  title: 'Reconciliation Report',
  singular: 'reconciliation',
  sheet: 'Cutting - Stitching - Packing Reconciliation - Role Acess: Planning Dept (GM)',
  intro:
    'One per order and style. Every count is read live from the registers; only the status and remarks are kept. '
    + 'Variance = Cutting Issued - Stitched - Scrap - Rejected, the pieces still at the units. '
    + 'Packed Pcs are the Rejected sheet\'s Packed Qty until Packing is in the system.',
  filters: [{ name: 'reconStatus', label: 'Status', listCode: 'StatusRecon' }],
  columns: [
    col.order,
    col.style,
    fig('cuttingIssued', 'Cutting Pcs Issued'),
    fig('stitched', 'Stitched Pcs Received'),
    fig('alter', 'Alter Pcs'),
    fig('scrap', 'Scrap Pcs'),
    fig('rejected', 'Rejected Pcs'),
    fig('packed', 'Packed Pcs'),
    fig('variance', 'Variance', { strong: true }),
    col.text('reconStatus', 'Status', { sort: 'reconStatus' }),
    col.text('remarks', 'Remarks', { optional: true }),
  ],
  sections: [
    {
      title: 'Order',
      fields: [
        ORDER,
        STYLE,
        { name: '_figures', type: 'figures', span: 2 },
      ],
    },
    {
      title: 'Decision',
      fields: [
        { name: 'reconStatus', label: 'Status', type: 'master', listCode: 'StatusRecon', hint: 'Proposed from the variance; yours to decide.' },
        REMARKS,
      ],
    },
  ],
  onContext: ({ ctx, form }) => {
    const s = styleCtx(form, ctx);
    return s?.figures ? { reconStatus: s.figures.suggestedStatus } : null;
  },
};

export const REGISTERS = {
  stitching: stitchingRecord,
  hourly: hourlyMonitoring,
  alter: alterReport,
  qcSize: qcSizeRecord,
  qcDefect: qcDefectRecord,
  internalQc: internalQualityCheck,
  finalChecker: finalCheckerReport,
  finishedChecker,
  externalCheck: externalSecondaryCheck,
  spotRectification,
  rejected: rejectedRecord,
  reconciliation: reconciliationReport,
};
