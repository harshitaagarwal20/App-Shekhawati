/**
 * The "Needs attention" lines at the top of the daily summary, written by
 * Claude from the same figures the summary prints beneath them.
 *
 * ===========================================================================
 *  WHAT IT ADDS
 * ===========================================================================
 *
 *  The summary lists the day's totals. It cannot say which of them is out of
 *  the ordinary - a unit well under its usual output, a style whose External
 *  QC rejections jumped, a purchase order waiting four days for the reader.
 *  This takes the day's figures, the previous seven days for comparison and
 *  the approvals waiting, and asks for up to five short lines on what stands
 *  out, most important first. The printed figures stay underneath, so every
 *  line can be checked against them.
 *
 * ===========================================================================
 *  WHAT IT MAY SEE, AND WHAT IT MAY NOT DO
 * ===========================================================================
 *
 *  Read-only. It writes nothing but the text of the notification.
 *
 *  Each reader's lines are written only from the registers that reader may
 *  view - the same `<MODULE>.VIEW` gates composeSummary() applies - so the
 *  briefing never tells anybody what the summary would not. Readers who see
 *  the same registers share one call.
 *
 *  Only aggregates leave the building: unit names, style numbers, document
 *  numbers and piece counts. No person's name, no buyer, no price.
 *
 *  Off unless ANTHROPIC_API_KEY is set. Any failure - no key, the API down,
 *  a refusal, an answer that does not parse - sends the summary exactly as it
 *  was before this existed. The briefing is never the reason a summary fails.
 * ===========================================================================
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import prisma, { notDeleted } from '../config/prisma.js';
import { env } from '../config/env.js';
import { D } from '../utils/figures.js';

const MODEL = 'claude-opus-5-5';
const PRIOR_DAYS = 7;
const MAX_POINTS = 5;

export const HEADING = 'Needs attention (AI):';
export const NOTHING = 'Nothing stands out today.';

export const briefingEnabled = () => env.DAILY_SUMMARY_AI && Boolean(env.ANTHROPIC_API_KEY);

const num = (v) => Number(D(v).toDecimalPlaces(2).toString());
const pct = (part, whole) => (num(whole) > 0 ? Math.round((num(part) / num(whole)) * 1000) / 10 : null);
/** Percentage change of today against a usual figure; null when there is no usual figure. */
const change = (today, usual) => (usual > 0 ? Math.round(((today - usual) / usual) * 1000) / 10 : null);

// ===========================================================================
//  THE COMPARISON - the previous seven days, once per run
// ===========================================================================

const dayKey = (d) => d.toISOString().slice(0, 10);

/**
 * Today against the previous seven calendar days, broken down where the
 * summary only has totals: stitching and Inline QC by unit, External QC by
 * style. "Usual" output is averaged over the days a unit actually recorded
 * work, so a Sunday off does not read as a bad week.
 *
 * @param {string} day  YYYY-MM-DD
 */
export async function buildTrend(day) {
  const on = new Date(day);
  const from = new Date(on.getTime() - PRIOR_DAYS * 86_400_000);
  const window = { gte: from, lte: on };

  const [stitching, external, inline, cut] = await Promise.all([
    prisma.stitchingRecord.groupBy({
      by: ['unit', 'recordDate'],
      where: { ...notDeleted, recordDate: window },
      _sum: { actualStitched: true },
    }),
    prisma.externalQcEntry.groupBy({
      by: ['styleId', 'entryDate'],
      where: { ...notDeleted, entryDate: window },
      _sum: { pcsOffered: true, pcsAlteration: true, pcsRejected: true },
    }),
    prisma.inlineQcEntry.groupBy({
      by: ['unit', 'entryDate'],
      where: { ...notDeleted, entryDate: window },
      _sum: { pcsChecked: true, pcsRejected: true },
    }),
    prisma.cutPiecesReceipt.groupBy({
      by: ['receiptDate'],
      where: { ...notDeleted, receiptDate: window },
      _sum: { pcsReceived: true },
    }),
  ]);

  const styleIds = [...new Set(external.map((r) => r.styleId))];
  const styles = styleIds.length
    ? await prisma.style.findMany({ where: { id: { in: styleIds } }, select: { id: true, styleNo: true } })
    : [];
  const styleNo = new Map(styles.map((s) => [s.id, s.styleNo]));

  return {
    day,
    stitching: stitching.map((r) => ({ key: r.unit, date: dayKey(r.recordDate), pcs: num(r._sum.actualStitched) })),
    externalQc: external.map((r) => ({
      key: styleNo.get(r.styleId) ?? r.styleId,
      date: dayKey(r.entryDate),
      offered: num(r._sum.pcsOffered),
      alteration: num(r._sum.pcsAlteration),
      rejected: num(r._sum.pcsRejected),
    })),
    inlineQc: inline.map((r) => ({
      key: r.unit,
      date: dayKey(r.entryDate),
      checked: num(r._sum.pcsChecked),
      rejected: num(r._sum.pcsRejected),
    })),
    cut: cut.map((r) => ({ date: dayKey(r.receiptDate), pcs: num(r._sum.pcsReceived) })),
  };
}

/** Rows of one day against the rows before it, summed per key. */
function split(rows, day, fields) {
  const byKey = new Map();
  for (const r of rows) {
    const k = r.key ?? '';
    if (!byKey.has(k)) byKey.set(k, { key: k, today: zero(fields), prior: zero(fields), priorDays: new Set() });
    const slot = byKey.get(k);
    const side = r.date === day ? slot.today : slot.prior;
    for (const f of fields) side[f] += r[f];
    if (r.date !== day) slot.priorDays.add(r.date);
  }
  return [...byKey.values()].map((s) => ({ ...s, priorDays: s.priorDays.size }));
}
const zero = (fields) => Object.fromEntries(fields.map((f) => [f, 0]));
const round = (v) => Math.round(v * 10) / 10;

// ===========================================================================
//  THE FACTS - per reader, from their own permissions
// ===========================================================================

/**
 * What Claude is shown for one reader: today's totals, the comparison, and
 * the approvals, each section only if the reader may view its register. Pure,
 * so the gating is tested without a database or the API.
 *
 * @param {object} f      dailySummary buildFigures()
 * @param {object} trend  buildTrend()
 * @param {(code: string) => boolean} has
 * @returns {object | null}  null when the reader may see none of it
 */
export function briefingFacts(f, trend, has) {
  const facts = {};
  const day = f.day;

  if (has('CUT_PIECES_RECEIPT.VIEW')) {
    const prior = trend.cut.filter((r) => r.date !== day);
    const usual = prior.length ? round(prior.reduce((a, r) => a + r.pcs, 0) / prior.length) : null;
    facts.cut = { todayPcs: num(f.cut.pcs), usualPcsPerWorkingDay: usual, changePct: change(num(f.cut.pcs), usual) };
  }
  if (has('CUTTING_ISSUE.VIEW')) facts.issuedToUnits = { todayPcs: num(f.issued.pcs) };

  if (has('STITCHING_RECORD.VIEW')) {
    facts.stitching = {
      todayPcs: num(f.stitched.pcs),
      byUnit: split(trend.stitching, day, ['pcs']).map((u) => {
        const usual = u.priorDays ? round(u.prior.pcs / u.priorDays) : null;
        return { unit: u.key, todayPcs: u.today.pcs, usualPcsPerWorkingDay: usual, changePct: change(u.today.pcs, usual) };
      }),
    };
  }

  if (has('EXTERNAL_QC.VIEW')) {
    const q = f.externalQc;
    facts.externalQc = {
      today: {
        offered: num(q.offered),
        approved: num(q.approved),
        alteration: num(q.alteration),
        rejected: num(q.rejected),
        approvedPct: pct(q.approved, q.offered),
      },
      // The styles offered today, busiest first: a style not offered today has
      // nothing new to say.
      byStyle: split(trend.externalQc, day, ['offered', 'alteration', 'rejected'])
        .filter((s) => s.today.offered > 0)
        .sort((a, b) => b.today.offered - a.today.offered)
        .slice(0, 10)
        .map((s) => ({
          style: s.key,
          todayOffered: s.today.offered,
          todayRejectedPct: pct(s.today.rejected, s.today.offered),
          todayAlterationPct: pct(s.today.alteration, s.today.offered),
          last7DaysRejectedPct: pct(s.prior.rejected, s.prior.offered),
          last7DaysAlterationPct: pct(s.prior.alteration, s.prior.offered),
        })),
    };
  }

  if (has('INLINE_QC.VIEW')) {
    facts.inlineQc = {
      today: { checked: num(f.inlineQc.checked), rejected: num(f.inlineQc.rejected) },
      byUnit: split(trend.inlineQc, day, ['checked', 'rejected'])
        .filter((u) => u.today.checked > 0)
        .map((u) => ({
          unit: u.key,
          todayChecked: u.today.checked,
          todayRejectedPct: pct(u.today.rejected, u.today.checked),
          last7DaysRejectedPct: pct(u.prior.rejected, u.prior.checked),
        })),
    };
  }

  if (has('REJECTED_REGISTER.VIEW')) facts.rejectedNotRepairable = { todayPcs: num(f.rejected.pcs) };

  const approvals = f.approvals
    .filter((g) => has(`${g.documentType}.VIEW`))
    .map((g) => ({
      document: g.label,
      waiting: g.count,
      readerMayApprove: has(`${g.documentType}.APPROVE`),
      oldest: g.oldest ? { documentNo: g.oldest.documentNo, daysWaiting: g.oldest.ageDays } : null,
    }));
  if (approvals.length) facts.approvalsWaiting = approvals;

  return Object.keys(facts).length ? { day, ...facts } : null;
}

// ===========================================================================
//  THE CALL
// ===========================================================================

const SYSTEM = `You write the "Needs attention" lines at the top of the evening production summary of a bag and tote export factory in Jaipur. The reader is a manager or the Director, reading on a phone.

You are given JSON: today's figures and, for comparison, the previous 7 calendar days. "usualPcsPerWorkingDay" is averaged over the days that had entries. "changePct" is today against that usual figure. "readerMayApprove" means the waiting documents are the reader's own to decide.

Write between 0 and ${MAX_POINTS} points, most important first. Each point is one short sentence of at most 20 words that names the unit, style or document and gives the figure, for example: "Unit 3 stitched 410 pcs, 40% below its usual 690." or "PO-0012 has waited 4 days for your approval."

What deserves a point:
- a unit, or cutting, more than about 25% off its usual output, or a unit that usually works and recorded nothing today;
- a style or unit whose rejection or alteration rate today is clearly above its last 7 days, on a meaningful number of pieces;
- documents waiting more than 2 days, above all ones the reader may approve.

Rules:
- Use only the figures in the JSON. Quote the percentages given; do not calculate new ones, estimate, or guess at causes.
- A figure that is null means there is nothing to compare against; do not comment on it.
- Leave out what is normal. The full figures are printed beneath your points.
- If nothing stands out, return no points.
- Plain English. No markdown, no emoji.`;

const SCHEMA = {
  type: 'object',
  properties: { points: { type: 'array', items: { type: 'string' } } },
  required: ['points'],
  additionalProperties: false,
};
const Answer = z.object({ points: z.array(z.string().trim().min(1).max(300)) });

let client = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 }));

/**
 * Claude's points for one reader's facts.
 *
 * @returns {Promise<string[] | null>}  null when there is no briefing to add -
 *          switched off, or anything at all went wrong
 */
export async function writeBriefing(facts) {
  if (!facts || !briefingEnabled()) return null;
  try {
    const response = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // A declined request is re-run on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
    });
    if (response.stop_reason !== 'end_turn') {
      process.stderr.write(`[daily-summary] briefing skipped: stop_reason ${response.stop_reason}\n`);
      return null;
    }
    const text = response.content.find((b) => b.type === 'text')?.text ?? '';
    const answer = Answer.safeParse(JSON.parse(text));
    if (!answer.success) {
      process.stderr.write('[daily-summary] briefing skipped: answer did not match the schema\n');
      return null;
    }
    return answer.data.points.slice(0, MAX_POINTS);
  } catch (err) {
    process.stderr.write(`[daily-summary] briefing skipped: ${err?.message ?? err}\n`);
    return null;
  }
}

/**
 * The summary with the briefing on top. Pure. Without points it is the
 * summary unchanged; with none to make it says so, which is news too.
 */
export function withBriefing(message, points) {
  if (!message || !points) return message;
  const head = [HEADING, ...(points.length ? points.map((p) => `• ${p}`) : [NOTHING])];
  return { ...message, briefing: points, body: `${head.join('\n')}\n\n${message.body}` };
}
