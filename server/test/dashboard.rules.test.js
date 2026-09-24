/**
 * Dashboard descriptor and RBAC tests. No database.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS FILE EXISTS
 *
 *  The dashboard is the one screen that reads across every module at once, and
 *  what it puts in front of a user is decided entirely by `sectionsFor()`. That
 *  makes it the one screen where a permissions mistake is invisible: a stock
 *  valuation that should never have been sent to a QC user looks, on the page,
 *  exactly like a stock valuation they were entitled to. Nobody would report
 *  it, because nothing looks wrong.
 *
 *  So the access decision is asserted here rather than trusted to review, and
 *  it is asserted against the real function the route calls - not a
 *  reimplementation of it.
 *
 *  The descriptor cases below are the same argument as the report registry's:
 *  the tables drive queries by name, so a typo in a model or a permission would
 *  fail at runtime, on the first screen every user sees.
 * ---------------------------------------------------------------------------
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ATTENTION_PROBES,
  MASTER_COUNTS,
  STAGES,
  sectionsFor,
} from '../src/services/dashboard.service.js';
import { REGISTRY } from '../src/services/approvalEngine.js';
import { buildPermissions } from '../prisma/seed/data/rbac.js';

/** A `has()` backed by an explicit set, the way a real role holds permissions. */
const holder = (...codes) => {
  const held = new Set(codes.flat());
  return (code) => held.has(code);
};

/** ADMIN passes everything, exactly as authenticate.js arranges it. */
const admin = () => true;

/** Somebody who has just been created and given no role at all. */
const nobody = () => false;

/**
 * Every permission code the seeder actually issues.
 *
 * Taken from `buildPermissions()` rather than rebuilt from MODULES x ACTIONS,
 * because the seeder does not issue the full cross product - APPROVE exists
 * only on the modules that carry a decision, and the read-only modules get
 * only VIEW and EXPORT. A descriptor naming a code outside this set names a
 * permission no role can ever hold, which would hide its section from
 * everybody except ADMIN and look, from a screen, like an empty pipeline.
 */
const VALID_PERMISSIONS = new Set(buildPermissions().map((p) => p.code));

/** Modules that do not exist in this system, and must never gain a tile. */
const OUT_OF_SCOPE = [
  'stitching',
  'hourly',
  'checker',
  'alter',
  'packing',
  'needle',
  'dispatch',
  'reconciliation',
];

// ===========================================================================
//  The descriptors
// ===========================================================================

describe('Dashboard - every descriptor is well formed', () => {
  const ALL = [
    ...ATTENTION_PROBES.map((d) => ({ kind: 'attention probe', ...d })),
    ...STAGES.map((d) => ({ kind: 'pipeline stage', ...d })),
    ...MASTER_COUNTS.map((d) => ({ kind: 'master count', ...d })),
  ];

  for (const d of ALL) {
    test(`${d.kind} "${d.key}" declares a real permission`, () => {
      assert.ok(d.permission, `${d.key} declares no permission at all`);
      assert.ok(
        VALID_PERMISSIONS.has(d.permission),
        `${d.key} declares ${d.permission}, which the seeder never issues`,
      );
    });

    test(`${d.kind} "${d.key}" links somewhere`, () => {
      assert.match(d.to, /^\//, `${d.key} has no route, or a route that is not absolute`);
    });
  }

  test('no key is used twice within a section', () => {
    for (const [label, table] of [
      ['attention', ATTENTION_PROBES],
      ['pipeline', STAGES],
      ['masters', MASTER_COUNTS],
    ]) {
      const keys = table.map((d) => d.key);
      assert.equal(new Set(keys).size, keys.length, `${label} has a duplicate key`);
    }
  });

  test('every attention probe carries a severity the screen can style', () => {
    for (const p of ATTENTION_PROBES) {
      assert.ok(
        ['high', 'medium', 'low'].includes(p.severity),
        `${p.key} has severity "${p.severity}", which has no styling`,
      );
    }
  });

  test('every pipeline stage names a date field to measure the last week by', () => {
    for (const s of STAGES) {
      assert.ok(s.dateField, `${s.key} has no dateField, so "this week" cannot be counted`);
      assert.ok(s.model, `${s.key} has no model`);
    }
  });
});

describe('Dashboard - scope ends at Cutting Issue', () => {
  test('no descriptor names a module that does not exist', () => {
    const text = JSON.stringify([ATTENTION_PROBES, STAGES, MASTER_COUNTS]).toLowerCase();
    for (const banned of OUT_OF_SCOPE) {
      assert.ok(!text.includes(banned), `the dashboard names "${banned}", which is out of scope`);
    }
  });

  test('Cutting Issue is the last stage', () => {
    assert.equal(STAGES[STAGES.length - 1].key, 'cuttingIssues');
  });
});

// ===========================================================================
//  The access decision
// ===========================================================================

describe('Dashboard - a user is shown only what they hold', () => {
  test('a user with no permissions gets an empty dashboard, not an error', () => {
    const s = sectionsFor(nobody);
    assert.deepEqual(s.attention, []);
    assert.deepEqual(s.approvals, []);
    assert.deepEqual(s.decidable, []);
    assert.deepEqual(s.pipeline, []);
    assert.deepEqual(s.masters, []);
    assert.equal(s.stock, false);
    assert.equal(s.activity, false);
  });

  test('ADMIN is shown everything', () => {
    const s = sectionsFor(admin);
    assert.equal(s.attention.length, ATTENTION_PROBES.length);
    assert.equal(s.pipeline.length, STAGES.length);
    assert.equal(s.masters.length, MASTER_COUNTS.length);
    assert.equal(s.approvals.length, Object.keys(REGISTRY).length);
    assert.equal(s.stock, true);
    assert.equal(s.activity, true);
  });

  test('one permission opens exactly the sections that declare it, and no others', () => {
    const s = sectionsFor(holder('GATE_PASS.VIEW'));
    assert.deepEqual(s.attention, ['gatepass-uncleared']);
    assert.deepEqual(s.pipeline, ['gatePasses']);
    assert.deepEqual(s.approvals, ['GATE_PASS']);
    assert.deepEqual(s.masters, []);
    assert.equal(s.stock, false);
  });

  test('the stock valuation needs INVENTORY.VIEW and nothing else grants it', () => {
    // A QC user holds several permissions, none of them inventory.
    const qc = holder('FABRIC_SCRUTINY.VIEW', 'FABRIC_ROLL.VIEW', 'GRN.VIEW', 'BUYER_ORDER.VIEW');
    assert.equal(sectionsFor(qc).stock, false);
    assert.equal(sectionsFor(holder('INVENTORY.VIEW')).stock, true);
  });

  test('the activity trail needs AUDIT.VIEW, not USER.VIEW', () => {
    // Administering logins is a narrower grant than reading the trail of every
    // rate and approval in the system. See navigation.js and audit.routes.js.
    assert.equal(sectionsFor(holder('USER.VIEW', 'ROLE.VIEW')).activity, false);
    assert.equal(sectionsFor(holder('AUDIT.VIEW')).activity, true);
  });
});

describe('Dashboard - seeing a queue is not deciding it', () => {
  test('VIEW alone puts a document type in the queue but not in "yours"', () => {
    const s = sectionsFor(holder('VENDOR_QUOTATION.VIEW'));
    assert.deepEqual(s.approvals, ['VENDOR_QUOTATION']);
    assert.deepEqual(s.decidable, []);
  });

  test('APPROVE is what marks a group as yours to clear', () => {
    const s = sectionsFor(holder('VENDOR_QUOTATION.VIEW', 'VENDOR_QUOTATION.APPROVE'));
    assert.deepEqual(s.decidable, ['VENDOR_QUOTATION']);
  });

  test('CUTTING_ISSUE.APPROVE is issuable, so posting is not an ADMIN-only lockout', () => {
    // `POST /cutting-issues/:id/post` is guarded by CUTTING_ISSUE.APPROVE - see
    // production.routes.js. A permission a route demands but the seeder never
    // issues is not a policy, it is a lockout: a cutting supervisor could raise
    // a challan and then take a 403 trying to post it. This asserts the seeder
    // can actually grant what the route asks for.
    assert.ok(
      VALID_PERMISSIONS.has('CUTTING_ISSUE.APPROVE'),
      'the post route demands a permission no role can hold',
    );
  });

  test('raising a challan is not the same as being allowed to post it', () => {
    const cutter = holder('CUTTING_ISSUE.VIEW', 'CUTTING_ISSUE.CREATE');
    assert.deepEqual(sectionsFor(cutter).decidable, []);
  });

  test('holding CUTTING_ISSUE.APPROVE does mark it decidable', () => {
    const poster = holder('CUTTING_ISSUE.VIEW', 'CUTTING_ISSUE.APPROVE');
    assert.deepEqual(sectionsFor(poster).decidable, ['CUTTING_ISSUE']);
  });

  test('a Director who approves everywhere may decide every visible queue', () => {
    const director = holder(
      Object.keys(REGISTRY).flatMap((t) => [`${t}.VIEW`, `${t}.APPROVE`]),
    );
    const s = sectionsFor(director);
    // Every type they can decide is one they can also see. The reverse need not
    // hold, and for Cutting Issue it deliberately does not.
    for (const type of s.decidable) {
      assert.ok(s.approvals.includes(type), `${type} is decidable but not visible`);
    }
  });
});

/**
 * THE DASHBOARD'S APPROVAL BARS GO SOMEWHERE.
 *
 * ===========================================================================
 *  THE BUG THIS BLOCK EXISTS TO PREVENT
 * ===========================================================================
 *
 * The same bug as approvalQueue.routes.rules.test.js, one screen earlier. The
 * "Awaiting decision" bars come from `pendingSummary()`, which is handed every
 * registry type the caller may view — so registering a document type puts a bar
 * on the dashboard automatically. The LINK is not automatic: `QUEUE_ROUTE` in
 * Dashboard.jsx maps a type to the stage it is worked from, and a type missing
 * from it renders `<div>` instead of `<Link>`:
 *
 *     to={QUEUE_ROUTE[g.documentType] ?? approvals.queueTo ?? undefined}
 *
 * MATERIAL_PLAN, DYE_ISSUE, GRN_REVERSAL and CUTTING_CHALLAN were all in that
 * state: counted, marked "yours to decide", and not clickable. Telling somebody
 * four plans are waiting on their signature and giving them nowhere to go is
 * the dead click the queue's guard was written for, on the screen they open
 * first.
 *
 * A `null` value is the documented exception, not an omission: the type has no
 * list screen and falls back to the approval queue. The map must still NAME it,
 * so leaving a type out stays a test failure rather than a silent fallback.
 *
 * Reads the client source and the engine's exported registry. No database.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

const dashboard = read('client', 'src', 'pages', 'Dashboard.jsx');
const appRoutes = read('client', 'src', 'routes', 'AppRoutes.jsx');

/** The keys of the QUEUE_ROUTE object literal, and the path each one names. */
function queueRouteMap() {
  const block = dashboard.slice(dashboard.indexOf('const QUEUE_ROUTE = {'));
  const body = block.slice(0, block.indexOf('\n};'));
  const out = {};
  for (const [, key, path] of body.matchAll(/^\s*([A-Z_]+):\s*(?:'([^']+)'|null),/gm)) {
    out[key] = path ?? null;
  }
  return out;
}

const declaredRoutes = new Set(
  [...appRoutes.matchAll(/path="([^"]+)"/g)].map((m) => m[1]),
);

describe('Dashboard - every approval bar is clickable', () => {
  test('QUEUE_ROUTE names every document type in the approval engine registry', () => {
    const mapped = queueRouteMap();
    const missing = Object.keys(REGISTRY).filter((type) => !(type in mapped));
    assert.deepEqual(
      missing,
      [],
      `these types get a bar on the dashboard but no link, so the count is a dead end: ${missing.join(', ')}`,
    );
  });

  test('QUEUE_ROUTE names no document type the engine does not have', () => {
    const stale = Object.keys(queueRouteMap()).filter((type) => !REGISTRY[type]);
    assert.deepEqual(stale, [], `QUEUE_ROUTE maps types that no longer exist: ${stale.join(', ')}`);
  });

  test('every stage QUEUE_ROUTE names is a route the router declares', () => {
    for (const [type, path] of Object.entries(queueRouteMap())) {
      if (path === null) continue; // documented: no list screen, falls back to the queue.
      assert.ok(declaredRoutes.has(path), `${type} points at ${path}, which AppRoutes does not declare`);
    }
  });

  test('the four documents this guard was written for reach their stage', () => {
    const map = queueRouteMap();
    assert.equal(map.MATERIAL_PLAN, '/material-plans');
    assert.equal(map.DYE_ISSUE, '/job-works');
    assert.equal(map.CUTTING_CHALLAN, '/cutting-challans');
    // F-04 has no list screen at all, so the approval queue is its only stage.
    assert.equal(map.GRN_REVERSAL, null);
  });
});
