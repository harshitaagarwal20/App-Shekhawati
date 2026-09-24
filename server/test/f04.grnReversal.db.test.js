/**
 * F-04 - THE GRN CORRECTION PATH. REQUIRES A DATABASE.
 *
 *     npm run db:setup          # migrate + seed
 *     node --test test/f04.grnReversal.db.test.js
 *
 * ===========================================================================
 *  WHY THIS FILE EXISTS
 * ===========================================================================
 *
 * The audit's finding was not that the reversal was buggy. It was that there
 * was no reversal at all, while two error messages told the user there was:
 * "a posted receipt is corrected by a reversal, not by a status change". A
 * mis-keyed receipt could only be undone with SQL against production.
 *
 * Everything below is a DATABASE question - what moved, what came back, which
 * numbers were freed - so none of it can be proved in a rules file. The tests
 * drive the real service entry points, not the HTTP layer, because what is
 * being asserted is the correction's effect on stock, on the purchase order
 * and on the receipt, and routing is a different control's test.
 *
 * ---------------------------------------------------------------------------
 *  THE INVARIANT
 *
 *  A reversal is right when, afterwards:
 *
 *    - the stock ledger nets to what it held before the receipt;
 *    - the purchase order's received and payable quantities are back;
 *    - the receipt still says it was posted, because it was;
 *    - the vendor's bill number and the roll's label are free to be used
 *      again, because the same delivery is about to be re-keyed correctly.
 *
 *  The last one is what makes the document useful rather than merely correct.
 *  A reversal that undoes the stock and then blocks the re-entry has moved the
 *  problem rather than solved it.
 * ---------------------------------------------------------------------------
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import prisma from '../src/config/prisma.js';
import * as grnSvc from '../src/services/grn.service.js';
import * as revSvc from '../src/services/grnReversal.service.js';
import { availableQty, postMovement, recomputeBalance } from '../src/services/inventory.service.js';

const D = (v) => new Prisma.Decimal(v ?? 0);

/**
 * Whether a database is actually reachable.
 *
 * Probed with a TOP-LEVEL await, not in `before()`: node:test evaluates a
 * test's `skip` option when the `describe` body runs, which is before any hook
 * fires. Same note as concurrency.stock.test.js.
 */
let live = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  live = true;
} catch {
  live = false;
}
const skipIfNoDb = () => (live ? false : 'no database reachable');

const stamp = Date.now();

/** Two real people, because maker-checker needs somebody to compare against. */
let maker;
let checker;
let po;

/** Everything this file creates, torn down in `after()` whatever happened. */
const madeGrns = [];
const madeReversals = [];
let poBefore;

before(async () => {
  if (!live) return;

  const users = await prisma.user.findMany({ where: { deletedAt: null }, take: 2 });
  assert.ok(users.length >= 2, 'seed must provide at least two users');
  maker = { userId: users[0].id, fullName: `F04 maker ${users[0].username}` };
  checker = { userId: users[1].id, fullName: `F04 checker ${users[1].username}` };

  po = await prisma.purchaseOrder.findFirst({
    where: { deletedAt: null, workflowState: { notIn: ['CANCELLED', 'REJECTED'] } },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(po, 'seed must provide a purchase order');

  // The order's figures as they stood, so `after()` can put them back exactly.
  poBefore = { receivedQty: po.receivedQty, payableQty: po.payableQty, status: po.status };
});

after(async () => {
  if (live) {
    const grnIds = madeGrns.map((g) => g.id);
    await prisma.$transaction(async (tx) => {
      await tx.approvalHistory.deleteMany({
        where: { documentId: { in: [...grnIds, ...madeReversals] } },
      });
      /*
       * TWO DELETES, BECAUSE NOT EVERY ROW THIS FILE WRITES CARRIES `grnId`.
       *
       * The simulated issue in "a receipt whose goods have been issued" posts
       * a FABRIC_ISSUE movement, and a fabric issue is not a receipt - it has
       * no `grnId`, exactly as the real one does not. Deleting by `grnId`
       * alone left that OUT row behind, and it is an OUT: every run of this
       * file permanently shaved five units off the item's balance in whatever
       * database it was pointed at.
       *
       * Matched on the document number instead, which this file stamps with
       * its own prefix for precisely this reason.
       */
      /*
       * FIFO - put back what these movements took from each cost layer, then
       * remove the layers they opened. The item is a real one in whatever
       * database this runs against, so a layer it drew down but did not open
       * (an opening layer) has to end the run holding what it started with.
       */
      const ours = await tx.stockLedger.findMany({
        where: { OR: [{ grnId: { in: grnIds } }, { documentNo: { startsWith: 'F04-ISSUE-' } }] },
        select: { id: true },
      });
      const ourIds = ours.map((r) => r.id);
      const taken = await tx.stockLayerConsumption.findMany({ where: { ledgerId: { in: ourIds } } });
      for (const c of taken) {
        await tx.stockCostLayer.update({ where: { id: c.layerId }, data: { qtyRemaining: { increment: c.qty } } });
      }
      await tx.stockLayerConsumption.deleteMany({ where: { ledgerId: { in: ourIds } } });
      await tx.stockLayerConsumption.deleteMany({ where: { layer: { sourceLedgerId: { in: ourIds } } } });
      await tx.stockCostLayer.deleteMany({ where: { sourceLedgerId: { in: ourIds } } });
      await tx.stockLedger.deleteMany({ where: { grnId: { in: grnIds } } });
      await tx.stockLedger.deleteMany({ where: { documentNo: { startsWith: 'F04-ISSUE-' } } });
      await tx.grnReversal.deleteMany({ where: { grnId: { in: grnIds } } });
      await tx.fabricRoll.deleteMany({ where: { grnId: { in: grnIds } } });
      await tx.grn.deleteMany({ where: { id: { in: grnIds } } });
      if (po) await tx.purchaseOrder.update({ where: { id: po.id }, data: poBefore });

      /*
       * And rebuild the balance cache from what is left of the ledger. The
       * rows above were deleted underneath it, and `stock_balances` is a cache
       * of an aggregate - leaving it stale would hand the next test, or the
       * next person to open the stock screen, a figure the movements do not
       * support.
       */
      for (const itemId of new Set(madeGrns.map((g) => g.inventoryItemId).filter(Boolean))) {
        for (const location of new Set(madeGrns.map((g) => g.location))) {
          await recomputeBalance(tx, itemId, location);
        }
      }
    });
  }
  await prisma.$disconnect();
});

/**
 * Books a receipt through the real service, and remembers it for teardown.
 *
 * `acknowledgeToleranceBreach` because the seed's purchase orders are already
 * at or over their receipt tolerance, and this file is not testing tolerance -
 * it is testing what happens after a receipt exists.
 */
async function receive({ qty, billNo, rollNo } = {}) {
  const grn = await grnSvc.create(
    {
      purchaseOrderId: po.id,
      billNo: billNo ?? `F04-${stamp}-${madeGrns.length}`,
      purpose: 'RAW_MATERIAL',
      receivingQty: String(qty ?? 25),
      ...(rollNo ? { rollNo } : {}),
      acknowledgeToleranceBreach: true,
    },
    maker,
  );
  madeGrns.push(grn);
  return grn;
}

/** Raises a reversal and remembers it. Submitted, not yet signed. */
async function raise(grn, reason) {
  const rev = await revSvc.create({ grnId: grn.id, reason }, maker);
  madeReversals.push(rev.id);
  return rev;
}

// ===========================================================================

describe('F-04 - a posted receipt can be corrected', { skip: skipIfNoDb() }, () => {
  test('the reversal takes the stock back out and gives the order its quantity back', async () => {
    const stockBefore = await (async () => {
      const g = await receive({ qty: 25 });
      return { grn: g, after: await availableQty(prisma, g.inventoryItemId, g.location) };
    })();
    const { grn } = stockBefore;

    const poAfterReceipt = await prisma.purchaseOrder.findUnique({ where: { id: po.id } });

    const rev = await raise(grn, 'Quantity was keyed as 25 when the delivery was 2.5.');
    assert.equal(
      rev.workflowState,
      'PENDING_APPROVAL',
      'a submitted reversal must be waiting on a decision, not parked at SUBMITTED where ' +
        'the transition table cannot approve it and the queue cannot see it',
    );

    await revSvc.approve(rev.id, { remarks: 'Agreed.' }, checker);

    const stockAfter = await availableQty(prisma, grn.inventoryItemId, grn.location);
    const poAfter = await prisma.purchaseOrder.findUnique({ where: { id: po.id } });

    assert.equal(
      stockAfter.toFixed(4),
      stockBefore.after.minus(D(25)).toFixed(4),
      'the reversal must take out exactly what the receipt brought in',
    );
    assert.equal(
      D(poAfter.receivedQty).toFixed(4),
      D(poAfterReceipt.receivedQty).minus(D(25)).toFixed(4),
      "the purchase order's received quantity must come back",
    );
    assert.equal(
      D(poAfter.payableQty).toFixed(4),
      D(poAfterReceipt.payableQty).minus(D(25)).toFixed(4),
      'payableQty is what the vendor is owed for, and it must come back too',
    );
  });

  test('the receipt is stamped, not rewritten', async () => {
    const grn = await receive({ qty: 10 });
    const rev = await raise(grn, 'Received against the wrong purchase order entirely.');
    await revSvc.approve(rev.id, {}, checker);

    const after = await prisma.grn.findUnique({ where: { id: grn.id } });

    assert.ok(after.reversedAt, 'the receipt must record that it was reversed');
    assert.ok(after.reversedByName, 'and who signed the reversal');
    assert.equal(
      after.workflowState,
      'POSTED',
      'the receipt WAS posted; rewriting that would destroy the history the reversal ' +
        'exists to preserve',
    );
    assert.equal(after.status, 'COMPLETED', 'and the goods DID arrive');

    // Both legs of the correction are on the ledger, under their own documents.
    const ledger = await prisma.stockLedger.findMany({
      where: { grnId: grn.id },
      orderBy: { createdAt: 'asc' },
      select: { documentType: true, direction: true, qty: true },
    });
    assert.deepEqual(
      ledger.map((l) => [l.documentType, l.direction, D(l.qty).toFixed(4)]),
      [
        ['GRN', 'IN', '10.0000'],
        ['GRN_REVERSAL', 'OUT', '10.0000'],
      ],
      'the reversal posts its own document type, so a movement never misreports its source',
    );
  });

  test('the vendor bill and the roll label are free to be re-keyed', async () => {
    const billNo = `F04-REKEY-${stamp}`;
    const rollNo = `F04R${stamp}`.slice(0, 40);

    const wrong = await receive({ qty: 40, billNo, rollNo });
    const rev = await raise(wrong, 'Quantity keyed from the wrong line of the vendor bill.');
    await revSvc.approve(rev.id, {}, checker);

    /*
     * THE POINT OF THE WHOLE DOCUMENT.
     *
     * A reversal that undoes the stock and then refuses the correction has
     * moved the problem rather than solved it. Both the bill number and the
     * roll label have to come back, and each is freed by its own partial
     * unique index - grns_live_bill_per_po and fabric_rolls_live_roll_no.
     */
    const right = await receive({ qty: 4, billNo, rollNo });

    assert.equal(D(right.receivingQty).toFixed(4), '4.0000');
    assert.equal(right.billNo, billNo, 'the same vendor bill must be re-enterable');

    const roll = await prisma.fabricRoll.findFirst({
      where: { rollNo, deletedAt: null },
      select: { grnId: true, balanceQty: true },
    });
    assert.ok(roll, 'the physical roll is still on the rack and must be enterable by its label');
    assert.equal(roll.grnId, right.id, 'and it now belongs to the corrected receipt');

    const writtenOff = await prisma.fabricRoll.findFirst({
      where: { rollNo, writtenOffAt: { not: null } },
      select: { balanceQty: true, deletedAt: true },
    });
    assert.ok(writtenOff, 'the written-off row stays, explaining what happened to the first one');
    assert.equal(D(writtenOff.balanceQty).toFixed(4), '0.0000');
    assert.ok(writtenOff.deletedAt, 'a written-off roll is out of every live-roll query');
  });
});

describe('F-04 - what a reversal refuses', { skip: skipIfNoDb() }, () => {
  test('the person who raised it cannot also sign it', async () => {
    const grn = await receive({ qty: 6 });
    const rev = await raise(grn, 'Rate was taken from the previous bill by mistake.');

    await assert.rejects(
      () => revSvc.approve(rev.id, {}, maker),
      (e) => /cannot also approve|maker and checker/i.test(e.message),
      'this is the one document whose whole purpose is to undo the raiser\'s own work, so ' +
        'self-approval would leave no maker-checker at all',
    );

    // And the refusal left the ledger alone.
    const after = await prisma.grnReversal.findUnique({ where: { id: rev.id } });
    assert.equal(after.postedAt, null, 'a refused approval must not have posted anything');

    await revSvc.approve(rev.id, {}, checker);
  });

  test('a receipt is reversed once', async () => {
    const grn = await receive({ qty: 8 });
    const rev = await raise(grn, 'Booked twice - this is the duplicate.');
    await revSvc.approve(rev.id, {}, checker);

    await assert.rejects(
      () => raise(grn, 'Trying to reverse the same receipt a second time.'),
      (e) => /already reversed/i.test(e.message),
    );
  });

  test('only one reversal is open against a receipt at a time', async () => {
    const grn = await receive({ qty: 7 });
    await raise(grn, 'Quantity looks wrong against the delivery note.');

    await assert.rejects(
      () => raise(grn, 'A second opinion, raised while the first is still open.'),
      (e) => /already open/i.test(e.message),
      'two open reversals could both pass their checks and both post, taking the stock ' +
        'out twice',
    );
  });

  test('a receipt whose goods have been issued cannot be reversed', async () => {
    const grn = await receive({ qty: 30 });
    const roll = await prisma.fabricRoll.findFirst({ where: { grnId: grn.id, deletedAt: null } });
    assert.ok(roll, 'the receipt should have created a roll');

    /*
     * Consume part of the roll the way an issue does - through postMovement(),
     * so the ledger and the roll balance move together, exactly as
     * fabricIssue.service.js leaves them.
     */
    await prisma.$transaction(async (tx) => {
      await postMovement(tx, {
        itemId: grn.inventoryItemId,
        rollId: roll.id,
        direction: 'OUT',
        qty: '5',
        rate: grn.inventoryRate,
        entryDate: new Date(),
        location: grn.location,
        documentType: 'FABRIC_ISSUE',
        documentId: roll.id,
        documentNo: `F04-ISSUE-${stamp}`,
        remarks: 'F-04 test: cloth leaves the store before anybody notices the keying error.',
        actor: maker,
      });
      await tx.fabricRoll.update({
        where: { id: roll.id },
        data: { balanceQty: { decrement: D(5) } },
      });
    });

    const eligibility = await revSvc.eligibility(grn.id);
    assert.equal(eligibility.reversible, false);
    assert.ok(
      eligibility.blockers.some((b) => b.includes(roll.rollNo)),
      'the refusal must name the roll, so the storeman knows which one moved rather than ' +
        `being told only that something did. Got: ${JSON.stringify(eligibility.blockers)}`,
    );

    await assert.rejects(
      () => raise(grn, 'Trying to reverse a receipt whose cloth has already been issued.'),
      (e) => /cannot be reversed/i.test(e.message),
    );
  });

  test('an unposted receipt is deleted, not reversed', async () => {
    /*
     * There is no way to make one through the service - a GRN is born posted -
     * so the state is built directly. The point is that the reversal refuses
     * it and says what to do instead, rather than posting a counter-movement
     * against a receipt that never moved anything.
     */
    const grn = await receive({ qty: 5 });
    await prisma.grn.update({ where: { id: grn.id }, data: { postedAt: null } });

    const eligibility = await revSvc.eligibility(grn.id);
    assert.equal(eligibility.reversible, false);
    assert.ok(
      eligibility.blockers.some((b) => /never reached stock/i.test(b)),
      `expected a "never reached stock" refusal, got ${JSON.stringify(eligibility.blockers)}`,
    );

    await prisma.grn.update({ where: { id: grn.id }, data: { postedAt: new Date() } });
  });

  test('a posted reversal cannot be deleted', async () => {
    const grn = await receive({ qty: 9 });
    const rev = await raise(grn, 'Wrong rate entered against this delivery.');
    await revSvc.approve(rev.id, {}, checker);

    await assert.rejects(
      () => revSvc.remove(rev.id, maker.userId),
      (e) => /append-only|cannot be deleted/i.test(e.message),
      'a reversal is as permanent as the receipt it undid',
    );
  });
});
