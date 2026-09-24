/**
 * Reports added after the original fourteen, kept in their own module.
 *
 * They are registered into `REPORTS` in report.service.js with one spread, so
 * the catalogue, the permission filter, the paging and the CSV export treat
 * them exactly like the others. They live here only so that two people adding
 * reports at the same time are not editing the same few hundred lines.
 *
 * Each entry has the same shape as the ones in report.service.js:
 * `{ title, description, permission, excelRef, category, filters, columns, run }`,
 * and `run(query)` returns `{ rows, totals }`.
 */

import prisma, { notDeleted } from '../config/prisma.js';
import { D } from '../utils/figures.js';

const ZERO = D(0);
const col = (key, label, format = 'text') => ({ key, label, format });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function between(field, from, to) {
  if (!from && !to) return {};
  return {
    [field]: {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    },
  };
}

const pct = (fraction) => (fraction == null ? null : `${D(fraction).mul(100).toDecimalPlaces(1).toFixed(1)}%`);

// ===========================================================================
//  CUTTING EFFICIENCY
// ===========================================================================

/**
 * Planned vs actual consumption, per style, from the figures each cutting
 * issue FROZE when it was posted - not from the style's average today, which
 * may have been renegotiated since.
 *
 * One row per style. A style's efficiency is the ratio of the SUMS, not the
 * average of the per-challan ratios: a 10-metre challan and a 1,000-metre one
 * are not equally important, and averaging their percentages would pretend
 * they were.
 */
async function cuttingEfficiencyReport(q) {
  const issues = await prisma.cuttingIssue.findMany({
    where: {
      ...notDeleted,
      postedAt: { not: null },
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.styleId && UUID.test(q.styleId) ? { styleId: q.styleId } : {}),
      ...(q.firmName ? { firmName: q.firmName } : {}),
      ...between('issueDate', q.dateFrom, q.dateTo),
    },
    take: q.limit,
    select: {
      styleId: true,
      style: { select: { styleNo: true, styleDescription: true } },
      cuttingPcsIssued: true,
      cuttingPcsDamaged: true,
      plannedConsumptionQty: true,
      actualConsumptionQty: true,
      consumedQty: true,
      wastageQty: true,
      fabricDamageQty: true,
      remainderQty: true,
      remnantQty: true,
      fabricUom: true,
      issueDate: true,
    },
  });

  const byStyle = new Map();
  for (const ci of issues) {
    const s = byStyle.get(ci.styleId) ?? {
      styleNo: ci.style?.styleNo ?? null,
      styleDescription: ci.style?.styleDescription ?? null,
      uom: ci.fabricUom,
      challans: 0,
      pcs: ZERO,
      damagedPcs: ZERO,
      planned: ZERO,
      actual: ZERO,
      wastage: ZERO,
      remnant: ZERO,
      returned: ZERO,
      unmeasured: 0,
      firstCut: ci.issueDate,
      lastCut: ci.issueDate,
    };
    s.challans += 1;
    // The span the figures cover, so a row can be read against the date range
    // it was asked for.
    if (ci.issueDate < s.firstCut) s.firstCut = ci.issueDate;
    if (ci.issueDate > s.lastCut) s.lastCut = ci.issueDate;
    s.pcs = s.pcs.plus(D(ci.cuttingPcsIssued));
    s.damagedPcs = s.damagedPcs.plus(D(ci.cuttingPcsDamaged));
    s.wastage = s.wastage.plus(D(ci.wastageQty)).plus(D(ci.fabricDamageQty));
    s.remnant = s.remnant.plus(D(ci.remnantQty));
    s.returned = s.returned.plus(D(ci.remainderQty));
    // A challan posted before the standard was frozen, or against a style
    // with no average, has nothing to measure against. It is counted, not
    // guessed at, and kept out of the ratio.
    if (ci.plannedConsumptionQty == null) {
      s.unmeasured += 1;
    } else {
      s.planned = s.planned.plus(D(ci.plannedConsumptionQty));
      s.actual = s.actual.plus(
        D(ci.actualConsumptionQty ?? D(ci.consumedQty).plus(D(ci.wastageQty)).plus(D(ci.fabricDamageQty))),
      );
    }
    byStyle.set(ci.styleId, s);
  }

  const rows = [...byStyle.entries()]
    .map(([styleId, s]) => {
      const efficiency = s.actual.greaterThan(0) && s.planned.greaterThan(0) ? s.planned.div(s.actual) : null;
      return {
        id: styleId,
        route: `/masters/styles?search=${encodeURIComponent(s.styleNo ?? '')}`,
        styleNo: s.styleNo,
        styleDescription: s.styleDescription,
        firstCut: s.firstCut,
        lastCut: s.lastCut,
        challans: s.challans,
        pcsCut: s.pcs.toFixed(4),
        damagedPcs: s.damagedPcs.toFixed(4),
        plannedQty: s.planned.toFixed(4),
        actualQty: s.actual.toFixed(4),
        varianceQty: s.actual.minus(s.planned).toFixed(4),
        efficiencyDisplay: pct(efficiency),
        wastageQty: s.wastage.toFixed(4),
        remnantQty: s.remnant.toFixed(4),
        returnedQty: s.returned.toFixed(4),
        uom: s.uom,
        unmeasured: s.unmeasured,
      };
    })
    .sort((a, b) => (a.styleNo ?? '').localeCompare(b.styleNo ?? ''));

  const planned = rows.reduce((a, r) => a.plus(D(r.plannedQty)), ZERO);
  const actual = rows.reduce((a, r) => a.plus(D(r.actualQty)), ZERO);

  return {
    rows,
    totals: {
      styles: rows.length,
      plannedQty: planned.toFixed(4),
      actualQty: actual.toFixed(4),
      efficiency: planned.greaterThan(0) && actual.greaterThan(0) ? pct(planned.div(actual)) : null,
      remnantQty: rows.reduce((a, r) => a.plus(D(r.remnantQty)), ZERO).toFixed(4),
    },
  };
}

// ===========================================================================
//  STOCK VALUATION (FIFO)
// ===========================================================================

/**
 * What the stock on hand is worth under FIFO, layer by layer.
 *
 * One row per cost layer still holding stock: when that cost entered the
 * company, the document it came in on, how much of it is left and at what
 * rate. The sum of this report's value IS the stock value - the same figure
 * `stock_balances` caches - so an accountant can tie the one to the other.
 */
async function stockValuationReport(q) {
  const layers = await prisma.stockCostLayer.findMany({
    where: {
      qtyRemaining: { gt: 0 },
      ...(q.location ? { location: q.location } : {}),
      ...(q.itemCategory ? { item: { itemCategory: q.itemCategory } } : {}),
      ...between('layerDate', q.dateFrom, q.dateTo),
    },
    orderBy: [{ itemId: 'asc' }, { location: 'asc' }, { layerDate: 'asc' }],
    take: q.limit,
    include: { item: { select: { itemCode: true, description: true, itemCategory: true, uom: true } } },
  });

  const today = new Date();
  const rows = layers.map((l) => {
    const value = D(l.qtyRemaining).mul(D(l.rate)).toDecimalPlaces(2);
    return {
      id: l.id,
      route: `/inventory/items/${l.itemId}`,
      itemCode: l.item?.itemCode ?? null,
      description: l.item?.description ?? null,
      itemCategory: l.item?.itemCategory ?? null,
      location: l.location,
      layerDate: l.layerDate,
      ageDays: Math.max(0, Math.floor((today - new Date(l.layerDate)) / 86400000)),
      sourceDocumentNo: l.sourceDocumentNo,
      opening: l.isOpening ? 'Yes' : 'No',
      qtyIn: D(l.qtyIn).toFixed(4),
      qtyRemaining: D(l.qtyRemaining).toFixed(4),
      uom: l.item?.uom ?? null,
      rate: D(l.rate).toFixed(4),
      value: value.toFixed(2),
    };
  });

  return {
    rows,
    totals: {
      layers: rows.length,
      value: rows.reduce((a, r) => a.plus(D(r.value)), ZERO).toFixed(2),
      olderThan90Days: rows.filter((r) => r.ageDays > 90).length,
    },
  };
}

// ===========================================================================
//  THE REGISTRY ENTRIES
// ===========================================================================

export const EXTRA_REPORTS = {
  'cutting-efficiency': {
    title: 'Cutting efficiency',
    description:
      'Per style: what the style says the cut should have used against what the floor actually ' +
      'used, with the wastage and the end-bits kept as remnants.',
    permission: 'CUTTING_ISSUE.VIEW',
    excelRef: '— derived from posted Cutting Issues',
    category: 'STAFF_EFFICIENCY',
    filters: ['orderId', 'firmName', 'dateFrom', 'dateTo'],
    columns: [
      col('styleNo', 'Style'),
      col('styleDescription', 'Description'),
      col('firstCut', 'First cut', 'date'),
      col('lastCut', 'Last cut', 'date'),
      col('challans', 'Challans', 'qty'),
      col('pcsCut', 'Pcs cut', 'qty'),
      col('damagedPcs', 'Damaged pcs', 'qty'),
      col('plannedQty', 'Planned fabric', 'qty'),
      col('actualQty', 'Actual fabric', 'qty'),
      col('varianceQty', 'Over / (under)', 'qty'),
      col('efficiencyDisplay', 'Efficiency'),
      col('wastageQty', 'Wastage + damage', 'qty'),
      col('remnantQty', 'Remnants kept', 'qty'),
      col('returnedQty', 'Returned on roll', 'qty'),
      col('uom', 'UOM'),
      col('unmeasured', 'No standard', 'qty'),
    ],
    run: cuttingEfficiencyReport,
  },

  'stock-valuation': {
    title: 'Stock valuation (FIFO)',
    description:
      'Stock on hand valued first-in, first-out: every cost layer still holding stock, when it ' +
      'came in, what it cost and how old it is. The total is the stock value.',
    permission: 'INVENTORY.VIEW',
    excelRef: '— derived; see docs/STOCK-VALUATION-POLICY.md',
    category: 'INVENTORY',
    filters: ['itemCategory', 'location', 'dateFrom', 'dateTo'],
    columns: [
      col('itemCode', 'Item Code'),
      col('description', 'Description'),
      col('itemCategory', 'Category'),
      col('location', 'Location'),
      col('layerDate', 'Received', 'date'),
      col('ageDays', 'Age (days)', 'qty'),
      col('sourceDocumentNo', 'Came in on'),
      col('opening', 'Opening layer'),
      col('qtyIn', 'Layer qty', 'qty'),
      col('qtyRemaining', 'On hand', 'qty'),
      col('uom', 'UOM'),
      col('rate', 'FIFO rate', 'money'),
      col('value', 'Value', 'money'),
    ],
    run: stockValuationReport,
  },
};
