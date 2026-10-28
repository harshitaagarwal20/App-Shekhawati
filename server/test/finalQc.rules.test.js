/**
 * Phase 5 - final QC, spot rectification and the reconciliation. No database.
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
  checkFinishedChecker,
  checkInspection,
  checkInternalQualityCheck,
  checkSpotRectification,
  finishedCheckerTotals,
  inspectionTotals,
  internalQcDefectTotal,
  ratio,
  reconciliationVariance,
  scrapPct,
  suggestedReconStatus,
} from '../src/domain/quality.js';
import { REGISTERS } from '../src/services/productionRegister.service.js';
import { schemasFor } from '../src/validators/productionRegister.validator.js';
import { createExternalQcSchema } from '../src/validators/externalQc.validator.js';
import { allDatasets } from '../src/services/dataset.registry.js';
import { AUDITED } from '../src/config/auditedTables.js';
import { MODULES, buildPermissions, roles } from '../prisma/seed/data/rbac.js';
import { masterLists } from '../prisma/seed/data/masterLists.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = '11111111-1111-4111-8111-111111111111';

describe('Internal Quality Check', () => {
  const found = [
    { defectType: 'Stain', qty: 80 },
    { defectType: 'Torn', qty: 40 },
  ];

  test('Total Defect Pcs is the sum of a count per defect type', () => {
    assert.equal(internalQcDefectTotal(found), 120);
    assert.equal(internalQcDefectTotal([]), 0);
  });

  test('defect pieces are never more than the pieces checked', () => {
    assert.equal(checkInternalQualityCheck({ totalPcsChecked: 2380, defects: found, qcStatus: 'Approved' }), null);
    assert.equal(checkInternalQualityCheck({ totalPcsChecked: 100, defects: found, qcStatus: 'Approved' }).field, 'defects');
  });

  test('a defect type is counted on one line, not two', () => {
    const twice = [...found, { defectType: 'Stain', qty: 1 }];
    assert.match(checkInternalQualityCheck({ totalPcsChecked: 2380, defects: twice, qcStatus: 'Approved' }).message, /Stain/);
  });

  test('a posted Total Defect Pcs is stripped; a line needs a type and at least one piece', () => {
    const { create } = schemasFor('internalQc');
    const base = { orderId: ID, checkerId: ID, totalPcsChecked: 100, qcStatus: 'Approved' };
    const parsed = create.parse({ ...base, totalDefectPcs: 999, defects: found });
    assert.equal('totalDefectPcs' in parsed, false);
    assert.deepEqual(parsed.defects, found);
    assert.equal(create.safeParse({ ...base, defects: [{ defectType: 'Stain', qty: 0 }] }).success, false);
    assert.equal(create.safeParse({ ...base, defects: [{ defectType: '', qty: 2 }] }).success, false);
  });

  test('"Transferred Back To Unit - if Rejected"', () => {
    const rejected = { totalPcsChecked: 2380, defects: found, qcStatus: 'Rejected' };
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

  test('the screen keys the same seventeen columns the server stores', () => {
    // Read as text: the descriptors are JSX, which Node does not load.
    const source = fs.readFileSync(path.join(here, '..', '..', 'client', 'src', 'config', 'registers.jsx'), 'utf8');
    const block = source.slice(source.indexOf('export const FINISHED_CHECKER_DEFECTS'), source.indexOf('];', source.indexOf('export const FINISHED_CHECKER_DEFECTS')));
    assert.deepEqual([...block.matchAll(/key: '(\w+)'/g)].map((m) => m[1]), columns);
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

describe('External Secondary Checking - the inspection grid on an External QC entry', () => {
  test('line total, column totals, pass quantity and defect ratio', () => {
    // The workbook's sample: 100 inspected, one minor "Press".
    const t = inspectionTotals(100, [
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
    assert.equal(inspectionTotals(0, []).defectRatio, '0');
  });

  test('a defect appears once, and defects never exceed the pieces offered', () => {
    assert.equal(checkInspection(100, [{ particular: 'Press' }, { particular: 'Press' }]).field, 'inspectionLines');
    assert.equal(checkInspection(1, [{ particular: 'Press', major: 2 }]).field, 'inspectionLines');
    assert.equal(checkInspection(2, [{ particular: 'Press', major: 2 }]), null);
  });

  test('the grid rides on the External QC input, in whole pieces', () => {
    const base = { orderId: ID, styleId: ID, agencyId: ID, pcsOffered: '10' };
    const ok = createExternalQcSchema.safeParse({ ...base, inspectionLines: [{ particular: 'Press', minor: 1 }] });
    assert.equal(ok.success, true);
    const half = createExternalQcSchema.safeParse({ ...base, inspectionLines: [{ particular: 'Press', minor: 0.5 }] });
    assert.equal(half.success, false);
  });

  test('L_InspDefect26 is seeded with all twenty-six particulars', () => {
    const list = masterLists.find((l) => l.code === 'InspDefect26');
    assert.equal(list.values.length, 26);
    assert.equal(new Set(list.values).size, 26);
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
    const { create } = schemasFor('spotRectification');
    assert.equal(create.safeParse({ orderId: ID, qtyReceived: 10 }).success, true);
    assert.equal(create.safeParse({ orderId: ID, qtyReceived: 10.5 }).success, false);
    assert.equal(create.safeParse({ orderId: ID, qtyReceived: -1 }).success, false);
  });

  test('a posted Formula column is stripped, never read', () => {
    const { create } = schemasFor('finishedChecker');
    const parsed = create.parse({ orderId: ID, checkerId: ID, checkedPcs: 100, torn: 2, totalDefects: 999, defectPct: '0.5' });
    assert.equal('totalDefects' in parsed, false);
    assert.equal('defectPct' in parsed, false);
  });

  test('the Final Checker Report needs no order', () => {
    const { create } = schemasFor('finalChecker');
    assert.equal(create.safeParse({ checkerId: ID, styleId: ID, totalPcsChecked: 10, totalDefect: 1 }).success, true);
  });

  test('an update may send any subset', () => {
    const { update } = schemasFor('reconciliation');
    assert.equal(update.safeParse({ remarks: 'checked' }).success, true);
  });
});

describe('every register is wired end to end', () => {
  const routesIndex = fs.readFileSync(path.join(here, '..', 'src', 'routes', 'index.js'), 'utf8');
  const routesFile = fs.readFileSync(path.join(here, '..', 'src', 'routes', 'productionRegister.routes.js'), 'utf8');
  const issued = new Set(buildPermissions().map((p) => p.code));
  const datasets = new Map(allDatasets().map((d) => [d.key, d]));
  const lists = new Set(masterLists.map((l) => l.code));

  test('five registers, packing and dispatch not among them', () => {
    assert.deepEqual(Object.keys(REGISTERS), ['internalQc', 'finalChecker', 'finishedChecker', 'spotRectification', 'reconciliation']);
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
      assert.equal(issued.has(`${reg.module}.APPROVE`), false, `${reg.module} is not approvable`);
      // EXPORT is guarded by the export runner, from the dataset's module.
      for (const action of ['VIEW', 'CREATE', 'EDIT', 'DELETE']) {
        assert.ok(routesFile.includes(`'${reg.module}.${action}'`), `no route guards ${reg.module}.${action}`);
      }
      assert.ok(routesIndex.includes(`'/${reg.path}'`), `/${reg.path} is not mounted`);
      assert.ok(schemasFor(key).create, 'no input schema');
      assert.ok(datasets.has(reg.path), `no export for ${reg.path}`);
      assert.equal(datasets.get(reg.path).module, reg.module);
    });
  }

  test('every table is on the audit trail', () => {
    for (const table of [
      'internal_quality_checks', 'internal_quality_defects', 'final_checker_reports', 'finished_checker_records',
      'external_qc_inspection_lines', 'spot_rectifications', 'reconciliation_reports',
    ]) {
      assert.ok(AUDITED[table], `${table} is not audited`);
    }
  });

  test('the dropdown lists the registers read are seeded', () => {
    for (const code of ['StatusQC', 'InspDefect26', 'StatusRecon', 'DefectType', 'StitchingUnit', 'AuthorisedBy']) {
      assert.ok(lists.has(code), `${code} is not seeded`);
    }
  });

  test('the migration grants exactly what the seeder does', () => {
    // A live database is migrated, not seeded; the two must agree or a role
    // sees different screens there than on a fresh install.
    const migration = fs.readFileSync(
      path.join(here, '..', 'prisma', 'migrations', '20261022000100_final_qc_and_reconciliation', 'migration.sql'),
      'utf8',
    );
    const PHASE5 = Object.values(REGISTERS).map((r) => r.module);
    const seeded = (code) => roles.find((r) => r.code === code).permissions
      .filter((p) => PHASE5.includes(p.split('.')[0]));
    assert.deepEqual(seeded('QC').sort(), PHASE5.filter((m) => m !== 'RECONCILIATION_REPORT')
      .flatMap((m) => ['VIEW', 'CREATE', 'EDIT', 'EXPORT'].map((a) => `${m}.${a}`)).sort());
    assert.ok(seeded('MERCHANDISING').includes('RECONCILIATION_REPORT.CREATE'));
    assert.match(migration, /SELECT 'QC' AS role_code/);
    assert.match(migration, /SELECT 'MERCHANDISING', 'RECONCILIATION_REPORT'/);
  });
});
