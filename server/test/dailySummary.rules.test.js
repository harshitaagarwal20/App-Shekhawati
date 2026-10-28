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
import { briefingFacts, withBriefing, writeBriefing, HEADING, NOTHING } from '../src/services/summaryBriefing.service.js';
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

// The week before 2026-10-21, as buildTrend() returns it.
const TREND = {
  day: '2026-10-21',
  stitching: [
    { key: 'Unit 1', date: '2026-10-19', pcs: 600 },
    { key: 'Unit 1', date: '2026-10-20', pcs: 700 },
    { key: 'Unit 1', date: '2026-10-21', pcs: 390 },
    { key: 'Unit 2', date: '2026-10-20', pcs: 500 },
  ],
  externalQc: [
    { key: 'ST-101', date: '2026-10-20', offered: 400, alteration: 8, rejected: 4 },
    { key: 'ST-101', date: '2026-10-21', offered: 500, alteration: 10, rejected: 25 },
    { key: 'ST-102', date: '2026-10-20', offered: 300, alteration: 3, rejected: 3 },
  ],
  inlineQc: [{ key: 'Unit 1', date: '2026-10-21', checked: 300, rejected: 6 }],
  cut: [
    { date: '2026-10-20', pcs: 1000 },
    { date: '2026-10-21', pcs: 1200 },
  ],
};

describe('Daily summary - the AI briefing is shown only what the reader may see', () => {
  test("a stitching supervisor's briefing is written from stitching alone", () => {
    const facts = briefingFacts(FIGURES, TREND, holder('STITCHING_RECORD.VIEW'));
    assert.deepEqual(Object.keys(facts), ['day', 'stitching']);
  });

  test('somebody who may see none of it costs no call', () => {
    assert.equal(briefingFacts(FIGURES, TREND, () => false), null);
  });

  test('approvals: only the types the reader may view, and whether each is theirs to decide', () => {
    const facts = briefingFacts(FIGURES, TREND, holder('FABRIC_SCRUTINY.VIEW', 'FABRIC_SCRUTINY.APPROVE'));
    assert.deepEqual(facts.approvalsWaiting, [
      { document: 'Fabric Scrutiny', waiting: 2, readerMayApprove: true, oldest: { documentNo: 'FS-0003', daysWaiting: 1 } },
    ]);
  });

  test('usual output is averaged over the days a unit worked; a unit idle today shows as -100%', () => {
    const { byUnit } = briefingFacts(FIGURES, TREND, holder('STITCHING_RECORD.VIEW')).stitching;
    assert.deepEqual(byUnit, [
      { unit: 'Unit 1', todayPcs: 390, usualPcsPerWorkingDay: 650, changePct: -40 },
      { unit: 'Unit 2', todayPcs: 0, usualPcsPerWorkingDay: 500, changePct: -100 },
    ]);
  });

  test('External QC rates by style are worked out here, not left to the model', () => {
    const { byStyle } = briefingFacts(FIGURES, TREND, holder('EXTERNAL_QC.VIEW')).externalQc;
    assert.deepEqual(byStyle, [
      {
        style: 'ST-101',
        todayOffered: 500,
        todayRejectedPct: 5,
        todayAlterationPct: 2,
        last7DaysRejectedPct: 1,
        last7DaysAlterationPct: 2,
      },
    ], 'ST-102 was not offered today, so it has nothing new to say');
  });

  test('cutting compared with its usual day', () => {
    const { cut } = briefingFacts(FIGURES, TREND, holder('CUT_PIECES_RECEIPT.VIEW'));
    assert.deepEqual(cut, { todayPcs: 1200, usualPcsPerWorkingDay: 1000, changePct: 20 });
  });
});

describe('Daily summary - the AI briefing on top of the message', () => {
  const message = composeSummary(FIGURES, holder('STITCHING_RECORD.VIEW'));

  test('the points go above the figures, which stay as they were', () => {
    const m = withBriefing(message, ['Unit 1 stitched 390 pcs, 40% below its usual 650.']);
    assert.equal(m.body, `${HEADING}
• Unit 1 stitched 390 pcs, 40% below its usual 650.

Stitched: 950 pcs`);
    assert.deepEqual(m.lines, message.lines);
  });

  test('nothing standing out is said, not skipped', () => {
    assert.equal(withBriefing(message, []).body, `${HEADING}
${NOTHING}

Stitched: 950 pcs`);
  });

  test('no briefing leaves the summary exactly as before', () => {
    assert.equal(withBriefing(message, null), message);
    assert.equal(withBriefing(null, ['x']), null);
  });

  test('without an API key nothing is called', async () => {
    assert.equal(await writeBriefing({ day: '2026-10-21' }), null);
  });
});
