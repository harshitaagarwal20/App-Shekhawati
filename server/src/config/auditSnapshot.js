/**
 * How an audited row is represented, and how two representations are compared.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS IS ITS OWN FILE
 *
 *  Two places need it and neither should own it: the Prisma extension in
 *  prisma.js writes the snapshots, and audit.service.js reads them back and
 *  diffs them. If the writer and the reader disagreed about how a Decimal is
 *  stored, every rate change in the system would show up as a spurious edit -
 *  or worse, a real one would not show up at all.
 *
 *  It imports `Prisma` for the Decimal check only. That is the namespace, not
 *  the client: nothing here opens a connection, which is what lets the rules
 *  tests exercise the redaction without a database.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import { IGNORED_FIELDS, REDACTED } from './auditedTables.js';

/**
 * Reduces a Prisma row to something the Json column can hold.
 *
 * Decimals become strings so that they survive without passing through a float,
 * and dates become ISO strings. Redacted columns are dropped entirely rather
 * than masked, so that no trace of a secret is stored even in a "before" row.
 */
export function snapshot(row) {
  if (!row || typeof row !== 'object') return null;

  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (REDACTED.has(key)) continue;

    if (value === null || value === undefined) {
      out[key] = null;
    } else if (Prisma.Decimal.isDecimal(value)) {
      out[key] = value.toString();
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (typeof value === 'bigint') {
      out[key] = value.toString();
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * The fields that actually moved between two row snapshots.
 *
 * Values are compared as strings because that is how they were stored: a
 * Decimal written as "12.50" and one written as "12.5" are the same number, and
 * reporting them as a change would be a lie the reader has to check by hand.
 *
 * Audit columns are skipped - `updatedAt` changes on every write by definition,
 * and listing it would bury the one field somebody actually edited.
 */
export function changedFields(before, after) {
  if (!before || !after) return [];

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];

  for (const field of keys) {
    if (IGNORED_FIELDS.has(field)) continue;

    const from = before[field];
    const to = after[field];
    if (!sameValue(from, to)) {
      changes.push({ field, from: from ?? null, to: to ?? null });
    }
  }
  return changes;
}

/**
 * Whether two stored values are the same.
 *
 * `null`, `undefined` and an absent key all mean "no value" and must compare
 * equal, or adding a column to a table would report every existing row as
 * edited. An empty string is NOT the same as no value - somebody clearing a
 * remark is a real change.
 */
function sameValue(a, b) {
  const aEmpty = a === null || a === undefined;
  const bEmpty = b === null || b === undefined;
  if (aEmpty || bEmpty) return aEmpty && bEmpty;

  // Json columns arrive as objects; compare them by content.
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return String(a) === String(b);
}
