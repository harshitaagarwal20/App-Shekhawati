/**
 * Opening stock - what was already on the rack the day this system started.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS IS NOT A GRN, AND NOT A MASTER IMPORT
 * ---------------------------------------------------------------------------
 *
 *  Fabric otherwise enters only through a GRN posted against a purchase order.
 *  That is right for everything bought from now on and useless for the cloth
 *  already in the store: there is no order for it, and inventing one would put
 *  a receipt in the books against a vendor who never sent it, at a rate nobody
 *  paid - and that invented rate would then be the FIFO cost of the first
 *  thousand metres the factory cuts.
 *
 *  Nor does it belong in MASTER_IMPORTS. That framework upserts a master
 *  record by identity: run it twice and the second run updates what the first
 *  created. Stock does not work that way. Running an opening balance twice
 *  does not correct it, it DOUBLES it, and a stock movement has no identity to
 *  update. So this is its own path, with its own guard.
 *
 * ---------------------------------------------------------------------------
 *  THE GUARD: ONE OPENING BALANCE PER ITEM, EVER
 * ---------------------------------------------------------------------------
 *
 *  An opening balance is by definition the first thing that ever happened to
 *  an item. `apply()` refuses a row whose item already carries an
 *  OPENING_BALANCE ledger entry - so a file posted twice, a browser retry or
 *  two people loading the same spreadsheet cannot double the inventory.
 *
 *  It is deliberately narrow. Adding a colour the company did not hold at
 *  go-live is a different item and is allowed. Correcting a quantity loaded
 *  wrong is NOT done here: once stock has been issued against, it cannot be
 *  edited away, and the ledger is what records the correction.
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { nextNumber } from './documentNumber.service.js';
import { assertValueInList } from './masterList.service.js';
import {
  createRoll,
  describeItem,
  itemIdentity,
  postMovement,
  resolveOrCreateItem,
} from './inventory.service.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

const DEFAULT_LOCATION = 'MAIN STORE';
/** Opening stock is cloth and trims on a rack, not work in progress. */
const DEFAULT_CATEGORY = 'Fabric';

/** Values that have to exist in the List Masters before a row can be posted. */
const LIST_FIELDS = [
  ['itemCategory', 'ItemCategory'],
  ['subCategory', 'FabricSubCat'],
  ['colorCode', 'ColorCode'],
  ['uom', 'UOM'],
  ['gsm', 'GSM'],
];

/**
 * One row of the sheet, normalised.
 *
 * The spreadsheet the office keeps has three columns - Fabric Type, COLOR,
 * Qty mtr. - so everything else carries a default rather than being required.
 *
 * `subCategory` is where the fabric weight lives (10OZ, 12OZ), which is the
 * same column a purchase order uses. That matters more than it looks: an item
 * created here must be THE SAME item a later PO for 10OZ Black resolves to,
 * or the first receipt would sit beside the opening stock instead of adding
 * to it, and the store would hold one cloth under two codes.
 */
function normaliseRow(raw, i) {
  const at = (field) => ({ field: `rows.${i}.${field}` });

  const subCategory = String(raw.subCategory ?? raw.fabricType ?? '').trim();
  const colorCode = String(raw.colorCode ?? raw.color ?? '').trim();
  const qty = D(raw.qty ?? 0);

  if (!subCategory) throw ApiError.badRequest('Fabric type is required', at('subCategory'));
  if (!colorCode) throw ApiError.badRequest('Colour is required', at('colorCode'));
  if (!qty.greaterThan(0)) {
    throw ApiError.badRequest(
      `Quantity for ${subCategory} / ${colorCode} must be greater than zero`,
      at('qty'),
    );
  }

  return {
    lineNo: i + 1,
    itemCategory: String(raw.itemCategory ?? DEFAULT_CATEGORY).trim(),
    subCategory,
    colorCode,
    gsm: raw.gsm ? String(raw.gsm).trim() : null,
    content: raw.content ? String(raw.content).trim() : null,
    count: raw.count ? String(raw.count).trim() : null,
    width: raw.width !== null && raw.width !== undefined && raw.width !== '' ? D(raw.width) : null,
    uom: String(raw.uom ?? 'Mtrs').trim(),
    qty,
    /**
     * The rate opening stock is carried at.
     *
     * Zero is permitted and is NOT a mistake. A company that cannot say what
     * the cloth on its rack cost is better served by a stock figure valued at
     * nothing than by a number somebody invented to fill the box. What it must
     * not do is quietly become the FIFO cost of the first issue with nobody
     * having noticed - which is why preview() counts the unvalued rows and
     * says so.
     */
    rate: raw.rate !== null && raw.rate !== undefined && raw.rate !== '' ? D(raw.rate) : ZERO,
    rollNo: raw.rollNo ? String(raw.rollNo).trim() : null,
    location: String(raw.location ?? DEFAULT_LOCATION).trim(),
    remarks: raw.remarks ? String(raw.remarks).trim() : null,
  };
}

/** The dropdown values a row depends on, checked before anything is written. */
async function assertRowDropdowns(row) {
  for (const [field, listCode] of LIST_FIELDS) {
    const value = row[field];
    if (value === null || value === undefined || value === '') continue;
    await assertValueInList(listCode, value, { field });
  }
}

/** Has this item already had an opening balance posted against it? */
async function openingAlreadyPosted(tx, itemId) {
  return tx.stockLedger.findFirst({
    where: { itemId, documentType: 'OPENING_BALANCE' },
    select: { id: true, documentNo: true, entryDate: true, qty: true },
  });
}

/**
 * What the file WOULD do, worked out without writing anything.
 *
 * Every refusal `apply()` would make is made here too, so the office sees the
 * whole list of problems at once rather than discovering them one posting at a
 * time. Nothing here opens a transaction or creates an item.
 */
export async function preview(rows) {
  const normalised = (rows ?? []).map(normaliseRow);

  const seen = new Map();
  const lines = [];
  let total = ZERO;
  let valued = ZERO;

  for (const row of normalised) {
    const problems = [];

    try {
      await assertRowDropdowns(row);
    } catch (err) {
      problems.push(err.message);
    }

    const identity = itemIdentity(row);
    const key = JSON.stringify(identity);

    // Two rows for the same cloth are one stock figure. Posting both would
    // leave the second refused by the guard after the first had committed.
    if (seen.has(key)) {
      problems.push(`Same fabric and colour as line ${seen.get(key)}. Combine them into one row.`);
    } else {
      seen.set(key, row.lineNo);
    }

    const item = await prisma.inventoryItem.findUnique({
      where: { inventory_item_identity: identity },
      select: { id: true, itemCode: true, deletedAt: true },
    });

    if (item?.deletedAt) {
      problems.push(`Inventory item ${item.itemCode} has been deleted. Restore it first.`);
    } else if (item) {
      const existingOpening = await openingAlreadyPosted(prisma, item.id);
      if (existingOpening) {
        problems.push(
          `Opening stock was already posted for this item on ${existingOpening.documentNo}. ` +
            'Posting it again would double the quantity.',
        );
      }
    }

    total = total.plus(row.qty);
    valued = valued.plus(row.qty.mul(row.rate));

    lines.push({
      lineNo: row.lineNo,
      description: describeItem(row),
      subCategory: row.subCategory,
      colorCode: row.colorCode,
      uom: row.uom,
      qty: row.qty.toFixed(4),
      rate: row.rate.toFixed(4),
      value: row.qty.mul(row.rate).toDecimalPlaces(2).toFixed(2),
      location: row.location,
      /** Null when this is the first time the company has held this cloth. */
      itemCode: item && !item.deletedAt ? item.itemCode : null,
      newItem: !item || Boolean(item.deletedAt),
      problems,
    });
  }

  const blocked = lines.filter((l) => l.problems.length);

  return {
    lines,
    totals: {
      rows: lines.length,
      qty: total.toFixed(4),
      value: valued.toDecimalPlaces(2).toFixed(2),
      newItems: lines.filter((l) => l.newItem && !l.problems.length).length,
    },
    /** Nothing posts at all while any row is refused - see apply(). */
    canApply: lines.length > 0 && blocked.length === 0,
    blockedCount: blocked.length,
    unvalued: lines.filter((l) => Number(l.rate) === 0).length,
  };
}

/**
 * Posts the opening stock.
 *
 * ONE TRANSACTION FOR THE WHOLE FILE. A part-posted opening balance is the
 * worst outcome available here: the office cannot tell which rows went in
 * without reading the ledger, and re-running is then refused for exactly the
 * rows that succeeded. So one bad row refuses the file and nothing is written.
 */
export async function apply(rows, actor = {}) {
  const normalised = (rows ?? []).map(normaliseRow);
  if (!normalised.length) {
    throw ApiError.badRequest('There is nothing to post', { field: 'rows' });
  }

  for (const row of normalised) await assertRowDropdowns(row);

  return prisma.$transaction(
    async (tx) => {
      const documentNo = await nextNumber('OPENING_BALANCE', { tx });
      const entryDate = new Date();
      const posted = [];

      for (const row of normalised) {
        const { item } = await resolveOrCreateItem(tx, row, actor.userId);

        const already = await openingAlreadyPosted(tx, item.id);
        if (already) {
          throw ApiError.conflict(
            `Opening stock for ${describeItem(row)} was already posted on ` +
              `${already.documentNo}. Posting it again would double the quantity.`,
            { field: `rows.${row.lineNo - 1}.qty`, documentNo: already.documentNo },
          );
        }

        /*
         * A ROLL, because fabric in this system is tracked as rolls.
         *
         * Everything downstream - fabric issue, job work, cutting - works on a
         * roll, so opening stock that posted only a ledger balance would be
         * stock nobody could issue. One roll per row: the office sheet says
         * "5987 metres of 10OZ Natural", not how many pieces that is, and a
         * roll count invented here would be invented data. A roll can be split
         * later; it cannot be un-invented.
         */
        const roll = await createRoll(
          tx,
          {
            rollNo: row.rollNo,
            inventoryItemId: item.id,
            fabricName: describeItem(row),
            colorCode: row.colorCode,
            content: row.content,
            count: row.count,
            width: row.width,
            gsm: row.gsm,
            uom: row.uom,
            qty: row.qty,
            rate: row.rate,
            location: row.location,
            remarks: row.remarks ?? `Opening stock, ${documentNo}`,
          },
          actor.userId,
        );

        await postMovement(tx, {
          itemId: item.id,
          rollId: roll.id,
          direction: 'IN',
          qty: row.qty,
          rate: row.rate,
          entryDate,
          location: row.location,
          documentType: 'OPENING_BALANCE',
          // The roll IS the document here: there is no receipt behind an
          // opening balance, and the ledger row has to point somewhere real.
          documentId: roll.id,
          documentNo,
          snapshot: {
            itemCategory: row.itemCategory,
            colorCode: row.colorCode,
            gsm: row.gsm,
            content: row.content,
            uom: row.uom,
          },
          remarks:
            `Opening stock at go-live${row.rate.isZero() ? ', carried at no value' : ''}` +
            `${row.remarks ? ` - ${row.remarks}` : ''}`,
          actor,
        });

        posted.push({
          lineNo: row.lineNo,
          itemCode: item.itemCode,
          rollNo: roll.rollNo,
          description: describeItem(row),
          qty: row.qty.toFixed(4),
          uom: row.uom,
          location: row.location,
        });
      }

      return {
        documentNo,
        entryDate,
        rows: posted,
        totalQty: normalised.reduce((a, r) => a.plus(r.qty), ZERO).toFixed(4),
      };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
}
