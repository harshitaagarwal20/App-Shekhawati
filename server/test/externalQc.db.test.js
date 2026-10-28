/**
 * EXTERNAL QC AND THE ALTERATION UNIT, OVER HTTP. NEEDS A SEEDED POSTGRESQL.
 * Never run against production.
 *
 * Every rule in the Phase 4 brief, driven through the real API:
 *
 *   - Approved + Alteration + Rejected = Pcs Offered; each box's reasons add up
 *   - Pcs Offered never more than the order's net ironed qty
 *   - "Iron" (either box) goes back to ironing, source Re-iron
 *   - every other reason goes to the Alteration Unit - never to a stitching unit
 *   - altered + not repairable never more than a bag received
 *   - altered pieces go back through ironing (From Alteration Unit) and
 *     External QC again
 *   - not repairable pieces make the Rejected Register, stage Alteration Unit,
 *     with the original reason
 *   - Phase 3's pending rejects are converted into bags
 *   - the pipeline adds back up: no piece counted twice
 *   - the reports, the Checker Report, the Excel export, the roles
 *
 * Works on one order cut for Unit 2 and removes everything it wrote.
 *
 *      node --test test/externalQc.db.test.js
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import bcrypt from 'bcryptjs';

import { createApp } from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { istIsoDate } from '../src/utils/dates.js';
import { finishingPipeline } from '../src/services/reports.finishing.js';

const USER_PASSWORD = process.env.SEED_DEFAULT_USER_PASSWORD || 'Shekhawati@123';

let live = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  live = (await prisma.user.count({ where: { username: { in: ['extqc', 'alteration', 'finishing', 'mahipal'] } } })) === 4;
} catch {
  live = false;
}
const skip = live ? false : 'no seeded database with the Phase 4 users - skipping';

let server;
let base;
const tokens = {};

async function call(method, path, { as, body, form } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(form ? {} : { 'Content-Type': 'application/json' }),
      ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}),
    },
    ...(form ? { body: form } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* CSV or a file */
  }
  return { status: res.status, body: parsed };
}

async function signIn(username, password = USER_PASSWORD) {
  await prisma.user.updateMany({
    where: { username },
    data: { mustChangePassword: false, passwordHash: await bcrypt.hash(password, 10) },
  });
  const res = await call('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(res.status, 200, `login for ${username} failed`);
  tokens[username] = res.body.data.accessToken;
}

const UNIT2 = 'Unit 2 - Mahipal';
const today = istIsoDate();
const yesterday = istIsoDate(new Date(Date.now() - 86400000));

let opt; // the order and style
let ironer;
let staff;
let agency;
let checker;
let stitchingId;
const ironingIds = [];
const qcIds = [];
const challansBefore = [];
let ironingRejectEntry;

const OS = () => ({ orderId: opt.orderId, styleId: opt.styleId });
const flowNow = async () => (await call('GET', `/api/external-qc/position?orderId=${opt.orderId}&styleId=${opt.styleId}`, { as: 'extqc' })).body.data.flow;
// The finishing pipeline is no longer a report, but it is still the check that every piece is somewhere.
const pipelineRow = async () => (await finishingPipeline({ orderId: opt.orderId })).rows.find((r) => r.styleNo === opt.styleNo);
const ironingPost = async (body) => {
  const res = await call('POST', '/api/ironing', { as: 'finishing', body: { ...OS(), ...body } });
  if (res.status === 201) ironingIds.push(res.body.data.id);
  return res;
};
const qcPost = async (body) => {
  const res = await call('POST', '/api/external-qc', { as: 'extqc', body: { ...OS(), agencyId: agency.id, entryDate: today, ...body } });
  if (res.status === 201) qcIds.push(res.body.data.id);
  return res;
};
const bagsOfOrder = async () => ({
  rows: (await call('GET', `/api/alteration/bags?orderId=${opt.orderId}&styleId=${opt.styleId}&status=ALL&pageSize=100`, { as: 'alteration' })).body.data,
});
const bagOf = (bags, reason, box) => bags.find((b) => b.reason === reason && (box === undefined || b.box === box));

/** Zero for every reason not given. */
const reasons = (r = {}) => ({
  altAlter: '0', altIron: '0', altDefected: '0', altSpoiled: '0', altOther: '0',
  rejAlter: '0', rejIron: '0', rejDefected: '0', rejSpoiled: '0', rejOther: '0',
  ...r,
});

before(async () => {
  if (!live) return;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const u of ['mahipal', 'finishing', 'extqc', 'alteration', 'dinesh']) await signIn(u);
  await signIn('admin', process.env.SEED_ADMIN_PASSWORD || 'Admin@123');

  const opts = (await call('GET', '/api/stitching/orders', { as: 'mahipal' })).body.data;
  opt = opts.sort((a, b) => Number(b.pcsIssued) - Number(a.pcsIssued))[0];
  ironer = await prisma.employee.findFirst({ where: { designation: 'Ironer', status: 'ACTIVE' } });
  staff = await prisma.employee.findFirst({ where: { department: 'Alteration', status: 'ACTIVE' } });
  agency = await prisma.vendor.findFirst({ where: { category: 'External QC', status: 'ACTIVE' } });
  checker = await prisma.employee.findFirst({ where: { designation: 'Checker', status: 'ACTIVE' }, orderBy: { empId: 'asc' } });
  const challans = await prisma.cuttingIssue.findMany({ where: { firmName: UNIT2, orderId: opt.orderId, styleId: opt.styleId } });
  challansBefore.push(...challans.map((c) => ({ id: c.id, pcsReceivedAtIroning: c.pcsReceivedAtIroning, ironingReceiptStatus: c.ironingReceiptStatus })));
});

after(async () => {
  if (live && opt) {
    const where = OS();
    await prisma.rejectedRegisterEntry.deleteMany({ where });
    await prisma.alterationEntry.deleteMany({ where });
    await prisma.alterationReceipt.deleteMany({ where });
    await prisma.pendingReject.deleteMany({ where });
    await prisma.externalQcEntry.deleteMany({ where: { id: { in: qcIds } } });
    await prisma.ironingEntry.deleteMany({ where: { id: { in: ironingIds } } });
    if (stitchingId) await prisma.stitchingRecord.delete({ where: { id: stitchingId } });
    for (const c of challansBefore) {
      await prisma.cuttingIssue.update({ where: { id: c.id }, data: { pcsReceivedAtIroning: c.pcsReceivedAtIroning, ironingReceiptStatus: c.ironingReceiptStatus } });
    }
  }
  server?.close();
  await prisma.$disconnect();
});

describe('External QC and the Alteration Unit', { skip }, () => {
  test('setup: Unit 2 stitches 1,000; ironing receives them, irons 950, damages 50 (30 re-iron, 20 rejected)', async () => {
    assert.ok(agency && staff && checker && ironer, 'the seed has an agency, alteration staff, a checker and an ironer');
    const st = await call('POST', '/api/stitching/records', {
      as: 'mahipal',
      body: { recordDate: yesterday, ...OS(), deliverableQty: '1000', actualStitched: '1000' },
    });
    assert.equal(st.status, 201, JSON.stringify(st.body));
    stitchingId = st.body.data.id;

    const rec = await ironingPost({ fromUnit: UNIT2, pcsReceived: '1000' });
    assert.equal(rec.status, 201, JSON.stringify(rec.body));
    assert.equal(rec.body.data.source, 'STITCHING_UNIT');
    const work = await ironingPost({
      fromUnit: UNIT2, ironerId: ironer.id, pcsIroned: '950', pcsDamaged: '50', damageType: 'Water Mark', pcsReIroned: '30', pcsRejected: '20',
    });
    assert.equal(work.status, 201, JSON.stringify(work.body));
    ironingRejectEntry = work.body.data.id;
  });

  test("Phase 3's pending sends are converted into bags in the Alteration Unit", async () => {
    // Put the ironing reject back the way Phase 3 left it - a PENDING pending
    // reject and no bag - and run the migration's own conversion on it.
    await prisma.alterationReceipt.deleteMany({ where: { ironingEntryId: ironingRejectEntry } });
    const pr = await prisma.pendingReject.create({
      data: { source: 'IRONING', ironingEntryId: ironingRejectEntry, ...OS(), unit: UNIT2, qty: '20', reason: 'Ironing damage', defectType: 'Water Mark' },
    });
    const sql = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations/20261020000500_external_qc_and_alteration/migration.sql'),
      'utf8',
    );
    const block = sql.slice(sql.indexOf("-- --- Phase 3's pending rejects"), sql.indexOf('-- --- Permissions'));
    for (const stmt of block.split(/;\s*\r?\n/).map((x) => x.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }
    const bag = await prisma.alterationReceipt.findUnique({ where: { pendingRejectId: pr.id } });
    assert.ok(bag, 'the pending reject became a bag');
    assert.equal(Number(bag.qty), 20);
    assert.equal(bag.source, 'IRONING');
    assert.equal(bag.ironingEntryId, ironingRejectEntry);
    assert.equal(bag.reason, 'Ironing damage');
    assert.equal(bag.defectType, 'Water Mark');
    assert.equal(bag.unit, UNIT2);
    assert.equal(bag.status, 'OPEN');
    assert.equal((await prisma.pendingReject.findUnique({ where: { id: pr.id } })).status, 'TRANSFERRED');
  });

  test('the Order dropdown offers 950 net ironed', async () => {
    const res = await call('GET', '/api/external-qc/orders', { as: 'extqc' });
    const row = res.body.data.find((o) => o.orderId === opt.orderId && o.styleId === opt.styleId);
    assert.ok(row);
    opt.styleNo = row.styleNo;
    assert.equal(Number(row.pcsAvailable), 950);
  });

  test('Pcs Offered cannot exceed the net ironed qty', async () => {
    const res = await qcPost({ pcsOffered: '951', pcsApproved: '951', ...reasons() });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /cannot exceed the order's net ironed qty/);
  });

  test('the three boxes must add up to Pcs Offered', async () => {
    const res = await qcPost({ pcsOffered: '100', pcsApproved: '90', pcsAlteration: '5', ...reasons({ altAlter: '5' }) });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /must add up to the pieces offered/);
  });

  test("each box's reasons must add up to the box", async () => {
    const res = await qcPost({
      pcsOffered: '100', pcsApproved: '80', pcsAlteration: '15', pcsRejected: '5', ...reasons({ altAlter: '10', rejSpoiled: '5' }),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Alteration box holds 15 but its reasons add up to 10/);
  });

  test('an inspection: 900 offered - 800 approved, 70 alteration, 30 rejected; two checker codes', async () => {
    const res = await qcPost({
      pcsOffered: '900',
      pcsApproved: '800',
      pcsAlteration: '70',
      pcsRejected: '30',
      ...reasons({ altAlter: '40', altIron: '20', altDefected: '10', rejIron: '5', rejSpoiled: '15', rejOther: '10' }),
      inspectorName: 'Priya',
      checkers: [{ checkerCode: checker.empId.toLowerCase(), pcs: '25' }, { checkerCode: ' X-9 ', pcs: '10' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const e = res.body.data;
    assert.equal(Number(e.pcsIron), 25);
    assert.equal(Number(e.pcsToAlterationUnit), 75);
    assert.equal(e.approvedPct, '88.9%');
    const codes = Object.fromEntries(e.checkers.map((c) => [c.checkerCode, c]));
    assert.equal(codes[checker.empId].employee.id, checker.id, 'a code that is an Emp ID is linked to the checker');
    assert.equal(codes['X-9'].employee, null);
  });

  test('Iron goes back to ironing; every other reason is a bag in the Alteration Unit', async () => {
    const f = await flowNow();
    assert.equal(Number(f.waitingForQc), 50, '950 ironed - 900 offered');
    assert.equal(Number(f.reIronPending), 25, '20 + 5 with reason Iron');
    assert.equal(Number(f.atAlteration), 95, '75 from External QC + 20 rejected at ironing');

    const bags = await bagsOfOrder();
    assert.equal(bags.rows.filter((b) => b.status !== 'CANCELLED').length, 5);
    assert.ok(!bags.rows.some((b) => b.reason === 'Iron'), 'Iron is never a bag');
    assert.equal(Number(bagOf(bags.rows, 'Alter', 'ALTERATION').qty), 40);
    assert.equal(Number(bagOf(bags.rows, 'Defected', 'ALTERATION').qty), 10);
    assert.equal(Number(bagOf(bags.rows, 'Spoiled', 'REJECTED').qty), 15);
    assert.equal(Number(bagOf(bags.rows, 'Other', 'REJECTED').qty), 10);
    assert.equal(Number(bagOf(bags.rows, 'Ironing damage').qty), 20);
  });

  test('nothing goes back to the stitching unit', async () => {
    const opts = (await call('GET', '/api/ironing/orders', { as: 'finishing' })).body.data;
    const unitRow = opts.find((o) => o.orderId === opt.orderId && o.styleId === opt.styleId && o.source === 'STITCHING_UNIT');
    assert.equal(unitRow.unit, UNIT2);
    assert.equal(Number(unitRow.pcsAvailableToReceive), 0, 'Unit 2 has nothing more to send - its pieces did not come back to it');
    const bags = await bagsOfOrder();
    assert.ok(bags.rows.filter((b) => b.source === 'EXTERNAL_QC').every((b) => b.unit === null), 'no External QC bag names a unit');
  });

  test('the pipeline adds up: 1,000 received from the unit, each piece in one place', async () => {
    const r = await pipelineRow();
    assert.equal(Number(r.receivedFromUnits), 1000);
    assert.equal(Number(r.atIroning), 30);
    assert.equal(Number(r.waitingForQc), 50);
    assert.equal(Number(r.approved), 800);
    assert.equal(Number(r.reIronPending), 25);
    assert.equal(Number(r.atAlteration), 95);
    assert.equal(Number(r.accounted), 1000);
    assert.equal(Number(r.difference), 0);
  });

  test('re-iron: no more can be received than External QC sent back, and never from a unit', async () => {
    const tooMany = await ironingPost({ source: 'RE_IRON', pcsReceived: '26' });
    assert.equal(tooMany.status, 409);
    assert.match(tooMany.body.error.message, /sent back only 25 with reason Iron/);

    const res = await ironingPost({ source: 'RE_IRON', fromUnit: UNIT2, pcsReceived: '25', ironerId: ironer.id, pcsIroned: '25' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.source, 'RE_IRON');
    assert.equal(res.body.data.fromUnit, null, 'a unit sent with a re-iron entry is ignored');

    const f = await flowNow();
    assert.equal(Number(f.reIronPending), 0, 'the 25 left External QC and are at ironing - counted once');
    assert.equal(Number(f.waitingForQc), 75, '50 + the 25 ironed again, waiting for External QC again');
  });

  test('the Alteration Unit: altered + not repairable cannot exceed the bag', async () => {
    const bags = (await bagsOfOrder()).rows;
    const alter = bagOf(bags, 'Alter', 'ALTERATION');
    const res = await call('POST', '/api/alteration', {
      as: 'alteration',
      body: { entryDate: today, staffId: staff.id, lines: [{ receiptId: alter.id, pcsAltered: '36', pcsNotRepairable: '5', notRepairableReason: 'Torn' }] },
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /1 more than were received/);
  });

  test('not repairable needs a reason; the staff must be of the Alteration department', async () => {
    const alter = bagOf((await bagsOfOrder()).rows, 'Alter', 'ALTERATION');
    const noReason = await call('POST', '/api/alteration', {
      as: 'alteration', body: { staffId: staff.id, lines: [{ receiptId: alter.id, pcsNotRepairable: '2' }] },
    });
    assert.equal(noReason.status, 400);
    const ironerAsStaff = await call('POST', '/api/alteration', {
      as: 'alteration', body: { staffId: ironer.id, lines: [{ receiptId: alter.id, pcsAltered: '2' }] },
    });
    assert.equal(ironerAsStaff.status, 400);
    assert.match(ironerAsStaff.body.error.message, /Alteration department/);
  });

  test('two bags worked: 45 altered, 10 not repairable - into the Rejected Register with the original reason', async () => {
    const bags = (await bagsOfOrder()).rows;
    const alter = bagOf(bags, 'Alter', 'ALTERATION');
    const spoiled = bagOf(bags, 'Spoiled', 'REJECTED');
    const res = await call('POST', '/api/alteration', {
      as: 'alteration',
      body: {
        entryDate: today,
        staffId: staff.id,
        lines: [
          { receiptId: alter.id, pcsAltered: '35', pcsNotRepairable: '5', notRepairableReason: 'Torn beyond repair' },
          { receiptId: spoiled.id, pcsAltered: '10', pcsNotRepairable: '5', notRepairableReason: 'Stain will not lift' },
        ],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.rows.length, 2);

    const after = (await bagsOfOrder()).rows;
    assert.equal(bagOf(after, 'Alter', 'ALTERATION').status, 'CLOSED');
    assert.equal(Number(bagOf(after, 'Spoiled', 'REJECTED').balance), 0);

    const reg = await call('GET', `/api/rejected-register?orderId=${opt.orderId}`, { as: 'alteration' });
    assert.equal(reg.status, 200);
    assert.equal(Number(reg.body.meta?.totals?.qty ?? reg.body.totals?.qty ?? reg.body.data.reduce((a, r) => a + Number(r.qty), 0)), 10);
    const rows = Array.isArray(reg.body.data) ? reg.body.data : reg.body.data.rows;
    assert.deepEqual(rows.map((r) => r.reason).sort(), ['Alter', 'Spoiled']);
    assert.ok(rows.every((r) => r.stage === 'ALTERATION_UNIT' && r.origin === 'EXTERNAL_QC'));
    assert.ok(rows.some((r) => r.notRepairableReason === 'Torn beyond repair'));
  });

  test('an ironing reject not repairable keeps its own reason and damage type', async () => {
    const bag = bagOf((await bagsOfOrder()).rows, 'Ironing damage');
    const res = await call('POST', '/api/alteration', {
      as: 'alteration',
      body: { staffId: staff.id, lines: [{ receiptId: bag.id, pcsNotRepairable: '2', notRepairableReason: 'Burnt through' }] },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const reg = await prisma.rejectedRegisterEntry.findFirst({ where: { alterationEntryId: res.body.data.rows[0].id } });
    assert.equal(reg.reason, 'Ironing damage');
    assert.equal(reg.defectType, 'Water Mark');
    assert.equal(reg.origin, 'IRONING');
    assert.equal(reg.unit, UNIT2);
  });

  test('altered pieces come back through ironing (From Alteration Unit), never more than were altered', async () => {
    const tooMany = await ironingPost({ source: 'ALTERATION_UNIT', pcsReceived: '46' });
    assert.equal(tooMany.status, 409);
    assert.match(tooMany.body.error.message, /only 45 have been altered/);
    const res = await ironingPost({ source: 'ALTERATION_UNIT', pcsReceived: '45', ironerId: ironer.id, pcsIroned: '45' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const f = await flowNow();
    assert.equal(Number(f.alteredPending), 0);
    assert.equal(Number(f.waitingForQc), 120, '75 + 45 altered and ironed: offered to External QC again');
  });

  test('and must pass External QC again', async () => {
    const res = await qcPost({ pcsOffered: '120', pcsApproved: '118', pcsRejected: '2', ...reasons({ rejDefected: '2' }) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const f = await flowNow();
    assert.equal(Number(f.waitingForQc), 0);
    assert.equal(Number(f.approved), 918);
  });

  test('a bag already worked cannot be shrunk below what was worked', async () => {
    const res = await call('PATCH', `/api/external-qc/${qcIds[0]}`, {
      as: 'extqc',
      body: { pcsApproved: '810', pcsAlteration: '60', ...reasons({ altAlter: '30', altIron: '20', altDefected: '10', rejIron: '5', rejSpoiled: '15', rejOther: '10' }) },
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /already worked 40/);
  });

  test("ironing cannot be cut below what External QC was offered; Iron cannot be cut below what ironing took back", async () => {
    const work = ironingIds[1];
    const cut = await call('PATCH', `/api/ironing/${work}`, { as: 'finishing', body: { pcsIroned: '900', pcsDamaged: '100', pcsReIroned: '30', pcsRejected: '20' } });
    assert.equal(cut.status, 409);
    assert.match(cut.body.error.message, /External QC has been offered/);

    const ironDown = await call('PATCH', `/api/external-qc/${qcIds[0]}`, {
      as: 'extqc',
      body: { ...reasons({ altAlter: '40', altIron: '10', altDefected: '20', rejIron: '5', rejSpoiled: '15', rejOther: '10' }) },
    });
    assert.equal(ironDown.status, 409);
    assert.match(ironDown.body.error.message, /sent back only 15 with reason Iron/);
  });

  test('the pipeline still adds up, every stage net', async () => {
    const r = await pipelineRow();
    // 1,000 = 30 at ironing + 918 approved + 2 + 40 + 1 at alteration ... see the flow.
    assert.equal(Number(r.receivedFromUnits), 1000);
    assert.equal(Number(r.approved), 918);
    assert.equal(Number(r.reIronPending), 0);
    assert.equal(Number(r.alteredPending), 0);
    assert.equal(Number(r.rejected), 12, '5 + 5 + 2 not repairable');
    // At alteration: 95 + 2 (second QC) - 45 altered - 12 not repairable.
    assert.equal(Number(r.atAlteration), 40);
    assert.equal(Number(r.atIroning), 30);
    assert.equal(Number(r.difference), 0);
    assert.equal(Number(r.accounted), 1000);
  });

  test('External QC reports: by order, by agency, by reason', async () => {
    const byOrder = await call('GET', `/api/reports/external-qc-by-order?orderId=${opt.orderId}`, { as: 'extqc' });
    assert.equal(byOrder.status, 200, JSON.stringify(byOrder.body));
    const o = byOrder.body.data.rows.find((r) => r.styleNo === opt.styleNo);
    assert.equal(Number(o.pcsOffered), 1020);
    assert.equal(Number(o.pcsApproved), 918);
    assert.equal(o.approvedPct, '90.0%');
    assert.equal(Number(o.pcsBackToIroning), 25);

    const byAgency = await call('GET', `/api/reports/external-qc-by-agency?orderId=${opt.orderId}`, { as: 'extqc' });
    assert.equal(byAgency.body.data.rows[0].agencyName, agency.vendorName);

    const byReason = await call('GET', `/api/reports/external-qc-by-reason?orderId=${opt.orderId}`, { as: 'extqc' });
    const iron = byReason.body.data.rows.find((r) => r.reason === 'Iron');
    assert.equal(Number(iron.pcsTotal), 25);
    assert.equal(iron.goesTo, 'Ironing (Re-iron)');
    assert.equal(byReason.body.data.rows.find((r) => r.reason === 'Defected').goesTo, 'Alteration Unit');
  });

  test('the Checker Report carries the external rejects traced to each checker code', async () => {
    const res = await call('GET', `/api/reports/checker-report?orderId=${opt.orderId}`, { as: 'extqc' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const mine = res.body.data.rows.find((r) => r.checkerCode === checker.empId);
    assert.equal(Number(mine.pcsExternalFaulty), 25);
    assert.equal(mine.checkerName, checker.empName);
    assert.equal(Number(res.body.data.rows.find((r) => r.checkerCode === 'X-9').pcsExternalFaulty), 10);
  });

  test('the inspection report: a PDF or a photo, nothing else', async () => {
    const pdf = new FormData();
    pdf.append('file', new Blob([Buffer.from('%PDF-1.4\n%test\n')], { type: 'application/pdf' }), 'report.pdf');
    const ok = await call('POST', `/api/external-qc/${qcIds[0]}/attachments`, { as: 'extqc', form: pdf });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));

    const txt = new FormData();
    txt.append('file', new Blob(['hello'], { type: 'text/plain' }), 'notes.txt');
    const no = await call('POST', `/api/external-qc/${qcIds[0]}/attachments`, { as: 'extqc', form: txt });
    assert.equal(no.status, 400);
    assert.match(no.body.error.message, /PDF or a photo/);

    const xlsx = new FormData();
    xlsx.append('file', new Blob([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0])]), 'sheet.xlsx');
    assert.equal((await call('POST', `/api/external-qc/${qcIds[0]}/attachments`, { as: 'extqc', form: xlsx })).status, 400);

    const detail = await call('GET', `/api/external-qc/${qcIds[0]}`, { as: 'extqc' });
    assert.equal(detail.body.data.attachments.length, 1);
    assert.equal(detail.body.data.attachments[0].fileName, 'report.pdf');
  });

  test('Excel export of each register', async () => {
    for (const key of ['external-qc', 'alteration-bags', 'alteration-entries', 'rejected-register']) {
      const res = await call('GET', `/api/exports/${key}/csv?orderId=${opt.orderId}`, { as: 'admin' });
      assert.equal(res.status, 200, `${key}: ${typeof res.body === 'string' ? res.body.slice(0, 200) : JSON.stringify(res.body)}`);
    }
  });

  test('the roles: each desk records only its own stage; the Director reads', async () => {
    const bag = bagOf((await bagsOfOrder()).rows, 'Defected', 'ALTERATION');
    assert.equal((await call('POST', '/api/alteration', { as: 'extqc', body: { staffId: staff.id, lines: [{ receiptId: bag.id, pcsAltered: '1' }] } })).status, 403);
    assert.equal((await call('POST', '/api/external-qc', { as: 'alteration', body: { ...OS(), agencyId: agency.id, pcsOffered: '1', pcsApproved: '1' } })).status, 403);
    assert.equal((await call('POST', '/api/external-qc', { as: 'finishing', body: { ...OS(), agencyId: agency.id, pcsOffered: '1', pcsApproved: '1' } })).status, 403);
    assert.equal((await call('GET', `/api/external-qc/${qcIds[0]}`, { as: 'dinesh' })).status, 200);
    assert.equal((await call('DELETE', `/api/external-qc/${qcIds[0]}`, { as: 'dinesh' })).status, 403);
    assert.equal((await call('GET', '/api/rejected-register', { as: 'dinesh' })).status, 200);
  });

  test('a QC entry whose pieces have moved on cannot be deleted', async () => {
    const res = await call('DELETE', `/api/external-qc/${qcIds[0]}`, { as: 'admin' });
    assert.equal(res.status, 409, 'its bags have been worked and its Iron pieces ironed again');
  });

  test('every write left an audit trail', async () => {
    const tables = ['external_qc_entries', 'alteration_receipts', 'alteration_entries', 'rejected_register_entries'];
    for (const t of tables) {
      assert.ok((await prisma.auditLog.count({ where: { tableName: t } })) > 0, `${t} is audited`);
    }
  });
});
