/**
 * Finishing reports - External QC, the Alteration Unit, the pipeline.
 *
 *   external-qc-by-order    approved / alteration / rejected % per order and style
 *   external-qc-by-agency   the same, per agency
 *   external-qc-by-reason   every faulty piece by box and reason, and where it went
 *   checker-report          the Checker Report: faulty pieces External QC traced
 *                           to each checker code (the number on the bag)
 *   alteration-pending      the Alteration Unit's open bags, with their age
 *   alteration-summary      per order and style: received, altered, not
 *                           repairable, pending, oldest pending
 *   finishing-pipeline      every stage balance of an order and style, and
 *                           the proof that they add back up - no double counting
 *
 * A share is of the pieces offered. See domain/finishing.js.
 */

import prisma, { notDeleted } from '../config/prisma.js';
import { D } from '../utils/figures.js';
import { IRON, QC_BOXES, QC_REASONS, ironOf, pctText, shareOf } from '../domain/finishing.js';
import { finishingSums, flowOf } from './finishingFlow.service.js';

const col = (key, label, format = 'text') => ({ key, label, format });
const s = (v) => D(v).toString();

function between(field, from, to) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } };
}

const qcWhere = (q) => ({
  ...notDeleted,
  ...(q.orderId ? { orderId: q.orderId } : {}),
  ...(q.vendorId ? { agencyId: q.vendorId } : {}),
  ...between('entryDate', q.dateFrom, q.dateTo),
});

async function names(orderIds, styleIds) {
  const [orders, styles] = await Promise.all([
    prisma.buyerOrder.findMany({ where: { id: { in: [...new Set(orderIds)] } }, select: { id: true, orderNo: true, buyer: { select: { buyerName: true } } } }),
    prisma.style.findMany({ where: { id: { in: [...new Set(styleIds)] } }, select: { id: true, styleNo: true } }),
  ]);
  return {
    order: new Map(orders.map((o) => [o.id, o])),
    style: new Map(styles.map((x) => [x.id, x.styleNo])),
  };
}

/** The boxes and their shares, from summed figures. */
function boxes(sum) {
  const offered = D(sum.pcsOffered);
  const iron = ironOf(sum);
  return {
    pcsOffered: s(offered),
    pcsApproved: s(sum.pcsApproved),
    approvedPct: pctText(shareOf(sum.pcsApproved, offered)),
    pcsAlteration: s(sum.pcsAlteration),
    alterationPct: pctText(shareOf(sum.pcsAlteration, offered)),
    pcsRejected: s(sum.pcsRejected),
    rejectedPct: pctText(shareOf(sum.pcsRejected, offered)),
    pcsBackToIroning: s(iron),
    pcsToAlterationUnit: s(D(sum.pcsAlteration).plus(D(sum.pcsRejected)).minus(iron)),
  };
}

const BOX_SUMS = { pcsOffered: true, pcsApproved: true, pcsAlteration: true, pcsRejected: true, altIron: true, rejIron: true };

const BOX_COLUMNS = [
  col('pcsOffered', 'Offered', 'qty'),
  col('pcsApproved', 'Approved', 'qty'),
  col('approvedPct', 'Approved %'),
  col('pcsAlteration', 'Alteration', 'qty'),
  col('alterationPct', 'Alteration %'),
  col('pcsRejected', 'Rejected', 'qty'),
  col('rejectedPct', 'Rejected %'),
  col('pcsBackToIroning', 'Back to ironing (Iron)', 'qty'),
  col('pcsToAlterationUnit', 'To Alteration Unit', 'qty'),
];

async function qcTotals(q) {
  const t = await prisma.externalQcEntry.aggregate({ where: qcWhere(q), _sum: BOX_SUMS });
  const b = boxes(t._sum);
  return { offered: b.pcsOffered, approvedPct: b.approvedPct, alterationPct: b.alterationPct, rejectedPct: b.rejectedPct };
}

async function qcByOrder(q) {
  const groups = await prisma.externalQcEntry.groupBy({
    by: ['orderId', 'styleId'],
    where: qcWhere(q),
    _sum: BOX_SUMS,
    _count: { _all: true },
    _min: { entryDate: true },
    _max: { entryDate: true },
  });
  const n = await names(groups.map((g) => g.orderId), groups.map((g) => g.styleId));
  const rows = groups
    .map((g) => ({
      orderNo: n.order.get(g.orderId)?.orderNo ?? '-',
      buyerName: n.order.get(g.orderId)?.buyer?.buyerName ?? '-',
      styleNo: n.style.get(g.styleId) ?? '-',
      inspections: String(g._count._all),
      firstDate: g._min.entryDate,
      lastDate: g._max.entryDate,
      ...boxes(g._sum),
    }))
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo) || a.styleNo.localeCompare(b.styleNo))
    .slice(0, q.limit);
  return { rows, totals: await qcTotals(q) };
}

async function qcByAgency(q) {
  const groups = await prisma.externalQcEntry.groupBy({
    by: ['agencyId'],
    where: qcWhere(q),
    _sum: BOX_SUMS,
    _count: { _all: true },
    _min: { entryDate: true },
    _max: { entryDate: true },
  });
  const vendors = await prisma.vendor.findMany({ where: { id: { in: groups.map((g) => g.agencyId) } }, select: { id: true, vendorName: true } });
  const name = new Map(vendors.map((v) => [v.id, v.vendorName]));
  const rows = groups
    .map((g) => ({
      agencyName: name.get(g.agencyId) ?? '-',
      inspections: String(g._count._all),
      firstDate: g._min.entryDate,
      lastDate: g._max.entryDate,
      ...boxes(g._sum),
    }))
    .sort((a, b) => a.agencyName.localeCompare(b.agencyName))
    .slice(0, q.limit);
  return { rows, totals: await qcTotals(q) };
}

async function qcByReason(q) {
  const fields = Object.fromEntries(
    QC_BOXES.flatMap((b) => QC_REASONS.map((r) => [`${b.prefix}${r.suffix}`, true])),
  );
  // The entries themselves rather than one aggregate, so each reason can say
  // the first and last day it was found in the range asked for.
  const entries = await prisma.externalQcEntry.findMany({
    where: qcWhere(q),
    select: { ...fields, entryDate: true, pcsOffered: true, pcsAlteration: true, pcsRejected: true },
  });
  const t = {};
  for (const e of entries) {
    for (const k of Object.keys(e)) if (k !== 'entryDate') t[k] = D(t[k]).plus(D(e[k]));
  }
  const offered = D(t.pcsOffered);
  const faulty = D(t.pcsAlteration).plus(D(t.pcsRejected));

  const rows = QC_REASONS.map((r) => {
    const alt = D(t[`alt${r.suffix}`]);
    const rej = D(t[`rej${r.suffix}`]);
    const total = alt.plus(rej);
    const seen = entries
      .filter((e) => D(e[`alt${r.suffix}`]).plus(D(e[`rej${r.suffix}`])).greaterThan(0))
      .map((e) => e.entryDate)
      .sort((a, b) => a - b);
    return {
      reason: r.key,
      firstDate: seen[0] ?? null,
      lastDate: seen[seen.length - 1] ?? null,
      pcsAlterationBox: s(alt),
      pcsRejectedBox: s(rej),
      pcsTotal: s(total),
      pctOfOffered: pctText(shareOf(total, offered)),
      pctOfFaulty: pctText(shareOf(total, faulty)),
      goesTo: r.key === IRON ? 'Ironing (Re-iron)' : 'Alteration Unit',
    };
  });
  return {
    rows,
    totals: { offered: s(offered), faulty: s(faulty), faultyPct: pctText(shareOf(faulty, offered)) },
  };
}

/**
 * THE CHECKER REPORT. One row per checker code: the faulty pieces External
 * QC traced to it, across how many inspections and orders, and its share of
 * every faulty piece in the period.
 */
async function checkerReport(q) {
  const where = {
    entry: qcWhere(q),
    ...(q.checkerCode ? { checkerCode: String(q.checkerCode).trim().toUpperCase() } : {}),
  };
  const lines = await prisma.externalQcCheckerLine.findMany({
    where,
    select: {
      checkerCode: true,
      pcs: true,
      employee: { select: { empId: true, empName: true } },
      entry: { select: { id: true, entryDate: true, orderId: true, order: { select: { orderNo: true } } } },
    },
  });
  const faulty = (await prisma.externalQcEntry.aggregate({ where: qcWhere(q), _sum: { pcsAlteration: true, pcsRejected: true } }))._sum;
  const allFaulty = D(faulty.pcsAlteration).plus(D(faulty.pcsRejected));

  const by = new Map();
  for (const l of lines) {
    const g = by.get(l.checkerCode)
      ?? { checkerCode: l.checkerCode, employee: null, pcs: D(0), entries: new Set(), orders: new Set(), first: null, last: null };
    g.pcs = g.pcs.plus(D(l.pcs));
    if (!g.first || l.entry.entryDate < g.first) g.first = l.entry.entryDate;
    if (!g.last || l.entry.entryDate > g.last) g.last = l.entry.entryDate;
    g.employee = g.employee ?? l.employee;
    g.entries.add(l.entry.id);
    g.orders.add(l.entry.order.orderNo);
    by.set(l.checkerCode, g);
  }
  const traced = [...by.values()].reduce((a, g) => a.plus(g.pcs), D(0));
  const rows = [...by.values()]
    .sort((a, b) => b.pcs.comparedTo(a.pcs) || a.checkerCode.localeCompare(b.checkerCode))
    .slice(0, q.limit)
    .map((g) => ({
      checkerCode: g.checkerCode,
      checkerName: g.employee?.empName ?? '-',
      inspections: String(g.entries.size),
      firstDate: g.first,
      lastDate: g.last,
      orders: [...g.orders].sort().join(', '),
      pcsExternalFaulty: s(g.pcs),
      shareOfTraced: pctText(shareOf(g.pcs, traced)),
      shareOfAllFaulty: pctText(shareOf(g.pcs, allFaulty)),
    }));
  return {
    rows,
    totals: {
      traced: s(traced),
      allFaulty: s(allFaulty),
      untraced: s(allFaulty.minus(traced)),
    },
  };
}

/**
 * Every stage of an order and style after the stitching units, net. The
 * Difference column is (sum of the stages) - (received from the units): zero
 * on every row, because a piece sent back leaves the stage that sent it.
 */
export async function finishingPipeline(q) {
  const sums = await finishingSums(prisma, q.orderId ? { orderId: q.orderId } : {});
  const flows = [...sums.values()].map((x) => ({ ...x, f: flowOf(x) }));
  const n = await names(flows.map((x) => x.orderId), flows.map((x) => x.styleId));
  const rows = flows
    .map(({ orderId, styleId, f }) => ({
      orderNo: n.order.get(orderId)?.orderNo ?? '-',
      styleNo: n.style.get(styleId) ?? '-',
      receivedFromUnits: s(f.receivedFromUnits),
      atIroning: s(f.atIroning),
      damageUndecided: s(f.damageUndecided),
      waitingForQc: s(f.waitingForQc),
      approved: s(f.approved),
      reIronPending: s(f.reIronPending),
      atAlteration: s(f.atAlteration),
      alteredPending: s(f.alteredPending),
      rejected: s(f.rejected),
      accounted: s(f.accounted),
      difference: s(f.difference),
    }))
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo) || a.styleNo.localeCompare(b.styleNo))
    .slice(0, q.limit);
  const sum = (k) => s(rows.reduce((a, r) => a.plus(D(r[k])), D(0)));
  return {
    rows,
    totals: { receivedFromUnits: sum('receivedFromUnits'), accounted: sum('accounted'), difference: sum('difference'), approved: sum('approved') },
  };
}

export const FINISHING_REPORTS = {
  'external-qc-by-order': {
    title: 'External QC - by order',
    description: 'Per order and style: pieces offered to the external agency and the share approved, sent for alteration and rejected, and where the faulty pieces went.',
    permission: 'EXTERNAL_QC.VIEW',
    excelRef: '— derived from External QC entries',
    category: 'PRODUCTION',
    filters: ['orderId', 'vendorId', 'dateFrom', 'dateTo'],
    columns: [
      col('orderNo', 'Order No'),
      col('buyerName', 'Buyer'),
      col('styleNo', 'Style'),
      col('inspections', 'Inspections'),
      col('firstDate', 'First inspection', 'date'),
      col('lastDate', 'Last inspection', 'date'),
      ...BOX_COLUMNS,
    ],
    run: qcByOrder,
  },
  'external-qc-by-agency': {
    title: 'External QC - by agency',
    description: 'Per inspecting agency: pieces offered and the share approved, sent for alteration and rejected.',
    permission: 'EXTERNAL_QC.VIEW',
    excelRef: '— derived from External QC entries',
    category: 'PRODUCTION',
    filters: ['orderId', 'vendorId', 'dateFrom', 'dateTo'],
    columns: [
      col('agencyName', 'Agency'),
      col('inspections', 'Inspections'),
      col('firstDate', 'First inspection', 'date'),
      col('lastDate', 'Last inspection', 'date'),
      ...BOX_COLUMNS,
    ],
    run: qcByAgency,
  },
  'external-qc-by-reason': {
    title: 'External QC - by reason',
    description: 'Every faulty piece by reason (Alter, Iron, Defected, Spoiled, Other), in the Alteration and the Rejected box, as a share of the pieces offered, and where it went next.',
    permission: 'EXTERNAL_QC.VIEW',
    excelRef: '— derived from External QC entries',
    category: 'PRODUCTION',
    filters: ['orderId', 'vendorId', 'dateFrom', 'dateTo'],
    columns: [
      col('reason', 'Reason'),
      col('firstDate', 'First found', 'date'),
      col('lastDate', 'Last found', 'date'),
      col('pcsAlterationBox', 'Alteration box', 'qty'),
      col('pcsRejectedBox', 'Rejected box', 'qty'),
      col('pcsTotal', 'Total', 'qty'),
      col('pctOfOffered', '% of offered'),
      col('pctOfFaulty', '% of faulty'),
      col('goesTo', 'Goes to'),
    ],
    run: qcByReason,
  },
  'checker-report': {
    title: 'Checker Report',
    description: 'Per checker code (the number marked on the bag): the faulty pieces External QC traced to it - sent for alteration or rejected - across inspections and orders, and its share of all faulty pieces.',
    permission: 'EXTERNAL_QC.VIEW',
    excelRef: '— derived from External QC checker codes',
    category: 'PRODUCTION',
    filters: ['checkerCode', 'orderId', 'vendorId', 'dateFrom', 'dateTo'],
    columns: [
      col('checkerCode', 'Checker code'),
      col('checkerName', 'Checker'),
      col('inspections', 'Inspections'),
      col('firstDate', 'First inspection', 'date'),
      col('lastDate', 'Last inspection', 'date'),
      col('orders', 'Orders'),
      col('pcsExternalFaulty', 'External QC rejects traced', 'qty'),
      col('shareOfTraced', '% of traced'),
      col('shareOfAllFaulty', '% of all faulty'),
    ],
    run: checkerReport,
  },
};
