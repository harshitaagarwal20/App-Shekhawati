/**
 * PRODUCTION PHASE 2 - STITCHING AND HOURLY MONITORING, OVER HTTP.
 * NEEDS A SEEDED POSTGRESQL. Never run against production.
 *
 * The brief's three "done when" points, each driven through the real API:
 *
 *   1. A supervisor logs in, sees only their own unit's orders, and records
 *      stitching.
 *   2. Recording more than was cut for that unit is blocked.
 *   3. The hourly grid saves slot by slot and totals correctly.
 *
 * Plus printing after stitching, and the export held to the unit.
 * Everything it writes is removed in after().
 *
 *      node --test test/stitching.db.test.js
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

import { createApp } from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { istIsoDate } from '../src/utils/dates.js';

const USER_PASSWORD = process.env.SEED_DEFAULT_USER_PASSWORD || 'Shekhawati@123';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';

let live = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  live = (await prisma.user.count({ where: { username: 'anil' } })) === 1;
} catch {
  live = false;
}
const skip = live ? false : 'no seeded database with the Phase 2 users - skipping';

let server;
let base;
const tokens = {};

async function call(method, path, { as, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

async function signIn(username, password) {
  await prisma.user.updateMany({
    where: { username },
    data: { mustChangePassword: false, passwordHash: await bcrypt.hash(password, 10) },
  });
  const res = await call('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(res.status, 200, `login for ${username} failed: ${JSON.stringify(res.body)}`);
  tokens[username] = res.body.data.accessToken;
}

const UNIT1 = 'Unit 1 - Anil Kumar';
const UNIT2 = 'Unit 2 - Mahipal';
const today = istIsoDate();
const yesterday = istIsoDate(new Date(Date.now() - 86400000));

let unit1Option; // an (order, style) cut for Unit 1
let unit2Option; // one cut for Unit 2 only
let styleTargetBefore;
const createdPrintings = [];

before(async () => {
  if (!live) return;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await signIn('anil', USER_PASSWORD);
  await signIn('mahipal', USER_PASSWORD);
  await signIn('dinesh', USER_PASSWORD);
  await signIn('ravi', USER_PASSWORD);
  await signIn('admin', ADMIN_PASSWORD);
});

after(async () => {
  if (live) {
    await prisma.hourlyMonitoringEntry.deleteMany({ where: { recordedByName: { in: ['Anil Kumar', 'System Administrator'] } } });
    await prisma.stitchingRecord.deleteMany({ where: { recordedByName: { in: ['Anil Kumar', 'Mahipal Yadav', 'System Administrator'] } } });
    if (createdPrintings.length) await prisma.printing.deleteMany({ where: { id: { in: createdPrintings } } });
    if (unit1Option) {
      await prisma.style.update({ where: { id: unit1Option.styleId }, data: { hourlyTarget: styleTargetBefore } });
    }
  }
  server?.close();
  await prisma.$disconnect();
});

describe('a supervisor sees only their own unit', { skip }, () => {
  test('the context names the unit, and the unit cannot be chosen', async () => {
    const res = await call('GET', '/api/stitching/context', { as: 'anil' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.fixedUnit, UNIT1);
    assert.equal(res.body.data.canChooseUnit, false);
    assert.equal(res.body.data.canWrite, true);
    assert.deepEqual(res.body.data.units, [UNIT1]);
    assert.ok(res.body.data.slots.length >= 9, 'the HourlySlot list is seeded');
  });

  test('the order dropdown carries only orders cut for Unit 1, whatever unit is asked for', async () => {
    const own = await call('GET', '/api/stitching/orders', { as: 'anil' });
    const asked = await call('GET', `/api/stitching/orders?unit=${encodeURIComponent(UNIT2)}`, { as: 'anil' });
    assert.equal(own.status, 200);
    assert.ok(own.body.data.length > 0, 'Unit 1 has cutting issued in the seed');
    assert.ok(own.body.data.every((o) => o.unit === UNIT1));
    assert.deepEqual(asked.body.data.map((o) => o.key), own.body.data.map((o) => o.key),
      'asking for another unit returns the own unit');

    const issuedToUnit1 = await prisma.cuttingIssue.findMany({
      where: { firmName: UNIT1, postedAt: { not: null }, status: { not: 'CANCELLED' }, deletedAt: null },
      select: { orderId: true, styleId: true },
    });
    const expected = new Set(issuedToUnit1.map((c) => `${c.orderId}:${c.styleId}`));
    assert.deepEqual(new Set(own.body.data.map((o) => o.key)), expected);
    unit1Option = own.body.data.find((o) => Number(o.pcsIssued) >= 1000) ?? own.body.data[0];

    const unit2 = await call('GET', '/api/stitching/orders', { as: 'mahipal' });
    unit2Option = unit2.body.data.find((o) => !expected.has(o.key));
    assert.ok(unit2Option, 'Unit 2 has an order Unit 1 was not cut');
  });

  test('recording against another unit\'s order is refused', async () => {
    const res = await call('POST', '/api/stitching/records', {
      as: 'anil',
      body: { orderId: unit2Option.orderId, styleId: unit2Option.styleId, actualStitched: '10', deliverableQty: '10' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /No cutting has been issued to Unit 1/);
  });

  test('naming another unit outright is refused', async () => {
    const res = await call('POST', '/api/stitching/records', {
      as: 'anil',
      body: { unit: UNIT2, orderId: unit1Option.orderId, styleId: unit1Option.styleId, actualStitched: '1' },
    });
    assert.equal(res.status, 403);
  });

  test('the Director may read but not record - there is no unit to record for', async () => {
    const read = await call('GET', '/api/stitching/records', { as: 'dinesh' });
    assert.equal(read.status, 200);
    const write = await call('POST', '/api/stitching/records', {
      as: 'dinesh',
      body: { unit: UNIT1, orderId: unit1Option.orderId, styleId: unit1Option.styleId, actualStitched: '1' },
    });
    assert.equal(write.status, 403);
  });
});

describe('recording stitching, and the ceiling', { skip }, () => {
  let recordId;

  test('a day is recorded; the unit comes from the login and Remaining = Deliverable - Actual', async () => {
    const res = await call('POST', '/api/stitching/records', {
      as: 'anil',
      body: { recordDate: yesterday, orderId: unit1Option.orderId, styleId: unit1Option.styleId, deliverableQty: '500', actualStitched: '420' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const row = res.body.data;
    recordId = row.id;
    assert.equal(row.unit, UNIT1);
    assert.equal(Number(row.deliverableQty), 500);
    assert.equal(Number(row.actualStitched), 420);
    assert.equal(Number(row.remaining), 80);
    assert.equal(row.recordedByName, 'Anil Kumar');
  });

  test('a posted remaining is ignored - the server works it out', async () => {
    const res = await call('PATCH', `/api/stitching/records/${recordId}`, {
      as: 'anil',
      body: { actualStitched: '450', remaining: '999999' },
    });
    assert.equal(res.status, 200);
    assert.equal(Number(res.body.data.remaining), 50);
  });

  test('a second record for the same day is refused, and names the one to edit', async () => {
    const res = await call('POST', '/api/stitching/records', {
      as: 'anil',
      body: { recordDate: yesterday, orderId: unit1Option.orderId, styleId: unit1Option.styleId, actualStitched: '1' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.details.existingId, recordId);
  });

  test('more than was cut for the unit is blocked, and nothing is written', async () => {
    const issued = Number(unit1Option.pcsIssued);
    const already = Number(unit1Option.pcsStitched) + 450;
    const res = await call('POST', '/api/stitching/records', {
      as: 'anil',
      body: { recordDate: today, orderId: unit1Option.orderId, styleId: unit1Option.styleId, deliverableQty: '0', actualStitched: String(issued - already + 1) },
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /more than were cut for it/);
    assert.equal(Number(res.body.error.details.maxForThisRecord), issued - already);
    const count = await prisma.stitchingRecord.count({
      where: { unit: UNIT1, recordDate: new Date(`${today}T00:00:00Z`), orderId: unit1Option.orderId, deletedAt: null },
    });
    assert.equal(count, 0);
  });

  test('exactly what is left is accepted; then an edit past the ceiling is blocked', async () => {
    const day = await call('GET', `/api/stitching/records/day?date=${today}&orderId=${unit1Option.orderId}&styleId=${unit1Option.styleId}`, { as: 'anil' });
    assert.equal(day.status, 200);
    const max = day.body.data.maxForThisRecord;
    const ok = await call('POST', '/api/stitching/records', {
      as: 'anil',
      body: { recordDate: today, orderId: unit1Option.orderId, styleId: unit1Option.styleId, actualStitched: max },
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    // Deliverable omitted: the plan's figure, or nothing.
    const planned = day.body.data.plannedDeliverable;
    assert.equal(Number(ok.body.data.deliverableQty), Number(planned ?? 0));

    const edit = await call('PATCH', `/api/stitching/records/${recordId}`, { as: 'anil', body: { actualStitched: '451' } });
    assert.equal(edit.status, 409, 'one more piece on the earlier day would pass the ceiling');

    const pos = await call('GET', `/api/stitching/records/${recordId}`, { as: 'anil' });
    assert.equal(Number(pos.body.data.position.pcsBalance), 0);
  });

  test('two saves racing for the last pieces: one wins, one is refused', async () => {
    const balance = Number(unit2Option.pcsBalance);
    const body = (date) => ({ recordDate: date, orderId: unit2Option.orderId, styleId: unit2Option.styleId, actualStitched: String(balance) });
    const [a, b] = await Promise.all([
      call('POST', '/api/stitching/records', { as: 'mahipal', body: body(today) }),
      call('POST', '/api/stitching/records', { as: 'mahipal', body: body(yesterday) }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    const total = await prisma.stitchingRecord.aggregate({
      where: { unit: UNIT2, orderId: unit2Option.orderId, styleId: unit2Option.styleId, deletedAt: null },
      _sum: { actualStitched: true },
    });
    assert.equal(Number(total._sum.actualStitched), Number(unit2Option.pcsIssued));
  });

  test('a day that has not happened is refused', async () => {
    const res = await call('POST', '/api/stitching/records', {
      as: 'anil',
      body: { recordDate: '2099-01-01', orderId: unit1Option.orderId, styleId: unit1Option.styleId, actualStitched: '1' },
    });
    assert.equal(res.status, 400);
  });

  test('another unit\'s supervisor cannot open the record', async () => {
    const res = await call('GET', `/api/stitching/records/${recordId}`, { as: 'mahipal' });
    assert.equal(res.status, 404);
    const list = await call('GET', '/api/stitching/records', { as: 'mahipal' });
    assert.ok(list.body.data.every((r) => r.unit === UNIT2));
  });

  test('the export is held to the supervisor\'s unit too', async () => {
    const res = await call('GET', '/api/exports/stitching-records/csv', { as: 'anil' });
    assert.equal(res.status, 200);
    const lines = String(res.body).trim().split(/\r?\n/).slice(1);
    assert.ok(lines.length >= 2);
    assert.ok(lines.every((l) => l.includes(UNIT1)), 'every row is Unit 1');
    const other = await call('GET', '/api/exports/stitching-records/csv', { as: 'mahipal' });
    assert.ok(!String(other.body).includes(UNIT1));
  });
});

describe('hourly monitoring', { skip }, () => {
  const grid = (as = 'anil') =>
    call('GET', `/api/stitching/hourly/grid?date=${today}&orderId=${unit1Option.orderId}&styleId=${unit1Option.styleId}`, { as });
  const put = (body, as = 'anil') =>
    call('PUT', '/api/stitching/hourly/slot', {
      as,
      body: { date: today, orderId: unit1Option.orderId, styleId: unit1Option.styleId, ...body },
    });

  test('one row per tailor in the unit, one column per configured slot', async () => {
    const style = await prisma.style.findUnique({ where: { id: unit1Option.styleId } });
    styleTargetBefore = style.hourlyTarget;
    await prisma.style.update({ where: { id: unit1Option.styleId }, data: { hourlyTarget: '20' } });

    const res = await grid();
    assert.equal(res.status, 200);
    const tailors = await prisma.employee.count({
      where: { unitLine: UNIT1, designation: 'Tailor', status: 'ACTIVE', deletedAt: null },
    });
    assert.equal(res.body.data.rows.length, tailors);
    assert.deepEqual(res.body.data.slots.slice(0, 3), ['10:00', '11:00', '12:00']);
    assert.equal(res.body.data.total, '0');
  });

  test('each slot saves on its own, and the totals add up', async () => {
    const g = (await grid()).body.data;
    const [a, b] = g.rows;
    await put({ employeeId: a.employeeId, slot: '10:00', pcs: '22' });
    await put({ employeeId: a.employeeId, slot: '11:00', pcs: '18' });
    const res = await put({ employeeId: b.employeeId, slot: '10:00', pcs: '25' });
    assert.equal(res.status, 200);
    const out = res.body.data;
    const rowA = out.rows.find((r) => r.employeeId === a.employeeId);
    assert.equal(Number(rowA.total), 40);
    assert.equal(Number(out.slotTotals['10:00']), 47);
    assert.equal(Number(out.total), 65);
    assert.equal(Number(out.unitDayTotal), 65);
    assert.equal(rowA.cells['10:00'].short, false, '22 meets a target of 20');
    assert.equal(rowA.cells['11:00'].short, true, '18 is under a target of 20 - red');
  });

  test('a correction replaces the cell; clearing it deletes it', async () => {
    const g = (await grid()).body.data;
    const a = g.rows[0];
    await put({ employeeId: a.employeeId, slot: '11:00', pcs: '21' });
    let out = (await grid()).body.data;
    assert.equal(Number(out.rows[0].total), 43);
    assert.equal(out.rows[0].cells['11:00'].short, false);

    const cleared = await put({ employeeId: a.employeeId, slot: '11:00', pcs: '' });
    out = cleared.body.data;
    assert.equal(out.rows[0].cells['11:00'], undefined);
    assert.equal(Number(out.total), 47);

    // The row is gone; the audit trail keeps what it held.
    const trail = await prisma.auditLog.findFirst({
      where: { tableName: 'hourly_monitoring_entries', action: 'DELETE' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(trail, 'clearing a cell is on the audit trail');
    assert.equal(Number(trail.before.pcs), 21);
  });

  test('a tailor from another unit, or a slot not configured, is refused', async () => {
    const unit2Tailor = await prisma.employee.findFirst({ where: { unitLine: UNIT2, designation: 'Tailor' } });
    const res = await put({ employeeId: unit2Tailor.id, slot: '10:00', pcs: '5' });
    assert.equal(res.status, 400);
    const g = (await grid()).body.data;
    const bad = await put({ employeeId: g.rows[0].employeeId, slot: '9:15', pcs: '5' });
    assert.equal(bad.status, 400);
  });

  test('another supervisor cannot read or write this unit\'s grid', async () => {
    const res = await grid('mahipal');
    assert.equal(res.status, 400, 'their unit was cut nothing of this order');
  });

  test('the stitching form shows the hourly total as a hint', async () => {
    const res = await call('GET', `/api/stitching/records/day?date=${today}&orderId=${unit1Option.orderId}&styleId=${unit1Option.styleId}`, { as: 'anil' });
    assert.equal(Number(res.body.data.hourlyTotal), 47);
  });
});

describe('printing after stitching', { skip }, () => {
  let stitched;
  let vendorId;

  test('the summary counts what the unit stitched', async () => {
    vendorId = (await prisma.vendor.findFirst({ where: { category: 'Printing', status: 'ACTIVE' } })).id;
    const res = await call('GET', `/api/stitching/printings/summary?orderId=${unit1Option.orderId}&styleId=${unit1Option.styleId}&unit=${encodeURIComponent(UNIT1)}`, { as: 'ravi' });
    assert.equal(res.status, 200);
    stitched = Number(res.body.data.pcsStitched);
    assert.ok(stitched > 0);
  });

  test('pieces sent out are not available; more than is stitched and back cannot be sent', async () => {
    const before_ = (await call('GET', `/api/stitching/printings/summary?orderId=${unit1Option.orderId}&styleId=${unit1Option.styleId}&unit=${encodeURIComponent(UNIT1)}`, { as: 'ravi' })).body.data;
    const room = Number(before_.pcsPrintableNow);
    const sent = await call('POST', '/api/stitching/printings', {
      as: 'ravi',
      body: { orderId: unit1Option.orderId, styleId: unit1Option.styleId, fromUnit: UNIT1, vendorId, qty: String(Math.min(room, 100)), uom: 'Pcs' },
    });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    createdPrintings.push(sent.body.data.id);
    assert.equal(sent.body.data.fabricStage, 'AFTER_STITCHING');
    assert.equal(sent.body.data.status, 'PENDING');

    const after_ = (await call('GET', `/api/stitching/printings/summary?orderId=${unit1Option.orderId}&styleId=${unit1Option.styleId}&unit=${encodeURIComponent(UNIT1)}`, { as: 'ravi' })).body.data;
    assert.equal(Number(after_.pcsOutForPrinting) - Number(before_.pcsOutForPrinting), Math.min(room, 100));
    assert.equal(Number(after_.pcsAvailable), Number(before_.pcsAvailable) - Math.min(room, 100));

    const over = await call('POST', '/api/stitching/printings', {
      as: 'ravi',
      body: { orderId: unit1Option.orderId, styleId: unit1Option.styleId, fromUnit: UNIT1, vendorId, qty: String(Number(after_.pcsPrintableNow) + 1) },
    });
    assert.equal(over.status, 409);
  });

  test('received back returns them; more back than sent is refused', async () => {
    const id = createdPrintings[0];
    const sentQty = Number((await prisma.printing.findUnique({ where: { id } })).qty);
    const bad = await call('PATCH', `/api/stitching/printings/${id}`, { as: 'ravi', body: { qtyReceived: String(sentQty + 1) } });
    assert.equal(bad.status, 400);
    const ok = await call('PATCH', `/api/stitching/printings/${id}`, { as: 'ravi', body: { qtyReceived: String(sentQty) } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.status, 'COMPLETED');
    assert.equal(Number(ok.body.data.qtyOut), 0);
  });

  test('a supervisor holds no printing permission', async () => {
    const res = await call('GET', '/api/stitching/printings', { as: 'anil' });
    assert.equal(res.status, 403);
  });
});
