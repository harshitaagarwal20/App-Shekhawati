/**
 * The daily summary - one evening message of the day's work.
 *
 * ===========================================================================
 *  WHAT IT SAYS
 * ===========================================================================
 *
 *    Cut                       pieces received off the cutting table
 *    Issued to units           pieces sent to the stitching units
 *    Stitched                  the units' stitching records
 *    External QC               offered, approved, rejected box
 *    Inline QC                 checked and rejected on the line
 *    Rejected                  the Rejected register - pieces not repairable
 *    Waiting for approval      everything pending, and how much is yours
 *
 *  Each line is shown only to a person who may view the register it comes
 *  from - the same `<MODULE>.VIEW` that guards that screen - so the summary
 *  never tells anybody something the application would not. A day with
 *  nothing to say to someone sends them nothing.
 *
 * ===========================================================================
 *  WHO, WHEN, AND ONCE
 * ===========================================================================
 *
 *  Holders of REPORT.SUMMARY who have not switched it off, at
 *  DAILY_SUMMARY_TIME India time. It is an ordinary notification, so it lands
 *  in the bell and goes out by email / WhatsApp exactly as each person's
 *  settings say, through the same outbox as everything else.
 *
 *  `dedupeKey: daily-summary:<day>` makes it once per person per day however
 *  often it is attempted: a restart after the hour, or two API instances both
 *  deciding it is time, write nothing the second time. A server that was down
 *  at the hour sends when it comes back, the same evening.
 * ===========================================================================
 */

import prisma, { notDeleted } from '../config/prisma.js';
import { env } from '../config/env.js';
import { D } from '../utils/figures.js';
import { istDate, istIsoDate } from '../utils/dates.js';
import { pendingSummary } from './approvalEngine.js';
import { notify } from './notification.service.js';

export const SUMMARY_PERMISSION = 'REPORT.SUMMARY';

const INDIAN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const n = (v) => INDIAN.format(Number(D(v).toDecimalPlaces(2).toString()));

// ===========================================================================
//  THE FIGURES - once per day, for everybody
// ===========================================================================

/**
 * Every figure the summary can show, for one India calendar day.
 *
 * @param {string} day  YYYY-MM-DD
 */
export async function buildFigures(day) {
  const on = new Date(day);
  const [cut, issued, stitched, external, inline, rejected, approvals] = await Promise.all([
    prisma.cutPiecesReceipt.aggregate({
      where: { ...notDeleted, receiptDate: on },
      _sum: { pcsReceived: true },
      _count: { _all: true },
    }),
    prisma.cuttingIssue.aggregate({
      where: { ...notDeleted, issueDate: on, workflowState: { in: ['POSTED', 'COMPLETED'] } },
      _sum: { cuttingPcsIssued: true },
      _count: { _all: true },
    }),
    prisma.stitchingRecord.aggregate({
      where: { ...notDeleted, recordDate: on },
      _sum: { actualStitched: true },
      _count: { _all: true },
    }),
    prisma.externalQcEntry.aggregate({
      where: { ...notDeleted, entryDate: on },
      _sum: { pcsOffered: true, pcsApproved: true, pcsAlteration: true, pcsRejected: true },
      _count: { _all: true },
    }),
    prisma.inlineQcEntry.aggregate({
      where: { ...notDeleted, entryDate: on },
      _sum: { pcsChecked: true, pcsRejected: true },
      _count: { _all: true },
    }),
    prisma.rejectedRegisterEntry.aggregate({
      where: { ...notDeleted, rejectDate: on },
      _sum: { qty: true },
      _count: { _all: true },
    }),
    pendingSummary(),
  ]);

  return {
    day,
    cut: { entries: cut._count._all, pcs: D(cut._sum.pcsReceived) },
    issued: { entries: issued._count._all, pcs: D(issued._sum.cuttingPcsIssued) },
    stitched: { entries: stitched._count._all, pcs: D(stitched._sum.actualStitched) },
    externalQc: {
      entries: external._count._all,
      offered: D(external._sum.pcsOffered),
      approved: D(external._sum.pcsApproved),
      alteration: D(external._sum.pcsAlteration),
      rejected: D(external._sum.pcsRejected),
    },
    inlineQc: { entries: inline._count._all, checked: D(inline._sum.pcsChecked), rejected: D(inline._sum.pcsRejected) },
    rejected: { entries: rejected._count._all, pcs: D(rejected._sum.qty) },
    approvals: approvals.groups.map((g) => ({
      documentType: g.documentType,
      label: g.label,
      count: g.count,
      oldest: g.oldest ? { documentNo: g.oldest.documentNo, ageDays: g.oldest.ageDays, waitingSince: g.oldest.waitingSince } : null,
    })),
  };
}

// ===========================================================================
//  THE MESSAGE - per person, from their own permissions
// ===========================================================================

const pctOf = (part, whole) =>
  D(whole).greaterThan(0) ? `${D(part).div(D(whole)).mul(100).toDecimalPlaces(1).toFixed(1)}%` : null;

/**
 * The summary one person reads. Pure, so it is tested without a database.
 *
 * @param {object} f      buildFigures()
 * @param {(code: string) => boolean} has   that person's permission check
 * @returns {{ title: string, body: string, lines: string[], link: string } | null}
 *          null when there is nothing this person may be told
 */
export function composeSummary(f, has) {
  const lines = [];
  const work = [];

  if (has('CUT_PIECES_RECEIPT.VIEW')) work.push(`Cut: ${n(f.cut.pcs)} pcs`);
  if (has('CUTTING_ISSUE.VIEW')) work.push(`Issued to stitching units: ${n(f.issued.pcs)} pcs`);
  if (has('STITCHING_RECORD.VIEW')) work.push(`Stitched: ${n(f.stitched.pcs)} pcs`);
  if (has('EXTERNAL_QC.VIEW')) {
    const q = f.externalQc;
    work.push(
      q.entries
        ? `External QC: ${n(q.offered)} offered, ${n(q.approved)} approved` +
            `${pctOf(q.approved, q.offered) ? ` (${pctOf(q.approved, q.offered)})` : ''}, ` +
            `${n(q.alteration)} to alteration, ${n(q.rejected)} rejected`
        : 'External QC: nothing offered',
    );
  }
  if (has('INLINE_QC.VIEW')) {
    const q = f.inlineQc;
    work.push(q.entries ? `Inline QC: ${n(q.checked)} checked, ${n(q.rejected)} rejected` : 'Inline QC: no checks');
  }
  if (has('REJECTED_REGISTER.VIEW')) work.push(`Rejected (not repairable): ${n(f.rejected.pcs)} pcs`);

  // A day with the work lines all zero is still worth saying to somebody who
  // watches them - "nothing was stitched today" is news - so they are kept.
  lines.push(...work);

  const seen = f.approvals.filter((g) => has(`${g.documentType}.VIEW`));
  let link = '/';
  if (seen.length) {
    const total = seen.reduce((a, g) => a + g.count, 0);
    const mine = seen.filter((g) => has(`${g.documentType}.APPROVE`)).reduce((a, g) => a + g.count, 0);
    const oldest = seen
      .filter((g) => g.oldest)
      .sort((a, b) => new Date(a.oldest.waitingSince) - new Date(b.oldest.waitingSince))[0];
    lines.push(
      `Waiting for approval: ${n(total)}` +
        (mine ? `, ${n(mine)} of them yours` : '') +
        (oldest?.oldest?.documentNo
          ? `. Oldest: ${oldest.label} ${oldest.oldest.documentNo}, ${oldest.oldest.ageDays} day${oldest.oldest.ageDays === 1 ? '' : 's'}`
          : ''),
    );
    if (mine && has('REPORT.VIEW')) link = '/approvals';
  } else if (f.approvals.length === 0 && has('REPORT.VIEW')) {
    lines.push('Waiting for approval: nothing');
  }

  if (!lines.length) return null;
  return {
    title: `Daily summary - ${istDate(f.day)}`,
    body: lines.join('\n'),
    lines,
    link,
  };
}

// ===========================================================================
//  SENDING
// ===========================================================================

/** Active holders of REPORT.SUMMARY who have it switched on, with their permissions. */
async function recipients() {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      notifyDailySummary: true,
      // Through a real business role, as notification.service.js does: ADMIN
      // holds every permission by construction and would otherwise put the IT
      // desk on every list.
      roles: {
        some: {
          role: { deletedAt: null, code: { not: 'ADMIN' }, permissions: { some: { permission: { code: SUMMARY_PERMISSION } } } },
        },
      },
    },
    select: {
      id: true,
      roles: {
        where: { role: { deletedAt: null } },
        select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } },
      },
    },
  });
  return users.map((u) => {
    const codes = new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)));
    return { id: u.id, has: (code) => codes.has(code) };
  });
}

/**
 * Builds and sends one day's summary to everybody who should have it.
 * Safe to call more than once a day: the dedupe key makes a repeat a no-op.
 */
export async function sendDailySummary(day = istIsoDate()) {
  const people = await recipients();
  if (!people.length) return { day, recipients: 0, created: 0 };
  const figures = await buildFigures(day);

  let created = 0;
  for (const p of people) {
    const message = composeSummary(figures, p.has);
    if (!message) continue;
    const r = await notify({
      userIds: [p.id],
      kind: 'DAILY_SUMMARY',
      title: message.title,
      body: message.body,
      link: message.link,
      dedupeKey: `daily-summary:${day}`,
    });
    created += r.created;
  }
  return { day, recipients: people.length, created };
}

/** The caller's own summary for a day, without sending it - the settings preview. */
export async function previewFor(has, day = istIsoDate()) {
  const message = composeSummary(await buildFigures(day), has);
  return { day, receives: has(SUMMARY_PERMISSION), time: env.DAILY_SUMMARY_TIME, message };
}

// ===========================================================================
//  THE CLOCK
// ===========================================================================

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** HH:MM now, India time. */
export function istClock(now = new Date()) {
  const p = Object.fromEntries(CLOCK.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}

/**
 * Whether the summary is due. Pure.
 *
 * Due once the clock has reached the hour, until it has been sent for that
 * day. "Reached", not "equals": a tick that lands at 20:00:59 and the next at
 * 20:01:58 must not both miss it, and a server started at 21:00 still sends.
 */
export function isDue({ clock, day, at, lastSentDay }) {
  return clock >= at && lastSentDay !== day;
}

let timer = null;
let lastSentDay = null;

/** Started once from index.js. Checks the clock every minute. */
export function startDailySummary() {
  if (timer || !env.DAILY_SUMMARY_ENABLED) return false;
  let running = false;
  timer = setInterval(async () => {
    const now = new Date();
    const day = istIsoDate(now);
    if (running || !isDue({ clock: istClock(now), day, at: env.DAILY_SUMMARY_TIME, lastSentDay })) return;
    running = true;
    try {
      const r = await sendDailySummary(day);
      lastSentDay = day;
      if (r.created) process.stdout.write(`[daily-summary] ${day}: sent to ${r.created} of ${r.recipients}\n`);
    } catch (err) {
      // Left unmarked, so the next minute tries again.
      process.stderr.write(`[daily-summary] failed: ${err?.message ?? err}\n`);
    } finally {
      running = false;
    }
  }, 60_000);
  timer.unref();
  return true;
}

export function stopDailySummary() {
  if (timer) clearInterval(timer);
  timer = null;
}
