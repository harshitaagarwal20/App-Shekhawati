/**
 * Ironing - the arithmetic. No database: drives domain/ironing.js directly.
 *
 *      node --test test/ironing.rules.test.js
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateReceipts,
  availableToReceive,
  balanceAtIroning,
  damageFraction,
  entryProblems,
  pctText,
  undecidedOf,
} from '../src/domain/ironing.js';

describe('the two lines every write must keep', () => {
  test('still at the unit = stitched - out for printing - received at ironing', () => {
    assert.equal(availableToReceive({ stitched: '2600', outForPrinting: '200', receivedAtIroning: '2400' }).toString(), '0');
    assert.equal(availableToReceive({ stitched: '2600', outForPrinting: '200', receivedAtIroning: '2401' }).toString(), '-1');
  });

  test('balance = received - ironed - damaged + re-ironed', () => {
    assert.equal(balanceAtIroning({ received: '2400', ironed: '2300', damaged: '50', reIroned: '0' }).toString(), '50');
    assert.equal(balanceAtIroning({ received: '2400', ironed: '2300', damaged: '50', reIroned: '30' }).toString(), '80');
  });

  test('rejected pieces do not come back', () => {
    // 50 damaged, 20 rejected, 30 re-ironed and then ironed: nothing left.
    assert.equal(balanceAtIroning({ received: '100', ironed: '80', damaged: '50', reIroned: '30' }).toString(), '0');
  });

  test('undecided = damaged - re-iron - rejected', () => {
    assert.equal(undecidedOf({ damaged: '50', reIroned: '30', rejected: '15' }).toString(), '5');
  });
});

describe('damage %', () => {
  test('damaged over everything that went under the iron', () => {
    assert.equal(pctText(damageFraction('2300', '50')), '2.1%');
    assert.equal(pctText(damageFraction('0', '10')), '100.0%');
  });

  test('nothing ironed, no percentage', () => {
    assert.equal(damageFraction('0', '0'), null);
    assert.equal(pctText(null), '-');
  });
});

describe('what one entry must say', () => {
  const base = { pcsReceived: '0', pcsIroned: '0', pcsDamaged: '0', pcsReIroned: '0', pcsRejected: '0' };

  test('a delivery alone is fine without an ironer', () => {
    assert.deepEqual(entryProblems({ ...base, pcsReceived: '100' }), []);
  });

  test('an empty entry is not an entry', () => {
    assert.equal(entryProblems(base)[0].field, 'pcsReceived');
  });

  test('ironing needs the ironer', () => {
    assert.equal(entryProblems({ ...base, pcsIroned: '5' })[0].field, 'ironerId');
  });

  test('damage needs its type', () => {
    const p = entryProblems({ ...base, pcsDamaged: '5', ironerId: 'x' });
    assert.deepEqual(p.map((x) => x.field), ['damageType']);
  });

  test('a damaged piece is decided once', () => {
    const p = entryProblems({ ...base, pcsDamaged: '5', damageType: 'Iron Shine', ironerId: 'x', pcsReIroned: '3', pcsRejected: '3' });
    assert.deepEqual(p.map((x) => x.field), ['pcsRejected']);
  });
});

describe('closing the unit\'s cutting challans, oldest first', () => {
  const challans = [{ id: 'a', pcsIssued: '2500' }, { id: 'b', pcsIssued: '2500' }];
  const status = (rows) => rows.map((r) => `${r.id}:${r.received}:${r.status}`);

  test('nothing received', () => {
    assert.deepEqual(status(allocateReceipts(challans, '0')), ['a:0:NOT_RECEIVED', 'b:0:NOT_RECEIVED']);
  });

  test('part of the first', () => {
    assert.deepEqual(status(allocateReceipts(challans, '2400')), ['a:2400:PARTIALLY_RECEIVED', 'b:0:NOT_RECEIVED']);
  });

  test('the first closed, the second opened', () => {
    assert.deepEqual(status(allocateReceipts(challans, '2600')), ['a:2500:CLOSED', 'b:100:PARTIALLY_RECEIVED']);
  });

  test('both closed', () => {
    assert.deepEqual(status(allocateReceipts(challans, '5000')), ['a:2500:CLOSED', 'b:2500:CLOSED']);
  });

  test('no piece is ever dropped', () => {
    const rows = allocateReceipts(challans, '5100');
    assert.equal(rows.reduce((a, r) => a + Number(r.received), 0), 5100);
  });
});
