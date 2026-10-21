/**
 * Inline QC - the field rules, with no database.
 *
 *      node --test test/inlineQc.rules.test.js
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  diffDefects,
  entryProblems,
  mayResolve,
  normaliseDefects,
  rejectionPct,
  sizeFieldsFor,
} from '../src/domain/inlineQc.js';
import { buildPermissions, roles } from '../prisma/seed/data/rbac.js';
import { masterLists } from '../prisma/seed/data/masterLists.js';

const fieldsOf = (e) => entryProblems(e).map((p) => p.field);

const size = { checkType: 'SIZE', operation: 'Handle Attach', sizeMeasurement: 'Free Size', pcsChecked: '200', pcsRejected: '4', defects: ['Handle Size'], informToUserId: 'u1' };
const workmanship = { checkType: 'WORKMANSHIP', pcsChecked: '24', pcsRejected: '2', defects: ['Handle Out'], informToUserId: 'u1' };

describe('Inline QC - one screen, two check types', () => {
  test('the workbook sample rows are valid', () => {
    assert.deepEqual(entryProblems(size), []);
    assert.deepEqual(entryProblems(workmanship), []);
  });

  test('a Size check needs the operation and the size measured', () => {
    assert.deepEqual(fieldsOf({ ...size, operation: '' }), ['operation']);
    assert.deepEqual(fieldsOf({ ...size, sizeMeasurement: '  ' }), ['sizeMeasurement']);
  });

  test('a Workmanship check asks for neither, and keeps neither', () => {
    assert.deepEqual(entryProblems({ ...workmanship, operation: null }), []);
    assert.deepEqual(sizeFieldsFor('WORKMANSHIP', { operation: 'Hemming', sizeMeasurement: 'L' }), { operation: null, sizeMeasurement: null });
    assert.deepEqual(sizeFieldsFor('SIZE', { operation: ' Hemming ', sizeMeasurement: 'L' }), { operation: 'Hemming', sizeMeasurement: 'L' });
  });

  test('an unknown check type is refused', () => {
    assert.ok(fieldsOf({ ...workmanship, checkType: 'FINAL' }).includes('checkType'));
  });
});

describe('Inline QC - Pcs Checked and Pcs Rejected', () => {
  test('something must be checked', () => {
    assert.ok(fieldsOf({ ...workmanship, pcsChecked: '0' }).includes('pcsChecked'));
  });

  test('no more rejected than checked; all of them is allowed', () => {
    assert.deepEqual(fieldsOf({ ...workmanship, pcsRejected: '25' }), ['pcsRejected']);
    assert.deepEqual(entryProblems({ ...workmanship, pcsRejected: '24' }), []);
  });

  test('rejection % of checked', () => {
    assert.equal(rejectionPct('200', '4'), '2.0%');
    assert.equal(rejectionPct('24', '0'), '0.0%');
    assert.equal(rejectionPct('0', '0'), '-');
  });
});

describe('Inline QC - defects and Inform To', () => {
  test('rejected pieces need a defect', () => {
    assert.deepEqual(fieldsOf({ ...workmanship, defects: [] }), ['defects']);
  });

  test('a defect needs someone to inform', () => {
    assert.deepEqual(fieldsOf({ ...workmanship, informToUserId: '' }), ['informToUserId']);
  });

  test('a clean check needs neither', () => {
    assert.deepEqual(entryProblems({ checkType: 'WORKMANSHIP', pcsChecked: '30', pcsRejected: '0', defects: [] }), []);
  });

  test('a defect may be noted with nothing rejected - it still goes to Inform To', () => {
    assert.deepEqual(entryProblems({ ...workmanship, pcsRejected: '0' }), []);
  });

  test('defects are trimmed, blanks dropped, repeats kept once', () => {
    assert.deepEqual(normaliseDefects([' Stain', 'stain', '', null, 'Torn']), ['Stain', 'Torn']);
  });

  test('an edit adds, keeps (with its status) and drops by name', () => {
    const existing = [
      { id: 'a', defect: 'Stain', status: 'RESOLVED' },
      { id: 'b', defect: 'Torn', status: 'OPEN' },
    ];
    const d = diffDefects(existing, ['stain', 'Handle Out']);
    assert.deepEqual(d.add, ['Handle Out']);
    assert.deepEqual(d.keep.map((x) => [x.id, x.status]), [['a', 'RESOLVED']]);
    assert.deepEqual(d.drop.map((x) => x.id), ['b']);
  });
});

describe('Inline QC - who marks a defect Resolved', () => {
  const entry = { informToUserId: 'sup' };
  test('the person named in Inform To, holding RESOLVE', () => {
    assert.equal(mayResolve({ userId: 'sup', canResolve: true }, entry), true);
  });
  test('not if they no longer hold RESOLVE', () => {
    assert.equal(mayResolve({ userId: 'sup', canResolve: false }, entry), false);
  });
  test('not another supervisor, and not the checker', () => {
    assert.equal(mayResolve({ userId: 'other', canResolve: true }, entry), false);
    assert.equal(mayResolve({ userId: 'checker', canResolve: false }, entry), false);
  });
  test('Admin always, so nothing is stranded', () => {
    assert.equal(mayResolve({ userId: 'admin', isAdmin: true }, { informToUserId: null }), true);
  });
});

describe('Inline QC - roles and lists', () => {
  const codes = new Set(buildPermissions().map((p) => p.code));
  const role = (code) => roles.find((r) => r.code === code).permissions;

  test('the module has the five actions and RESOLVE, and no APPROVE', () => {
    for (const a of ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT', 'RESOLVE']) assert.ok(codes.has(`INLINE_QC.${a}`), a);
    assert.ok(!codes.has('INLINE_QC.APPROVE'));
    // RESOLVE is the one module-specific action.
    assert.deepEqual([...codes].filter((c) => c.endsWith('.RESOLVE')), ['INLINE_QC.RESOLVE']);
  });

  test('QC Dept (Checker) records checks; it cannot delete, or be informed', () => {
    const qc = role('QC');
    for (const a of ['VIEW', 'CREATE', 'EDIT', 'EXPORT']) assert.ok(qc.includes(`INLINE_QC.${a}`), a);
    assert.ok(!qc.includes('INLINE_QC.DELETE'));
    assert.ok(!qc.includes('INLINE_QC.RESOLVE'));
  });

  test('the stitching supervisor is informed and resolves, and records nothing', () => {
    const sup = role('STITCHING_SUPERVISOR');
    assert.ok(sup.includes('INLINE_QC.VIEW'));
    assert.ok(sup.includes('INLINE_QC.RESOLVE'));
    assert.ok(!sup.includes('INLINE_QC.CREATE'));
  });

  test('the Operation list is seeded from the workbook; defects use the shared Defect Type list', () => {
    const op = masterLists.find((l) => l.code === 'Operation');
    assert.deepEqual(op.values, ['Body Stitch', 'Handle Attach', 'Hemming', 'Label Attach', 'Lupi Stitch', 'Gusset Stitch', 'Final Trim']);
    const defects = masterLists.find((l) => l.code === 'DefectType').values;
    for (const d of ['Handle Size', 'Improper Hem', 'Untrimmed Thread', 'Slanted Label', 'Without Stitch', 'Double Stitch', 'Wrong Side Lupi']) {
      assert.ok(defects.includes(d), d);
    }
  });
});
