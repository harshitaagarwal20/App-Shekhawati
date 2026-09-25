/**
 * Operational reports.
 *
 * ===========================================================================
 *  ONE REGISTRY, NOT FOURTEEN ENDPOINTS
 * ===========================================================================
 *
 * Every report is a row in `REPORTS` below, carrying its own title, the
 * permission it needs, the filters it accepts, the columns it returns and the
 * function that runs it. Three things follow from that shape:
 *
 *   RBAC IS DECLARED ONCE.  `permission` on the descriptor is the only place a
 *      report's access is stated, and `/reports` filters the catalogue by it -
 *      so a user is never offered a report the API would refuse. The route
 *      checks it again on every run, which is what actually protects the data.
 *
 *   THE UI NEEDS NO PER-REPORT CODE.  Columns are described here - key, label,
 *      alignment, format - so one React screen renders all fourteen and the CSV
 *      export works for all fourteen. Fourteen bespoke screens would be
 *      fourteen chances to format a quantity differently.
 *
 *   NOTHING IS COMPUTED IN THE BROWSER.  Every derived figure a report shows -
 *      an ageing bucket, a shortfall, a fill percentage - is worked out here in
 *      Decimal and sent as a string. Same rule as everywhere else in this
 *      application.
 *
 * ---------------------------------------------------------------------------
 *  SCOPE
 *
 *  Fourteen reports, one per implemented module, exactly as the brief lists
 *  them. There is deliberately no report for stitching, hourly monitoring, QC
 *  records, packing, dispatch or reconciliation - those modules do not exist in
 *  this system, and a report is not a permitted way to smuggle one in.
 * ---------------------------------------------------------------------------
 */

import prisma, { notDeleted } from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { isBelowReorder } from './inventory.service.js';
import { D, ageDays } from '../utils/figures.js';
import { toCsv as writeCsv } from '../utils/csv.js';
import { EXTRA_REPORTS } from './reports.extra.js';

const ZERO = D(0);

/** The soft-delete filter every report shares. */
const LIVE = notDeleted;

/**
 * Builds a date-range filter, or nothing when neither bound is given.
 *
 * `field` MUST be a `@db.Date` column. The bound is INCLUSIVE, and
 * `new Date('2026-09-01')` is midnight UTC - which is the whole of a date
 * column's 1 September, and none of a timestamp column's. Pointed at a
 * `@db.Timestamptz` column this silently drops the final day of every range,
 * and drops it again 5.5 hours out of step because the factory works in IST.
 *
 * Every report below filters on its own business date column for that reason,
 * and because the date a document is FOR is the date a report is asked about -
 * never the date a row happened to be written. A timestamp column would need
 * an exclusive next-day bound computed in IST, which this helper does not do.
 */
function between(field, from, to) {
  if (!from && !to) return {};
  return {
    [field]: {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    },
  };
}

/**
 * Column shorthand.
 *
 * `format` tells the client how to render without knowing what the report is:
 * `qty` and `money` get tabular numerals and the Indian grouping, `date` gets
 * DD-MM-YYYY in Asia/Kolkata, `state` gets the workflow badge.
 */
const col = (key, label, format = 'text') => ({ key, label, format });

// ===========================================================================
//  THE REPORTS
// ===========================================================================

/**
 * Every report the system offers.
 *
 * `filters` names what the report accepts, so the screen can render the right
 * controls without a per-report component.
 */
export const REPORTS = {
  // -------------------------------------------------------------------------
  //  ORDERS AND PLANNING
  // -------------------------------------------------------------------------

  'order-status': {
    title: 'Order status',
    description:
      'Every buyer order, what it permits, what has been planned against it and what has been ' +
      'procured for it.',
    permission: 'BUYER_ORDER.VIEW',
    excelRef: 'Order',
    category: 'PLANNING',
    filters: ['buyerId', 'status', 'dateFrom', 'dateTo'],
    columns: [
      col('orderNo', 'Order No'),
      col('orderDate', 'Date', 'date'),
      col('buyerName', 'Buyer'),
      col('styleNo', 'Style'),
      col('orderQty', 'Order Qty', 'qty'),
      col('excessPctDisplay', 'Excess asked'),
      col('effectiveQty', 'Permitted Qty', 'qty'),
      col('excessApprovalStatus', 'Excess'),
      col('plannedQty', 'Planned', 'qty'),
      col('plannedPctDisplay', 'Planned %'),
      col('poCount', 'POs', 'qty'),
      col('poValue', 'PO value', 'money'),
      col('cutPcs', 'Cut', 'qty'),
      col('deliveryDate', 'Delivery', 'date'),
      col('daysToDelivery', 'Days left', 'qty'),
      col('workflowState', 'Workflow', 'state'),
      col('status', 'Status'),
    ],
    run: orderStatus,
  },

  /**
   * THE ORDER BOOK - what the orders on hand are worth.
   *
   * Valued at the ORDERED pieces x the agreed price, never the excess. An
   * order with any unpriced line reports no value at all rather than a
   * partial one, and is counted separately so the gap is visible.
   */
  'order-book': {
    title: 'Order book',
    description:
      'What the orders on hand are worth, when each must leave the factory, and how much has ' +
      'already been committed to materials against it.',
    permission: 'BUYER_ORDER.VIEW',
    excelRef: 'Order',
    category: 'PLANNING',
    filters: ['buyerId', 'status', 'dateFrom', 'dateTo'],
    columns: [
      col('orderNo', 'Order No'),
      col('buyerPoNo', 'Buyer PO'),
      col('buyerName', 'Buyer'),
      col('orderQty', 'Pieces', 'qty'),
      col('currency', 'Curr.'),
      col('orderValue', 'Value', 'money'),
      col('exchangeRate', 'Rate', 'qty'),
      col('orderValueInr', 'Value (INR)', 'money'),
      col('poValue', 'Materials ordered (INR)', 'money'),
      col('materialPctDisplay', 'Materials % of value'),
      col('exFactoryDate', 'Ex-factory', 'date'),
      col('daysToExFactory', 'Days left', 'qty'),
      col('status', 'Status'),
    ],
    run: orderBook,
  },

  'planning-status': {
    title: 'Planning status',
    description: 'Plans against the quantity their order permits, and where each one has got to.',
    permission: 'PLANNING.VIEW',
    excelRef: 'Planning_ + Planning',
    category: 'PLANNING',
    filters: ['orderId', 'status', 'dateFrom', 'dateTo'],
    columns: [
      col('planNo', 'Plan No'),
      /** The column the date filter acts on - every other report shows its own. */
      col('planDate', 'Date', 'date'),
      col('orderNo', 'Order No'),
      col('department', 'Department'),
      col('containerNo', 'Container'),
      col('orderQty', 'Order Qty', 'qty'),
      col('effectiveQty', 'Permitted Qty', 'qty'),
      col('plannedQty', 'Planned Qty', 'qty'),
      col('headroom', 'Headroom', 'qty'),
      col('plannedCuttingPcs', 'Cutting pcs', 'qty'),
      col('lineCount', 'Lines', 'qty'),
      col('submittedTo', 'Submitted to'),
      col('workflowState', 'Workflow', 'state'),
      col('approvalStatus', 'Approval'),
    ],
    run: planningStatus,
  },

  // -------------------------------------------------------------------------
  //  PROCUREMENT
  // -------------------------------------------------------------------------

  'pending-quotations': {
    title: 'Pending quotations',
    description:
      'Quotations awaiting the Director, with the competing rate for the same item so the ' +
      'decision does not need a second screen.',
    permission: 'VENDOR_QUOTATION.VIEW',
    excelRef: 'Vendor Quotation-Approval',
    category: 'PROCUREMENT',
    filters: ['vendorId', 'orderId'],
    columns: [
      col('quotationNo', 'Quotation No'),
      col('quotationDate', 'Date', 'date'),
      col('vendorName', 'Vendor'),
      col('item', 'Item'),
      col('uom', 'UOM'),
      col('qty', 'Qty', 'qty'),
      col('rateQuoted', 'Rate', 'money'),
      col('amount', 'Amount', 'money'),
      col('orderNo', 'Order No'),
      col('competingCount', 'Other quotes', 'qty'),
      col('lowestRate', 'Lowest rate', 'money'),
      col('isLowest', 'Is lowest'),
      col('waitingDays', 'Waiting', 'qty'),
    ],
    run: pendingQuotations,
  },

  'pending-po-approvals': {
    title: 'Pending PO approvals',
    description:
      'Purchase orders awaiting approval, and — where one is not ready to send — what it is ' +
      'still missing.',
    permission: 'PURCHASE_ORDER.VIEW',
    excelRef: 'PO',
    category: 'PROCUREMENT',
    filters: ['vendorId', 'orderId'],
    columns: [
      col('poId', 'PO ID'),
      col('poDate', 'Date', 'date'),
      col('vendorName', 'Vendor'),
      col('item', 'Item'),
      col('orderQty', 'Order Qty', 'qty'),
      col('rate', 'Rate', 'money'),
      col('amount', 'Amount', 'money'),
      col('orderNo', 'Order No'),
      col('quotationNo', 'Quotation'),
      col('rateMatchesQuote', 'Rate matches quote'),
      col('readyToApprove', 'Ready'),
      col('missing', 'Still needs'),
      col('waitingDays', 'Waiting', 'qty'),
    ],
    run: pendingPoApprovals,
  },

  'po-status': {
    title: 'PO status',
    description: 'Every purchase order against what has actually been received on it.',
    permission: 'PURCHASE_ORDER.VIEW',
    excelRef: 'PO',
    category: 'INVENTORY',
    filters: ['vendorId', 'orderId', 'status', 'dateFrom', 'dateTo'],
    columns: [
      col('poId', 'PO ID'),
      col('poDate', 'Date', 'date'),
      col('vendorName', 'Vendor'),
      col('item', 'Item'),
      col('uom', 'UOM'),
      col('orderQty', 'Order Qty', 'qty'),
      col('receivedQty', 'Received', 'qty'),
      col('pendingQty', 'Pending', 'qty'),
      col('receivedPctDisplay', 'Received %'),
      col('amount', 'PO value', 'money'),
      col('receivedValue', 'Received value', 'money'),
      col('grnCount', 'GRNs', 'qty'),
      col('breaches', 'Over tolerance', 'qty'),
      col('orderNo', 'Order No'),
      col('workflowState', 'Workflow', 'state'),
      col('status', 'Status'),
    ],
    run: poStatus,
  },

  'pending-grns': {
    title: 'Pending GRNs',
    description:
      'Approved purchase orders still expecting goods, oldest first, with anything already at ' +
      'the gate but not yet receipted.',
    permission: 'GRN.VIEW',
    excelRef: 'GRN',
    category: 'INVENTORY',
    filters: ['vendorId', 'orderId'],
    columns: [
      col('poId', 'PO ID'),
      col('poDate', 'PO date', 'date'),
      col('vendorName', 'Vendor'),
      col('item', 'Item'),
      col('uom', 'UOM'),
      col('orderQty', 'Ordered', 'qty'),
      col('receivedQty', 'Received', 'qty'),
      col('pendingQty', 'Still due', 'qty'),
      col('gatePassesWaiting', 'At the gate', 'qty'),
      col('lastGrnDate', 'Last receipt', 'date'),
      col('ageDays', 'PO age', 'qty'),
      col('orderNo', 'Order No'),
    ],
    run: pendingGrns,
  },

  // -------------------------------------------------------------------------
  //  STORE
  // -------------------------------------------------------------------------

  inventory: {
    title: 'Inventory',
    description:
      'Stock on hand by item and location, valued, with the ledger position shown beside the ' +
      'cached balance.',
    permission: 'INVENTORY.VIEW',
    excelRef: '— derived; the workbook has no inventory sheet',
    category: 'INVENTORY',
    filters: ['itemCategory', 'location'],
    columns: [
      col('itemCode', 'Item Code'),
      col('description', 'Description'),
      col('itemCategory', 'Category'),
      col('location', 'Location'),
      col('uom', 'UOM'),
      col('qtyIn', 'Total in', 'qty'),
      col('qtyOut', 'Total out', 'qty'),
      col('onHand', 'On hand', 'qty'),
      col('avgRate', 'Avg rate', 'money'),
      col('value', 'Value', 'money'),
      col('reorderLevel', 'Reorder level', 'qty'),
      col('belowReorder', 'Below reorder'),
      col('agrees', 'Ledger agrees'),
    ],
    run: inventoryReport,
  },

  'roll-wise-stock': {
    title: 'Roll-wise stock',
    description:
      'Every fabric roll with its balance, its stage, where it is, and the chain back to the ' +
      'order it was bought for.',
    permission: 'FABRIC_ROLL.VIEW',
    excelRef: 'Fabric Issue / Dye issue — the "Roll No" column',
    category: 'INVENTORY',
    filters: ['stage', 'location', 'vendorId', 'colorCode'],
    columns: [
      col('rollNo', 'Roll No'),
      col('fabricName', 'Fabric'),
      col('colorCode', 'Colour'),
      col('gsm', 'GSM'),
      col('count', 'Count'),
      col('uom', 'UOM'),
      col('receivedQty', 'Received', 'qty'),
      col('balanceQty', 'Balance', 'qty'),
      col('consumedQty', 'Consumed', 'qty'),
      col('consumedPctDisplay', 'Consumed %'),
      col('stage', 'Stage'),
      col('location', 'Location'),
      col('held', 'Held'),
      col('grnNo', 'GRN'),
      col('vendorName', 'Vendor'),
      col('poId', 'PO'),
      col('orderNo', 'Order'),
    ],
    run: rollWiseStock,
  },

  'fabric-issued': {
    title: 'Fabric issued',
    description: 'Fabric off the rack, by purpose, order and person.',
    permission: 'FABRIC_ISSUE.VIEW',
    excelRef: 'Fabric Issue',
    category: 'INVENTORY',
    filters: ['orderId', 'purpose', 'dateFrom', 'dateTo'],
    columns: [
      col('issueNo', 'Issue No'),
      col('issueDate', 'Date', 'date'),
      col('rollNo', 'Roll No'),
      col('fabricName', 'Fabric'),
      col('colorCode', 'Colour'),
      col('purpose', 'Purpose'),
      col('qtyIssued', 'Qty issued', 'qty'),
      col('uom', 'UOM'),
      col('orderNo', 'Order No'),
      col('styleNo', 'Style'),
      col('issuedByName', 'Issued by'),
      col('destination', 'Went to'),
      col('posted', 'In the ledger'),
    ],
    run: fabricIssued,
  },

  // -------------------------------------------------------------------------
  //  JOB WORK
  //
  //  Dyeing and printing are separate reports because they are separate
  //  conversations with separate vendors, even though one register holds both.
  // -------------------------------------------------------------------------

  'dyeing-status': {
    title: 'Dyeing status',
    description:
      'Dyeing and washing lots: what is still at the vendor, what came back, and what shrank ' +
      'more than it was allowed to.',
    permission: 'DYE_ISSUE.VIEW',
    excelRef: 'Dye issue + Dyeing Receipt',
    category: 'STAFF_EFFICIENCY',
    filters: ['vendorId', 'orderId', 'status', 'dateFrom', 'dateTo'],
    columns: [
      col('jobNo', 'Job No'),
      col('issueDate', 'Date', 'date'),
      col('process', 'Process'),
      col('vendorName', 'Vendor'),
      col('rollNo', 'Roll No'),
      col('colourCode', 'Colour'),
      col('qty', 'Sent', 'qty'),
      col('receivedQty', 'Returned', 'qty'),
      col('pendingQty', 'Still out', 'qty'),
      col('shrinkagePctDisplay', 'Shrinkage %'),
      col('allowedPctDisplay', 'Allowed %'),
      col('breached', 'Over allowance'),
      col('rate', 'Rate', 'money'),
      col('amount', 'Amount', 'money'),
      col('orderNo', 'Order No'),
      col('daysOut', 'Days out', 'qty'),
      col('status', 'Status'),
    ],
    run: (q) => jobWorkStatus(q, ['DYEING']),
  },

  'printing-status': {
    title: 'Printing status',
    description:
      'Printing and finishing lots, and the separate Printing register the workbook keeps for ' +
      'after-stitching work.',
    permission: 'PRINTING.VIEW',
    excelRef: 'Dye issue (printing) + Printing',
    category: 'STAFF_EFFICIENCY',
    filters: ['vendorId', 'orderId', 'status', 'dateFrom', 'dateTo'],
    columns: [
      col('jobNo', 'Job No'),
      col('issueDate', 'Date', 'date'),
      col('process', 'Process'),
      col('vendorName', 'Vendor'),
      col('rollNo', 'Roll No'),
      col('fabricStage', 'Fabric stage'),
      col('qty', 'Sent', 'qty'),
      col('receivedQty', 'Returned', 'qty'),
      col('pendingQty', 'Still out', 'qty'),
      col('shrinkagePctDisplay', 'Loss %'),
      col('allowedPctDisplay', 'Allowed %'),
      col('breached', 'Over allowance'),
      col('amount', 'Amount', 'money'),
      col('orderNo', 'Order No'),
      col('daysOut', 'Days out', 'qty'),
      col('status', 'Status'),
    ],
    run: printingStatus,
  },

  // -------------------------------------------------------------------------
  //  QC, PLANNING APPROVAL AND CUTTING
  // -------------------------------------------------------------------------

  'scrutiny-status': {
    title: 'Scrutiny status',
    description:
      'Fabric scrutiny findings and decisions, with the ones still awaiting the Director at ' +
      'the top.',
    permission: 'FABRIC_SCRUTINY.VIEW',
    excelRef: 'Fabric Scrutiny Report',
    category: 'STAFF_EFFICIENCY',
    filters: ['orderId', 'decision', 'dateFrom', 'dateTo'],
    columns: [
      col('scrutinyNo', 'Scrutiny No'),
      col('scrutinyDate', 'Date', 'date'),
      col('rollNo', 'Roll No'),
      col('defectType', 'Defect'),
      col('qtyAffected', 'Qty affected', 'qty'),
      col('uom', 'UOM'),
      col('affectedPctDisplay', '% of roll'),
      col('orderNo', 'Order No'),
      col('styleNo', 'Style'),
      col('checkedByName', 'Checked by'),
      col('decision', 'Decision'),
      col('finalised', 'Finalised'),
      col('decidedByName', 'Decided by'),
      col('amendmentCount', 'Amendments', 'qty'),
      col('rollHeld', 'Roll held'),
      col('waitingDays', 'Waiting', 'qty'),
    ],
    run: scrutinyStatus,
  },

  'plan-approval-status': {
    title: 'Plan approval status',
    description:
      'Plan approvals by version, with what each rejection said and whether it has been ' +
      'rectified yet.',
    permission: 'PLAN_APPROVAL.VIEW',
    excelRef: 'Plan Approval',
    category: 'PLANNING',
    filters: ['orderId', 'approvalStatus', 'dateFrom', 'dateTo'],
    columns: [
      col('approvalNo', 'Approval No'),
      col('version', 'Version', 'qty'),
      col('submittedDate', 'Submitted', 'date'),
      col('orderNo', 'Order No'),
      col('containerNo', 'Container'),
      col('planNo', 'Plan'),
      col('preparedBy', 'Prepared by'),
      col('submittedTo', 'Submitted to'),
      col('supersedes', 'Replaces'),
      col('rejectionReason', 'Rejection reason'),
      col('rectificationRemarks', 'Rectification'),
      col('awaitingRectification', 'Needs rectifying'),
      col('approvedDate', 'Approved', 'date'),
      col('cuttingIssues', 'Challans', 'qty'),
      col('workflowState', 'Workflow', 'state'),
      col('waitingDays', 'Waiting', 'qty'),
    ],
    run: planApprovalStatus,
  },

  'cutting-issue-status': {
    title: 'Cutting issue status',
    description:
      'Cutting challans against the plan that authorised them. The last report in ' +
      'the pipeline.',
    permission: 'CUTTING_ISSUE.VIEW',
    excelRef: 'Cutting Issue',
    category: 'STAFF_EFFICIENCY',
    filters: ['orderId', 'status', 'dateFrom', 'dateTo'],
    columns: [
      col('challanNo', 'Challan No'),
      col('issueDate', 'Date', 'date'),
      col('orderNo', 'Order No'),
      col('styleNo', 'Style'),
      col('containerNo', 'Container'),
      col('plannedCutting', 'Planned', 'qty'),
      col('cuttingPcsIssued', 'Issued', 'qty'),
      col('varianceQty', 'Variance', 'qty'),
      col('handleIssued', 'Handles', 'qty'),
      col('approvalNo', 'Approval'),
      col('approvalVersion', 'Version', 'qty'),
      col('excessAuthorised', 'Excess authorised'),
      col('posted', 'Posted'),
      col('workflowState', 'Workflow', 'state'),
    ],
    run: cuttingIssueStatus,
  },

  // Cutting efficiency, stock valuation, ITC-04, TNA - see reports.extra.js.
  ...EXTRA_REPORTS,
};

// ===========================================================================
//  THE CATALOGUE
// ===========================================================================

/**
 * The reports this user may actually run.
 *
 * Filtered by permission so nobody is offered a report the API would refuse.
 * The route checks the same permission again on every run.
 *
 * @param has - Permission check function
 * @param category - Optional: filter by report category (INVENTORY, STAFF_EFFICIENCY, PLANNING, PROCUREMENT)
 */
export function catalogue(has, category) {
  return Object.entries(REPORTS)
    .filter(([, r]) => has(r.permission) && (!category || r.category === category))
    .map(([key, r]) => ({
      key,
      title: r.title,
      description: r.description,
      permission: r.permission,
      excelRef: r.excelRef,
      category: r.category,
      filters: r.filters,
      columns: r.columns,
    }));
}

/** Looks a report up, refusing an unknown key rather than returning nothing. */
export function descriptorFor(key) {
  const report = REPORTS[key];
  if (!report) {
    throw ApiError.notFound(`Report "${key}"`);
  }
  return report;
}

/**
 * Runs a report.
 *
 * Row limits are applied by each query. These are operational reports over one
 * factory's live documents, not analytics over history - but a limit is still
 * passed so a mis-set date filter cannot pull the whole table into a browser.
 */
/**
 * The most rows any single report will ever assemble.
 *
 * A guard against a filterless run on a table that has grown, not a page size.
 * A report that hits it says so - see `truncated` below - so the reader is
 * told their figures are partial rather than left to assume they are whole.
 */
const HARD_CAP = 5000;

/** Rows on a page of a report, and the most anybody may ask for at once. */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

/**
 * Runs one report and returns one page of it.
 *
 * ===========================================================================
 *  THE TOTALS ARE OF THE WHOLE REPORT. THE ROWS ARE ONE PAGE.
 * ===========================================================================
 *
 * Every report descriptor computes its `totals` by walking the rows it
 * selected. That is what makes paging here delicate: had the descriptor been
 * handed a `skip` and a `take`, "Total PO value" would quietly have become
 * "total PO value of the fifty lines on this page" - a figure that changes as
 * you page through, is wrong on every page but the first, and looks exactly
 * like the right answer.
 *
 * So the descriptor still selects the whole filtered set and still totals all
 * of it. The paging happens here, afterwards, on the assembled rows.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THIS BUYS, AND WHAT IT DOES NOT
 *
 *  It buys the payload and the render: a fourteen-column report of 2,000 rows
 *  was ~2 MB of JSON and 28,000 table cells for a browser to lay out, on every
 *  run. A page is fifty rows of that.
 *
 *  It does NOT reduce the database's work - the query behind the report still
 *  reads every matching row, because the totals are made of them. Pushing the
 *  paging down to SQL would mean giving every one of the fourteen reports a
 *  second, aggregate-only query to compute its totals from. That is the right
 *  change if these reports ever get slow at the database rather than in the
 *  browser; it is not the problem today, and fourteen hand-written aggregates
 *  is a large surface to get subtly wrong for a gain nobody can currently
 *  measure.
 *
 *  The CSV export deliberately does not page. An export is for the whole
 *  report - see the csv controller.
 * ---------------------------------------------------------------------------
 */
/**
 * Assembles a whole report: every row the filters matched, and the totals over
 * all of them. Shared by the paged screen and the unpaged export, so the two
 * can never disagree about what the report contains.
 */
async function assemble(key, query) {
  const report = descriptorFor(key);

  /*
   * F-11 - THE CALLER'S CEILING IS HONOURED, CLAMPED TO OURS.
   *
   * This read `{ ...query, limit: HARD_CAP }`, which overwrote the caller's
   * value unconditionally. `limit` is validated, documented and capped at 2000
   * by report.validator.js, and then never reached a report: an API consumer
   * asking for 100 rows got no error, no warning and five thousand.
   *
   * An advertised filter that does nothing is worse than an absent one,
   * because the caller has no way to find out. The choice was to honour it or
   * to stop advertising it, and honouring it costs one line.
   *
   * `Math.min` and not the caller's value alone: HARD_CAP is not a default the
   * caller may raise, it is the ceiling that stops a filterless run pulling a
   * whole table into a browser. A request for more than it is served the cap,
   * and `truncated` below tells the reader the figures are partial.
   */
  const limit = Math.min(query.limit ?? HARD_CAP, HARD_CAP);
  const result = await report.run({ ...query, limit });
  const rows = result.rows ?? [];

  return {
    key,
    title: report.title,
    description: report.description,
    excelRef: report.excelRef,
    columns: report.columns,
    generatedAt: new Date().toISOString(),
    ...result,
    rows,
    /** Every row the filters matched - what the totals describe. */
    rowCount: rows.length,
    /**
     * F-11: measured against the limit ACTUALLY APPLIED, not against HARD_CAP.
     * A caller who asked for 100 rows and got 100 has a truncated report and
     * has to be told so; comparing against the cap would have called it whole.
     */
    truncated: rows.length >= limit,
    /** What bounded this run, so a caller can see their own limit took effect. */
    limit,
  };
}

/**
 * The WHOLE report, unpaged. What an export is for.
 *
 * Its own function rather than an option on `run()`, because the difference
 * matters too much to hide in a flag: a CSV that silently held one page of a
 * report would be a spreadsheet somebody reconciles against and finds short,
 * with nothing on the file to say why.
 */
export async function runForExport(key, query) {
  return assemble(key, query);
}

/**
 * Cuts an assembled report into one page, and describes the cut.
 *
 * Exported and pure so the arithmetic can be driven directly - see
 * test/dashboard.rules.test.js. Paging arithmetic is where off-by-ones live,
 * and an off-by-one here does not throw: it silently drops a row between two
 * pages, or shows an empty table that reads as "no results".
 *
 * Three behaviours worth stating:
 *
 *   `pageSize` is clamped into [1, MAX_PAGE_SIZE], so a hand-edited URL cannot
 *   ask for the whole table in one response.
 *
 *   `page` is clamped to the last page that exists. Narrowing a filter while
 *   on page seven of the old result would otherwise return nothing at all,
 *   which looks exactly like "your filter matched nothing".
 *
 *   An empty report has `pageCount: 1`, not 0 - it is one empty page, and
 *   "Page 1 of 0" is not a thing to put in front of somebody.
 */
export function pageOf(rows, { page: wantPage, pageSize: wantSize } = {}) {
  const all = rows ?? [];
  const pageSize = Math.min(Math.max(Number(wantSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const pageCount = Math.max(Math.ceil(all.length / pageSize), 1);
  const page = Math.min(Math.max(Number(wantPage) || 1, 1), pageCount);
  const skip = (page - 1) * pageSize;

  return {
    rows: all.slice(skip, skip + pageSize),
    meta: {
      total: all.length,
      page,
      pageSize,
      pageCount,
      hasNext: page < pageCount,
      hasPrev: page > 1,
    },
  };
}

export async function run(key, query) {
  const full = await assemble(key, query);
  const { rows, meta } = pageOf(full.rows, query);

  return {
    ...full,
    /** One page. `rowCount` and `totals` above still cover the whole report. */
    rows,
    meta,
  };
}

// ===========================================================================
//  IMPLEMENTATIONS
// ===========================================================================

async function orderStatus(q) {
  const orders = await prisma.buyerOrder.findMany({
    where: {
      ...LIVE,
      ...(q.buyerId ? { buyerId: q.buyerId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...between('orderDate', q.dateFrom, q.dateTo),
    },
    orderBy: { orderDate: 'desc' },
    take: q.limit,
    include: {
      buyer: { select: { buyerName: true } },
      style: { select: { styleNo: true } },
      plannings: { where: LIVE, select: { plannedQty: true } },
      purchaseOrders: { where: LIVE, select: { amount: true } },
      cuttingIssues: { where: LIVE, select: { cuttingPcsIssued: true } },
    },
  });

  const rows = orders.map((o) => {
    const planned = o.plannings.reduce((a, p) => a.plus(D(p.plannedQty)), ZERO);
    const effective = D(o.effectiveQty);
    return {
      id: o.id,
      route: `/orders/${o.id}`,
      orderNo: o.orderNo,
      orderDate: o.orderDate,
      buyerName: o.buyer?.buyerName ?? null,
      styleNo: o.style?.styleNo ?? null,
      orderQty: D(o.orderQty).toFixed(4),
      excessPctDisplay: `${D(o.excessPct).mul(100).toDecimalPlaces(2)}%`,
      effectiveQty: effective.toFixed(4),
      excessApprovalStatus: o.excessApprovalStatus,
      plannedQty: planned.toFixed(4),
      plannedPctDisplay: effective.isZero()
        ? '—'
        : `${planned.div(effective).mul(100).toDecimalPlaces(1)}%`,
      poCount: String(o.purchaseOrders.length),
      poValue: o.purchaseOrders.reduce((a, p) => a.plus(D(p.amount)), ZERO).toFixed(2),
      cutPcs: o.cuttingIssues.reduce((a, c) => a.plus(D(c.cuttingPcsIssued)), ZERO).toFixed(4),
      deliveryDate: o.buyerDeliveryDate,
      daysToDelivery: o.buyerDeliveryDate
        ? String(-ageDays(o.buyerDeliveryDate))
        : null,
      workflowState: o.workflowState,
      status: o.status,
    };
  });

  return {
    rows,
    totals: {
      orders: rows.length,
      orderQty: rows.reduce((a, r) => a.plus(D(r.orderQty)), ZERO).toFixed(4),
      poValue: rows.reduce((a, r) => a.plus(D(r.poValue)), ZERO).toFixed(2),
      cutPcs: rows.reduce((a, r) => a.plus(D(r.cutPcs)), ZERO).toFixed(4),
    },
  };
}

async function orderBook(q) {
  const orders = await prisma.buyerOrder.findMany({
    where: {
      ...LIVE,
      ...(q.buyerId ? { buyerId: q.buyerId } : {}),
      ...(q.status ? { status: q.status } : { status: { notIn: ['CANCELLED'] } }),
      ...between('orderDate', q.dateFrom, q.dateTo),
    },
    orderBy: [{ exFactoryDate: 'asc' }, { orderDate: 'desc' }],
    take: q.limit,
    include: {
      buyer: { select: { buyerName: true } },
      purchaseOrders: {
        where: { ...LIVE, approvalStatus: { not: 'REJECTED' } },
        select: { amount: true },
      },
    },
  });

  const rows = orders.map((o) => {
    const poValue = o.purchaseOrders.reduce((a, p) => a.plus(D(p.amount)), ZERO);
    const inr = o.orderValueInr == null ? null : D(o.orderValueInr);
    return {
      id: o.id,
      route: `/orders/${o.id}`,
      orderNo: o.orderNo,
      buyerPoNo: o.buyerPoNo,
      buyerName: o.buyer?.buyerName ?? null,
      orderQty: D(o.orderQty).toFixed(4),
      currency: o.currency,
      orderValue: o.orderValue == null ? null : D(o.orderValue).toFixed(2),
      exchangeRate: o.exchangeRate == null ? null : D(o.exchangeRate).toFixed(4),
      orderValueInr: inr ? inr.toFixed(2) : null,
      poValue: poValue.toFixed(2),
      // Purchase orders are in rupees, so this is only meaningful against the
      // rupee value - and says nothing at all while that is unknown.
      materialPctDisplay: inr && !inr.isZero() ? `${poValue.div(inr).mul(100).toDecimalPlaces(1)}%` : '—',
      exFactoryDate: o.exFactoryDate,
      daysToExFactory: o.exFactoryDate ? String(-ageDays(o.exFactoryDate)) : null,
      status: o.status,
    };
  });

  return {
    rows,
    totals: {
      orders: rows.length,
      unpriced: rows.filter((r) => r.orderValue === null).length,
      orderQty: rows.reduce((a, r) => a.plus(D(r.orderQty)), ZERO).toFixed(4),
      orderValueInr: rows.reduce((a, r) => (r.orderValueInr ? a.plus(D(r.orderValueInr)) : a), ZERO).toFixed(2),
      poValue: rows.reduce((a, r) => a.plus(D(r.poValue)), ZERO).toFixed(2),
    },
  };
}

async function planningStatus(q) {
  const plans = await prisma.planning.findMany({
    where: {
      ...LIVE,
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.status ? { approvalStatus: q.status } : {}),
      // `planDate` - the plan preparation date, @db.Date - not `createdAt`.
      // See between() above: pointed at a timestamp this dropped the last day
      // of every range, so a month-end report omitted the month's last day of
      // planning and reconciled against nothing.
      ...between('planDate', q.dateFrom, q.dateTo),
    },
    orderBy: [{ planDate: 'desc' }, { createdAt: 'desc' }],
    take: q.limit,
    include: {
      order: { select: { orderNo: true, orderQty: true, effectiveQty: true } },
      lines: { where: LIVE, select: { id: true } },
    },
  });

  const rows = plans.map((p) => {
    const effective = D(p.order?.effectiveQty ?? 0);
    const planned = D(p.plannedQty);
    return {
      id: p.id,
      route: `/planning/${p.id}`,
      planNo: p.planNo,
      planDate: p.planDate,
      orderNo: p.order?.orderNo ?? null,
      department: p.planDepartment,
      containerNo: p.containerNo,
      orderQty: D(p.order?.orderQty ?? 0).toFixed(4),
      effectiveQty: effective.toFixed(4),
      plannedQty: planned.toFixed(4),
      headroom: effective.minus(planned).toFixed(4),
      plannedCuttingPcs: D(p.plannedCuttingPcs).toFixed(4),
      lineCount: String(p.lines.length),
      submittedTo: p.submittedTo,
      workflowState: p.workflowState,
      approvalStatus: p.approvalStatus,
    };
  });

  return {
    rows,
    totals: {
      plans: rows.length,
      plannedQty: rows.reduce((a, r) => a.plus(D(r.plannedQty)), ZERO).toFixed(4),
      plannedCuttingPcs: rows.reduce((a, r) => a.plus(D(r.plannedCuttingPcs)), ZERO).toFixed(4),
    },
  };
}

async function pendingQuotations(q) {
  const quotations = await prisma.vendorQuotation.findMany({
    where: {
      ...LIVE,
      authorisationStatus: 'PENDING',
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
    },
    orderBy: { quotationDate: 'asc' },
    take: q.limit,
    include: {
      vendor: { select: { vendorName: true } },
      order: { select: { orderNo: true } },
    },
  });

  /**
   * The competing rate for the same thing, so the approver does not need a
   * second screen to see whether this is the cheapest quote on the table.
   *
   * -------------------------------------------------------------------------
   *  ONE QUERY FOR EVERY SIBLING, NOT ONE PER QUOTATION
   *
   *  This used to run a `findMany` inside the row map - a round trip per
   *  pending quotation to find the others quoting the same item. A busy
   *  approval queue is exactly when this report is opened, so the cost grew
   *  precisely when it was least wanted.
   *
   *  Every candidate is fetched once, keyed by item, and matched in memory.
   *  The matching rule is unchanged, including its asymmetry: a quotation
   *  raised against an order is compared only against that order's quotes,
   *  while one with no order is compared against every quote for the item.
   * -------------------------------------------------------------------------
   */
  const candidates = await prisma.vendorQuotation.findMany({
    where: { ...LIVE, item: { in: [...new Set(quotations.map((qt) => qt.item))] } },
    select: { id: true, item: true, orderId: true, rateQuoted: true },
  });

  const byItem = new Map();
  for (const c of candidates) {
    const bucket = byItem.get(c.item);
    if (bucket) bucket.push(c);
    else byItem.set(c.item, [c]);
  }

  const rows = quotations.map((qt) => {
    const siblings = (byItem.get(qt.item) ?? []).filter(
      (c) => c.id !== qt.id && (qt.orderId ? c.orderId === qt.orderId : true),
    );
    const rates = [D(qt.rateQuoted), ...siblings.map((s) => D(s.rateQuoted))];
    const lowest = rates.reduce((a, r) => (r.lessThan(a) ? r : a), rates[0]);

    return {
      id: qt.id,
      route: `/quotations/${qt.id}`,
      quotationNo: qt.quotationNo,
      quotationDate: qt.quotationDate,
      vendorName: qt.vendor?.vendorName ?? null,
      item: [qt.item, qt.subCategory, qt.accessoriesItem].filter(Boolean).join(' / '),
      uom: qt.uom,
      qty: D(qt.qty).toFixed(4),
      rateQuoted: D(qt.rateQuoted).toFixed(4),
      amount: D(qt.amount).toFixed(2),
      orderNo: qt.order?.orderNo ?? null,
      competingCount: String(siblings.length),
      lowestRate: lowest.toFixed(4),
      isLowest: lowest.equals(D(qt.rateQuoted)) ? 'Yes' : 'No',
      waitingDays: String(ageDays(qt.quotationDate)),
    };
  });

  return {
    rows,
    totals: {
      quotations: rows.length,
      amount: rows.reduce((a, r) => a.plus(D(r.amount)), ZERO).toFixed(2),
      notLowest: rows.filter((r) => r.isLowest === 'No').length,
    },
  };
}

async function pendingPoApprovals(q) {
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      ...LIVE,
      approvalStatus: 'PENDING',
      status: { not: 'CANCELLED' },
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
    },
    orderBy: { poDate: 'asc' },
    take: q.limit,
    include: {
      vendor: { select: { vendorName: true } },
      order: { select: { orderNo: true } },
      quotation: { select: { quotationNo: true, rateQuoted: true } },
    },
  });

  // The same completeness rule the approval endpoint enforces, reported here so
  // a buyer can fix everything before opening the PO at all.
  const requirements = [
    ['address', 'delivery address', () => true],
    ['hsnCode', 'HSN code', () => true],
    ['gsm', 'GSM', (po) => po.item === 'Fabric'],
    ['content', 'content', (po) => po.item === 'Fabric'],
    ['colorCode', 'colour', (po) => po.item === 'Fabric'],
    ['subCategory', 'sub-category', (po) => po.item === 'Fabric'],
    ['accessoriesItem', 'accessory item', (po) => po.item === 'Accessories'],
  ];

  const rows = pos.map((po) => {
    const missing = requirements
      .filter(([field, , applies]) => applies(po) && !po[field])
      .map(([, label]) => label);

    return {
      id: po.id,
      route: `/purchase-orders/${po.id}`,
      poId: po.poId,
      poDate: po.poDate,
      vendorName: po.vendor?.vendorName ?? null,
      item: [po.item, po.subCategory, po.accessoriesItem].filter(Boolean).join(' / '),
      orderQty: D(po.orderQty).toFixed(4),
      rate: D(po.rate).toFixed(4),
      amount: D(po.amount).toFixed(2),
      orderNo: po.order?.orderNo ?? null,
      quotationNo: po.quotation?.quotationNo ?? null,
      rateMatchesQuote: !po.quotation
        ? '— no quote'
        : D(po.quotation.rateQuoted).equals(D(po.rate))
          ? 'Yes'
          : 'No',
      readyToApprove: missing.length === 0 ? 'Yes' : 'No',
      missing: missing.join(', ') || '—',
      waitingDays: String(ageDays(po.poDate)),
    };
  });

  return {
    rows,
    totals: {
      purchaseOrders: rows.length,
      amount: rows.reduce((a, r) => a.plus(D(r.amount)), ZERO).toFixed(2),
      incomplete: rows.filter((r) => r.readyToApprove === 'No').length,
      rateMismatches: rows.filter((r) => r.rateMatchesQuote === 'No').length,
    },
  };
}

async function poStatus(q) {
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      ...LIVE,
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...between('poDate', q.dateFrom, q.dateTo),
    },
    orderBy: { poDate: 'desc' },
    take: q.limit,
    include: {
      vendor: { select: { vendorName: true } },
      order: { select: { orderNo: true } },
      grns: { where: LIVE, select: { amount: true, toleranceBreached: true } },
    },
  });

  const rows = pos.map((po) => {
    const ordered = D(po.orderQty);
    const received = D(po.receivedQty);
    const pending = ordered.minus(received);
    return {
      id: po.id,
      route: `/purchase-orders/${po.id}`,
      poId: po.poId,
      poDate: po.poDate,
      vendorName: po.vendor?.vendorName ?? null,
      item: [po.item, po.subCategory, po.accessoriesItem].filter(Boolean).join(' / '),
      uom: po.uom,
      orderQty: ordered.toFixed(4),
      receivedQty: received.toFixed(4),
      pendingQty: (pending.isNegative() ? ZERO : pending).toFixed(4),
      receivedPctDisplay: ordered.isZero()
        ? '—'
        : `${received.div(ordered).mul(100).toDecimalPlaces(1)}%`,
      amount: D(po.amount).toFixed(2),
      receivedValue: po.grns.reduce((a, g) => a.plus(D(g.amount)), ZERO).toFixed(2),
      grnCount: String(po.grns.length),
      breaches: String(po.grns.filter((g) => g.toleranceBreached).length),
      orderNo: po.order?.orderNo ?? null,
      workflowState: po.workflowState,
      status: po.status,
    };
  });

  return {
    rows,
    totals: {
      purchaseOrders: rows.length,
      poValue: rows.reduce((a, r) => a.plus(D(r.amount)), ZERO).toFixed(2),
      receivedValue: rows.reduce((a, r) => a.plus(D(r.receivedValue)), ZERO).toFixed(2),
      pendingQty: rows.reduce((a, r) => a.plus(D(r.pendingQty)), ZERO).toFixed(4),
      breaches: rows.reduce((a, r) => a + Number(r.breaches), 0),
    },
  };
}

async function pendingGrns(q) {
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      ...LIVE,
      approvalStatus: 'APPROVED',
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
    },
    orderBy: { poDate: 'asc' },
    take: q.limit,
    include: {
      vendor: { select: { vendorName: true } },
      order: { select: { orderNo: true } },
      grns: { where: LIVE, orderBy: { grnDate: 'desc' }, take: 1, select: { grnDate: true } },
      gatePasses: {
        where: { ...LIVE, type: 'INWARD' },
        select: { id: true, grns: { where: LIVE, select: { id: true } } },
      },
    },
  });

  const rows = pos
    .map((po) => {
      const ordered = D(po.orderQty);
      const received = D(po.receivedQty);
      const pending = ordered.minus(received);
      return {
        id: po.id,
        route: `/purchase-orders/${po.id}`,
        poId: po.poId,
        poDate: po.poDate,
        vendorName: po.vendor?.vendorName ?? null,
        item: [po.item, po.subCategory, po.accessoriesItem].filter(Boolean).join(' / '),
        uom: po.uom,
        orderQty: ordered.toFixed(4),
        receivedQty: received.toFixed(4),
        pendingQty: pending.toFixed(4),
        // Goods physically at the gate that nobody has receipted yet — the most
        // actionable line on this report.
        gatePassesWaiting: String(po.gatePasses.filter((g) => g.grns.length === 0).length),
        lastGrnDate: po.grns[0]?.grnDate ?? null,
        ageDays: String(ageDays(po.poDate)),
        orderNo: po.order?.orderNo ?? null,
      };
    })
    .filter((r) => Number(r.pendingQty) > 0);

  return {
    rows,
    totals: {
      purchaseOrders: rows.length,
      pendingQty: rows.reduce((a, r) => a.plus(D(r.pendingQty)), ZERO).toFixed(4),
      atTheGate: rows.reduce((a, r) => a + Number(r.gatePassesWaiting), 0),
    },
  };
}

async function inventoryReport(q) {
  const balances = await prisma.stockBalance.findMany({
    where: {
      ...(q.location ? { location: q.location } : {}),
      item: { ...LIVE, ...(q.itemCategory ? { itemCategory: q.itemCategory } : {}) },
    },
    orderBy: [{ item: { itemCode: 'asc' } }, { location: 'asc' }],
    take: q.limit,
    include: { item: true },
  });

  /**
   * The ledger position beside the cached balance. If the two ever disagree,
   * the ledger is right - and this report is where that shows up.
   *
   * -------------------------------------------------------------------------
   *  ONE GROUPED QUERY, NOT ONE PER ROW
   *
   *  This used to run `stockLedger.aggregate()` inside the row map - one round
   *  trip per item-and-location, awaited in a `Promise.all` that hid the count
   *  behind a single line. Eight stock lines meant nine queries and 1.4
   *  seconds; a store with a thousand item-locations would have meant a
   *  thousand and one, and the report would simply have stopped returning.
   *
   *  `groupBy` asks the same question once. The `in` filter keeps it to the
   *  items this report actually selected rather than the whole ledger, so a
   *  filtered report does not pay for the rows it filtered out.
   * -------------------------------------------------------------------------
   */
  const ledgerTotals = await prisma.stockLedger.groupBy({
    by: ['itemId', 'location'],
    where: {
      itemId: { in: [...new Set(balances.map((b) => b.itemId))] },
      location: { in: [...new Set(balances.map((b) => b.location))] },
    },
    _sum: { qtyIn: true, qtyOut: true },
  });

  const ledgerBy = new Map(
    ledgerTotals.map((g) => [`${g.itemId}::${g.location}`, g._sum]),
  );

  const rows = balances.map((b) => {
    // A balance with no movements at all is absent from the grouping, which is
    // zero in and zero out - not a missing row to skip.
    const sums = ledgerBy.get(`${b.itemId}::${b.location}`);
    const qtyIn = D(sums?.qtyIn ?? 0);
    const qtyOut = D(sums?.qtyOut ?? 0);
    const fromLedger = qtyIn.minus(qtyOut);
    const cached = D(b.qty);
    const reorder = D(b.item.reorderLevel);

    return {
      id: b.itemId,
      route: `/inventory/stock/ledger?itemId=${b.itemId}`,
      itemCode: b.item.itemCode,
      description: b.item.description,
      itemCategory: b.item.itemCategory,
      location: b.location,
      uom: b.item.uom,
      qtyIn: qtyIn.toFixed(4),
      qtyOut: qtyOut.toFixed(4),
      onHand: fromLedger.toFixed(4),
      avgRate: D(b.avgRate).toFixed(4),
      value: D(b.value).toFixed(2),
      reorderLevel: reorder.toFixed(4),
      /**
       * Measured against the LEDGER position, not the cached balance - the
       * whole point of this report is that the ledger is the truth. The rule
       * itself is the inventory service's, so this is not a fourth place that
       * decides what "below reorder" means.
       */
      belowReorder: isBelowReorder(fromLedger, reorder) ? 'Yes' : 'No',
      agrees: cached.equals(fromLedger) ? 'Yes' : 'NO — run reconcile',
    };
  });

  return {
    rows,
    totals: {
      lines: rows.length,
      value: rows.reduce((a, r) => a.plus(D(r.value)), ZERO).toFixed(2),
      belowReorder: rows.filter((r) => r.belowReorder === 'Yes').length,
      disagreements: rows.filter((r) => r.agrees !== 'Yes').length,
    },
  };
}

async function rollWiseStock(q) {
  const rolls = await prisma.fabricRoll.findMany({
    where: {
      ...LIVE,
      ...(q.stage ? { stage: q.stage } : {}),
      ...(q.location ? { location: q.location } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.colorCode ? { colorCode: q.colorCode } : {}),
    },
    orderBy: { rollNo: 'asc' },
    take: q.limit,
    include: {
      vendor: { select: { vendorName: true } },
      grn: {
        select: {
          grnNo: true,
          purchaseOrder: { select: { poId: true, order: { select: { orderNo: true } } } },
        },
      },
    },
  });

  const rows = rolls.map((r) => {
    const received = D(r.receivedQty);
    const balance = D(r.balanceQty);
    const consumed = received.minus(balance);
    return {
      id: r.id,
      route: `/inventory/rolls/${r.id}`,
      rollNo: r.rollNo,
      fabricName: r.fabricName,
      colorCode: r.colorCode,
      gsm: r.gsm,
      count: r.count,
      uom: r.uom,
      receivedQty: received.toFixed(4),
      balanceQty: balance.toFixed(4),
      consumedQty: consumed.toFixed(4),
      consumedPctDisplay: received.isZero()
        ? '—'
        : `${consumed.div(received).mul(100).toDecimalPlaces(1)}%`,
      stage: r.stage,
      location: r.location,
      held: r.isHeld ? 'Yes' : 'No',
      grnNo: r.grn?.grnNo ?? null,
      vendorName: r.vendor?.vendorName ?? null,
      poId: r.grn?.purchaseOrder?.poId ?? null,
      orderNo: r.grn?.purchaseOrder?.order?.orderNo ?? null,
    };
  });

  return {
    rows,
    totals: {
      rolls: rows.length,
      receivedQty: rows.reduce((a, r) => a.plus(D(r.receivedQty)), ZERO).toFixed(4),
      balanceQty: rows.reduce((a, r) => a.plus(D(r.balanceQty)), ZERO).toFixed(4),
      held: rows.filter((r) => r.held === 'Yes').length,
    },
  };
}

async function fabricIssued(q) {
  const issues = await prisma.fabricIssue.findMany({
    where: {
      ...LIVE,
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.purpose ? { purpose: q.purpose } : {}),
      ...between('issueDate', q.dateFrom, q.dateTo),
    },
    orderBy: { issueDate: 'desc' },
    take: q.limit,
    include: {
      roll: { select: { rollNo: true } },
      order: { select: { orderNo: true } },
      style: { select: { styleNo: true } },
      vendor: { select: { vendorName: true } },
    },
  });

  const rows = issues.map((f) => ({
    id: f.id,
    route: `/fabric-issues/${f.id}`,
    issueNo: f.issueNo,
    issueDate: f.issueDate,
    rollNo: f.roll?.rollNo ?? null,
    fabricName: f.fabricName,
    colorCode: f.colorCode,
    purpose: f.purpose,
    qtyIssued: D(f.fabricQtyIssued).toFixed(4),
    uom: f.uom,
    orderNo: f.order?.orderNo ?? null,
    styleNo: f.style?.styleNo ?? null,
    issuedByName: f.issuedByName,
    destination: f.vendor?.vendorName ?? f.location,
    posted: f.postedAt ? 'Yes' : 'No',
  }));

  return {
    rows,
    totals: {
      issues: rows.length,
      qtyIssued: rows.reduce((a, r) => a.plus(D(r.qtyIssued)), ZERO).toFixed(4),
      notPosted: rows.filter((r) => r.posted === 'No').length,
    },
  };
}

/** Shared by the dyeing and printing reports; they differ only in `processes`. */
async function jobWorkStatus(q, processes) {
  const jobs = await prisma.dyeIssue.findMany({
    where: {
      ...LIVE,
      process: { in: processes },
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...between('issueDate', q.dateFrom, q.dateTo),
    },
    orderBy: { issueDate: 'desc' },
    take: q.limit,
    include: {
      vendor: { select: { vendorName: true } },
      roll: { select: { rollNo: true } },
      order: { select: { orderNo: true } },
    },
  });

  const rows = jobs.map((j) => {
    const sent = D(j.qty);
    const back = D(j.receivedQty);
    const shrinkage = D(j.shrinkagePct);
    const allowed = D(j.standardShrinkageAllowed);
    const pending = sent.minus(back);
    return {
      id: j.id,
      route: `/job-works/${j.id}`,
      jobNo: j.dyeIssueNo,
      issueDate: j.issueDate,
      process: j.process,
      fabricStage: j.fabricStage,
      vendorName: j.vendor?.vendorName ?? null,
      rollNo: j.roll?.rollNo ?? null,
      colourCode: j.colourCode,
      qty: sent.toFixed(4),
      receivedQty: back.toFixed(4),
      pendingQty: (pending.isNegative() ? ZERO : pending).toFixed(4),
      shrinkagePctDisplay: `${shrinkage.mul(100).toDecimalPlaces(2)}%`,
      allowedPctDisplay: `${allowed.mul(100).toDecimalPlaces(2)}%`,
      breached: !back.isZero() && shrinkage.greaterThan(allowed) ? 'Yes' : 'No',
      rate: D(j.rate).toFixed(4),
      amount: D(j.amount).toFixed(2),
      orderNo: j.order?.orderNo ?? null,
      daysOut: j.status === 'COMPLETED' ? '—' : String(ageDays(j.issueDate)),
      status: j.status,
    };
  });

  return {
    rows,
    totals: {
      jobs: rows.length,
      sent: rows.reduce((a, r) => a.plus(D(r.qty)), ZERO).toFixed(4),
      returned: rows.reduce((a, r) => a.plus(D(r.receivedQty)), ZERO).toFixed(4),
      stillOut: rows.reduce((a, r) => a.plus(D(r.pendingQty)), ZERO).toFixed(4),
      amount: rows.reduce((a, r) => a.plus(D(r.amount)), ZERO).toFixed(2),
      overAllowance: rows.filter((r) => r.breached === 'Yes').length,
    },
  };
}

/**
 * Printing has two registers in the workbook: job-work lots routed through the
 * Dye issue sheet, and the separate Printing sheet for after-stitching work.
 * Both are reported, because the office reconciles against both.
 */
async function printingStatus(q) {
  const jobWork = await jobWorkStatus(q, ['PRINTING', 'FINISHING']);

  const printings = await prisma.printing.findMany({
    where: {
      ...LIVE,
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...between('printingDate', q.dateFrom, q.dateTo),
    },
    orderBy: { printingDate: 'desc' },
    take: q.limit,
    include: {
      vendor: { select: { vendorName: true } },
      order: { select: { orderNo: true } },
    },
  });

  const printingRows = printings.map((p) => ({
    id: p.id,
    route: null,
    jobNo: p.printingNo,
    issueDate: p.printingDate,
    process: 'PRINTING',
    fabricStage: p.fabricStage,
    vendorName: p.vendor?.vendorName ?? null,
    rollNo: '—',
    qty: D(p.qty).toFixed(4),
    receivedQty: '—',
    pendingQty: '—',
    shrinkagePctDisplay: '—',
    allowedPctDisplay: '—',
    breached: 'No',
    amount: '—',
    orderNo: p.order?.orderNo ?? null,
    daysOut: p.status === 'COMPLETED' ? '—' : String(ageDays(p.printingDate)),
    status: p.status,
  }));

  return {
    rows: [...jobWork.rows, ...printingRows],
    totals: {
      ...jobWork.totals,
      printingRegisterRows: printingRows.length,
    },
    note:
      'Two registers: job-work lots sent out under the Dye issue sheet, and the separate ' +
      'Printing sheet the workbook keeps for after-stitching work. The Printing sheet records ' +
      'no return quantity, so its rows show no loss.',
  };
}

async function scrutinyStatus(q) {
  const rows0 = await prisma.fabricScrutiny.findMany({
    where: {
      ...LIVE,
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.decision ? { decision: q.decision } : {}),
      ...between('scrutinyDate', q.dateFrom, q.dateTo),
    },
    // Unfinalised first: those are the ones somebody has to act on.
    orderBy: [{ isLocked: 'asc' }, { scrutinyDate: 'desc' }],
    take: q.limit,
    include: {
      roll: { select: { rollNo: true, receivedQty: true, isHeld: true } },
      order: { select: { orderNo: true } },
      style: { select: { styleNo: true } },
    },
  });

  const rows = rows0.map((s) => {
    const affected = D(s.qtyAffected);
    const rollQty = D(s.roll?.receivedQty ?? 0);
    return {
      id: s.id,
      route: `/scrutinies/${s.id}`,
      scrutinyNo: s.scrutinyNo,
      scrutinyDate: s.scrutinyDate,
      rollNo: s.roll?.rollNo ?? null,
      defectType: s.defectType,
      qtyAffected: affected.toFixed(4),
      uom: s.uom,
      affectedPctDisplay: rollQty.isZero()
        ? '—'
        : `${affected.div(rollQty).mul(100).toDecimalPlaces(1)}%`,
      orderNo: s.order?.orderNo ?? null,
      styleNo: s.style?.styleNo ?? null,
      checkedByName: s.checkedByName,
      decision: s.decision,
      finalised: s.isLocked ? 'Yes' : 'No',
      decidedByName: s.decidedByName,
      amendmentCount: String(s.amendmentCount),
      rollHeld: s.roll?.isHeld ? 'Yes' : 'No',
      waitingDays: s.isLocked ? '—' : String(ageDays(s.scrutinyDate)),
    };
  });

  return {
    rows,
    totals: {
      scrutinies: rows.length,
      qtyAffected: rows.reduce((a, r) => a.plus(D(r.qtyAffected)), ZERO).toFixed(4),
      awaitingDecision: rows.filter((r) => r.finalised === 'No').length,
      rollsHeld: rows.filter((r) => r.rollHeld === 'Yes').length,
    },
  };
}

async function planApprovalStatus(q) {
  const approvals = await prisma.planApproval.findMany({
    where: {
      ...LIVE,
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.approvalStatus ? { approvalStatus: q.approvalStatus } : {}),
      ...between('submittedDate', q.dateFrom, q.dateTo),
    },
    orderBy: [{ submittedDate: 'desc' }, { round: 'desc' }],
    take: q.limit,
    include: {
      order: { select: { orderNo: true } },
      planning: { select: { planNo: true } },
      supersedes: { select: { approvalNo: true, round: true } },
      cuttingIssues: { where: LIVE, select: { id: true } },
    },
  });

  const rows = approvals.map((a) => ({
    id: a.id,
    route: `/plan-approvals/${a.id}`,
    approvalNo: a.approvalNo,
    version: String(a.round),
    submittedDate: a.submittedDate,
    orderNo: a.order?.orderNo ?? null,
    containerNo: a.containerNo,
    planNo: a.planning?.planNo ?? null,
    preparedBy: a.preparedBy,
    submittedTo: a.submittedTo,
    supersedes: a.supersedes ? `${a.supersedes.approvalNo} (v${a.supersedes.round})` : '—',
    rejectionReason: a.rejectionReason ?? '—',
    rectificationRemarks: a.rectificationRemarks ?? '—',
    awaitingRectification:
      a.approvalStatus === 'REJECTED' && !a.rectifiedAt ? 'Yes' : 'No',
    approvedDate: a.approvedDate,
    cuttingIssues: String(a.cuttingIssues.length),
    workflowState: a.workflowState,
    waitingDays: a.approvalStatus === 'PENDING' ? String(ageDays(a.submittedDate)) : '—',
  }));

  return {
    rows,
    totals: {
      versions: rows.length,
      pending: rows.filter((r) => r.workflowState === 'PENDING_APPROVAL').length,
      awaitingRectification: rows.filter((r) => r.awaitingRectification === 'Yes').length,
    },
  };
}

async function cuttingIssueStatus(q) {
  const challans = await prisma.cuttingIssue.findMany({
    where: {
      ...LIVE,
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.firmName ? { firmName: q.firmName } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...between('issueDate', q.dateFrom, q.dateTo),
    },
    orderBy: { issueDate: 'desc' },
    take: q.limit,
    include: {
      order: { select: { orderNo: true } },
      style: { select: { styleNo: true } },
      planApproval: { select: { approvalNo: true, round: true } },
      excessApproval: { select: { overLimitQty: true, approvedByName: true } },
    },
  });

  const rows = challans.map((c) => {
    // Cutting is not tracked by unit any more, so the variance is against the
    // plan, falling back to a unit allotment only where an old challan has one.
    const allotted = D(c.unitWiseCuttingPcsToBeIssued).greaterThan(0)
      ? D(c.unitWiseCuttingPcsToBeIssued)
      : D(c.plannedCutting);
    const issued = D(c.cuttingPcsIssued);
    return {
      id: c.id,
      route: `/cutting-issues/${c.id}`,
      challanNo: c.challanNo,
      issueDate: c.issueDate,
      orderNo: c.order?.orderNo ?? null,
      styleNo: c.style?.styleNo ?? null,
      firmName: c.firmName,
      containerNo: c.containerNo,
      plannedCutting: D(c.plannedCutting).toFixed(4),
      unitWisePcs: allotted.toFixed(4),
      cuttingPcsIssued: issued.toFixed(4),
      varianceQty: issued.minus(allotted).toFixed(4),
      handleIssued: D(c.handleIssued).toFixed(4),
      approvalNo: c.planApproval?.approvalNo ?? null,
      approvalVersion: c.planApproval ? String(c.planApproval.round) : null,
      excessAuthorised: c.excessApproval
        ? `${D(c.excessApproval.overLimitQty).toFixed(0)} by ${c.excessApproval.approvedByName}`
        : '—',
      posted: c.postedAt ? 'Yes' : 'No',
      workflowState: c.workflowState,
    };
  });

  return {
    rows,
    totals: {
      challans: rows.length,
      cuttingPcsIssued: rows.reduce((a, r) => a.plus(D(r.cuttingPcsIssued)), ZERO).toFixed(4),
      handleIssued: rows.reduce((a, r) => a.plus(D(r.handleIssued)), ZERO).toFixed(4),
      drafts: rows.filter((r) => r.posted === 'No').length,
      withAuthorisedExcess: rows.filter((r) => r.excessAuthorised !== '—').length,
    },
  };
}

// ===========================================================================
//  CSV
// ===========================================================================

/**
 * Renders a finished report as CSV.
 *
 * Done on the server so the exported file and the screen carry the same
 * figures — a client-side exporter would be a second place a number could be
 * formatted, and a spreadsheet is exactly where a discrepancy would be
 * discovered months later.
 */
export function toCsv(report) {
  // The escaping itself lives in utils/csv.js, which is also what the master
  // IMPORT reads with. One writer and one reader that agree is what lets an
  // exported file be edited and sent back - see the note at the head of that
  // file.
  return writeCsv(report.columns, report.rows);
}
