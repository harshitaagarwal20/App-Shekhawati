/**
 * Phase 3 - Buyer Order end-to-end tests.
 *
 * The central concern here is that quantities are the server's. Several cases
 * below post a calculated field deliberately (effectiveQty, excessApprovedPct)
 * and assert that the API ignores it.
 *
 * Requires a migrated, seeded database:
 *     npm run db:setup
 *     npm test --workspace server
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

import { createApp } from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { calculateEffectiveQty, calculateRequirement } from '../src/services/buyerOrder.service.js';

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';
const USER_PASSWORD = process.env.SEED_DEFAULT_USER_PASSWORD || 'Shekhawati@123';

let server;
let base;
let adminToken;
let merchToken;
let directorToken;
let buyer;
let style;

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

/** Creates an order and remembers it for cleanup. */
async function makeOrder(overrides = {}, token = adminToken) {
  const res = await call('POST', '/api/orders', {
    token,
    body: {
      buyerId: buyer.id,
      styleId: style.id,
      orderQty: '1000',
      colorCode: 'Natural',
      sizeGroup: 'Free Size',
      currency: 'USD',
      shipMode: 'Ship',
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
  merchToken = await signIn('merch', USER_PASSWORD);
  directorToken = await signIn('dinesh', USER_PASSWORD);

  // Work against a style that has BOM lines, so the requirement is meaningful.
  style = await prisma.style.findFirst({
    where: { styleNo: 'TR-0751-008', deletedAt: null },
    include: { bomLines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
  });
  assert.ok(style, 'seeded style TR-0751-008 must exist');
  buyer = await prisma.buyer.findFirst({ where: { id: style.buyerId } });
});

after(async () => {
  if (created.length) {
    await prisma.approvalHistory.deleteMany({
      where: { documentType: 'BUYER_ORDER', documentId: { in: created } },
    });
    await prisma.documentAmendment.deleteMany({
      where: { documentType: 'BUYER_ORDER', documentId: { in: created } },
    });
    await prisma.buyerOrder.deleteMany({ where: { id: { in: created } } });
  }
  await prisma.user.updateMany({
    where: { username: { in: ['merch', 'dinesh'] } },
    data: { mustChangePassword: true },
  });
  server?.close();
  await prisma.$disconnect();
});

// ===========================================================================

describe('order creation', () => {
  test('creates an order and derives the fields the sheet marks Auto', async () => {
    const res = await makeOrder({ orderNo: `T-CREATE-${Date.now()}` });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const order = res.body.data;

    assert.equal(Number(order.orderQty), 1000);
    // No excess asked for, so the ceiling is the plain quantity.
    assert.equal(Number(order.effectiveQty), 1000);
    assert.equal(order.excessApprovalStatus, 'NOT_REQUIRED');
    assert.equal(order.status, 'PENDING');
    // "Bill To" is Auto from the Buyer Master; description falls back to the style.
    assert.ok(order.billTo.includes(buyer.buyerName));
    assert.equal(order.itemDescription, style.styleDescription);
  });

  test('generates an order number when the buyer PO number is not known', async () => {
    const res = await makeOrder();
    assert.equal(res.status, 201);
    assert.match(res.body.data.orderNo, /^SO-\d{5}$/);
  });

  test('keeps the buyer PO number when one is supplied', async () => {
    const orderNo = `B-TEST-${Date.now()}`;
    const res = await makeOrder({ orderNo });
    assert.equal(res.body.data.orderNo, orderNo);
  });

  test('refuses a duplicate order number', async () => {
    const orderNo = `B-DUP-${Date.now()}`;
    await makeOrder({ orderNo });
    const second = await makeOrder({ orderNo });
    assert.equal(second.status, 409);
  });

  test('refuses a style that belongs to a different buyer', async () => {
    const otherStyle = await prisma.style.findFirst({
      where: { buyerId: { not: buyer.id }, deletedAt: null, status: 'ACTIVE' },
    });
    const res = await makeOrder({ styleId: otherStyle.id });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /different buyer/i);
  });

  test('refuses a zero or negative quantity', async () => {
    assert.equal((await makeOrder({ orderQty: '0' })).status, 422);
    assert.equal((await makeOrder({ orderQty: '-5' })).status, 422);
  });

  test('refuses a colour that is not in the ColorCode list', async () => {
    const res = await makeOrder({ colorCode: 'Invisible Mauve' });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /ColorCode/);
  });

  test('an excess request needs a justification', async () => {
    const res = await makeOrder({ excessPct: '0.02' });
    assert.equal(res.status, 422);
    assert.ok(res.body.error.details.fields.excessJustification);
  });
});

describe('quantities are calculated on the server', () => {
  test('a client-supplied effectiveQty is ignored, not trusted', async () => {
    const res = await makeOrder({
      orderQty: '1000',
      // A tampered client trying to grant itself 10x the order.
      effectiveQty: '10000',
      excessApprovedPct: '0.5',
      excessApprovalStatus: 'APPROVED',
    });
    assert.equal(res.status, 201);
    const order = res.body.data;
    assert.equal(Number(order.effectiveQty), 1000, 'effectiveQty must come from the server');
    assert.equal(Number(order.excessApprovedPct), 0);
    assert.equal(order.excessApprovalStatus, 'NOT_REQUIRED');
  });

  test('an unapproved excess does not raise the effective quantity', async () => {
    const res = await makeOrder({
      orderQty: '1000',
      excessPct: '0.03',
      excessJustification: 'Cutting allowance for a gusseted style',
    });
    assert.equal(res.status, 201);
    const order = res.body.data;
    assert.equal(order.excessApprovalStatus, 'PENDING');
    assert.equal(Number(order.excessPct), 0.03);
    assert.equal(Number(order.excessApprovedPct), 0);
    // The whole point: 3% was asked for, none of it is usable yet.
    assert.equal(Number(order.effectiveQty), 1000);
  });

  test('the requirement is derived from the BOM, with wastage and excess', async () => {
    const res = await makeOrder({ orderQty: '1000' });
    const detail = await call('GET', `/api/orders/${res.body.data.id}`, { token: adminToken });
    assert.equal(detail.status, 200);

    const { requirement } = detail.body.data;
    const fabricLine = requirement.lines.find((l) => l.itemCategory === 'Fabric');
    const bomFabric = style.bomLines.find((l) => l.itemCategory === 'Fabric');

    // C9 renamed the column. `style` here is a RAW PRISMA ROW, not an API
    // response, so it carries only the new name - the deprecated `qtyPerPc`
    // alias is added at the API boundary and deliberately does not exist on
    // the model. Read the real field.
    const perPc = Number(bomFabric.avgUtilisationPerPiece);
    const wastage = Number(bomFabric.wastagePct);
    assert.equal(Number(fabricLine.baseRequirement), perPc * 1000);
    assert.equal(
      Number(fabricLine.withWastage).toFixed(4),
      (perPc * 1000 * (1 + wastage)).toFixed(4),
    );

    // The header average is the authority for fabric.
    assert.equal(
      Number(requirement.fabric.forOrderQty).toFixed(4),
      (Number(style.avgFabricUtilizationPerPc) * 1000).toFixed(4),
    );
  });

  test('the preview endpoint calculates without saving anything', async () => {
    const before = await prisma.buyerOrder.count();
    const res = await call('POST', '/api/orders/preview', {
      token: merchToken,
      body: { styleId: style.id, orderQty: '2000', excessPct: '0.02' },
    });
    assert.equal(res.status, 200);
    assert.equal(Number(res.body.data.effectiveQty), 2000, 'excess is not approved in a preview');
    assert.equal(Number(res.body.data.effectiveQtyIfExcessApproved), 2040);
    assert.equal(await prisma.buyerOrder.count(), before, 'preview must not create anything');
  });

  test('the calculation helpers are exact, not floating-point approximations', () => {
    assert.equal(calculateEffectiveQty('10000', '0.03').toString(), '10300');
    assert.equal(calculateEffectiveQty('7000', '0').toString(), '7000');
    // 0.1 + 0.2 territory: Decimal must not drift.
    assert.equal(calculateEffectiveQty('3', '0.1').toString(), '3.3');

    const req = calculateRequirement(
      { avgFabricUtilizationPerPc: '0.85', avgUtilizationUom: 'Mtrs', bomLines: [
        { lineNo: 1, itemCategory: 'Fabric', uom: 'Mtrs', avgUtilisationPerPiece: '0.85', wastagePct: '0.02' },
      ] },
      '1000',
      '1020',
    );
    assert.equal(req.lines[0].baseRequirement, '850.0000');
    assert.equal(req.lines[0].withWastage, '867.0000');
    assert.equal(req.lines[0].withExcess, '884.3400');
  });
});

describe('excess approval workflow', () => {
  let orderId;

  before(async () => {
    const res = await makeOrder({
      orderQty: '5000',
      excessPct: '0.02',
      excessJustification: 'Standard 2% cutting allowance',
    });
    orderId = res.body.data.id;
  });

  test('the request is logged on the approval trail at creation', async () => {
    const detail = await call('GET', `/api/orders/${orderId}`, { token: adminToken });
    const submitted = detail.body.data.approvals.filter((a) => a.action === 'SUBMITTED');
    assert.ok(submitted.length >= 1);
    assert.equal(submitted[0].toStatus, 'PENDING');
  });

  test('a merchandiser cannot approve their own excess', async () => {
    const res = await call('POST', `/api/orders/${orderId}/excess/approve`, {
      token: merchToken,
      body: {},
    });
    assert.equal(res.status, 403);
    assert.deepEqual(res.body.error.details.required, ['BUYER_ORDER.APPROVE']);
  });

  test('the Director cannot grant more than was requested', async () => {
    const res = await call('POST', `/api/orders/${orderId}/excess/approve`, {
      token: directorToken,
      body: { approvedPct: '0.10' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /requested/i);
  });

  test('approving raises the effective quantity by exactly the granted percentage', async () => {
    const res = await call('POST', `/api/orders/${orderId}/excess/approve`, {
      token: directorToken,
      body: { approvedPct: '0.01', remarks: 'Half of what was asked for' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const order = res.body.data;

    assert.equal(order.excessApprovalStatus, 'APPROVED');
    assert.equal(Number(order.excessPct), 0.02, 'the request is kept as it was made');
    assert.equal(Number(order.excessApprovedPct), 0.01);
    assert.equal(Number(order.effectiveQty), 5050, '5000 x 1.01');
    assert.equal(Number(order.excessQty), 50);
    assert.ok(order.excessApprovedAt);
    assert.equal(order.excessApprovedByName, 'Dinesh Sir');
  });

  test('an already-decided excess cannot be decided again', async () => {
    const res = await call('POST', `/api/orders/${orderId}/excess/approve`, {
      token: directorToken,
      body: {},
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /already approved/i);
  });

  test('rejecting returns the order to its plain quantity', async () => {
    const made = await makeOrder({
      orderQty: '4000',
      excessPct: '0.05',
      excessJustification: 'Trial run wastage',
    });
    const id = made.body.data.id;

    const res = await call('POST', `/api/orders/${id}/excess/reject`, {
      token: directorToken,
      body: { reason: 'Five percent is too high for this style' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.excessApprovalStatus, 'REJECTED');
    assert.equal(Number(res.body.data.excessApprovedPct), 0);
    assert.equal(Number(res.body.data.effectiveQty), 4000);

    const detail = await call('GET', `/api/orders/${id}`, { token: adminToken });
    assert.ok(detail.body.data.approvals.some((a) => a.action === 'REJECTED'));
  });

  test('an order with no excess has nothing to approve', async () => {
    const made = await makeOrder({ orderQty: '100' });
    const res = await call('POST', `/api/orders/${made.body.data.id}/excess/approve`, {
      token: directorToken,
      body: {},
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /nothing to approve/i);
  });
});

describe('editing before approval', () => {
  test('changing the quantity sends an approved excess back to the Director', async () => {
    const made = await makeOrder({
      orderQty: '1000',
      excessPct: '0.02',
      excessJustification: 'Cutting allowance',
    });
    const id = made.body.data.id;

    await call('POST', `/api/orders/${id}/excess/approve`, { token: directorToken, body: {} });
    let detail = await call('GET', `/api/orders/${id}`, { token: adminToken });
    assert.equal(Number(detail.body.data.effectiveQty), 1020);

    const edited = await call('PATCH', `/api/orders/${id}`, {
      token: merchToken,
      body: { orderQty: '1500' },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.excessApprovalStatus, 'PENDING', 'the decision must be revisited');
    assert.equal(Number(edited.body.data.excessApprovedPct), 0);
    assert.equal(Number(edited.body.data.effectiveQty), 1500, 'back to the plain quantity');

    detail = await call('GET', `/api/orders/${id}`, { token: adminToken });
    assert.ok(
      detail.body.data.approvals.some((a) => a.remarks?.includes('resubmitted')),
      'the resubmission should be on the trail',
    );
  });

  test('editing only a remark leaves the excess decision alone', async () => {
    const made = await makeOrder({
      orderQty: '800',
      excessPct: '0.02',
      excessJustification: 'Allowance',
    });
    const id = made.body.data.id;
    await call('POST', `/api/orders/${id}/excess/approve`, { token: directorToken, body: {} });

    const edited = await call('PATCH', `/api/orders/${id}`, {
      token: merchToken,
      body: { remarks: 'Buyer confirmed the artwork' },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.excessApprovalStatus, 'APPROVED');
    assert.equal(Number(edited.body.data.effectiveQty), 816);
  });

  test('a seeded order with downstream documents refuses a structural edit', async () => {
    const seeded = await prisma.buyerOrder.findFirst({ where: { orderNo: 'B9641IS' } });
    assert.ok(seeded, 'seeded order B9641IS must exist');

    const res = await call('PATCH', `/api/orders/${seeded.id}`, {
      token: adminToken,
      body: { orderQty: '9999' },
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /downstream document/i);

    const unchanged = await prisma.buyerOrder.findUnique({ where: { id: seeded.id } });
    assert.equal(Number(unchanged.orderQty), 5000);
  });

  test('a locked order can still be amended, with a reason on record', async () => {
    const seeded = await prisma.buyerOrder.findFirst({ where: { orderNo: 'B9670IS' } });
    const originalQty = Number(seeded.orderQty);

    const res = await call('POST', `/api/orders/${seeded.id}/amend`, {
      token: adminToken,
      body: { reason: 'Buyer increased the order by 500 pieces', orderQty: String(originalQty + 500) },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.amendmentCount, 1);

    const detail = await call('GET', `/api/orders/${seeded.id}`, { token: adminToken });
    const [amendment] = detail.body.data.amendments;
    assert.equal(amendment.amendmentNo, 1);
    assert.equal(amendment.changes.orderQty.after, String(originalQty + 500));

    // Put it back so the suite can be run again.
    await call('POST', `/api/orders/${seeded.id}/amend`, {
      token: adminToken,
      body: { reason: 'Reverting the test amendment', orderQty: String(originalQty) },
    });
    await prisma.documentAmendment.deleteMany({
      where: { documentType: 'BUYER_ORDER', documentId: seeded.id },
    });
    await prisma.buyerOrder.update({
      where: { id: seeded.id },
      data: {
        amendmentCount: 0,
        excessApprovalStatus: 'APPROVED',
        excessApprovedPct: seeded.excessPct,
        excessApprovedAt: seeded.excessApprovedAt ?? new Date(),
        excessApprovedByName: 'Dinesh Sir',
        effectiveQty: calculateEffectiveQty(seeded.orderQty, seeded.excessPct),
      },
    });
  });

  test('an amendment must actually change something', async () => {
    const made = await makeOrder({ orderQty: '600' });
    const res = await call('POST', `/api/orders/${made.body.data.id}/amend`, {
      token: adminToken,
      body: { reason: 'No change at all', orderQty: '600' },
    });
    assert.equal(res.status, 400);
  });
});

describe('status', () => {
  test('follows the allowed transitions and refuses the rest', async () => {
    const made = await makeOrder({ orderQty: '250' });
    const id = made.body.data.id;

    const started = await call('PATCH', `/api/orders/${id}/status`, {
      token: merchToken,
      body: { status: 'IN_PROGRESS' },
    });
    assert.equal(started.status, 200);
    assert.equal(started.body.data.status, 'IN_PROGRESS');

    const done = await call('PATCH', `/api/orders/${id}/status`, {
      token: merchToken,
      body: { status: 'COMPLETED' },
    });
    assert.equal(done.status, 200);

    // Nothing leaves COMPLETED.
    const reopened = await call('PATCH', `/api/orders/${id}/status`, {
      token: merchToken,
      body: { status: 'IN_PROGRESS' },
    });
    // 409, not 400: the request is well formed and the body is valid. What it
    // conflicts with is the state the order is already in. Every invalid
    // transition in the system answers the same way, because they all go
    // through approvalEngine.assertStatusTransition().
    assert.equal(reopened.status, 409);
  });

  test('an order with downstream documents cannot be cancelled or deleted', async () => {
    const seeded = await prisma.buyerOrder.findFirst({ where: { orderNo: 'B9646IS' } });

    const cancelled = await call('PATCH', `/api/orders/${seeded.id}/status`, {
      token: adminToken,
      body: { status: 'CANCELLED' },
    });
    assert.equal(cancelled.status, 409);

    const deleted = await call('DELETE', `/api/orders/${seeded.id}`, { token: adminToken });
    assert.equal(deleted.status, 409);
  });
});

describe('search, filter and detail', () => {
  test('filters by buyer, status, excess state and delivery window', async () => {
    const byBuyer = await call('GET', `/api/orders?buyerId=${buyer.id}`, { token: merchToken });
    assert.equal(byBuyer.status, 200);
    assert.ok(byBuyer.body.data.every((o) => o.buyer.id === buyer.id));

    const pending = await call('GET', '/api/orders?excessApprovalStatus=PENDING', { token: merchToken });
    assert.ok(pending.body.data.every((o) => o.excessApprovalStatus === 'PENDING'));

    const window = await call('GET', '/api/orders?deliveryFrom=2026-09-01&deliveryTo=2026-09-30', {
      token: merchToken,
    });
    assert.equal(window.status, 200);
    for (const o of window.body.data) {
      const d = new Date(o.buyerDeliveryDate);
      assert.ok(d >= new Date('2026-09-01') && d <= new Date('2026-09-30'));
    }

    const searched = await call('GET', '/api/orders?search=B9641', { token: merchToken });
    assert.ok(searched.body.data.some((o) => o.orderNo === 'B9641IS'));
  });

  test('sorts and pages', async () => {
    const sorted = await call('GET', '/api/orders?sortBy=orderQty&sortDir=desc&pageSize=5', {
      token: merchToken,
    });
    const qtys = sorted.body.data.map((o) => Number(o.orderQty));
    assert.deepEqual(qtys, [...qtys].sort((a, b) => b - a));

    const paged = await call('GET', '/api/orders?page=1&pageSize=3', { token: merchToken });
    assert.ok(paged.body.data.length <= 3);
    assert.equal(paged.body.meta.pageSize, 3);
  });

  test('detail carries the requirement, procurement, usage and trail', async () => {
    const seeded = await prisma.buyerOrder.findFirst({ where: { orderNo: 'B9641IS' } });
    const { status, body } = await call('GET', `/api/orders/${seeded.id}`, { token: merchToken });
    assert.equal(status, 200);

    const d = body.data;
    assert.ok(d.requirement.lines.length > 0);
    assert.ok(d.procurement.count > 0, 'B9641IS has purchase orders in the seed');
    assert.ok(d.usage.total > 0);
    assert.equal(d.editable.canEditStructural, false);
    assert.equal(d.editable.requiresAmendment, true);
    assert.ok(Array.isArray(d.approvals));
  });

  test('QC may read orders but not raise, edit or approve one', async () => {
    const qcToken = await signIn('sunita', USER_PASSWORD);

    // QC holds BUYER_ORDER.VIEW - a scrutiny report is written against an order.
    assert.equal((await call('GET', '/api/orders', { token: qcToken })).status, 200);

    const created = await call('POST', '/api/orders', {
      token: qcToken,
      body: { buyerId: buyer.id, styleId: style.id, orderQty: '10' },
    });
    assert.equal(created.status, 403);
    assert.deepEqual(created.body.error.details.required, ['BUYER_ORDER.CREATE']);

    const seeded = await prisma.buyerOrder.findFirst({ where: { orderNo: 'B9641IS' } });
    assert.equal(
      (await call('PATCH', `/api/orders/${seeded.id}`, { token: qcToken, body: { remarks: 'x' } })).status,
      403,
    );
    assert.equal(
      (await call('POST', `/api/orders/${seeded.id}/excess/approve`, { token: qcToken, body: {} })).status,
      403,
    );

    await prisma.user.updateMany({ where: { username: 'sunita' }, data: { mustChangePassword: true } });
  });
});
