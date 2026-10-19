/**
 * Document numbering.
 *
 * Numbers come from `document_sequences`, keyed on (documentType, scopeKey).
 * scopeKey is what lets one document type run several independent counters -
 * required by the PO rule "vendor initial + no", where RF-001 and MA-001 are
 * separate series.
 *
 * The counter is incremented with an atomic UPDATE ... RETURNING inside the
 * caller's transaction, so two concurrent documents can never take the same
 * number.
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Reserves the next number for a document type.
 *
 * @param {string} documentType   A DocumentType enum value
 * @param {object} [opts]
 * @param {string} [opts.scopeKey] Independent counter key (default '')
 * @param {import('@prisma/client').Prisma.TransactionClient} [opts.tx]
 *        Pass the transaction client when numbering inside a wider transaction,
 *        so a rolled-back document does not burn a number.
 * @returns {Promise<string>} e.g. "GP-008", "RF-005"
 */
export async function nextNumber(documentType, { scopeKey = '', tx } = {}) {
  const client = tx ?? prisma;

  const rows = await client.$queryRaw`
    UPDATE document_sequences
       SET next_number = next_number + 1,
           updated_at  = NOW()
     WHERE document_type = ${documentType}::"DocumentType"
       AND scope_key = ${scopeKey}
    RETURNING next_number - 1 AS reserved, prefix, suffix, separator, pad_length
  `;

  if (!rows.length) {
    throw ApiError.badRequest(
      `No document sequence configured for ${documentType}${scopeKey ? ` / ${scopeKey}` : ''}`,
      { documentType, scopeKey },
    );
  }

  const [seq] = rows;
  const padded = String(seq.reserved).padStart(Number(seq.pad_length), '0');
  return `${seq.prefix}${seq.prefix ? seq.separator : ''}${padded}${seq.suffix}`;
}

/**
 * Reserves the next number that no document already holds.
 *
 * `taken(no)` says whether a number is in use. A number somebody typed by hand
 * can sit ahead of the counter; drawing it again would refuse the next person
 * to save, for a number they never typed. Gives up after a run of collisions
 * rather than spinning.
 */
export async function nextFreeNumber(documentType, taken, opts = {}) {
  for (let i = 0; i < 50; i += 1) {
    const no = await nextNumber(documentType, opts);
    if (!(await taken(no))) return no;
  }
  throw ApiError.conflict(
    `Could not find a free ${documentType} number - the numbering needs looking at`,
    { documentType },
  );
}

/**
 * Moves the counter past a number that was typed by hand.
 *
 * When the typed number is in the sequence's own format - SO-00034 for a
 * BUYER_ORDER sequence at 33 - the counter is moved on so the system never
 * offers it to anyone else. A number in any other format is left alone: it
 * cannot collide with what the sequence produces.
 */
export async function advancePast(documentType, typed, { scopeKey = '', tx } = {}) {
  const client = tx ?? prisma;
  const seq = await client.documentSequence.findUnique({
    where: { documentType_scopeKey: { documentType, scopeKey } },
  });
  if (!seq || !typed) return;

  const head = `${seq.prefix}${seq.prefix ? seq.separator : ''}`;
  const value = String(typed);
  if (!value.startsWith(head) || !value.endsWith(seq.suffix)) return;
  const digits = value.slice(head.length, value.length - seq.suffix.length);
  if (!/^\d+$/.test(digits)) return;

  const n = Number(digits);
  // next_number is an INT column.
  if (!Number.isSafeInteger(n) || n >= 2147483647) return;
  await client.$executeRaw`
    UPDATE document_sequences
       SET next_number = ${n + 1},
           updated_at  = NOW()
     WHERE document_type = ${documentType}::"DocumentType"
       AND scope_key = ${scopeKey}
       AND next_number <= ${n}
  `;
}

/** Reads the next number without consuming it, for a "will be numbered" hint. */
export async function peekNumber(documentType, { scopeKey = '' } = {}) {
  const seq = await prisma.documentSequence.findUnique({
    where: { documentType_scopeKey: { documentType, scopeKey } },
  });
  if (!seq) return null;
  const padded = String(seq.nextNumber).padStart(seq.padLength, '0');
  return `${seq.prefix}${seq.prefix ? seq.separator : ''}${padded}${seq.suffix}`;
}
