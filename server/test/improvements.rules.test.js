/**
 * Rules added with the Odoo / Zoho gap work - pure functions, no database.
 *
 *   buyer order pricing  calculateLineValue, calculateOrderValue, assertDatesInOrder
 *   shade and dye lot    domain/shade.js
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertDatesInOrder,
  calculateLineValue,
  calculateOrderValue,
} from '../src/services/buyerOrder.service.js';
import {
  acceptedMixReason,
  assessShadeMix,
  normaliseShade,
} from '../src/domain/shade.js';

describe('Buyer order pricing', () => {
  test('a line is valued at ordered pieces x price, rounded to paise', () => {
    assert.equal(calculateLineValue('1200', '3.455').toFixed(2), '4146.00');
    assert.equal(calculateLineValue('3', '0.3333').toFixed(2), '1.00');
  });

  test('an unpriced line has no value, not zero', () => {
    assert.equal(calculateLineValue('100', null), null);
    assert.equal(calculateLineValue('100', ''), null);
    assert.equal(calculateLineValue('100', undefined), null);
  });

  test('a price of zero is a sample, and is a value of zero', () => {
    assert.equal(calculateLineValue('100', '0').toFixed(2), '0.00');
  });

  test('the order value is all or nothing', () => {
    const partial = calculateOrderValue([{ lineValue: '100' }, { lineValue: null }], { currency: 'USD', exchangeRate: '83' });
    assert.deepEqual(partial, { orderValue: null, orderValueInr: null });
    assert.deepEqual(calculateOrderValue([], {}), { orderValue: null, orderValueInr: null });
  });

  test('a foreign order needs a booked rate for its rupee value', () => {
    const v = calculateOrderValue([{ lineValue: '100.50' }, { lineValue: '50' }], { currency: 'USD' });
    assert.equal(v.orderValue.toFixed(2), '150.50');
    assert.equal(v.orderValueInr, null);
    const r = calculateOrderValue([{ lineValue: '150.50' }], { currency: 'USD', exchangeRate: '83.25' });
    assert.equal(r.orderValueInr.toFixed(2), '12529.13');
  });

  test('an INR order is its own rupee value, whatever the rate says', () => {
    const v = calculateOrderValue([{ lineValue: '999' }], { currency: 'inr', exchangeRate: '83' });
    assert.equal(v.orderValueInr.toFixed(2), '999.00');
  });

  test('ex-factory after delivery is refused; on the same day is fine', () => {
    assert.throws(() => assertDatesInOrder('2026-10-10', '2026-10-01'), /ex-factory/i);
    assert.doesNotThrow(() => assertDatesInOrder('2026-10-01', '2026-10-01'));
    assert.doesNotThrow(() => assertDatesInOrder(null, '2026-10-01'));
    assert.doesNotThrow(() => assertDatesInOrder('2026-10-01', null));
  });
});

describe('Shade and dye lot - one bag, one shade', () => {
  const first = { issueNo: 'FI-1', rollNo: 'FAB-1', shade: 'A', dyeLot: 'L-77' };

  test('shades compare case- and space-insensitively', () => {
    assert.equal(normaliseShade('  a  '), 'A');
    assert.equal(normaliseShade('lot  12'), 'LOT 12');
    assert.equal(normaliseShade(''), null);
    assert.equal(normaliseShade(null), null);
  });

  test('the first roll on a line is always accepted', () => {
    assert.equal(assessShadeMix({ rollNo: 'FAB-9', shade: 'Z' }, []).ok, true);
  });

  test('a matching roll passes', () => {
    const v = assessShadeMix({ rollNo: 'FAB-2', shade: 'a', dyeLot: 'l-77' }, [first]);
    assert.equal(v.ok, true);
  });

  test('a different shade is a mix', () => {
    const v = assessShadeMix({ rollNo: 'FAB-2', shade: 'B', dyeLot: 'L-77' }, [first]);
    assert.equal(v.ok, false);
    assert.deepEqual(v.conflicts, ['shade']);
    assert.match(v.message, /FAB-1/);
  });

  test('a different lot is a mix even at the same shade', () => {
    const v = assessShadeMix({ rollNo: 'FAB-2', shade: 'A', dyeLot: 'L-78' }, [first]);
    assert.deepEqual(v.conflicts, ['dyeLot']);
  });

  test('an ungraded roll on a graded line is a mix - unknown is not a match', () => {
    const v = assessShadeMix({ rollNo: 'FAB-2' }, [first]);
    assert.deepEqual(v.conflicts, ['shade', 'dyeLot']);
  });

  test('ungraded against ungraded is not a mix', () => {
    assert.equal(assessShadeMix({ rollNo: 'FAB-2' }, [{ rollNo: 'FAB-1' }]).ok, true);
  });

  test('the FIRST issue fixes the line, not a later mixed one', () => {
    const later = { issueNo: 'FI-2', rollNo: 'FAB-5', shade: 'B', dyeLot: 'L-77' };
    assert.equal(assessShadeMix({ shade: 'B', dyeLot: 'L-77' }, [first, later]).ok, false);
    assert.equal(assessShadeMix({ shade: 'A', dyeLot: 'L-77' }, [first, later]).ok, true);
  });

  test('a mix needs a real reason', () => {
    assert.equal(acceptedMixReason(''), null);
    assert.equal(acceptedMixReason('ok'), null);
    assert.equal(acceptedMixReason('   short    '), null);
    assert.equal(acceptedMixReason('Buyer accepted A/B spread on email 12-09'), 'Buyer accepted A/B spread on email 12-09');
  });
});

// ---------------------------------------------------------------------------
//  Notifications - who hears about an approval event
// ---------------------------------------------------------------------------

import {
  describeApprovalEvent,
  linkFor,
  recipientsForApprovalEvent,
} from '../src/services/notification.service.js';
import { afterCommit, runCommitHooks, withCommitHooks } from '../src/config/auditContext.js';

describe('Notifications - approval events', () => {
  test('a document submitted for a decision goes to whoever can approve it', () => {
    const r = recipientsForApprovalEvent({ action: 'SUBMITTED', toStatus: 'PENDING', documentType: 'PURCHASE_ORDER' });
    assert.deepEqual(r, { kind: 'APPROVAL_REQUESTED', audience: 'approvers', permission: 'PURCHASE_ORDER.APPROVE' });
  });

  test('a status change logged as SUBMITTED but not awaiting anyone tells nobody', () => {
    assert.equal(recipientsForApprovalEvent({ action: 'SUBMITTED', toStatus: 'IN_PROGRESS', documentType: 'BUYER_ORDER' }), null);
  });

  test('decisions go back to whoever raised the document', () => {
    for (const action of ['APPROVED', 'REJECTED', 'CANCELLED', 'REWORK_REQUESTED']) {
      assert.equal(recipientsForApprovalEvent({ action, documentType: 'GRN' }).audience, 'creator');
    }
  });

  test('amendments and postings are not news to anybody', () => {
    assert.equal(recipientsForApprovalEvent({ action: 'AMENDED', documentType: 'BUYER_ORDER' }), null);
    assert.equal(recipientsForApprovalEvent({ action: 'POSTED', documentType: 'GRN' }), null);
  });

  test('a rejection carries its reason', () => {
    const d = describeApprovalEvent(
      { documentType: 'VENDOR_QUOTATION', documentNo: 'QT-044', actedByName: 'Dinesh Sir', remarks: 'Rate too high' },
      'REJECTED',
    );
    assert.equal(d.title, 'Quotation QT-044 was rejected by Dinesh Sir');
    assert.equal(d.body, 'Reason: Rate too high');
  });

  test('links open the document screen', () => {
    assert.equal(linkFor('PURCHASE_ORDER', 'abc'), '/purchase-orders/abc');
    assert.equal(linkFor('NOT_A_TYPE', 'abc'), null);
  });
});

describe('After-commit hooks', () => {
  test('work queued inside a transaction waits for the commit', async () => {
    const seen = [];
    const hooks = withCommitHooks(async () => {
      afterCommit(() => seen.push('sent'));
      assert.deepEqual(seen, [], 'nothing runs before the commit');
    });
    await hooks.run;
    runCommitHooks(hooks.queue);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(seen, ['sent']);
  });

  test('a rolled-back transaction drops its queue', async () => {
    const seen = [];
    const hooks = withCommitHooks(async () => {
      afterCommit(() => seen.push('sent'));
      throw new Error('rollback');
    });
    await assert.rejects(hooks.run);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(seen, []);
  });
});

// ---------------------------------------------------------------------------
//  FOB costing
// ---------------------------------------------------------------------------

import { costLine, costSheet, marginAtPrice } from '../src/domain/costing.js';

describe('FOB costing', () => {
  const header = {
    cmtCost: '20', printCost: '5', dyeWashCost: '0', otherCost: '0',
    overheadPct: '0.10', rejectionPct: '0.02', commissionPct: '0.03', marginPct: '0.12',
    exchangeRate: '83',
  };
  const lines = [
    { consumption: '0.8', wastagePct: '0.05', rate: '150' }, // canvas: 0.84 m x 150 = 126
    { consumption: '1', wastagePct: '0', rate: '9' },         // zipper
  ];

  test('a line is consumption x (1 + wastage) x rate', () => {
    const l = costLine(lines[0]);
    assert.equal(l.grossConsumption.toFixed(6), '0.840000');
    assert.equal(l.amount.toFixed(4), '126.0000');
  });

  test('the sheet builds from material to FOB, margin on the SELLING price', () => {
    const s = costSheet(header, lines);
    assert.equal(s.materialCost.toFixed(4), '135.0000');
    assert.equal(s.conversionCost.toFixed(4), '25.0000');
    assert.equal(s.overheadAmount.toFixed(4), '16.0000');     // 160 x 10%
    assert.equal(s.rejectionAmount.toFixed(4), '3.5200');     // 176 x 2%
    assert.equal(s.totalCost.toFixed(4), '179.5200');
    assert.equal(s.fobInr.toFixed(4), '211.2000');            // 179.52 / 0.85
    assert.equal(s.fobPrice.toFixed(4), '2.5446');            // / 83
    // margin is 12% of the price, not of the cost
    assert.equal(s.marginAmount.toFixed(4), '25.3440');
  });

  test('an unpriced material leaves the sheet incomplete, never cheaper', () => {
    const s = costSheet(header, [lines[0], { consumption: '1', wastagePct: '0', rate: null }]);
    assert.equal(s.complete, false);
    assert.equal(s.unpricedLines, 1);
    assert.equal(s.totalCost, null);
    assert.equal(s.fobPrice, null);
  });

  test('margin plus commission of 100% or more is refused', () => {
    assert.throws(() => costSheet({ ...header, marginPct: '0.9', commissionPct: '0.1' }, lines), /less than 100%/);
  });

  test('the margin a buyer target earns - negative when below cost', () => {
    const s = costSheet({ ...header, targetPrice: '2.00' }, lines);
    // 166 INR - 179.52 cost - 4.98 commission = -18.50 on 166
    assert.equal(s.marginAtTarget.toFixed(4), '-0.1114');
  });

  test('an order margin at its agreed price', () => {
    const m = marginAtPrice({ unitPrice: '2.60', exchangeRate: '83', totalCost: '179.52', commissionPct: '0.03' });
    assert.equal(m.priceInr.toFixed(4), '215.8000');
    assert.equal(m.marginPct.toFixed(4), '0.1381');
    assert.equal(marginAtPrice({ unitPrice: null, exchangeRate: '83', totalCost: '1', commissionPct: '0' }), null);
  });
});

// ---------------------------------------------------------------------------
//  Multi-line documents
// ---------------------------------------------------------------------------

import { documentStatus, duplicateMaterial, lineNumber } from '../src/domain/documentLines.js';

describe('Multi-line documents', () => {
  test('line 1 keeps the document number; later lines are suffixed', () => {
    assert.equal(lineNumber('RF-012', 1), 'RF-012');
    assert.equal(lineNumber('RF-012', 2), 'RF-012/2');
    assert.equal(lineNumber('GRN-0100', 12), 'GRN-0100/12');
  });

  test('a line number must be a positive whole number', () => {
    assert.throws(() => lineNumber('RF-012', 0));
    assert.throws(() => lineNumber('RF-012', 1.5));
    assert.throws(() => lineNumber('', 1));
  });

  test('the same material twice on one document is caught', () => {
    const lines = [{ item: 'Fabric', sub: '10 oz' }, { item: 'Zipper' }, { item: 'Fabric', sub: '10 oz' }];
    assert.deepEqual(duplicateMaterial(lines, (l) => `${l.item}|${l.sub ?? ''}`), { first: 0, second: 2, key: 'Fabric|10 oz' });
    assert.equal(duplicateMaterial(lines.slice(0, 2), (l) => l.item), null);
  });

  test('a document is as far along as its least-advanced live line', () => {
    assert.equal(documentStatus([{ status: 'PENDING' }, { status: 'PENDING' }]), 'PENDING');
    assert.equal(documentStatus([{ status: 'APPROVED' }, { status: 'PENDING' }]), 'PARTLY_APPROVED');
    assert.equal(documentStatus([{ status: 'APPROVED' }, { status: 'REJECTED' }]), 'APPROVED');
    assert.equal(documentStatus([{ status: 'REJECTED' }, { status: 'REJECTED' }]), 'REJECTED');
    assert.equal(documentStatus([]), 'EMPTY');
  });
});
