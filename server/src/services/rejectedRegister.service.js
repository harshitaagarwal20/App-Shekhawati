/**
 * The Rejected Register - pieces out of the order for good.
 *
 * Read-only by construction. Every row is written by the service that owns
 * the stage it was rejected at (today the Alteration Unit, for the pieces it
 * found not repairable - alteration.service.js) and is kept equal to that
 * entry. Correcting a reject means correcting the entry that made it.
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const dateOnly = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00.000Z`);

export const SORTABLE = ['rejectDate', 'qty', 'reason', 'stage', 'createdAt'];

const INCLUDE = {
  order: { select: { id: true, orderNo: true, buyer: { select: { buyerName: true } } } },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  alterationEntry: {
    select: { id: true, entryDate: true, staff: { select: { id: true, empId: true, empName: true } } },
  },
  alterationReceipt: {
    select: {
      id: true,
      box: true,
      receivedDate: true,
      externalQcEntry: { select: { id: true, entryDate: true, agency: { select: { vendorName: true } } } },
    },
  },
};

const project = (row) => ({ ...row, qty: D(row.qty).toString() });

export async function list(query) {
  const { page, pageSize, skip, take, orderBy, search } = query;
  const where = {
    deletedAt: null,
    ...(query.stage ? { stage: query.stage } : {}),
    ...(query.origin ? { origin: query.origin } : {}),
    ...(query.reason ? { reason: query.reason } : {}),
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.styleId ? { styleId: query.styleId } : {}),
    ...(query.dateFrom || query.dateTo
      ? { rejectDate: { ...(query.dateFrom ? { gte: dateOnly(query.dateFrom) } : {}), ...(query.dateTo ? { lte: dateOnly(query.dateTo) } : {}) } }
      : {}),
    ...searchFilter(search, ['reason', 'defectType', 'notRepairableReason', 'unit', 'order.orderNo', 'style.styleNo']),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.rejectedRegisterEntry.findMany({ where, orderBy: orderBy ?? { rejectDate: 'desc' }, skip, take, include: INCLUDE }),
    prisma.rejectedRegisterEntry.count({ where }),
    prisma.rejectedRegisterEntry.aggregate({ where, _sum: { qty: true } }),
  ]);
  return { rows: rows.map(project), total, page, pageSize, totals: { qty: D(sums._sum.qty).toString() } };
}

export async function getById(id) {
  const row = await prisma.rejectedRegisterEntry.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!row) throw ApiError.notFound('Rejected register entry');
  return project(row);
}
