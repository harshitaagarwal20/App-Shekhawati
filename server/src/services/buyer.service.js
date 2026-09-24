/**
 * Buyer Master. Sheet: "Buyer Master" (Role Acess - Head Office / Admin).
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { blockIfReferenced, makeCrud } from './crud.js';
import { assertValueInList } from './masterList.service.js';
import { OPTIONS_LIMIT } from '../utils/http.js';

export const SORTABLE = ['buyerCode', 'buyerName', 'country', 'status', 'createdAt'];
const SEARCH = ['buyerCode', 'buyerName', 'contactPerson', 'email', 'country', 'destination'];

/** Dropdown columns on this sheet and the list each reads from. */
const LIST_FIELDS = [
  ['country', 'Country'],
  ['currency', 'Currency'],
  ['shipMode', 'ShipMode'],
  ['paymentTerms', 'PaymentTerms'],
  ['freightTerms', 'FreightTerms'],
  ['priceTerms', 'PriceTerms'],
  ['finalDestination', 'Country'],
];

async function validateDropdowns(data) {
  for (const [field, listCode] of LIST_FIELDS) {
    if (data[field] === undefined) continue;
    if (field === 'finalDestination') continue; // free text in the workbook (uppercased country)
    await assertValueInList(listCode, data[field], { field });
  }
}

/**
 * The address book travels with the buyer on every detail read.
 *
 * Not on the LIST: a register of buyers is scanned for a name, and pulling
 * every address of every buyer to draw a table that shows none of them is a
 * join nobody reads.
 */
const INCLUDE = {
  addresses: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } },
};

const crud = makeCrud({
  model: 'buyer',
  label: 'Buyer',
  include: INCLUDE,
  searchFields: SEARCH,
  sortable: SORTABLE,
  defaultSort: 'buyerName',
  // The Buyers screen offers a country filter and the controller passes it
  // through; without this the service dropped it and the filter did nothing.
  extraFilters: (where, query) => (query.country ? { ...where, country: query.country } : where),
  assertDeletable: blockIfReferenced('Buyer', [
    { model: 'buyerOrder', field: 'buyerId', what: 'buyer order(s)' },
    { model: 'style', field: 'buyerId', what: 'style(s)' },
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

/**
 * Write the buyer's address book, replacing whatever was there.
 *
 * WHOLESALE, like the style's BOM, and for the same reason: an address is a
 * component of the buyer rather than a document of its own, and nothing holds
 * a reference to an address id - an order copies the TEXT onto itself at the
 * moment it is raised, so editing the book never rewrites a shipped order.
 *
 * Hard delete rather than soft, for that same reason. There is nothing to
 * preserve a tombstone for.
 */
async function writeAddresses(buyerId, addresses, actorId) {
  if (addresses === undefined) return;

  const rows = addresses
    .map((a) => ({
      label: a.label?.trim(),
      name: a.name?.trim() || null,
      address: a.address?.trim(),
      country: a.country?.trim() || null,
    }))
    // A row with no address is a line somebody started and abandoned, not an
    // instruction to store an empty destination.
    .filter((a) => a.label && a.address);

  await prisma.$transaction([
    prisma.buyerAddress.deleteMany({ where: { buyerId } }),
    prisma.buyerAddress.createMany({
      data: rows.map((a, i) => ({
        ...a,
        buyerId,
        lineNo: i + 1,
        createdById: actorId,
        updatedById: actorId,
      })),
    }),
  ]);
}

export async function create(input, actorId) {
  await validateDropdowns(input);
  // Taken as typed. The code used to be derived from the buyer's initials when
  // left blank, which meant a blank field produced a code nobody chose and
  // nobody recognised on a document. It is a master field the office types.
  const buyerCode = input.buyerCode.trim();

  // Case-insensitive: "ABC" and "abc" are the same code on paper, and the
  // unique index alone let both in.
  const clash = await prisma.buyer.findFirst({
    where: { buyerCode: { equals: buyerCode, mode: 'insensitive' } },
    select: { id: true },
  });
  if (clash) throw ApiError.conflict('This buyer code is already in use', { field: 'buyerCode' });

  const { addresses, ...header } = input;
  const row = await crud.create({ ...header, buyerCode }, actorId);
  if (addresses?.length) {
    await writeAddresses(row.id, addresses, actorId);
    return crud.getById(row.id);
  }
  return row;
}

export async function update(id, input, actorId) {
  await validateDropdowns(input);
  if (input.buyerCode) {
    const clash = await prisma.buyer.findFirst({
      where: { buyerCode: { equals: input.buyerCode.trim(), mode: 'insensitive' }, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict('This buyer code is already in use', { field: 'buyerCode' });
  }
  const { addresses, ...header } = input;
  const row = await crud.update(id, header, actorId);
  if (addresses !== undefined) {
    await writeAddresses(id, addresses, actorId);
    return crud.getById(id);
  }
  return row;
}

/** Minimal projection for the Buyer dropdown on Order / Style screens. */
export async function options() {
  const rows = await prisma.buyer.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    orderBy: { buyerName: 'asc' },
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      buyerCode: true,
      buyerName: true,
      currency: true,
      shipMode: true,
      paymentTerms: true,
      address: true,
      country: true,
      /*
       * The addresses an order can actually ship to.
       *
       * THREE NAMED ROLES, plus the book. Consignee and notify party are roles
       * on the shipping paperwork, not merely places, which is why they are
       * columns on the buyer and are named individually by the printed
       * documents, the import sheet and the export.
       *
       * `addresses` is everywhere else the buyer has had us send goods. Before
       * it existed the Ship To picker could only offer these three, so a
       * fourth destination was typed by hand on every order that used it and
       * remembered by nothing - and a retyped address is how a container ends
       * up at last season's warehouse.
       */
      consigneeName: true,
      consigneeAddress: true,
      notifyPartyName: true,
      notifyPartyAddress: true,
      addresses: {
        where: { deletedAt: null },
        orderBy: { lineNo: 'asc' },
        select: { id: true, label: true, name: true, address: true, country: true },
      },
    },
  });
  return rows;
}
