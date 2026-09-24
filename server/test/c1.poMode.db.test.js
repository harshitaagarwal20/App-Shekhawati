/**
 * C1 - PURCHASE ORDER MODE. End-to-end tests. REQUIRES A DATABASE.
 *
 *     npm run db:setup          # migrate + seed
 *     npm test --workspace server
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS FILE EXISTS SEPARATELY FROM c1.poMode.rules.test.js
 *
 *  The rules file proves the ceiling FUNCTION is right. This one proves the
 *  ceiling is actually ENFORCED, at both levels C1 requires:
 *
 *    1. the API refuses an over-tolerance AS_PER_STYLE order;
 *    2. PostgreSQL refuses the same row if the service is bypassed entirely.
 *
 *  (2) is the case that matters most and is the easiest to fake. It is written
 *  here as a RAW INSERT that never touches purchaseOrder.service.js, so the
 *  only thing standing between it and a committed row is the CHECK constraint
 *  itself. If someone deletes the constraint, this test fails; if someone
 *  deletes the service validation, test (1) fails. Neither covers for the
 *  other.
 * ---------------------------------------------------------------------------
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import { createApp } from '../src/app.js';
import prisma from '../src/config/prisma.js';

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';

let server;
let base;
let adminToken;
let vendor;
let style;
let buyer;
let order;

const stamp = Date.now();
const createdPoIds = [];
const createdOrderIds = [];

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

async function signIn(username, password) {
  await prisma.user.updateMany({ where: { username }, data: { mustChangePassword: false } });
  const res = await call('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(res.status, 200, `login for ${username} failed: ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
}

/**
 * The style requirement the server will compute for a fabric line on `order`.
 *
 * Header utilisation x effective quantity x (1 + the Fabric BOM line's
 * wastage). The wastage term is NOT optional padding: the Style model has no
 * wastage column, so the Fabric BOM line is the only place fabric wastage is
 * ever declared, and `requirementFor()` reads it. A helper that left it out
 * would quietly assert the old behaviour, in which the PO ceiling capped
 * procurement below the figure the order screen showed.
 */
function fabricRequirement(on = order) {
  const fabricLine = (style.bomLines ?? []).find(
    (b) => b.itemCategory === 'Fabric' && b.deletedAt == null && b.isActive !== false,
  );
  return new Prisma.Decimal(style.avgFabricUtilizationPerPc)
    .mul(new Prisma.Decimal(on.effectiveQty))
    .mul(new Prisma.Decimal(1).plus(new Prisma.Decimal(fabricLine?.wastagePct ?? 0)))
    .toDecimalPlaces(4);
}

/**
 * A buyer order with NOTHING on it, for one test to spend.
 *
 * The seed's own order already carries an approved 4,500 m fabric PO, and the
 * ceiling is cumulative: every PO against the same order and item shares one
 * requirement. Borrowing that order meant these cases were judged against
 * whatever headroom the seed happened to leave - which was none - so a case
 * asserting "this quantity is accepted" failed for a reason that had nothing
 * to do with what it was testing.
 *
 * A fresh order per case also keeps them independent of each other. Several
 * below deliberately post a PO, and a BULK order consumes the ceiling exactly
 * as an AS_PER_STYLE one does.
 */
async function freshOrder() {
  const row = await prisma.buyerOrder.create({
    data: {
      orderNo: `C1-MODE-${stamp}-${createdOrderIds.length + 1}`,
      styleId: style.id,
      buyerId: buyer.id,
      orderDate: new Date(),
      orderQty: '10000',
      // No approved excess, so effectiveQty === orderQty and the expected
      // figures stay readable.
      effectiveQty: '10000',
    },
  });
  createdOrderIds.push(row.id);
  return row;
}

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  adminToken = await signIn('admin', ADMIN_PASSWORD);

  vendor = await prisma.vendor.findFirst({
    where: { deletedAt: null, status: 'ACTIVE', poInitials: { not: null } },
  });
  style = await prisma.style.findFirst({
    where: { deletedAt: null, avgFabricUtilizationPerPc: { gt: 0 } },
    include: { bomLines: true },
  });

  assert.ok(vendor, 'seed must provide an active vendor with PO initials');
  assert.ok(style, 'seed must provide a style with an average utilisation');

  const seeded = await prisma.buyerOrder.findFirst({
    where: { deletedAt: null, styleId: style.id },
    select: { buyerId: true },
  });
  assert.ok(seeded, 'seed must provide a buyer order for that style');
  buyer = { id: seeded.buyerId };

  order = await freshOrder();
});

after(async () => {
  if (createdPoIds.length) {
    await prisma.approvalHistory.deleteMany({ where: { documentId: { in: createdPoIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: createdPoIds } } });
  }
  if (createdOrderIds.length) {
    await prisma.buyerOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
  }
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});

/**
 * Inserts a PO row with RAW SQL, past the service, the validator and Prisma's
 * own typing. Nothing but the table's own constraints can refuse it.
 *
 * Every NOT NULL column is listed, including the three (`category`,
 * `order_tolerance_pct`, `receipt_tolerance_pct`) that C2 added after these
 * cases were written. That omission was not a harmless one: the insert failed
 * with a NOT NULL violation BEFORE reaching the CHECK constraint the test
 * exists to prove, so the case passed its `assert.rejects` on the wrong error
 * and the C1 ceiling constraint went unproven. The rejection matcher below is
 * now specific for the same reason.
 *
 * `amount` is computed rather than passed: another CHECK asserts it equals
 * ROUND(order_qty * rate, 2), and a test tripping over that one while aiming
 * at a different one proves nothing.
 */
function insertPoRaw({
  poId,
  orderQty = 1000,
  rate = 100,
  excessAllowed = '0.02',
  orderMode = 'AS_PER_STYLE',
  requirement = 1000,
}) {
  const qty = new Prisma.Decimal(orderQty);
  const amount = qty.mul(rate).toDecimalPlaces(2);

  return prisma.$executeRaw`
    INSERT INTO purchase_orders (
      id, po_id, po_date, item, category, uom, order_qty, rate, amount,
      excess_allowed, order_tolerance_pct, receipt_tolerance_pct,
      vendor_id, order_mode, computed_requirement_qty,
      status, approval_status, workflow_state, received_qty,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${poId}, CURRENT_DATE, 'Fabric', 'FABRIC', 'Mtrs',
      ${qty}, ${new Prisma.Decimal(rate)}, ${amount},
      ${new Prisma.Decimal(excessAllowed)}, 0.03, 0.02,
      ${vendor.id}::uuid, ${orderMode}::"PoOrderMode", ${new Prisma.Decimal(requirement)},
      'PENDING', 'PENDING', 'PENDING_APPROVAL', 0,
      now(), now()
    )`;
}

/** Posts a PO against `order` (or `on`, for a case that wants a clean slate). */
async function makePo(body, on) {
  const res = await call('POST', '/api/purchase-orders', {
    token: adminToken,
    body: {
      vendorId: vendor.id,
      orderId: (on ?? order).id,
      styleId: style.id,
      item: 'Fabric',
      subCategory: '10 oz',
      uom: 'Mtrs',
      rate: '100',
      hsnCode: '52081290',
      ...body,
    },
  });
  if (res.status === 201 && res.body?.data?.id) createdPoIds.push(res.body.data.id);
  return res;
}

describe('C1 - the mode must be stated', () => {
  /**
   * 422, not 400.
   *
   * `orderMode` is a REQUIRED field on the create schema, so the request never
   * reaches the service: validate.js refuses it with the 422 / VALIDATION_FAILED
   * that every schema failure in this API produces, and names the field so the
   * form can mark it. A 400 is what the service raises for a business refusal
   * it had to think about - an over-ceiling quantity, say.
   *
   * Both are refusals, which is what C1 asks for. The status codes are
   * asserted precisely because a screen branches on them.
   */
  test('a PO with no orderMode is refused by the API', async () => {
    const res = await makePo({ orderQty: '10', excessAllowed: '0.02' });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
    assert.ok(
      res.body.error.details.fields.orderMode,
      `the refusal must name the field, got ${JSON.stringify(res.body.error.details)}`,
    );
  });

  test('a PO with an unknown orderMode is refused', async () => {
    const res = await makePo({ orderMode: 'WHATEVER', orderQty: '10', excessAllowed: '0.02' });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.ok(res.body.error.details.fields.orderMode);
  });

  /**
   * And the column is NOT NULL, so the guarantee does not rest on the schema
   * alone. Rule 19: application validation by itself does not count.
   */
  test('PostgreSQL refuses a PO row with no mode at all', async () => {
    await assert.rejects(
      () => insertPoRaw({ poId: `C1-RAW-NOMODE-${Date.now()}`, orderMode: null }),
      (err) => {
        // 23502 is PostgreSQL's not-null violation. Matched by SQLSTATE rather
        // than by prose: Prisma's raw-query message reports the failing row
        // but not the column, so there is no name to match on.
        assert.match(
          String(err?.message ?? err),
          /23502/,
          'order_mode must be NOT NULL at the database level, not merely required by the schema',
        );
        return true;
      },
    );
  });
});

describe('C1 - AS_PER_STYLE is a hard cap', () => {
  test('a quantity over requirement x (1 + tolerance) is refused by the API', async () => {
    const on = await freshOrder();
    const over = fabricRequirement(on).mul('1.5').toDecimalPlaces(4);
    const res = await makePo(
      { orderMode: 'AS_PER_STYLE', orderQty: over.toString(), excessAllowed: '0.02' },
      on,
    );
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(JSON.stringify(res.body), /exceed|permit/i);
  });

  test('a quantity within the ceiling is accepted, and freezes the requirement', async () => {
    const on = await freshOrder();
    const req = fabricRequirement(on);
    const res = await makePo(
      {
        orderMode: 'AS_PER_STYLE',
        orderQty: req.mul('0.5').toDecimalPlaces(4).toString(),
        excessAllowed: '0.02',
      },
      on,
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const row = await prisma.purchaseOrder.findUnique({ where: { id: res.body.data.id } });
    assert.ok(row.computedRequirementQty, 'the requirement must be persisted, not recomputed');
    assert.equal(
      new Prisma.Decimal(row.computedRequirementQty).toFixed(4),
      req.toDecimalPlaces(4).toFixed(4),
    );
    assert.ok(row.requirementBasis, 'the basis is snapshotted alongside the number');
    assert.equal(row.bulkVarianceQty, null, 'variance is a BULK-only measurement');
  });

  /**
   * THE CONSTRAINT TEST.
   *
   * Bypasses the service, the validator and Prisma's own typing with a raw
   * INSERT. Nothing but the CHECK constraint can refuse this row.
   */
  test('PostgreSQL refuses the same over-ceiling row when the service is bypassed', async () => {
    await assert.rejects(
      () =>
        insertPoRaw({
          poId: `C1-RAW-${Date.now()}`,
          // 1200 against a ceiling of 1000 x 1.02 = 1020.
          orderQty: 1200,
          excessAllowed: '0.02',
          requirement: 1000,
        }),
      (err) => {
        const text = String(err?.message ?? err);
        // NAMED, not just "some constraint". The whole value of this case is
        // that THIS constraint refused the row; matching any error at all
        // would have let a NOT NULL violation stand in for it.
        assert.match(
          text,
          /purchase_orders_as_per_style_within_requirement/i,
          `expected the C1 ceiling CHECK constraint to refuse this row, got: ${text}`,
        );
        return true;
      },
      'a raw insert past the application must still be refused by the database',
    );
  });

  test('the same raw insert IS accepted once the quantity is inside the ceiling', async () => {
    const poId = 'C1-RAW-OK-' + Date.now();
    // 1020 IS 1000 x 1.02 - the boundary itself, which the constraint permits.
    await insertPoRaw({ poId, orderQty: 1020, excessAllowed: '0.02', requirement: 1000 });

    const row = await prisma.purchaseOrder.findUnique({ where: { poId } });
    assert.ok(row, 'exactly at the ceiling must be permitted');
    await prisma.purchaseOrder.delete({ where: { id: row.id } });
  });
});

describe('C1 - BULK is never blocked, and its variance is recorded', () => {
  test('BULK may exceed the computed requirement substantially', async () => {
    const on = await freshOrder();
    const over = fabricRequirement(on).mul('5').toDecimalPlaces(4);
    const res = await makePo(
      { orderMode: 'BULK', orderQty: over.toString(), excessAllowed: '0.02' },
      on,
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const row = await prisma.purchaseOrder.findUnique({ where: { id: res.body.data.id } });
    assert.ok(row.bulkVarianceQty, 'a bulk order against a reference style records its variance');
    assert.equal(
      new Prisma.Decimal(row.bulkVarianceQty).toFixed(4),
      over.minus(fabricRequirement(on).toDecimalPlaces(4)).toDecimalPlaces(4).toFixed(4),
    );
  });

  test('the database also permits a BULK row far past its requirement', async () => {
    const poId = 'C1-RAW-BULK-' + Date.now();
    await insertPoRaw({ poId, orderQty: 99999, orderMode: 'BULK', requirement: 1000 });

    const row = await prisma.purchaseOrder.findUnique({ where: { poId } });
    assert.ok(row, 'the CHECK must not bind a BULK order');
    await prisma.purchaseOrder.delete({ where: { id: row.id } });
  });
});

describe('C1 - the frozen requirement does not follow the BOM', () => {
  test('changing the style after posting does not change the stored requirement', async () => {
    const on = await freshOrder();
    const req = fabricRequirement(on);
    const res = await makePo(
      {
        orderMode: 'AS_PER_STYLE',
        orderQty: req.mul('0.4').toDecimalPlaces(4).toString(),
        excessAllowed: '0.02',
      },
      on,
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const poId = res.body.data.id;

    const before_ = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    const frozen = new Prisma.Decimal(before_.computedRequirementQty).toFixed(4);

    const originalUtilisation = style.avgFabricUtilizationPerPc;
    try {
      // Double the style's consumption. Every future PO would be judged
      // against a different requirement - this one must not be.
      await prisma.style.update({
        where: { id: style.id },
        data: { avgFabricUtilizationPerPc: new Prisma.Decimal(originalUtilisation).mul(2) },
      });

      const after_ = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
      assert.equal(
        new Prisma.Decimal(after_.computedRequirementQty).toFixed(4),
        frozen,
        'the stored requirement must not move when the BOM behind it does',
      );

      // And it is still the stored figure that the read path reports.
      const fetched = await call('GET', `/api/purchase-orders/${poId}`, { token: adminToken });
      assert.equal(fetched.status, 200);
      assert.equal(
        new Prisma.Decimal(fetched.body.data.computedRequirementQty).toFixed(4),
        frozen,
      );
    } finally {
      await prisma.style.update({
        where: { id: style.id },
        data: { avgFabricUtilizationPerPc: originalUtilisation },
      });
    }
  });
});
