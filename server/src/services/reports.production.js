/**
 * Production reports - ironing.
 *
 *   ironing-daily     pieces ironed per day, by ironer and by order, with
 *                     the damage count and damage %
 *   ironing-balance   per order, style and unit: what has come to ironing,
 *                     what is done, what is damaged and undecided, and the
 *                     balance still waiting to be ironed
 *
 * Damage % is damaged / (ironed + damaged): the share of the pieces that went
 * under the iron and came off it spoilt. See domain/ironing.js.
 */

import prisma, { notDeleted } from '../config/prisma.js';
import { D } from '../utils/figures.js';
import { balanceAtIroning, damageFraction, pctText, undecidedOf } from '../domain/ironing.js';
import { sourceLabel } from './ironing.service.js';

const col = (key, label, format = 'text') => ({ key, label, format });

function between(field, from, to) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } };
}

const s = (v) => D(v).toString();

async function ironingDaily(q) {
  const entries = await prisma.ironingEntry.findMany({
    where: {
      ...notDeleted,
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.firmName ? { fromUnit: q.firmName } : {}),
      ...between('entryDate', q.dateFrom, q.dateTo),
      OR: [{ pcsIroned: { gt: 0 } }, { pcsDamaged: { gt: 0 } }],
    },
    include: {
      ironer: { select: { id: true, empId: true, empName: true } },
      order: { select: { orderNo: true } },
      style: { select: { styleNo: true } },
    },
  });

  const groups = new Map();
  for (const e of entries) {
    const day = e.entryDate.toISOString().slice(0, 10);
    const key = `${day}|${e.ironerId}|${e.orderId}|${e.styleId}`;
    const g = groups.get(key) ?? {
      entryDate: e.entryDate,
      ironerName: e.ironer?.empName ?? '-',
      empId: e.ironer?.empId ?? '-',
      orderNo: e.order.orderNo,
      styleNo: e.style.styleNo,
      ironed: D(0),
      damaged: D(0),
      reIroned: D(0),
      rejected: D(0),
    };
    g.ironed = g.ironed.plus(D(e.pcsIroned));
    g.damaged = g.damaged.plus(D(e.pcsDamaged));
    g.reIroned = g.reIroned.plus(D(e.pcsReIroned));
    g.rejected = g.rejected.plus(D(e.pcsRejected));
    groups.set(key, g);
  }

  const rows = [...groups.values()]
    .sort((a, b) => b.entryDate - a.entryDate || a.ironerName.localeCompare(b.ironerName) || a.orderNo.localeCompare(b.orderNo))
    .slice(0, q.limit)
    .map((g) => ({
      entryDate: g.entryDate,
      ironerName: g.ironerName,
      empId: g.empId,
      orderNo: g.orderNo,
      styleNo: g.styleNo,
      pcsIroned: s(g.ironed),
      pcsDamaged: s(g.damaged),
      damagePct: pctText(damageFraction(g.ironed, g.damaged)),
      pcsReIroned: s(g.reIroned),
      pcsRejected: s(g.rejected),
      pcsUndecided: s(undecidedOf(g)),
    }));

  const ironed = rows.reduce((a, r) => a.plus(D(r.pcsIroned)), D(0));
  const damaged = rows.reduce((a, r) => a.plus(D(r.pcsDamaged)), D(0));
  return { rows, totals: { ironed: s(ironed), damaged: s(damaged), damagePct: pctText(damageFraction(ironed, damaged)) } };
}

async function ironingBalance(q) {
  const scope = {
    ...(q.orderId ? { orderId: q.orderId } : {}),
  };
  const [ironing, stitched, printed, challans] = await Promise.all([
    // By source too: pieces back from External QC and the Alteration Unit
    // name no stitching unit, and are a lane of their own.
    prisma.ironingEntry.groupBy({
      by: ['source', 'fromUnit', 'orderId', 'styleId'],
      where: { ...notDeleted, ...scope, ...(q.firmName ? { fromUnit: q.firmName } : {}) },
      _sum: { pcsReceived: true, pcsIroned: true, pcsDamaged: true, pcsReIroned: true, pcsRejected: true },
    }),
    prisma.stitchingRecord.groupBy({
      by: ['unit', 'orderId', 'styleId'],
      where: { ...notDeleted, ...scope, ...(q.firmName ? { unit: q.firmName } : {}) },
      _sum: { actualStitched: true },
    }),
    prisma.printing.groupBy({
      by: ['fromUnit', 'orderId', 'styleId'],
      where: { ...notDeleted, ...scope, fabricStage: 'AFTER_STITCHING', status: { not: 'CANCELLED' }, fromUnit: { not: null } },
      _sum: { qty: true, qtyReceived: true },
    }),
    prisma.cuttingIssue.groupBy({
      by: ['firmName', 'orderId', 'styleId', 'ironingReceiptStatus'],
      where: { ...notDeleted, ...scope, postedAt: { not: null }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    }),
  ]);

  const k = (u, o, st) => `${u}|${o}|${st}`;
  const stitchedOf = new Map(stitched.map((g) => [k(g.unit, g.orderId, g.styleId), g._sum.actualStitched]));
  const outOf = new Map(printed.map((g) => [k(g.fromUnit, g.orderId, g.styleId), D(g._sum.qty).minus(D(g._sum.qtyReceived))]));
  const challansOf = new Map();
  for (const c of challans) {
    const key = k(c.firmName, c.orderId, c.styleId);
    const m = challansOf.get(key) ?? {};
    m[c.ironingReceiptStatus] = c._count._all;
    challansOf.set(key, m);
  }

  const [orders, styles] = await Promise.all([
    prisma.buyerOrder.findMany({ where: { id: { in: [...new Set(ironing.map((g) => g.orderId))] } }, select: { id: true, orderNo: true } }),
    prisma.style.findMany({ where: { id: { in: [...new Set(ironing.map((g) => g.styleId))] } }, select: { id: true, styleNo: true } }),
  ]);
  const orderNo = new Map(orders.map((o) => [o.id, o.orderNo]));
  const styleNo = new Map(styles.map((x) => [x.id, x.styleNo]));

  const rows = ironing
    .map((g) => {
      const key = k(g.fromUnit, g.orderId, g.styleId);
      const t = g._sum;
      const unitLane = g.source === 'STITCHING_UNIT';
      const st = unitLane ? challansOf.get(key) ?? {} : {};
      const stitchedPcs = unitLane ? D(stitchedOf.get(key)) : null;
      const out = unitLane ? outOf.get(key) ?? D(0) : null;
      return {
        orderNo: orderNo.get(g.orderId) ?? '-',
        styleNo: styleNo.get(g.styleId) ?? '-',
        fromUnit: unitLane ? g.fromUnit : sourceLabel(g.source),
        pcsStitched: unitLane ? s(stitchedPcs) : '-',
        pcsOutForPrinting: unitLane ? s(out) : '-',
        pcsReceived: s(t.pcsReceived),
        pcsIroned: s(t.pcsIroned),
        pcsDamaged: s(t.pcsDamaged),
        damagePct: pctText(damageFraction(t.pcsIroned, t.pcsDamaged)),
        pcsReIroned: s(t.pcsReIroned),
        pcsRejected: s(t.pcsRejected),
        pcsUndecided: s(undecidedOf({ damaged: t.pcsDamaged, reIroned: t.pcsReIroned, rejected: t.pcsRejected })),
        balance: s(balanceAtIroning({ received: t.pcsReceived, ironed: t.pcsIroned, damaged: t.pcsDamaged, reIroned: t.pcsReIroned })),
        pcsStillAtUnit: unitLane ? s(stitchedPcs.minus(out).minus(D(t.pcsReceived))) : '-',
        challans: [
          st.CLOSED ? `${st.CLOSED} closed` : null,
          st.PARTIALLY_RECEIVED ? `${st.PARTIALLY_RECEIVED} partial` : null,
          st.NOT_RECEIVED ? `${st.NOT_RECEIVED} not received` : null,
        ].filter(Boolean).join(', ') || '-',
      };
    })
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo) || a.styleNo.localeCompare(b.styleNo) || a.fromUnit.localeCompare(b.fromUnit))
    .slice(0, q.limit);

  return {
    rows,
    totals: {
      balance: s(rows.reduce((a, r) => a.plus(D(r.balance)), D(0))),
      undecided: s(rows.reduce((a, r) => a.plus(D(r.pcsUndecided)), D(0))),
    },
  };
}

export const PRODUCTION_REPORTS = {
  'ironing-daily': {
    title: 'Ironing - daily output',
    description:
      'Pieces ironed each day by each ironer, order by order, with the pieces damaged, the damage % '
      + '(damaged / ironed + damaged) and how the damage was decided.',
    permission: 'IRONING.VIEW',
    excelRef: '— derived from Ironing entries',
    category: 'PRODUCTION',
    filters: ['orderId', 'firmName', 'dateFrom', 'dateTo'],
    columns: [
      col('entryDate', 'Date', 'date'),
      col('ironerName', 'Ironer'),
      col('empId', 'Emp ID'),
      col('orderNo', 'Order No'),
      col('styleNo', 'Style'),
      col('pcsIroned', 'Pcs ironed', 'qty'),
      col('pcsDamaged', 'Damaged', 'qty'),
      col('damagePct', 'Damage %'),
      col('pcsReIroned', 'Re-iron', 'qty'),
      col('pcsRejected', 'Rejected', 'qty'),
      col('pcsUndecided', 'Not yet decided', 'qty'),
    ],
    run: ironingDaily,
  },
  'ironing-balance': {
    title: 'Ironing - balance waiting',
    description:
      'Per order, style and stitching unit: pieces received at ironing, ironed, damaged and still '
      + 'undecided, the balance waiting to be ironed, and how far the unit\'s cutting challans are closed.',
    permission: 'IRONING.VIEW',
    excelRef: '— derived from Ironing entries, Stitching Records and Cutting Issues',
    category: 'PRODUCTION',
    filters: ['orderId', 'firmName'],
    columns: [
      col('orderNo', 'Order No'),
      col('styleNo', 'Style'),
      col('fromUnit', 'From unit / source'),
      col('pcsStitched', 'Stitched', 'qty'),
      col('pcsOutForPrinting', 'Out for printing', 'qty'),
      col('pcsStillAtUnit', 'Still at unit', 'qty'),
      col('pcsReceived', 'Received', 'qty'),
      col('pcsIroned', 'Ironed', 'qty'),
      col('pcsDamaged', 'Damaged', 'qty'),
      col('damagePct', 'Damage %'),
      col('pcsReIroned', 'Re-iron', 'qty'),
      col('pcsRejected', 'Rejected', 'qty'),
      col('pcsUndecided', 'Not yet decided', 'qty'),
      col('balance', 'Balance waiting', 'qty'),
      col('challans', 'Cutting challans'),
    ],
    run: ironingBalance,
  },
};
