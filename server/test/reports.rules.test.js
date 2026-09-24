/**
 * Report registry tests. No database.
 *
 * The reporting module is driven entirely by its descriptors: the client
 * renders whatever columns they declare, and RBAC is whatever `permission`
 * says. A malformed descriptor would therefore fail silently — a report with no
 * permission would be readable by anyone, and a column with no `key` would
 * render as an empty stripe down a table nobody could explain.
 *
 * These cases assert the registry is well-formed, and that the CSV writer
 * agrees with it.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { REPORTS, catalogue, descriptorFor, toCsv } from '../src/services/report.service.js';
import { parseCsvRecords, toCsv as writeCsv } from '../src/utils/csv.js';

const readRepoFile = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** The fourteen reports the brief asks for, by key. */
const EXPECTED = [
  'order-status',
  // Added with buyer order pricing: the value of the orders on hand.
  'order-book',
  'planning-status',
  'pending-quotations',
  'pending-po-approvals',
  'po-status',
  'pending-grns',
  'inventory',
  'roll-wise-stock',
  'fabric-issued',
  'dyeing-status',
  'printing-status',
  'scrutiny-status',
  'plan-approval-status',
  'cutting-issue-status',
  // Planned vs actual fabric per style, from posted cutting issues.
  'cutting-efficiency',
  // Stock on hand, valued first-in first-out, layer by layer.
  'stock-valuation',
];

/** Modules that do not exist in this system, and must not gain a report. */
const OUT_OF_SCOPE = [
  'stitching',
  'hourly',
  'qc-size',
  'qc-defect',
  'checker',
  'alter',
  'rectification',
  'rejected',
  'packing',
  'needle',
  'dispatch',
  'reconciliation',
];

describe('Reports - every report the brief asks for exists', () => {
  for (const key of EXPECTED) {
    test(`${key} is registered`, () => {
      assert.ok(REPORTS[key], `${key} is missing from the registry`);
    });
  }

  test('and nothing else is registered', () => {
    assert.deepEqual(Object.keys(REPORTS).sort(), [...EXPECTED].sort());
  });
});

describe('Reports - no report exists for an out-of-scope module', () => {
  test('the registry names none of them', () => {
    const keys = Object.keys(REPORTS).join(' ').toLowerCase();
    for (const banned of OUT_OF_SCOPE) {
      assert.ok(
        !keys.includes(banned),
        `a report key mentions "${banned}", which is out of scope`,
      );
    }
  });

  /**
   * The substantive check, rather than policing prose.
   *
   * A report can only read what its permission grants, and an out-of-scope
   * module has no permission in the catalogue at all — so if every report’s
   * permission names an in-scope module, no report can reach out-of-scope
   * data whatever its title happens to say.
   *
   * Checking the prose instead would be wrong: "after-stitching" is a
   * FabricStage the workbook itself names on the Printing sheet, and has
   * nothing to do with the Stitching Record module.
   */
  test('every report reads through an in-scope permission', () => {
    const IN_SCOPE = new Set([
      'MASTER_LIST', 'BUYER', 'VENDOR', 'EMPLOYEE', 'STYLE', 'USER', 'ROLE',
      'BUYER_ORDER', 'PLANNING', 'VENDOR_QUOTATION', 'PURCHASE_ORDER',
      'GATE_PASS', 'GRN', 'FABRIC_ROLL', 'INVENTORY', 'STOCK_LEDGER',
      'FABRIC_ISSUE', 'DYE_ISSUE', 'DYEING_RECEIPT', 'PRINTING',
      'FABRIC_SCRUTINY', 'PLAN_APPROVAL', 'CUTTING_ISSUE', 'REPORT',
    ]);

    for (const [key, report] of Object.entries(REPORTS)) {
      const [module] = report.permission.split('.');
      assert.ok(
        IN_SCOPE.has(module),
        `${key} reads through ${report.permission}, which is not an in-scope module`,
      );
    }
  });
});

describe('Reports - every descriptor is well-formed', () => {
  for (const [key, report] of Object.entries(REPORTS)) {
    test(`${key} declares everything the client and RBAC need`, () => {
      assert.ok(report.title, 'needs a title');
      assert.ok(report.description, 'needs a description');
      assert.ok(report.excelRef, 'needs an Excel reference to reconcile against');
      assert.equal(typeof report.run, 'function', 'needs a run function');

      // The one that matters: without a permission the route would have
      // nothing to check, and the report would be readable by anyone.
      assert.ok(report.permission, 'needs a permission');
      assert.match(
        report.permission,
        /^[A-Z_]+\.[A-Z]+$/,
        'permission must look like MODULE.ACTION',
      );

      assert.ok(Array.isArray(report.filters), 'needs a filter list');
      assert.ok(Array.isArray(report.columns) && report.columns.length > 0, 'needs columns');
    });

    test(`${key} has usable columns`, () => {
      const keys = new Set();
      for (const col of report.columns) {
        assert.ok(col.key, `${key}: a column has no key`);
        assert.ok(col.label, `${key}: column "${col.key}" has no label`);
        assert.ok(
          ['text', 'qty', 'money', 'date', 'state'].includes(col.format),
          `${key}: column "${col.key}" has an unknown format "${col.format}"`,
        );
        assert.ok(!keys.has(col.key), `${key}: duplicate column key "${col.key}"`);
        keys.add(col.key);
      }
    });
  }
});

describe('Reports - the catalogue is filtered by permission', () => {
  test('a user with nothing sees nothing', () => {
    assert.equal(catalogue(() => false).length, 0);
  });

  test('a user with everything sees every report', () => {
    assert.equal(catalogue(() => true).length, EXPECTED.length);
  });

  test('a user sees exactly the reports their permissions cover', () => {
    // Somebody who can only see purchase orders gets the two PO reports and
    // nothing else.
    const visible = catalogue((code) => code === 'PURCHASE_ORDER.VIEW').map((r) => r.key);
    assert.deepEqual(visible.sort(), ['pending-po-approvals', 'po-status']);
  });

  test('the catalogue carries the columns, so one screen can render any report', () => {
    const [first] = catalogue(() => true);
    assert.ok(Array.isArray(first.columns));
    assert.ok(Array.isArray(first.filters));
    assert.ok(first.excelRef);
  });
});

describe('Reports - an unknown key is refused, not answered with nothing', () => {
  test('descriptorFor throws a 404 rather than returning undefined', () => {
    assert.throws(() => descriptorFor('stitching-status'), /not found/i);
  });
});

describe('Reports - the CSV agrees with the columns', () => {
  const report = {
    columns: [
      { key: 'poId', label: 'PO ID', format: 'text' },
      { key: 'amount', label: 'Amount', format: 'money' },
      { key: 'vendorName', label: 'Vendor', format: 'text' },
    ],
    rows: [
      { poId: 'RF-001', amount: '801000.00', vendorName: 'Rajasthan Fabrics' },
      { poId: 'MA-001', amount: '108000.00', vendorName: null },
    ],
  };

  test('the header comes from the labels, in column order', () => {
    assert.equal(toCsv(report).split('\r\n')[0], 'PO ID,Amount,Vendor');
  });

  test('rows follow the same order, so the file lines up with the screen', () => {
    assert.equal(toCsv(report).split('\r\n')[1], 'RF-001,801000.00,Rajasthan Fabrics');
  });

  test('a null renders as empty rather than the word "null"', () => {
    assert.equal(toCsv(report).split('\r\n')[2], 'MA-001,108000.00,');
  });

  test('commas, quotes and newlines are escaped', () => {
    const awkward = {
      columns: [{ key: 'note', label: 'Note', format: 'text' }],
      rows: [
        { note: 'Lowest of 3, and cheapest' },
        { note: 'He said "no"' },
        { note: 'line one\nline two' },
      ],
    };
    const lines = toCsv(awkward);
    assert.ok(lines.includes('"Lowest of 3, and cheapest"'));
    assert.ok(lines.includes('"He said ""no"""'));
    assert.ok(lines.includes('"line one\nline two"'));
  });

  test('a cell that Excel would run as a formula is written as text', () => {
    const risky = {
      columns: [{ key: 'v', label: 'V', format: 'text' }],
      rows: [
        { v: '=HYPERLINK("http://x","y")' },
        { v: '@SUM(A1)' },
        { v: '-2+cmd|x' },
        { v: '-1200.00' },
        { v: '+91 98290 12345' },
      ],
    };
    const lines = toCsv(risky).split('\r\n');
    assert.equal(lines[1], `"'=HYPERLINK(""http://x"",""y"")"`);
    assert.equal(lines[2], "'@SUM(A1)");
    assert.equal(lines[3], "'-2+cmd|x");
    assert.equal(lines[4], '-1200.00');
    assert.equal(lines[5], '+91 98290 12345');
  });

  test('the formula guard comes off again on import', () => {
    const values = ['=HYPERLINK("x")', "'=already quoted", "it's fine", '-1200.00'];
    const text = writeCsv([{ key: 'v', label: 'V' }], values.map((v) => ({ v })));
    assert.deepEqual(parseCsvRecords(text).records.map((r) => r.values.V), values);
  });

  test('a report with no rows still emits its header', () => {
    assert.equal(toCsv({ ...report, rows: [] }), 'PO ID,Amount,Vendor');
  });
});

// ===========================================================================
//  THE DATE RANGE EVERY REPORT IS ASKED ABOUT
// ===========================================================================

/**
 * `between()` builds an INCLUSIVE range from bare date strings, and
 * `new Date('2026-09-01')` is midnight UTC. Against a `@db.Date` column that
 * is the whole of 1 September; against a `@db.Timestamptz` column it is the
 * first instant of it, so a range ending 1 September silently excludes
 * everything that happened during 1 September - and excludes it 5.5 hours out
 * of step besides, because the factory works in IST and the boundary is drawn
 * in UTC.
 *
 * The helper cannot defend itself: every column it might be pointed at is a
 * `DateTime` to Prisma, and only the schema knows which are dates. So the
 * check lives here, reading the schema and the service as text. It is the only
 * way to catch a report that quietly filters on `createdAt` - the row's
 * write time - instead of the business date the report is actually about.
 */
describe('Reports - every date range filters a date column', () => {
  const schema = readRepoFile('../prisma/schema.prisma');
  const source = readRepoFile('../src/services/report.service.js');

  /** Field name -> the set of column kinds the schema gives it. */
  const kindsByField = new Map();
  for (const [, name, rest] of schema.matchAll(/^ {2}(\w+)\s+DateTime\??\s+(.*)$/gm)) {
    const kind = rest.includes('@db.Date')
      ? 'Date'
      : rest.includes('@db.Timestamptz')
        ? 'Timestamptz'
        : 'Untyped';
    if (!kindsByField.has(name)) kindsByField.set(name, new Set());
    kindsByField.get(name).add(kind);
  }

  const callSites = [...source.matchAll(/between\('(\w+)'/g)].map((m) => m[1]);
  const filtered = [...new Set(callSites)];

  test('the reports do filter by date at all', () => {
    // Guards the two regexes above: if either stops matching, every case below
    // passes vacuously and the check quietly stops being a check.
    assert.ok(
      callSites.length >= 8,
      `expected most reports to take a date range, saw ${callSites.length} between() calls`,
    );
    assert.ok(kindsByField.size > 20, `the schema scan found only ${kindsByField.size} date columns`);
  });

  for (const field of filtered) {
    test(`between('${field}') targets a @db.Date column`, () => {
      const kinds = kindsByField.get(field);
      assert.ok(kinds, `${field} is not a DateTime column in the schema`);
      assert.deepEqual(
        [...kinds],
        ['Date'],
        `between() is inclusive and UTC-midnight-bound, so ${field} must be @db.Date. ` +
          'A timestamp column drops the final day of every range, shifted by the IST offset.',
      );
    });
  }

  test('no report filters on the row write time instead of its business date', () => {
    assert.ok(
      !filtered.includes('createdAt'),
      'createdAt is when a row was written, not what the document is FOR. A report asked ' +
        'for "September" means the work done in September, not the data entered in it.',
    );
  });

  test('a report offering a date range shows the date it filters on', () => {
    for (const [key, descriptor] of Object.entries(REPORTS)) {
      const takesRange =
        descriptor.filters?.includes('dateFrom') || descriptor.filters?.includes('dateTo');
      if (!takesRange) continue;
      assert.ok(
        descriptor.columns.some((c) => c.format === 'date'),
        `${key} filters by date range but shows no date column, so nobody can reconcile ` +
          'its rows against the range they asked for',
      );
    }
  });
});
