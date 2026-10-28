/**
 * INLINE QC, OVER HTTP. NEEDS A SEEDED POSTGRESQL. Never run against production.
 *
 * The Phase 3 brief, driven through the real API:
 *
 *   - one screen, Check Type Size / Workmanship; Operation and Size only on Size
 *   - Unit is the tailor's; the order must have cutting posted to that unit
 *   - Pcs Checked and Pcs Rejected, rejected never more than checked
 *   - Defects Found from the Defect Type list, several; Operation from its list
 *   - Inform To is a supervisor (INLINE_QC.RESOLVE); each defect lands on their
 *     Action needed list, and they - and only they - mark it Resolved
 *   - the roles, the unit a supervisor is held to, the audit log, the export
 *
 * Works on one order cut for Unit 2 and removes everything it wrote.
 *
 *      node --test test/inlineQc.db.test.js
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
  live = (await prisma.user.count({ where: { username: { in: ['sunita', 'mahipal', 'anil'] } } })) === 3
    && (await prisma.permission.count({ where: { code: 'INLINE_QC.RESOLVE' } })) === 1;
} catch {
  live = false;
}
const skip = live ? false : 'no seeded database with the Phase 3 permissions - skipping';

let server;
let base;
const tokens = {};
const users = {};

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

async function signIn(username, password = USER_PASSWORD) {
  await prisma.user.updateMany({
    where: { username },
    data: { mustChangePassword: false, passwordHash: await bcrypt.hash(password, 10) },
  });
  const res = await call('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(res.status, 200, `login for ${username} failed`);
  tokens[username] = res.body.data.accessToken;
  users[username] = await prisma.user.findUnique({ where: { username }, select: { id: true } });
}

const UNIT1 = 'Unit 1 - Anil Kumar';
const UNIT2 = 'Unit 2 - Mahipal';
const today = istIsoDate();
const tomorrow = istIsoDate(new Date(Date.now() + 86400000));

let opt; // an order and style cut for Unit 2
let tailor; // a Unit 2 tailor
let unit1Tailor;
const entryIds = [];
const startedAt = new Date();

const post = async (body, as = 'sunita') => {
  const res = await call('POST', '/api/inline-qc', {
    as,
    body: { entryDate: today, tailorId: tailor.id, orderId: opt.orderId, styleId: opt.styleId, ...body },
  });
  if (res.status === 201) entryIds.push(res.body.data.id);
  return res;
};
const sizeCheck = (extra = {}) => ({
  checkType: 'SIZE', operation: 'Handle Attach', sizeMeasurement: 'Free Size',
  pcsChecked: '200', pcsRejected: '4', defects: [{ defect: 'Handle Size', qty: 3 }, { defect: 'Untrimmed Thread', qty: 2 }], informToUserId: users.mahipal.id, ...extra,
});
const mine = async (as, q = '') => (await call('GET', `/api/inline-qc/actions?pageSize=100${q}`, { as })).body;

before(async () => {
  if (!live) return;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const u of ['sunita', 'mahipal', 'anil', 'dinesh']) await signIn(u);
  await signIn('admin', process.env.SEED_ADMIN_PASSWORD || 'Admin@123');

  const opts = (await call('GET', `/api/inline-qc/orders?unit=${encodeURIComponent(UNIT2)}`, { as: 'sunita' })).body.data;
  opt = opts.sort((a, b) => Number(b.pcsIssued) - Number(a.pcsIssued))[0];
  tailor = await prisma.employee.findFirst({ where: { designation: 'Tailor', unitLine: UNIT2, status: 'ACTIVE' }, orderBy: { empId: 'asc' } });
  unit1Tailor = await prisma.employee.findFirst({ where: { designation: 'Tailor', unitLine: UNIT1, status: 'ACTIVE' } });
});

after(async () => {
  if (live && entryIds.length) {
    await prisma.inlineQcEntry.deleteMany({ where: { id: { in: entryIds } } });
    await prisma.notification.deleteMany({ where: { documentType: 'INLINE_QC', documentId: { in: entryIds } } });
  }
  server?.close();
  await prisma.$disconnect();
});

describe('Inline QC', { skip }, () => {
  test('setup: an order cut for Unit 2, and a Unit 2 tailor', () => {
    assert.ok(opt, 'Unit 2 has cutting posted to it');
    assert.ok(tailor && unit1Tailor, 'the seed has tailors on Units 1 and 2');
  });

  test('context: the tailors, and Inform To lists the supervisors - not Admin, not the checker', async () => {
    const ctx = (await call('GET', '/api/inline-qc/context', { as: 'sunita' })).body.data;
    assert.equal(ctx.canWrite, true);
    assert.equal(ctx.fixedUnit, null, 'the checker walks every unit');
    assert.ok(ctx.tailors.some((t) => t.id === tailor.id && t.unitLine === UNIT2));
    assert.ok(ctx.tailors.some((t) => t.unitLine === UNIT1));
    assert.ok(ctx.tailors.every((t) => t.unitLine !== 'Alteration Unit'), 'Alteration Unit tailors are not on the line');
    const informIds = ctx.informTo.map((p) => p.id);
    assert.ok(informIds.includes(users.mahipal.id) && informIds.includes(users.anil.id));
    assert.ok(!informIds.includes(users.admin.id) && !informIds.includes(users.sunita.id));
    assert.equal(ctx.informTo.find((p) => p.id === users.mahipal.id).unit, UNIT2);
  });

  test('a supervisor sees only their own unit\'s tailors, and cannot record', async () => {
    const ctx = (await call('GET', '/api/inline-qc/context', { as: 'mahipal' })).body.data;
    assert.equal(ctx.fixedUnit, UNIT2);
    assert.equal(ctx.canWrite, false);
    assert.ok(ctx.tailors.length && ctx.tailors.every((t) => t.unitLine === UNIT2));
    const res = await post(sizeCheck(), 'mahipal');
    assert.equal(res.status, 403);
  });

  test('a Size check: Unit comes from the tailor, each defect is an open line', async () => {
    const res = await post(sizeCheck({ unit: UNIT1 }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const e = res.body.data;
    assert.equal(e.unit, UNIT2, 'the unit sent is ignored - it is the tailor\'s');
    assert.equal(e.checkType, 'SIZE');
    assert.equal(e.operation, 'Handle Attach');
    assert.equal(e.sizeMeasurement, 'Free Size');
    assert.equal(e.pcsChecked, '200');
    assert.equal(e.pcsRejected, '4');
    assert.equal(e.rejectionPct, '2.0%');
    assert.equal(e.informToName, 'Mahipal Yadav');
    assert.equal(e.recordedByName, 'Sunita Devi');
    assert.deepEqual(e.defects.map((d) => [d.defect, d.qty, d.status]), [['Handle Size', 3, 'OPEN'], ['Untrimmed Thread', 2, 'OPEN']]);
    assert.equal(e.defectsFound, 'Handle Size 3; Untrimmed Thread 2');
  });

  test('the Inform To person is told in-app', async () => {
    const n = await prisma.notification.findFirst({ where: { userId: users.mahipal.id, documentType: 'INLINE_QC', documentId: entryIds[0] } });
    assert.ok(n, 'a notification was written');
    assert.equal(n.link, '/inline-qc/actions');
    assert.match(n.title, /2 defects/);
  });

  test('a Workmanship check keeps no operation or size, whatever was sent', async () => {
    const res = await post({
      checkType: 'WORKMANSHIP', operation: 'Hemming', sizeMeasurement: 'Large',
      pcsChecked: '24', pcsRejected: '2', defects: [{ defect: 'Handle Out', qty: 2 }], informToUserId: users.mahipal.id,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.operation, null);
    assert.equal(res.body.data.sizeMeasurement, null);
    assert.equal(res.body.data.checkType, 'WORKMANSHIP');
  });

  test('a clean check needs no defect and no Inform To', async () => {
    const res = await post({ checkType: 'WORKMANSHIP', pcsChecked: '30', pcsRejected: '0', defects: [] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.defects.length, 0);
    assert.equal(res.body.data.informToUserId, null);
  });

  test('the field rules are refused with the field named', async () => {
    const cases = [
      [sizeCheck({ operation: '' }), 'operation'],
      [sizeCheck({ sizeMeasurement: '' }), 'sizeMeasurement'],
      [sizeCheck({ pcsRejected: '201' }), 'pcsRejected'],
      [sizeCheck({ defects: [] }), 'defects'],
      [sizeCheck({ informToUserId: '' }), 'informToUserId'],
      [sizeCheck({ defects: ['Not A Defect'] }), 'defects'],
      [sizeCheck({ operation: 'Welding' }), 'operation'],
      [sizeCheck({ informToUserId: users.sunita.id }), 'informToUserId'],
      [sizeCheck({ entryDate: tomorrow }), 'entryDate'],
      [sizeCheck({ pcsChecked: String(Number(opt.pcsIssued) + 1), pcsRejected: '0' }), 'pcsChecked'],
    ];
    for (const [body, field] of cases) {
      const res = await post(body);
      assert.equal(res.status, 400, `${field}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error?.details?.field ?? res.body.error?.field ?? res.body.details?.field, field, JSON.stringify(res.body));
    }
  });

  test('the order must be cut for the tailor\'s unit', async () => {
    const unit1 = (await call('GET', `/api/inline-qc/orders?unit=${encodeURIComponent(UNIT1)}`, { as: 'sunita' })).body.data;
    if (unit1.some((o) => o.key === opt.key)) return; // cut for both - nothing to prove here
    const res = await post(sizeCheck({ tailorId: unit1Tailor.id, informToUserId: users.anil.id }));
    assert.equal(res.status, 400);
    assert.match(res.body.error?.message ?? JSON.stringify(res.body), /No cutting has been issued to Unit 1/);
  });

  test('the register: Size / Workmanship toggle, totals, and a supervisor held to their unit', async () => {
    const size = await call('GET', `/api/inline-qc?checkType=SIZE&orderId=${opt.orderId}&pageSize=100`, { as: 'sunita' });
    assert.ok(size.body.data.length >= 1 && size.body.data.every((r) => r.checkType === 'SIZE'));
    const all = await call('GET', `/api/inline-qc?orderId=${opt.orderId}&pageSize=100`, { as: 'mahipal' });
    assert.equal(all.status, 200);
    assert.ok(entryIds.every((id) => all.body.data.some((r) => r.id === id)));
    assert.ok(all.body.meta.totals.openDefects >= 3);

    const anil = await call('GET', `/api/inline-qc?pageSize=100`, { as: 'anil' });
    assert.ok(anil.body.data.every((r) => r.unit === UNIT1), 'Unit 1 sees only Unit 1');
    assert.equal((await call('GET', `/api/inline-qc/${entryIds[0]}`, { as: 'anil' })).status, 404);
  });

  test('Action needed: the defects are on Mahipal\'s list and nobody else\'s', async () => {
    const list = await mine('mahipal');
    const ours = list.data.filter((a) => entryIds.includes(a.entryId));
    assert.deepEqual(ours.map((a) => a.defect).sort(), ['Handle Out', 'Handle Size', 'Untrimmed Thread']);
    assert.ok(ours.every((a) => a.status === 'OPEN' && a.canResolve && a.tailor === tailor.empName && a.unit === UNIT2));
    assert.equal((await mine('anil')).data.filter((a) => entryIds.includes(a.entryId)).length, 0);
    const ctx = (await call('GET', '/api/inline-qc/context', { as: 'mahipal' })).body.data;
    assert.ok(ctx.myOpen >= 3);
  });

  test('only the person informed marks it Resolved; a note is kept; it can be reopened', async () => {
    const line = (await mine('mahipal')).data.find((a) => a.entryId === entryIds[0] && a.defect === 'Handle Size');
    assert.equal((await call('POST', `/api/inline-qc/actions/${line.id}/resolve`, { as: 'anil', body: {} })).status, 403);
    assert.equal((await call('POST', `/api/inline-qc/actions/${line.id}/resolve`, { as: 'sunita', body: {} })).status, 403);

    const done = await call('POST', `/api/inline-qc/actions/${line.id}/resolve`, { as: 'mahipal', body: { note: 'Handle template replaced' } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.data.status, 'RESOLVED');
    assert.equal(done.body.data.resolvedByName, 'Mahipal Yadav');
    assert.equal(done.body.data.resolutionNote, 'Handle template replaced');
    assert.equal((await call('POST', `/api/inline-qc/actions/${line.id}/resolve`, { as: 'mahipal', body: {} })).status, 409);

    assert.ok(!(await mine('mahipal')).data.some((a) => a.id === line.id), 'resolved lines leave the open list');
    assert.ok((await mine('mahipal', '&status=RESOLVED')).data.some((a) => a.id === line.id));

    const again = await call('POST', `/api/inline-qc/actions/${line.id}/reopen`, { as: 'mahipal' });
    assert.equal(again.body.data.status, 'OPEN');
    assert.equal(again.body.data.resolvedByName, null);
    assert.equal((await call('POST', `/api/inline-qc/actions/${line.id}/resolve`, { as: 'mahipal', body: {} })).status, 200);
  });

  test('an edit keeps a resolved defect resolved, drops one taken off, adds one put on', async () => {
    const res = await call('PATCH', `/api/inline-qc/${entryIds[0]}`, {
      as: 'sunita', body: { defects: [{ defect: 'Handle Size', qty: 3 }, { defect: 'Slanted Label', qty: 2 }], pcsRejected: '5' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body.data.defects.map((d) => [d.defect, d.status]).sort(),
      [['Handle Size', 'RESOLVED'], ['Slanted Label', 'OPEN']],
    );
  });

  test('a new Inform To takes over the open defects, and is told', async () => {
    const res = await call('PATCH', `/api/inline-qc/${entryIds[0]}`, { as: 'sunita', body: { informToUserId: users.anil.id } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.informToName, 'Anil Kumar');
    const anilList = (await mine('anil')).data.filter((a) => a.entryId === entryIds[0]);
    assert.deepEqual(anilList.map((a) => a.defect), ['Slanted Label']);
    assert.ok(!(await mine('mahipal')).data.some((a) => a.entryId === entryIds[0]));
    // A Unit 1 supervisor reads a Unit 2 check addressed to them.
    assert.equal((await call('GET', `/api/inline-qc/${entryIds[0]}`, { as: 'anil' })).status, 200);
    assert.ok(await prisma.notification.findFirst({ where: { userId: users.anil.id, documentId: entryIds[0] } }));
  });

  test('the tailor, order and style are fixed once recorded', async () => {
    const res = await call('PATCH', `/api/inline-qc/${entryIds[0]}`, { as: 'sunita', body: { tailorId: unit1Tailor.id } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.tailorId, tailor.id);
  });

  test('Excel export: the workbook columns, and a supervisor\'s file is their unit only', async () => {
    const csv = await call('GET', `/api/exports/inline-qc/csv?orderId=${opt.orderId}`, { as: 'sunita' });
    assert.equal(csv.status, 200, String(csv.body).slice(0, 300));
    const header = String(csv.body).replace(/^\uFEFF/, '').split(/\r?\n/)[0];
    for (const h of ['Date', 'Check Type', 'Order No', 'Unit', 'Tailor Name', 'Style No', 'Operation', 'Size', 'Pcs Checked', 'Pcs Rejected', 'Defects Found', 'Inform To']) {
      assert.ok(header.split(',').includes(h), `${h} in ${header}`);
    }
    assert.match(String(csv.body), /Handle Size; Slanted Label/);

    const anil = await call('GET', `/api/exports/inline-qc/csv?orderId=${opt.orderId}`, { as: 'anil' });
    assert.ok(!String(anil.body).includes(UNIT2), 'Unit 1\'s file carries no Unit 2 rows');

    const actions = await call('GET', '/api/exports/inline-qc-actions/csv?scope=all&status=ALL', { as: 'dinesh' });
    assert.equal(actions.status, 200, String(actions.body).slice(0, 300));
    assert.match(String(actions.body), /Resolved By/);
  });

  test('the audit log has the checks and every defect line, including the resolve', async () => {
    const entries = await prisma.auditLog.count({ where: { tableName: 'inline_qc_entries', recordId: { in: entryIds } } });
    assert.ok(entries >= entryIds.length);
    const lines = await prisma.auditLog.findMany({ where: { tableName: 'inline_qc_defects', createdAt: { gte: startedAt } } });
    assert.ok(lines.some((l) => l.action === 'CREATE'));
    assert.ok(lines.some((l) => l.action === 'DELETE'), 'the defect taken off is in the trail');
    assert.ok(lines.some((l) => l.action === 'UPDATE' && l.after?.status === 'RESOLVED'));
  });

  test('roles: the checker cannot delete; the Director reads and exports but cannot record', async () => {
    assert.equal((await call('DELETE', `/api/inline-qc/${entryIds[1]}`, { as: 'sunita' })).status, 403);
    assert.equal((await call('GET', '/api/inline-qc', { as: 'dinesh' })).status, 200);
    assert.equal((await post(sizeCheck(), 'dinesh')).status, 403);
  });

  test('deleting a check takes its defects off the Action needed list', async () => {
    const del = await call('DELETE', `/api/inline-qc/${entryIds[1]}`, { as: 'admin' });
    assert.equal(del.status, 200);
    assert.ok(!(await mine('mahipal')).data.some((a) => a.entryId === entryIds[1]));
  });
});
