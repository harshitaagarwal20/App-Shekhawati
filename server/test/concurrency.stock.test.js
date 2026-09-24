/**
 * F-02 / F-03 - CONCURRENCY ON STOCK. NEEDS POSTGRESQL.
 *
 * ===========================================================================
 *  WHY THIS FILE EXISTS
 * ===========================================================================
 *
 * Every other test in this suite is sequential, and every one of them passes
 * against code that oversells stock the moment two people press Issue at the
 * same time. A race is invisible to a test that only ever runs one transaction
 * at a time, which is why the two defects below survived a suite of ~8,000
 * lines: nothing here was ever asked to run twice at once.
 *
 * Both tests fire genuinely concurrent transactions through the SAME service
 * entry points the application uses, and assert the invariant that must hold
 * regardless of interleaving:
 *
 *     SUM(qty_in) - SUM(qty_out) >= 0        for every (item, location)
 *     a roll never gives out more than it received
 *
 * ---------------------------------------------------------------------------
 *  READ THIS BEFORE "FIXING" A FAILURE HERE BY RETRYING
 *
 *  These tests do not assert timing and they are not flaky by construction.
 *  `postMovement()` reads the available balance and then writes; if that pair
 *  is not serialised, four concurrent issues of 60 against a balance of 100
 *  will all read 100 and all succeed. The assertion is on the FINAL LEDGER
 *  STATE, not on which attempt won, so a pass means the invariant held and a
 *  failure means stock was created out of nothing.
 * ---------------------------------------------------------------------------
 *
 *     node --test test/concurrency.stock.test.js
 */

import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// The shared client, which loads server/.env through src/config/env.js.
import prisma from '../src/config/prisma.js';
import { postMovement } from '../src/services/inventory.service.js';

/**
 * Whether a database is actually reachable.
 *
 * Probed with a TOP-LEVEL await, not in `before()`: node:test evaluates a
 * test's `skip` option when the `describe` body runs, which is before any hook
 * fires. See the same note in c2-c9.constraints.test.js.
 */
let live = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  live = true;
} catch {
  live = false;
}

const skipIfNoDb = () => (live ? false : 'no database reachable');

/*
 * Warm the connection pool before any test runs.
 *
 * Not a micro-optimisation - it is load-bearing. Prisma opens connections
 * lazily, so the FIRST test to fire three concurrent transactions spends its
 * overlap window waiting on TCP and authentication instead of on the database,
 * and the three transactions end up staggered rather than simultaneous. That
 * made the oversell test below pass against code this file exists to prove
 * broken, while the identically-shaped test after it failed every time.
 *
 * Opening the connections up front removes the stagger, so the first test races
 * as hard as the second.
 */
if (live) {
  await Promise.all([1, 2, 3, 4].map(() => prisma.$queryRaw`SELECT 1`));
}

/** Everything this file creates, so it can remove exactly its own rows. */
const TAG = `CONC-${Date.now()}`;
const made = { items: [], rolls: [] };

after(async () => {
  if (live) {
    // FIFO layers and their consumptions first - both point at ledger rows -
    // then the ledger: stock_ledger.item_id is ON DELETE RESTRICT, deliberately.
    await prisma.stockLayerConsumption.deleteMany({ where: { layer: { itemId: { in: made.items } } } });
    await prisma.stockCostLayer.deleteMany({ where: { itemId: { in: made.items } } });
    await prisma.stockLedger.deleteMany({ where: { itemId: { in: made.items } } });
    await prisma.stockBalance.deleteMany({ where: { itemId: { in: made.items } } });
    await prisma.fabricRoll.deleteMany({ where: { id: { in: made.rolls } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: made.items } } });
  }
  await prisma.$disconnect();
});

after(() => {
  if (!live) {
    process.stdout.write(
      [
        '',
        '  ! NO DATABASE REACHED. The concurrency tests were SKIPPED and nothing was proved.',
        '    Set DATABASE_URL in server/.env and re-run - these are the only tests in the',
        '    suite that can observe a race at all.',
        '',
      ].join('\n'),
    );
  }
});

/** A throwaway inventory item. The identity columns carry TAG so it is unique. */
async function makeItem(suffix) {
  const item = await prisma.inventoryItem.create({
    data: {
      itemCode: `${TAG}-${suffix}`,
      description: `Concurrency probe ${suffix}`,
      itemCategory: 'Fabric',
      category: 'FABRIC',
      colorCode: `${TAG}-${suffix}`,
      uom: 'Mtrs',
    },
  });
  made.items.push(item.id);
  return item;
}

/** Opening stock, through the same primitive every receipt uses. */
function receive(item, qty) {
  return prisma.$transaction((tx) =>
    postMovement(tx, {
      itemId: item.id,
      direction: 'IN',
      qty: String(qty),
      rate: '10',
      entryDate: '2026-09-01',
      documentType: 'GRN',
      documentId: randomUUID(),
      documentNo: `${TAG}-SEED`,
    }),
  );
}

/** One issue, in its own transaction, exactly as a request would run it. */
function issue(item, qty, n) {
  return prisma.$transaction((tx) =>
    postMovement(tx, {
      itemId: item.id,
      direction: 'OUT',
      qty: String(qty),
      rate: '10',
      entryDate: '2026-09-01',
      documentType: 'FABRIC_ISSUE',
      documentId: randomUUID(),
      documentNo: `${TAG}-OUT-${n}`,
    }),
  );
}

/** On hand from the ledger, which is the source of truth. */
async function onHand(itemId) {
  const agg = await prisma.stockLedger.aggregate({
    where: { itemId },
    _sum: { qtyIn: true, qtyOut: true },
  });
  return Number(agg._sum.qtyIn ?? 0) - Number(agg._sum.qtyOut ?? 0);
}

// ===========================================================================
//  F-02 - THE LEDGER MUST NOT GO NEGATIVE UNDER CONCURRENCY
// ===========================================================================

describe('F-02 - concurrent stock issues', () => {
  test(
    'three simultaneous issues of 40 against 100 on hand cannot all succeed',
    { skip: skipIfNoDb() },
    async () => {
      const item = await makeItem('OVERSELL');
      await receive(item, 100);

      /*
       * Three transactions opened at once, each asking for 40 of the 100 on
       * hand. Two of them fit and the third cannot.
       *
       * Two deliberate choices in those numbers:
       *
       *   The quantity is well UNDER the balance rather than near it. An issue
       *   of 60 against 100 is refused by the second transaction even under a
       *   partial interleaving, so a run that happened to serialise would
       *   report a clean pass over a broken guard. At 40 every transaction
       *   that reads before any other writes looks individually valid.
       *
       *   The COUNT is small. Raising it is not "more concurrent": Prisma's
       *   pool is num_cpus * 2 + 1, so six transactions queue against it and
       *   partly serialise by accident, which masked this exact bug on a first
       *   run of this file. Three get connections immediately and genuinely
       *   overlap.
       */
      const results = await Promise.allSettled([
        issue(item, 40, 1),
        issue(item, 40, 2),
        issue(item, 40, 3),
      ]);

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const balance = await onHand(item.id);

      assert.ok(
        balance >= 0,
        `The ledger went NEGATIVE (${balance} Mtrs). ${succeeded} of 3 concurrent issues of ` +
          '40 Mtrs were accepted against 100 Mtrs on hand, so stock was issued that never ' +
          'existed. postMovement() read the balance and wrote without serialising the pair.',
      );

      assert.equal(
        succeeded,
        2,
        `Exactly two issues of 40 fit in 100 Mtrs; ${succeeded} were accepted. ` +
          `Ledger now reads ${balance} Mtrs.`,
      );

      assert.equal(balance, 20, 'the two survivors should leave 100 - 80 = 20 Mtrs');
    },
  );

  test(
    'the balance cache still agrees with the ledger after a contested issue',
    { skip: skipIfNoDb() },
    async () => {
      const item = await makeItem('CACHE');
      await receive(item, 100);

      await Promise.allSettled([issue(item, 40, 1), issue(item, 40, 2), issue(item, 40, 3)]);

      const ledger = await onHand(item.id);
      const cached = await prisma.stockBalance.findFirst({ where: { itemId: item.id } });

      assert.equal(
        Number(cached?.qty ?? 0),
        ledger,
        'stock_balances drifted from the ledger it is derived from - two transactions each ' +
          'recomputed the balance from a snapshot that did not include the other.',
      );
    },
  );
});

// ===========================================================================
//  F-03 - A ROLL MUST NOT GIVE OUT MORE THAN IT RECEIVED
// ===========================================================================

describe('F-03 - concurrent writes to a fabric roll balance', () => {
  test(
    'the database refuses a roll balance driven below zero by concurrent decrements',
    { skip: skipIfNoDb() },
    async () => {
      const roll = await prisma.fabricRoll.create({
        data: { rollNo: `${TAG}-ROLL-ATOMIC`, receivedQty: '100', balanceQty: '100' },
      });
      made.rolls.push(roll.id);

      // The ATOMIC form. Postgres serialises the two row updates, the second
      // one sees 40 rather than 100, and fabric_rolls_balance_non_negative
      // refuses it. This is the shape the service must use for the existing
      // CHECK constraint to be a real backstop rather than a decoration.
      const results = await Promise.allSettled([
        prisma.$executeRaw`UPDATE fabric_rolls SET balance_qty = balance_qty - 60 WHERE id = ${roll.id}::uuid`,
        prisma.$executeRaw`UPDATE fabric_rolls SET balance_qty = balance_qty - 60 WHERE id = ${roll.id}::uuid`,
      ]);

      const refused = results.filter((r) => r.status === 'rejected');
      const after_ = await prisma.fabricRoll.findUnique({ where: { id: roll.id } });

      assert.equal(
        refused.length,
        1,
        'One of two concurrent 60 Mtr decrements against a 100 Mtr roll must be refused.',
      );
      assert.match(
        String(refused[0].reason?.message ?? refused[0].reason),
        /fabric_rolls_balance_non_negative/,
        'the refusal must come from the balance constraint, not from something incidental',
      );
      assert.equal(Number(after_.balanceQty), 40, 'the roll should be left at 100 - 60 = 40');
    },
  );

  test(
    'an absolute-value write loses an update and the CHECK constraint cannot see it',
    { skip: skipIfNoDb() },
    async () => {
      const roll = await prisma.fabricRoll.create({
        data: { rollNo: `${TAG}-ROLL-ABS`, receivedQty: '100', balanceQty: '100' },
      });
      made.rolls.push(roll.id);

      /*
       * This is what the service does today: read the balance, subtract in
       * JavaScript, write the result back as a literal. Both writers read 100,
       * both compute 40, both write 40 - and 40 is a perfectly legal value, so
       * neither CHECK constraint fires.
       *
       * The test asserts the DAMAGE, so it documents exactly why the fix has to
       * change the shape of the write and not merely add a lock somewhere.
       */
      const read = await prisma.fabricRoll.findUnique({ where: { id: roll.id } });
      const computed = Number(read.balanceQty) - 60;

      await Promise.allSettled([
        prisma.fabricRoll.update({ where: { id: roll.id }, data: { balanceQty: computed } }),
        prisma.fabricRoll.update({ where: { id: roll.id }, data: { balanceQty: computed } }),
      ]);

      const after_ = await prisma.fabricRoll.findUnique({ where: { id: roll.id } });

      assert.equal(
        Number(after_.balanceQty),
        40,
        'Two 60 Mtr issues off a 100 Mtr roll left it reading 40 - 120 Mtrs issued from 100. ' +
          'This is the lost update F-03 describes, and no constraint can catch it.',
      );
    },
  );
});
