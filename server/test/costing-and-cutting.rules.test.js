/**
 * Panels, cutting efficiency, remnants and FIFO costing. Rule tests - no
 * database required.
 *
 * Every function exercised here is pure: the services load rows and write the
 * results, and these tests prove the arithmetic in between.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { panelCounts, perBag } from '../src/domain/panels.js';
import { fifoOrder, layersForIn, planConsumption, takeNewest, costOf } from '../src/domain/fifo.js';
import { cuttingEfficiency, reconcileFabric } from '../src/services/cuttingIssue.service.js';

const TOTE = [
  { lineNo: 1, componentType: 'FRONT_PANEL', name: 'Front Panel', piecesPerBag: 1 },
  { lineNo: 2, componentType: 'BACK_PANEL', name: 'Back Panel', piecesPerBag: 1 },
  { lineNo: 3, componentType: 'GUSSET', name: 'Gusset', piecesPerBag: 1 },
  { lineNo: 4, componentType: 'HANDLE', name: 'Handle', piecesPerBag: 2 },
];

describe('Panels - the cutting count comes from the style', () => {
  test('a tote is five pieces, two of them handles', () => {
    assert.deepEqual(perBag(TOTE), { panelsPerBag: 5, handlesPerBag: 2 });
  });

  test('1,000 bags is 5,000 panels and 2,000 handles, component by component', () => {
    const c = panelCounts(TOTE, 1000);
    assert.equal(c.panels, '5000.0000');
    assert.equal(c.handles, '2000.0000');
    assert.deepEqual(
      c.breakdown.map((b) => [b.name, b.pieces]),
      [['Front Panel', '1000.0000'], ['Back Panel', '1000.0000'], ['Gusset', '1000.0000'], ['Handle', '2000.0000']],
    );
  });

  test('a style with no panel list gives no counts - the typed ones stand', () => {
    assert.equal(perBag([]), null);
    assert.equal(panelCounts(undefined, 100), null);
  });

  test('a bag with no handle panel counts zero handles, not none', () => {
    const pouch = [{ componentType: 'FRONT_PANEL', name: 'Front', piecesPerBag: 2 }];
    assert.deepEqual(perBag(pouch), { panelsPerBag: 2, handlesPerBag: 0 });
  });
});

describe('Cutting - the fabric equation has five terms', () => {
  test('remnants are accounted for, not lost', () => {
    const r = reconcileFabric({
      issuedQty: 100, consumedQty: 80, remainderQty: 10, remnantQty: 4, wastageQty: 5, fabricDamageQty: 1,
    });
    assert.equal(r.balances, true);
    assert.equal(r.remnant, '4.0000');
  });

  test('leaving the remnants out is refused as unaccounted', () => {
    const r = reconcileFabric({ issuedQty: 100, consumedQty: 80, remainderQty: 10, wastageQty: 5, fabricDamageQty: 1 });
    assert.equal(r.balances, false);
    assert.equal(r.unaccountedQty, '4.0000');
  });
});

describe('Cutting - planned vs actual consumption', () => {
  test('efficiency is planned over actual, damaged pieces included in the plan', () => {
    // 95 good + 5 damaged at 0.8 m = 80 m planned; 78 consumed + 2 wastage + 0 damage = 80 m.
    const e = cuttingEfficiency({
      goodPcs: 95, damagedPcs: 5, stdPerPc: '0.8', consumedQty: 78, wastageQty: 2, fabricDamageQty: 0,
    });
    assert.equal(e.planned, '80.0000');
    assert.equal(e.actual, '80.0000');
    assert.equal(e.efficiency, '1.000000');
  });

  test('using more cloth than the style allows reads below 1', () => {
    const e = cuttingEfficiency({ goodPcs: 100, stdPerPc: '0.8', consumedQty: 84, wastageQty: 4, fabricDamageQty: 0 });
    assert.equal(e.planned, '80.0000');
    assert.equal(e.actual, '88.0000');
    assert.equal(e.efficiency, '0.909091');
  });

  test('a style with no standard gives no efficiency - never a made-up 100%', () => {
    const e = cuttingEfficiency({ goodPcs: 100, stdPerPc: '0', consumedQty: 80 });
    assert.equal(e.planned, null);
    assert.equal(e.efficiency, null);
  });
});

const layer = (id, date, qty, rate, extra = {}) => ({
  id, layerDate: new Date(date), createdAt: new Date(date), qtyRemaining: String(qty), rate: String(rate), ...extra,
});

describe('FIFO - the oldest cost goes out first', () => {
  const layers = [layer('b', '2026-09-10', 50, 120), layer('a', '2026-09-01', 100, 100)];

  test('layers are consumed oldest first', () => {
    assert.deepEqual(fifoOrder(layers).map((l) => l.id), ['a', 'b']);
  });

  test('an issue spanning two layers is valued at both of them', () => {
    const p = planConsumption(layers, 120);
    assert.deepEqual(p.slices.map((s) => [s.layerId, s.qty, s.value]), [
      ['a', '100.0000', '10000.00'],
      ['b', '20.0000', '2400.00'],
    ]);
    assert.equal(p.value, '12400.00');
    assert.equal(p.shortfallQty, '0.0000');
  });

  test('an issue larger than the layers reports the shortfall rather than inventing cost', () => {
    const p = planConsumption(layers, 160);
    assert.equal(p.costedQty, '150.0000');
    assert.equal(p.shortfallQty, '10.0000');
  });

  test('a reversal takes its own receipt\'s layer before the oldest', () => {
    const withSource = [layer('a', '2026-09-01', 100, 100, { sourceLedgerId: 'L1' }),
      layer('b', '2026-09-10', 50, 120, { sourceLedgerId: 'L2' })];
    const p = planConsumption(withSource, 50, { prefer: (l) => l.sourceLedgerId === 'L2' });
    assert.deepEqual(p.slices.map((s) => s.layerId), ['b']);
    assert.equal(p.value, '6000.00');
  });

  test('empty layers are skipped', () => {
    const p = planConsumption([layer('x', '2026-08-01', 0, 90), ...layers], 10);
    assert.equal(p.slices[0].layerId, 'a');
  });
});

describe('FIFO - transfers carry cost; what goes back is the newest', () => {
  const consumed = planConsumption(
    [layer('a', '2026-09-01', 100, 100), layer('b', '2026-09-10', 50, 120)],
    120,
  ).slices;

  test('a full transfer keeps each layer\'s date and rate', () => {
    const specs = layersForIn({ qty: 120, rate: 999, entryDate: new Date('2026-09-20'), carry: consumed });
    assert.deepEqual(specs.map((s) => [s.qty, s.rate]), [['100.0000', '100.0000'], ['20.0000', '120.0000']]);
    assert.equal(new Date(specs[0].layerDate).toISOString().slice(0, 10), '2026-09-01');
  });

  test('the remainder back from cutting is the newest cost, then the remnants', () => {
    const [remainder, remnant] = takeNewest(consumed, [15, 10]);
    // 20 of layer b is the newest: 15 goes back as remainder, the last 5 of b
    // and 5 of a go to remnants.
    assert.deepEqual(remainder.map((s) => [s.layerId, s.qty]), [['b', '15.0000']]);
    assert.deepEqual(remnant.map((s) => [s.layerId, s.qty]), [['a', '5.0000'], ['b', '5.0000']]);
    assert.equal(costOf(remainder, 15).rate, '120.0000');
  });

  test('a shrinkage loss is absorbed: fewer metres carry the whole cost', () => {
    const out = planConsumption([layer('a', '2026-09-01', 100, 100)], 100).slices;
    const specs = layersForIn({ qty: 97, rate: 100, entryDate: new Date(), carry: out });
    assert.equal(specs.length, 1);
    assert.equal(specs[0].qty, '97.0000');
    assert.equal(specs[0].rate, '103.0928');
  });

  test('a receipt with nothing carried opens one layer at its own rate', () => {
    const specs = layersForIn({ qty: 50, rate: 88, entryDate: new Date('2026-09-25') });
    assert.deepEqual(specs.map((s) => [s.qty, s.rate]), [['50.0000', '88.0000']]);
  });
});
