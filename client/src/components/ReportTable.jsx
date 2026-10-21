/**
 * One report's rows, rendered from the columns the server declared.
 *
 * Shared by the Reports screen and the Inventory Analysis screen, so a figure
 * reads the same wherever the report is opened. Every value arrives already
 * computed and rounded; this chooses the typography and nothing else.
 */

import { useNavigate } from 'react-router-dom';
import { EmptyState, StatusBadge } from './ui.jsx';
import { StateBadge } from './workflow.jsx';
import { fmtDate, fmtMoney, fmtNum } from '../utils/format.js';
import TableWrap from './TableWrap.jsx';

export const isNumeric = (format) => format === 'qty' || format === 'money';

export default function ReportTable({ report }) {
  const navigate = useNavigate();
  return (
    <TableWrap>
      <table className="data">
        <thead>
          <tr>
            {report.columns.map((col) => (
              <th key={col.key} className={isNumeric(col.format) ? 'num' : ''}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 && (
            <tr>
              <td colSpan={report.columns.length}>
                <EmptyState title="Nothing to report" />
              </td>
            </tr>
          )}
          {report.rows.map((row, i) => (
            <tr className="clickable"
              // Grouped reports (by order, by reason ...) have no row id; the
              // position is stable for one render of one page.
              key={row.id ?? i}
              onClick={row.route ? () => navigate(row.route) : undefined}
              style={row.route ? { cursor: 'pointer' } : undefined}
            >
              {report.columns.map((col) => (
                <td key={col.key} className={isNumeric(col.format) ? 'num' : ''}>
                  <ReportCell value={row[col.key]} format={col.format} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

/** One cell, rendered by the format the server declared. */
export function ReportCell({ value, format }) {
  if (value === null || value === undefined || value === '') {
    return <span className="faint">—</span>;
  }
  switch (format) {
    case 'qty':
      return fmtNum(value);
    case 'money':
      return fmtMoney(value);
    case 'date':
      return <span className="nowrap">{fmtDate(value)}</span>;
    case 'state':
      return <StateBadge state={value} />;
    default:
      // Status-shaped values get the badge; everything else is text.
      return /^[A-Z_]{3,}$/.test(String(value)) ? (
        <StatusBadge status={value} />
      ) : (
        String(value)
      );
  }
}
