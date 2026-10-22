/**
 * The Phase 5 registers - one descriptor per workbook sheet.
 *
 * RegisterPage renders every one of them, the way MasterPage renders the
 * masters: the list, its filters, the form and its dropdowns all come from
 * here, so the screens behave identically.
 *
 * Labels are the workbook's own column captions ("Checked Psc"), so a person
 * who kept the sheet recognises the screen.
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
 *   employee                       the Employee Master
 *   preview                        read-only, `compute(form, ctx)`
 *   figures                        the reconciliation counts for the style
 *
 * `fields` are laid out in one grid, in order, with no headings between them.
 *
 * `onContext({ ctx, form })` names the values the order (and style) fill in.
 * They land only in a field that is empty or still holds the last value
 * filled for it, so nothing a person typed is ever overwritten.
 */

import { fmtDate, fmtNum, fmtPctFromFraction } from '../utils/format.js';

// --- the sheets' formulas, for the previews only ----------------------------

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pct = (a, b) => (num(b) === 0 ? '0.00%' : `${((num(a) / num(b)) * 100).toFixed(2)}%`);

/** The Finished Checker's seventeen defect columns, in the sheet's order. */
export const FINISHED_CHECKER_DEFECTS = [
  { key: 'untrimmedThread', label: 'Untrimmed Thread' },
  { key: 'handleOut', label: 'Handle out' },
  { key: 'handleSize', label: 'Handle size' },
  { key: 'handleAlter', label: 'Handle Alter' },
  { key: 'withoutLabel', label: 'Without Label' },
  { key: 'slantedLabel', label: 'Slanted Label' },
  { key: 'doubleLupi', label: 'Double Lupi' },
  { key: 'withoutLupi', label: 'Without Lupi' },
  { key: 'wrongSideLupi', label: 'Wrong side lupi' },
  { key: 'weavingDefect', label: 'Weaving defect' },
  { key: 'cutHole', label: 'Cut/hole' },
  { key: 'improperHem', label: 'Improper Hem' },
  { key: 'doubleStitch', label: 'Double Stitch' },
  { key: 'withoutStitch', label: 'Without stitch' },
  { key: 'torn', label: 'Torn' },
  { key: 'stain', label: 'Stain' },
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
//  QUALITY
// ===========================================================================

export const internalQualityCheck = {
  key: 'internalQc',
  path: 'internal-quality-checks',
  module: 'INTERNAL_QUALITY_CHECK',
  title: 'Internal Quality Check',
  singular: 'internal quality check',
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
};

export const finalCheckerReport = {
  key: 'finalChecker',
  path: 'final-checker-reports',
  module: 'FINAL_CHECKER_REPORT',
  title: 'Final Checker Report',
  singular: 'final checker report',
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
};

export const finishedChecker = {
  key: 'finishedChecker',
  path: 'finished-checker-records',
  module: 'FINISHED_CHECKER',
  title: 'Finished Checker',
  singular: 'finished checker record',
  columns: [
    col.order,
    col.empCode('checker'),
    col.emp('checker'),
    col.date(),
    col.num('checkedPcs', 'Checked Psc'),
    col.num('totalDefects', 'Projected', { strong: true }),
    col.num('piecesPassed', 'Total pieces passed'),
    col.pct('defectPct', 'Defects %'),
    ...FINISHED_CHECKER_DEFECTS.map((d) => ({ ...col.num(d.key, d.label, { sort: false }), optional: true })),
  ],
  fields: [
    ORDER,
    { name: 'checkerId', label: 'Checker Code / Name', type: 'employee', required: true },
    DATE,
    STYLE,
    { name: 'checkedPcs', label: 'Checked Psc', type: 'int', required: true },
    ...FINISHED_CHECKER_DEFECTS.map((d) => ({ name: d.key, label: d.label, type: 'int' })),
    { name: '_projected', label: 'Projected', type: 'preview', compute: (f) => fmtNum(finishedTotal(f)), hint: 'Sum of the defects' },
    { name: '_passed', label: 'Total pieces passed', type: 'preview', compute: (f) => fmtNum(num(f.checkedPcs) - finishedTotal(f)), hint: 'Checked - Projected' },
    { name: '_pct', label: 'Defects %', type: 'preview', compute: (f) => pct(finishedTotal(f), f.checkedPcs) },
    REMARKS,
  ],
};

export const spotRectification = {
  key: 'spotRectification',
  path: 'spot-rectifications',
  module: 'SPOT_RECTIFICATION',
  title: 'Spot Rectification & Scrap',
  singular: 'spot rectification',
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
  filters: [{ name: 'reconStatus', label: 'Status', listCode: 'StatusRecon' }],
  columns: [
    col.order,
    col.style,
    fig('cuttingIssued', 'Cutting Pcs Issued'),
    fig('stitched', 'Stitched Pcs Received'),
    fig('alter', 'Alter Pcs'),
    fig('scrap', 'Scrap Pcs'),
    fig('rejected', 'Rejected Pcs'),
    fig('passedExternalQc', 'Passed External QC'),
    fig('variance', 'Variance', { strong: true }),
    col.text('reconStatus', 'Status', { sort: 'reconStatus' }),
    col.text('remarks', 'Remarks', { optional: true }),
  ],
  fields: [
    ORDER,
    STYLE,
    { name: '_figures', type: 'figures', span: 2 },
    { name: 'reconStatus', label: 'Status', type: 'master', listCode: 'StatusRecon', hint: 'Proposed from the variance; yours to decide.' },
    REMARKS,
  ],
  onContext: ({ ctx, form }) => {
    const s = styleCtx(form, ctx);
    return s?.figures ? { reconStatus: s.figures.suggestedStatus } : null;
  },
};

export const REGISTERS = {
  internalQc: internalQualityCheck,
  finalChecker: finalCheckerReport,
  finishedChecker,
  spotRectification,
  reconciliation: reconciliationReport,
};
