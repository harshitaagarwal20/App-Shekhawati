/**
 * IRONING, OVER HTTP. NEEDS A SEEDED POSTGRESQL. Never run against production.
 *
 * Every rule in the brief, driven through the real API:
 *
 *   - received from a unit <= that unit's stitched - pieces out for printing
 *   - ironed + damaged <= received (re-ironed pieces come back)
 *   - each damaged piece decided: re-iron (back to balance) or rejected
 *     (a bag in the Alteration Unit, reason "Ironing damage")
 *   - receiving closes the unit's cutting challans, oldest first
 *   - the daily report and the balance report
 *
 * Works on one order cut for Unit 1 and removes everything it wrote.
 *
 *      node --test test/ironing.db.test.js
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

import { createApp } from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { istIsoDate } from '../src/utils/dates.js';

const USER_PASSWORD = process.env.SEED_DEFAULT_USER_PASSWORD || 'Shekhawati@123';

let live = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  live = (await prisma.user.count({ where: { username: 'finishing' } })) === 1;
} catch {
  live = false;
}
const skip = live ? false : 'no seeded database with the ironing users - skipping';

let server;
let base;
const tokens = {};

async function call(method, path, { as, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* CSV */
  }
  return { status: res.status, body: parsed };
}

async function signIn(username) {
  await prisma.user.updateMany({
    where: { username },
    data: { mustChangePassword: false, passwordHash: await bcrypt.hash(USER_PASSWORD, 10) },
  });
  const res = await call('POST', '/api/auth/login', { body: { username, password: USER_PASSWORD } });
  assert.equal(res.status, 200, `login for ${username} failed`);
  tokens[username] = res.body.data.accessToken;
}

const UNIT1 = 'Unit 1 - Anil Kumar';
const today = istIsoDate();
const yesterday = istIsoDate(new Date(Date.now() - 86400000));

let opt; // the order and style
let ironer;
let stitchingId;
let printingId;
const entries = {};
const challansBefore = [];

const flow = async () => (await call('GET', `/api/ironing/position?unit=${encodeURIComponent(UNIT1)}&orderId=${opt.orderId}&styleId=${opt.styleId}`, { as: 'finishing' })).body.data;
const post = (body) => call('POST', '/api/ironing', { as: 'finishing', body: { orderId: opt.orderId, styleId: opt.styleId, fromUnit: UNIT1, ...body } });

before(async () => {
  if (!live) return;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const u of ['anil', 'ravi', 'finishing', 'dinesh']) await signIn(u);

  // The order with the most cut for Unit 1 - two challans in the seed.
  const opts = (await call('GET', '/api/stitching/orders', { as: 'anil' })).body.data;
  opt = opts.sort((a, b) => Number(b.pcsIssued) - Number(a.pcsIssued))[0];
  ironer = await prisma.employee.findFirst({ where: { designation: 'Ironer', status: 'ACTIVE' } });
  const challans = await prisma.cuttingIssue.findMany({
    where: { firmName: UNIT1, orderId: opt.orderId, styleId: opt.styleId, postedAt: { not: null } },
    orderBy: { issueDate: 'asc' },
  });
  challansBefore.push(...challans.map((c) => ({ id: c.id, pcsReceivedAtIroning: c.pcsReceivedAtIroning, ironingReceiptStatus: c.ironingReceiptStatus })));
});

after(async () => {
  if (live) {
    await prisma.alterationReceipt.deleteMany({ where: { source: 'IRONING', ironingEntry: { orderId: opt?.orderId } } });
    await prisma.ironingEntry.deleteMany({ where: { recordedByName: 'Ironing Desk' } });
    if (printingId) await prisma.printing.delete({ where: { id: printingId } });
    if (stitchingId) await prisma.stitchingRecord.delete({ where: { id: stitchingId } });
    for (const c of challansBefore) {
      await prisma.cuttingIssue.update({ where: { id: c.id }, data: { pcsReceivedAtIroning: c.pcsReceivedAtIroning, ironingReceiptStatus: c.ironingReceiptStatus } });
    }
  }
  server?.close();
  await prisma.$disconnect();
});

describe('ironing', { skip }, () => {
  test('setup: Unit 1 stitches 2,600 and sends 200 for printing', async () => {
    assert.ok(challansBefore.length >= 2, 'the seed cuts this order for Unit 1 on two challans');
    assert.ok(Number(challansBefore.length) && Number(opt.pcsIssued) >= 2600);
    const st = await call('POST', '/api/stitching/records', {
      as: 'anil',
      body: { recordDate: yesterday, orderId: opt.orderId, styleId: opt.styleId, deliverableQty: '2600', actualStitched: '2600' },
    });
    assert.equal(st.status, 201, JSON.stringify(st.body));
    stitchingId = st.body.data.id;

    const vendorId = (await prisma.vendor.findFirst({ where: { category: 'Printing', status: 'ACTIVE' } })).id;
    const pr = await call('POST', '/api/stitching/printings', {
      as: 'ravi',
      body: { orderId: opt.orderId, styleId: opt.styleId, fromUnit: UNIT1, vendorId, qty: '200' },
    });
    assert.equal(pr.status, 201, JSON.stringify(pr.body));
    printingId = pr.body.data.id;
  });

  test('the dropdown offers the order from Unit 1, with 2,400 still at the unit', async () => {
    const res = await call('GET', '/api/ironing/orders', { as: 'finishing' });
    const row = res.body.data.find((o) => o.orderId === opt.orderId && o.styleId === opt.styleId && o.unit === UNIT1);
    assert.ok(row);
    assert.equal(Number(row.pcsAvailableToReceive), 2400);
  });

  test('received cannot exceed stitched less what is out for printing', async () => {
    const res = await post({ entryDate: today, pcsReceived: '2401' });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /200 are out for printing/);
  });

  test('2,400 received: the first challan is partially received, the second not yet', async () => {
    const res = await post({ entryDate: today, pcsReceived: '2400' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    entries.delivery = res.body.data.id;
    const p = await flow();
    assert.equal(Number(p.flow.balance), 2400);
    assert.equal(p.challans[0].ironingReceiptStatus, 'PARTIALLY_RECEIVED');
    assert.equal(Number(p.challans[0].pcsReceivedAtIroning), 2400);
    assert.equal(p.challans[1].ironingReceiptStatus, 'NOT_RECEIVED');
  });

  test('ironed and damaged need an ironer, and damage needs its type', async () => {
    const noIroner = await post({ pcsIroned: '10' });
    assert.equal(noIroner.status, 400);
    const noType = await post({ ironerId: ironer.id, pcsDamaged: '5' });
    assert.equal(noType.status, 400);
    assert.match(noType.body.error.message, /damage type/);
  });

  test('ironed + damaged cannot exceed what is waiting', async () => {
    const res = await post({ ironerId: ironer.id, pcsIroned: '2351', pcsDamaged: '50', damageType: 'Iron Shine' });
    assert.equal(res.status, 409);
  });

  test('2,300 ironed and 50 damaged leaves 50 waiting; the damage is undecided', async () => {
    const res = await post({ ironerId: ironer.id, pcsIroned: '2300', pcsDamaged: '50', damageType: 'Iron Shine' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    entries.work = res.body.data.id;
    assert.equal(Number(res.body.data.pcsUndecided), 50);
    assert.equal(Number((await flow()).flow.balance), 50);
  });

  test('deciding more than was damaged is refused', async () => {
    const res = await call('PATCH', `/api/ironing/${entries.work}`, { as: 'finishing', body: { pcsReIroned: '40', pcsRejected: '20' } });
    assert.equal(res.status, 400);
  });

  test('30 re-iron go back into the balance; 20 rejected go to the Alteration Unit', async () => {
    const res = await call('PATCH', `/api/ironing/${entries.work}`, { as: 'finishing', body: { pcsReIroned: '30', pcsRejected: '20' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(Number(res.body.data.pcsUndecided), 0);
    assert.equal(Number((await flow()).flow.balance), 80);

    const mine = await prisma.alterationReceipt.findUnique({ where: { ironingEntryId: entries.work } });
    assert.equal(Number(mine.qty), 20);
    assert.equal(mine.source, 'IRONING');
    assert.equal(mine.reason, 'Ironing damage');
    assert.equal(mine.defectType, 'Iron Shine');
    assert.equal(mine.unit, UNIT1);
    assert.equal(mine.status, 'OPEN');
  });

  test('stitching cannot be cut below what has already left the unit', async () => {
    const res = await call('PATCH', `/api/stitching/records/${stitchingId}`, { as: 'anil', body: { actualStitched: '2599' } });
    assert.equal(res.status, 409);
  });

  test('printing back, then received: the first challan closes, the second opens', async () => {
    const back = await call('PATCH', `/api/stitching/printings/${printingId}`, { as: 'ravi', body: { qtyReceived: '200' } });
    assert.equal(back.status, 200);
    const res = await post({ entryDate: today, pcsReceived: '200' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    entries.second = res.body.data.id;

    const p = await flow();
    const issued0 = Number(p.challans[0].cuttingPcsIssued);
    assert.equal(p.challans[0].ironingReceiptStatus, issued0 <= 2600 ? 'CLOSED' : 'PARTIALLY_RECEIVED');
    assert.equal(p.challans[1].ironingReceiptStatus, issued0 < 2600 ? 'PARTIALLY_RECEIVED' : 'NOT_RECEIVED');
    const onChallans = p.challans.reduce((a, c) => a + Number(c.pcsReceivedAtIroning), 0);
    assert.equal(onChallans, 2600, 'every piece received is on a challan');
    assert.equal(Number(p.flow.availableToReceive), 0);
  });

  test('a delivery whose pieces were ironed since cannot be deleted', async () => {
    const director = await call('DELETE', `/api/ironing/${entries.delivery}`, { as: 'dinesh' });
    assert.equal(director.status, 403, 'the Director reads but does not delete');

    await signInAdmin();
    const res = await call('DELETE', `/api/ironing/${entries.delivery}`, { as: 'admin' });
    assert.equal(res.status, 409, 'its 2,400 pieces were ironed by a later entry');
    assert.match(res.body.error.message, /more\s+than were received/);
  });

  test('the daily report: by ironer and order, with damage %', async () => {
    const res = await call('GET', `/api/reports/ironing-daily?orderId=${opt.orderId}`, { as: 'finishing' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = res.body.data.rows.find((r) => r.ironerName === ironer.empName);
    assert.equal(Number(row.pcsIroned), 2300);
    assert.equal(Number(row.pcsDamaged), 50);
    assert.equal(row.damagePct, '2.1%'); // 50 / 2350
  });

  test('the balance report: what is waiting at ironing', async () => {
    const res = await call('GET', `/api/reports/ironing-balance?orderId=${opt.orderId}`, { as: 'finishing' });
    assert.equal(res.status, 200);
    const row = res.body.data.rows.find((r) => r.fromUnit === UNIT1);
    assert.equal(Number(row.pcsReceived), 2600);
    assert.equal(Number(row.balance), 280);
    assert.equal(Number(row.pcsRejected), 20);
    assert.equal(Number(row.pcsUndecided), 0);
  });

  test('removing the work entry empties its bag in the Alteration Unit', async () => {
    // The work entry can go - it only took pieces OUT of the balance.
    const res = await call('DELETE', `/api/ironing/${entries.work}`, { as: 'admin' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const held = await prisma.alterationReceipt.findUnique({ where: { ironingEntryId: entries.work } });
    assert.equal(held.status, 'CANCELLED');
    assert.equal(Number(held.qty), 0);
    assert.equal(Number((await flow()).flow.balance), 2600);
  });

  test('a stitching supervisor cannot record ironing', async () => {
    const res = await call('POST', '/api/ironing', { as: 'anil', body: { orderId: opt.orderId, styleId: opt.styleId, fromUnit: UNIT1, pcsReceived: '1' } });
    assert.equal(res.status, 403);
  });
});

async function signInAdmin() {
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';
  await prisma.user.updateMany({ where: { username: 'admin' }, data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false } });
  const res = await call('POST', '/api/auth/login', { body: { username: 'admin', password } });
  tokens.admin = res.body.data.accessToken;
}
