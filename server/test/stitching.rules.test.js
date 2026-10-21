/**
 * Production Phase 2 - the stitching arithmetic and the unit rule.
 * No database: drives domain/stitching.js directly.
 *
 *      node --test test/stitching.rules.test.js
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  belowTarget,
  buildGrid,
  printingStatusOf,
  remainingOf,
  stitchCeiling,
  unitPosition,
  unitScopeFor,
} from '../src/domain/stitching.js';

const UNITS = ['Unit 1 - Anil Kumar', 'Unit 2 - Mahipal'];

describe('Remaining = Deliverable - Actual', () => {
  test('the ordinary day', () => {
    assert.equal(remainingOf('500', '420').toString(), '80');
  });

  test('the workbook sample row does not satisfy it, and the system does not copy it', () => {
    // Sheet: Deliverable 10,000 / Actual 900 / Remaining 100.
    assert.notEqual(remainingOf('10000', '900').toString(), '100');
    assert.equal(remainingOf('10000', '900').toString(), '9100');
  });

  test('ahead of target is negative, not clamped', () => {
    assert.equal(remainingOf('100', '130').toString(), '-30');
  });

  test('decimal, not float', () => {
    assert.equal(remainingOf('0.3', '0.1').toString(), '0.2');
  });
});

describe('the ceiling: never more stitched than was cut for the unit', () => {
  test('within it', () => {
    const c = stitchCeiling({ issued: '5000', stitchedOthers: '4000', actual: '1000' });
    assert.equal(c.ok, true);
    assert.equal(c.maxForThisRecord.toString(), '1000');
  });

  test('one over is refused, and the excess is named', () => {
    const c = stitchCeiling({ issued: '5000', stitchedOthers: '4000', actual: '1001' });
    assert.equal(c.ok, false);
    assert.equal(c.excess.toString(), '1');
  });

  test('nothing issued, nothing may be stitched', () => {
    const c = stitchCeiling({ issued: '0', stitchedOthers: '0', actual: '1' });
    assert.equal(c.ok, false);
    assert.equal(c.maxForThisRecord.toString(), '0');
  });

  test('the most an entry may carry never goes below zero', () => {
    const c = stitchCeiling({ issued: '100', stitchedOthers: '120', actual: '0' });
    assert.equal(c.maxForThisRecord.toString(), '0');
  });

  test('position: issued, stitched, balance', () => {
    assert.deepEqual(unitPosition({ issued: '5000', stitched: '1200' }), {
      pcsIssued: '5000',
      pcsStitched: '1200',
      pcsBalance: '3800',
    });
  });
});

describe('which unit a login works for', () => {
  test('a supervisor is held to the unit on their employee record', () => {
    assert.deepEqual(unitScopeFor({ isAdmin: false, employeeUnit: UNITS[0], units: UNITS }), {
      fixedUnit: UNITS[0],
      canChoose: false,
      canWrite: true,
    });
  });

  test('Admin chooses, even with an employee in a unit', () => {
    const s = unitScopeFor({ isAdmin: true, employeeUnit: UNITS[0], units: UNITS });
    assert.equal(s.fixedUnit, null);
    assert.equal(s.canChoose, true);
    assert.equal(s.canWrite, true);
  });

  test('an office login reads every unit and records for none', () => {
    const s = unitScopeFor({ isAdmin: false, employeeUnit: 'Head Office', units: UNITS });
    assert.deepEqual(s, { fixedUnit: null, canChoose: true, canWrite: false });
  });

  test('a unit no longer on the list is no unit at all', () => {
    const s = unitScopeFor({ isAdmin: false, employeeUnit: 'Unit 9 - Closed', units: UNITS });
    assert.equal(s.canWrite, false);
  });
});

describe('the hourly grid', () => {
  const slots = ['10:00', '11:00', '12:00'];
  const tailors = [
    { id: 'a', empId: 'EMP-012', empName: 'Kamla' },
    { id: 'b', empId: 'EMP-013', empName: 'Salim' },
  ];

  test('a half-filled day totals by tailor, by slot and overall', () => {
    const g = buildGrid({
      slots,
      tailors,
      target: '20',
      entries: [
        { employeeId: 'a', slot: '10:00', pcs: '22' },
        { employeeId: 'a', slot: '11:00', pcs: '18' },
        { employeeId: 'b', slot: '10:00', pcs: '25' },
      ],
    });
    assert.equal(g.rows[0].total, '40');
    assert.equal(g.rows[1].total, '25');
    assert.deepEqual(g.slotTotals, { '10:00': '47', '11:00': '18', '12:00': '0' });
    assert.equal(g.total, '65');
    assert.equal(g.rows[0].cells['11:00'].short, true);
    assert.equal(g.rows[0].cells['10:00'].short, false);
    assert.equal(g.rows[0].cells['12:00'], undefined, 'an empty slot is empty, not zero');
  });

  test('a tailor with no counts yet still has a row', () => {
    const g = buildGrid({ slots, tailors, entries: [] });
    assert.equal(g.rows.length, 2);
    assert.equal(g.total, '0');
  });

  test('a count from a tailor no longer on the roster is kept, not dropped', () => {
    const g = buildGrid({
      slots,
      tailors,
      extraTailors: [{ id: 'z', empId: 'EMP-099', empName: 'Moved' }],
      entries: [{ employeeId: 'z', slot: '10:00', pcs: '9' }],
    });
    assert.equal(g.rows.length, 3);
    assert.equal(g.rows[2].offRoster, true);
    assert.equal(g.total, '9');
  });

  test('a count in a slot since retired is kept as its own column', () => {
    const g = buildGrid({ slots, tailors, entries: [{ employeeId: 'a', slot: '9:00', pcs: '5' }] });
    assert.ok(g.slots.includes('9:00'));
    assert.equal(g.total, '5');
  });

  test('a cell is judged against the target it was saved under', () => {
    const g = buildGrid({
      slots,
      tailors,
      target: '30',
      entries: [{ employeeId: 'a', slot: '10:00', pcs: '22', hourlyTarget: '20' }],
    });
    assert.equal(g.rows[0].cells['10:00'].short, false);
  });

  test('no target, no red', () => {
    assert.equal(belowTarget('1', null), false);
    assert.equal(belowTarget('1', '0'), false);
    assert.equal(belowTarget('19', '20'), true);
    assert.equal(belowTarget('20', '20'), false);
  });
});

describe('printing after stitching', () => {
  test('status follows from the two counts', () => {
    assert.equal(printingStatusOf('100', '0'), 'PENDING');
    assert.equal(printingStatusOf('100', '40'), 'IN_PROGRESS');
    assert.equal(printingStatusOf('100', '100'), 'COMPLETED');
  });
});
