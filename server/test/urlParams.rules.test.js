/**
 * List URL synchronisation tests. No database, no browser.
 *
 * ---------------------------------------------------------------------------
 *  WHY THESE ARE WORTH WRITING DOWN
 *
 *  `listUrlParams` decides what ends up in the address bar of every list screen
 *  in the application. Each of its four rules fails silently in a different
 *  way, and none of them throws:
 *
 *    Forget to drop defaults, and every link anybody copies carries
 *    `?page=1&pageSize=25&sortDir=asc` - settings the sender never chose and
 *    the receiver now has pinned.
 *
 *    Forget to preserve foreign parameters, and a screen that keeps its own
 *    `?recordId=` in the URL loses it the moment a filter changes.
 *
 *    Forget the prefix, and the two lists on the Excess Rules screen overwrite
 *    each other's page number.
 *
 *    Forget the ignore list, and Job Work's process tabs stop working, because
 *    the hook clears the parameter the tab just set.
 *
 *  This file lives in `server/test` and imports from `client/src`, which is the
 *  odd part and worth naming: the client has no test runner of its own, and the
 *  rules suite here already runs pure functions on a bare Node install with no
 *  database. `listUrlParams` is pure and uses only `URLSearchParams`, which is
 *  a Node global as well as a browser one, so it runs here unmodified. Adding a
 *  second test toolchain to cover one function would have cost more than it
 *  returned.
 * ---------------------------------------------------------------------------
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { listUrlParams } from '../../client/src/hooks/useResourceList.js';

/** The shape every list passes: paging, sorting, search, then its filters. */
const DEFAULTS = { search: '', page: 1, pageSize: 25, sortBy: 'name', sortDir: 'asc', status: '' };

const build = (values, opts = {}) =>
  listUrlParams(new URLSearchParams(opts.current ?? ''), {
    prefix: opts.prefix ?? '',
    ignore: opts.ignore ?? [],
    values: { ...DEFAULTS, ...values },
    defaults: DEFAULTS,
  }).toString();

describe('List URLs - defaults are left out', () => {
  test('an untouched list produces an empty query string', () => {
    assert.equal(build({}), '');
  });

  test('page 1 is never written', () => {
    assert.equal(build({ page: 1 }), '');
  });

  test('the default page size is never written', () => {
    assert.equal(build({ pageSize: 25 }), '');
  });

  test('the default sort column and direction are never written', () => {
    assert.equal(build({ sortBy: 'name', sortDir: 'asc' }), '');
  });

  test('an empty filter is never written', () => {
    assert.equal(build({ status: '' }), '');
  });
});

describe('List URLs - what the user actually changed is written', () => {
  test('a page other than the first', () => {
    assert.equal(build({ page: 3 }), 'page=3');
  });

  test('a search phrase', () => {
    assert.match(build({ search: 'cotton canvas' }), /search=cotton\+canvas/);
  });

  test('a filter', () => {
    assert.equal(build({ status: 'PENDING' }), 'status=PENDING');
  });

  test('a non-default sort', () => {
    const q = build({ sortBy: 'createdAt', sortDir: 'desc' });
    assert.match(q, /sortBy=createdAt/);
    assert.match(q, /sortDir=desc/);
  });

  test('several at once', () => {
    const q = new URLSearchParams(build({ page: 2, status: 'APPROVED', search: 'tote' }));
    assert.equal(q.get('page'), '2');
    assert.equal(q.get('status'), 'APPROVED');
    assert.equal(q.get('search'), 'tote');
  });
});

describe('List URLs - a value returning to its default is removed', () => {
  test('going back to page 1 clears page from the URL', () => {
    assert.equal(build({ page: 1 }, { current: 'page=7' }), '');
  });

  test('clearing a filter clears it from the URL', () => {
    assert.equal(build({ status: '' }, { current: 'status=PENDING' }), '');
  });

  test('clearing the search box clears it from the URL', () => {
    assert.equal(build({ search: '' }, { current: 'search=tote' }), '');
  });
});

describe('List URLs - parameters this list does not own are preserved', () => {
  test('a foreign parameter survives a filter change', () => {
    const q = new URLSearchParams(build({ status: 'PENDING' }, { current: 'recordId=abc-123' }));
    assert.equal(q.get('recordId'), 'abc-123');
    assert.equal(q.get('status'), 'PENDING');
  });

  test('a foreign parameter survives a value being cleared', () => {
    const q = new URLSearchParams(build({}, { current: 'recordId=abc-123&page=4' }));
    assert.equal(q.get('recordId'), 'abc-123');
    assert.equal(q.get('page'), null, 'page should have been dropped as a default');
  });
});

describe('List URLs - two lists on one screen do not collide', () => {
  test('a prefix namespaces every key', () => {
    const q = new URLSearchParams(build({ page: 2, status: 'PENDING' }, { prefix: 'rules' }));
    assert.equal(q.get('rules.page'), '2');
    assert.equal(q.get('rules.status'), 'PENDING');
    assert.equal(q.get('page'), null);
  });

  test('one list does not disturb the other', () => {
    // The rules list moves to page 2 while the approvals list is on page 5.
    const q = new URLSearchParams(
      build({ page: 2 }, { prefix: 'rules', current: 'approvals.page=5' }),
    );
    assert.equal(q.get('rules.page'), '2');
    assert.equal(q.get('approvals.page'), '5', "the other list's page was lost");
  });
});

describe('List URLs - keys the screen owns are left alone', () => {
  test('an ignored filter is neither written nor cleared', () => {
    // Job Work: the tab has just set ?process=PRINTING, and the hook runs with
    // its filter still holding the previous value. It must not touch it.
    const q = new URLSearchParams(
      build({ process: '' }, { ignore: ['process'], current: 'process=PRINTING' }),
    );
    assert.equal(q.get('process'), 'PRINTING', 'the tab click was reverted');
  });

  test('ignoring one key does not stop the others being written', () => {
    const q = new URLSearchParams(
      build({ process: '', page: 3 }, { ignore: ['process'], current: 'process=DYEING' }),
    );
    assert.equal(q.get('process'), 'DYEING');
    assert.equal(q.get('page'), '3');
  });
});

describe('List URLs - values that need escaping', () => {
  test('a search with an ampersand does not split into two parameters', () => {
    const q = new URLSearchParams(build({ search: 'black & tan' }));
    assert.equal(q.get('search'), 'black & tan');
  });

  test('a search that looks like a query string stays one value', () => {
    const q = new URLSearchParams(build({ search: 'page=9&status=X' }));
    assert.equal(q.get('search'), 'page=9&status=X');
    assert.equal(q.get('status'), null, 'the search value leaked into a real parameter');
  });
});
