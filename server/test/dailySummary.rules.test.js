/**
 * The daily summary - what each person is told, and when. No database.
 *
 * The summary goes to people who may see very different parts of the
 * factory, so the rule that matters most is that every line is gated by the
 * reader's own permission for the register it comes from.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { D } from '../src/utils/figures.js';
import { composeSummary, isDue, istClock, SUMMARY_PERMISSION } from '../src/services/dailySummary.service.js';
import { buildPermissions } from '../prisma/seed/data/rbac.js';

const FIGURES = {
  day: '2026-10-21',
  cut: { entries: 2, pcs: D(1200) },
  issued: { entries: 1, pcs: D(1000) },
  stitched: { entries: 3, pcs: D(950) },
  externalQc: { entries: 2, offered: D(800), approved: D(760), alteration: D(28), rejected: D(12) },
  inlineQc: { entries: 4, checked: D(300), rejected: D(6) },
  rejected: { entries: 1, pcs: D(4) },
  approvals: [
    { documentType: 'PURCHASE_ORDER', label: 'Purchase Order', count: 3, oldest: { documentNo: 'PO-0012', ageDays: 4, waitingSince: '2026-10-17T05:00:00Z' } },
    { documentType: 'FABRIC_SCRUTINY', label: 'Fabric Scrutiny', count: 2, oldest: { documentNo: 'FS-0003', ageDays: 1, waitingSince: '2026-10-20T05:00:00Z' } },
  ],
};

const holder = (...codes) => (code) => codes.includes(code);

describe('Daily summary - each line only for those who may see it', () => {
  test('the Director, who sees everything, gets every line', () => {
    const m = composeSummary(FIGURES, () => true);
    assert.equal(m.title, 'Daily summary - 21-10-2026');
    assert.deepEqual(m.lines, [
      'Cut: 1,200 pcs',
      'Issued to stitching units: 1,000 pcs',
      'Stitched: 950 pcs',
      'External QC: 800 offered, 760 approved (95.0%), 28 to alteration, 12 rejected',
      'Inline QC: 300 checked, 6 rejected',
      'Rejected (not repairable): 4 pcs',
      'Waiting for approval: 5, 5 of them yours. Oldest: Purchase Order PO-0012, 4 days',
    ]);
    assert.equal(m.link, '/approvals', 'what is waiting on them is where it opens');
  });

  test('a stitching supervisor hears about stitching and nothing else', () => {
    const m = composeSummary(FIGURES, holder('STITCHING_RECORD.VIEW'));
    assert.deepEqual(m.lines, ['Stitched: 950 pcs']);
    assert.equal(m.link, '/');
  });

  test('approvals count only the document types the reader may see, and "yours" only what they may decide', () => {
    const m = composeSummary(FIGURES, holder('FABRIC_SCRUTINY.VIEW', 'FABRIC_SCRUTINY.APPROVE'));
    assert.deepEqual(m.lines, ['Waiting for approval: 2, 2 of them yours. Oldest: Fabric Scrutiny FS-0003, 1 day']);
  });

  test('somebody who may see none of it is sent nothing', () => {
    assert.equal(composeSummary(FIGURES, () => false), null);
  });

  test('a quiet day is still said, not skipped', () => {
    const quiet = {
      ...FIGURES,
      stitched: { entries: 0, pcs: D(0) },
      externalQc: { entries: 0, offered: D(0), approved: D(0), alteration: D(0), rejected: D(0) },
      approvals: [],
    };
    const m = composeSummary(quiet, holder('STITCHING_RECORD.VIEW', 'EXTERNAL_QC.VIEW', 'REPORT.VIEW'));
    assert.deepEqual(m.lines, ['Stitched: 0 pcs', 'External QC: nothing offered', 'Waiting for approval: nothing']);
  });
});

describe('Daily summary - when it goes', () => {
  test('due once the hour is reached, until sent that day', () => {
    assert.equal(isDue({ clock: '19:59', day: '2026-10-21', at: '20:00', lastSentDay: null }), false);
    assert.equal(isDue({ clock: '20:00', day: '2026-10-21', at: '20:00', lastSentDay: null }), true);
    assert.equal(isDue({ clock: '22:15', day: '2026-10-21', at: '20:00', lastSentDay: null }), true, 'a server up late still sends');
    assert.equal(isDue({ clock: '20:01', day: '2026-10-21', at: '20:00', lastSentDay: '2026-10-21' }), false);
    assert.equal(isDue({ clock: '20:00', day: '2026-10-22', at: '20:00', lastSentDay: '2026-10-21' }), true);
  });

  test('the clock is India time, not the server\'s', () => {
    // 14:30 UTC is 20:00 in India.
    assert.equal(istClock(new Date('2026-10-21T14:30:00Z')), '20:00');
    assert.equal(istClock(new Date('2026-10-21T18:29:00Z')), '23:59');
  });

  test('REPORT.SUMMARY is a permission the seeder issues', () => {
    // A permission the code checks but the seeder never creates is a lockout:
    // no role could ever be granted it.
    assert.ok(buildPermissions().some((p) => p.code === SUMMARY_PERMISSION));
  });
});
