/**
 * INWARD INSPECTION OF A RECEIVED ROLL. NEEDS POSTGRESQL.
 *
 * After a GRN, every roll waits for inspection: measured length against the
 * bill, width and GSM against the order, and the faulty length. Recording it
 * is a RECORD, not a gate - it moves no stock and holds nothing. A roll that
 * should not be cut goes to a Fabric Scrutiny, where the Director decides.
 *
 * Works on seeded GRN rolls and puts back every field it touches.
 *
 *      node --test test/inspection.db.test.js
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../src/config/prisma.js';
import * as inventory from '../src/services/inventory.service.js';
import * as reports from '../src/services/report.service.js';

let live = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  live = true;
} catch {
  live = false;
}
const skip = live ? false : 'no database configured - skipping';

const actor = { userId: null, fullName: 'Inspection Test' };

/** The fields inspection writes, so `after()` can put each roll back. */
const FIELDS = [
  'inspectionStatus', 'inspectedQty', 'inspectedWidth', 'inspectedGsm',
  'inspectionDefectQty', 'inspectionRemarks', 'inspectedAt', 'inspectedById', 'inspectedByName',
];
let rolls = [];
const before_ = new Map();

before(async () => {
  if (!live) return;
  rolls = await prisma.fabricRoll.findMany({
    where: { grnId: { not: null }, deletedAt: null },
    orderBy: { rollNo: 'asc' },
    take: 2,
  });
  assert.equal(rolls.length, 2, 'the seed must provide two rolls received on a GRN');
  for (const r of rolls) before_.set(r.id, Object.fromEntries(FIELDS.map((f) => [f, r[f]])));
});

after(async () => {
  if (live) {
    for (const [id, data] of before_) await prisma.fabricRoll.update({ where: { id }, data });
  }
  await prisma.$disconnect();
});

describe('inward inspection', { skip }, () => {
  test('a pass records what was measured, and who measured it', async () => {
    const [roll] = rolls;
    await inventory.inspectRoll(
      roll.id,
      { status: 'PASSED', inspectedQty: '98.5', inspectedWidth: '62', inspectedGsm: '318', defectQty: '1.5', remarks: 'two small slubs' },
      actor,
    );
    const row = await prisma.fabricRoll.findUnique({ where: { id: roll.id } });
    assert.equal(row.inspectionStatus, 'PASSED');
    assert.equal(Number(row.inspectedQty), 98.5);
    assert.equal(Number(row.inspectedWidth), 62);
    assert.equal(Number(row.inspectedGsm), 318);
    assert.equal(Number(row.inspectionDefectQty), 1.5);
    assert.equal(row.inspectedByName, 'Inspection Test');
    assert.ok(row.inspectedAt);
  });

  test('more faulty length than the roll holds is refused, and nothing is written', async () => {
    const [roll] = rolls;
    await assert.rejects(
      inventory.inspectRoll(roll.id, { status: 'FAILED', inspectedQty: '50', defectQty: '60' }, actor),
      (e) => e.status === 400 && /cannot be faulty/.test(e.message),
    );
    const row = await prisma.fabricRoll.findUnique({ where: { id: roll.id } });
    assert.equal(row.inspectionStatus, 'PASSED', 'the earlier result stands');
  });

  test('a failed inspection moves nothing - stage, hold and balance are untouched', async () => {
    const [, roll] = rolls;
    await inventory.inspectRoll(roll.id, { status: 'FAILED', remarks: 'shade off standard' }, actor);
    const row = await prisma.fabricRoll.findUnique({ where: { id: roll.id } });
    assert.equal(row.inspectionStatus, 'FAILED');
    assert.equal(row.stage, roll.stage);
    assert.equal(row.isHeld, roll.isHeld);
    assert.equal(Number(row.balanceQty), Number(roll.balanceQty));
  });

  test('a batch records each roll on its own, and reports the ones it could not', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    const res = await inventory.inspectRollBatch(
      { rollIds: [rolls[0].id, rolls[1].id, missing], status: 'PASSED', remarks: 'GRN passed in one go' },
      actor,
    );
    assert.deepEqual(res.inspected.map((r) => r.rollId).sort(), [rolls[0].id, rolls[1].id].sort());
    assert.equal(res.failed.length, 1);
    assert.equal(res.failed[0].rollId, missing);
  });

  test('the Inward inspection report shows the result', async () => {
    const [roll] = rolls;
    await inventory.inspectRoll(roll.id, { status: 'FAILED', inspectedQty: '90', defectQty: '4' }, actor);
    const report = await reports.run('inward-inspection', { inspectionStatus: 'FAILED', pageSize: 500 });
    const row = report.rows.find((r) => r.rollNo === roll.rollNo);
    assert.ok(row, `roll ${roll.rollNo} is listed under FAILED`);
    assert.equal(Number(row.measuredQty), 90);
    assert.equal(Number(row.defectQty), 4);
  });
});
