/**
 * Vendor performance - the questions asked of the people the company pays.
 *
 *   jobworker-performance   per job worker (dyer, printer, washer) and process:
 *                           how much cloth they lost against what they were
 *                           allowed, how often a lot went over, what scrutiny
 *                           then found, and whether lots came back on time.
 *   supplier-delivery       per supplier: purchase order lines that fell due,
 *                           and how many were received in full by the
 *                           delivery date on the PO.
 *   defect-reasons          every defect the floor recorded, stage by stage
 *                           and reason by reason.
 *
 * Wastage at the cutting table, by the mill that wove the cloth, is the
 * existing `supplier-yield` report (reports.inventory.js), which carries a
 * chart for the same screen.
 *
 * ---------------------------------------------------------------------------
 *  CHARTS ARE WHOLE, ROWS ARE PAGED
 *
 *  Each report returns `charts` beside its rows: the bars the Vendor
 *  Performance screen draws, ranked and worked out here. report.service.js
 *  pages the rows AFTER a report runs, so a chart built from the rows on the
 *  screen would show the fifty on this page; built here it covers everything
 *  the filters matched.
 *
 *  A bar is `{ label, value, display, marker?, sub?, tone? }`. `value` and
 *  `marker` are plain numbers as strings, for placing on the scale; `display`
 *  is the figure as the reader sees it. The browser only scales.
 * ---------------------------------------------------------------------------
 */

import prisma, { notDeleted } from '../config/prisma.js';
import { D } from '../utils/figures.js';
import { istIsoDate } from '../utils/dates.js';
import { QC_BOXES, QC_REASONS } from '../domain/finishing.js';

const ZERO = D(0);
const MS_PER_DAY = 86400000;
const col = (key, label, format = 'text') => ({ key, label, format });
const q4 = (v) => D(v).toFixed(4);

/** Most bars one chart draws. Past this a bar chart is a table drawn badly. */
const TOP = 15;

function between(field, from, to) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } };
}

/** part / whole as a percentage Decimal, or null when there is nothing to divide by. */
const ratio = (part, whole) => (D(whole).greaterThan(0) ? D(part).div(D(whole)).mul(100) : null);
const pctText = (r) => (r == null ? null : `${r.toDecimalPlaces(1).toFixed(1)}%`);
const pctValue = (r) => (r == null ? null : r.toDecimalPlaces(1).toFixed(1));

/** Today in the factory, as a date column holds it: midnight UTC of the IST day. */
const today = () => new Date(istIsoDate());

/** Whole days from one date column value to another. */
const daysBetween = (from, to) => Math.round((new Date(to) - new Date(from)) / MS_PER_DAY);

const minDate = (a, b) => (!a || (b && b < a) ? b : a);
const maxDate = (a, b) => (!a || (b && b > a) ? b : a);

/**
 * The on-time arithmetic both delivery measures share.
 *
 * A thing is ON TIME when it finished on or before its due date, LATE when it
 * finished after, and OVERDUE when it has not finished and the date has
 * passed. Overdue counts against the on-time rate - a lot that never comes back
 * must not score better than one that came back a day late. Not yet due and
 * not yet done is left out: it has not had its chance.
 */
function newPunctuality() {
  return { due: 0, onTime: 0, late: 0, overdue: 0, notYetDue: 0, daysLate: 0, worstDaysLate: 0 };
}

function judge(p, due, doneOn, now) {
  if (!due) return;
  if (doneOn) {
    p.due += 1;
    const late = daysBetween(due, doneOn);
    if (late <= 0) p.onTime += 1;
    else {
      p.late += 1;
      p.daysLate += late;
      p.worstDaysLate = Math.max(p.worstDaysLate, late);
    }
  } else if (now > due) {
    p.due += 1;
    p.overdue += 1;
    const late = daysBetween(due, now);
    p.daysLate += late;
    p.worstDaysLate = Math.max(p.worstDaysLate, late);
  } else {
    p.notYetDue += 1;
  }
}

function punctualityFigures(p) {
  const missed = p.late + p.overdue;
  const onTimeRatio = p.due ? D(p.onTime).div(p.due).mul(100) : null;
  return {
    dueCount: p.due,
    onTimeCount: p.onTime,
    lateCount: p.late,
    overdueCount: p.overdue,
    notYetDueCount: p.notYetDue,
    onTimeRatio,
    onTimePct: pctText(onTimeRatio),
    avgDaysLate: missed ? D(p.daysLate).div(missed).toDecimalPlaces(1).toFixed(1) : null,
    worstDaysLate: missed ? p.worstDaysLate : null,
  };
}

/** The on-time chart both delivery reports draw: worst first. */
function onTimeChart(rows, { title, note, unitWord }) {
  return {
    key: 'on-time',
    title,
    note,
    unit: '%',
    max: '100',
    bars: rows
      .filter((r) => r.onTimeRatio != null)
      .sort((a, b) => a.onTimeRatio.comparedTo(b.onTimeRatio) || b.dueCount - a.dueCount)
      .slice(0, TOP)
      .map((r) => ({
        label: r.chartLabel,
        value: pctValue(r.onTimeRatio),
        display: r.onTimePct,
        sub:
          `${r.onTimeCount} of ${r.dueCount} ${unitWord} on time` +
          (r.avgDaysLate ? ` · ${r.avgDaysLate} days late on average` : ''),
      })),
  };
}

// ===========================================================================
//  JOB WORKERS - shrinkage, scrutiny and punctuality
// ===========================================================================

/**
 * WHAT A JOB'S SHRINKAGE IS, AND WHEN IT COUNTS.
 *
 * Shrinkage is measured on COMPLETED jobs only. A lot still at the dyer has
 * "lost" everything not yet back, and counting it would make whoever was
 * given the most work this week look the worst.
 *
 * It is taken from the job's own running totals, not by adding up its
 * receipts: every receipt on a roll repeats that roll's whole issued quantity,
 * so a roll returned in two halves would be counted as issued twice.
 *
 * A legacy lot (from before fabric moved on the job's own challan) has no
 * `issuedQty`; what it was raised for is what went out.
 */
const sentOf = (job) => (D(job.issuedQty).greaterThan(0) ? D(job.issuedQty) : D(job.qty));

async function jobworkerPerformance(q) {
  const jobs = await prisma.dyeIssue.findMany({
    where: {
      ...notDeleted,
      workflowState: {
        notIn: ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'RECTIFICATION', 'RESUBMITTED', 'REJECTED', 'CANCELLED'],
      },
      status: { not: 'CANCELLED' },
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.process ? { process: q.process } : {}),
      ...between('issueDate', q.dateFrom, q.dateTo),
    },
    select: {
      id: true,
      process: true,
      vendorId: true,
      vendor: { select: { vendorName: true } },
      issueDate: true,
      deliveryDate: true,
      qty: true,
      issuedQty: true,
      receivedQty: true,
      shrinkageTolerancePct: true,
      status: true,
      workflowState: true,
      uom: true,
      receipts: {
        where: notDeleted,
        select: { receiptDate: true, variationFlag: true, scrutinyId: true },
      },
    },
  });

  // What scrutiny found on the lots these jobs sent back. A receipt over its
  // allowance is held and sent to scrutiny; the scrutiny names the defects.
  const scrutinyIds = [...new Set(jobs.flatMap((j) => j.receipts.map((r) => r.scrutinyId)).filter(Boolean))];
  const scrutinies = scrutinyIds.length
    ? await prisma.fabricScrutiny.findMany({
        where: { id: { in: scrutinyIds }, ...notDeleted },
        select: {
          id: true,
          decision: true,
          isLocked: true,
          defects: { where: { ...notDeleted, category: 'DYEING' }, select: { qty: true } },
        },
      })
    : [];
  const scrutinyById = new Map(scrutinies.map((s) => [s.id, s]));

  const now = today();
  const groups = new Map();
  for (const j of jobs) {
    const key = `${j.vendorId}|${j.process}`;
    if (!groups.has(key)) {
      groups.set(key, {
        vendorId: j.vendorId,
        vendorName: j.vendor?.vendorName ?? '-',
        process: j.process,
        firstIssued: null,
        lastIssued: null,
        jobs: 0,
        completed: 0,
        sent: ZERO,
        returned: ZERO,
        stillOut: ZERO,
        doneSent: ZERO,
        doneReturned: ZERO,
        allowedWeighted: ZERO,
        overAllowance: 0,
        returnsHeld: 0,
        scrutinies: new Set(),
        uoms: new Set(),
        punctuality: newPunctuality(),
      });
    }
    const g = groups.get(key);
    const sent = sentOf(j);
    const back = D(j.receivedQty);
    const done = j.status === 'COMPLETED' || j.workflowState === 'COMPLETED';

    g.jobs += 1;
    g.firstIssued = minDate(g.firstIssued, j.issueDate);
    g.lastIssued = maxDate(g.lastIssued, j.issueDate);
    g.sent = g.sent.plus(sent);
    g.returned = g.returned.plus(back);
    if (!done && sent.greaterThan(back)) g.stillOut = g.stillOut.plus(sent.minus(back));
    if (j.uom) g.uoms.add(j.uom);

    if (done && sent.greaterThan(0)) {
      g.completed += 1;
      g.doneSent = g.doneSent.plus(sent);
      g.doneReturned = g.doneReturned.plus(back);
      g.allowedWeighted = g.allowedWeighted.plus(sent.mul(D(j.shrinkageTolerancePct)));
      const lost = sent.minus(back).div(sent);
      if (lost.greaterThan(D(j.shrinkageTolerancePct))) g.overAllowance += 1;
    }

    for (const r of j.receipts) {
      if (r.variationFlag) g.returnsHeld += 1;
      if (r.scrutinyId) g.scrutinies.add(r.scrutinyId);
    }

    // A completed lot is judged on the day its last return came in. One closed
    // with no receipt on record (a legacy lot) has no such day and is left out.
    const lastBack = j.receipts.reduce((a, r) => maxDate(a, r.receiptDate), null);
    if (!done || lastBack) judge(g.punctuality, j.deliveryDate, done ? lastBack : null, now);
  }

  const computed = [...groups.values()].map((g) => {
    const shrinkage = ratio(g.doneSent.minus(g.doneReturned), g.doneSent);
    const allowed = g.doneSent.greaterThan(0) ? g.allowedWeighted.div(g.doneSent).mul(100) : null;
    let dyeingDefects = ZERO;
    let rejectedAtScrutiny = 0;
    for (const id of g.scrutinies) {
      const s = scrutinyById.get(id);
      if (!s) continue;
      dyeingDefects = s.defects.reduce((a, d) => a.plus(D(d.qty)), dyeingDefects);
      if (s.isLocked && s.decision === 'REJECT') rejectedAtScrutiny += 1;
    }
    const p = punctualityFigures(g.punctuality);
    return {
      g,
      shrinkage,
      allowed,
      excess: shrinkage != null && allowed != null ? shrinkage.minus(allowed) : null,
      dyeingDefects,
      rejectedAtScrutiny,
      p,
    };
  });

  // Process by process, and within a process the worst first: the furthest
  // over its allowance. "Which dyer should we stop using" is asked of dyers.
  computed.sort(
    (a, b) =>
      a.g.process.localeCompare(b.g.process) ||
      (a.excess == null) - (b.excess == null) ||
      (a.excess && b.excess ? b.excess.comparedTo(a.excess) : 0) ||
      a.g.vendorName.localeCompare(b.g.vendorName),
  );

  const label = (g) => `${g.vendorName} · ${g.process.charAt(0)}${g.process.slice(1).toLowerCase()}`;

  const rows = computed
    .map(({ g, shrinkage, allowed, dyeingDefects, rejectedAtScrutiny, p }) => ({
      id: `${g.vendorId}|${g.process}`,
      route: `/job-works?process=${g.process}`,
      vendorName: g.vendorName,
      process: g.process,
      firstIssued: g.firstIssued,
      lastIssued: g.lastIssued,
      jobs: String(g.jobs),
      completedJobs: String(g.completed),
      sentQty: q4(g.sent),
      returnedQty: q4(g.returned),
      stillOutQty: q4(g.stillOut),
      shrinkagePct: pctText(shrinkage),
      allowedPct: pctText(allowed),
      overAllowance: String(g.overAllowance),
      returnsHeld: String(g.returnsHeld),
      dyeingDefectQty: q4(dyeingDefects),
      rejectedAtScrutiny: String(rejectedAtScrutiny),
      dueJobs: String(p.dueCount),
      onTimeJobs: String(p.onTimeCount),
      lateJobs: String(p.lateCount),
      overdueJobs: String(p.overdueCount),
      onTimePct: p.onTimePct,
      avgDaysLate: p.avgDaysLate,
      uom: [...g.uoms].sort().join(' + '),
    }))
    .slice(0, q.limit);

  const shrinkageChart = {
    key: 'shrinkage',
    title: 'Shrinkage against the allowance',
    note: 'Completed jobs only. The tick on each bar is what that job worker was allowed.',
    unit: '%',
    markerLabel: 'Allowed',
    bars: computed
      .filter((c) => c.shrinkage != null)
      .sort((a, b) => b.excess.comparedTo(a.excess) || b.shrinkage.comparedTo(a.shrinkage))
      .slice(0, TOP)
      .map((c) => ({
        label: label(c.g),
        value: pctValue(c.shrinkage),
        display: pctText(c.shrinkage),
        marker: pctValue(c.allowed),
        tone: c.excess.greaterThan(0) ? 'bad' : '',
        sub:
          `${c.g.completed} completed job${c.g.completed === 1 ? '' : 's'}, ` +
          `${c.g.overAllowance} over · allowed ${pctText(c.allowed)}`,
      })),
  };

  // Totals across every job worker shown - ratios of sums, so a big dyer
  // weighs more than a small one.
  const doneSent = computed.reduce((a, c) => a.plus(c.g.doneSent), ZERO);
  const doneReturned = computed.reduce((a, c) => a.plus(c.g.doneReturned), ZERO);
  const allowedWeighted = computed.reduce((a, c) => a.plus(c.g.allowedWeighted), ZERO);
  const all = computed.reduce(
    (a, c) => {
      for (const k of Object.keys(a)) a[k] += c.g.punctuality[k];
      return a;
    },
    newPunctuality(),
  );
  const totalP = punctualityFigures(all);

  return {
    rows,
    totals: {
      jobWorkers: new Set(computed.map((c) => c.g.vendorId)).size,
      jobs: computed.reduce((a, c) => a + c.g.jobs, 0),
      shrinkagePct: pctText(ratio(doneSent.minus(doneReturned), doneSent)),
      allowedPct: doneSent.greaterThan(0) ? pctText(allowedWeighted.div(doneSent).mul(100)) : null,
      overAllowance: computed.reduce((a, c) => a + c.g.overAllowance, 0),
      overdue: totalP.overdueCount,
    },
    // Punctuality stays in the table's columns; only shrinkage is charted.
    charts: [shrinkageChart],
  };
}

// ===========================================================================
//  SUPPLIERS - delivery against the PO date
// ===========================================================================

/**
 * WHEN A PO LINE COUNTS AS DELIVERED.
 *
 * On the GRN date that brought it within its receipt tolerance of the ordered
 * quantity - the same allowance the GRN itself is judged against, so a mill
 * that delivers 98 metres of 100 under a 2% tolerance has delivered. A
 * reversed GRN undid its receipt and is left out, as every live-receipt count
 * in the application does.
 *
 * Lines are taken by the DELIVERY DATE on their PO, so "September" means the
 * deliveries that were due in September.
 */
async function supplierDelivery(q) {
  const live = {
    ...notDeleted,
    workflowState: { in: ['APPROVED', 'POSTED', 'COMPLETED'] },
    status: { not: 'CANCELLED' },
    ...(q.vendorId ? { vendorId: q.vendorId } : {}),
  };
  // A PO raised without a "Deliver by" date has nothing to be late against.
  // It is counted, so an empty chart says why it is empty; with no delivery
  // date to place it in the range asked for, its PO date does.
  const undated = await prisma.purchaseOrder.count({
    where: { ...live, header: { deliveryDate: null }, ...between('poDate', q.dateFrom, q.dateTo) },
  });
  const lines = await prisma.purchaseOrder.findMany({
    where: {
      ...live,
      header: { deliveryDate: { not: null }, ...between('deliveryDate', q.dateFrom, q.dateTo) },
    },
    select: {
      id: true,
      vendorId: true,
      vendor: { select: { vendorName: true } },
      orderQty: true,
      receiptTolerancePct: true,
      header: { select: { deliveryDate: true } },
      grns: {
        where: { ...notDeleted, reversedAt: null, postedAt: { not: null } },
        select: { grnDate: true, receivingQty: true },
        orderBy: { grnDate: 'asc' },
      },
    },
  });

  const now = today();
  const groups = new Map();
  for (const line of lines) {
    if (!groups.has(line.vendorId)) {
      groups.set(line.vendorId, {
        vendorId: line.vendorId,
        vendorName: line.vendor?.vendorName ?? '-',
        firstDue: null,
        lastDue: null,
        lines: 0,
        lastReceived: null,
        punctuality: newPunctuality(),
      });
    }
    const g = groups.get(line.vendorId);
    const due = line.header.deliveryDate;
    g.lines += 1;
    g.firstDue = minDate(g.firstDue, due);
    g.lastDue = maxDate(g.lastDue, due);

    const enough = D(line.orderQty).mul(D(1).minus(D(line.receiptTolerancePct)));
    let cumulative = ZERO;
    let deliveredOn = null;
    for (const grn of line.grns) {
      cumulative = cumulative.plus(D(grn.receivingQty));
      g.lastReceived = maxDate(g.lastReceived, grn.grnDate);
      if (!deliveredOn && cumulative.greaterThanOrEqualTo(enough)) deliveredOn = grn.grnDate;
    }
    judge(g.punctuality, due, deliveredOn, now);
  }

  const computed = [...groups.values()].map((g) => ({
    g,
    p: { ...punctualityFigures(g.punctuality), chartLabel: g.vendorName },
  }));
  // Worst first: lowest on-time rate, then the most lines missed.
  computed.sort(
    (a, b) =>
      (a.p.onTimeRatio == null) - (b.p.onTimeRatio == null) ||
      (a.p.onTimeRatio && b.p.onTimeRatio ? a.p.onTimeRatio.comparedTo(b.p.onTimeRatio) : 0) ||
      b.p.lateCount + b.p.overdueCount - (a.p.lateCount + a.p.overdueCount) ||
      a.g.vendorName.localeCompare(b.g.vendorName),
  );

  const rows = computed
    .map(({ g, p }) => ({
      id: g.vendorId,
      vendorName: g.vendorName,
      firstDue: g.firstDue,
      lastDue: g.lastDue,
      lastReceived: g.lastReceived,
      poLines: String(g.lines),
      dueLines: String(p.dueCount),
      onTimeLines: String(p.onTimeCount),
      lateLines: String(p.lateCount),
      overdueLines: String(p.overdueCount),
      notYetDue: String(p.notYetDueCount),
      onTimePct: p.onTimePct,
      avgDaysLate: p.avgDaysLate,
      worstDaysLate: p.worstDaysLate == null ? null : String(p.worstDaysLate),
    }))
    .slice(0, q.limit);

  const all = computed.reduce(
    (a, c) => {
      for (const k of Object.keys(a)) a[k] += c.g.punctuality[k];
      return a;
    },
    newPunctuality(),
  );
  const totalP = punctualityFigures(all);

  return {
    rows,
    totals: {
      suppliers: computed.length,
      dueLines: totalP.dueCount,
      onTimePct: totalP.onTimePct,
      lateLines: totalP.lateCount,
      overdueLines: totalP.overdueCount,
      avgDaysLate: totalP.avgDaysLate,
      undated,
    },
    charts: [
      onTimeChart(
        computed.map((c) => c.p),
        {
          title: 'PO lines received in full by the delivery date',
          note: 'Lines whose delivery date has passed. A line still short after its date counts as late.',
          unitWord: 'lines',
        },
      ),
    ],
  };
}

// ===========================================================================
//  DEFECT REASONS - every stage that records one
// ===========================================================================

/**
 * EACH STAGE IS GATED BY ITS OWN MODULE.
 *
 * The report spans five registers, so no one permission describes it. It is
 * opened under REPORT.VIEW, and then each stage is read only for a caller who
 * may view that stage's own register - the controller hands the caller's
 * permission check in as `q.can`. A caller holding none of them gets an empty
 * report and is told how many stages were withheld, rather than figures they
 * could not otherwise reach.
 *
 * Units differ by stage - metres of fabric at scrutiny, pieces downstream, and
 * at Inline QC the number of checks a defect was found on (a check records
 * which defects it found, not how many pieces each one spoiled). Shares are
 * therefore only ever WITHIN a stage.
 */
export const DEFECT_STAGES = [
  {
    key: 'FABRIC_SCRUTINY',
    label: 'Fabric scrutiny',
    permission: 'FABRIC_SCRUTINY.VIEW',
    async load(q) {
      const lines = await prisma.fabricScrutinyDefect.findMany({
        where: {
          ...notDeleted,
          scrutiny: {
            ...notDeleted,
            ...(q.orderId ? { orderId: q.orderId } : {}),
            ...between('scrutinyDate', q.dateFrom, q.dateTo),
          },
        },
        select: { category: true, defectType: true, qty: true, uom: true, scrutiny: { select: { scrutinyDate: true } } },
      });
      return lines.map((l) => ({
        reason: l.defectType,
        detail: `${l.category.charAt(0)}${l.category.slice(1).toLowerCase()} defect`,
        qty: l.qty,
        unit: l.uom || 'Mtrs',
        date: l.scrutiny.scrutinyDate,
      }));
    },
  },
  {
    key: 'CUT_PIECES',
    label: 'Cut pieces check',
    permission: 'CUT_PIECES_RECEIPT.VIEW',
    async load(q) {
      const lines = await prisma.cutPieceDefect.findMany({
        where: {
          receipt: {
            ...notDeleted,
            ...(q.orderId ? { orderId: q.orderId } : {}),
            ...between('receiptDate', q.dateFrom, q.dateTo),
          },
        },
        select: { defectType: true, panel: true, qty: true, receipt: { select: { receiptDate: true } } },
      });
      return lines.map((l) => ({
        reason: l.defectType,
        detail: null,
        qty: l.qty,
        unit: 'pcs',
        date: l.receipt.receiptDate,
      }));
    },
  },
  {
    key: 'INLINE_QC',
    label: 'Inline QC',
    permission: 'INLINE_QC.VIEW',
    async load(q) {
      const lines = await prisma.inlineQcDefect.findMany({
        where: {
          entry: {
            ...notDeleted,
            ...(q.orderId ? { orderId: q.orderId } : {}),
            ...between('entryDate', q.dateFrom, q.dateTo),
          },
        },
        select: { defect: true, qty: true, entry: { select: { entryDate: true, checkType: true } } },
      });
      // Pieces where the defect was counted. A defect recorded before counts
      // were taken is still one check that found it, kept apart in "checks".
      return lines.map((l) => ({
        reason: l.defect,
        detail: l.entry.checkType === 'SIZE' ? 'Size check' : 'Workmanship',
        qty: l.qty ?? 1,
        unit: l.qty == null ? 'checks' : 'pcs',
        date: l.entry.entryDate,
      }));
    },
  },
  {
    key: 'EXTERNAL_QC',
    label: 'External QC',
    permission: 'EXTERNAL_QC.VIEW',
    async load(q) {
      const fields = Object.fromEntries(
        QC_BOXES.flatMap((b) => QC_REASONS.map((r) => [`${b.prefix}${r.suffix}`, true])),
      );
      const entries = await prisma.externalQcEntry.findMany({
        where: {
          ...notDeleted,
          ...(q.orderId ? { orderId: q.orderId } : {}),
          ...between('entryDate', q.dateFrom, q.dateTo),
        },
        select: { ...fields, entryDate: true },
      });
      const out = [];
      for (const e of entries) {
        for (const r of QC_REASONS) {
          const qty = QC_BOXES.reduce((a, b) => a.plus(D(e[`${b.prefix}${r.suffix}`])), ZERO);
          if (qty.greaterThan(0)) out.push({ reason: r.key, detail: null, qty, unit: 'pcs', date: e.entryDate });
        }
      }
      return out;
    },
  },
  {
    key: 'REJECTED',
    label: 'Rejected (not repairable)',
    permission: 'REJECTED_REGISTER.VIEW',
    async load(q) {
      const lines = await prisma.rejectedRegisterEntry.findMany({
        where: {
          ...notDeleted,
          ...(q.orderId ? { orderId: q.orderId } : {}),
          ...between('rejectDate', q.dateFrom, q.dateTo),
        },
        select: { reason: true, defectType: true, qty: true, rejectDate: true },
      });
      return lines.map((l) => ({
        reason: l.defectType ? `${l.reason} - ${l.defectType}` : l.reason,
        detail: null,
        qty: l.qty,
        unit: 'pcs',
        date: l.rejectDate,
      }));
    },
  },
];

/** The stages this caller may read, narrowed by the stage filter if given. */
export function defectStagesFor(can, qcStage) {
  const allowed = typeof can === 'function' ? can : () => false;
  return DEFECT_STAGES.filter((s) => allowed(s.permission) && (!qcStage || s.key === qcStage));
}

const fmtQty = (v) => {
  const d = D(v);
  return d.isInteger() ? d.toFixed(0) : d.toDecimalPlaces(2).toString();
};

async function defectReasons(q) {
  const stages = defectStagesFor(q.can, q.qcStage);
  const withheld = DEFECT_STAGES.filter((s) => !q.qcStage || s.key === q.qcStage).length - stages.length;
  const loaded = await Promise.all(stages.map(async (s) => ({ stage: s, found: await s.load(q) })));

  const rows = [];
  const charts = [];
  let top = null;
  for (const { stage, found } of loaded) {
    const byReason = new Map();
    let stageTotal = ZERO;
    for (const f of found) {
      const key = `${f.reason}|${f.unit}`;
      if (!byReason.has(key)) {
        byReason.set(key, { reason: f.reason, details: new Set(), unit: f.unit, qty: ZERO, times: 0, first: null, last: null });
      }
      const r = byReason.get(key);
      if (f.detail) r.details.add(f.detail);
      r.qty = r.qty.plus(D(f.qty));
      r.times += 1;
      r.first = minDate(r.first, f.date);
      r.last = maxDate(r.last, f.date);
      stageTotal = stageTotal.plus(D(f.qty));
    }
    const reasons = [...byReason.values()].sort((a, b) => b.qty.comparedTo(a.qty) || a.reason.localeCompare(b.reason));
    if (!reasons.length) continue;
    const unit = reasons[0].unit;

    for (const r of reasons) {
      const share = ratio(r.qty, stageTotal);
      rows.push({
        id: `${stage.key}|${r.reason}|${r.unit}`,
        stage: stage.label,
        reason: r.reason,
        detail: [...r.details].sort().join(', ') || null,
        qty: q4(r.qty),
        unit: r.unit,
        timesFound: String(r.times),
        shareOfStage: pctText(share),
        firstFound: r.first,
        lastFound: r.last,
      });
      if (share && (!top || share.greaterThan(top.share))) top = { stage: stage.label, reason: r.reason, share };
    }

    charts.push({
      key: stage.key,
      title: stage.label,
      note: `${fmtQty(stageTotal)} ${unit} across ${reasons.length} reason${reasons.length === 1 ? '' : 's'}`,
      unit,
      bars: reasons.slice(0, 8).map((r) => ({
        label: r.reason,
        value: D(r.qty).toDecimalPlaces(2).toString(),
        display: `${fmtQty(r.qty)} ${r.unit}`,
        sub: `${pctText(ratio(r.qty, stageTotal))} of this stage`,
      })),
    });
  }

  return {
    rows: rows.slice(0, q.limit),
    totals: {
      stages: charts.length,
      reasons: rows.length,
      topReason: top ? `${top.reason} (${top.stage}, ${pctText(top.share)})` : null,
      withheld,
    },
    charts,
  };
}

// ===========================================================================
//  THE REGISTRY ENTRIES
// ===========================================================================

export const VENDOR_REPORTS = {
  'jobworker-performance': {
    title: 'Job worker performance',
    description:
      'Per dyer, printer and washer: cloth sent and returned, shrinkage on completed jobs against ' +
      'the allowance each job was issued under, lots held for scrutiny and the dyeing defects ' +
      'scrutiny found, and how many lots came back by their delivery date. Worst first.',
    permission: 'DYE_ISSUE.VIEW',
    excelRef: '— derived from job work orders, dyeing receipts and fabric scrutiny',
    category: 'VENDOR',
    filters: ['vendorId', 'process', 'dateFrom', 'dateTo'],
    columns: [
      col('vendorName', 'Job worker'),
      col('process', 'Process'),
      col('firstIssued', 'First issued', 'date'),
      col('lastIssued', 'Last issued', 'date'),
      col('jobs', 'Jobs', 'qty'),
      col('completedJobs', 'Completed', 'qty'),
      col('sentQty', 'Sent', 'qty'),
      col('returnedQty', 'Returned', 'qty'),
      col('stillOutQty', 'Still with them', 'qty'),
      col('shrinkagePct', 'Shrinkage'),
      col('allowedPct', 'Allowed'),
      col('overAllowance', 'Jobs over allowance', 'qty'),
      col('returnsHeld', 'Returns held', 'qty'),
      col('dyeingDefectQty', 'Dyeing defects at scrutiny', 'qty'),
      col('rejectedAtScrutiny', 'Rejected at scrutiny', 'qty'),
      col('dueJobs', 'Due', 'qty'),
      col('onTimeJobs', 'On time', 'qty'),
      col('lateJobs', 'Late', 'qty'),
      col('overdueJobs', 'Overdue now', 'qty'),
      col('onTimePct', 'On-time %'),
      col('avgDaysLate', 'Avg days late'),
      col('uom', 'UOM'),
    ],
    run: jobworkerPerformance,
  },

  'supplier-delivery': {
    title: 'Supplier delivery',
    description:
      'Per supplier: purchase order lines by their delivery date, and how many were received in ' +
      'full (within the receipt tolerance) on or before it. Lines still short after their date ' +
      'count as late. Worst first.',
    permission: 'PURCHASE_ORDER.VIEW',
    excelRef: '— derived from purchase orders and GRNs',
    category: 'VENDOR',
    filters: ['vendorId', 'dateFrom', 'dateTo'],
    columns: [
      col('vendorName', 'Supplier'),
      col('firstDue', 'First due', 'date'),
      col('lastDue', 'Last due', 'date'),
      col('lastReceived', 'Last received', 'date'),
      col('poLines', 'PO lines', 'qty'),
      col('dueLines', 'Due', 'qty'),
      col('onTimeLines', 'On time', 'qty'),
      col('lateLines', 'Late', 'qty'),
      col('overdueLines', 'Overdue now', 'qty'),
      col('notYetDue', 'Not yet due', 'qty'),
      col('onTimePct', 'On-time %'),
      col('avgDaysLate', 'Avg days late'),
      col('worstDaysLate', 'Worst (days)'),
    ],
    run: supplierDelivery,
  },

  'defect-reasons': {
    title: 'Defect reasons',
    description:
      'Every defect recorded on the floor - fabric scrutiny, the cut pieces check, Inline QC, ' +
      'External QC and the Rejected register - by reason, with its share of that stage. Each ' +
      "stage shows only for someone who may view that stage's register.",
    permission: 'REPORT.VIEW',
    excelRef: '— derived from scrutiny, cut piece, Inline QC, External QC and rejected entries',
    category: 'VENDOR',
    filters: ['qcStage', 'orderId', 'dateFrom', 'dateTo'],
    columns: [
      col('stage', 'Stage'),
      col('reason', 'Reason'),
      col('detail', 'Kind'),
      col('qty', 'Quantity', 'qty'),
      col('unit', 'Unit'),
      col('timesFound', 'Times found', 'qty'),
      col('shareOfStage', 'Share of stage'),
      col('firstFound', 'First found', 'date'),
      col('lastFound', 'Last found', 'date'),
    ],
    run: defectReasons,
  },
};

export const _internal = { judge, newPunctuality, punctualityFigures, daysBetween };
