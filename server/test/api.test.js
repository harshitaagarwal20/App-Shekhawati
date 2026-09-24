/**
 * End-to-end API tests for Phase 1 (auth + RBAC) and Phase 2 (masters).
 *
 * Requires a migrated, seeded database. Run:
 *
 *     npm run db:setup      # migrate + seed
 *     npm test --workspace server
 *
 * The suite boots the real Express app on an ephemeral port and drives it over
 * HTTP, so middleware, validation, RBAC and Prisma are all exercised together.
 * It creates and then deletes its own records, and restores the passwords it
 * changes, so it can be run repeatedly against the same seeded database.
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

/** Minimal fetch wrapper returning { status, body }. */
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
 * Signs in and clears the mustChangePassword flag directly in the database, so
 * every test does not have to walk the first-login password change.
 */
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
  return res.body.data;
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

  const seeded = await prisma.user.count();
  assert.ok(seeded > 0, 'The database has no users. Run "npm run db:seed" first.');

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // Put the seeded accounts back the way the seed left them.
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await prisma.user.updateMany({
    where: { username: 'admin' },
    data: { passwordHash: hash, mustChangePassword: true },
  });
  await prisma.user.updateMany({
    where: { username: { in: ['sunita', 'ravi', 'merch'] } },
    data: { mustChangePassword: true },
  });
  await prisma.userSession.deleteMany({});
  server?.close();
  await prisma.$disconnect();
});

// ===========================================================================

describe('health', () => {
  test('reports the database as up and the pipeline end', async () => {
    const { status, body } = await call('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(body.data.database, 'up');
    assert.equal(body.data.pipelineEndsAt, 'CUTTING_ISSUE');
  });
});

describe('authentication', () => {
  test('rejects an unknown user and a wrong password with the same message', async () => {
    const unknown = await call('POST', '/api/auth/login', {
      body: { username: 'nobody-here', password: 'whatever123' },
    });
    const wrong = await call('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'definitely-wrong-1' },
    });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(unknown.body.error.message, wrong.body.error.message);
  });

  test('rejects a malformed login with field-level detail', async () => {
    const { status, body } = await call('POST', '/api/auth/login', { body: { username: '' } });
    assert.equal(status, 422);
    assert.equal(body.error.code, 'VALIDATION_FAILED');
    assert.ok(body.error.details.fields.username);
  });

  test('signs in and returns the resolved permission set', async () => {
    const session = await signIn('admin', ADMIN_PASSWORD);
    assert.ok(session.accessToken);
    assert.ok(session.refreshToken);
    assert.ok(session.user.permissions.length > 0);
    assert.ok(session.user.roleCodes.includes('ADMIN'));
  });

  test('rejects a request with no token, a junk token, and a wrong scheme', async () => {
    assert.equal((await call('GET', '/api/buyers')).status, 401);
    assert.equal((await call('GET', '/api/buyers', { token: 'not-a-jwt' })).status, 401);

    const res = await fetch(`${base}/api/buyers`, { headers: { Authorization: 'Basic abc' } });
    assert.equal(res.status, 401);
  });

  test('/auth/me reflects the signed-in user', async () => {
    const { accessToken, user } = await signIn('admin', ADMIN_PASSWORD);
    const { status, body } = await call('GET', '/api/auth/me', { token: accessToken });
    assert.equal(status, 200);
    assert.equal(body.data.username, user.username);
  });

  test('refresh rotates the token and invalidates the old one', async () => {
    const first = await signIn('admin', ADMIN_PASSWORD);

    const refreshed = await call('POST', '/api/auth/refresh', {
      body: { refreshToken: first.refreshToken },
    });
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.body.data.refreshToken, first.refreshToken);

    // Replaying the consumed token must fail AND end every session for safety.
    const replay = await call('POST', '/api/auth/refresh', {
      body: { refreshToken: first.refreshToken },
    });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error.code, 'REFRESH_REUSED');

    const afterReuse = await call('GET', '/api/auth/me', {
      token: refreshed.body.data.accessToken,
    });
    assert.equal(afterReuse.status, 401, 'reuse detection should have revoked the rotated session');
  });

  test('logout ends the session server-side, not just in the browser', async () => {
    const { accessToken } = await signIn('admin', ADMIN_PASSWORD);
    assert.equal((await call('GET', '/api/auth/me', { token: accessToken })).status, 200);

    const out = await call('POST', '/api/auth/logout', { token: accessToken });
    assert.equal(out.status, 200);

    const after = await call('GET', '/api/auth/me', { token: accessToken });
    assert.equal(after.status, 401);
    assert.equal(after.body.error.code, 'SESSION_REVOKED');
  });

  test('a user flagged mustChangePassword is blocked from the rest of the API', async () => {
    await prisma.user.updateMany({ where: { username: 'merch' }, data: { mustChangePassword: true } });
    const login = await call('POST', '/api/auth/login', {
      body: { username: 'merch', password: USER_PASSWORD },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.user.mustChangePassword, true);

    const blocked = await call('GET', '/api/buyers', { token: login.body.data.accessToken });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');

    // ...but /auth/me stays reachable so the client can render the change form.
    assert.equal((await call('GET', '/api/auth/me', { token: login.body.data.accessToken })).status, 200);
  });

  test('a deactivated user cannot use an already-issued token', async () => {
    const { accessToken } = await signIn('sunita', USER_PASSWORD);
    assert.equal((await call('GET', '/api/auth/me', { token: accessToken })).status, 200);

    await prisma.user.updateMany({ where: { username: 'sunita' }, data: { isActive: false } });
    const denied = await call('GET', '/api/auth/me', { token: accessToken });
    assert.equal(denied.status, 401);

    await prisma.user.updateMany({ where: { username: 'sunita' }, data: { isActive: true } });
  });
});

describe('RBAC is enforced on the server', () => {
  test('QC cannot list users, and the refusal names what was required', async () => {
    const { accessToken } = await signIn('sunita', USER_PASSWORD);
    const { status, body } = await call('GET', '/api/users', { token: accessToken });
    assert.equal(status, 403);
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.deepEqual(body.error.details.required, ['USER.VIEW']);
  });

  test('QC cannot create a buyer but may read the dropdowns every screen needs', async () => {
    const { accessToken } = await signIn('sunita', USER_PASSWORD);

    const create = await call('POST', '/api/buyers', {
      token: accessToken,
      body: { buyerName: 'Should Not Exist' },
    });
    assert.equal(create.status, 403);

    const lists = await call('GET', '/api/master-lists/values/ColorCode', { token: accessToken });
    assert.equal(lists.status, 200);
    assert.ok(lists.body.data.values.length > 0);
  });

  test('the Store Manager holds the procurement and cutting permissions', async () => {
    const { user } = await signIn('ravi', USER_PASSWORD);
    for (const code of [
      'PURCHASE_ORDER.CREATE',
      'GRN.CREATE',
      'DYE_ISSUE.CREATE',
      'PRINTING.CREATE',
      'FABRIC_ISSUE.CREATE',
      'CUTTING_ISSUE.CREATE',
    ]) {
      assert.ok(user.permissions.includes(code), `Store Manager should hold ${code}`);
    }
    assert.ok(!user.permissions.includes('USER.CREATE'), 'Store Manager must not administer users');
  });

  test('the Director may approve everything but edit nothing', async () => {
    const { user } = await signIn('dinesh', USER_PASSWORD);
    assert.ok(user.permissions.includes('PURCHASE_ORDER.APPROVE'));
    assert.ok(user.permissions.includes('PLAN_APPROVAL.APPROVE'));
    assert.ok(!user.permissions.includes('BUYER.CREATE'));
    assert.ok(!user.permissions.includes('PURCHASE_ORDER.EDIT'));
  });

  test('no permission exists for any out-of-scope module', async () => {
    const forbidden = ['STITCHING', 'PACKING', 'DISPATCH', 'NEEDLE', 'RECONCILIATION', 'ALTER'];
    const permissions = await prisma.permission.findMany({ select: { module: true } });
    for (const p of permissions) {
      for (const bad of forbidden) {
        assert.ok(!p.module.includes(bad), `Out-of-scope permission module found: ${p.module}`);
      }
    }
  });
});

describe('List Master drives every dropdown', () => {
  let token;

  before(async () => {
    ({ accessToken: token } = await signIn('admin', ADMIN_PASSWORD));
  });

  test('serves the seeded lists', async () => {
    const { status, body } = await call('GET', '/api/master-lists?pageSize=100', { token });
    assert.equal(status, 200);
    assert.ok(body.meta.total >= 25);
    const codes = body.data.map((l) => l.code);
    for (const code of ['ColorCode', 'UOM', 'GSM', 'Department', 'VendorCategory', 'StitchingUnit']) {
      assert.ok(codes.includes(code), `Expected the ${code} list to be seeded`);
    }
  });

  test('serves several lists in one request', async () => {
    const { status, body } = await call('GET', '/api/master-lists/values?codes=UOM,ColorCode,GSM', { token });
    assert.equal(status, 200);
    assert.ok(body.data.UOM.length > 0);
    assert.ok(body.data.ColorCode.length > 0);
    assert.ok(body.data.GSM.length > 0);
  });

  test('a value added to a list is immediately usable on a master', async () => {
    const lists = await call('GET', '/api/master-lists?search=ColorCode', { token });
    const colorList = lists.body.data.find((l) => l.code === 'ColorCode');
    assert.ok(colorList, 'ColorCode list must exist');

    const value = `Test Teal ${Date.now()}`;
    const added = await call('POST', `/api/master-lists/${colorList.id}/values`, {
      token,
      body: { value },
    });
    assert.equal(added.status, 201);

    const served = await call('GET', '/api/master-lists/values/ColorCode', { token });
    assert.ok(served.body.data.values.some((v) => v.value === value));

    // Deactivating hides it from new documents.
    await call('PATCH', `/api/master-lists/values/${added.body.data.id}/active`, {
      token,
      body: { isActive: false },
    });
    const afterHide = await call('GET', '/api/master-lists/values/ColorCode', { token });
    assert.ok(!afterHide.body.data.values.some((v) => v.value === value));

    await call('DELETE', `/api/master-lists/values/${added.body.data.id}`, { token });
  });

  test('a master rejects a dropdown value that is not in its list', async () => {
    const { status, body } = await call('POST', '/api/vendors', {
      token,
      body: { vendorName: 'Bad Category Vendor', category: 'Not A Real Category' },
    });
    assert.equal(status, 400);
    assert.match(body.error.message, /VendorCategory/);
  });

  test('a system list cannot be deleted', async () => {
    const lists = await call('GET', '/api/master-lists?search=UOM', { token });
    const uom = lists.body.data.find((l) => l.code === 'UOM');
    const { status } = await call('DELETE', `/api/master-lists/${uom.id}`, { token });
    assert.equal(status, 400);
  });
});

describe('Masters CRUD', () => {
  let token;
  const created = { buyers: [], vendors: [], employees: [], styles: [] };

  before(async () => {
    ({ accessToken: token } = await signIn('admin', ADMIN_PASSWORD));
  });

  after(async () => {
    // Hard-delete only what this suite created.
    await prisma.styleBomLine.deleteMany({ where: { styleId: { in: created.styles } } });
    await prisma.style.deleteMany({ where: { id: { in: created.styles } } });
    await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
    await prisma.vendor.deleteMany({ where: { id: { in: created.vendors } } });
    await prisma.buyer.deleteMany({ where: { id: { in: created.buyers } } });
  });

  test('the buyer code is stored exactly as it was typed', async () => {
    // It is a master field the office types and then uses on paper. The system
    // used to derive one from the buyer's initials when the field was left
    // blank, which produced codes nobody had chosen and nobody recognised.
    const res = await call('POST', '/api/buyers', {
      token,
      body: {
        buyerCode: 'ZCW#',
        buyerName: 'Zenith Carry Works',
        country: 'USA',
        currency: 'USD',
        status: 'ACTIVE',
      },
    });
    assert.equal(res.status, 201);
    created.buyers.push(res.body.data.id);
    assert.equal(res.body.data.buyerCode, 'ZCW#');
  });

  test('a buyer without a code is refused, not given one', async () => {
    const res = await call('POST', '/api/buyers', {
      token,
      body: { buyerName: 'No Code Traders', country: 'USA', status: 'ACTIVE' },
    });
    // 422: the body was understood and rejected on its contents.
    assert.equal(res.status, 422);
    assert.ok(
      JSON.stringify(res.body).toLowerCase().includes('buyer code'),
      'the refusal must name the field the user has to fill in',
    );
  });

  test('a duplicate buyer code is refused', async () => {
    const res = await call('POST', '/api/buyers', {
      token,
      body: { buyerCode: 'ZCW#', buyerName: 'Someone Else', country: 'USA', status: 'ACTIVE' },
    });
    assert.equal(res.status, 409);
  });

  test('search, filter, sort and paging all work on a master list', async () => {
    const search = await call('GET', '/api/buyers?search=trade', { token });
    assert.equal(search.status, 200);
    assert.ok(search.body.data.some((b) => b.buyerName.toLowerCase().includes('trade')));

    const filtered = await call('GET', '/api/buyers?country=USA', { token });
    assert.ok(filtered.body.data.every((b) => b.country === 'USA'));

    const sorted = await call('GET', '/api/buyers?sortBy=buyerName&sortDir=desc&pageSize=5', { token });
    const names = sorted.body.data.map((b) => b.buyerName);
    assert.deepEqual(names, [...names].sort().reverse());

    const paged = await call('GET', '/api/buyers?page=1&pageSize=2', { token });
    assert.equal(paged.body.data.length, 2);
    assert.equal(paged.body.meta.pageSize, 2);
    assert.ok(paged.body.meta.total >= 7);

    // An unknown sort column must be ignored, not passed through to the database.
    const injected = await call('GET', '/api/buyers?sortBy=notAColumn', { token });
    assert.equal(injected.status, 200);
  });

  test('active/inactive toggles without deleting', async () => {
    const id = created.buyers[0];
    const off = await call('PATCH', `/api/buyers/${id}/status`, { token, body: { status: 'INACTIVE' } });
    assert.equal(off.status, 200);
    assert.equal(off.body.data.status, 'INACTIVE');

    const options = await call('GET', '/api/buyers/options', { token });
    assert.ok(!options.body.data.some((b) => b.id === id), 'inactive buyers must not appear in dropdowns');

    const on = await call('PATCH', `/api/buyers/${id}/status`, { token, body: { status: 'ACTIVE' } });
    assert.equal(on.body.data.status, 'ACTIVE');
  });

  test('a vendor gets a PO number series derived from its initials', async () => {
    const res = await call('POST', '/api/vendors', {
      token,
      body: { vendorName: 'Test Weaving Mills', category: 'Fabric', status: 'ACTIVE' },
    });
    assert.equal(res.status, 201);
    created.vendors.push(res.body.data.id);
    assert.equal(res.body.data.poInitials, 'TW');

    const sequence = await prisma.documentSequence.findUnique({
      where: { documentType_scopeKey: { documentType: 'PURCHASE_ORDER', scopeKey: 'TW' } },
    });
    assert.ok(sequence, 'a PURCHASE_ORDER sequence should exist for the new vendor initials');
  });

  test('an invalid GSTIN and pin code are refused', async () => {
    const bad = await call('POST', '/api/vendors', {
      token,
      body: { vendorName: 'Bad GST Vendor', category: 'Fabric', gstNo: 'NOT-A-GSTIN' },
    });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.error.details.fields.gstNo);
  });

  test('employees are auto-numbered and validated against the department list', async () => {
    const res = await call('POST', '/api/employees', {
      token,
      body: { empName: 'Test Operator', department: 'Cutting', designation: 'Operator' },
    });
    assert.equal(res.status, 201);
    created.employees.push(res.body.data.id);
    assert.match(res.body.data.empId, /^EMP-\d{3}$/);

    const bad = await call('POST', '/api/employees', {
      token,
      body: { empName: 'Nope', department: 'Astrophysics', designation: 'Operator' },
    });
    assert.equal(bad.status, 400);
  });

  test('a style stores its BOM and keeps the fabric line at the header average', async () => {
    const buyerOptions = await call('GET', '/api/buyers/options', { token });
    const buyerId = buyerOptions.body.data[0].id;

    const res = await call('POST', '/api/styles', {
      token,
      body: {
        styleNo: `TEST-${Date.now()}`,
        styleDescription: 'Test Tote for the suite',
        buyerId,
        category: 'Tote Bag',
        fabricContent: '100% Cotton',
        avgFabricUtilizationPerPc: '0.8',
        avgUtilizationUom: 'Mtrs',
        sizeGroup: 'Free Size',
        bom: [
          { itemCategory: 'Fabric', subCategory: '10 oz', uom: 'Mtrs', qtyPerPc: '0.5', wastagePct: '0.02' },
          { itemCategory: 'Accessories', accessoriesItem: 'Cotton Handle', uom: 'Pcs', qtyPerPc: '2', wastagePct: '0.01' },
        ],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    created.styles.push(res.body.data.id);

    const fabricLine = res.body.data.bomLines.find((l) => l.itemCategory === 'Fabric');
    assert.equal(
      Number(fabricLine.qtyPerPc),
      0.8,
      'the fabric BOM line must follow the header average, not the submitted 0.5',
    );

    // The "Order as per Style" requirement calculation.
    const req = await call('GET', `/api/styles/${res.body.data.id}/requirement?qty=1000`, { token });
    assert.equal(req.status, 200);
    const fabricReq = req.body.data.lines.find((l) => l.itemCategory === 'Fabric');
    assert.equal(fabricReq.baseRequirement, 800);
    assert.equal(fabricReq.withWastage, 816);
  });

  test('deleting a master that documents depend on is refused', async () => {
    const buyers = await call('GET', '/api/buyers?search=Trade%20Word', { token });
    const tradeWord = buyers.body.data.find((b) => b.buyerName === 'Trade Word');
    assert.ok(tradeWord, 'the seeded buyer Trade Word must exist');

    const { status, body } = await call('DELETE', `/api/buyers/${tradeWord.id}`, { token });
    assert.equal(status, 409);
    assert.match(body.error.message, /buyer order|style/i);
  });

  test('a duplicate style number is refused', async () => {
    const existing = await call('GET', '/api/styles?pageSize=1', { token });
    const styleNo = existing.body.data[0].styleNo;
    const buyerId = existing.body.data[0].buyer.id;

    const { status } = await call('POST', '/api/styles', {
      token,
      body: {
        styleNo,
        styleDescription: 'Duplicate',
        buyerId,
        category: 'Tote Bag',
        avgFabricUtilizationPerPc: '1',
        avgUtilizationUom: 'Mtrs',
      },
    });
    assert.equal(status, 409);
  });
});

describe('user administration', () => {
  let token;
  let createdUserId;

  before(async () => {
    ({ accessToken: token } = await signIn('admin', ADMIN_PASSWORD));
  });

  after(async () => {
    if (createdUserId) {
      await prisma.userRole.deleteMany({ where: { userId: createdUserId } });
      await prisma.userSession.deleteMany({ where: { userId: createdUserId } });
      await prisma.user.deleteMany({ where: { id: createdUserId } });
    }
  });

  test('a new user is always forced to change the password an admin set', async () => {
    const username = `test.user.${Date.now()}`;
    const res = await call('POST', '/api/users', {
      token,
      body: {
        username,
        fullName: 'Test User',
        password: 'InitialPass12',
        roleCodes: ['QC'],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    createdUserId = res.body.data.id;
    assert.equal(res.body.data.mustChangePassword, true);
    assert.deepEqual(res.body.data.roleCodes, ['QC']);
  });

  test('a weak password is refused', async () => {
    const { status, body } = await call('POST', '/api/users', {
      token,
      body: { username: `weak${Date.now()}`, fullName: 'Weak', password: 'short', roleCodes: ['QC'] },
    });
    assert.equal(status, 422);
    assert.ok(body.error.details.fields.password);
  });

  test('a user with no role is refused', async () => {
    const { status } = await call('POST', '/api/users', {
      token,
      body: { username: `norole${Date.now()}`, fullName: 'No Role', password: 'GoodPass123', roleCodes: [] },
    });
    assert.equal(status, 422);
  });

  test('changing roles ends that user active sessions', async () => {
    const target = await prisma.user.findUnique({ where: { id: createdUserId } });
    await prisma.user.update({ where: { id: target.id }, data: { mustChangePassword: false } });

    // Give the account a known password and sign in as it.
    await call('POST', `/api/users/${target.id}/reset-password`, {
      token,
      body: { newPassword: 'KnownPass123' },
    });
    const theirSession = await signIn(target.username, 'KnownPass123');
    assert.equal((await call('GET', '/api/auth/me', { token: theirSession.accessToken })).status, 200);

    const changed = await call('PUT', `/api/users/${target.id}/roles`, {
      token,
      body: { roleCodes: ['MERCHANDISING'] },
    });
    assert.equal(changed.status, 200);

    const after = await call('GET', '/api/auth/me', { token: theirSession.accessToken });
    assert.equal(after.status, 401, 'a role change must end the session immediately');
  });

  test('an admin cannot deactivate or delete their own account', async () => {
    const me = await call('GET', '/api/auth/me', { token });
    const deactivate = await call('PATCH', `/api/users/${me.body.data.id}/active`, {
      token,
      body: { isActive: false },
    });
    assert.equal(deactivate.status, 400);

    const remove = await call('DELETE', `/api/users/${me.body.data.id}`, { token });
    assert.equal(remove.status, 400);
  });

  test('the ADMIN role cannot be narrowed', async () => {
    const roles = await call('GET', '/api/users/roles?search=ADMIN', { token });
    const admin = roles.body.data.find((r) => r.code === 'ADMIN');
    const { status } = await call('PUT', `/api/users/roles/${admin.id}/permissions`, {
      token,
      body: { permissions: ['BUYER.VIEW'] },
    });
    assert.equal(status, 400);
  });

  test('a system role cannot be deleted', async () => {
    const roles = await call('GET', '/api/users/roles?search=QC', { token });
    const qc = roles.body.data.find((r) => r.code === 'QC');
    const { status } = await call('DELETE', `/api/users/roles/${qc.id}`, { token });
    assert.equal(status, 400);
  });

  test('the permission catalogue is grouped by module', async () => {
    const { status, body } = await call('GET', '/api/users/roles/permissions', { token });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data));
    const modules = body.data.map((m) => m.module);
    assert.ok(modules.includes('CUTTING_ISSUE'));
    assert.ok(!modules.some((m) => /STITCH|PACK|DISPATCH/.test(m)));
  });
});
