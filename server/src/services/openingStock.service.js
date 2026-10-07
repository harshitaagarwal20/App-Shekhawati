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
import { subCategoryListFor } from '../domain/itemCategory.js';
import {
  createRoll,
  describeFabricName,
  describeItem,
  isRollTrackedCategory,
  itemIdentity,
  lockItemLocation,
  postMovement,
  resolveOrCreateItem,
} from './inventory.service.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

const DEFAULT_LOCATION = 'MAIN STORE';
/** Opening stock is cloth and trims on a rack, not work in progress. */
const DEFAULT_CATEGORY = 'Fabric';

/**
 * Values that have to exist in the List Masters before a row can be posted.
 *
 * `subCategory` is absent because the list it must belong to depends on the
 * item - a fabric weight from L_FabricSubCat, a stationery article from
 * L_StationeryItem - and `subCategoryListFor()` is what decides. See
 * `assertRowDropdowns()`.
 *
 * `accessoryType` is absent for a different reason: a purchase order carries
 * it as FREE TEXT, and a value refused here that a PO accepts would mean the
 * trim could be ordered but not loaded.
 */
const LIST_FIELDS = [
  ['itemCategory', 'ItemCategory'],
  ['accessoriesItem', 'AccessoriesItem'],
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

  const itemCategory = String(raw.itemCategory ?? DEFAULT_CATEGORY).trim();
  const subCategory = String(raw.subCategory ?? raw.fabricType ?? '').trim();
  const colorCode = String(raw.colorCode ?? raw.color ?? '').trim();
  const accessoriesItem = String(raw.accessoriesItem ?? '').trim();
  const accessoryType = String(raw.accessoryType ?? '').trim();
  const qty = D(raw.qty ?? 0);

  /*
   * WHAT A ROW MUST CARRY DEPENDS ON WHAT IT IS.
   *
   * Cloth is identified by its weight and colour, and the office sheet has
   * both. A trim is identified by the accessories item - "Button", "Zip" -
   * and has no weight at all, so demanding a fabric type of it would be
   * demanding a value somebody has to invent.
   *
   * UOM IS REQUIRED FOR A TRIM, and that is the important one. It is part of
   * the item's identity, so a button loaded in Pcs and later ordered in Gross
   * is TWO items: the opening stock would sit beside the first receipt instead
   * of adding to it, and the store would hold one button under two codes.
   * Metres is a safe default for cloth; there is no safe default between Pcs,
   * Gross and Dozen, so the row has to say.
   */
  const rollTracked = isRollTrackedCategory(itemCategory);

  if (rollTracked) {
    if (!subCategory) throw ApiError.badRequest('Fabric type is required', at('subCategory'));
    if (!colorCode) throw ApiError.badRequest('Colour is required', at('colorCode'));
  } else {
    if (!accessoriesItem) {
      throw ApiError.badRequest(
        `${itemCategory} needs an accessories item - the trim itself, as a purchase order names it.`,
        at('accessoriesItem'),
      );
    }
    if (!String(raw.uom ?? '').trim()) {
      throw ApiError.badRequest(
        `UOM is required for ${accessoriesItem}. It is part of the item's identity, so the same ` +
          'trim loaded in one unit and ordered in another becomes two separate stock items.',
        at('uom'),
      );
    }
  }

  if (!qty.greaterThan(0)) {
    const what = rollTracked ? `${subCategory} / ${colorCode}` : accessoriesItem;
    throw ApiError.badRequest(`Quantity for ${what} must be greater than zero`, at('qty'));
  }

  return {
    lineNo: i + 1,
    itemCategory,
    subCategory,
    colorCode,
    accessoriesItem,
    accessoryType,
    /** Decided once, here, so nothing downstream re-derives it per branch. */
    rollTracked,
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

  /*
   * Sub-category follows the item, exactly as it does on a purchase order
   * line: a fabric weight from L_FabricSubCat, a stationery article from
   * L_StationeryItem. Checking it against the fabric list regardless - which
   * is what the flat table above used to do - refused every stationery row
   * and every trim that carried one.
   */
  if (row.subCategory) {
    await assertValueInList(subCategoryListFor(row.itemCategory), row.subCategory, {
      field: 'subCategory',
    });
  }
}

/**
 * Has this item already had an opening balance posted against it?
 *
 * Checked against the ROLL, not merely against a ledger row existing: once
 * `reverse()` below write off a wrong entry, its IN row stays on the ledger
 * forever (nothing here erases history) but the roll it financed is gone. An
 * item whose only opening balance has been reversed is exactly an item that
 * has never successfully carried one - so it is clear to load again.
 */
async function openingAlreadyPosted(tx, itemId, { rollTracked = true } = {}) {
  if (rollTracked) {
    return tx.stockLedger.findFirst({
      where: { itemId, documentType: 'OPENING_BALANCE', direction: 'IN', roll: { deletedAt: null } },
      select: { id: true, documentNo: true, entryDate: true, qty: true },
    });
  }

  /*
   * BULK STOCK HAS NO ROLL TO HAVE BEEN WRITTEN OFF, so the reversal marks
   * itself instead: `reverseEntry()` posts its OUT with `documentId` set to
   * the id of the IN row it undoes. An opening balance is live while no such
   * OUT points at it.
   *
   * Counting net quantity instead would be wrong in both directions - a
   * partly issued balance would still be live, and one fully issued would
   * read as never posted and let the whole figure be loaded a second time.
   */
  const ins = await tx.stockLedger.findMany({
    where: { itemId, documentType: 'OPENING_BALANCE', direction: 'IN', rollId: null },
    select: { id: true, documentNo: true, entryDate: true, qty: true },
    orderBy: { entryDate: 'asc' },
  });
  if (!ins.length) return null;

  const reversed = await tx.stockLedger.findMany({
    where: {
      itemId,
      documentType: 'OPENING_BALANCE',
      direction: 'OUT',
      documentId: { in: ins.map((r) => r.id) },
    },
    select: { documentId: true },
  });
  const undone = new Set(reversed.map((r) => r.documentId));

  return ins.find((r) => !undone.has(r.id)) ?? null;
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
      const existingOpening = await openingAlreadyPosted(prisma, item.id, {
        rollTracked: row.rollTracked,
      });
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

        const already = await openingAlreadyPosted(tx, item.id, { rollTracked: row.rollTracked });
        if (already) {
          throw ApiError.conflict(
            `Opening stock for ${describeItem(row)} was already posted on ` +
              `${already.documentNo}. Posting it again would double the quantity.`,
            { field: `rows.${row.lineNo - 1}.qty`, documentNo: already.documentNo },
          );
        }

        /*
         * A ROLL FOR CLOTH, A PLAIN BALANCE FOR A TRIM.
         *
         * Fabric is tracked roll by roll and everything downstream of it -
         * fabric issue, job work, cutting - works on a roll, so cloth posted
         * as a bare ledger balance would be stock nobody could issue. One roll
         * per row: the office sheet says "5987 metres of 10OZ Natural", not
         * how many pieces that is, and a roll count invented here would be
         * invented data. A roll can be split later; it cannot be un-invented.
         *
         * Buttons and zips are the opposite case. They are counted in bulk off
         * a balance and no screen in this application asks which roll a button
         * came off - inventing a "roll" of 5000 buttons would put a fabric
         * record in the way of every accessory issue, and `isRollTracked` on
         * the item says plainly that it does not belong there.
         */
        const roll = !row.rollTracked ? null : await createRoll(
          tx,
          {
            rollNo: row.rollNo,
            inventoryItemId: item.id,
            fabricName: describeFabricName(row),
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
          rollId: roll?.id ?? null,
          direction: 'IN',
          qty: row.qty,
          rate: row.rate,
          entryDate,
          location: row.location,
          documentType: 'OPENING_BALANCE',
          /*
           * `documentId` is NOT NULL, and there is no receipt behind an opening
           * balance for it to point at. For cloth the roll is the document -
           * it is the thing that was created and the thing a reversal writes
           * off. A trim has no roll, so the ITEM is what the balance is about
           * and what the row points at.
           */
          documentId: roll?.id ?? item.id,
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
          /** Null for a trim, which is held in bulk and has no roll. */
          rollNo: roll?.rollNo ?? null,
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

/**
 * Undoes one roll an opening balance wrongly created - a fabric type keyed
 * wrong, a colour pasted into the wrong column, a figure tried out while
 * learning the screen.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS EXISTS AND WHAT IT DELIBERATELY DOES NOT DO
 *
 *  `apply()`'s own guard means a wrong row cannot be fixed by posting a
 *  correction over it - the item already carries an opening balance - and
 *  until now there was no way back from that at all except editing the
 *  database by hand. This gives the office the one way back the design
 *  always implied: take the wrong roll back OUT, the same way every other
 *  correction in this system is made, by posting the reversing movement
 *  rather than erasing the one that was wrong.
 *
 *  It reverses ONE ROLL, not a whole file. A paste of forty rows is forty
 *  independent opening balances the moment they are posted - the thing being
 *  undone is "this fabric and colour were loaded wrong", and that is a
 *  property of one roll, not of the batch it happened to arrive in.
 *
 *  It is narrow on purpose. A roll that has been issued, held, relocated
 *  under a different balance, or graded differently from how it was created
 *  is no longer simply "the opening balance, entered wrong" - something has
 *  happened since that this function is not the place to unwind. The same
 *  restraint `apply()` itself takes with a quantity loaded wrong: once stock
 *  has moved, the ledger is what records the correction, not an edit.
 * ---------------------------------------------------------------------------
 */
export async function reverse(rollId, { reason } = {}, actor = {}) {
  if (!reason?.trim()) {
    throw ApiError.badRequest('A reason is required to reverse an opening balance.', { field: 'reason' });
  }

  return prisma.$transaction(async (tx) => {
    /*
     * THE LOCK BEFORE THE READ.
     *
     * F-03's lesson again: without it, a fabric issue committing between this
     * transaction's read of the balance and its write could take cloth out
     * from under a reversal that had already decided the roll was untouched.
     */
    await tx.$executeRaw`SELECT id FROM fabric_rolls WHERE id = ${rollId}::uuid FOR UPDATE`;

    const roll = await tx.fabricRoll.findFirst({
      where: { id: rollId, deletedAt: null },
      select: {
        id: true, rollNo: true, inventoryItemId: true, location: true, rate: true,
        receivedQty: true, balanceQty: true, isHeld: true, uom: true,
        colorCode: true, content: true, gsm: true,
      },
    });
    if (!roll) throw ApiError.notFound('Fabric roll');

    const opening = await tx.stockLedger.findFirst({
      where: { rollId, documentType: 'OPENING_BALANCE', direction: 'IN' },
      select: { id: true, documentNo: true, itemCategory: true },
    });
    if (!opening) {
      throw ApiError.badRequest(
        `${roll.rollNo} was not created by an opening balance. A roll received on a GRN is ` +
          'undone through GRN Reversal, not here.',
      );
    }

    if (roll.isHeld) {
      throw ApiError.conflict(`${roll.rollNo} is held. Lift the hold before reversing it.`);
    }
    if (!D(roll.balanceQty).equals(D(roll.receivedQty))) {
      throw ApiError.conflict(
        `${roll.rollNo} has already moved - ${D(roll.receivedQty).minus(D(roll.balanceQty)).toFixed(4)} ` +
          `${roll.uom} issued against it since it was loaded. An opening balance can only be reversed ` +
          'while every metre of it is still exactly where it was posted.',
      );
    }

    const at = new Date();

    await postMovement(tx, {
      itemId: roll.inventoryItemId,
      rollId: roll.id,
      direction: 'OUT',
      qty: D(roll.balanceQty),
      rate: roll.rate,
      entryDate: at,
      location: roll.location,
      // This roll's own receipt, not the shared FIFO pool for the item: other
      // rolls of the same fabric must not have their cost layers touched by
      // undoing a mistake that was never theirs.
      preferSourceLedgerIds: [opening.id],
      documentType: 'OPENING_BALANCE',
      documentId: roll.id,
      documentNo: opening.documentNo,
      snapshot: {
        itemCategory: opening.itemCategory,
        colorCode: roll.colorCode,
        gsm: roll.gsm,
        content: roll.content,
        uom: roll.uom,
      },
      remarks: `Opening balance reversed - entered in error. ${reason.trim()}`,
      actor,
    });

    /*
     * Written off, not merely emptied - the same two stamps GRN Reversal
     * leaves on a roll it takes back out, and for the same reason: the soft
     * delete removes it from every live-roll query, and `writtenOffAt` frees
     * its number because the mistake was in the data, not on the rack - there
     * is no physical roll this label still belongs to.
     */
    await tx.fabricRoll.update({
      where: { id: roll.id },
      data: {
        balanceQty: { decrement: D(roll.balanceQty) },
        deletedAt: at,
        deletedById: actor.userId ?? null,
        writtenOffAt: at,
        updatedById: actor.userId ?? null,
        remarks: `Reversed: ${reason.trim()}`,
      },
    });

    return { rollNo: roll.rollNo, qty: D(roll.balanceQty).toFixed(4), uom: roll.uom };
  });
}

/**
 * The same, for stock held in BULK - a trim loaded wrong.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS IS A SECOND FUNCTION RATHER THAN A BRANCH IN `reverse()`
 *
 *  `reverse()` is keyed on a roll because for cloth the roll IS the opening
 *  balance: it is what was created, what gets written off, and what the screens
 *  give the office to select. A button has no roll. What identifies "these five
 *  thousand buttons, loaded wrong" is the LEDGER ROW the opening balance wrote,
 *  so that is what this takes.
 *
 *  THE "UNTOUCHED" TEST IS THE COST LAYER, NOT THE BALANCE.
 *
 *  `reverse()` can ask whether the roll still holds every metre it arrived
 *  with. Bulk stock has no such handle: the item's balance may have risen on a
 *  GRN since and fallen again on an issue, so a balance that happens to equal
 *  the opening figure proves nothing about whether the opening stock itself was
 *  consumed. The FIFO layer this very ledger row opened does prove it - while
 *  its `qtyRemaining` still equals its `qtyIn`, not one unit of THIS opening
 *  balance has been issued, whatever else has happened to the item. It is the
 *  same question `reverse()` asks, put to the thing that can answer it here.
 * ---------------------------------------------------------------------------
 */
export async function reverseEntry(ledgerId, { reason } = {}, actor = {}) {
  if (!reason?.trim()) {
    throw ApiError.badRequest('A reason is required to reverse an opening balance.', {
      field: 'reason',
    });
  }

  return prisma.$transaction(async (tx) => {
    const opening = await tx.stockLedger.findFirst({
      where: { id: ledgerId, documentType: 'OPENING_BALANCE', direction: 'IN' },
      select: {
        id: true, itemId: true, location: true, rate: true, rollId: true, documentNo: true,
        itemCategory: true, colorCode: true, gsm: true, content: true, uom: true,
        item: { select: { itemCode: true, description: true } },
      },
    });
    if (!opening) throw ApiError.notFound('Opening balance entry');

    if (opening.rollId) {
      throw ApiError.badRequest(
        `${opening.item.itemCode} is tracked roll by roll. Reverse it through the roll the opening ` +
          'balance created, not through its ledger entry.',
      );
    }

    /*
     * THE LOCK BEFORE THE READ - the ordering `reverse()` takes with its
     * `FOR UPDATE` on the roll. Without it an issue committing between the
     * layer test below and the posting could consume the very layer this
     * reversal had just decided was untouched, and the OUT would fall through
     * to FIFO order and take somebody else's cost.
     */
    await lockItemLocation(tx, opening.itemId, opening.location);

    const alreadyReversed = await tx.stockLedger.findFirst({
      where: {
        itemId: opening.itemId,
        documentType: 'OPENING_BALANCE',
        direction: 'OUT',
        documentId: opening.id,
      },
      select: { id: true },
    });
    if (alreadyReversed) {
      throw ApiError.conflict(
        `The opening balance for ${opening.item.itemCode} on ${opening.documentNo} has already ` +
          'been reversed.',
      );
    }

    const layer = await tx.stockCostLayer.findFirst({
      where: { sourceLedgerId: opening.id },
      select: { qtyIn: true, qtyRemaining: true },
    });
    if (!layer) {
      throw ApiError.conflict(
        `No cost layer remains for the opening balance of ${opening.item.itemCode}, so there is ` +
          'nothing of it left to take back out.',
      );
    }
    if (!D(layer.qtyRemaining).equals(D(layer.qtyIn))) {
      throw ApiError.conflict(
        `${opening.item.itemCode} has already moved - ` +
          `${D(layer.qtyIn).minus(D(layer.qtyRemaining)).toFixed(4)} ${opening.uom} issued against ` +
          'this opening balance since it was loaded. An opening balance can only be reversed while ' +
          'every unit of it is still exactly where it was posted.',
      );
    }

    const qty = D(layer.qtyRemaining);

    await postMovement(tx, {
      itemId: opening.itemId,
      direction: 'OUT',
      qty,
      rate: opening.rate,
      entryDate: new Date(),
      location: opening.location,
      // This balance's own layer, not the shared FIFO pool for the item: stock
      // of the same trim received since must not be costed away by undoing a
      // mistake that was never its.
      preferSourceLedgerIds: [opening.id],
      documentType: 'OPENING_BALANCE',
      /** The IN row this undoes - what makes the reversal findable again. */
      documentId: opening.id,
      documentNo: opening.documentNo,
      snapshot: {
        itemCategory: opening.itemCategory,
        colorCode: opening.colorCode,
        gsm: opening.gsm,
        content: opening.content,
        uom: opening.uom,
      },
      remarks: `Opening balance reversed - entered in error. ${reason.trim()}`,
      actor,
    });

    return {
      itemCode: opening.item.itemCode,
      description: opening.item.description,
      qty: qty.toFixed(4),
      uom: opening.uom,
    };
  });
}

/**
 * `reverseEntry()` over a batch, one entry at a time.
 *
 * Not one transaction, for the reason spelled out on `reverseMany()` below: a
 * paste of forty trims is forty independent opening balances, and one that has
 * already been issued against is no reason to refuse undoing the thirty-nine
 * beside it that nobody has touched.
 */
export async function reverseManyEntries(ledgerIds, { reason } = {}, actor = {}) {
  const ids = [...new Set(ledgerIds ?? [])];
  if (!ids.length) throw ApiError.badRequest('Choose at least one entry.', { field: 'ledgerIds' });

  const reversed = [];
  const failed = [];
  for (const ledgerId of ids) {
    try {
      reversed.push({ ledgerId, ...(await reverseEntry(ledgerId, { reason }, actor)) });
    } catch (err) {
      const entry = await prisma.stockLedger.findUnique({
        where: { id: ledgerId },
        select: { item: { select: { itemCode: true } } },
      });
      failed.push({ ledgerId, itemCode: entry?.item?.itemCode ?? ledgerId, message: err.message });
    }
  }

  return { reversed, failed };
}

/**
 * `reverse()` over a batch, one roll at a time.
 *
 * NOT one transaction for the lot. A paste of forty rows is forty
 * independent opening balances - see the note on `reverse()` - and so a roll
 * three issues have already touched is not a reason to refuse undoing the
 * thirty-nine beside it that nobody has. Each roll keeps its own pass/fail,
 * the same shape `apply()`'s own preview gives the office before anything
 * commits, except here every row has already tried to write and the report
 * says what actually happened rather than what would.
 */
export async function reverseMany(rollIds, { reason } = {}, actor = {}) {
  const ids = [...new Set(rollIds ?? [])];
  if (!ids.length) throw ApiError.badRequest('Choose at least one roll.', { field: 'rollIds' });

  const reversed = [];
  const failed = [];
  for (const rollId of ids) {
    try {
      reversed.push({ rollId, ...(await reverse(rollId, { reason }, actor)) });
    } catch (err) {
      const roll = await prisma.fabricRoll.findUnique({ where: { id: rollId }, select: { rollNo: true } });
      failed.push({ rollId, rollNo: roll?.rollNo ?? rollId, message: err.message });
    }
  }

  return { reversed, failed };
}
