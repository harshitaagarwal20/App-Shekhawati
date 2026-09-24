/**
 * RBAC wiring tests. No database.
 *
 * ---------------------------------------------------------------------------
 *  THE BUG THIS FILE EXISTS TO CATCH
 *
 *  A route can demand a permission the seeder never issues. Nothing fails when
 *  that happens: the code compiles, the seed runs, the tests pass, the screen
 *  renders. The module is simply unreachable by every role except ADMIN, which
 *  passes everything by construction - so the one account most likely to be
 *  used while testing is the one account that cannot see the problem.
 *
 *  It happened three times in this codebase:
 *
 *    CUTTING_ISSUE.APPROVE   the route demanded it, APPROVABLE did not list
 *                            CUTTING_ISSUE. A supervisor could raise a challan
 *                            and then take a 403 trying to post it.
 *    DYE_ISSUE.APPROVE       the route demanded it, APPROVABLE did not list
 *                            DYE_ISSUE. The Director could not approve a job
 *                            work order.
 *    CUTTING_CHALLAN.*       eleven routes demanded them, MODULES did not list
 *                            the module. Nobody but ADMIN could open it.
 *
 *  Each was found by reading, which is not a control. The test below is:
 *  it reads every `can()` and `canAll()` call in every route file and asserts
 *  that the seeder generates a permission row for each code it finds.
 *
 *  WHY IT ASSERTS A FLOOR ON THE COUNT
 *
 *  The parse is a regex over source text. A regex that stops matching returns
 *  an empty set, and an empty set satisfies "every code is issued" perfectly.
 *  A test that passes because it checked nothing is worse than no test, so the
 *  floor is asserted first: if the parse ever silently breaks, this fails.
 * ---------------------------------------------------------------------------
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPermissions, roles, MODULES } from '../prisma/seed/data/rbac.js';

const ROUTES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes');

/**
 * Every permission code demanded by a route guard, with the file that wants it.
 *
 * `can('A.VIEW', 'B.VIEW')` grants on either, and `canAll(...)` requires both;
 * for this purpose the distinction does not matter. Both forms are a claim that
 * the code exists, and an unissued code is a lockout under either.
 */
function demandedByRoutes() {
  const found = new Map();
  for (const file of fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    for (const call of src.matchAll(/\bcan(?:All)?\(([^)]*)\)/gs)) {
      for (const code of call[1].matchAll(/'([A-Z_]+\.[A-Z_]+)'/g)) {
        if (!found.has(code[1])) found.set(code[1], file);
      }
    }
  }
  return found;
}

/** Whether a role's permission pattern matches a concrete code. */
function matches(pattern, code) {
  if (pattern === '*') return true;
  const [pModule, pAction] = pattern.split('.');
  const [cModule, cAction] = code.split('.');
  return (pModule === '*' || pModule === cModule) && (pAction === '*' || pAction === cAction);
}

/** The roles that hold `code`, by role code. */
function holders(code) {
  return roles
    .filter((r) => (r.permissions === '*' ? ['*'] : r.permissions).some((p) => matches(p, code)))
    .map((r) => r.code);
}

describe('RBAC - every permission a route demands is one the seeder issues', () => {
  const demanded = demandedByRoutes();
  const issued = new Set(buildPermissions().map((p) => p.code));

  test('the route parse found a plausible number of guarded codes', () => {
    // 85 at the time of writing. The floor is deliberately well below that:
    // it is here to catch a parse that broke, not to be updated whenever a
    // route is added.
    assert.ok(
      demanded.size >= 60,
      `only ${demanded.size} permission codes found in ${ROUTES_DIR} - the parse has probably broken`,
    );
  });

  test('no route demands a permission that is never generated', () => {
    const missing = [...demanded.entries()]
      .filter(([code]) => !issued.has(code))
      .map(([code, file]) => `${code} (demanded by routes/${file})`);

    assert.deepEqual(
      missing,
      [],
      'These codes are demanded by a route and never issued by the seeder, which ' +
        'makes their routes reachable by ADMIN alone:\n  ' + missing.join('\n  '),
    );
  });

  test('every module a route guards is listed in MODULES', () => {
    const guardedModules = new Set([...demanded.keys()].map((c) => c.split('.')[0]));
    const unlisted = [...guardedModules].filter((m) => !MODULES.includes(m)).sort();
    assert.deepEqual(unlisted, []);
  });
});

describe('RBAC - somebody other than ADMIN can open each module', () => {
  const demanded = demandedByRoutes();

  /**
   * ADMIN holds everything by construction, so a module only ADMIN can OPEN is
   * indistinguishable from one that was never wired up - which is precisely
   * what the three bugs above looked like.
   *
   * VIEW only, deliberately. Several codes really are ADMIN-only and are meant
   * to be: every `*.DELETE` on a transaction (the `owns()` helper grants view,
   * create, edit and export, never delete - removing a booked document is an
   * administrative act), and USER / ROLE creation and editing (the Director
   * holds VIEW and EXPORT over them and nothing more). Asserting on those
   * would be asserting that the policy is wrong.
   */
  test('no module is viewable by ADMIN alone', () => {
    const adminOnly = [...demanded.keys()]
      .filter((code) => code.endsWith('.VIEW'))
      .filter((code) => holders(code).every((r) => r === 'ADMIN'))
      .sort();
    assert.deepEqual(adminOnly, []);
  });
});

describe('RBAC - the approval-enabled documents', () => {
  const issued = new Set(buildPermissions().map((p) => p.code));

  /**
   * The eleven document types registered with the approval engine. Kept as a
   * literal rather than imported from approvalEngine.js so that this file has
   * no reason to load prisma - and so that adding a document type to the engine
   * without granting anybody the permission to decide it fails here.
   */
  const APPROVAL_DOCUMENTS = [
    'BUYER_ORDER',
    'PLANNING',
    'VENDOR_QUOTATION',
    'PURCHASE_ORDER',
    'GATE_PASS',
    'GRN',
    'DYE_ISSUE',
    'CUTTING_CHALLAN',
    'FABRIC_SCRUTINY',
    'PLAN_APPROVAL',
    'CUTTING_ISSUE',
  ];

  for (const module of APPROVAL_DOCUMENTS) {
    test(`${module}.APPROVE exists and the Director holds it`, () => {
      const code = `${module}.APPROVE`;
      assert.ok(issued.has(code), `${code} is never generated - see APPROVABLE in rbac.js`);
      assert.ok(
        holders(code).includes('DIRECTOR'),
        `the Director cannot approve a ${module.toLowerCase().replace(/_/g, ' ')}`,
      );
    });
  }
});
