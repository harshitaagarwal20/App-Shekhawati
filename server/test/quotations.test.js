/**
 * Phase 5 - Vendor Quotation end-to-end tests.
 *
 * The central concern is that Amount is the server's: it is qty x rate, and a
 * client-supplied amount is never authoritative. Several cases below post one
 * deliberately and assert the API ignores it.
 *
 * Requires a migrated, seeded database:
 *     npm run db:setup
 *     npm test --workspace server
 *
 * The DB-free equivalent of the formula lives in rules.test.js.
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

import { createApp } from '../src/app.js';
import prisma from '../src/config/prisma.js';

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';
const USER_PASSWORD = process.env.SEED_DEFAULT_USER_PASSWORD || 'Shekhawati@123';

let server;
let base;
let adminToken;
let storeToken;
let directorToken;
let vendor;
let order;

const created = [];

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

/**
 * Signs in, having first put the account into the state this suite needs.
 *
 * ---------------------------------------------------------------------------
 *  WHY THE PASSWORD IS SET AND NOT MERELY USED
 *
 *  This helper used to clear `mustChangePassword` and then log in with the
 *  seeded password, which quietly assumed the seeded password was still the
 *  account's password. It is a real account in a shared database: somebody
 *  signed in as `dinesh` through the UI on 2026-08-29, completed the forced
 *  first-login password change, and from that moment four tests failed with
 *  INVALID_CREDENTIALS and took eighty more down with them as cancelled. The
 *  suite was reporting a broken Director approval path when nothing was wrong
 *  with the code at all.
 *
 *  A test may not depend on a credential a person can change underneath it.
 *  Setting the hash makes the account's state an INPUT to the test rather than
 *  an assumption, which is the same reason `after()` puts the seeded passwords
 *  back when the run finishes.
 * ---------------------------------------------------------------------------
 */
async function signIn(username, password) {
  await prisma.user.updateMany({
    where: { username },
    data: { mustChangePassword: false, passwordHash: await bcrypt.hash(password, 10) },
  });
  const res = await call('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(res.status, 200, `login for ${username} failed: ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
}

async function makeQuotation(overrides = {}, token = adminToken) {
  const res = await call('POST', '/api/quotations', {
    token,
    body: {
      item: 'Fabric',
      subCategory: '10 oz',
      vendorId: vendor.id,
      qty: '4500',
      uom: 'Mtrs',
      rateQuoted: '178',
      authorisedBy: 'Dinesh Sir',
      orderId: order.id,
      ...overrides,
    },
  });
  if (res.status === 201) created.push(res.body.data.id);
  return res;
}

before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    throw new Error(
      'Cannot reach the database. Set DATABASE_URL in server/.env and run "npm run db:setup" first.',
      { cause: err },
    );
  }

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  adminToken = await signIn('admin', ADMIN_PASSWORD);
  storeToken = await signIn('ravi', USER_PASSWORD);
  directorToken = await signIn('dinesh', USER_PASSWORD);

  vendor = await prisma.vendor.findFirst({
    where: { vendorName: 'Rajasthan Fabrics', deletedAt: null },
  });
  assert.ok(vendor, 'seeded vendor Rajasthan Fabrics must exist');
  order = await prisma.buyerOrder.findFirst({ where: { orderNo: 'B9641IS', deletedAt: null } });
  assert.ok(order, 'seeded order B9641IS must exist');
});

after(async () => {
  if (created.length) {
    await prisma.approvalHistory.deleteMany({
      where: { documentType: 'VENDOR_QUOTATION', documentId: { in: created } },
    });
    await prisma.vendorQuotation.deleteMany({ where: { id: { in: created } } });
  }
  await prisma.user.updateMany({
    where: { username: { in: ['ravi', 'dinesh'] } },
    data: { mustChangePassword: true },
  });
  server?.close();
  await prisma.$disconnect();
});

// ===========================================================================

describe('THE RULE - Amount is calculated server-side as Qty x Rate', () => {
  test('the amount is derived, and a quotation number is issued', async () => {
    const res = await makeQuotation();
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const q = res.body.data;
    assert.equal(Number(q.amount), 4500 * 178);
    assert.equal(q.authorisationStatus, 'PENDING', 'nobody self-approves on create');
    assert.ok(q.quotationNo.startsWith('QT-'));
  });

  test('a client-supplied amount is NOT authoritative', async () => {
    const res = await makeQuotation({ qty: '100', rateQuoted: '10', amount: '1' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(Number(res.body.data.amount), 1000, 'the posted amount was discarded');
  });

  test('a client-supplied amount is ignored on edit too', async () => {
    const made = await makeQuotation({ qty: '100', rateQuoted: '10' });
    const res = await call('PATCH', `/api/quotations/${made.body.data.id}`, {
      token: adminToken,
      body: { amount: '999999' },
    });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(Number(res.body.data.amount), 1000, 'amount still follows qty x rate');
  });

  test('the amount is recomputed when the quantity moves', async () => {
    const made = await makeQuotation({ qty: '100', rateQuoted: '10' });
    assert.equal(Number(made.body.data.amount), 1000);

    const res = await call('PATCH', `/api/quotations/${made.body.data.id}`, {
      token: adminToken,
      body: { qty: '250' },
    });
    assert.equal(Number(res.body.data.amount), 2500);
  });

  test('the amount is recomputed when the rate moves', async () => {
    const made = await makeQuotation({ qty: '100', rateQuoted: '10' });
    const res = await call('PATCH', `/api/quotations/${made.body.data.id}`, {
      token: adminToken,
      body: { rateQuoted: '12.5' },
    });
    assert.equal(Number(res.body.data.amount), 1250);
  });

  test('a client cannot approve itself through create or edit', async () => {
    const res = await makeQuotation({
      authorisationStatus: 'APPROVED',
      approvedByName: 'Not The Director',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.authorisationStatus, 'PENDING', 'the posted status was stripped');
    assert.equal(res.body.data.approvedByName ?? null, null);
  });

  test('the preview returns the same amount the save would store', async () => {
    const preview = await call('POST', '/api/quotations/preview', {
      token: adminToken,
      body: { qty: '4500', rateQuoted: '178' },
    });
    assert.equal(preview.status, 200);
    assert.equal(Number(preview.body.data.amount), 801000);

    const saved = await makeQuotation({ qty: '4500', rateQuoted: '178' });
    assert.equal(Number(saved.body.data.amount), Number(preview.body.data.amount));
  });

  test('a fractional rate rounds to the stored scale rather than drifting', async () => {
    const res = await makeQuotation({ qty: '3', rateQuoted: '0.005' });
    assert.equal(Number(res.body.data.amount), 0.02);
  });

  test('a zero or negative quantity is refused', async () => {
    assert.equal((await makeQuotation({ qty: '0' })).status, 422);
    assert.equal((await makeQuotation({ qty: '-5' })).status, 422);
  });

  test('a negative rate is refused', async () => {
    assert.equal((await makeQuotation({ rateQuoted: '-1' })).status, 422);
  });
});

// ===========================================================================

describe('vendor, item and order reference', () => {
  test('an item outside the List Master is refused', async () => {
    const res = await makeQuotation({ item: 'Unobtainium' });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /not an active value of the ItemCategory list/i);
  });

  test('a UOM outside the List Master is refused', async () => {
    const res = await makeQuotation({ uom: 'Furlongs' });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /not an active value of the UOM list/i);
  });

  test('a non-existent vendor is refused', async () => {
    const res = await makeQuotation({ vendorId: '00000000-0000-4000-8000-000000000000' });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Vendor does not exist/i);
  });

  test('a quotation may be raised without an order reference', async () => {
    const res = await makeQuotation({ orderId: null });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.orderId ?? null, null);
  });

  test('the order reference resolves on read', async () => {
    const made = await makeQuotation();
    const res = await call('GET', `/api/quotations/${made.body.data.id}`, { token: adminToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.order.orderNo, 'B9641IS');
  });
});

// ===========================================================================

describe('authorisation, approval and rejection', () => {
  test('approval stamps who decided and re-derives the amount', async () => {
    const made = await makeQuotation({ qty: '100', rateQuoted: '10' });

    const res = await call('POST', `/api/quotations/${made.body.data.id}/approve`, {
      token: directorToken,
      body: { remarks: 'Lowest of 3 quotes' },
    });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.authorisationStatus, 'APPROVED');
    assert.ok(res.body.data.approvedByName, 'the decider is stamped, not typed');
    assert.ok(res.body.data.approvedAt);
    assert.equal(Number(res.body.data.amount), 1000);
  });

  test('rejection carries a reason and is refused without one', async () => {
    const made = await makeQuotation();

    const bare = await call('POST', `/api/quotations/${made.body.data.id}/reject`, {
      token: directorToken,
      body: {},
    });
    assert.equal(bare.status, 422, 'a rejection needs a reason');

    const res = await call('POST', `/api/quotations/${made.body.data.id}/reject`, {
      token: directorToken,
      body: { reason: 'Rate higher than the competing quote' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.authorisationStatus, 'REJECTED');
    assert.equal(res.body.data.rejectionReason, 'Rate higher than the competing quote');
  });

  test('a decided quotation cannot be edited or decided twice', async () => {
    const made = await makeQuotation();
    await call('POST', `/api/quotations/${made.body.data.id}/approve`, {
      token: directorToken,
      body: {},
    });

    const edit = await call('PATCH', `/api/quotations/${made.body.data.id}`, {
      token: adminToken,
      body: { rateQuoted: '1' },
    });
    assert.equal(edit.status, 409, 'a decided quotation is the record of that decision');

    const again = await call('POST', `/api/quotations/${made.body.data.id}/approve`, {
      token: directorToken,
      body: {},
    });
    assert.equal(again.status, 400);
  });

  test('a decided quotation can be reopened while no PO stands on it', async () => {
    const made = await makeQuotation();
    await call('POST', `/api/quotations/${made.body.data.id}/approve`, {
      token: directorToken,
      body: {},
    });

    const res = await call('POST', `/api/quotations/${made.body.data.id}/reopen`, {
      token: directorToken,
      body: { reason: 'Vendor revised the rate' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.authorisationStatus, 'PENDING');
    assert.equal(res.body.data.approvedAt ?? null, null);
    assert.equal(res.body.data.rejectionReason ?? null, null);
  });

  test('the decision is recorded on the trail', async () => {
    const made = await makeQuotation();
    await call('POST', `/api/quotations/${made.body.data.id}/approve`, {
      token: directorToken,
      body: { remarks: 'Approved for the season' },
    });

    const res = await call('GET', `/api/quotations/${made.body.data.id}`, { token: adminToken });
    const actions = res.body.data.history.map((h) => h.action);
    assert.ok(actions.includes('SUBMITTED'));
    assert.ok(actions.includes('APPROVED'));
  });
});

// ===========================================================================

describe('RBAC - Procurement raises, the Director decides', () => {
  test('the store manager may raise a quotation but not authorise it', async () => {
    const made = await makeQuotation({}, storeToken);
    assert.equal(made.status, 201, JSON.stringify(made.body));

    const approve = await call('POST', `/api/quotations/${made.body.data.id}/approve`, {
      token: storeToken,
      body: {},
    });
    assert.equal(approve.status, 403, 'VENDOR_QUOTATION.APPROVE is the Director’s');

    const reject = await call('POST', `/api/quotations/${made.body.data.id}/reject`, {
      token: storeToken,
      body: { reason: 'trying to decide my own quotation' },
    });
    assert.equal(reject.status, 403);
  });
});

// ===========================================================================

describe('competing quotations', () => {
  test('the cheapest rate for the same item is identified', async () => {
    const stamp = Date.now();
    const dear = await makeQuotation({
      quotationNo: `T-CMP-A-${stamp}`,
      rateQuoted: '200',
      qty: '1000',
      subCategory: '12 oz',
    });
    const cheap = await makeQuotation({
      quotationNo: `T-CMP-B-${stamp}`,
      rateQuoted: '150',
      qty: '1000',
      subCategory: '12 oz',
    });
    assert.equal(dear.status, 201);
    assert.equal(cheap.status, 201);

    const res = await call('GET', `/api/quotations/${dear.body.data.id}`, { token: adminToken });
    assert.equal(res.body.data.competing.isLowestRate, false);
    assert.equal(Number(res.body.data.competing.lowestRate), 150);
    // 1000 pieces at 50 more each.
    assert.equal(Number(res.body.data.competing.premiumOverLowest), 50000);

    const cheapDetail = await call('GET', `/api/quotations/${cheap.body.data.id}`, {
      token: adminToken,
    });
    assert.equal(cheapDetail.body.data.competing.isLowestRate, true);
    assert.equal(Number(cheapDetail.body.data.competing.premiumOverLowest), 0);
  });

  test('the order comparison groups quotes by what was being bought', async () => {
    const res = await call('GET', `/api/quotations/order/${order.id}/compare`, {
      token: adminToken,
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data.groups));
    for (const group of res.body.data.groups) {
      assert.ok(group.lowestRate, 'every group names a cheapest rate');
      assert.ok(group.quotations.some((q) => q.isLowestRate));
    }
  });
});
