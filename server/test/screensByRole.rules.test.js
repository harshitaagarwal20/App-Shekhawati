/**
 * Which screens each role sees. No database.
 *
 * ---------------------------------------------------------------------------
 *  WHAT rbac.rules.test.js DOES NOT COVER
 *
 *  That file proves the SERVER side: every permission a route demands is one
 *  the seeder issues. It says nothing about what a person signing in actually
 *  sees - the sidebar and the page guards are client code, and they can drift
 *  from the roles in two ways that compile, seed and render perfectly well:
 *
 *    LINK WITHOUT PAGE   the sidebar shows a link on one permission and the
 *                        route guards it on another. The user clicks a link
 *                        the menu offered and lands on Forbidden.
 *    PAGE WITHOUT LINK   the other way round: a role may open a screen but is
 *                        never shown the way in, so for that role it does not
 *                        exist.
 *
 *  And a change to a role's permission list in rbac.js silently changes which
 *  screens that role sees. Nothing reviews that unless something fails.
 *
 *  So this file:
 *
 *    1. asserts every sidebar link asks for exactly the permissions its route
 *       guard asks for, and that each of them is a code the seeder issues;
 *    2. replays the client's own `visibleNavigation()` for every seeded role
 *       and compares the result to the list below.
 *
 *  THE LIST BELOW IS THE POLICY. When it fails, the question is not "how do I
 *  make it pass" but "did we mean this role to gain or lose that screen". If
 *  yes, change the list in the same commit, so the review shows it.
 *
 *  Screens are named by ROUTE, not label, for the reason §39 gives: the label
 *  is wording, the route is the screen's identity.
 * ---------------------------------------------------------------------------
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildPermissions, roles } from '../prisma/seed/data/rbac.js';
import { NAV_GROUPS, visibleNavigation } from '../../client/src/config/navigation.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_ROUTES = readFileSync(join(ROOT, 'client', 'src', 'routes', 'AppRoutes.jsx'), 'utf8');

const ISSUED = buildPermissions().map((p) => p.code);

/** The same pattern match the seeder uses to turn a role's list into rows. */
function matches(pattern, code) {
  if (pattern === '*') return true;
  const [pModule, pAction] = pattern.split('.');
  const [cModule, cAction] = code.split('.');
  return (pModule === '*' || pModule === cModule) && (pAction === '*' || pAction === cAction);
}

/**
 * The `can()` a member of this role gets in the browser.
 *
 * Mirrors AuthContext.jsx: ADMIN passes everything, anybody else holds the
 * concrete codes the seeder granted their role, and `can(a, b)` is ANY of them.
 */
function canFor(role) {
  if (role.code === 'ADMIN') return () => true;
  const patterns = role.permissions === '*' ? ['*'] : role.permissions;
  const held = new Set(ISSUED.filter((code) => patterns.some((p) => matches(p, code))));
  return (...codes) => codes.flat().some((code) => held.has(code));
}

const screensFor = (role) =>
  visibleNavigation(canFor(role)).flatMap((group) => group.items.map((item) => item.to));

const navItems = NAV_GROUPS.flatMap((group) => group.items);

/**
 * The permission codes the route at `path` is guarded on, read from
 * AppRoutes.jsx. Takes the text from `path="..."` to the next route and
 * collects every quoted code in it - which covers both `guarded('X.VIEW', ...)`
 * and `<RequirePermission permissions={['A.VIEW', 'B.VIEW']}>`.
 */
function routeGuard(path) {
  const start = APP_ROUTES.indexOf(`path="${path}"`);
  if (start === -1) return null;
  const next = APP_ROUTES.indexOf('path="', start + 1);
  const element = APP_ROUTES.slice(start, next === -1 ? undefined : next);
  return [...element.matchAll(/'([A-Z_]+\.[A-Z_]+)'/g)].map((m) => m[1]);
}

const asList = (permission) => (Array.isArray(permission) ? permission : [permission]);
const sorted = (list) => [...new Set(list)].sort();

describe('screens by role - the sidebar and the page guards agree', () => {
  const guardedItems = navItems.filter((item) => item.permission);

  test('the navigation parse found a plausible number of guarded links', () => {
    // 32 at the time of writing; the floor catches a broken import, not growth.
    assert.ok(guardedItems.length >= 30, `only ${guardedItems.length} guarded links found`);
  });

  for (const item of guardedItems) {
    const path = item.to.split('?')[0];

    test(`${item.label} (${path}) - the link and the page ask for the same permission`, () => {
      const guard = routeGuard(path);
      assert.ok(guard, `${path} is in the sidebar but has no route in AppRoutes.jsx`);
      assert.deepEqual(
        sorted(guard),
        sorted(asList(item.permission)),
        `The sidebar shows "${item.label}" on ${asList(item.permission).join(' / ')} ` +
          `but the route opens on ${guard.join(' / ') || 'nothing'}. A role holding one ` +
          'and not the other sees a link to Forbidden, or a page with no link to it.',
      );
    });
  }

  test('every permission the sidebar names is one the seeder issues', () => {
    const issued = new Set(ISSUED);
    const unknown = sorted(guardedItems.flatMap((item) => asList(item.permission)))
      .filter((code) => !issued.has(code));
    assert.deepEqual(unknown, [], 'A link guarded on a code nobody can hold is hidden from everyone but ADMIN');
  });
});

/**
 * THE POLICY: what each role sees in the sidebar, in sidebar order.
 *
 * ADMIN is not listed - it sees every link by construction, and is asserted
 * separately below.
 */
const EXPECTED = {
  DIRECTOR: [
    '/', '/reports', '/approvals',
    '/masters/list-master', '/masters/buyers', '/masters/vendors', '/masters/employees', '/masters/styles', '/masters/excess-rules',
    '/orders', '/cost-sheets', '/planning',
    '/quotations', '/purchase-orders',
    '/gate-passes', '/grns', '/inventory', '/fabric-issues',
    '/job-works', '/scrutinies',
    '/cut-pieces-receipts', '/cutting-issues',
    '/stitching', '/stitching/hourly', '/inline-qc',
    '/ironing', '/external-qc', '/alteration',
    '/internal-quality-checks', '/final-checker-reports', '/finished-checker-records', '/spot-rectifications',
    '/needle-checking', '/packing', '/dispatches',
    '/reconciliation-reports',
    '/admin/roles', '/admin/users', '/admin/audit',
  ],
  HEAD_OFFICE: [
    '/', '/reports', '/approvals',
    '/masters/list-master', '/masters/buyers', '/masters/vendors', '/masters/employees', '/masters/styles',
    '/orders', '/cost-sheets',
    '/purchase-orders',
    '/inventory',
  ],
  MERCHANDISING: [
    '/', '/reports', '/approvals',
    '/masters/list-master', '/masters/buyers', '/masters/vendors', '/masters/styles',
    '/orders', '/cost-sheets', '/planning',
    '/inventory', '/fabric-issues',
    '/cut-pieces-receipts', '/cutting-issues',
    '/stitching', '/stitching/hourly', '/inline-qc',
    '/ironing', '/external-qc', '/alteration',
    '/internal-quality-checks', '/final-checker-reports', '/finished-checker-records', '/spot-rectifications',
    '/needle-checking', '/packing', '/dispatches',
    '/reconciliation-reports',
  ],
  STORE_MANAGER: [
    '/', '/reports', '/approvals',
    '/masters/list-master', '/masters/buyers', '/masters/vendors', '/masters/employees', '/masters/styles', '/masters/excess-rules', '/masters/opening-stock',
    '/orders', '/planning',
    '/quotations', '/purchase-orders',
    '/gate-passes', '/grns', '/inventory', '/fabric-issues',
    '/job-works', '/scrutinies',
    '/cut-pieces-receipts', '/cutting-issues',
    '/stitching', '/stitching/hourly', '/inline-qc',
    '/ironing', '/external-qc', '/alteration',
  ],
  QC: [
    '/', '/reports',
    '/masters/list-master', '/masters/buyers', '/masters/employees', '/masters/styles',
    '/orders',
    '/grns', '/inventory',
    '/scrutinies',
    '/inline-qc',
    '/internal-quality-checks', '/final-checker-reports', '/finished-checker-records', '/spot-rectifications',
    '/needle-checking', '/packing',
  ],
  STITCHING_SUPERVISOR: [
    '/',
    '/masters/list-master',
    '/stitching', '/stitching/hourly', '/inline-qc',
  ],
  FINISHING_SUPERVISOR: [
    '/', '/reports',
    '/masters/list-master',
    '/ironing', '/external-qc', '/alteration',
  ],
  EXTERNAL_QC_COORDINATOR: [
    '/', '/reports',
    '/masters/list-master',
    '/ironing', '/external-qc', '/alteration',
  ],
  ALTERATION_SUPERVISOR: [
    '/', '/reports',
    '/masters/list-master',
    '/ironing', '/external-qc', '/alteration',
  ],
  SECURITY: [
    '/',
    '/masters/vendors',
    '/gate-passes',
  ],
};

describe('screens by role - each role sees exactly its screens', () => {
  test('every seeded role has an entry in the policy, and nothing else does', () => {
    const seeded = roles.map((r) => r.code).filter((code) => code !== 'ADMIN').sort();
    assert.deepEqual(Object.keys(EXPECTED).sort(), seeded);
  });

  test('ADMIN sees every link in the sidebar', () => {
    const admin = roles.find((r) => r.code === 'ADMIN');
    assert.deepEqual(screensFor(admin), navItems.map((item) => item.to));
  });

  for (const role of roles.filter((r) => r.code !== 'ADMIN')) {
    test(`${role.code} sees exactly its screens`, () => {
      const actual = screensFor(role);
      const expected = EXPECTED[role.code] ?? [];
      const gained = actual.filter((s) => !expected.includes(s));
      const lost = expected.filter((s) => !actual.includes(s));

      assert.deepEqual(
        { gained, lost },
        { gained: [], lost: [] },
        `${role.name} now sees a different set of screens. If that was meant, ` +
          'update EXPECTED in this file in the same commit.',
      );
    });

    test(`${role.code} has work to do beyond the dashboard`, () => {
      // A role whose only screen is the dashboard is a login with nothing
      // behind it - usually a permission renamed out from under it.
      assert.ok(screensFor(role).some((s) => s !== '/'), `${role.name} can open nothing but the dashboard`);
    });
  }
});
