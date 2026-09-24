/**
 * Phase 4 - Planning end-to-end tests.
 *
 * The central concern is the ceiling: a plan may never allot more than the
 * order permits, and what the order permits is its quantity plus the excess the
 * Director APPROVED - never the excess that was merely requested. Several cases
 * below post calculated fields deliberately (plannedQty, orderQty, styleNo) and
 * assert the API ignores them.
 *
 * Requires a migrated, seeded database:
 *     npm run db:setup
 *     npm test --workspace server
 *
 * The DB-free equivalents of the arithmetic live in rules.test.js.
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
let plannerToken;
let directorToken;
let buyer;
let style;

const createdOrders = [];
const createdPlans = [];

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

/**
 * An order to plan against. `approvedExcess` grants the excess through the real
 * Director endpoint, so the ceiling under test is the one the API produced.
 */
async function makeOrder({ orderQty = '5000', excessPct, approvedExcess } = {}) {
  const res = await call('POST', '/api/orders', {
    token: adminToken,
    body: {
      orderNo: `T-PLAN-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      buyerId: buyer.id,
      styleId: style.id,
      orderQty,
      ...(excessPct
        ? { excessPct, excessJustification: 'Cutting allowance for this buyer' }
        : {}),
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  createdOrders.push(res.body.data.id);

  if (approvedExcess !== undefined) {
    const decided = await call('POST', `/api/orders/${res.body.data.id}/excess/approve`, {
      token: directorToken,
      body: { approvedPct: approvedExcess },
    });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    return decided.body.data;
  }
  return res.body.data;
}

/**
 * The order line a plan is raised against.
 *
 * Planning is done per style, so a plan names the order line it covers.
 * `makeOrder()` above raises single-style orders, so there is exactly one line
 * and the helper can find it - a caller that wants a specific line of a
 * multi-style order passes `orderLineId` in `extra`.
 */
async function firstLineOf(orderId) {
  const line = await prisma.buyerOrderLine.findFirst({
    where: { orderId, deletedAt: null },
    orderBy: { lineNo: 'asc' },
    select: { id: true },
  });
  assert.ok(line, `order ${orderId} has no lines to plan against`);
  return line.id;
}

async function makePlan(orderId, lines, extra = {}, token = adminToken) {
  const res = await call('POST', '/api/plannings', {
    token,
    body: {
      orderId,
      orderLineId: extra.orderLineId ?? (await firstLineOf(orderId)),
      planDepartment: 'CUTTING',
      containerNo: 'CN-91',
      lines,
      ...extra,
    },
  });
  if (res.status === 201) createdPlans.push(res.body.data.id);
  return res;
}

const line = (lineDate, deliverableSize, extra = {}) => ({
  lineDate,
  unit: 'Unit 1 - Anil Kumar',
  deliverableSize,
  ...extra,
});

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
  plannerToken = await signIn('planner', USER_PASSWORD);
  directorToken = await signIn('dinesh', USER_PASSWORD);

  style = await prisma.style.findFirst({
    where: { styleNo: 'TR-0751-008', deletedAt: null },
  });
  assert.ok(style, 'seeded style TR-0751-008 must exist');
  buyer = await prisma.buyer.findFirst({ where: { id: style.buyerId } });
});

after(async () => {
  if (createdPlans.length) {
    await prisma.approvalHistory.deleteMany({
      where: { documentType: 'PLANNING', documentId: { in: createdPlans } },
    });
    await prisma.planApproval.deleteMany({ where: { planningId: { in: createdPlans } } });
    await prisma.planningLine.deleteMany({ where: { planningId: { in: createdPlans } } });
    await prisma.planning.deleteMany({ where: { id: { in: createdPlans } } });
  }
  if (createdOrders.length) {
    await prisma.approvalHistory.deleteMany({
      where: { documentType: 'BUYER_ORDER', documentId: { in: createdOrders } },
    });
    await prisma.buyerOrder.deleteMany({ where: { id: { in: createdOrders } } });
  }
  await prisma.user.updateMany({
    where: { username: { in: ['planner', 'dinesh'] } },
    data: { mustChangePassword: true },
  });
  server?.close();
  await prisma.$disconnect();
});

// ===========================================================================

describe('plan creation derives what the sheet marks Auto', () => {
  test('style, order qty and the totals come from the server, not the request', async () => {
    const order = await makeOrder({ orderQty: '5000' });
    const res = await makePlan(order.id, [
      line('2026-09-01', '2500', { cuttingPcsAllotted: '200' }),
      line('2026-09-05', '2500'),
    ]);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const plan = res.body.data;

    assert.equal(plan.styleNo, style.styleNo, 'Style No follows the order');
    assert.equal(Number(plan.orderQty), 5000, 'Order Qty follows the order');
    assert.equal(Number(plan.plannedQty), 5000, 'planned qty is summed from the lines');
    assert.equal(Number(plan.plannedCuttingPcs), 200);
    assert.equal(plan.state, 'DRAFT');
    assert.equal(plan.version, 1);
    assert.ok(plan.planNo.startsWith('PLN-'), 'a plan number is issued from the sequence');
  });

  test('a posted plannedQty, orderQty or styleNo is discarded', async () => {
    const order = await makeOrder({ orderQty: '4000' });
    const res = await call('POST', '/api/plannings', {
      token: adminToken,
      body: {
        orderId: order.id,
        orderLineId: await firstLineOf(order.id),
        planDepartment: 'CUTTING',
        // All three of these are the server's to decide.
        plannedQty: '999999',
        plannedCuttingPcs: '999999',
        orderQty: '999999',
        styleNo: 'TAMPERED',
        lines: [line('2026-09-01', '4000')],
      },
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(Number(res.body.data.plannedQty), 4000, 'the posted total was ignored');
    assert.equal(Number(res.body.data.orderQty), 4000);
    assert.equal(res.body.data.styleNo, style.styleNo);
    createdPlans.push(res.body.data.id);
  });

  test('a second plan for the same order and department is refused', async () => {
    const order = await makeOrder({ orderQty: '3000' });
    const first = await makePlan(order.id, [line('2026-09-01', '3000')]);
    assert.equal(first.status, 201);

    const second = await makePlan(order.id, [line('2026-09-02', '3000')]);
    assert.equal(second.status, 409, 'one live plan per order per department');
    assert.match(second.body.error.message, /already has a cutting plan/i);
  });

  test('a different department may plan the same order', async () => {
    const order = await makeOrder({ orderQty: '3000' });
    assert.equal((await makePlan(order.id, [line('2026-09-01', '3000')])).status, 201);

    const stitching = await makePlan(
      order.id,
      [line('2026-09-03', '3000')],
      { planDepartment: 'STITCHING' },
    );
    assert.equal(stitching.status, 201, JSON.stringify(stitching.body));
  });

  test('a plan with no lines is refused', async () => {
    const order = await makeOrder({ orderQty: '1000' });
    const res = await makePlan(order.id, []);
    assert.equal(res.status, 422);
  });
});

// ===========================================================================

describe('THE RULE - planning may not exceed the permitted order quantity', () => {
  test('a plan matching the order exactly is accepted', async () => {
    const order = await makeOrder({ orderQty: '5000' });
    const res = await makePlan(order.id, [line('2026-09-01', '5000')]);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.allocation.matchesOrderQty, true);
    assert.equal(res.body.data.allocation.withinPermitted, true);
  });

  test('an under-planned order is accepted and reports the shortfall', async () => {
    const order = await makeOrder({ orderQty: '5000' });
    const res = await makePlan(order.id, [line('2026-09-01', '3000')]);
    assert.equal(res.status, 201);
    assert.equal(Number(res.body.data.allocation.unplannedQty), 2000);
  });

  test('one piece over a no-excess order is refused', async () => {
    const order = await makeOrder({ orderQty: '5000' });
    const res = await makePlan(order.id, [line('2026-09-01', '5001')]);

    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error.details.rule, 'PLANNED_QTY_EXCEEDS_PERMITTED');
    assert.equal(Number(res.body.error.details.allocation.overBy), 1);
  });

  test('a REQUESTED but unapproved excess does NOT raise the ceiling', async () => {
    // 2% asked for, no decision taken: the ceiling stays at the plain 5000.
    const order = await makeOrder({ orderQty: '5000', excessPct: '0.02' });
    assert.equal(order.excessApprovalStatus, 'PENDING');
    assert.equal(Number(order.effectiveQty), 5000);

    const atPlain = await makePlan(order.id, [line('2026-09-01', '5000')]);
    assert.equal(atPlain.status, 201, 'the plain quantity is always plannable');

    const order2 = await makeOrder({ orderQty: '5000', excessPct: '0.02' });
    const overreach = await makePlan(order2.id, [line('2026-09-01', '5100')]);

    assert.equal(overreach.status, 409, 'a pending excess must not be usable');
    assert.match(overreach.body.error.message, /has not approved it yet/i);
  });

  test('a REJECTED excess leaves the ceiling at the plain order quantity', async () => {
    const order = await makeOrder({ orderQty: '5000', excessPct: '0.02' });
    const rejected = await call('POST', `/api/orders/${order.id}/excess/reject`, {
      token: directorToken,
      body: { reason: 'Buyer will not take an overship' },
    });
    assert.equal(rejected.status, 200);

    const res = await makePlan(order.id, [line('2026-09-01', '5100')]);
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /was rejected/i);
  });

  test('an APPROVED excess raises the ceiling by exactly what was granted', async () => {
    const order = await makeOrder({ orderQty: '5000', excessPct: '0.02', approvedExcess: '0.02' });
    assert.equal(Number(order.effectiveQty), 5100);

    const atCeiling = await makePlan(order.id, [line('2026-09-01', '5100')]);
    assert.equal(atCeiling.status, 201, JSON.stringify(atCeiling.body));
    assert.equal(atCeiling.body.data.allocation.usesExcess, true);
    assert.equal(Number(atCeiling.body.data.allocation.excessUsedQty), 100);

    const order2 = await makeOrder({ orderQty: '5000', excessPct: '0.02', approvedExcess: '0.02' });
    const overCeiling = await makePlan(order2.id, [line('2026-09-01', '5101')]);
    assert.equal(overCeiling.status, 409, 'the ceiling is exact, not approximate');
  });

  test('a partly granted excess caps at what was granted, not what was asked', async () => {
    // 5% requested, 2% granted -> ceiling 5100, not 5250.
    const order = await makeOrder({ orderQty: '5000', excessPct: '0.05', approvedExcess: '0.02' });
    assert.equal(Number(order.effectiveQty), 5100);

    assert.equal((await makePlan(order.id, [line('2026-09-01', '5100')])).status, 201);

    const order2 = await makeOrder({ orderQty: '5000', excessPct: '0.05', approvedExcess: '0.02' });
    const res = await makePlan(order2.id, [line('2026-09-01', '5150')]);
    assert.equal(res.status, 409, 'the requested 5% must not apply');
  });

  test('the ceiling is re-checked on edit, not only on create', async () => {
    const order = await makeOrder({ orderQty: '5000' });
    const created = await makePlan(order.id, [line('2026-09-01', '3000')]);
    assert.equal(created.status, 201);

    const res = await call('PATCH', `/api/plannings/${created.body.data.id}`, {
      token: adminToken,
      body: { lines: [line('2026-09-01', '6000')] },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.details.rule, 'PLANNED_QTY_EXCEEDS_PERMITTED');
  });

  test('the sum across several lines is what is capped, not each line', async () => {
    const order = await makeOrder({ orderQty: '5000' });
    // Each line is under the ceiling; together they are over it.
    const res = await makePlan(order.id, [
      line('2026-09-01', '2000'),
      line('2026-09-02', '2000'),
      line('2026-09-03', '2000'),
    ]);
    assert.equal(res.status, 409);
    assert.equal(Number(res.body.error.details.allocation.overBy), 1000);
  });

  test('a day cannot allot more cutting pieces than it is due to deliver', async () => {
    const order = await makeOrder({ orderQty: '5000' });
    const res = await makePlan(order.id, [
      line('2026-09-01', '1000', { cuttingPcsAllotted: '1500' }),
    ]);
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /cannot be allotted to a day/i);
  });

  test('the preview refuses in the same words the save would', async () => {
    const order = await makeOrder({ orderQty: '5000', excessPct: '0.02' });
    const res = await call('POST', '/api/plannings/preview', {
      token: adminToken,
      body: {
        orderId: order.id,
        orderLineId: await firstLineOf(order.id),
        lines: [line('2026-09-01', '5100')],
      },
    });

    assert.equal(res.status, 200, 'a preview reports, it does not error');
    assert.ok(res.body.data.violation, 'the breach is reported');
    assert.match(res.body.data.violation, /has not approved it yet/i);
    assert.equal(res.body.data.allocation.withinPermitted, false);
  });

  test('the order allocation endpoint states the ceiling before anything is typed', async () => {
    const order = await makeOrder({ orderQty: '5000', excessPct: '0.03', approvedExcess: '0.03' });
    const res = await call('GET', `/api/plannings/order/${order.id}/allocation`, {
      token: adminToken,
    });

    assert.equal(res.status, 200);
    assert.equal(Number(res.body.data.permittedQty), 5150);
    assert.equal(Number(res.body.data.excessHeadroomQty), 150);
  });
});

// ===========================================================================

describe('the approval flow', () => {
  async function draftPlan(orderQty = '5000') {
    const order = await makeOrder({ orderQty });
    const res = await makePlan(order.id, [line('2026-09-01', orderQty)]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { order, plan: res.body.data };
  }

  test('a plan moves draft -> submitted -> approved, opening an approval round', async () => {
    const { plan } = await draftPlan();

    const submitted = await call('POST', `/api/plannings/${plan.id}/submit`, {
      token: adminToken,
      body: { submittedTo: 'Dinesh Sir' },
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.data.state, 'SUBMITTED');

    const detail = await call('GET', `/api/plannings/${plan.id}`, { token: adminToken });
    assert.equal(detail.body.data.approvals.length, 1, 'a PlanApproval round was opened');
    assert.equal(detail.body.data.approvals[0].round, 1);
    assert.equal(detail.body.data.approvals[0].approvalStatus, 'PENDING');

    const approved = await call('POST', `/api/plannings/${plan.id}/approve`, {
      token: directorToken,
      body: {},
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.state, 'APPROVED');
    assert.ok(approved.body.data.approvedByName);

    const after = await call('GET', `/api/plannings/${plan.id}`, { token: adminToken });
    assert.equal(after.body.data.approvals[0].approvalStatus, 'APPROVED');
  });

  test('rejection sends it back, and revising bumps the version', async () => {
    const { plan } = await draftPlan();
    await call('POST', `/api/plannings/${plan.id}/submit`, {
      token: adminToken,
      body: { submittedTo: 'Dinesh Sir' },
    });

    const rejected = await call('POST', `/api/plannings/${plan.id}/reject`, {
      token: directorToken,
      body: { reason: 'Unit 3 overloaded', rectification: 'Shift 1500 pcs to Unit 4' },
    });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(rejected.body.data.state, 'REJECTED');
    assert.equal(rejected.body.data.rejectionReason, 'Unit 3 overloaded');

    const revised = await call('POST', `/api/plannings/${plan.id}/revise`, {
      token: adminToken,
      body: {},
    });
    assert.equal(revised.status, 200, JSON.stringify(revised.body));
    assert.equal(revised.body.data.version, 2, '"Revised plan v2"');
    assert.equal(revised.body.data.state, 'DRAFT');

    // Resubmitting opens round 2, exactly as the Plan Approval sheet shows.
    await call('POST', `/api/plannings/${plan.id}/submit`, {
      token: adminToken,
      body: { submittedTo: 'Dinesh Sir' },
    });
    const detail = await call('GET', `/api/plannings/${plan.id}`, { token: adminToken });
    assert.equal(detail.body.data.approvals.length, 2);
    assert.equal(detail.body.data.approvals[1].round, 2);
  });

  test('a submitted plan cannot be edited until it is recalled', async () => {
    const { plan } = await draftPlan();
    await call('POST', `/api/plannings/${plan.id}/submit`, {
      token: adminToken,
      body: { submittedTo: 'Dinesh Sir' },
    });

    const blocked = await call('PATCH', `/api/plannings/${plan.id}`, {
      token: adminToken,
      body: { remarks: 'sneaking a change in' },
    });
    assert.equal(blocked.status, 409);

    const recalled = await call('POST', `/api/plannings/${plan.id}/recall`, {
      token: adminToken,
      body: { reason: 'Needs another day added' },
    });
    assert.equal(recalled.status, 200);
    assert.equal(recalled.body.data.state, 'DRAFT');

    const allowed = await call('PATCH', `/api/plannings/${plan.id}`, {
      token: adminToken,
      body: { remarks: 'now editable' },
    });
    assert.equal(allowed.status, 200);
  });

  test('an approved plan cannot be edited', async () => {
    const { plan } = await draftPlan();
    await call('POST', `/api/plannings/${plan.id}/submit`, {
      token: adminToken,
      body: { submittedTo: 'Dinesh Sir' },
    });
    await call('POST', `/api/plannings/${plan.id}/approve`, { token: directorToken, body: {} });

    const res = await call('PATCH', `/api/plannings/${plan.id}`, {
      token: adminToken,
      body: { lines: [line('2026-09-01', '100')] },
    });
    assert.equal(res.status, 409);
  });

  test('approval is REFUSED when the order excess was revoked after drafting', async () => {
    // The case the whole re-check at approval exists for.
    const order = await makeOrder({ orderQty: '5000', excessPct: '0.02', approvedExcess: '0.02' });
    const created = await makePlan(order.id, [line('2026-09-01', '5100')]);
    assert.equal(created.status, 201, 'legal when drawn: the excess was approved');

    await call('POST', `/api/plannings/${created.body.data.id}/submit`, {
      token: adminToken,
      body: { submittedTo: 'Dinesh Sir' },
    });

    // Amending the order returns the approved excess to PENDING (Phase 3),
    // which drops effectiveQty back to 5000 and strands the plan above it.
    const amended = await call('POST', `/api/orders/${order.id}/amend`, {
      token: adminToken,
      body: { reason: 'Buyer cut the overship allowance', excessPct: '0' },
    });
    assert.equal(amended.status, 200, JSON.stringify(amended.body));
    assert.equal(Number(amended.body.data.effectiveQty), 5000);

    const approve = await call('POST', `/api/plannings/${created.body.data.id}/approve`, {
      token: directorToken,
      body: {},
    });
    assert.equal(approve.status, 409, 'a plan above the current ceiling must not be approved');
    assert.equal(approve.body.error.details.rule, 'PLANNED_QTY_EXCEEDS_PERMITTED');
  });

  test('a plan cannot be worked before it is approved', async () => {
    const { plan } = await draftPlan();
    const res = await call('PATCH', `/api/plannings/${plan.id}/status`, {
      token: adminToken,
      body: { status: 'IN_PROGRESS' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /before it is approved/i);
  });
});

// ===========================================================================

describe('RBAC - a planner cannot approve their own plan', () => {
  test('the planner may create and submit', async () => {
    const order = await makeOrder({ orderQty: '2000' });
    const created = await makePlan(order.id, [line('2026-09-01', '2000')], {}, plannerToken);
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const submitted = await call('POST', `/api/plannings/${created.body.data.id}/submit`, {
      token: plannerToken,
      body: { submittedTo: 'Dinesh Sir' },
    });
    assert.equal(submitted.status, 200);

    // ...but the decision is not theirs to take.
    const approve = await call('POST', `/api/plannings/${created.body.data.id}/approve`, {
      token: plannerToken,
      body: {},
    });
    assert.equal(approve.status, 403, 'PLANNING.APPROVE is not held by MERCHANDISING');

    const reject = await call('POST', `/api/plannings/${created.body.data.id}/reject`, {
      token: plannerToken,
      body: { reason: 'trying to reject my own plan' },
    });
    assert.equal(reject.status, 403);
  });
});

// ===========================================================================

describe('unit allocation', () => {
  test('the grid is rolled up per stitching unit', async () => {
    const order = await makeOrder({ orderQty: '6000' });
    const created = await makePlan(order.id, [
      line('2026-09-01', '2000', { unit: 'Unit 1 - Anil Kumar', cuttingPcsAllotted: '150' }),
      line('2026-09-03', '2000', { unit: 'Unit 1 - Anil Kumar' }),
      line('2026-09-05', '2000', { unit: 'Unit 2 - Mahipal' }),
    ], { planDepartment: 'STITCHING' });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const detail = await call('GET', `/api/plannings/${created.body.data.id}`, {
      token: adminToken,
    });
    const units = detail.body.data.unitAllocation;

    assert.equal(units.length, 2);
    const unit1 = units.find((u) => u.unit === 'Unit 1 - Anil Kumar');
    assert.equal(Number(unit1.deliverableSize), 4000);
    assert.equal(Number(unit1.cuttingPcsAllotted), 150);
    assert.equal(unit1.lineCount, 2);
  });

  test('a unit outside the List Master is refused', async () => {
    const order = await makeOrder({ orderQty: '1000' });
    const res = await makePlan(order.id, [
      line('2026-09-01', '1000', { unit: 'Unit 9 - Does Not Exist' }),
    ], { planDepartment: 'STITCHING' });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /not an active value of the StitchingUnit list/i);
  });

  test('cutting, packing and dispatch plans carry no unit', async () => {
    const order = await makeOrder({ orderQty: '1000' });
    const created = await makePlan(order.id, [
      line('2026-09-01', '1000', { unit: 'Unit 1 - Anil Kumar' }),
    ]);
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const detail = await call('GET', `/api/plannings/${created.body.data.id}`, {
      token: adminToken,
    });
    assert.equal(detail.body.data.lines[0].unit, null);
    assert.deepEqual(detail.body.data.unitAllocation, []);
  });
});
