/**
 * Workflow and document-state components.
 *
 * ---------------------------------------------------------------------------
 *  DRAFT, APPROVED AND REJECTED MUST NOT LOOK ALIKE
 *
 *  These screens carry documents at eight different points of the same
 *  lifecycle, and the consequences of confusing two of them are real: printing
 *  a draft purchase order and sending it to a vendor, or cutting against a plan
 *  whose latest version was rejected.
 *
 *  So state is never rendered as a bare word in a table cell. `StateBadge`
 *  gives each state its own colour and shape, and `WorkflowTrail` shows the
 *  whole history rather than just where it ended up.
 * ---------------------------------------------------------------------------
 */

import { fmtDateTime, fmtEnum } from '../utils/format.js';
import TableWrap from '../components/TableWrap.jsx';

/** Colour and wording for each workflow state. Held once. */
const STATE_STYLE = {
  DRAFT: { cls: 'state-draft', label: 'Draft', hint: 'Not submitted. Nothing acts on it yet.' },
  SUBMITTED: { cls: 'state-submitted', label: 'Submitted', hint: 'Handed in, not yet with an approver.' },
  PENDING_APPROVAL: {
    cls: 'state-pending',
    label: 'Pending approval',
    hint: 'On the approver’s desk.',
  },
  APPROVED: { cls: 'state-approved', label: 'Approved', hint: 'Decided. It does not change.' },
  REJECTED: { cls: 'state-rejected', label: 'Rejected', hint: 'Refused, with a reason.' },
  RECTIFICATION: {
    cls: 'state-rectification',
    label: 'Under rectification',
    hint: 'Being corrected after a rejection.',
  },
  RESUBMITTED: { cls: 'state-submitted', label: 'Resubmitted', hint: 'Corrected and sent back.' },
  CANCELLED: { cls: 'state-cancelled', label: 'Cancelled', hint: 'Stopped. It moves no further.' },
};

/**
 * The workflow state, as a badge.
 *
 * `size="lg"` for a detail header, the default for a table cell.
 */
export function StateBadge({ state, size = '', title }) {
  const style = STATE_STYLE[state] ?? { cls: 'state-draft', label: fmtEnum(state) };
  return (
    <span className={`state-badge ${style.cls} ${size === 'lg' ? 'state-lg' : ''}`} title={title ?? style.hint}>
      {style.label}
    </span>
  );
}

/*
 * THE FOUR-STEP PROGRESS BAR IS GONE, deliberately.
 *
 * It drew Draft / Submitted / Pending approval / Approved as a row of pills
 * above every detail screen. Three things were wrong with it:
 *
 *   IT SAID WHAT THE BADGE ALREADY SAID. `StateBadge` names the state, in one
 *   pill, in the same colour language, right beside it. The bar was the same
 *   fact spread across a quarter of the screen.
 *
 *   IT BROKE ON A NARROW SCREEN. Five pills that will not wrap inside a phone
 *   width stacked into a ragged block that pushed the actual document below
 *   the fold.
 *
 *   IT DREW STEPS IT COULD NOT NAME. A path state with no entry in
 *   STATE_STYLE rendered as a bare numbered dot with an empty label - a
 *   circled "5" sitting on screen meaning nothing to anybody.
 *
 * The state is on the badge and the history is in `WorkflowTrail`, which
 * carries who decided what and when - the part a reader actually cannot get
 * from anywhere else.
 */

/**
 * The approval trail: every transition, who made it and when.
 *
 * Every approvable document in this system renders this same component, which
 * is the visible payoff of one shared engine - a user who learns the trail on
 * purchase orders already knows it on plans.
 */
export function WorkflowTrail({ history = [], title = 'Approval trail', emptyMessage }) {
  return (
    <div className="card">
      <div className="card-header">{title}</div>
      <TrailTable history={history} emptyMessage={emptyMessage} />
    </div>
  );
}

/**
 * The trail's table on its own, for a screen that shows it inside a card of its
 * own alongside something else - an order's amendments, a plan's allocations.
 */
export function TrailTable({ history = [], emptyMessage }) {
  return (
    <TableWrap>
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>When</th>
            <th>Action</th>
            <th>From &rarr; To</th>
            <th>By</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id}>
              <td className="faint">{h.sequenceNo}</td>
              <td className="nowrap">{fmtDateTime(h.actedAt)}</td>
              <td>{fmtEnum(h.action)}</td>
              <td className="muted nowrap">
                {h.fromStatus ? fmtEnum(h.fromStatus) : '-'} &rarr;{' '}
                {h.toStatus ? fmtEnum(h.toStatus) : '-'}
              </td>
              <td>{h.actedByName ?? '-'}</td>
              <td className="muted">{h.remarks ?? '-'}</td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr>
              <td colSpan={6} className="muted" style={{ padding: 20 }}>
                {emptyMessage ?? 'Nothing recorded yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </TableWrap>
  );
}

/**
 * The excess picture, with every figure the brief asks to be identified.
 *
 * Rendered from the server's assessment - base quantity, permitted percentage,
 * permitted quantity, actual excess, excess percentage - and never recomputed
 * here. The percentage shown is whatever the CONFIGURED rule resolved to, with
 * the basis printed underneath, so a user can see where the number came from
 * rather than assuming it is 2%.
 */
export function ExcessPanel({ excess, title = 'Excess check' }) {
  if (!excess) return null;

  const tone = excess.within ? 'ok' : excess.refused ? 'bad' : 'warn';

  return (
    <div className={`card excess-panel excess-${tone}`}>
      <div className="card-header">
        <span>{title}</span>
        <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
          {excess.rule?.scope ? `rule: ${fmtEnum(excess.rule.scope)}` : ''}
        </span>
      </div>
      <div className="card-body">

        <p className="muted" style={{ marginBottom: 4 }}>{excess.explanation}</p>
        {excess.rule?.basis && (
          <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>
            Threshold: {excess.rule.basis}
          </p>
        )}
      </div>
    </div>
  );
}

export default StateBadge;
