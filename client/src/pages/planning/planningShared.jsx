import { fmtDate, fmtDateTime, fmtPctFromFraction } from '../../utils/format.js';
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

/**
 * FABRIC ON HAND for the style being planned - GET /plannings/fabric-stock.
 *
 * Every figure is the server's. Rolls are this style's when they were received
 * against a PO line for this order and style, the same link the Fabric Issue
 * roll picker uses. Nothing here is reserved for the plan.
 */
export function FabricStockPanel({ stock }) {
  const uom = stock.uom ?? '';
  const own = stock.forThisStyle;
  const rows = own?.byColour ?? [];
  const pending = stock.onOrder;
  const elsewhere = stock.elsewhereInColour;

  return (
    <div style={{ marginTop: 18 }}>
      <div className="fieldset-title">
        Fabric on hand
        <span className="faint"> &mdash; {stock.styleNo}, in {uom}</span>
      </div>

      {rows.length === 0 ? (
        <p className="faint" style={{ fontSize: 13 }}>
          No fabric bought for this style is in stock yet.
        </p>
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Colour</th>
                <th className="num">Available to issue</th>
                <th className="num">On hold</th>
                <th className="num">At job worker / cutting floor</th>
                <th className="num">Rolls</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.colorCode ?? ''}>
                  <td>{r.colorCode ?? <span className="faint">No colour</span>}</td>
                  <td className="num"><strong>{fmtQty(r.availableQty)}</strong></td>
                  <td className="num">{fmtQty(r.heldQty)}</td>
                  <td className="num">{fmtQty(r.inProcessQty)}</td>
                  <td className="num">{r.rollCount}</td>
                </tr>
              ))}
              {rows.length > 1 && (
                <tr>
                  <td><strong>Total</strong></td>
                  <td className="num"><strong>{fmtQty(own.availableQty)}</strong></td>
                  <td className="num">{fmtQty(own.heldQty)}</td>
                  <td className="num">{fmtQty(own.inProcessQty)}</td>
                  <td className="num">{own.rollCount}</td>
                </tr>
              )}
            </tbody>
          </table>
        </TableWrap>
      )}

      <ul className="faint" style={{ fontSize: 12, margin: '6px 0 0', paddingLeft: 18 }}>
        {pending?.poCount > 0 && (
          <li>
            Still to arrive: <strong>{fmtQty(pending.pendingQty)} {uom}</strong> on {pending.poCount} open
            PO{pending.poCount === 1 ? '' : 's'}
            {pending.awaitingApprovalCount > 0 && ` (${pending.awaitingApprovalCount} awaiting approval)`}.
          </li>
        )}
        {elsewhere && Number(elsewhere.availableQty) > 0 && (
          <li>
            Also in the store in {stock.colorCode}, bought for other orders or in bulk:{' '}
            <strong>{fmtQty(elsewhere.availableQty)} {uom}</strong> ({elsewhere.rollCount} roll
            {elsewhere.rollCount === 1 ? '' : 's'}).
          </li>
        )}
        {stock.otherUnitRollCount > 0 && (
          <li>
            {stock.otherUnitRollCount} roll{stock.otherUnitRollCount === 1 ? ' is' : 's are'} held in a unit
            other than {uom} and {stock.otherUnitRollCount === 1 ? 'is' : 'are'} not counted above.
          </li>
        )}
        <li>Stock as of {fmtDateTime(stock.asOf)}. Nothing is reserved for this plan.</li>
      </ul>
    </div>
  );
}

/**
 * Whether the store covers the fabric a cutting plan will draw - the preview's
 * `fabricCover`, worked out by the server against the same stock as the panel.
 */
export function FabricCoverNote({ cover, stock }) {
  if (!cover) return null;
  const uom = cover.uom ?? '';

  if (cover.covered) {
    return (
      <Note kind="info">
        This plan draws <strong>{fmtQty(cover.neededQty)} {uom}</strong> of fabric, and{' '}
        {fmtQty(cover.availableQty)} {uom} bought for this style is available to issue.
      </Note>
    );
  }

  const inProcess = Number(stock?.forThisStyle?.inProcessQty ?? 0);
  const pending = stock?.onOrder;
  const elsewhere = stock?.elsewhereInColour;
  return (
    <Note kind="warning">
      This plan draws <strong>{fmtQty(cover.neededQty)} {uom}</strong> of fabric, but only{' '}
      {fmtQty(cover.availableQty)} {uom} bought for this style is available to issue &mdash;{' '}
      <strong>short by {fmtQty(cover.shortQty)} {uom}</strong>.
      {inProcess > 0 && ` ${fmtQty(inProcess)} ${uom} is at a job worker or on the cutting floor.`}
      {pending?.poCount > 0 && ` ${fmtQty(pending.pendingQty)} ${uom} is still to arrive on open POs.`}
      {elsewhere && Number(elsewhere.availableQty) > 0
        && ` ${fmtQty(elsewhere.availableQty)} ${uom} in ${stock.colorCode} is in the store for other orders.`}
      {' '}The plan can still be saved.
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
