import { fmtDate, fmtPctFromFraction } from '../../utils/format.js';
import TableWrap from '../../components/TableWrap.jsx';
/**
 * Formatting and labels shared by the Planning screens.
 *
 * Nothing here computes a plan quantity. The totals, the ceiling and the
 * verdict all arrive from the API already worked out; these helpers only decide
 * how to print them.
 */

// Dates come from the shared formatter: DD-MM-YYYY, Asia/Kolkata. Imported as
// well as re-exported, because this module renders a few of them itself.
export { fmtDate, fmtDateTime, fmtEnum } from '../../utils/format.js';

export const fmtQty = (v) =>
  v === null || v === undefined ? '-' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });


/** The four workflow states the server derives. */
export const STATE_LABEL = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting decision',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export const STATE_BADGE = {
  DRAFT: 'badge-inactive',
  SUBMITTED: 'badge-pending',
  APPROVED: 'badge-approved',
  REJECTED: 'badge-rejected',
};

/**
 * Explains, in the order's own terms, why the ceiling sits where it does. This
 * is the difference between "you cannot plan 5200" and "5200 needs the 2%
 * excess that is still with the Director".
 */
export function CeilingNote({ allocation }) {
  if (!allocation) return null;

  const requested = Number(allocation.excessRequestedPct);
  const approved = Number(allocation.excessApprovedPct);

  if (allocation.excessApprovalStatus === 'PENDING') {
    return (
      <Note kind="warning">
        This order requests an excess of {fmtPctFromFraction(requested)}, but the Director has not approved it.
        Until that decision is taken the plan may allot no more than{' '}
        <strong>{fmtQty(allocation.permittedQty)}</strong> pieces &mdash; the plain order quantity.
      </Note>
    );
  }
  if (allocation.excessApprovalStatus === 'REJECTED') {
    return (
      <Note kind="warning">
        The excess requested on this order was rejected, so the ceiling is the plain order quantity
        of <strong>{fmtQty(allocation.permittedQty)}</strong> pieces.
      </Note>
    );
  }
  if (allocation.excessApprovalStatus === 'APPROVED') {
    return (
      <Note kind="info">
        The Director approved an excess of {fmtPctFromFraction(approved)}, so this order may be planned up to{' '}
        <strong>{fmtQty(allocation.permittedQty)}</strong> pieces &mdash;{' '}
        {fmtQty(allocation.excessHeadroomQty)} above the {fmtQty(allocation.orderQty)} ordered.
      </Note>
    );
  }
  return (
    <Note kind="info">
      This order asks for no excess, so the plan may allot up to its order quantity of{' '}
      <strong>{fmtQty(allocation.permittedQty)}</strong> pieces.
    </Note>
  );
}

function Note({ kind, children }) {
  return (
    <div className={`alert alert-${kind}`} role="status">
      <div>{children}</div>
    </div>
  );
}

/** Per-unit rollup - the figures Cutting Issue later draws its quantities from. */
/**
 * One column, named by the department - the same rule the grid follows.
 * Mirrors ALLOTMENT_LABEL in planning.service.js.
 */
const ALLOTMENT_LABEL = {
  CUTTING: 'Pieces to Cut',
  STITCHING: 'Pieces to Stitch',
  IRON: 'Pieces to Iron',
  PACKING: 'Produced Pieces',
  SHIPPING: 'Produced Pieces',
};

export function UnitAllocationTable({ rows, planDepartment }) {
  const isCutting = planDepartment === 'CUTTING';
  if (!rows?.length) return null;
  return (
    <TableWrap>
      <table className="data">
        <thead>
          <tr>
            <th>Unit</th>
            <th className="num">Days</th>
            <th>From</th>
            <th>To</th>
            <th className="num">{ALLOTMENT_LABEL[planDepartment] ?? 'Allotted'}</th>
            {isCutting && <th className="num">Fabric to Issue</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.unit}>
              <td>{u.unit}</td>
              <td className="num">{u.lineCount}</td>
              <td className="nowrap">{fmtDate(u.firstDate)}</td>
              <td className="nowrap">{fmtDate(u.lastDate)}</td>
              <td className="num">
                <strong>{fmtQty(u.deliverableSize)}</strong>
              </td>
              {isCutting && (
                <td className="num faint">
                  {`${fmtQty(u.fabricQty)} ${u.fabricUom ?? ''}`.trim()}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
