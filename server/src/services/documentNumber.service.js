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

/** Reads the next number without consuming it, for a "will be numbered" hint. */
export async function peekNumber(documentType, { scopeKey = '' } = {}) {
  const seq = await prisma.documentSequence.findUnique({
    where: { documentType_scopeKey: { documentType, scopeKey } },
  });
  if (!seq) return null;
  const padded = String(seq.nextNumber).padStart(seq.padLength, '0');
  return `${seq.prefix}${seq.prefix ? seq.separator : ''}${padded}${seq.suffix}`;
}

export async function listSequences() {
  return prisma.documentSequence.findMany({
    orderBy: [{ documentType: 'asc' }, { scopeKey: 'asc' }],
  });
}
