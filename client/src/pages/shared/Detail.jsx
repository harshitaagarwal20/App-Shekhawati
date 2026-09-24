/**
 * Read-only detail primitives, shared by every detail screen.
 *
 * The pipeline is a chain of documents that each point at the one before it,
 * and the single most useful thing a detail screen can show is that chain. So
 * `TraceChain` is a component rather than a per-screen table: a user who learns
 * to read it on a purchase order reads it the same way on a GRN, a roll and a
 * cutting challan.
 */

import { Link } from 'react-router-dom';
import TableWrap from '../../components/TableWrap.jsx';

/** A labelled read-only value. */
/**
 * One label-and-value on a detail screen.
 *
 * ===========================================================================
 *  A FIELD WITH NOTHING IN IT DOES NOT RENDER
 * ===========================================================================
 *
 *  These panels are built from one set of columns covering every shape of
 *  record the module handles - a purchase order carries nine material columns
 *  so that it can describe fabric OR trim, and on any given order most of them
 *  are blank. Rendered anyway they turned an ordinary order into more dashes
 *  than data, and a dash reads as "this is missing" when the truth is "this
 *  does not apply to this record".
 *
 *  It is not missing data either: `itemIdentity()` builds a stock item from
 *  exactly those columns and uses '' for the ones that do not describe it. A
 *  blank GSM is not an unanswered question - it is not part of what the item
 *  is.
 *
 *  WHERE ABSENCE IS ITSELF THE FACT, PASS `showEmpty`.
 *
 *  "Cleared by" on a pass that has not been cleared is worth a row: the field
 *  existing and being empty is what says the step has not happened. Those are
 *  the exception and they say so at the call site.
 *
 *  ZERO IS A VALUE. This used to be `value || '-'`, so a genuine 0 - a
 *  quantity, a variance, a percentage - rendered as a dash and read as "not
 *  recorded". Only null, undefined and '' count as empty.
 */
export function Detail({ label, value, sub, mono, className = '', showEmpty = false }) {
  const isEmpty = value === null || value === undefined || value === '';
  if (isEmpty && !showEmpty) return null;

  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      <div className={mono ? 'mono' : ''} style={{ paddingTop: 2 }}>
        {isEmpty ? <span className="faint">-</span> : value}
      </div>
      {sub && <span className="hint">{sub}</span>}
    </div>
  );
}

export function DetailGrid({ children }) {
  return <div className="form-grid detail-grid">{children}</div>;
}

/**
 * The document chain: Order → Quotation → PO → Gate Pass → GRN → Roll → …
 *
 * Every link says whether it is actually present. A document raised without an
 * upstream reference is often legitimate - a PO can be raised without a
 * quotation - and that should look different from one whose reference was
 * deleted, so an absent link is stated rather than skipped.
 */
export function TraceChain({ title = 'Traceability', chain, links = [], complete, incompleteNote }) {
  return (
    <div className={`card trace-card ${complete ? 'trace-complete' : 'trace-partial'}`} style={{ marginBottom: 16 }}>
      <div className="card-header">
        <span>{title}</span>
        {chain && <span className="faint mono" style={{ fontWeight: 400, fontSize: 12 }}>{chain}</span>}
      </div>
      <div className="card-body">
        <div className="trace-links">
          {links.map((l, i) => (
            <div key={l.label} className={`trace-link ${l.current ? 'trace-current' : ''}`}>
              {i > 0 && (
                <span className="trace-arrow" aria-hidden="true">
                  →
                </span>
              )}
              <div className="trace-body">
                <div className="trace-label">{l.label}</div>
                <div className="trace-value mono">
                  {l.to ? <Link to={l.to}>{l.value}</Link> : l.value}
                </div>
                {l.sub && <div className="trace-sub">{l.sub}</div>}
                {l.warn && <div className="trace-warn">{l.warn}</div>}
              </div>
            </div>
          ))}
        </div>
        {incompleteNote && (
          <p className="muted" style={{ marginBottom: 0, marginTop: 10, fontSize: 12.5 }}>
            {incompleteNote}
          </p>
        )}
      </div>
    </div>
  );
}

/** A small table with a caption, for the "what hangs off this" panels. */
export function RelatedTable({ title, count, note, columns, rows, renderRow, emptyMessage, onRowClick }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <span>{title}</span>
        <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
          {note ?? (count !== undefined ? `${count} record(s)` : '')}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="card-body muted">{emptyMessage}</div>
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key ?? c.label} className={c.num ? 'num' : ''}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr className="clickable"
                  key={r.id}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  {renderRow(r)}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}
