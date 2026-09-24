/**
 * MULTI-LINE DOCUMENTS - the rules shared by the PO, the quotation and the GRN.
 *
 * A purchase order, a vendor quotation and a goods receipt are each ONE
 * document (a header: vendor, date, number, bill) holding one or more LINES.
 * The line rows are the tables that existed before - purchase_orders,
 * vendor_quotations, grns - because every per-item control lives on them.
 *
 * Pure: no database, so the numbering and the line checks are unit tested.
 */

/**
 * A line's own reference, from its document number.
 *
 * Line 1 carries the document number BARE, and later lines a suffix:
 *
 *     RF-012      line 1
 *     RF-012/2    line 2
 *
 * so every single-line document - which is every document that existed
 * before multi-line - keeps exactly the number it always had, and the stock
 * ledger, the gate pass and the printed paper all still read the same.
 */
export function lineNumber(documentNo, lineNo) {
  if (!documentNo) throw new Error('A line needs its document number');
  const n = Number(lineNo);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Line number must be 1 or more, not ${lineNo}`);
  return n === 1 ? String(documentNo) : `${documentNo}/${n}`;
}

/** The same material twice on one document is one line entered twice. */
export function duplicateMaterial(lines, keyOf) {
  const seen = new Map();
  for (const [i, l] of lines.entries()) {
    const key = keyOf(l);
    if (seen.has(key)) return { first: seen.get(key), second: i, key };
    seen.set(key, i);
  }
  return null;
}

/**
 * The state of a whole document, from its lines.
 *
 * A document is only as far along as its least-advanced live line. Rejected
 * and cancelled lines are ignored unless nothing else is left.
 */
export function documentStatus(lines) {
  const live = lines.filter((l) => !['REJECTED', 'CANCELLED'].includes(l.status));
  if (!lines.length) return 'EMPTY';
  if (!live.length) return lines.every((l) => l.status === 'REJECTED') ? 'REJECTED' : 'CANCELLED';
  if (live.some((l) => l.status === 'PENDING')) {
    return live.every((l) => l.status === 'PENDING') ? 'PENDING' : 'PARTLY_APPROVED';
  }
  return 'APPROVED';
}
