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
 *  gives each state its own colour and shape, `LockNotice` says out loud when a
 *  document has stopped moving and why, and `WorkflowTrail` shows the whole
 *  history rather than just where it ended up.
 *
 *  THE BUTTONS COME FROM THE SERVER
 *
 *  `WorkflowActions` renders whatever `allowed` the API returned for this
 *  document's state - the transition table in approvalEngine.js, rendered. A
 *  screen that builds its own buttons drifts from the server's rules the first
 *  time either changes; this one cannot offer an action the server would
 *  refuse.
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

/**
 * Says out loud that a document has stopped moving, and why.
 *
 * A locked document with no explanation is the single most common way a user
 * concludes the system is broken - they press Edit, nothing happens, and there
 * is nowhere on the screen that says the record is finished.
 */
export function LockNotice({ locked, reason, children }) {
  if (!locked) return null;
  return (
    <div className="lock-notice" role="status">
      <span className="lock-icon" aria-hidden="true">
        🔒
      </span>
      <div>
        <strong>This document is locked.</strong>
        {reason && <div className="muted">{reason}</div>}
        {children}
      </div>
    </div>
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
 * The actions this document may take next.
 *
 * Rendered from the server's own transition table, and filtered by what the
 * user is allowed to do - `can` hides an action the API would refuse, which is
 * a convenience; the API refuses it regardless, which is the security.
 */
export function WorkflowActions({ allowed = [], permission, can, onAction, busy }) {
  const permitted = !permission || can?.(permission);
  const actionable = allowed.filter((a) => a.to !== 'DRAFT');
  if (!permitted || actionable.length === 0) return null;

  return (
    <div className="row workflow-actions">
      {actionable.map((a) => (
        <button
          key={a.to}
          type="button"
          className={`btn btn-sm ${a.to === 'APPROVED' ? 'btn-primary' : ''} ${
            a.to === 'REJECTED' || a.to === 'CANCELLED' ? 'btn-danger' : ''
          }`}
          disabled={busy}
          onClick={() => onAction(a)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

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
    </div>
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
