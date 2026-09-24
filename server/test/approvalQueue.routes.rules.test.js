/**
 * THE APPROVAL QUEUE OPENS EVERY DOCUMENT IT LISTS.
 *
 * ===========================================================================
 *  THE BUG THIS FILE EXISTS TO PREVENT
 * ===========================================================================
 *
 * The queue is built from `Object.keys(REGISTRY)` — dashboard.service.js hands
 * `pendingSummary()` every document type the caller may view, and the engine's
 * registry IS that list. Registering a new document type therefore puts it in
 * the queue automatically, which is the right default.
 *
 * What is NOT automatic is the click. `ROUTE_FOR` in ApprovalQueue.jsx maps a
 * document type to its detail page, and a type missing from it still appears
 * in the queue — it just navigates to `/` when somebody clicks the row:
 *
 *     ROUTE_FOR[g.documentType]?.(r.id) ?? '/'
 *
 * DYE_ISSUE and CUTTING_CHALLAN were both in exactly that state: registered,
 * listed, and unopenable. A dead click on the one screen whose entire job is
 * "here is what is waiting on you" is worse than not listing the row.
 *
 * §39's navigation test does not catch this, because the approval queue is not
 * the navigation — it is generated from the registry, not from navigation.js.
 * So the invariant is asserted here instead, and it holds for every document
 * type added from now on without anybody remembering to come back.
 *
 * No database. Reads the client source and the engine's exported registry.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { REGISTRY } from '../src/services/approvalEngine.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

const queue = read('client', 'src', 'pages', 'ApprovalQueue.jsx');
const routes = read('client', 'src', 'routes', 'AppRoutes.jsx');

/** The keys of the ROUTE_FOR object literal, and the path each one builds. */
function routeMap() {
  const block = queue.slice(queue.indexOf('const ROUTE_FOR = {'));
  const body = block.slice(0, block.indexOf('\n};'));
  const out = {};
  for (const [, key, path] of body.matchAll(/^\s*([A-Z_]+):\s*\(id\)\s*=>\s*`([^`]+)`/gm)) {
    out[key] = path;
  }
  return out;
}

/** Every `path="..."` the router actually declares. */
const declaredRoutes = new Set(
  [...routes.matchAll(/path="([^"]+)"/g)].map((m) => m[1]),
);

describe('the approval queue can open everything it lists', () => {
  test('ROUTE_FOR covers every document type in the approval engine registry', () => {
    const mapped = Object.keys(routeMap());
    const missing = Object.keys(REGISTRY).filter((type) => !mapped.includes(type));
    assert.deepEqual(
      missing,
      [],
      `these document types appear in the queue but have no route, so clicking one goes to "/": ${missing.join(', ')}`,
    );
  });

  test('ROUTE_FOR names no document type the engine does not have', () => {
    const stale = Object.keys(routeMap()).filter((type) => !REGISTRY[type]);
    assert.deepEqual(stale, [], `ROUTE_FOR maps document types that no longer exist: ${stale.join(', ')}`);
  });

  test('every route ROUTE_FOR builds is a route the router declares', () => {
    for (const [type, path] of Object.entries(routeMap())) {
      // `/orders/${id}` -> `/orders/:id`, which is how AppRoutes spells it.
      const pattern = path.replace(/\$\{id\}/g, ':id');
      assert.ok(
        declaredRoutes.has(pattern),
        `${type} points at ${pattern}, which AppRoutes does not declare`,
      );
    }
  });

  test('the two documents this guard was written for are openable', () => {
    const map = routeMap();
    assert.equal(map.CUTTING_CHALLAN, '/cutting-challans/${id}');
    assert.equal(map.DYE_ISSUE, '/job-works/${id}');
  });
});
