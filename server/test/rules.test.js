/**
 * Rule tests for the two calculations Phases 4 and 5 turn on.
 *
 * These need NO database: they drive the exported pure functions directly, so
 * they run in CI and on a laptop with nothing installed but Node.
 *
 *   Phase 4 - a plan may never allot more than the order permits, and what the
 *             order permits is its quantity plus the excess the Director
 *             APPROVED, never the excess that was merely requested.
 *
 *   Phase 5 - Amount is Qty x Rate, computed on the server.
 *
 * The end-to-end HTTP behaviour of these rules is covered in api.test.js, which
 * does need a seeded database.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  allocation,
  totalsFromLines,
  unitAllocation,
  workflowState,
} from '../src/services/planning.service.js';
import { calculateAmount } from '../src/services/vendorQuotation.service.js';

/** An order as the planning service sees it. */
const order = ({ orderQty, excessPct = '0', approvedPct = '0', status = 'NOT_REQUIRED' }) => ({
  orderNo: 'B9641IS',
  orderQty,
  excessPct,
  excessApprovedPct: approvedPct,
  excessApprovalStatus: status,
  // The Phase 3 ceiling: order qty x (1 + APPROVED excess).
  effectiveQty: String(Number(orderQty) * (1 + Number(approvedPct))),
});

describe('Phase 4 - planning may not exceed the permitted order quantity', () => {
  test('a plan that matches the order exactly is permitted', () => {
    const a = allocation(order({ orderQty: '5000' }), '5000');
    assert.equal(a.withinPermitted, true);
    assert.equal(a.matchesOrderQty, true);
    assert.equal(a.usesExcess, false);
    assert.equal(a.remainingQty, '0.0000');
    assert.equal(a.unplannedQty, '0.0000');
  });

  test('an under-planned order is permitted, and reports the shortfall', () => {
    const a = allocation(order({ orderQty: '5000' }), '3000');
    assert.equal(a.withinPermitted, true);
    assert.equal(a.unplannedQty, '2000.0000');
    assert.equal(a.remainingQty, '2000.0000');
  });

  test('one piece over a no-excess order is refused', () => {
    const a = allocation(order({ orderQty: '5000' }), '5001');
    assert.equal(a.withinPermitted, false);
    assert.equal(a.overBy, '1.0000');
  });

  test('a REQUESTED but unapproved excess buys the planner nothing', () => {
    // 2% requested, nothing approved: the ceiling is still the plain 5000.
    const o = order({ orderQty: '5000', excessPct: '0.02', status: 'PENDING' });
    assert.equal(o.effectiveQty, '5000');

    const legal = allocation(o, '5000');
    assert.equal(legal.withinPermitted, true);

    const overreach = allocation(o, '5100');
    assert.equal(overreach.withinPermitted, false, 'a pending excess must not raise the ceiling');
    assert.equal(overreach.overBy, '100.0000');
    assert.equal(overreach.excessApprovalStatus, 'PENDING');
  });

  test('a REJECTED excess leaves the ceiling at the plain order quantity', () => {
    const o = order({ orderQty: '5000', excessPct: '0.02', status: 'REJECTED' });
    const a = allocation(o, '5100');
    assert.equal(a.withinPermitted, false);
    assert.equal(a.excessHeadroomQty, '0.0000');
  });

  test('an APPROVED excess raises the ceiling by exactly what was granted', () => {
    const o = order({
      orderQty: '5000',
      excessPct: '0.02',
      approvedPct: '0.02',
      status: 'APPROVED',
    });
    assert.equal(o.effectiveQty, '5100');

    const atCeiling = allocation(o, '5100');
    assert.equal(atCeiling.withinPermitted, true);
    assert.equal(atCeiling.usesExcess, true);
    assert.equal(atCeiling.excessUsedQty, '100.0000');
    assert.equal(atCeiling.excessHeadroomQty, '100.0000');
    assert.equal(atCeiling.remainingQty, '0.0000');

    const overCeiling = allocation(o, '5101');
    assert.equal(overCeiling.withinPermitted, false);
    assert.equal(overCeiling.overBy, '1.0000');
  });

  test('a partly granted excess caps at what was granted, not what was asked', () => {
    // 5% asked for, 2% granted. The ceiling follows the 2%.
    const o = order({
      orderQty: '5000',
      excessPct: '0.05',
      approvedPct: '0.02',
      status: 'APPROVED',
    });
    assert.equal(allocation(o, '5100').withinPermitted, true);
    assert.equal(allocation(o, '5150').withinPermitted, false, 'the requested 5% must not apply');
  });

  test('totals come from the lines, and only from the lines', () => {
    const lines = [
      { deliverableSize: '2500', cuttingPcsAllotted: '212' },
      { deliverableSize: '2500', cuttingPcsAllotted: '246' },
    ];
    const { plannedQty, plannedCuttingPcs } = totalsFromLines(lines);
    assert.equal(plannedQty.toFixed(4), '5000.0000');
    assert.equal(plannedCuttingPcs.toFixed(4), '458.0000');
  });

  test('a null cutting allotment counts as zero, not as NaN', () => {
    const { plannedQty, plannedCuttingPcs } = totalsFromLines([
      { deliverableSize: '3500', cuttingPcsAllotted: null },
      { deliverableSize: '3500' },
    ]);
    assert.equal(plannedQty.toFixed(4), '7000.0000');
    assert.equal(plannedCuttingPcs.toFixed(4), '0.0000');
  });

  test('fractional quantities do not drift - the maths is decimal, not float', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point.
    const { plannedQty } = totalsFromLines([
      { deliverableSize: '0.1' },
      { deliverableSize: '0.2' },
    ]);
    assert.equal(plannedQty.toFixed(4), '0.3000');

    const a = allocation(order({ orderQty: '0.3' }), plannedQty);
    assert.equal(a.withinPermitted, true);
    assert.equal(a.matchesOrderQty, true, 'decimal arithmetic must make this exact');
  });

  test('unit allocation rolls the grid up per stitching unit', () => {
    const rows = unitAllocation([
      { unit: 'Unit 1 - Anil Kumar', lineDate: '2026-08-12', deliverableSize: '2500', cuttingPcsAllotted: '212', status: 'COMPLETED' },
      { unit: 'Unit 1 - Anil Kumar', lineDate: '2026-08-17', deliverableSize: '2500', cuttingPcsAllotted: '246', status: 'IN_PROGRESS' },
      { unit: 'Unit 2 - Mahipal', lineDate: '2026-08-16', deliverableSize: '3500', cuttingPcsAllotted: null, status: 'PENDING' },
    ]);

    assert.equal(rows.length, 2);
    const [unit1, unit2] = rows;
    assert.equal(unit1.unit, 'Unit 1 - Anil Kumar');
    assert.equal(unit1.lineCount, 2);
    assert.equal(unit1.deliverableSize, '5000.0000');
    assert.equal(unit1.cuttingPcsAllotted, '458.0000');
    assert.equal(unit1.firstDate, '2026-08-12');
    assert.equal(unit1.lastDate, '2026-08-17');
    assert.equal(unit2.deliverableSize, '3500.0000');
  });

  test('an unassigned unit is rolled up rather than dropped', () => {
    const rows = unitAllocation([{ unit: null, lineDate: '2026-08-12', deliverableSize: '100', status: 'PENDING' }]);
    assert.equal(rows[0].unit, '(unassigned)');
    assert.equal(rows[0].deliverableSize, '100.0000');
  });
});

describe('Phase 4 - the workflow state is derived, never stored twice', () => {
  test('pending and never submitted is a draft', () => {
    assert.equal(workflowState({ approvalStatus: 'PENDING', submittedAt: null }), 'DRAFT');
  });
  test('pending and submitted is awaiting a decision', () => {
    assert.equal(workflowState({ approvalStatus: 'PENDING', submittedAt: new Date() }), 'SUBMITTED');
  });
  test('a decision outranks the submission stamp', () => {
    assert.equal(workflowState({ approvalStatus: 'APPROVED', submittedAt: new Date() }), 'APPROVED');
    assert.equal(workflowState({ approvalStatus: 'REJECTED', submittedAt: new Date() }), 'REJECTED');
  });
});

describe('Phase 5 - Amount is Qty x Rate, computed on the server', () => {
  test('the workbook rows reproduce exactly', () => {
    // QT-001: 4500 Mtrs at 178.
    assert.equal(calculateAmount('4500', '178').toFixed(2), '801000.00');
    // QT-003: 9000 Pcs at 12.
    assert.equal(calculateAmount('9000', '12').toFixed(2), '108000.00');
    // QT-007: 20000 Pcs at 3.
    assert.equal(calculateAmount('20000', '3').toFixed(2), '60000.00');
  });

  test('a fractional rate rounds to the stored scale of 2', () => {
    assert.equal(calculateAmount('3', '0.005').toFixed(2), '0.02');
    assert.equal(calculateAmount('100', '12.345').toFixed(2), '1234.50');
  });

  test('the arithmetic is decimal, so money does not drift', () => {
    // 0.1 * 3 === 0.30000000000000004 in binary floating point.
    assert.equal(calculateAmount('3', '0.1').toFixed(2), '0.30');
    assert.equal(calculateAmount('1.1', '1.1').toFixed(2), '1.21');
  });

  test('a zero rate is legal and yields zero', () => {
    assert.equal(calculateAmount('4500', '0').toFixed(2), '0.00');
  });

  test('a large order does not lose precision', () => {
    assert.equal(calculateAmount('1000000', '1234.5678').toFixed(2), '1234567800.00');
  });
});
