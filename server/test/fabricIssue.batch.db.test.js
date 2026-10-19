/**
 * SEVERAL ROLLS ON ONE FABRIC ISSUE. NEEDS POSTGRESQL.
 *
 * ===========================================================================
 *  WHAT THIS PROVES
 * ===========================================================================
 *
 * `createBatch()` posts several rolls as separate issues in ONE transaction
 * under one batch number. The tests drive it through returns, because a return
 * is the one purpose that needs neither an approved cutting challan line nor a
 * job work order - and everything a batch adds (shared fields, one
 * transaction, the batch number, a ledger leg and a balance change per roll,
 * the grouped print) is the same code for every purpose.
 *
 * The rollback test is the one that matters: the second roll is set up so the
 * DATABASE refuses it - a return that would push its balance past what it
 * received trips `fabric_rolls_balance_within_received` - AFTER the first roll
 * has been fully written inside the same transaction. Nothing of the first
 * roll may survive, and the batch number may not be burned.
 *
 *     node --test test/fabricIssue.batch.db.test.js
 */

import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../src/config/prisma.js';
import * as fabricIssue from '../src/services/fabricIssue.service.js';

let live = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  live = true;
} catch {
  live = false;
}

// An existing order and user to hang the issues off; the rolls and items are
// this file's own.
const order = live
  ? await prisma.buyerOrder.findFirst({
      where: { deletedAt: null, status: { not: 'CANCELLED' } },
      select: { id: true, orderNo: true },
    })
  : null;
const user = live ? await prisma.user.findFirst({ select: { id: true } }) : null;

const skip = () =>
  !live ? 'no database reachable' : !order || !user ? 'needs one open order and one user' : false;

const TAG = `FIB-T-${Date.now()}`;
const made = { items: [], rolls: [] };
const actor = () => ({ userId: user.id, fullName: 'Batch test' });

after(async () => {
  if (live) {
    await prisma.stockLayerConsumption.deleteMany({ where: { layer: { itemId: { in: made.items } } } });
    await prisma.stockCostLayer.deleteMany({ where: { itemId: { in: made.items } } });
    await prisma.stockLedger.deleteMany({ where: { itemId: { in: made.items } } });
    await prisma.stockBalance.deleteMany({ where: { itemId: { in: made.items } } });
    await prisma.fabricIssue.deleteMany({ where: { rollId: { in: made.rolls } } });
    await prisma.fabricRoll.deleteMany({ where: { id: { in: made.rolls } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: made.items } } });
  }
  await prisma.$disconnect();
});

/** A roll of its own item, sitting in the main store. */
async function makeRoll(suffix, { received, balance }) {
  const item = await prisma.inventoryItem.create({
    data: {
      itemCode: `${TAG}-${suffix}`,
      description: `Batch probe ${suffix}`,
      itemCategory: 'Fabric',
      category: 'FABRIC',
      colorCode: `${TAG}-${suffix}`,
      uom: 'Mtrs',
    },
  });
  made.items.push(item.id);
  const roll = await prisma.fabricRoll.create({
    data: {
      rollNo: `${TAG}-${suffix}`,
      receivedQty: String(received),
      balanceQty: String(balance),
      uom: 'Mtrs',
      location: 'MAIN STORE',
      inventoryItemId: item.id,
    },
  });
  made.rolls.push(roll.id);
  return roll;
}

const returnBatch = (rolls) =>
  fabricIssue.createBatch(
    {
      purpose: 'RETURN',
      orderId: order.id,
      issuedByName: 'Batch test',
      rolls,
    },
    actor(),
  );

const batchCounter = () =>
  prisma.documentSequence.findUnique({
    where: { documentType_scopeKey: { documentType: 'FABRIC_ISSUE', scopeKey: 'BATCH' } },
    select: { nextNumber: true },
  });

describe('Fabric issue - several rolls at once', () => {
  test('every roll becomes its own issue under one batch number', { skip: skip() }, async () => {
    const a = await makeRoll('A', { received: 100, balance: 50 });
    const b = await makeRoll('B', { received: 100, balance: 40 });

    const batch = await returnBatch([
      { rollId: a.id, fabricQtyIssued: '20' },
      { rollId: b.id, fabricQtyIssued: '30' },
    ]);

    assert.match(batch.batchNo, /^FIB-\d{4,}$/);
    assert.equal(batch.issues.length, 2);
    assert.deepEqual(
      batch.issues.map((i) => i.roll.rollNo),
      [a.rollNo, b.rollNo],
      'issues are numbered in the order the rolls were given',
    );
    assert.ok(batch.issues.every((i) => i.batchNo === batch.batchNo));
    assert.equal(Number(batch.totalQty), 50);

    const [ra, rb] = await Promise.all([
      prisma.fabricRoll.findUnique({ where: { id: a.id } }),
      prisma.fabricRoll.findUnique({ where: { id: b.id } }),
    ]);
    assert.equal(Number(ra.balanceQty), 70, 'roll A got its 20 back');
    assert.equal(Number(rb.balanceQty), 70, 'roll B got its 30 back');

    const legs = await prisma.stockLedger.findMany({
      where: { rollId: { in: [a.id, b.id] }, documentType: 'FABRIC_ISSUE' },
    });
    assert.equal(legs.length, 2, 'one ledger leg per roll');

    const detail = await fabricIssue.getById(batch.issues[1].id);
    assert.equal(detail.batch.length, 2, 'either issue lists the whole batch');

    const printed = await fabricIssue.printView(batch.issues[0].id);
    assert.equal(printed.challanNo, batch.batchNo, 'the sheet carries the batch number');
    assert.equal(printed.rolls.length, 2, 'both rolls print on one sheet');
    assert.equal(Number(printed.line.qty), 50, 'the sheet total is the batch total');
  });

  test('a roll the database refuses takes the whole batch with it', { skip: skip() }, async () => {
    const ok = await makeRoll('OK', { received: 100, balance: 50 });
    // Full already: returning anything would leave it holding more than it
    // ever received, which the balance constraint refuses inside the
    // transaction - after roll OK has been written.
    const full = await makeRoll('FULL', { received: 100, balance: 100 });

    const before = await batchCounter();

    await assert.rejects(
      returnBatch([
        { rollId: ok.id, fabricQtyIssued: '10' },
        { rollId: full.id, fabricQtyIssued: '10' },
      ]),
    );

    const issues = await prisma.fabricIssue.count({ where: { rollId: { in: [ok.id, full.id] } } });
    assert.equal(issues, 0, 'no issue survives a failed batch');

    const rOk = await prisma.fabricRoll.findUnique({ where: { id: ok.id } });
    assert.equal(Number(rOk.balanceQty), 50, 'the first roll is untouched');

    const legs = await prisma.stockLedger.count({ where: { rollId: { in: [ok.id, full.id] } } });
    assert.equal(legs, 0, 'no ledger leg survives a failed batch');

    const afterwards = await batchCounter();
    assert.equal(afterwards.nextNumber, before.nextNumber, 'a failed batch burns no batch number');
  });

  test('the same roll twice is refused before anything is written', { skip: skip() }, async () => {
    const r = await makeRoll('TWICE', { received: 100, balance: 10 });
    await assert.rejects(
      returnBatch([
        { rollId: r.id, fabricQtyIssued: '5' },
        { rollId: r.id, fabricQtyIssued: '5' },
      ]),
      /listed twice/,
    );
    assert.equal(await prisma.fabricIssue.count({ where: { rollId: r.id } }), 0);
  });

  test('a lone issue still prints exactly as before', { skip: skip() }, async () => {
    const r = await makeRoll('LONE', { received: 100, balance: 10 });
    const issue = await fabricIssue.create(
      {
        purpose: 'RETURN',
        orderId: order.id,
        issuedByName: 'Batch test',
        rollId: r.id,
        fabricQtyIssued: '5',
      },
      actor(),
    );
    assert.equal(issue.batchNo, null);
    assert.deepEqual(issue.batch, []);

    const printed = await fabricIssue.printView(issue.id);
    assert.equal(printed.challanNo, issue.issueNo);
    assert.equal(printed.rolls.length, 1);
    assert.equal(Number(printed.line.qty), 5);
  });
});
