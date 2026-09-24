/**
 * Pagination tests. No database.
 *
 * ---------------------------------------------------------------------------
 *  WHY PAGING GETS ITS OWN FILE
 *
 *  Paging arithmetic fails quietly. An off-by-one does not throw - it drops
 *  one row between two pages, or returns an empty array that on screen is
 *  indistinguishable from "nothing matched your filter". Nobody reports it,
 *  because nothing looks broken.
 *
 *  Two things are asserted here:
 *
 *    `pageOf` - the report pager. Every page boundary, and the clamps that
 *    keep a hand-edited URL or a narrowed filter from producing an empty
 *    table.
 *
 *    That every row is delivered exactly once across the pages. That is the
 *    property that actually matters to somebody reconciling a report against
 *    the workbook, and it is the one a boundary bug breaks.
 * ---------------------------------------------------------------------------
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { pageOf } from '../src/services/report.service.js';

/** `n` rows that can be told apart. */
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

describe('Report paging - the page boundaries', () => {
  test('the first page starts at the first row', () => {
    const { rows: page, meta } = pageOf(rows(120), { page: 1, pageSize: 50 });
    assert.equal(page.length, 50);
    assert.equal(page[0].id, 1);
    assert.equal(page[49].id, 50);
    assert.equal(meta.pageCount, 3);
    assert.equal(meta.hasPrev, false);
    assert.equal(meta.hasNext, true);
  });

  test('a middle page picks up exactly where the previous one stopped', () => {
    const { rows: page } = pageOf(rows(120), { page: 2, pageSize: 50 });
    assert.equal(page[0].id, 51);
    assert.equal(page[49].id, 100);
  });

  test('the last page is the remainder, not a padded full page', () => {
    const { rows: page, meta } = pageOf(rows(120), { page: 3, pageSize: 50 });
    assert.equal(page.length, 20);
    assert.equal(page[0].id, 101);
    assert.equal(page[19].id, 120);
    assert.equal(meta.hasNext, false);
    assert.equal(meta.hasPrev, true);
  });

  test('a set that divides exactly does not gain an empty last page', () => {
    const { meta } = pageOf(rows(100), { page: 1, pageSize: 50 });
    assert.equal(meta.pageCount, 2);
  });

  test('every row is delivered exactly once across all pages', () => {
    const all = rows(237);
    const seen = [];
    const { meta } = pageOf(all, { page: 1, pageSize: 50 });
    for (let p = 1; p <= meta.pageCount; p += 1) {
      seen.push(...pageOf(all, { page: p, pageSize: 50 }).rows.map((r) => r.id));
    }
    assert.equal(seen.length, 237, 'a row was dropped or repeated');
    assert.deepEqual(seen, all.map((r) => r.id), 'the rows came back out of order');
  });
});

describe('Report paging - the totals never describe the page', () => {
  test('meta.total is the whole set, whichever page is asked for', () => {
    for (const p of [1, 2, 3]) {
      assert.equal(pageOf(rows(120), { page: p, pageSize: 50 }).meta.total, 120);
    }
  });
});

describe('Report paging - the clamps', () => {
  test('a page past the end returns the last page, not an empty one', () => {
    // Narrowing a filter while on page 7 of the old result lands here. An
    // empty table would read as "nothing matched", which is a different and
    // wrong answer.
    const { rows: page, meta } = pageOf(rows(120), { page: 99, pageSize: 50 });
    assert.equal(meta.page, 3);
    assert.equal(page.length, 20);
  });

  test('page zero and negative pages are the first page', () => {
    assert.equal(pageOf(rows(10), { page: 0 }).meta.page, 1);
    assert.equal(pageOf(rows(10), { page: -5 }).meta.page, 1);
  });

  test('pageSize is capped, so a hand-edited URL cannot ask for everything', () => {
    const { meta } = pageOf(rows(10_000), { page: 1, pageSize: 999_999 });
    assert.ok(meta.pageSize <= 500, `pageSize was ${meta.pageSize}`);
    assert.ok(meta.pageCount > 1, 'the cap did not actually limit the page');
  });

  test('a pageSize of zero or nonsense falls back to the default', () => {
    for (const bad of [0, -10, 'abc', null, undefined]) {
      const { meta } = pageOf(rows(200), { page: 1, pageSize: bad });
      assert.ok(meta.pageSize >= 1, `pageSize became ${meta.pageSize} for ${String(bad)}`);
      assert.ok(Number.isFinite(meta.pageSize));
    }
  });
});

describe('Report paging - empty and tiny sets', () => {
  test('an empty report is one empty page, never "page 1 of 0"', () => {
    const { rows: page, meta } = pageOf([], { page: 1, pageSize: 50 });
    assert.deepEqual(page, []);
    assert.equal(meta.total, 0);
    assert.equal(meta.pageCount, 1);
    assert.equal(meta.hasNext, false);
    assert.equal(meta.hasPrev, false);
  });

  test('a missing rows array is treated as empty rather than throwing', () => {
    assert.equal(pageOf(undefined, {}).meta.total, 0);
    assert.equal(pageOf(null, {}).meta.total, 0);
  });

  test('a single row fits on one page', () => {
    const { rows: page, meta } = pageOf(rows(1), {});
    assert.equal(page.length, 1);
    assert.equal(meta.pageCount, 1);
    assert.equal(meta.hasNext, false);
  });

  test('no query at all is a valid first page', () => {
    const { meta } = pageOf(rows(75));
    assert.equal(meta.page, 1);
    assert.ok(meta.pageSize > 0);
  });
});
