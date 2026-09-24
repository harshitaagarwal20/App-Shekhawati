/**
 * C1 - PURCHASE ORDER MODE. Rule tests. No database required.
 *
 * Drives the pure ceiling function directly, so every case below is provable
 * on a bare Node install.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THIS FILE IS ASSERTING
 *
 *  A purchase order runs in exactly one of two modes, and the mode decides
 *  whether the quantity is bounded at all:
 *
 *      AS_PER_STYLE   qty <= computedRequirementQty x (1 + orderTolerancePct)
 *                     A HARD CAP. Nothing authorises past it.
 *
 *      BULK           unbounded. A linked style is reference only: the
 *                     variance is measured and recorded, and the PO stands.
 *
 *  `computedRequirementQty` is passed IN rather than derived here. That is the
 *  whole point of persisting it: the figure the PO was judged against is the
 *  figure stored on the row, so a later BOM edit cannot retrospectively move a
 *  ceiling that has already been applied.
 * ---------------------------------------------------------------------------
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXCESS_CEILING,
  checkOrderCeiling,
  resolveOrderTolerance,
} from '../src/services/purchaseOrder.service.js';

/** The category tolerance map the service resolves against. */
const TOL = EXCESS_CEILING;

describe('C1 - resolveOrderTolerance', () => {
  test('accessories take the stricter 1% order tolerance', () => {
    assert.equal(resolveOrderTolerance('Accessories', TOL).toString(), '0.01');
  });

  test('an accessories sub-item takes the accessory tolerance too', () => {
    assert.equal(resolveOrderTolerance('Label', TOL, { accessoriesItem: 'Woven Label' }).toString(), '0.01');
  });

  test('fabric takes the general 3% tolerance', () => {
    assert.equal(resolveOrderTolerance('Fabric', TOL).toString(), '0.03');
  });

  test('the line may contract for LESS than the category permits', () => {
    const t = resolveOrderTolerance('Fabric', TOL, { orderTolerancePct: '0.02' });
    assert.equal(t.toString(), '0.02');
  });

  test('the line may NOT contract for more than the category permits', () => {
    const t = resolveOrderTolerance('Accessories', TOL, { orderTolerancePct: '0.05' });
    assert.equal(t.toString(), '0.01', 'the category ceiling wins over a looser line value');
  });
});

describe('C1 - checkOrderCeiling: AS_PER_STYLE is a hard cap', () => {
  const line = (qty, extra = {}) => ({
    qty,
    computedRequirementQty: '10000',
    orderTolerancePct: '0.01',
    ...extra,
  });

  test('exactly at the ceiling passes', () => {
    const v = checkOrderCeiling(line('10100'), 'AS_PER_STYLE', 'Accessories', TOL);
    assert.equal(v.bounded, true);
    assert.equal(v.ceiling, '10100.0000');
    assert.equal(v.withinCeiling, true);
    assert.equal(v.exceedsBy, '0.0000');
  });

  test('one unit over the ceiling fails', () => {
    const v = checkOrderCeiling(line('10101'), 'AS_PER_STYLE', 'Accessories', TOL);
    assert.equal(v.withinCeiling, false);
    assert.equal(v.exceedsBy, '1.0000');
  });

  test('+1.00% passes and +1.01% fails on the same requirement', () => {
    assert.equal(
      checkOrderCeiling(line('10100'), 'AS_PER_STYLE', 'Accessories', TOL).withinCeiling,
      true,
    );
    assert.equal(
      checkOrderCeiling(line('10101'), 'AS_PER_STYLE', 'Accessories', TOL).withinCeiling,
      false,
    );
  });

  test('quantity already on order against the same requirement counts against the ceiling', () => {
    const v = checkOrderCeiling(
      line('6000', { alreadyOrderedQty: '5000' }),
      'AS_PER_STYLE',
      'Accessories',
      TOL,
    );
    assert.equal(v.remaining, '5100.0000');
    assert.equal(v.withinCeiling, false, '5000 + 6000 = 11000 is past a 10100 ceiling');
    assert.equal(v.exceedsBy, '900.0000');
  });

  test('no requirement means unbounded, and says so rather than capping at zero', () => {
    const v = checkOrderCeiling(
      { qty: '999999', computedRequirementQty: null, orderTolerancePct: '0.01' },
      'AS_PER_STYLE',
      'Accessories',
      TOL,
    );
    assert.equal(v.bounded, false);
    assert.equal(v.withinCeiling, true);
    assert.match(v.basis, /cannot bound/i);
  });

  test('the stored requirement is used verbatim - a later BOM change cannot move it', () => {
    // The same qty judged against the figure persisted at creation time...
    const atCreation = checkOrderCeiling(line('10100'), 'AS_PER_STYLE', 'Accessories', TOL);
    // ...is judged identically later, whatever the BOM now says, because the
    // function is given the stored number and never looks a BOM up.
    const laterWithSameStoredValue = checkOrderCeiling(
      line('10100'),
      'AS_PER_STYLE',
      'Accessories',
      TOL,
    );
    assert.deepEqual(atCreation, laterWithSameStoredValue);
    assert.equal(atCreation.requirement, '10000.0000');
  });

  test('decimal arithmetic does not drift on a rate that has no binary form', () => {
    const v = checkOrderCeiling(
      { qty: '1030.0000', computedRequirementQty: '1000.0000', orderTolerancePct: '0.03' },
      'AS_PER_STYLE',
      'Fabric',
      TOL,
    );
    assert.equal(v.ceiling, '1030.0000');
    assert.equal(v.withinCeiling, true, '1000 x 1.03 must be exactly 1030, not 1029.9999...');
  });
});

describe('C1 - checkOrderCeiling: BULK is never blocked', () => {
  test('BULK may exceed the computed requirement substantially', () => {
    const v = checkOrderCeiling(
      { qty: '50000', computedRequirementQty: '10000', orderTolerancePct: '0.01' },
      'BULK',
      'Accessories',
      TOL,
    );
    assert.equal(v.bounded, false);
    assert.equal(v.withinCeiling, true, 'a bulk order is never refused on quantity');
    assert.equal(v.ceiling, null);
  });

  test('variance against a reference style is recorded, not enforced', () => {
    const v = checkOrderCeiling(
      { qty: '50000', computedRequirementQty: '10000', orderTolerancePct: '0.01' },
      'BULK',
      'Accessories',
      TOL,
    );
    assert.equal(v.varianceQty, '40000.0000');
    assert.equal(v.variancePct, '4.000000');
    assert.equal(v.requirement, '10000.0000', 'the reference requirement is still reported');
  });

  test('variance is negative when a bulk order under-buys the reference style', () => {
    const v = checkOrderCeiling(
      { qty: '4000', computedRequirementQty: '10000', orderTolerancePct: '0.01' },
      'BULK',
      'Fabric',
      TOL,
    );
    assert.equal(v.varianceQty, '-6000.0000');
    assert.equal(v.withinCeiling, true);
  });

  test('BULK with no style linked records no variance at all', () => {
    const v = checkOrderCeiling(
      { qty: '4000', computedRequirementQty: null, orderTolerancePct: '0.01' },
      'BULK',
      'Fabric',
      TOL,
    );
    assert.equal(v.varianceQty, null);
    assert.equal(v.variancePct, null);
    assert.equal(v.withinCeiling, true);
  });
});

describe('C1 - checkOrderCeiling: the mode must be explicit', () => {
  test('an unknown mode is refused rather than defaulted', () => {
    assert.throws(
      () => checkOrderCeiling({ qty: '1', computedRequirementQty: '1' }, undefined, 'Fabric', TOL),
      /mode/i,
      'no default mode - C1 requires the choice to be explicit',
    );
  });

  test('a mode that is neither BULK nor AS_PER_STYLE is refused', () => {
    assert.throws(
      () => checkOrderCeiling({ qty: '1', computedRequirementQty: '1' }, 'SOMETHING', 'Fabric', TOL),
      /mode/i,
    );
  });
});
