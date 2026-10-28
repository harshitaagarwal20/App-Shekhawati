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
import { D } from '../utils/figures.js';
import { toCsv as writeCsv } from '../utils/csv.js';
import { EXTRA_REPORTS } from './reports.extra.js';
import { INVENTORY_ANALYSIS_REPORTS } from './reports.inventory.js';
import { PRODUCTION_REPORTS } from './reports.production.js';
import { FINISHING_REPORTS } from './reports.finishing.js';
import { VENDOR_REPORTS } from './reports.vendor.js';

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

  // -------------------------------------------------------------------------
  //  STORE
  // -------------------------------------------------------------------------


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
      col('colorCode', 'Color'),
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


  // -------------------------------------------------------------------------
  //  CUTTING
  // -------------------------------------------------------------------------


  // Cutting efficiency, stock valuation, ITC-04, TNA - see reports.extra.js.
  ...EXTRA_REPORTS,

  // Supplier-wise stock, supplier yield, inward inspection - see reports.inventory.js.
  ...INVENTORY_ANALYSIS_REPORTS,

  // Ironing: daily output by ironer and order, and the balance waiting.
  ...PRODUCTION_REPORTS,

  // Phase 4: External QC by order / agency / reason, the Checker Report, the
  // Alteration Unit's pending and summary, and the net pipeline.
  ...FINISHING_REPORTS,

  // Vendor performance: job workers' shrinkage and punctuality, suppliers'
  // delivery against the PO date, and defect reasons across every QC stage.
  ...VENDOR_REPORTS,
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
