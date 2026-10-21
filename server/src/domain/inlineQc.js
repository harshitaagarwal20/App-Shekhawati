/**
 * Inline QC - the field rules and who may resolve a defect.
 *
 * Pure functions, no database, so test/inlineQc.rules.test.js can prove each
 * one on a bare Node install. inlineQc.service.js calls these and nothing
 * else decides them.
 *
 * ---------------------------------------------------------------------------
 *  ONE SCREEN, TWO WORKBOOK SHEETS
 *
 *      Check Type SIZE          "QC Size"     Operation and Size measurement
 *                                             are required
 *      Check Type WORKMANSHIP   "QC Defects"  neither is asked for, and
 *                                             neither is kept
 *
 *  Both: Pcs Checked > 0, 0 <= Pcs Rejected <= Pcs Checked, Defects Found
 *  from the Defect Type list (several), and Inform To.
 *
 *  THE TWO RULES THE WORKBOOK LEAVES IMPLICIT
 *
 *    - A rejected piece was rejected FOR something: Pcs Rejected above zero
 *      needs at least one defect.
 *    - A defect found goes to SOMEBODY: any defect needs Inform To, because
 *      that person's Action needed list is where it lands.
 *
 *  A clean check (nothing rejected, no defect) needs neither.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v ?? 0);

export const CHECK_TYPES = [
  { key: 'SIZE', label: 'Size' },
  { key: 'WORKMANSHIP', label: 'Workmanship' },
];

export const checkTypeLabel = (key) => CHECK_TYPES.find((t) => t.key === key)?.label ?? key;

const blank = (v) => v == null || String(v).trim() === '';

/**
 * Defects as entered: trimmed, blanks dropped, a repeat kept once, the order
 * the checker ticked them in.
 */
export function normaliseDefects(list = []) {
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const d = String(raw ?? '').trim();
    if (!d) continue;
    const key = d.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/**
 * What is wrong with an entry, as a list of { field, message }. Empty when
 * it may be saved. The database holds the same rules as CHECK constraints.
 */
export function entryProblems({ checkType, operation, sizeMeasurement, pcsChecked, pcsRejected, defects = [], informToUserId }) {
  const problems = [];
  const add = (field, message) => problems.push({ field, message });

  if (!CHECK_TYPES.some((t) => t.key === checkType)) add('checkType', 'Choose Size or Workmanship');
  if (checkType === 'SIZE') {
    if (blank(operation)) add('operation', 'A size check names the operation checked');
    if (blank(sizeMeasurement)) add('sizeMeasurement', 'A size check records the size measured');
  }

  const checked = D(pcsChecked);
  const rejected = D(pcsRejected);
  if (checked.lessThanOrEqualTo(0)) add('pcsChecked', 'Enter the pieces checked');
  if (rejected.lessThan(0)) add('pcsRejected', 'Pcs Rejected cannot be negative');
  if (rejected.greaterThan(checked) && checked.greaterThan(0)) {
    add('pcsRejected', `${rejected} rejected is more than the ${checked} checked`);
  }

  const found = normaliseDefects(defects);
  if (rejected.greaterThan(0) && found.length === 0) {
    add('defects', 'Choose the defect(s) the rejected pieces had');
  }
  if (found.length > 0 && blank(informToUserId)) {
    add('informToUserId', 'Choose who to inform - the defects go to their Action needed list');
  }
  return problems;
}

/**
 * Operation and Size belong to a Size check only. A Workmanship entry keeps
 * neither, whatever the form sent - the toggle may have been flipped after
 * they were typed.
 */
export function sizeFieldsFor(checkType, { operation, sizeMeasurement }) {
  if (checkType !== 'SIZE') return { operation: null, sizeMeasurement: null };
  return {
    operation: blank(operation) ? null : String(operation).trim(),
    sizeMeasurement: blank(sizeMeasurement) ? null : String(sizeMeasurement).trim(),
  };
}

/** Rejected as a share of checked, "12.5%"; "-" when nothing was checked. */
export function rejectionPct(pcsChecked, pcsRejected) {
  const checked = D(pcsChecked);
  if (checked.lessThanOrEqualTo(0)) return '-';
  return `${D(pcsRejected).dividedBy(checked).times(100).toFixed(1)}%`;
}

/**
 * Which defect lines an edit adds, keeps and drops. Matched by name, without
 * regard to case, so "stain" and "Stain" are one defect and a kept line keeps
 * its status (a defect already resolved stays resolved).
 *
 * @param existing [{ id, defect, status }]
 * @param wanted   defect names, as entered
 */
export function diffDefects(existing, wanted) {
  const want = normaliseDefects(wanted);
  const wantKeys = new Set(want.map((d) => d.toLowerCase()));
  const haveKeys = new Set(existing.map((e) => e.defect.toLowerCase()));
  return {
    add: want.filter((d) => !haveKeys.has(d.toLowerCase())),
    keep: existing.filter((e) => wantKeys.has(e.defect.toLowerCase())),
    drop: existing.filter((e) => !wantKeys.has(e.defect.toLowerCase())),
  };
}

/**
 * May this login mark a defect Resolved (or reopen it)?
 *
 * The person named in Inform To, while they still hold INLINE_QC.RESOLVE.
 * Admin may, so a defect is never stranded on someone who has left. Nobody
 * else - not the checker who found it, and not another supervisor.
 */
export function mayResolve({ userId, isAdmin, canResolve }, { informToUserId }) {
  if (isAdmin) return true;
  return Boolean(canResolve) && Boolean(informToUserId) && informToUserId === userId;
}
