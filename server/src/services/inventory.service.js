/**
 * Inventory: items, the stock ledger, balances and fabric rolls.
 *
 * The workbook has no inventory sheet at all - stock is implied by GRN in and
 * Fabric / Cutting Issue out. This module is where that implication is made
 * explicit, and it is built on one rule:
 *
 * ---------------------------------------------------------------------------
 *  THE LEDGER IS THE TRUTH. THE BALANCE IS A CACHE.
 *
 *  `stock_ledger` is append-only. Every movement in the pipeline writes exactly
 *  one row, and stock on hand is
 *
 *      SUM(qty_in) - SUM(qty_out)   for an (item, location)
 *
 *  `stock_balances` holds that same number, but it is never incremented in
 *  place. `recomputeBalance()` re-derives it by aggregating the ledger, inside
 *  the same transaction as the movement that changed it. Nothing in this
 *  application adds to or subtracts from a stored balance, so a balance cannot
 *  drift away from its movements - at worst it can be rebuilt from them, which
 *  `rebuildBalances()` does.
 *
 *      GRN            +100 m
 *      Fabric Issue    -25 m
 *      Available        75 m
 *
 *  and "available" is the subtraction, not a field somebody set.
 * ---------------------------------------------------------------------------
 *
 *  ISSUING MORE THAN IS AVAILABLE IS REFUSED.
 *
 *  `postMovement()` reads the available balance and refuses any OUT larger than
 *  it, before writing anything. Because every caller passes its own transaction
 *  client, that refusal rolls the whole caller back - the issue document and
 *  the movement fail together or succeed together.
 *
 *  ROLL NUMBERS ARE UNIQUE, AND A ROLL REMEMBERS WHERE IT CAME FROM.
 *
 *  `roll_no` is UNIQUE in the database. `assertRollNoAvailable()` turns the
 *  resulting constraint violation into a sentence a store keeper can act on,
 *  before the write rather than after it. `rollTraceability()` walks
 *  roll -> GRN -> PO -> order and back down through every movement the roll has
 *  ever been part of.
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError, ERROR_CODES } from '../utils/ApiError.js';
import { OPTIONS_LIMIT, searchFilter } from '../utils/http.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber } from './documentNumber.service.js';
import { categoryOf } from '../domain/itemCategory.js';
import { costOf, layersForIn, planConsumption } from '../domain/fifo.js';
import { normaliseShade } from '../domain/shade.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

export const DEFAULT_LOCATION = 'MAIN STORE';

/**
 * C3 / C6 - WHERE STOCK CAN BE, AND WHICH OF THOSE PLACES YOU CAN ISSUE FROM.
 *
 * ===========================================================================
 *  TOTAL ON HAND IS NOT THE SAME AS AVAILABLE FOR ISSUE
 * ===========================================================================
 *
 * Before C3 a Fabric Issue posted a bare OUT and the fabric vanished from the
 * books the moment it left the rack. Twelve hundred metres at a dye house
 * showed as zero stock - which is wrong twice over: the company still owns it,
 * and the store keeper still cannot issue it.
 *
 * Both facts are now representable, because a movement to a job worker or to
 * the cutting floor is a TRANSFER rather than a disappearance:
 *
 *     Fabric Issue (dyeing)   OUT  MAIN STORE        IN  AT DYEING VENDOR
 *     Job work return         OUT  AT DYEING VENDOR  IN  MAIN STORE
 *     Fabric Issue (cutting)  OUT  MAIN STORE        IN  CUTTING FLOOR
 *     Cutting Issue           OUT  CUTTING FLOOR     IN  MAIN STORE (remainder)
 *
 * Total on hand sums every location. Available for issue sums only MAIN STORE.
 * Because `postMovement()` already checks availability per location, fabric at
 * a dye house is excluded from issue by construction - there is no separate
 * rule to keep in step.
 *
 * These four values are the StockLocation master list verbatim; C3 adds no new
 * ones. "WITH JOB WORKER" is accepted as a generic synonym for the two vendor
 * locations, because that is the vocabulary the brief uses and a job work
 * order raised for WASHING or FINISHING has no vendor location of its own.
 */
export const LOCATION = {
  MAIN_STORE: 'MAIN STORE',
  CUTTING_FLOOR: 'CUTTING FLOOR',
  AT_DYEING_VENDOR: 'AT DYEING VENDOR',
  AT_PRINTING_VENDOR: 'AT PRINTING VENDOR',
  WITH_JOB_WORKER: 'WITH JOB WORKER',
  /** End-bits from cutting, booked as short rolls of their own. Issuable. */
  REMNANT_STORE: 'REMNANT STORE',
};

/**
 * Locations that hold company stock which is NOT available to issue.
 *
 * Held as a set rather than as "anything that is not the main store" so that a
 * new location added to the master list defaults to being issuable, which is
 * the safe direction: a location wrongly treated as in-process would silently
 * hide stock, while one wrongly treated as issuable fails loudly the first
 * time somebody tries to issue from it and finds nothing there.
 */
export const IN_PROCESS_LOCATIONS = new Set([
  LOCATION.CUTTING_FLOOR,
  LOCATION.AT_DYEING_VENDOR,
  LOCATION.AT_PRINTING_VENDOR,
  LOCATION.WITH_JOB_WORKER,
]);

/** The subset of the above that means "off site, at a job worker". */
export const JOB_WORKER_LOCATIONS = new Set([
  LOCATION.AT_DYEING_VENDOR,
  LOCATION.AT_PRINTING_VENDOR,
  LOCATION.WITH_JOB_WORKER,
]);

/** Whether stock at this location may be issued. Pure. */
export function isAvailableForIssue(location) {
  return !IN_PROCESS_LOCATIONS.has(location ?? DEFAULT_LOCATION);
}

/** Whether stock at this location is off site with a job worker. Pure. */
export function isWithJobWorker(location) {
  return JOB_WORKER_LOCATIONS.has(location ?? '');
}

/**
 * C3 - what the company holds of an item, split by whether it can be issued.
 *
 * Computed from the LEDGER, not from stock_balances, for the same reason
 * `availableQty()` is: a stale or hand-edited cache must never be able to make
 * stock look issuable that the movements do not support.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 * @param {string} itemId
 */
export async function onHandSummary(tx, itemId) {
  const client = tx ?? prisma;

  const rows = await client.stockLedger.groupBy({
    by: ['location'],
    where: { itemId },
    _sum: { qtyIn: true, qtyOut: true },
  });

  const byLocation = rows
    .map((r) => ({
      location: r.location,
      qty: D(r._sum.qtyIn ?? 0).minus(D(r._sum.qtyOut ?? 0)),
      availableForIssue: isAvailableForIssue(r.location),
      withJobWorker: isWithJobWorker(r.location),
    }))
    .filter((r) => !r.qty.isZero());

  const sum = (pick) => byLocation.filter(pick).reduce((a, r) => a.plus(r.qty), ZERO);

  return {
    /** Everything the company owns, wherever it is sitting. */
    totalOnHandQty: sum(() => true).toFixed(4),
    /** What a store keeper can actually issue today. */
    availableForIssueQty: sum((r) => r.availableForIssue).toFixed(4),
    /** Out being worked on - visible, but not issuable. */
    inProcessQty: sum((r) => !r.availableForIssue).toFixed(4),
    withJobWorkerQty: sum((r) => r.withJobWorker).toFixed(4),
    onCuttingFloorQty: sum((r) => r.location === LOCATION.CUTTING_FLOOR).toFixed(4),
    byLocation: byLocation.map((r) => ({ ...r, qty: r.qty.toFixed(4) })),
  };
}

/**
 * Whether an on-hand quantity has fallen below the item's reorder level.
 *
 * A reorder level of zero means "not tracked", not "reorder always" - most
 * items have never had one set, and flagging every one of them would make the
 * warning useless. Exported because three callers ask the same question - the
 * item list, the stock summary and the dashboard - and a second copy of this
 * rule is a second thing to keep in step.
 */
export function isBelowReorder(onHandQty, reorderLevel) {
  const reorder = D(reorderLevel);
  return !reorder.isZero() && D(onHandQty).lessThan(reorder);
}

export const ITEM_SORTABLE = ['itemCode', 'description', 'itemCategory', 'uom', 'createdAt'];
export const LEDGER_SORTABLE = ['entryDate', 'documentNo', 'qty', 'createdAt'];
export const ROLL_SORTABLE = ['rollNo', 'receivedQty', 'balanceQty', 'stage', 'createdAt'];

const ITEM_SEARCH = ['itemCode', 'description', 'itemCategory', 'subCategory', 'accessoriesItem', 'colorCode', 'hsnCode'];
const ROLL_SEARCH = ['rollNo', 'fabricName', 'colorCode', 'content', 'count', 'gsm', 'location', 'shade', 'dyeLot'];

// ===========================================================================
//  ITEM IDENTITY
// ===========================================================================

/**
 * The seven columns that make one stock-keeping item distinct from another.
 *
 * This is the same tuple as the `inventory_item_identity` unique constraint on
 * the table, and deliberately so: two receipts of 320 GSM Natural 10x6 cotton
 * are the same item and must accumulate on one balance, while the same fabric
 * in Night Black is a different item and must not.
 *
 * Empty string rather than null throughout, because a UNIQUE index treats two
 * NULLs as distinct and would happily create the same item twice.
 */
export function itemIdentity(source) {
  return {
    itemCategory: source.item ?? source.itemCategory ?? '',
    subCategory: source.subCategory ?? '',
    accessoriesItem: source.accessoriesItem ?? '',
    colorCode: source.colorCode ?? '',
    gsm: source.gsm ?? '',
    count: source.count ?? '',
    uom: source.uom ?? '',
  };
}

/** How the item reads on an issue slip. */
export function describeItem(source) {
  return (
    [
      source.item ?? source.itemCategory,
      source.subCategory,
      source.accessoriesItem,
      source.content,
      source.gsm,
      source.count,
      source.colorCode,
    ]
      .filter(Boolean)
      .join(' / ') || (source.item ?? source.itemCategory ?? 'Item')
  );
}

/**
 * Finds the stock item a document is moving, and creates it if this is the
 * first time the company has bought it.
 *
 * Runs on the caller's transaction client, so an item created for a receipt
 * that then fails is rolled back with it - and so is the ITM- number, because
 * document_sequences is incremented in the same transaction.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} source  Anything carrying the item-defining columns (a PO, a GRN)
 * @param {string} [actorId]
 */
export async function resolveOrCreateItem(tx, source, actorId) {
  const identity = itemIdentity(source);

  const existing = await tx.inventoryItem.findUnique({
    where: { inventory_item_identity: identity },
  });
  if (existing) {
    if (existing.deletedAt) {
      throw ApiError.conflict(
        `Inventory item ${existing.itemCode} (${existing.description}) has been deleted. ` +
          'Restore it before receiving stock against it.',
        { itemCode: existing.itemCode },
      );
    }
    return { item: existing, created: false };
  }

  const itemCode = await nextNumber('INVENTORY_ITEM', { tx });
  const item = await tx.inventoryItem.create({
    data: {
      ...identity,
      itemCode,
      description: describeItem(source),
      content: source.content ?? null,
      hsnCode: source.hsnCode ?? null,
      /**
       * C2 - the commercial category, resolved ONCE, here, at the moment the
       * item first enters the system, and then stored.
       *
       * Never re-derived on read. `itemCategory` above is the open dropdown
       * and the office may re-file its values tomorrow; an item that
       * tolerances have already been resolved against must not silently
       * change category underneath the documents that quoted it.
       *
       * categoryOf() throws on a value it does not recognise, which fails the
       * whole receipt rather than filing new stock under a guess.
       */
      category: categoryOf(identity.itemCategory, { field: 'item' }),
      // Fabric is followed roll by roll; everything else is held in bulk.
      isRollTracked: identity.itemCategory === 'Fabric',
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
  return { item, created: true };
}

// ===========================================================================
//  THE LEDGER
// ===========================================================================

/**
 * Serialises every movement for one (item, location) against each other.
 *
 * ---------------------------------------------------------------------------
 *  WHY A LOCK IS NEEDED AT ALL
 *
 *  `postMovement()` reads the available balance and then writes a movement.
 *  Those are two statements, and PostgreSQL's default READ COMMITTED gives
 *  each transaction a snapshot taken per statement - so two issues raised at
 *  the same moment BOTH read the balance before either writes, both find
 *  enough stock, and both commit. A hundred metres on hand becomes a hundred
 *  and twenty metres issued, and neither `stock_balances_qty_non_negative` nor
 *  any other CHECK fires, because each transaction's own arithmetic is
 *  perfectly consistent. See test/concurrency.stock.test.js, which reproduces
 *  exactly that and reported a ledger of -20 against a cache reading 60.
 *
 *  WHY AN ADVISORY LOCK RATHER THAN `SELECT ... FOR UPDATE`
 *
 *  There is no row that reliably exists to lock. The natural candidate is the
 *  `stock_balances` row for the pair, but the first movement for an item at a
 *  location is precisely the case where that row has not been created yet, so
 *  locking it would mean inserting it first - and two transactions racing to
 *  insert the same balance row is the original race wearing a different hat.
 *
 *  An advisory lock needs no row. `pg_advisory_xact_lock` is held for the rest
 *  of the transaction and released on COMMIT or ROLLBACK by PostgreSQL itself,
 *  so there is no unlock to forget and no leak on the error paths below.
 *
 *  WHY IT IS NOT A WIDER LOCK
 *
 *  The key is the (item, location) pair, so two storemen issuing different
 *  fabrics - or the same fabric at different locations - never wait for each
 *  other. Only movements that genuinely contend for the same balance queue up,
 *  which is the narrowest correct scope.
 *
 *  `hashtextextended` gives the 64 bits the lock function takes; a collision
 *  between two unrelated pairs costs an occasional needless wait and nothing
 *  else, since the lock is advisory and guards no data on its own.
 * ---------------------------------------------------------------------------
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function lockItemLocation(tx, itemId, location) {
  // `$executeRaw`, not `$queryRaw`: pg_advisory_xact_lock returns `void`, and
  // Prisma cannot deserialise a void column - it fails with "Failed to
  // deserialize column of type 'void'" rather than taking the lock. Nothing is
  // being read here, only waited for.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`${itemId}::${location}`}, 0))
  `;
}

/**
 * Stock on hand for an (item, location), computed from the ledger.
 *
 * Not read from stock_balances - that is the cache. Every rule that turns on
 * availability reads this, so a stale or hand-edited balance row can never let
 * an issue through that the movements do not support.
 *
 * NOTE: reading this OUTSIDE the lock taken by `postMovement()` gives a figure
 * that is true when read and may be stale by the time it is acted on. That is
 * fine for a preview or a report; it is not a basis for permitting an issue.
 * Anything that decides whether stock may leave must go through
 * `postMovement()`, which re-reads under the lock.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function availableQty(tx, itemId, location = DEFAULT_LOCATION) {
  const agg = await tx.stockLedger.aggregate({
    where: { itemId, location },
    _sum: { qtyIn: true, qtyOut: true },
  });
  return D(agg._sum.qtyIn ?? 0).minus(D(agg._sum.qtyOut ?? 0));
}

/**
 * Rebuilds the stock_balances row for an (item, location).
 *
 * QUANTITY comes from the ledger, as it always has. VALUE comes from the FIFO
 * cost layers still holding stock there - SUM(qty remaining x rate) - and
 * `avgRate` is that value over the quantity: the average cost of what is on
 * the shelf, not of everything ever received. See docs/STOCK-VALUATION-POLICY.md.
 *
 * Called inside the movement's own transaction, so the balance a reader sees is
 * never ahead of or behind the movements it summarises.
 */
export async function recomputeBalance(tx, itemId, location = DEFAULT_LOCATION) {
  const [totals, layers] = await Promise.all([
    tx.stockLedger.aggregate({
      where: { itemId, location },
      _sum: { qtyIn: true, qtyOut: true },
    }),
    tx.stockCostLayer.findMany({
      where: { itemId, location, qtyRemaining: { gt: 0 } },
      select: { qtyRemaining: true, rate: true },
    }),
  ]);

  const qty = D(totals._sum.qtyIn ?? 0).minus(D(totals._sum.qtyOut ?? 0));
  const value = layers
    .reduce((a, l) => a.plus(D(l.qtyRemaining).mul(D(l.rate))), ZERO)
    .toDecimalPlaces(2);
  const avgRate = qty.greaterThan(0) ? value.div(qty).toDecimalPlaces(4) : ZERO;

  return tx.stockBalance.upsert({
    where: { itemId_location: { itemId, location } },
    // Both branches WRITE the derived numbers rather than incrementing them.
    // There is deliberately no `{ increment: ... }` anywhere in this file.
    update: { qty, avgRate, value },
    create: { itemId, location, qty, avgRate, value },
  });
}

/**
 * Appends one movement to the ledger and refreshes the balance behind it.
 *
 * This is the ONLY way stock changes in this application. Every caller passes
 * its own transaction client, so the movement and the document that caused it
 * commit together or not at all.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} m
 * @param {string} m.itemId
 * @param {'IN'|'OUT'} m.direction
 * @param {any} m.qty                  Positive magnitude; direction carries the sign
 * @param {any} [m.rate]
 * @param {Date|string} m.entryDate
 * @param {string} m.documentType      A DocumentType enum value
 * @param {string} m.documentId
 * @param {string} m.documentNo
 * @param {string} [m.location]
 * @param {string} [m.rollId]
 * @param {string} [m.orderId]
 * @param {string} [m.grnId]
 * @param {object} [m.snapshot]        category / colour / gsm / content / uom
 * @param {string} [m.remarks]
 * @param {{userId?: string, fullName?: string}} [m.actor]
 * @param {Array} [m.carryCost]         IN only. The slices a paired OUT consumed
 *   (its `consumed`), so a TRANSFER keeps the cost and age of what it moved
 *   instead of being re-priced at `rate`. See domain/fifo.js.
 * @param {string[]} [m.preferSourceLedgerIds]  OUT only. Consume the layers
 *   these IN entries opened before FIFO order applies - a GRN reversal taking
 *   back its own receipt's cost.
 *
 * FIFO. An IN opens cost layers; an OUT consumes the oldest layers first and
 * is valued at exactly what it consumed - `m.rate` is ignored on an OUT
 * unless there is no layer to cost it from. Returns `consumed` (the slices an
 * OUT took) so the caller can carry them onto the IN of a transfer.
 */
export async function postMovement(tx, m) {
  const qty = D(m.qty);
  if (!qty.greaterThan(0)) {
    throw ApiError.badRequest('A stock movement must have a quantity greater than zero', {
      field: 'qty',
      documentNo: m.documentNo,
    });
  }

  const location = m.location ?? DEFAULT_LOCATION;

  // Everything from here to the end of the caller's transaction is serialised
  // against other movements for this (item, location). Taken BEFORE the balance
  // is read, because it is the read-then-write pair that has to be atomic, not
  // the write alone. See lockItemLocation() for the full reasoning.
  await lockItemLocation(tx, m.itemId, location);

  const before = await availableQty(tx, m.itemId, location);

  // "The system must prevent issuing more stock than available stock."
  // Checked here, before the write, against the ledger rather than the cache.
  if (m.direction === 'OUT' && qty.greaterThan(before)) {
    const item = await tx.inventoryItem.findUnique({
      where: { id: m.itemId },
      select: { itemCode: true, description: true, uom: true },
    });
    throw new ApiError(
      409,
      `Cannot issue: only ${before.toFixed(4)} ${item?.uom ?? ''} of ` +
        `${item?.itemCode ?? 'this item'} (${item?.description ?? ''}) is available at ` +
        `${location}. ${qty.toFixed(4)} was requested.`,
      {
        code: ERROR_CODES.INSUFFICIENT_STOCK,
        details: {
          field: 'qty',
          itemCode: item?.itemCode ?? null,
          location,
          available: before.toFixed(4),
          requested: qty.toFixed(4),
          short: qty.minus(before).toFixed(4),
        },
      },
    );
  }

  const balanceQty = m.direction === 'IN' ? before.plus(qty) : before.minus(qty);
  const snapshot = m.snapshot ?? {};

  /*
   * FIFO - THE COST OF THIS MOVEMENT.
   *
   * Worked out under the same (item, location) lock as the availability check
   * above, so two issues cannot both consume the same layer.
   */
  let rate;
  let value;
  let plan = null;
  let remarks = m.remarks ?? null;

  if (m.direction === 'OUT') {
    const layers = await tx.stockCostLayer.findMany({
      where: { itemId: m.itemId, location, qtyRemaining: { gt: 0 } },
    });
    const prefer = m.preferSourceLedgerIds?.length
      ? (l) => m.preferSourceLedgerIds.includes(l.sourceLedgerId)
      : undefined;
    plan = planConsumption(layers, qty, { prefer });

    // Quantity with no layer behind it can only exist if the layers fell out
    // of step with the ledger. It is valued at the caller's rate and SAID so
    // on the ledger row, never silently priced at zero.
    const shortfall = D(plan.shortfallQty);
    const shortfallValue = shortfall.mul(D(m.rate ?? 0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    value = D(plan.value).plus(shortfallValue);
    rate = value.div(qty).toDecimalPlaces(4);
    if (shortfall.greaterThan(0)) {
      remarks = `${remarks ? `${remarks}. ` : ''}${shortfall.toFixed(4)} had no FIFO cost layer and was ` +
        `valued at ${D(m.rate ?? 0).toFixed(4)}.`;
    }
  } else if (m.carryCost?.length) {
    const carried = costOf(m.carryCost, qty);
    value = D(carried.value);
    rate = D(carried.rate);
  } else {
    rate = D(m.rate ?? 0);
  }
  /*
   * `stock_ledger_value_is_qty_x_rate` holds every row to value = ROUND(qty x
   * rate, 2). A FIFO cost blended from several layers is carried as its rate
   * to four places, and the row's value is that rate times the quantity - so
   * the invariant stands. The consumption rows keep each layer's exact cost;
   * the two can differ by a paisa of rounding, never more.
   */
  value = qty.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const entry = await tx.stockLedger.create({
    data: {
      entryDate: new Date(m.entryDate ?? Date.now()),
      itemId: m.itemId,
      rollId: m.rollId ?? null,
      location,
      itemCategory: snapshot.itemCategory ?? '',
      colorCode: snapshot.colorCode ?? null,
      gsm: snapshot.gsm ?? null,
      content: snapshot.content ?? null,
      uom: snapshot.uom ?? '',
      orderId: m.orderId ?? null,
      documentType: m.documentType,
      documentId: m.documentId,
      documentNo: m.documentNo,
      direction: m.direction,
      qty,
      qtyIn: m.direction === 'IN' ? qty : ZERO,
      qtyOut: m.direction === 'OUT' ? qty : ZERO,
      rate,
      value,
      balanceQty,
      grnId: m.grnId ?? null,
      remarks,
      createdById: m.actor?.userId ?? null,
      createdByName: m.actor?.fullName ?? null,
    },
  });

  // --- The layers behind the movement -------------------------------------
  if (m.direction === 'OUT') {
    for (const s of plan.slices) {
      await tx.stockLayerConsumption.create({
        data: { layerId: s.layerId, ledgerId: entry.id, qty: D(s.qty), rate: D(s.rate), value: D(s.value) },
      });
      // A decrement, not a computed absolute: `stock_cost_layers_remaining_in_range`
      // then refuses a layer driven below zero instead of it being overwritten.
      await tx.stockCostLayer.update({
        where: { id: s.layerId },
        data: { qtyRemaining: { decrement: D(s.qty) } },
      });
    }
  } else {
    const specs = layersForIn({
      qty,
      rate: m.rate ?? 0,
      entryDate: entry.entryDate,
      carry: m.carryCost,
    });
    for (const spec of specs) {
      await tx.stockCostLayer.create({
        data: {
          itemId: m.itemId,
          location,
          rollId: m.rollId ?? null,
          layerDate: new Date(spec.layerDate),
          sourceLedgerId: entry.id,
          sourceDocumentNo: m.documentNo,
          qtyIn: D(spec.qty),
          qtyRemaining: D(spec.qty),
          rate: D(spec.rate),
        },
      });
    }
  }

  /*
   * F-09 - `deferBalance` skips ONLY the cache refresh.
   *
   * A receipt of fifty rolls posts fifty movements for the same (item,
   * location), and recomputing the balance after each one runs two aggregates
   * and an upsert to produce a number that the next movement immediately
   * replaces. Only the last one is ever read.
   *
   * What is NOT skipped is the availability check above, which reads the
   * LEDGER rather than the cache - so deferring cannot let an over-issue
   * through. The caller must call `recomputeBalance()` once before its
   * transaction ends; `grn.service.js` does exactly that after its roll loop.
   *
   * Off by default. A caller that says nothing gets the safe behaviour.
   */
  const balance = m.deferBalance
    ? null
    : await recomputeBalance(tx, m.itemId, location);

  return { entry, balance, balanceQty, consumed: plan?.slices ?? [] };
}

/**
 * Rebuilds every balance from the ledger.
 *
 * Exists because a derived cache should always be rebuildable - if it is not,
 * it was never really derived. Reconciliation reports the difference without
 * writing; the rebuild fixes it.
 */
export async function rebuildBalances({ dryRun = false } = {}) {
  const pairs = await prisma.stockLedger.groupBy({
    by: ['itemId', 'location'],
    _sum: { qtyIn: true, qtyOut: true },
  });

  const differences = [];
  for (const pair of pairs) {
    const expected = D(pair._sum.qtyIn ?? 0).minus(D(pair._sum.qtyOut ?? 0));
    const stored = await prisma.stockBalance.findUnique({
      where: { itemId_location: { itemId: pair.itemId, location: pair.location } },
      select: { qty: true },
    });
    const held = D(stored?.qty ?? 0);
    if (!held.equals(expected)) {
      const item = await prisma.inventoryItem.findUnique({
        where: { id: pair.itemId },
        select: { itemCode: true, description: true },
      });
      differences.push({
        itemId: pair.itemId,
        itemCode: item?.itemCode ?? null,
        description: item?.description ?? null,
        location: pair.location,
        storedQty: held.toFixed(4),
        ledgerQty: expected.toFixed(4),
        difference: expected.minus(held).toFixed(4),
      });
    }
    if (!dryRun) {
      await prisma.$transaction((tx) => recomputeBalance(tx, pair.itemId, pair.location));
    }
  }

  return {
    checked: pairs.length,
    differences,
    /** True when every cached balance already agreed with the ledger. */
    inAgreement: differences.length === 0,
    rebuilt: !dryRun,
  };
}

// ===========================================================================
//  FABRIC ROLLS
// ===========================================================================

/**
 * Refuses a roll number that is already in use.
 *
 * The UNIQUE index on roll_no is what actually guarantees this; the point of
 * checking first is the message. A store keeper who has just re-used FAB-014
 * needs to be told which GRN already owns it, not handed a constraint name.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function assertRollNoAvailable(tx, rollNo, { excludeId } = {}) {
  const clash = await tx.fabricRoll.findFirst({
    where: { rollNo, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: {
      id: true,
      rollNo: true,
      deletedAt: true,
      writtenOffAt: true,
      grn: { select: { grnNo: true, grnDate: true, reversedAt: true } },
      vendor: { select: { vendorName: true } },
    },
  });
  if (!clash) return;

  /*
   * F-04 - A ROLL WRITTEN OFF BY A REVERSAL GIVES ITS NUMBER BACK.
   *
   * "A roll number is never reused" is the right rule and this is its one
   * genuine exception. FAB-0123 is a label printed on a physical roll of
   * cloth in the store. If the receipt that booked it in said 1,000 metres
   * when the roll holds 100, the reversal writes the roll record off - but the
   * cloth is still on the rack with the same label on it, and re-keying the
   * receipt correctly HAS to be able to say FAB-0123 again.
   *
   * Refusing would leave the storeman with a physical roll they cannot enter
   * under its own number, which is a worse lie than the one the reversal
   * corrected. So a soft-deleted roll whose receipt was reversed does not
   * block: the number is free, and the written-off row stays in the register
   * explaining what happened to it.
   *
   * Keyed on `writtenOffAt` and not on `deletedAt`, so it is exactly as narrow
   * as it should be: a roll deleted for any other reason still holds its
   * number. The same column conditions the partial unique index behind this
   * check, so the application and the database agree on which numbers are
   * free - this function turns the database's answer into a sentence, and it
   * must not give a different one.
   */
  if (clash.writtenOffAt) return;

  const provenance = clash.grn
    ? ` It was received on ${clash.grn.grnNo}` +
      (clash.vendor ? ` from ${clash.vendor.vendorName}` : '') +
      '.'
    : '';
  throw new ApiError(
    409,
    `Roll number ${rollNo} already exists.${provenance}` +
      (clash.deletedAt ? ' That roll is deleted, but its number is never reused.' : ''),
    {
      code: ERROR_CODES.DUPLICATE_ROLL_NO,
      details: { field: 'rollNo', existingRollId: clash.id },
    },
  );
}

/**
 * Creates a fabric roll against a receipt.
 *
 * Runs on the caller's transaction client. The roll, the GRN that received it
 * and the ledger entry that stocked it are one atomic act.
 */
export async function createRoll(tx, roll, actorId) {
  const rollNo = roll.rollNo?.trim() || (await nextNumber('FABRIC_ROLL', { tx }));
  await assertRollNoAvailable(tx, rollNo);

  return tx.fabricRoll.create({
    data: {
      rollNo,
      grnId: roll.grnId ?? null,
      vendorId: roll.vendorId ?? null,
      inventoryItemId: roll.inventoryItemId ?? null,
      fabricName: roll.fabricName ?? null,
      colorCode: roll.colorCode ?? null,
      content: roll.content ?? null,
      count: roll.count ?? null,
      construction: roll.construction ?? null,
      width: roll.width !== undefined && roll.width !== null ? D(roll.width) : null,
      gsm: roll.gsm ?? null,
      uom: roll.uom ?? 'Mtrs',
      receivedQty: D(roll.qty),
      // A roll starts life with its whole receipt on hand.
      balanceQty: D(roll.qty),
      rate: roll.rate !== undefined && roll.rate !== null ? D(roll.rate) : null,
      stage: 'RAW',
      location: roll.location ?? DEFAULT_LOCATION,
      shade: normaliseShade(roll.shade),
      dyeLot: normaliseShade(roll.dyeLot),
      shadeMarkedAt: roll.shade || roll.dyeLot ? new Date() : null,
      shadeMarkedByName: roll.shade || roll.dyeLot ? roll.shadeMarkedByName ?? null : null,
      remarks: roll.remarks ?? null,
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}

/**
 * Grades a roll's shade and dye lot.
 *
 * Open until the roll has been cut from. After that the shade it was cut as
 * is what every later issue on the same cutting line was matched against -
 * the issue snapshotted it - and re-grading the roll would make the register
 * disagree with what is already in the bundles. A roll that has only gone to
 * a dyer, or has not moved at all, may be graded and re-graded freely.
 */
export async function markRollShade(id, { shade, dyeLot, remarks }, actor) {
  const roll = await prisma.fabricRoll.findFirst({ where: { id, deletedAt: null } });
  if (!roll) throw ApiError.notFound('Fabric roll');

  const cut = await prisma.fabricIssue.findFirst({
    where: { rollId: id, deletedAt: null, cuttingChallanLineId: { not: null }, postedAt: { not: null } },
    select: { issueNo: true },
  });
  if (cut) {
    throw ApiError.conflict(
      `Roll ${roll.rollNo} has already been issued for cutting on ${cut.issueNo}, and was cut as ` +
        `${roll.shade ? `shade ${roll.shade}` : 'ungraded'}. Its shade can no longer be changed.`,
      { field: 'shade' },
    );
  }

  const nextShade = shade !== undefined ? normaliseShade(shade) : roll.shade;
  const nextLot = dyeLot !== undefined ? normaliseShade(dyeLot) : roll.dyeLot;

  return prisma.fabricRoll.update({
    where: { id },
    data: {
      shade: nextShade,
      dyeLot: nextLot,
      shadeMarkedAt: new Date(),
      shadeMarkedByName: actor.fullName ?? null,
      remarks: remarks ?? roll.remarks,
      updatedById: actor.userId ?? null,
    },
  });
}

/**
 * Everything a roll can say about where it came from and where it has been.
 *
 *      roll -> GRN -> vendor -> PO -> buyer order
 *           -> fabric characteristics
 *           -> current location and stage
 *           -> every movement it has been part of
 *
 * Assembled server-side because the chain spans six tables; leaving the client
 * to join it would mean six round trips and six chances to join it differently.
 */
export async function rollTraceability(id) {
  const roll = await prisma.fabricRoll.findFirst({
    where: { id, deletedAt: null },
    include: {
      vendor: { select: { id: true, vendorCode: true, vendorName: true, category: true } },
      inventoryItem: {
        select: { id: true, itemCode: true, description: true, uom: true, isRollTracked: true },
      },
      grn: {
        select: {
          id: true,
          grnNo: true,
          grnDate: true,
          billNo: true,
          purpose: true,
          receivingQty: true,
          inventoryRate: true,
          location: true,
          postedAt: true,
          purchaseOrder: {
            select: {
              id: true,
              poId: true,
              poDate: true,
              orderQty: true,
              rate: true,
              uom: true,
              approvalStatus: true,
              vendor: { select: { id: true, vendorName: true } },
              quotation: { select: { id: true, quotationNo: true } },
              order: {
                select: {
                  id: true,
                  orderNo: true,
                  orderQty: true,
                  status: true,
                  buyer: { select: { id: true, buyerName: true } },
                  style: { select: { id: true, styleNo: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!roll) throw ApiError.notFound('Fabric roll');

  const movements = await prisma.stockLedger.findMany({
    where: { rollId: id },
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
  });

  const po = roll.grn?.purchaseOrder ?? null;
  const order = po?.order ?? null;

  const received = D(roll.receivedQty);
  const balance = D(roll.balanceQty);

  return {
    roll: {
      ...roll,
      consumedQty: received.minus(balance).toFixed(4),
      consumedPct: received.isZero()
        ? '0.00'
        : received.minus(balance).div(received).mul(100).toDecimalPlaces(2).toFixed(2),
    },
    /** The chain the brief asks a roll to retain, link by link. */
    chain: {
      complete: Boolean(roll.grn && po && order),
      grn: roll.grn
        ? { id: roll.grn.id, grnNo: roll.grn.grnNo, grnDate: roll.grn.grnDate, billNo: roll.grn.billNo }
        : null,
      vendor: roll.vendor,
      purchaseOrder: po
        ? { id: po.id, poId: po.poId, poDate: po.poDate, approvalStatus: po.approvalStatus }
        : null,
      quotation: po?.quotation ?? null,
      order: order
        ? {
            id: order.id,
            orderNo: order.orderNo,
            status: order.status,
            buyerName: order.buyer?.buyerName ?? null,
            styleNo: order.style?.styleNo ?? null,
          }
        : null,
      characteristics: {
        fabricName: roll.fabricName,
        colorCode: roll.colorCode,
        content: roll.content,
        count: roll.count,
        construction: roll.construction,
        gsm: roll.gsm,
        width: roll.width,
        uom: roll.uom,
      },
      currentLocation: { location: roll.location, stage: roll.stage, isHeld: roll.isHeld },
      breadcrumb: [
        roll.rollNo,
        roll.grn?.grnNo,
        roll.vendor?.vendorName,
        po?.poId,
        order?.orderNo,
      ].filter(Boolean),
    },
    /** Issue history: every ledger row this roll has ever appeared on. */
    movements: movements.map((mv) => ({
      ...mv,
      signedQty: (mv.direction === 'IN' ? D(mv.qty) : D(mv.qty).negated()).toFixed(4),
    })),
  };
}

/** Moves a roll between store locations. Stock does not move, only its shelf. */
export async function relocateRoll(id, { location, remarks }, actorId) {
  await assertValueInList('StockLocation', location, { field: 'location', required: true });

  const roll = await prisma.fabricRoll.findFirst({ where: { id, deletedAt: null } });
  if (!roll) throw ApiError.notFound('Fabric roll');
  if (roll.location === location) {
    throw ApiError.badRequest(`Roll ${roll.rollNo} is already at ${location}.`);
  }

  return prisma.fabricRoll.update({
    where: { id },
    data: {
      location,
      remarks: remarks ?? roll.remarks,
      updatedById: actorId,
    },
  });
}

// ===========================================================================
//  QUERIES
// ===========================================================================

/** Inventory items, with their balances alongside. */
export async function listItems(query) {
  const { page, pageSize, skip, take, orderBy, search, itemCategory, isActive, lowStock } = query;

  const where = {
    deletedAt: null,
    ...(itemCategory ? { itemCategory } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
    ...searchFilter(search, ITEM_SEARCH),
  };

  const [rows, total] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      orderBy,
      skip,
      take,
      include: { balances: { orderBy: { location: 'asc' } } },
    }),
    prisma.inventoryItem.count({ where }),
  ]);

  const projected = rows.map(projectItem);
  return {
    // "Below reorder level" is a property of the summed balance, so it can only
    // be filtered after the balances are in hand.
    rows: lowStock ? projected.filter((r) => r.belowReorderLevel) : projected,
    total,
    page,
    pageSize,
  };
}

function projectItem(item) {
  const onHand = (item.balances ?? []).reduce((a, b) => a.plus(D(b.qty)), ZERO);
  const value = (item.balances ?? []).reduce((a, b) => a.plus(D(b.value)), ZERO);
  const reorder = D(item.reorderLevel);
  return {
    ...item,
    onHandQty: onHand.toFixed(4),
    stockValue: value.toFixed(2),
    belowReorderLevel: isBelowReorder(onHand, reorder),
  };
}

/** One item: its balances by location, its rolls, and its recent movements. */
export async function getItem(id) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id, deletedAt: null },
    include: { balances: { orderBy: { location: 'asc' } } },
  });
  if (!item) throw ApiError.notFound('Inventory item');

  const [rolls, movements, receipts] = await Promise.all([
    prisma.fabricRoll.findMany({
      where: { inventoryItemId: id, deletedAt: null },
      orderBy: { rollNo: 'asc' },
      select: {
        id: true,
        rollNo: true,
        receivedQty: true,
        balanceQty: true,
        stage: true,
        location: true,
        isHeld: true,
        colorCode: true,
        gsm: true,
        grn: { select: { id: true, grnNo: true } },
      },
    }),
    prisma.stockLedger.findMany({
      where: { itemId: id },
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: { roll: { select: { id: true, rollNo: true } } },
    }),
    prisma.grn.findMany({
      where: { inventoryItemId: id, deletedAt: null },
      orderBy: { grnDate: 'desc' },
      take: 25,
      select: {
        id: true,
        grnNo: true,
        grnDate: true,
        billNo: true,
        receivingQty: true,
        inventoryRate: true,
        amount: true,
        vendor: { select: { id: true, vendorName: true } },
        purchaseOrder: { select: { id: true, poId: true } },
      },
    }),
  ]);

  return {
    ...projectItem(item),
    /** Restated from the ledger, so the screen shows the truth and the cache. */
    ledgerQty: await ledgerTotalsFor(id),
    rolls,
    receipts,
    movements,
  };
}

/** On-hand by location, computed from the ledger rather than read from cache. */
async function ledgerTotalsFor(itemId) {
  const rows = await prisma.stockLedger.groupBy({
    by: ['location'],
    where: { itemId },
    _sum: { qtyIn: true, qtyOut: true },
  });
  return rows.map((r) => ({
    location: r.location,
    qtyIn: D(r._sum.qtyIn ?? 0).toFixed(4),
    qtyOut: D(r._sum.qtyOut ?? 0).toFixed(4),
    available: D(r._sum.qtyIn ?? 0).minus(D(r._sum.qtyOut ?? 0)).toFixed(4),
  }));
}

/** Item editing is limited to the things a receipt does not decide. */
export async function updateItem(id, input, actorId) {
  const item = await prisma.inventoryItem.findFirst({ where: { id, deletedAt: null } });
  if (!item) throw ApiError.notFound('Inventory item');

  if (input.reorderLevel !== undefined && D(input.reorderLevel).isNegative()) {
    throw ApiError.badRequest('Reorder level cannot be negative', { field: 'reorderLevel' });
  }

  return prisma.inventoryItem.update({
    where: { id },
    data: {
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.reorderLevel !== undefined ? { reorderLevel: D(input.reorderLevel) } : {}),
      ...(input.hsnCode !== undefined ? { hsnCode: input.hsnCode } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedById: actorId,
    },
  });
}

/**
 * The stock ledger, as a register.
 *
 * Every column the brief asks for is here: date, item, category, roll, colour,
 * GSM, content, UOM, quantity in, quantity out, rate, order, reference type,
 * reference id, location and user.
 */
export async function listLedger(query) {
  const {
    page, pageSize, skip, take, orderBy, search,
    itemId, rollId, orderId, location, documentType, direction, dateFrom, dateTo,
  } = query;

  const where = {
    ...(itemId ? { itemId } : {}),
    ...(rollId ? { rollId } : {}),
    ...(orderId ? { orderId } : {}),
    ...(location ? { location } : {}),
    ...(documentType ? { documentType } : {}),
    ...(direction ? { direction } : {}),
    ...(dateFrom || dateTo
      ? {
          entryDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    ...searchFilter(search, ['documentNo', 'remarks', 'itemCategory', 'colorCode']),
  };

  const [rows, total, totals] = await Promise.all([
    prisma.stockLedger.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        item: { select: { id: true, itemCode: true, description: true } },
        roll: { select: { id: true, rollNo: true } },
        order: { select: { id: true, orderNo: true } },
      },
    }),
    prisma.stockLedger.count({ where }),
    prisma.stockLedger.aggregate({ where, _sum: { qtyIn: true, qtyOut: true, value: true } }),
  ]);

  return {
    rows,
    total,
    page,
    pageSize,
    /** Footer totals for the filtered register - computed here, not summed in the browser. */
    totals: {
      qtyIn: D(totals._sum.qtyIn ?? 0).toFixed(4),
      qtyOut: D(totals._sum.qtyOut ?? 0).toFixed(4),
      net: D(totals._sum.qtyIn ?? 0).minus(D(totals._sum.qtyOut ?? 0)).toFixed(4),
      value: D(totals._sum.value ?? 0).toFixed(2),
    },
  };
}

/** Fabric rolls. */
export async function listRolls(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    stage, location, vendorId, grnId, itemId, colorCode, inStockOnly, isHeld, shade, dyeLot,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(stage ? { stage } : {}),
    ...(location ? { location } : {}),
    ...(vendorId ? { vendorId } : {}),
    ...(grnId ? { grnId } : {}),
    ...(itemId ? { inventoryItemId: itemId } : {}),
    ...(colorCode ? { colorCode } : {}),
    ...(shade ? { shade: normaliseShade(shade) } : {}),
    ...(dyeLot ? { dyeLot: normaliseShade(dyeLot) } : {}),
    ...(isHeld !== undefined ? { isHeld } : {}),
    ...(inStockOnly ? { balanceQty: { gt: 0 } } : {}),
    ...searchFilter(search, ROLL_SEARCH),
  };

  const [rows, total] = await Promise.all([
    prisma.fabricRoll.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        vendor: { select: { id: true, vendorName: true } },
        grn: {
          select: {
            id: true,
            grnNo: true,
            purchaseOrder: {
              select: { id: true, poId: true, order: { select: { id: true, orderNo: true } } },
            },
          },
        },
        inventoryItem: { select: { id: true, itemCode: true, description: true } },
      },
    }),
    prisma.fabricRoll.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      ...r,
      consumedQty: D(r.receivedQty).minus(D(r.balanceQty)).toFixed(4),
      poId: r.grn?.purchaseOrder?.poId ?? null,
      orderNo: r.grn?.purchaseOrder?.order?.orderNo ?? null,
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * The stock summary screen: on-hand by item, valued, with the low-stock items
 * called out.
 *
 * ===========================================================================
 *  THE TOTALS SPAN THE WHOLE FILTER. THE ROWS ARE ONE PAGE OF IT.
 * ===========================================================================
 *
 * This is the rule that makes a paginated summary safe to read, and getting it
 * wrong is the classic way to break one. "Stock value" is the figure somebody
 * quotes in a meeting; if it silently became "the value of the twenty-five
 * lines that happen to be on screen" it would be wrong by a factor of however
 * many pages there are, and nothing about the screen would say so.
 *
 * So the three totals are computed by the DATABASE over every matching row -
 * `aggregate` for lines and value, a separate `count` for the low-stock tally -
 * while only the requested page is read in full. The totals do not move when
 * you turn the page, because they are not made of the page.
 *
 * ---------------------------------------------------------------------------
 *  WHY THE LOW-STOCK COUNT IS ITS OWN QUERY
 *
 *  "Below reorder level" compares a balance against a threshold on the related
 *  item, and Prisma cannot express a cross-model column comparison in `where`.
 *  It is therefore counted by reading the candidates and asking
 *  `isBelowReorder()` - the same predicate the rows use, so the tally and the
 *  flags can never disagree.
 *
 *  The candidate set is small on purpose: `reorderLevel: { gt: 0 }` excludes
 *  every item nobody has set a level for, which in practice is most of them.
 *  An item left at zero is untracked, not permanently short - see
 *  `isBelowReorder()` - so those rows could never qualify anyway, and not
 *  reading them is free.
 * ---------------------------------------------------------------------------
 */
export async function stockSummary({
  location,
  itemCategory,
  search,
  lowStock = false,
  page = 1,
  pageSize = 25,
  skip = 0,
  take = 25,
} = {}) {
  /** Everything the filters select, before paging. */
  const where = {
    ...(location ? { location } : {}),
    item: {
      deletedAt: null,
      ...(itemCategory ? { itemCategory } : {}),
      // Searching the item, not the balance: a store keeper types an item code
      // or a fabric name, never a location row id.
      ...(search
        ? {
            OR: [
              { itemCode: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              { itemCategory: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
  };

  const ITEM_SELECT = {
    id: true,
    itemCode: true,
    description: true,
    itemCategory: true,
    uom: true,
    reorderLevel: true,
    isRollTracked: true,
  };

  /** Only rows that could possibly be below a level - see the header. */
  const lowCandidateWhere = {
    ...where,
    item: { ...where.item, reorderLevel: { gt: 0 } },
  };

  const [aggregate, lowCandidates] = await Promise.all([
    prisma.stockBalance.aggregate({ where, _count: { _all: true }, _sum: { value: true } }),
    prisma.stockBalance.findMany({
      where: lowCandidateWhere,
      select: { itemId: true, location: true, qty: true, item: { select: { reorderLevel: true } } },
    }),
  ]);

  /** The identity of every low row, so the page can be filtered to them. */
  const lowKeys = new Set(
    lowCandidates
      .filter((b) => isBelowReorder(b.qty, b.item.reorderLevel))
      .map((b) => `${b.itemId}::${b.location}`),
  );

  /**
   * "Below reorder level" as a page filter.
   *
   * Prisma cannot express the comparison, so the qualifying rows are named by
   * id. That is exactly why the candidate set above is narrowed first: this
   * list is the low rows, not the whole store.
   */
  const pageWhere = lowStock
    ? {
        ...lowCandidateWhere,
        OR: [...lowKeys].map((k) => {
          const [itemId, loc] = k.split('::');
          return { itemId, location: loc };
        }),
      }
    : where;

  // A filter that matched nothing must return nothing. Without this guard an
  // empty OR is dropped by Prisma and the screen would show the whole store
  // under a "below reorder level" heading.
  const noLowRows = lowStock && lowKeys.size === 0;

  const [balances, total] = noLowRows
    ? [[], 0]
    : await Promise.all([
        prisma.stockBalance.findMany({
          where: pageWhere,
          include: { item: { select: ITEM_SELECT } },
          orderBy: [{ item: { itemCode: 'asc' } }, { location: 'asc' }],
          skip,
          take,
        }),
        prisma.stockBalance.count({ where: pageWhere }),
      ]);

  const rows = balances.map((b) => {
    const qty = D(b.qty);
    const reorder = D(b.item.reorderLevel);
    return {
      itemId: b.itemId,
      itemCode: b.item.itemCode,
      description: b.item.description,
      itemCategory: b.item.itemCategory,
      uom: b.item.uom,
      isRollTracked: b.item.isRollTracked,
      location: b.location,
      qty: qty.toFixed(4),
      inProcessQty: D(b.inProcessQty).toFixed(4),
      avgRate: D(b.avgRate).toFixed(4),
      value: D(b.value).toFixed(2),
      reorderLevel: reorder.toFixed(4),
      belowReorderLevel: isBelowReorder(qty, reorder),
    };
  });

  return {
    rows,
    total,
    page,
    pageSize,
    /**
     * The whole filtered set, never the page. `lines` and `value` deliberately
     * ignore the `lowStock` toggle as well: "what is the store worth" does not
     * change because somebody ticked a box to look at the short items.
     */
    totals: {
      lines: aggregate._count._all,
      value: D(aggregate._sum.value).toFixed(2),
      belowReorder: lowKeys.size,
    },
  };
}

/** Item dropdown for the screens that need to name a stock item. */
export async function itemOptions({ itemCategory, rollTrackedOnly } = {}) {
  return prisma.inventoryItem.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ...(itemCategory ? { itemCategory } : {}),
      ...(rollTrackedOnly ? { isRollTracked: true } : {}),
    },
    orderBy: { itemCode: 'asc' },
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      itemCode: true,
      description: true,
      itemCategory: true,
      uom: true,
      isRollTracked: true,
      balances: { select: { location: true, qty: true } },
    },
  });
}
