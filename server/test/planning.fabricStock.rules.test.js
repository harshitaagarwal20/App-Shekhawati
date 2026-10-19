/**
 * Fabric on hand on the Planning form.
 *
 * The planning flow starts with "assessment of fabric and raw material
 * availability". The figures the panel shows are summed by three pure
 * functions in planning.service.js, asserted here without a database:
 *
 *   1. A roll is this style's when its GRN's PO line names this order and
 *      this style (or no style). Its balance lands in one of three buckets -
 *      available to issue, on hold, or in process at a job worker / cutting
 *      floor - and never in two.
 *   2. Fabric in the line's colour bought for anything else is offered as a
 *      substitute only when it could be issued today.
 *   3. A cutting plan is short by exactly what it draws beyond the cloth
 *      available to issue, and never by a negative amount.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  fabricCover,
  rollStockBucket,
  summariseFabricStock,
  summarisePendingFabric,
} from '../src/services/planning.service.js';

const ORDER = 'order-1';
const STYLE = 'style-1';
const subject = { orderId: ORDER, styleId: STYLE, colorCode: 'Navy', uom: 'Mtrs' };

const roll = (over = {}) => ({
  balanceQty: '100',
  uom: 'Mtrs',
  colorCode: 'Navy',
  location: 'MAIN STORE',
  isHeld: false,
  grn: { purchaseOrder: { orderId: ORDER, styleId: STYLE } },
  ...over,
});

describe('which bucket a roll is in', () => {
  test('a roll in the main store is available to issue', () => {
    assert.equal(rollStockBucket(roll()), 'available');
  });

  test('a roll with no location is in the main store', () => {
    assert.equal(rollStockBucket(roll({ location: null })), 'available');
  });

  test('a roll at the dyer or on the cutting floor is in process', () => {
    assert.equal(rollStockBucket(roll({ location: 'AT DYEING VENDOR' })), 'inProcess');
    assert.equal(rollStockBucket(roll({ location: 'CUTTING FLOOR' })), 'inProcess');
  });

  test('in process wins over held', () => {
    assert.equal(rollStockBucket(roll({ location: 'AT DYEING VENDOR', isHeld: true })), 'inProcess');
    assert.equal(rollStockBucket(roll({ isHeld: true })), 'held');
  });

  test('remnant store is issuable', () => {
    assert.equal(rollStockBucket(roll({ location: 'REMNANT STORE' })), 'available');
  });
});

describe('summing this style\'s rolls', () => {
  test('each roll counts once, in its own bucket', () => {
    const s = summariseFabricStock(
      [
        roll({ balanceQty: '120' }),
        roll({ balanceQty: '30', isHeld: true }),
        roll({ balanceQty: '50', location: 'AT DYEING VENDOR' }),
      ],
      subject,
    );
    assert.equal(s.forThisStyle.availableQty, '120.0000');
    assert.equal(s.forThisStyle.heldQty, '30.0000');
    assert.equal(s.forThisStyle.inProcessQty, '50.0000');
    assert.equal(s.forThisStyle.rollCount, 3);
  });

  test('a PO line naming no style still counts for the order', () => {
    const s = summariseFabricStock(
      [roll({ grn: { purchaseOrder: { orderId: ORDER, styleId: null } } })],
      subject,
    );
    assert.equal(s.forThisStyle.availableQty, '100.0000');
  });

  test('another style on the same order does not count', () => {
    const s = summariseFabricStock(
      [roll({ grn: { purchaseOrder: { orderId: ORDER, styleId: 'style-2' } } })],
      subject,
    );
    assert.equal(s.forThisStyle.rollCount, 0);
  });

  test('greige cloth bought for the style is counted, broken down by colour', () => {
    // Bought undyed for this style: hiding it would hide the fabric on its way to Navy.
    const s = summariseFabricStock(
      [roll({ balanceQty: '80' }), roll({ balanceQty: '40', colorCode: 'Greige', location: 'AT DYEING VENDOR' })],
      subject,
    );
    assert.deepEqual(
      s.forThisStyle.byColour.map((c) => [c.colorCode, c.availableQty, c.inProcessQty]),
      [['Greige', '0.0000', '40.0000'], ['Navy', '80.0000', '0.0000']],
    );
  });

  test('a roll in another unit is counted aside, never added', () => {
    const s = summariseFabricStock([roll(), roll({ uom: 'Kgs' })], subject);
    assert.equal(s.forThisStyle.availableQty, '100.0000');
    assert.equal(s.otherUnitRollCount, 1);
  });

  test('unit and colour compare without case or stray spaces', () => {
    const s = summariseFabricStock([roll({ uom: ' mtrs ' })], subject);
    assert.equal(s.forThisStyle.availableQty, '100.0000');
  });
});

describe('the same colour, bought for something else', () => {
  const otherOrder = { grn: { purchaseOrder: { orderId: 'order-2', styleId: 'style-9' } } };

  test('issuable stock in the line colour is offered as a substitute', () => {
    const s = summariseFabricStock(
      [roll({ ...otherOrder, balanceQty: '60' }), roll({ grn: null, balanceQty: '15', colorCode: 'NAVY' })],
      subject,
    );
    assert.deepEqual(s.elsewhereInColour, { availableQty: '75.0000', rollCount: 2 });
    assert.equal(s.forThisStyle.rollCount, 0);
  });

  test('stock at a dyer for another order is not a substitute', () => {
    const s = summariseFabricStock(
      [roll({ ...otherOrder, location: 'AT DYEING VENDOR' }), roll({ ...otherOrder, isHeld: true })],
      subject,
    );
    assert.equal(s.elsewhereInColour.availableQty, '0.0000');
  });

  test('a line with no colour has nothing to match', () => {
    const s = summariseFabricStock([roll(otherOrder)], { ...subject, colorCode: null });
    assert.equal(s.elsewhereInColour, null);
  });
});

describe('still to arrive', () => {
  test('sums what each open PO has yet to deliver', () => {
    const p = summarisePendingFabric(
      [
        { orderQty: '500', receivedQty: '200', uom: 'Mtrs', approvalStatus: 'APPROVED' },
        { orderQty: '100', receivedQty: '0', uom: 'Mtrs', approvalStatus: 'PENDING' },
      ],
      'Mtrs',
    );
    assert.deepEqual(p, { pendingQty: '400.0000', poCount: 2, awaitingApprovalCount: 1 });
  });

  test('an over-delivered PO is not negative pending', () => {
    const p = summarisePendingFabric(
      [
        { orderQty: '100', receivedQty: '130', uom: 'Mtrs', approvalStatus: 'APPROVED' },
        { orderQty: '50', receivedQty: '0', uom: 'Mtrs', approvalStatus: 'APPROVED' },
      ],
      'Mtrs',
    );
    assert.equal(p.pendingQty, '50.0000');
    assert.equal(p.poCount, 1);
  });

  test('a PO in another unit is left out', () => {
    const p = summarisePendingFabric(
      [{ orderQty: '100', receivedQty: '0', uom: 'Kgs', approvalStatus: 'APPROVED' }],
      'Mtrs',
    );
    assert.equal(p.poCount, 0);
  });
});

describe('does the store cover a cutting plan', () => {
  const stock = (available) => ({ uom: 'Mtrs', forThisStyle: { availableQty: available } });

  test('short by what the plan draws beyond what can be issued', () => {
    assert.deepEqual(fabricCover('875.5', stock('600')), {
      neededQty: '875.5000',
      availableQty: '600.0000',
      shortQty: '275.5000',
      covered: false,
      uom: 'Mtrs',
    });
  });

  test('exactly enough is covered, and never short by a negative amount', () => {
    assert.equal(fabricCover('600', stock('600')).covered, true);
    const more = fabricCover('100', stock('600'));
    assert.equal(more.covered, true);
    assert.equal(more.shortQty, '0.0000');
  });
});
