/**
 * The registers kept after cutting. No database.
 *
 * Every expected figure below is a row of the workbook itself - the sample
 * data under each sheet's header - so a formula that drifts from the sheet
 * fails here, not in front of the QC desk. The Reconciliation Report's own
 * remarks ("54 pcs WIP at Unit 1") are the check on its variance.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FINISHED_CHECKER_DEFECTS,
  HOURLY_SLOTS,
  alterPct,
  checkAlter,
  checkExternalCheck,
  checkFinishedChecker,
  checkInternalQualityCheck,
  checkRejected,
  checkSpotRectification,
  checkStitching,
  externalCheckTotals,
  finishedCheckerTotals,
  hourlyTotal,
  ratio,
  reconciliationVariance,
  rejectedQty,
  scrapPct,
  stampSlots,
  stitchingRemaining,
  suggestedReconStatus,
} from '../src/domain/production.js';
import { REGISTERS } from '../src/services/productionRegister.service.js';
import { schemasFor } from '../src/validators/productionRegister.validator.js';
import { allDatasets } from '../src/services/dataset.registry.js';
import { AUDITED } from '../src/config/auditedTables.js';
import { MODULES, buildPermissions } from '../prisma/seed/data/rbac.js';
import { masterLists } from '../prisma/seed/data/masterLists.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('Stiching Record - Remaining = Deliverable Size - Actual', () => {
  test('workbook rows 7 to 11', () => {
    assert.equal(stitchingRemaining(2500, 2380), 120);
    assert.equal(stitchingRemaining(2500, 2450), 50);
    assert.equal(stitchingRemaining(3500, 3320), 180);
    assert.equal(stitchingRemaining(3500, 3410), 90);
    assert.equal(stitchingRemaining(2000, 1860), 140);
  });

  test('a unit cannot hand back more than it was given', () => {
    assert.equal(checkStitching({ deliverableSize: 2500, actualQty: 2500 }), null);
    assert.equal(checkStitching({ deliverableSize: 2500, actualQty: 2501 }).field, 'actualQty');
  });
});

describe('Hourly Monitoring', () => {
  test('nine hour slots, in the sheet order', () => {
    assert.deepEqual(
      HOURLY_SLOTS.map((s) => s.label),
      ['10:00', '11:00', '12:00', '1:00', '2:00', '3:00', '4:00', '5:30', '6:30'],
    );
  });

  test('workbook row 7 totals 373', () => {
    const values = [42, 45, 40, 38, 44, 46, 43, 40, 35];
    const slots = Object.fromEntries(HOURLY_SLOTS.map((s, i) => [s.key, values[i]]));
    assert.equal(hourlyTotal(slots), 373);
  });

  test('time auto capture stamps a slot when it changes, and only then', () => {
    const t1 = new Date('2026-08-17T04:30:00Z');
    const t2 = new Date('2026-08-17T05:30:00Z');
    const first = stampSlots({}, { pcsAt10: 42, pcsAt11: 0 }, {}, t1);
    assert.deepEqual(first, { pcsAt10: t1.toISOString() });

    const second = stampSlots({ pcsAt10: 42, pcsAt11: 0 }, { pcsAt10: 42, pcsAt11: 45 }, first, t2);
    assert.equal(second.pcsAt10, t1.toISOString(), 'an untouched slot keeps its time');
    assert.equal(second.pcsAt11, t2.toISOString());
  });
});

describe('Internal Quality Check', () => {
  test('defect pieces are never more than the pieces checked', () => {
    assert.equal(
      checkInternalQualityCheck({ totalPcsChecked: 2380, totalDefectPcs: 120, qcStatus: 'Approved' }),
      null,
    );
    assert.equal(
      checkInternalQualityCheck({ totalPcsChecked: 10, totalDefectPcs: 11, qcStatus: 'Approved' }).field,
      'totalDefectPcs',
    );
  });

  test('"Transferred Back To Unit - if Rejected"', () => {
    const rejected = { totalPcsChecked: 2380, totalDefectPcs: 120, qcStatus: 'Rejected' };
    assert.equal(checkInternalQualityCheck(rejected).field, 'transferredBackToUnit');
    assert.equal(
      checkInternalQualityCheck({ ...rejected, transferredBackToUnit: 'Unit 1 - Anil Kumar' }),
      null,
    );
  });
});

describe('Finished Checker - Projected, Total pieces passed, Defects %', () => {
  const columns = FINISHED_CHECKER_DEFECTS.map((d) => d.key);
  const row = (checked, values) => [checked, Object.fromEntries(columns.map((k, i) => [k, values[i]]))];

  test('seventeen defect columns, Untrimmed Thread to Alter', () => {
    assert.equal(FINISHED_CHECKER_DEFECTS.length, 17);
    assert.equal(FINISHED_CHECKER_DEFECTS[0].label, 'Untrimmed Thread');
    assert.equal(FINISHED_CHECKER_DEFECTS.at(-1).label, 'Alter');
  });

  test('workbook rows 7 and 9', () => {
    const r7 = finishedCheckerTotals(...row(2380, [22, 14, 8, 6, 5, 4, 3, 2, 3, 6, 4, 9, 7, 5, 3, 12, 7]));
    assert.deepEqual(r7, { totalDefects: 120, piecesPassed: 2260, defectPct: '0.050420' });

    const r9 = finishedCheckerTotals(...row(3320, [28, 18, 11, 9, 7, 6, 4, 3, 4, 8, 6, 14, 10, 7, 5, 16, 9]));
    assert.deepEqual(r9, { totalDefects: 165, piecesPassed: 3155, defectPct: '0.049699' });
  });

  test('defects cannot add up to more than was checked', () => {
    assert.equal(checkFinishedChecker(...row(10, [11])).field, 'checkedPcs');
    assert.equal(checkFinishedChecker(...row(10, [10])), null);
  });
});

describe('External Secondary Checking - the inspection report totals', () => {
  test('line total, column totals, pass quantity and defect ratio', () => {
    // The workbook's sample: 100 inspected, one minor "Press".
    const t = externalCheckTotals(100, [
      { particular: 'Stitch skipping' },
      { particular: 'Press', minor: 1 },
    ]);
    assert.equal(t.lines[1].total, 1);
    assert.equal(t.criticalTotal, 0);
    assert.equal(t.minorTotal, 1);
    assert.equal(t.totalDefects, 1);
    assert.equal(t.passQty, 99);
    assert.equal(t.defectRatio, '0.010000');
  });

  test('IF(inspection = 0, 0, ...)', () => {
    assert.equal(externalCheckTotals(0, []).defectRatio, '0');
  });

  test('a defect appears once, and defects never exceed the pieces inspected', () => {
    assert.equal(checkExternalCheck(100, [{ particular: 'Press' }, { particular: 'Press' }]).field, 'lines');
    assert.equal(checkExternalCheck(1, [{ particular: 'Press', major: 2 }]).field, 'inspectionQty');
  });
});

describe('Alter Report - Alter% = Alter piece / Output', () => {
  test('workbook rows 7 to 10', () => {
    assert.equal(alterPct(110, 18), '0.163636');
    assert.equal(alterPct(80, 12), '0.150000');
    assert.equal(alterPct(130, 25), '0.192308');
    assert.equal(alterPct(95, 21), '0.221053');
  });

  test('IFERROR over no output is 0', () => {
    assert.equal(alterPct(0, 0), '0');
  });

  test('passed + altered never exceeds the output', () => {
    assert.equal(checkAlter({ outputPcs: 110, passPcs: 92, alterPcs: 18 }), null);
    assert.equal(checkAlter({ outputPcs: 110, passPcs: 93, alterPcs: 18 }).field, 'alterPcs');
  });
});

describe('Spot Rectification-Scrap - Scrap % of Consignment', () => {
  test('Scrap Qty / Order Qty from the Order sheet', () => {
    assert.equal(scrapPct(32, 5000), '0.006400');
    assert.equal(scrapPct(55, 7000), '0.007857');
  });

  test('sold online and scrapped come out of what was received', () => {
    assert.equal(checkSpotRectification({ qtyReceived: 90, soldOnlineQty: 40, scrapQty: 32 }), null);
    assert.equal(checkSpotRectification({ qtyReceived: 70, soldOnlineQty: 40, scrapQty: 32 }).field, 'scrapQty');
  });
});

describe('Rejected - IF(Cutting Qty = 0, 0, Cutting Qty - Packed Qty)', () => {
  test('workbook rows 7 to 10', () => {
    assert.equal(rejectedQty(4900, 4780), 120);
    assert.equal(rejectedQty(6800, 6620), 180);
    assert.equal(rejectedQty(1800, 1660), 140);
    assert.equal(rejectedQty(4600, 4480), 120);
  });

  test('nothing cut, nothing rejected', () => {
    assert.equal(rejectedQty(0, 25), 0);
  });

  test('packed cannot exceed cut', () => {
    assert.equal(checkRejected({ cuttingQty: 10, packedQty: 11 }).field, 'packedQty');
    assert.equal(checkRejected({ cuttingQty: 0, packedQty: 11 }), null);
  });
});

describe('Reconciliation Report - Cutting Issued - Stitched - Scrap - Rejected', () => {
  test('the workbook rows, checked against their own remarks', () => {
    // "54 pcs WIP at Unit 1"
    assert.equal(reconciliationVariance({ cuttingIssued: 5000, stitched: 4830, scrap: 56, rejected: 60 }), 54);
    // "81 pcs WIP at Unit 2"
    assert.equal(reconciliationVariance({ cuttingIssued: 7000, stitched: 6730, scrap: 89, rejected: 100 }), 81);
    // "48 pcs WIP"
    assert.equal(reconciliationVariance({ cuttingIssued: 2000, stitched: 1860, scrap: 42, rejected: 50 }), 48);
    // "80 pcs WIP"
    assert.equal(reconciliationVariance({ cuttingIssued: 5000, stitched: 4780, scrap: 60, rejected: 80 }), 80);
  });

  test('alter pieces are shown, not subtracted - an altered piece is still stitched', () => {
    const base = { cuttingIssued: 100, stitched: 90, scrap: 5, rejected: 5 };
    assert.equal(reconciliationVariance({ ...base, alter: 40 }), reconciliationVariance(base));
  });

  test('zero is Matched; anything else is a Variance Found', () => {
    assert.equal(suggestedReconStatus(0), 'Matched');
    assert.equal(suggestedReconStatus(54), 'Variance Found');
    assert.equal(suggestedReconStatus(-3), 'Variance Found');
  });
});

describe('ratio - the sheets\' IFERROR(x / y, 0)', () => {
  test('six places, and 0 over nothing', () => {
    assert.equal(ratio(1, 3), '0.333333');
    assert.equal(ratio(5, 0), '0');
    assert.equal(ratio(5, undefined), '0');
  });
});

describe('input schemas', () => {
  test('pieces are whole numbers', () => {
    const { create } = schemasFor('alter');
    const orderId = '11111111-1111-4111-8111-111111111111';
    assert.equal(create.safeParse({ orderId, outputPcs: 10, passPcs: 8, alterPcs: 2 }).success, true);
    assert.equal(create.safeParse({ orderId, outputPcs: 10.5, passPcs: 8, alterPcs: 2 }).success, false);
    assert.equal(create.safeParse({ orderId, outputPcs: -1, passPcs: 8, alterPcs: 2 }).success, false);
  });

  test('a posted Formula column is stripped, never read', () => {
    const { create } = schemasFor('stitching');
    const parsed = create.parse({
      orderId: '11111111-1111-4111-8111-111111111111',
      unitName: 'Unit 1 - Anil Kumar',
      deliverableSize: 2500,
      actualQty: 2380,
      remainingQty: 999,
    });
    assert.equal('remainingQty' in parsed, false);
  });

  test('an update may send any subset', () => {
    const { update } = schemasFor('rejected');
    assert.equal(update.safeParse({ packedQty: 5 }).success, true);
  });
});

describe('every register is wired end to end', () => {
  const routesIndex = fs.readFileSync(path.join(here, '..', 'src', 'routes', 'index.js'), 'utf8');
  const routesFile = fs.readFileSync(path.join(here, '..', 'src', 'routes', 'productionRegister.routes.js'), 'utf8');
  const issued = new Set(buildPermissions().map((p) => p.code));
  const datasets = new Map(allDatasets().map((d) => [d.key, d]));
  const lists = new Set(masterLists.map((l) => l.code));

  test('twelve registers, packing and dispatch not among them', () => {
    assert.equal(Object.keys(REGISTERS).length, 12);
    for (const reg of Object.values(REGISTERS)) {
      assert.doesNotMatch(reg.module, /PACKING|NEEDLE|DISPATCH/);
    }
  });

  for (const [key, reg] of Object.entries(REGISTERS)) {
    test(`${reg.label}: module, permissions, route, schema, export, audit`, () => {
      assert.ok(MODULES.includes(reg.module), `${reg.module} is not in MODULES`);
      for (const action of ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT']) {
        assert.ok(issued.has(`${reg.module}.${action}`), `${reg.module}.${action} is never generated`);
      }
      // EXPORT is guarded by the export runner, from the dataset's module.
      for (const action of ['VIEW', 'CREATE', 'EDIT', 'DELETE']) {
        assert.ok(routesFile.includes(`'${reg.module}.${action}'`), `no route guards ${reg.module}.${action}`);
      }
      assert.ok(routesIndex.includes(`'/${reg.path}'`), `/${reg.path} is not mounted`);
      assert.ok(schemasFor(key).create, 'no input schema');
      assert.ok(datasets.has(reg.path), `no export for ${reg.path}`);
      assert.equal(datasets.get(reg.path).module, reg.module);
      for (const field of reg.sortable) assert.equal(typeof field, 'string');
    });
  }

  test('every table is on the audit trail', () => {
    for (const table of [
      'stitching_records', 'hourly_monitorings', 'qc_size_records', 'qc_defect_records',
      'internal_quality_checks', 'final_checker_reports', 'finished_checker_records',
      'external_secondary_checks', 'alter_reports', 'spot_rectifications', 'rejected_records',
      'reconciliation_reports',
    ]) {
      assert.ok(AUDITED[table], `${table} is not audited`);
    }
  });

  test('the dropdown lists the registers read are seeded', () => {
    for (const code of ['Operation', 'InformTo', 'StatusQC', 'RejectReason', 'InspDefect26', 'StatusRecon', 'DefectType', 'StitchingUnit', 'AuthorisedBy']) {
      assert.ok(lists.has(code), `${code} is not seeded`);
    }
    assert.equal(masterLists.find((l) => l.code === 'InspDefect26').values.length, 26);
  });
});
