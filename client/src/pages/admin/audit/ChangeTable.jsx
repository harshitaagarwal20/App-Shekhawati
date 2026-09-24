/**
 * A before-and-after table for one set of field changes.
 *
 * Shared by the entry detail and the record trail, because "what actually
 * changed" looks the same wherever it is asked.
 */

import { fmtDateTime } from '../../../utils/format.js';
import TableWrap from '../../../components/TableWrap.jsx';

/**
 * Renders a stored value for a person.
 *
 * Everything arrives from the server as a string, a number, a boolean or null,
 * because the audit snapshot normalises Decimals and Dates on the way in. That
 * leaves three cases worth handling by hand: nothing at all, a timestamp, and
 * an object that got through (a Json column).
 */
function Value({ value }) {
  if (value === null || value === undefined || value === '') {
    return <span className="muted">— empty —</span>;
  }
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'object') {
    return <code style={{ fontSize: 12 }}>{JSON.stringify(value)}</code>;
  }
  // An ISO timestamp is unreadable in a table; a date is not.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return <span>{fmtDateTime(value)}</span>;
  }
  return <span>{String(value)}</span>;
}

/** Turns `colorCode` / `qtyIn` into `Color code` / `Qty in`. */
export function humanField(field) {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bId\b/g, 'ID')
    .trim();
}

export default function ChangeTable({ changes, emptyMessage = 'No field values changed.' }) {
  if (!changes?.length) {
    return <p className="muted" style={{ margin: 0 }}>{emptyMessage}</p>;
  }

  return (
    <TableWrap>
      <table className="data">
        <thead>
          <tr>
            <th>Field</th>
            <th>Was</th>
            <th>Became</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.field}>
              <td>{humanField(c.field)}</td>
              <td><Value value={c.from} /></td>
              <td><strong><Value value={c.to} /></strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
