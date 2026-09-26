/**
 * §38 STATUS MANAGEMENT, §39 UI NAVIGATION, §40 CODING STANDARD.
 *
 * ===========================================================================
 *  WHAT THESE TESTS ARE FOR
 * ===========================================================================
 *
 * The three sections are rules about the shape of the system rather than about
 * arithmetic, so the tests here mostly assert that two things which must agree
 * still agree:
 *
 *   §38  the transition tables are total, closed, and refuse what the brief
 *        says they must refuse
 *   §39  every navigation destination is a route, and every route is reachable
 *   §40  the things that exist in one place only still exist in one place only
 *
 * None of them touch a database. They read source files and exported constants,
 * which is what makes them cheap enough to run on every change.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  FULFILMENT_TRANSITIONS,
  GATE_PASS_TRANSITIONS,
  REGISTRY,
  TERMINAL,
  TRANSITIONS,
  allowedStatusesFrom,
  assertStatusTransition,
  progressOf,
} from '../src/services/approvalEngine.js';
import { AUDITED, IGNORED_FIELDS, REDACTED, isAudited } from '../src/config/auditedTables.js';
import { changedFields, snapshot } from '../src/config/auditSnapshot.js';
import {
  bufferAuditEntry,
  currentActor,
  inAuditBuffer,
  withActor,
  withAuditBuffer,
} from '../src/config/auditContext.js';
import { Prisma } from '@prisma/client';

const { Decimal } = Prisma;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

// ===========================================================================
//  §38 - STATUS MANAGEMENT
// ===========================================================================

describe('§38 - no status is settable to an arbitrary value from the frontend', () => {
  /**
   * The brief's rule is "do not allow arbitrary status values from the
   * frontend". The mechanism is that the update schemas do not carry a status
   * field at all: changing one goes through POST /:id/status, which validates
   * against a fixed enum and then through the transition table.
   *
   * A regression here would be somebody adding `status` back to an update
   * schema for convenience, which would let a screen jump a document straight
   * from DRAFT to APPROVED.
   */
  const UPDATE_SCHEMAS = [
    ['grn.validator.js', 'updateGrnSchema'],
    ['gatePass.validator.js', 'updateGatePassSchema'],
    ['production.validator.js', 'updateFabricIssueSchema'],
    ['production.validator.js', 'updateJobWorkSchema'],
  ];

  for (const [file, schema] of UPDATE_SCHEMAS) {
    test(`${schema} does not accept a status`, () => {
      const src = read('server', 'src', 'validators', file);
      const start = src.indexOf(`export const ${schema}`);
      assert.ok(start > -1, `${schema} not found in ${file}`);

      // Read to the end of the statement rather than to the end of the file.
      const body = src.slice(start, src.indexOf('\nexport const', start + 1) + 1 || undefined);
      assert.ok(
        /\.omit\(\s*\{[^}]*status:\s*true/.test(body) || !/\bstatus:/.test(body),
        `${schema} still accepts a status. Status changes go through the status endpoint.`,
      );
    });
  }

  test('a status change is its own endpoint, behind its own permission', () => {
    for (const [file, module] of [['grn.routes.js', 'GRN'], ['production.routes.js', 'FABRIC_ISSUE']]) {
      const src = read('server', 'src', 'routes', file);
      assert.match(src, /\/:id\/status/, `${file} has no status endpoint`);
      assert.ok(src.includes(module), `${file} does not name the ${module} permission`);
    }
  });

  test('a gate pass moves by named act rather than by status', () => {
    // Clearing a pass stamps who did it and what they counted. That is an act,
    // not a field, so it is POST /clear and POST /reopen - and neither can be
    // reached by writing a status onto an update.
    const src = read('server', 'src', 'routes', 'gatePass.routes.js');
    assert.match(src, /'\/:id\/clear'/);
    assert.match(src, /'\/:id\/reopen'/);
    assert.match(src, /GATE_PASS\.APPROVE/);
  });
});

describe('§38 - the transition tables are total and closed', () => {
  /**
   * Each table with the states it is expected to end at.
   *
   * The gate pass has none, and that is the honest answer rather than an
   * oversight: a pass cycles between PENDING and CLEARED for as long as it may
   * be reopened, and what actually finishes it is a GRN being received against
   * it - a fact in another table, not a state in this one. gatePass.reopen()
   * enforces that.
   */
  const TABLES = [
    ['workflow', TRANSITIONS, ['COMPLETED', 'CANCELLED']],
    ['fulfilment', FULFILMENT_TRANSITIONS, ['COMPLETED', 'CANCELLED']],
    ['gate pass', GATE_PASS_TRANSITIONS, []],
  ];

  for (const [name, table, expectedTerminal] of TABLES) {
    test(`${name}: every successor is itself a declared state`, () => {
      for (const [from, next] of Object.entries(table)) {
        assert.ok(Array.isArray(next), `${from} must declare its successors`);
        for (const to of next) {
          assert.ok(table[to] !== undefined, `${name}: ${from} -> ${to} names an unknown state`);
        }
      }
    });

    test(`${name}: no state lists itself as a successor`, () => {
      for (const [from, next] of Object.entries(table)) {
        assert.ok(!next.includes(from), `${name}: ${from} transitions to itself`);
      }
    });

    test(`${name}: exactly the expected states are terminal`, () => {
      const terminal = Object.entries(table)
        .filter(([, next]) => next.length === 0)
        .map(([state]) => state)
        .sort();
      assert.deepEqual(terminal, [...expectedTerminal].sort());
    });
  }

  test('every state is reachable from the opening state', () => {
    // Breadth-first from DRAFT. A state nobody can reach is dead code with a
    // name, which §40 forbids as surely as an unused function.
    const seen = new Set(['DRAFT']);
    const queue = ['DRAFT'];
    while (queue.length) {
      for (const to of TRANSITIONS[queue.shift()]) {
        if (!seen.has(to)) { seen.add(to); queue.push(to); }
      }
    }
    for (const state of Object.keys(TRANSITIONS)) {
      assert.ok(seen.has(state), `${state} cannot be reached from DRAFT`);
    }
  });
});

describe('§38 - assertStatusTransition refuses in business language', () => {
  test('a valid move passes silently', () => {
    assert.doesNotThrow(() => assertStatusTransition('PENDING', 'IN_PROGRESS'));
    assert.doesNotThrow(() => assertStatusTransition('IN_PROGRESS', 'COMPLETED'));
  });

  test('a completed document does not reopen', () => {
    assert.throws(
      () => assertStatusTransition('COMPLETED', 'IN_PROGRESS', { label: 'GRN-001' }),
      (err) => {
        assert.equal(err.status, 409);
        assert.match(err.message, /GRN-001/);
        // The message must name the document, not the enum member.
        assert.ok(!/FULFILMENT_TRANSITIONS/.test(err.message));
        return true;
      },
    );
  });

  test('a cancelled document is finished', () => {
    assert.throws(() => assertStatusTransition('CANCELLED', 'PENDING'));
    assert.deepEqual(allowedStatusesFrom('CANCELLED'), []);
  });

  test('a gate pass clears, and reopens only through its amendment path', () => {
    assert.doesNotThrow(() =>
      assertStatusTransition('PENDING', 'CLEARED', { table: GATE_PASS_TRANSITIONS }));
    // CLEARED -> PENDING is permitted by the table because gatePass.reopen()
    // exists. The table says the move is possible; reopen() is where the
    // conditions live - APPROVE permission, a reason, and no GRN received.
    assert.doesNotThrow(() =>
      assertStatusTransition('CLEARED', 'PENDING', { table: GATE_PASS_TRANSITIONS }));
    assert.deepEqual(
      allowedStatusesFrom('CLEARED', GATE_PASS_TRANSITIONS).map((a) => a.to),
      ['PENDING'],
    );
  });

  test('reopening is guarded by more than the table', () => {
    const src = read('server', 'src', 'services', 'gatePass.service.js');
    const body = src.slice(src.indexOf('export async function reopen'));
    assert.match(body, /usage\.grns > 0/, 'reopen() does not refuse once a GRN exists');
    assert.match(body, /assertStatusTransition/, 'reopen() bypasses the transition table');
  });
});

describe('§38 - progress reflects the lifecycle the document actually has', () => {
  test('every registered document type declares one', () => {
    for (const [documentType, cfg] of Object.entries(REGISTRY)) {
      assert.ok(Array.isArray(cfg.lifecycle) && cfg.lifecycle.length > 0,
        `${documentType} has no lifecycle`);
      assert.ok(cfg.lifecycle.every((s) => TRANSITIONS[s] !== undefined),
        `${documentType} lifecycle names a state outside the table`);
      // Not every document opens at DRAFT: a gate pass is written already
      // submitted, and a GRN is written already posted. What matters is that
      // the opening state is a real one and is not already the end.
      const opening = cfg.lifecycle[0];
      assert.ok(TRANSITIONS[opening] !== undefined,
        `${documentType} opens at ${opening}, which is not a declared state`);
      assert.ok(!TERMINAL.has(opening) || cfg.lifecycle.length === 1,
        `${documentType} opens at ${opening}, which is terminal`);
    }
  });

  test('a lifecycle names each step once and ends where the document ends', () => {
    // A lifecycle is what the progress bar draws, not a transition path: a GRN
    // shows "Draft -> Posted" without ever sitting in Draft, because a receipt
    // is written and posted in one act. So this checks shape, not reachability.
    for (const [documentType, cfg] of Object.entries(REGISTRY)) {
      assert.equal(
        new Set(cfg.lifecycle).size,
        cfg.lifecycle.length,
        `${documentType} lists a step twice`,
      );
      const last = cfg.lifecycle.at(-1);
      assert.ok(
        ['APPROVED', 'POSTED', 'COMPLETED'].includes(last),
        `${documentType} ends at ${last}, which is not a finished state`,
      );
    }
  });

  test('a GRN is posted without ever being approved', () => {
    // The one that matters: a receipt has no approval step, and its progress
    // bar must not draw one and leave it forever unticked.
    assert.deepEqual(REGISTRY.GRN.lifecycle, ['DRAFT', 'POSTED']);
    const p = progressOf('POSTED', 'GRN');
    assert.equal(p.step, 2);
    assert.equal(p.of, 2);
    assert.equal(p.offPath, false);
  });

  test('a rejected document does not report progress it has not made', () => {
    const p = progressOf('REJECTED', 'PURCHASE_ORDER');
    assert.equal(p.offPath, true);
  });

  test('only COMPLETED and CANCELLED are terminal', () => {
    assert.deepEqual([...TERMINAL].sort(), ['CANCELLED', 'COMPLETED']);
  });
});

// ===========================================================================
//  §39 - UI NAVIGATION
// ===========================================================================

describe('§39 - the navigation shows the current scope and nothing else', () => {
  const nav = read('client', 'src', 'config', 'navigation.js');
  const routes = read('client', 'src', 'routes', 'AppRoutes.jsx');

  /** The groups the business named, in the order it named them. */
  const EXPECTED_GROUPS = [
    'Dashboard', 'Masters', 'Orders', 'Procurement', 'Stores',
    'Job Work', 'Cutting', 'Administration',
  ];

  test('the groups are the ones the business named, in order', () => {
    const found = [...nav.matchAll(/^\s*label: '([^']+)',$/gm)]
      .map((m) => m[1])
      .filter((l) => EXPECTED_GROUPS.includes(l));
    assert.deepEqual(found, EXPECTED_GROUPS);
  });

  /**
   * The six middle groups are the pipeline, and the sidebar says so.
   *
   * `stage` is data on the group rather than a number written into its label,
   * so this checks the numbering runs 1..6 down the same groups the flow does -
   * MASTERS -> BUYER ORDER -> PLANNING -> QUOTATION -> PURCHASE ORDER ->
   * GATE PASS -> GRN -> FABRIC ISSUE -> DYEING -> SCRUTINY -> CUTTING ISSUE.
   * A group inserted in the middle without a stage, or numbered out of order,
   * is a sidebar that no longer describes the work.
   *
   * PLAN APPROVAL used to be a numbered group of its own. It is now a second
   * door in the Dashboard's Approvals entry, beside the cross-module queue,
   * because somebody looking for either goes to the same place. The plan
   * approval STEP still happens where it always did in the flow; it simply no
   * longer has a sidebar heading to itself.
   */
  test('the pipeline groups are numbered in flow order', () => {
    const PIPELINE = [
      'Masters', 'Orders', 'Procurement', 'Stores',
      'Job Work', 'Cutting',
    ];

    // Each group's label paired with the `stage` that follows it, if any.
    const staged = [...nav.matchAll(/label: '([^']+)',\s*stage: (\d+),/g)]
      .map((m) => ({ label: m[1], stage: Number(m[2]) }));

    assert.deepEqual(
      staged.map((g) => g.label),
      PIPELINE,
      'the numbered groups must be the pipeline groups, in flow order',
    );
    assert.deepEqual(
      staged.map((g) => g.stage),
      [1, 2, 3, 4, 5, 6],
      'the stages must run 1..6 with no gaps',
    );
  });

  test('Dashboard and Administration are not numbered as pipeline stages', () => {
    // Neither is a step in the work: one is where you start, the other is how
    // the system is configured. Numbering them would put Administration after
    // Cutting Issue, which is not a thing anybody does.
    for (const group of ['Dashboard', 'Administration']) {
      const block = nav.slice(nav.indexOf(`label: '${group}',`));
      const upToItems = block.slice(0, block.indexOf('items:'));
      assert.ok(!/stage:/.test(upToItems), `${group} must not carry a pipeline stage`);
    }
  });

  test('Approvals is a cross-module queue, not a procurement screen', () => {
    // It lists everything awaiting a decision across all eleven modules, so it
    // belongs with the dashboard. Under Procurement it read as one stage's own
    // screen.
    const dashboard = nav.slice(nav.indexOf("label: 'Dashboard',"), nav.indexOf("label: 'Masters',"));
    assert.ok(dashboard.includes("to: '/approvals'"), 'Approvals belongs in the Dashboard group');

    const procurement = nav.slice(nav.indexOf("label: 'Procurement',"), nav.indexOf("label: 'Stores',"));
    assert.ok(!procurement.includes("to: '/approvals'"), 'Approvals must not sit under Procurement');
  });

  /*
   * Matched on the ROUTE, not the label, as the Approvals test above is.
   *
   * The rule is that these three SCREENS live under Administration - not that
   * they are worded a particular way. The sidebar deliberately spells out trade
   * shorthand for people meeting it for the first time ("Audit" reads as "Audit
   * Trail", "GRN" as "Goods Received"), and a test keyed on the label turns
   * every such rewording into a failure that says nothing is missing when
   * nothing is. A route, by contrast, is the screen's identity: delete the
   * audit screen and this still fails, which is the failure worth having.
   */
  test('Administration carries Users, Roles and Audit', () => {
    const admin = nav.slice(nav.indexOf("label: 'Administration'"));
    for (const [screen, route] of [
      ['Users', '/admin/users'],
      ['Roles', '/admin/roles'],
      ['Audit', '/admin/audit'],
    ]) {
      assert.ok(admin.includes(`to: '${route}'`), `Administration is missing ${screen}`);
    }
  });

  test('every navigation destination has a route', () => {
    const destinations = [...nav.matchAll(/to: '([^']+)'/g)].map((m) => m[1]);
    assert.ok(destinations.length > 15, 'the navigation looks truncated');

    for (const dest of destinations) {
      // Query strings select a filter on a screen that already has a route.
      const path = dest.split('?')[0];
      // The dashboard is the layout's index route rather than a path.
      const pattern = path === '/' ? '<Route index' : `path="${path}"`;
      assert.ok(
        routes.includes(pattern),
        `${dest} is in the navigation but has no route in AppRoutes.jsx`,
      );
    }
  });

  test('nothing after Cutting Issue appears anywhere in the navigation', () => {
    // The scope boundary, restated where a future edit would trip over it.
    const OUT_OF_SCOPE = [
      'Stitching', 'Hourly', 'QC Record', 'Alter', 'Packing',
      'Needle', 'Dispatch', 'Reconciliation',
    ];
    for (const word of OUT_OF_SCOPE) {
      assert.ok(
        !new RegExp(`label: '[^']*${word}`, 'i').test(nav),
        `"${word}" appears in the navigation. The pipeline ends at Cutting Issue.`,
      );
    }
  });

  /*
   * This used to assert the opposite - that Dyeing and Printing were two
   * sidebar entries pre-selecting `?process=`. They are one entry now, by
   * request: the register opens with its own row of process tabs, so the menu
   * was asking a question the screen then asked again.
   *
   * What still has to hold is that the SCREEN owns the process choice. If the
   * tabs ever stop writing `?process=`, one sidebar entry becomes a register
   * with no way to tell dyeing from printing - which is the failure this test
   * now guards.
   */
  test('Job Work is one entry, and the screen owns the process choice', () => {
    // The DESTINATIONS, not the prose - the comments above them still discuss
    // `?process=`, and a test that reads explanation as configuration fails on
    // a paragraph nobody changed.
    const destinations = [...nav.matchAll(/to: '([^']+)'/g)].map((m) => m[1]);
    const jobWork = destinations.filter((d) => d.startsWith('/job-works'));
    assert.deepEqual(jobWork, ['/job-works'], 'Job Work should be a single destination');

    const list = read('client', 'src', 'pages', 'production', 'JobWorkList.jsx');
    assert.match(list, /process=|'process'/, 'the register no longer owns the process choice');
  });
});

// ===========================================================================
//  §39 / §40 - THE AUDIT TRAIL IS NOT A DEAD TABLE
// ===========================================================================

describe('§39 - the audit trail is populated, read-only, and safe', () => {
  test('something actually writes AuditLog', () => {
    const client = read('server', 'src', 'config', 'prisma.js');
    assert.match(client, /auditLog\.create/, 'nothing writes the audit log');
    assert.match(client, /\$allOperations/, 'the audit extension is not installed');
  });

  test('nothing offers to change it', () => {
    const routes = read('server', 'src', 'routes', 'audit.routes.js');
    for (const verb of ['router.post', 'router.patch', 'router.put', 'router.delete']) {
      assert.ok(!routes.includes(verb), `audit.routes.js exposes ${verb}`);
    }
    const service = read('server', 'src', 'services', 'audit.service.js');
    for (const write of ['auditLog.create', 'auditLog.update', 'auditLog.delete']) {
      assert.ok(!service.includes(write), `audit.service.js calls ${write}`);
    }
  });

  test('every audited table has a label and a route function', () => {
    for (const [table, cfg] of Object.entries(AUDITED)) {
      assert.ok(cfg.label, `${table} has no label`);
      assert.equal(typeof cfg.route, 'function', `${table} has no route function`);
      // It may legitimately return null - not every row has a screen.
      assert.doesNotThrow(() => cfg.route('00000000-0000-0000-0000-000000000000'));
    }
  });

  test('every audited table name exists in the schema', () => {
    const schema = read('server', 'prisma', 'schema.prisma');
    const mapped = new Set(
      [...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]),
    );
    for (const table of Object.keys(AUDITED)) {
      assert.ok(mapped.has(table), `"${table}" is audited but is not a table in the schema`);
    }
  });

  test('the machinery tables are deliberately not audited', () => {
    // Auditing these would bury every useful entry. See auditedTables.js.
    for (const table of ['sessions', 'doc_sequences', 'stock_ledger', 'audit_logs']) {
      assert.equal(isAudited(table), false, `${table} should not be audited`);
    }
  });

  test('AUDIT.VIEW is a real permission the seeder grants', () => {
    const rbac = read('server', 'prisma', 'seed', 'data', 'rbac.js');
    assert.match(rbac, /'AUDIT'/, 'AUDIT is not in the module list');
    // Read-only: a module nobody can create or delete rows in.
    assert.match(rbac, /READ_ONLY = new Set\(\[[^\]]*'AUDIT'/);
  });
});

describe('§39 - a secret never reaches the audit trail', () => {
  test('redacted columns are dropped, not masked', () => {
    const row = {
      id: 'abc',
      username: 'store',
      passwordHash: '$2b$12$notarealhashbutstillasecret',
      refreshTokenHash: 'nope',
    };
    const out = snapshot(row);

    assert.equal(out.username, 'store');
    // Not "***", not "[redacted]" - absent. A masked field still proves the
    // column existed and changed; an absent one says nothing at all.
    assert.ok(!('passwordHash' in out));
    assert.ok(!('refreshTokenHash' in out));
    assert.ok(!JSON.stringify(out).includes('notarealhash'));
  });

  test('every redacted name is lowerCamel and snake_case', () => {
    // Prisma hands back lowerCamel; a raw query hands back snake_case. Both
    // reach snapshot(), so both spellings must be listed.
    for (const name of REDACTED) {
      if (!name.includes('_')) {
        const snake = name.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
        assert.ok(REDACTED.has(snake), `${name} is redacted but ${snake} is not`);
      }
    }
  });
});

describe('§39 - the diff reports what changed and nothing else', () => {
  test('a decimal that reads the same is not a change', () => {
    // The comparison is on strings, which is sound because snapshot() puts
    // every Decimal through the same normalisation on the way in: 12.50 and
    // 12.5 are one number and stringify identically. Testing it through
    // snapshot() rather than with hand-written strings is the point - it is
    // that normalisation, not the comparison, that makes this true.
    const before = snapshot({ rate: new Decimal('12.50') });
    const after = snapshot({ rate: new Decimal('12.5000') });
    assert.equal(before.rate, after.rate);
    assert.deepEqual(changedFields(before, after), []);
  });

  test('a decimal that reads differently IS a change', () => {
    const before = snapshot({ rate: new Decimal('12.50') });
    const after = snapshot({ rate: new Decimal('12.51') });
    assert.equal(changedFields(before, after).length, 1);
  });

  test('a digit string is compared as text, not as a number', () => {
    // Bill numbers, HSN codes and roll numbers are digits but are not
    // quantities. "0012" becoming "12" is a real edit somebody made.
    const out = changedFields({ billNo: '0012' }, { billNo: '12' });
    assert.equal(out.length, 1);
  });

  test('a real change is reported with both values', () => {
    const out = changedFields({ rate: '12.50' }, { rate: '13.00' });
    assert.deepEqual(out, [{ field: 'rate', from: '12.50', to: '13.00' }]);
  });

  test('the audit columns are not reported', () => {
    const before = { rate: '1', updatedAt: '2026-01-01T00:00:00.000Z', updatedById: 'a' };
    const after = { rate: '1', updatedAt: '2026-08-26T00:00:00.000Z', updatedById: 'b' };
    assert.deepEqual(changedFields(before, after), []);
    for (const field of IGNORED_FIELDS) {
      assert.ok(!changedFields(before, after).some((c) => c.field === field));
    }
  });

  test('null, undefined and an absent key all mean the same thing', () => {
    // Otherwise adding a column would report every existing row as edited.
    assert.deepEqual(changedFields({ a: null }, { a: undefined }), []);
    assert.deepEqual(changedFields({ a: null }, {}), []);
  });

  test('clearing a value IS a change', () => {
    const out = changedFields({ remarks: 'urgent' }, { remarks: null });
    assert.deepEqual(out, [{ field: 'remarks', from: 'urgent', to: null }]);
  });

  test('an empty string is not the same as no value', () => {
    const out = changedFields({ remarks: null }, { remarks: '' });
    assert.equal(out.length, 1);
  });

  test('a create has nothing to compare against', () => {
    assert.deepEqual(changedFields(null, { a: 1 }), []);
    assert.deepEqual(changedFields({ a: 1 }, null), []);
  });
});


describe('§39 - a rolled-back transaction leaves no trail behind it', () => {
  /**
   * The property that matters: an audit entry must never claim a change that
   * did not commit. The buffer is what makes that true, so it is tested
   * directly rather than through a database.
   */

  test('outside a transaction, nothing buffers - the caller writes immediately', () => {
    assert.equal(inAuditBuffer(), false);
    assert.equal(bufferAuditEntry({ tableName: 'buyers' }), false);
  });

  test('inside one, entries collect instead of being written', async () => {
    const { entries, run } = withAuditBuffer(async () => {
      assert.equal(inAuditBuffer(), true);
      assert.equal(bufferAuditEntry({ tableName: 'buyers', recordId: 'a' }), true);
      assert.equal(bufferAuditEntry({ tableName: 'vendors', recordId: 'b' }), true);
      return 'committed';
    });

    assert.equal(await run, 'committed');
    assert.equal(entries.length, 2);
    // And the buffer closes with the call.
    assert.equal(inAuditBuffer(), false);
  });

  test('a throw takes the entries with it', async () => {
    const { entries, run } = withAuditBuffer(async () => {
      bufferAuditEntry({ tableName: 'grns', recordId: 'a' });
      throw new Error('insufficient stock');
    });

    await assert.rejects(run, /insufficient stock/);
    // The entries exist, but the caller only flushes on a resolved promise -
    // see the $transaction wrapper in config/prisma.js, which awaits `run`
    // BEFORE calling flush(). A rejection never reaches the flush.
    assert.equal(entries.length, 1);
  });

  test('a nested transaction flushes once, at the outermost commit', async () => {
    const outer = withAuditBuffer(async () => {
      bufferAuditEntry({ tableName: 'buyers', recordId: 'a' });

      const inner = withAuditBuffer(async () => {
        bufferAuditEntry({ tableName: 'vendors', recordId: 'b' });
      });
      assert.equal(inner.nested, true, 'the inner call must not open a second buffer');
      await inner.run;
      // Both entries land in the same array.
      assert.equal(inner.entries.length, 2);
    });

    await outer.run;
    assert.equal(outer.nested, false);
    assert.equal(outer.entries.length, 2);
  });
});

describe('§39 - the actor is resolved when the entry is written', () => {
  test('outside a request there is no actor, and that is not an error', () => {
    // The seeder and these tests write rows with nobody behind them.
    assert.deepEqual(currentActor(), {});
  });

  test('a lazy actor is read late, not at the point the context opened', () => {
    // This is what lets the middleware mount before authenticate: the request
    // arrives anonymous and acquires req.auth several middlewares later.
    const req = {};
    withActor(() => ({ userId: req.userId ?? null }), () => {
      assert.equal(currentActor().userId, null);
      req.userId = 'later';
      assert.equal(currentActor().userId, 'later');
    });
  });
});

// ===========================================================================
//  §40 - CODING STANDARD
// ===========================================================================

describe('§40 - business rules live in one place', () => {
  test('no service keeps its own transition table', () => {
    // buyerOrder.service.js used to. The engine is the authority now, and a
    // second copy would drift from it the first time a state was added.
    const services = [
      'buyerOrder.service.js', 'purchaseOrder.service.js', 'grn.service.js',
      'gatePass.service.js', 'fabricIssue.service.js', 'jobWork.service.js',
      'cuttingIssue.service.js', 'planApproval.service.js', 'fabricScrutiny.service.js',
    ];
    for (const file of services) {
      const src = read('server', 'src', 'services', file);
      assert.ok(
        !/ALLOWED_TRANSITIONS\s*=/.test(src),
        `${file} declares its own transition table. Use approvalEngine.`,
      );
    }
  });

  test('the excess percentage is nowhere in the source', () => {
    // §17: "Do not permanently hardcode 2%". Every threshold is a row in
    // excess_rules, resolved narrowest-scope-first.
    const src = read('server', 'src', 'services', 'excess.service.js');
    assert.ok(
      !/=\s*(D\()?['"`]?2(\.0+)?['"`]?\)?\s*;/.test(src),
      'excess.service.js appears to hardcode a default percentage',
    );
    assert.match(src, /SCOPE_PRECEDENCE/);
  });

  test('the audited-table list has exactly one owner', () => {
    // Both the writer and the reader need it; neither may keep a copy.
    const client = read('server', 'src', 'config', 'prisma.js');
    const service = read('server', 'src', 'services', 'audit.service.js');
    assert.match(client, /from '\.\/auditedTables\.js'/);
    assert.match(service, /from '\.\.\/config\/auditedTables\.js'/);
    // Neither redeclares it.
    assert.ok(!/const AUDITED\s*=/.test(client));
    assert.ok(!/const AUDITED\s*=/.test(service));
  });

  test('no secret is written into the source', () => {
    for (const file of ['env.js', 'prisma.js', 'auditContext.js']) {
      const src = read('server', 'src', 'config', file);
      assert.ok(
        !/(password|secret|apiKey)\s*[:=]\s*['"][^'"]{6,}['"]/i.test(src),
        `${file} appears to contain a literal credential`,
      );
    }
  });
});

describe('§40 - error responses are shaped consistently', () => {
  test('every error code is a screaming-snake name', () => {
    const src = read('server', 'src', 'utils', 'ApiError.js');
    const codes = [...src.matchAll(/^\s{2}([A-Z_]+):\s*'([A-Z_]+)',$/gm)];
    assert.ok(codes.length >= 8, 'the error-code catalogue looks truncated');
    for (const [, key, value] of codes) {
      assert.equal(key, value, `${key} does not match its value ${value}`);
    }
  });

  test('the handler never returns a raw database error', () => {
    const src = read('server', 'src', 'middleware', 'errorHandler.js');
    assert.match(src, /Prisma/, 'Prisma errors are not translated');
    assert.match(src, /success:\s*false/);
  });
});
