/**
 * Style cost sheets - FOB costing from the BOM.
 *
 * ---------------------------------------------------------------------------
 *  LIFE OF A SHEET
 *
 *    create()    copies the style's active BOM into material lines, suggests a
 *                rate for each from the last APPROVED purchase order for the
 *                same material (else the last approved quotation), and saves
 *                a DRAFT.
 *    update()    merchandising prices it: rates, consumption, conversion
 *                costs, percentages. Every derived figure is recomputed by
 *                domain/costing.js on every write.
 *    submit()    DRAFT -> PENDING_APPROVAL. Refused while any line is unpriced.
 *    approve()   -> APPROVED, by the Director. The sheet is frozen, and any
 *                earlier approved version of the style is SUPERSEDED.
 *    reject()    -> REJECTED with a reason; revise() makes the next version.
 *    revise()    copies any sheet into a new DRAFT version.
 *
 *  The trail entries go to approval_history, so the Director is notified
 *  when a sheet is submitted and merchandising when it is decided.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { nextNumber } from './documentNumber.service.js';
import { costSheet as computeSheet, costLine, marginAtPrice } from '../domain/costing.js';
import { assertNotSelfApproval } from '../domain/makerChecker.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const blank = (v) => v === undefined || v === null || v === '';

export const SORTABLE = ['costSheetNo', 'costDate', 'version', 'status', 'fobPrice', 'createdAt'];
const SEARCH = ['costSheetNo', 'remarks'];

const EDITABLE = new Set(['DRAFT', 'REJECTED']);

const INCLUDE = {
  style: { select: { id: true, styleNo: true, styleDescription: true, buyerId: true, buyer: { select: { buyerName: true } } } },
  order: { select: { id: true, orderNo: true } },
  lines: { orderBy: { lineNo: 'asc' } },
};

// ===========================================================================
//  RATES - where a suggested price comes from
// ===========================================================================

const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10).split('-').reverse().join('-') : '');

/**
 * The last price the company actually agreed for this material.
 *
 * An approved PO first - that is a rate somebody paid - and an approved
 * quotation after it. Matched on category, sub-category and accessory, which
 * is what identifies a material on every document in this system - and on the
 * variety when the line names one, since an 18L horn button is not priced like
 * a 24L plastic one. Returns null rather than guessing: an unpriced line is
 * visible, a wrong one is not.
 */
export async function suggestRate(line) {
  const match = {
    item: line.itemCategory,
    subCategory: line.subCategory ?? null,
    accessoriesItem: line.accessoriesItem ?? null,
    ...(line.accessoryType ? { accessoryType: line.accessoryType } : {}),
    deletedAt: null,
  };
  const po = await prisma.purchaseOrder.findFirst({
    where: { ...match, approvalStatus: 'APPROVED', uom: line.uom },
    orderBy: [{ approvedAt: 'desc' }, { poDate: 'desc' }],
    select: { poId: true, rate: true, poDate: true },
  });
  if (po) return { rate: D(po.rate), rateSource: `PO ${po.poId}, ${fmt(po.poDate)}` };

  const quote = await prisma.vendorQuotation.findFirst({
    where: { ...match, authorisationStatus: 'APPROVED', uom: line.uom },
    orderBy: [{ approvedAt: 'desc' }, { quotationDate: 'desc' }],
    select: { quotationNo: true, rateQuoted: true, quotationDate: true },
  });
  if (quote) return { rate: D(quote.rateQuoted), rateSource: `Quotation ${quote.quotationNo}, ${fmt(quote.quotationDate)}` };

  return { rate: null, rateSource: null };
}

// ===========================================================================
//  RECOMPUTE - the stored figures are always a function of the stored inputs
// ===========================================================================

function assertPercentages(sheet) {
  for (const f of ['overheadPct', 'rejectionPct', 'commissionPct', 'marginPct']) {
    const v = D(sheet[f]);
    if (v.isNegative() || v.greaterThanOrEqualTo(1)) {
      throw ApiError.badRequest('Percentages are fractions between 0 and 1 (0.08 = 8%)', { field: f });
    }
  }
  if (D(sheet.marginPct).plus(D(sheet.commissionPct)).greaterThanOrEqualTo(1)) {
    throw ApiError.badRequest('Margin and commission together must be less than 100% of the price', {
      field: 'marginPct',
    });
  }
  if (!D(sheet.exchangeRate).greaterThan(0)) {
    throw ApiError.badRequest('The exchange rate must be greater than zero', { field: 'exchangeRate' });
  }
}

async function recompute(tx, id) {
  const sheet = await tx.styleCostSheet.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
  const result = computeSheet(sheet, sheet.lines);
  for (const [i, line] of sheet.lines.entries()) {
    await tx.styleCostSheetLine.update({
      where: { id: line.id },
      data: { grossConsumption: result.lines[i].grossConsumption, amount: result.lines[i].amount },
    });
  }
  await tx.styleCostSheet.update({
    where: { id },
    data: {
      materialCost: result.materialCost,
      conversionCost: result.conversionCost,
      overheadAmount: result.overheadAmount,
      rejectionAmount: result.rejectionAmount,
      totalCost: result.totalCost,
      commissionAmount: result.commissionAmount,
      marginAmount: result.marginAmount,
      fobInr: result.fobInr,
      fobPrice: result.fobPrice,
      marginAtTarget: result.marginAtTarget,
    },
  });
  return result;
}

// ===========================================================================
//  PROJECTION AND QUERIES
// ===========================================================================

const s4 = (v) => (v === null || v === undefined ? null : D(v).toFixed(4));

function project(sheet) {
  if (!sheet) return sheet;
  const lines = sheet.lines ?? [];
  return {
    ...sheet,
    lines: lines.map((l) => ({
      ...l,
      consumption: s4(l.consumption),
      wastagePct: D(l.wastagePct).toFixed(6),
      grossConsumption: D(l.grossConsumption).toFixed(6),
      rate: s4(l.rate),
      amount: s4(l.amount),
    })),
    unpricedLines: lines.filter((l) => l.rate === null).length,
    editable: EDITABLE.has(sheet.status),
  };
}

export async function list(query) {
  const { skip, take, orderBy, search, styleId, orderId, status } = query;
  const where = {
    deletedAt: null,
    ...(styleId ? { styleId } : {}),
    ...(orderId ? { orderId } : {}),
    ...(status ? { status } : {}),
    ...searchFilter(search, SEARCH),
  };
  const [rows, total] = await Promise.all([
    prisma.styleCostSheet.findMany({
      where,
      orderBy,
      skip,
      take,
      include: { style: INCLUDE.style, order: INCLUDE.order },
    }),
    prisma.styleCostSheet.count({ where }),
  ]);
  return { rows: rows.map(project), total, page: query.page, pageSize: query.pageSize };
}

export async function getById(id) {
  const sheet = await prisma.styleCostSheet.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!sheet) throw ApiError.notFound('Cost sheet');
  const [approvals, versions] = await Promise.all([
    prisma.approvalHistory.findMany({
      where: { documentType: 'COST_SHEET', documentId: id },
      orderBy: { actedAt: 'asc' },
    }),
    prisma.styleCostSheet.findMany({
      where: { styleId: sheet.styleId, deletedAt: null },
      orderBy: { version: 'desc' },
      select: { id: true, costSheetNo: true, version: true, status: true, fobPrice: true, currency: true, costDate: true },
    }),
  ]);
  return { ...project(sheet), approvals, versions };
}

/** The approved sheet a style is currently sold against, or null. */
export async function currentApproved(styleId, client = prisma) {
  return client.styleCostSheet.findFirst({
    where: { styleId, status: 'APPROVED', deletedAt: null },
    orderBy: { version: 'desc' },
  });
}

/**
 * For the order screen: each line's margin at its agreed price, against the
 * style's approved sheet. Lines with no sheet or no price say so.
 */
export async function marginsForOrder(order) {
  const rate =
    String(order.currency ?? '').toUpperCase() === 'INR' ? '1' : order.exchangeRate ?? null;
  const out = [];
  for (const line of order.lines ?? []) {
    const sheet = await currentApproved(line.styleId);
    out.push({
      lineId: line.id,
      lineNo: line.lineNo,
      costSheet: sheet
        ? { id: sheet.id, costSheetNo: sheet.costSheetNo, version: sheet.version, fobPrice: s4(sheet.fobPrice), currency: sheet.currency, totalCost: s4(sheet.totalCost) }
        : null,
      margin: sheet
        ? marginAtPrice({
            unitPrice: line.unitPrice,
            exchangeRate: rate,
            totalCost: sheet.totalCost,
            commissionPct: sheet.commissionPct,
          })
        : null,
    });
  }
  return out;
}

// ===========================================================================
//  WRITES
// ===========================================================================

async function trail(client, sheet, action, { fromStatus, toStatus, actor, remarks }) {
  const previous = await client.approvalHistory.count({ where: { documentType: 'COST_SHEET', documentId: sheet.id } });
  await client.approvalHistory.create({
    data: {
      documentType: 'COST_SHEET',
      documentId: sheet.id,
      documentNo: sheet.costSheetNo,
      sequenceNo: previous + 1,
      action,
      fromStatus: fromStatus ?? null,
      toStatus: toStatus ?? null,
      actedByName: actor?.fullName ?? null,
      actedById: actor?.userId ?? null,
      remarks: remarks ?? null,
    },
  });
}

const HEADER_FIELDS = [
  'currency', 'exchangeRate', 'targetPrice', 'cmtCost', 'printCost', 'dyeWashCost', 'otherCost',
  'otherCostLabel', 'overheadPct', 'rejectionPct', 'commissionPct', 'marginPct', 'remarks',
];

function headerPatch(input) {
  const out = {};
  for (const f of HEADER_FIELDS) {
    if (input[f] === undefined) continue;
    if (['currency', 'otherCostLabel', 'remarks'].includes(f)) out[f] = input[f] || null;
    else if (f === 'targetPrice') out[f] = blank(input[f]) ? null : D(input[f]);
    else out[f] = D(input[f]);
  }
  if (out.currency === null) out.currency = 'USD';
  return out;
}

export async function create(input, actor) {
  const style = await prisma.style.findFirst({
    where: { id: input.styleId, deletedAt: null },
    include: { bomLines: { where: { deletedAt: null, isActive: true }, orderBy: { lineNo: 'asc' } } },
  });
  if (!style) throw ApiError.badRequest('Style does not exist', { field: 'styleId' });

  let order = null;
  if (input.orderId) {
    order = await prisma.buyerOrder.findFirst({ where: { id: input.orderId, deletedAt: null } });
    if (!order) throw ApiError.badRequest('Order does not exist', { field: 'orderId' });
  }

  const header = {
    currency: input.currency || order?.currency || 'USD',
    exchangeRate: blank(input.exchangeRate) ? D(order?.exchangeRate ?? 1) : D(input.exchangeRate),
    ...headerPatch({ ...input, currency: undefined, exchangeRate: undefined }),
  };
  assertPercentages({ overheadPct: 0, rejectionPct: 0, commissionPct: 0, marginPct: 0, ...header });

  const lines = [];
  for (const [i, b] of style.bomLines.entries()) {
    const suggested = await suggestRate(b);
    const { grossConsumption } = costLine({ consumption: b.avgUtilisationPerPiece, wastagePct: b.wastagePct });
    lines.push({
      lineNo: i + 1,
      bomLineNo: b.lineNo,
      itemCategory: b.itemCategory,
      subCategory: b.subCategory,
      accessoriesItem: b.accessoriesItem,
      accessoryType: b.accessoryType,
      colorCode: b.colorCode,
      description: b.description,
      uom: b.uom,
      consumption: D(b.avgUtilisationPerPiece),
      wastagePct: D(b.wastagePct),
      grossConsumption,
      rate: suggested.rate,
      rateSource: suggested.rateSource,
    });
  }

  const id = await prisma.$transaction(async (tx) => {
    const last = await tx.styleCostSheet.findFirst({
      where: { styleId: style.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const sheet = await tx.styleCostSheet.create({
      data: {
        costSheetNo: await nextNumber('COST_SHEET', { tx }),
        styleId: style.id,
        version: (last?.version ?? 0) + 1,
        orderId: order?.id ?? null,
        costDate: input.costDate ? new Date(input.costDate) : new Date(),
        status: 'DRAFT',
        ...header,
        lines: { create: lines },
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await recompute(tx, sheet.id);
    return sheet.id;
  });

  return getById(id);
}

/**
 * Prices a sheet. `lines` may update existing lines by id, add new ones
 * (no id), and `removeLineIds` drops hand-added or unwanted lines.
 */
export async function update(id, input, actor) {
  const sheet = await prisma.styleCostSheet.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
  if (!sheet) throw ApiError.notFound('Cost sheet');
  if (!EDITABLE.has(sheet.status)) {
    throw ApiError.conflict(
      `Cost sheet ${sheet.costSheetNo} is ${sheet.status.toLowerCase().replace('_', ' ')} and cannot be changed. ` +
        'Make a new version instead.',
    );
  }

  const patch = headerPatch(input);
  assertPercentages({ ...sheet, ...patch });

  const byId = new Map(sheet.lines.map((l) => [l.id, l]));
  await prisma.$transaction(async (tx) => {
    if (input.removeLineIds?.length) {
      await tx.styleCostSheetLine.deleteMany({ where: { costSheetId: id, id: { in: input.removeLineIds } } });
    }
    let nextLineNo = Math.max(0, ...sheet.lines.map((l) => l.lineNo)) + 1;
    for (const [i, l] of (input.lines ?? []).entries()) {
      const data = {
        ...(l.itemCategory !== undefined ? { itemCategory: l.itemCategory } : {}),
        ...(l.subCategory !== undefined ? { subCategory: l.subCategory || null } : {}),
        ...(l.accessoriesItem !== undefined ? { accessoriesItem: l.accessoriesItem || null } : {}),
        ...(l.accessoryType !== undefined ? { accessoryType: l.accessoryType || null } : {}),
        ...(l.description !== undefined ? { description: l.description || null } : {}),
        ...(l.uom !== undefined ? { uom: l.uom } : {}),
        ...(l.consumption !== undefined ? { consumption: D(l.consumption) } : {}),
        ...(l.wastagePct !== undefined ? { wastagePct: D(l.wastagePct) } : {}),
        ...(l.rate !== undefined
          ? { rate: blank(l.rate) ? null : D(l.rate), rateSource: blank(l.rate) ? null : l.rateSource || 'manual' }
          : {}),
      };
      if (l.id) {
        if (!byId.has(l.id)) throw ApiError.badRequest('That line is not on this sheet', { field: `lines.${i}.id` });
        await tx.styleCostSheetLine.update({ where: { id: l.id }, data });
      } else {
        if (!l.itemCategory || !l.uom || blank(l.consumption)) {
          throw ApiError.badRequest('A new line needs a category, a UOM and a consumption', { field: `lines.${i}` });
        }
        await tx.styleCostSheetLine.create({
          data: {
            costSheetId: id,
            lineNo: nextLineNo++,
            grossConsumption: 0,
            itemCategory: l.itemCategory,
            uom: l.uom,
            consumption: D(l.consumption),
            ...data,
          },
        });
      }
    }
    await tx.styleCostSheet.update({ where: { id }, data: { ...patch, updatedById: actor.userId } });
    await recompute(tx, id);
  });

  return getById(id);
}

export async function submit(id, { remarks } = {}, actor) {
  const sheet = await prisma.styleCostSheet.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
  if (!sheet) throw ApiError.notFound('Cost sheet');
  if (!EDITABLE.has(sheet.status)) throw ApiError.conflict(`Cost sheet ${sheet.costSheetNo} is already ${sheet.status.toLowerCase()}.`);
  const unpriced = sheet.lines.filter((l) => l.rate === null);
  if (unpriced.length) {
    throw ApiError.badRequest(
      `${unpriced.length} material line(s) have no rate: ` +
        unpriced.map((l) => l.description || l.accessoriesItem || l.subCategory || l.itemCategory).join(', ') +
        '. A sheet with an unpriced material would be quoted below cost.',
      { field: 'lines' },
    );
  }
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.styleCostSheet.updateMany({
      where: { id, status: sheet.status },
      data: { status: 'PENDING_APPROVAL', submittedAt: new Date(), rejectionReason: null, updatedById: actor.userId },
    });
    if (!count) throw ApiError.conflict('This sheet was changed a moment ago. Reload it.');
    await trail(tx, sheet, 'SUBMITTED', { fromStatus: sheet.status, toStatus: 'PENDING_APPROVAL', actor, remarks });
  });
  return getById(id);
}

export async function approve(id, { remarks } = {}, actor) {
  const sheet = await prisma.styleCostSheet.findFirst({ where: { id, deletedAt: null } });
  if (!sheet) throw ApiError.notFound('Cost sheet');
  if (sheet.status !== 'PENDING_APPROVAL') throw ApiError.conflict('Only a submitted sheet can be approved.');
  assertNotSelfApproval(sheet, actor, 'cost sheet');

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.styleCostSheet.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedById: actor.userId, approvedByName: actor.fullName, updatedById: actor.userId },
    });
    if (!count) throw ApiError.conflict('This sheet was decided by somebody else a moment ago.');
    // One approved costing per style at a time; the older one is history.
    await tx.styleCostSheet.updateMany({
      where: { styleId: sheet.styleId, status: 'APPROVED', id: { not: id } },
      data: { status: 'SUPERSEDED' },
    });
    await trail(tx, sheet, 'APPROVED', {
      fromStatus: 'PENDING_APPROVAL',
      toStatus: 'APPROVED',
      actor,
      remarks: remarks ?? `FOB ${D(sheet.fobPrice).toFixed(4)} ${sheet.currency}`,
    });
  });
  return getById(id);
}

export async function reject(id, { reason }, actor) {
  const sheet = await prisma.styleCostSheet.findFirst({ where: { id, deletedAt: null } });
  if (!sheet) throw ApiError.notFound('Cost sheet');
  if (sheet.status !== 'PENDING_APPROVAL') throw ApiError.conflict('Only a submitted sheet can be rejected.');
  await prisma.$transaction(async (tx) => {
    await tx.styleCostSheet.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason, updatedById: actor.userId },
    });
    await trail(tx, sheet, 'REJECTED', { fromStatus: 'PENDING_APPROVAL', toStatus: 'REJECTED', actor, remarks: reason });
  });
  return getById(id);
}

/** A new DRAFT version, copied from this one - rates and all. */
export async function revise(id, actor) {
  const sheet = await prisma.styleCostSheet.findFirst({ where: { id, deletedAt: null }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
  if (!sheet) throw ApiError.notFound('Cost sheet');

  const newId = await prisma.$transaction(async (tx) => {
    const last = await tx.styleCostSheet.findFirst({ where: { styleId: sheet.styleId }, orderBy: { version: 'desc' }, select: { version: true } });
    const copy = await tx.styleCostSheet.create({
      data: {
        costSheetNo: await nextNumber('COST_SHEET', { tx }),
        styleId: sheet.styleId,
        version: last.version + 1,
        orderId: sheet.orderId,
        costDate: new Date(),
        status: 'DRAFT',
        ...Object.fromEntries(HEADER_FIELDS.map((f) => [f, sheet[f]])),
        remarks: `Revised from ${sheet.costSheetNo} (v${sheet.version})`,
        lines: {
          create: sheet.lines.map((l) => ({
            lineNo: l.lineNo,
            bomLineNo: l.bomLineNo,
            itemCategory: l.itemCategory,
            subCategory: l.subCategory,
            accessoriesItem: l.accessoriesItem,
            accessoryType: l.accessoryType,
            colorCode: l.colorCode,
            description: l.description,
            uom: l.uom,
            consumption: l.consumption,
            wastagePct: l.wastagePct,
            grossConsumption: l.grossConsumption,
            rate: l.rate,
            rateSource: l.rateSource,
          })),
        },
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await recompute(tx, copy.id);
    return copy.id;
  });
  return getById(newId);
}

/** Refreshes every line's suggested rate from the latest approved PO / quotation. */
export async function refreshRates(id, actor) {
  const sheet = await prisma.styleCostSheet.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
  if (!sheet) throw ApiError.notFound('Cost sheet');
  if (!EDITABLE.has(sheet.status)) throw ApiError.conflict('Only a draft sheet can be re-priced.');
  const updates = [];
  for (const l of sheet.lines) {
    const s = await suggestRate(l);
    if (s.rate) updates.push({ id: l.id, rate: s.rate, rateSource: s.rateSource });
  }
  await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.styleCostSheetLine.update({ where: { id: u.id }, data: { rate: u.rate, rateSource: u.rateSource } });
    }
    await tx.styleCostSheet.update({ where: { id }, data: { updatedById: actor.userId } });
    await recompute(tx, id);
  });
  return getById(id);
}

export async function remove(id, actor) {
  const sheet = await prisma.styleCostSheet.findFirst({ where: { id, deletedAt: null } });
  if (!sheet) throw ApiError.notFound('Cost sheet');
  if (!EDITABLE.has(sheet.status)) throw ApiError.conflict('Only a draft or rejected sheet can be deleted.');
  await prisma.styleCostSheet.update({ where: { id }, data: { deletedAt: new Date(), deletedById: actor.userId } });
  return { deleted: true };
}
