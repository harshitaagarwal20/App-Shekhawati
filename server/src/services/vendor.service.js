/**
 * Vendor Master. Sheet: "Vendor Master" (Role Acess - Head Office / Admin).
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { blockIfReferenced, makeCrud } from './crud.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber } from './documentNumber.service.js';
import { OPTIONS_LIMIT } from '../utils/http.js';

export const SORTABLE = ['vendorCode', 'vendorName', 'category', 'status', 'createdAt'];
const SEARCH = ['vendorCode', 'vendorName', 'contactPerson', 'email', 'gstNo', 'category', 'city', 'vendorLocation'];

/**
 * PO initials, per the PO sheet note "Vendor initial + no":
 * Rajasthan Fabrics -> RF -> RF-001.
 */
export function suggestPoInitials(vendorName) {
  const words = vendorName.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const letters = words.map((w) => w[0]).join('').toUpperCase();
  return (letters.length >= 2 ? letters.slice(0, 2) : (vendorName.slice(0, 2) || 'VN').toUpperCase());
}

async function validateDropdowns(data) {
  if (data.category !== undefined) {
    await assertValueInList('VendorCategory', data.category, { field: 'category', required: true });
  }
}

const crud = makeCrud({
  model: 'vendor',
  label: 'Vendor',
  searchFields: SEARCH,
  sortable: SORTABLE,
  defaultSort: 'vendorName',
  extraFilters: (where, query) => (query.category ? { ...where, category: query.category } : where),
  assertDeletable: blockIfReferenced('Vendor', [
    { model: 'purchaseOrder', field: 'vendorId', what: 'purchase order(s)' },
    { model: 'vendorQuotation', field: 'vendorId', what: 'quotation(s)' },
    { model: 'grn', field: 'vendorId', what: 'GRN(s)' },
    { model: 'dyeIssue', field: 'vendorId', what: 'dye/job-work issue(s)' },
    { model: 'printing', field: 'vendorId', what: 'printing record(s)' },
  ]),
});

/*
 * The dropdown check, reachable from outside.
 *
 * Master List membership is checked HERE rather than in the zod schema, on
 * purpose: list content is data, not code, and a value added this morning must
 * be accepted this afternoon without a redeploy. The consequence is that a
 * schema alone cannot tell whether a row is importable - so the bulk importer
 * calls this same function during its check pass, and a file with a mistyped
 * category is refused before anything is written rather than failing halfway
 * through. See services/import.service.js.
 */
export { validateDropdowns as assertDropdowns };

export const list = crud.list;
export const getById = crud.getById;
export const setStatus = crud.setStatus;
export const remove = crud.remove;
export const restore = crud.restore;

export async function create(input, actorId) {
  await validateDropdowns(input);

  const vendorCode = input.vendorCode?.trim() || (await nextNumber('VENDOR'));
  const clash = await prisma.vendor.findUnique({ where: { vendorCode }, select: { id: true } });
  if (clash) throw ApiError.conflict('This vendor code is already in use', { field: 'vendorCode' });

  const poInitials = input.poInitials?.trim().toUpperCase() || suggestPoInitials(input.vendorName);

  const vendor = await crud.create({ ...input, vendorCode, poInitials }, actorId);

  // Every vendor needs its own PO counter, because PO IDs are
  // "vendor initial + no" and each vendor's series is independent.
  await ensurePoSequence(poInitials);

  return vendor;
}

export async function update(id, input, actorId) {
  await validateDropdowns(input);

  if (input.vendorCode) {
    const clash = await prisma.vendor.findFirst({
      where: { vendorCode: input.vendorCode, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict('This vendor code is already in use', { field: 'vendorCode' });
  }

  if (input.poInitials) {
    input.poInitials = input.poInitials.trim().toUpperCase();
    await ensurePoSequence(input.poInitials);
  }

  return crud.update(id, input, actorId);
}

async function ensurePoSequence(scopeKey) {
  await prisma.documentSequence.upsert({
    where: { documentType_scopeKey: { documentType: 'PURCHASE_ORDER', scopeKey } },
    update: {},
    create: {
      documentType: 'PURCHASE_ORDER',
      scopeKey,
      prefix: scopeKey,
      separator: '-',
      padLength: 3,
      nextNumber: 1,
      description: `PO series for vendor initials ${scopeKey}`,
    },
  });
}

/** Vendor dropdown, optionally narrowed to a category (Dyeing, Printing, ...). */
export async function options({ category } = {}) {
  return prisma.vendor.findMany({
    where: { deletedAt: null, status: 'ACTIVE', ...(category ? { category } : {}) },
    orderBy: { vendorName: 'asc' },
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      vendorCode: true,
      vendorName: true,
      category: true,
      address: true,
      pinCode: true,
      gstNo: true,
      poInitials: true,
    },
  });
}
