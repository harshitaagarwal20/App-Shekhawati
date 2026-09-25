/**
 * Planning detail: header, the allotment grid, the server-calculated
 * allocation against the order, the per-unit rollup, and the approval flow.
 *
 * Every number rendered here arrives from the API already calculated.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { plannings as planningsApi } from '../../services/erp.js';
import {
  Alert,
  ConfirmDialog,
  EnumSelect,
  Field,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  TextArea,
} from '../../components/ui.jsx';
import PlanningForm from './PlanningForm.jsx';
import {
  CeilingNote,
  STATE_BADGE,
  STATE_LABEL,
  UnitAllocationTable,
  fmtDate,
  fmtQty, fmtDateTime, fmtEnum } from './planningShared.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const LINE_STATUS_OPTIONS = STATUS_OPTIONS.filter((o) => o.value !== 'CANCELLED');

export default function PlanningDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState(null); // 'submit' | 'approve' | 'reject' | 'recall' | 'revise'
  const [deleting, setDeleting] = useState(false);

  const canEdit = can('PLANNING.EDIT');
  // F-10: the permission says what this ROLE may do; `canApprove` from the
  // server says whether THIS user may approve THIS document - it is false
  // when they raised it themselves. Both must hold, or the button would be
  // offered and then refused with a 403.
  const canApprove = can('PLANNING.APPROVE') && plan?.canApprove !== false;
  const canDelete = can('PLANNING.DELETE');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlan(await planningsApi.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn, message) {
    setBusy(true);
    try {
      await fn();
      setBanner({ kind: 'success', text: message });
      await load();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    try {
      await planningsApi.remove(id);
      navigate('/planning', { replace: true });
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !plan) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading plan..." />
        </div>
      </div>
    );
  }
  if (!plan) return <Alert kind="error">{banner?.text ?? 'Plan not found'}</Alert>;

  const {
    allocation, unitAllocation, orderAllocation, usage, editable, approvals, history, lines,
  } = plan;

  /* A cutting plan allots the fabric that will be issued to the floor; the
     other three departments allot pieces. See planning.service.js. */
  const isCutting = plan.planDepartment === 'CUTTING';
  /* Only stitching is split across units - departmentUsesUnit on the server. */
  const usesUnit = plan.planDepartment === 'STITCHING';

  /* Mirrors ALLOTMENT_LABEL in planning.service.js. */
  const ALLOTMENT_LABEL = {
    CUTTING: 'Pieces to Cut',
    STITCHING: 'Pieces to Stitch',
    IRON: 'Pieces to Iron',
    PACKING: 'Produced Pieces',
    SHIPPING: 'Produced Pieces',
  };

  return (
    <>
      <PageHeader
        title={`Plan ${plan.planNo}${plan.version > 1 ? ` v${plan.version}` : ''}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/planning')}>
              Back to list
            </button>
            {canEdit && editable.canEditHeader && (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {canEdit && editable.canSubmit && (
              <button type="button" className="btn btn-primary" onClick={() => setDialog('submit')}>
                Submit for approval
              </button>
            )}
            {canEdit && editable.state === 'SUBMITTED' && (
              <button type="button" className="btn" onClick={() => setDialog('recall')}>
                Recall
              </button>
            )}
            {canEdit && editable.canRevise && (
              <button type="button" className="btn btn-primary" onClick={() => setDialog('revise')}>
                Revise
              </button>
            )}
            {canDelete && editable.canDelete && (
              <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>
                Delete
              </button>
            )}
          </>
        }
      />

      {banner && (
        <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Alert>
      )}

      {/* --- The ceiling, stated before anything else --------------------- */}
      {!allocation.withinPermitted && (
        <Alert kind="error">
          This plan allots <strong>{fmtQty(allocation.plannedQty)}</strong> pieces against an order
          that permits <strong>{fmtQty(allocation.permittedQty)}</strong> &mdash; over by{' '}
          {fmtQty(allocation.overBy)}. The order&apos;s excess must have changed since the plan was
          drawn. It cannot be approved until the grid is brought back under the ceiling.
        </Alert>
      )}

      {editable.state === 'SUBMITTED' && (
        <Alert kind="warning">
          Submitted to <strong>{plan.submittedTo}</strong> by {plan.submittedByName} on{' '}
          {fmtDate(plan.submittedAt)} &mdash; awaiting a decision.
          {canApprove && (
            <span className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog('approve')}>
                Approve plan
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setDialog('reject')}>
                Reject plan
              </button>
            </span>
          )}
        </Alert>
      )}

      {editable.state === 'REJECTED' && (
        <Alert kind="error">
          Rejected: {plan.rejectionReason}
          {canEdit && ' Use Revise to open it for correction - that bumps the plan version.'}
        </Alert>
      )}

      {editable.state === 'APPROVED' && (
        <Alert kind="success">
          Approved by {plan.approvedByName} on {fmtDate(plan.approvedAt)}. Cutting may be issued
          against this plan.
        </Alert>
      )}

      {/* --- Allocation: every figure server-calculated ------------------- */}
      <CeilingNote allocation={allocation} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Plan</span>
          {/*
            NAME WHAT EACH BADGE IS, BECAUSE THEY LOOK LIKE A CONTRADICTION.

            A plan carries two states that answer different questions, and
            side by side with nothing to tell them apart they read as one
            answer given twice and wrong: "Approved" next to "PENDING" looks
            like the screen cannot make its mind up.

              APPROVAL  has the plan been signed off.
              STATUS    where the WORK has got to - pending, in progress, done.

            An approved plan whose work has not started is exactly "Approved"
            and "Pending", and that is the normal case, not an error.
          */}
          <span className="row" style={{ gap: 14 }}>
            <span className="badge-labelled">
              <span className="badge-tag">Approval</span>
              <span className={`badge ${STATE_BADGE[plan.state]}`}>{STATE_LABEL[plan.state]}</span>
            </span>
            <span className="badge-labelled">
              <span className="badge-tag">Status</span>
              <StatusBadge status={plan.status} />
            </span>
          </span>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <Detail label="Plan No" value={plan.planNo} mono />
            <Detail label="Planning Department" value={fmtEnum(plan.planDepartment)} />
            <Detail label="Container No" value={plan.containerNo} />
            <Detail label="Plan Date" value={fmtDate(plan.planDate)} />
            <Detail label="Order No" value={plan.order?.orderNo} mono />
            <Detail label="Style No" value={plan.styleNo} mono />
            <Detail label="Buyer" value={plan.order?.buyer?.buyerName} />
            <Detail label="Buyer Delivery Date" value={fmtDate(plan.order?.buyerDeliveryDate)} />
            <Detail label="Order Qty" value={fmtQty(plan.orderQty)} />
            {plan.remarks && <Detail label="Remarks" value={plan.remarks} className="span-2" />}
          </div>

          {canEdit && plan.status !== 'CANCELLED' && plan.status !== 'COMPLETED' && (
            <Field label="Planning status">
              <EnumSelect
                includeBlank={false}
                options={STATUS_OPTIONS}
                value={plan.status}
                disabled={busy}
                onChange={(e) =>
                  run(
                    () => planningsApi.setStatus(id, e.target.value),
                    `Status changed to ${e.target.value.replace('_', ' ').toLowerCase()}.`,
                  )
                }
              />
            </Field>
          )}

        </div>
      </div>

      {/* --- The allotment grid ------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Allotment lines</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {lines.length} line(s) · {fmtQty(allocation.plannedQty)} pieces
          </span>
        </div>
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                {usesUnit && <th>Unit</th>}
                {/* PIECES, named by the department - see ALLOTMENT_LABEL in
                    planning.service.js. The order quantity is not a column
                    here; it belongs to the order and is shown above. */}
                <th className="num">{ALLOTMENT_LABEL[plan.planDepartment] ?? 'Allotted'}</th>
                {/* And, on a cutting plan, what the BOM says those pieces
                    consume. Computed, never typed. */}
                {isCutting && <th className="num">Fabric to Issue</th>}
                <th>Status</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="faint">{l.lineNo}</td>
                  <td className="nowrap">{fmtDate(l.lineDate)}</td>
                  {usesUnit && <td>{l.unit ?? '-'}</td>}
                  <td className="num">
                    <strong>{fmtQty(l.deliverableSize)}</strong>
                  </td>
                  {isCutting && (
                    <td className="num faint">
                      {l.fabricQty == null
                        ? '-'
                        : `${fmtQty(l.fabricQty)} ${l.fabricUom ?? ''}`.trim()}
                    </td>
                  )}
                  <td>
                    {/* The one write allowed on a live plan: the floor marking
                        a day done. It cannot touch a quantity. */}
                    {canEdit && plan.status !== 'CANCELLED' ? (
                      <EnumSelect
                        includeBlank={false}
                        options={LINE_STATUS_OPTIONS}
                        value={l.status}
                        disabled={busy}
                        onChange={(e) =>
                          run(
                            () => planningsApi.setLineStatus(id, l.id, { status: e.target.value }),
                            `Line ${l.lineNo} marked ${e.target.value.replace('_', ' ').toLowerCase()}.`,
                          )
                        }
                      />
                    ) : (
                      <StatusBadge status={l.status} />
                    )}
                  </td>
                  <td className="muted">{l.remark ?? '-'}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ padding: 20 }}>
                    This plan has no allotment lines yet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={usesUnit ? 3 : 2}>Total</th>
                <th className="num">{fmtQty(allocation.plannedQty)}</th>
                {isCutting && (
                  <th className="num">
                    {`${fmtQty(plan.plannedFabricQty)} ${lines.find((l) => l.fabricUom)?.fabricUom ?? ''}`.trim()}
                  </th>
                )}
                <th colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      </div>

      {/* --- Unit allocation ---------------------------------------------- */}
      {usesUnit && (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Unit allocation</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            what each stitching unit is due
          </span>
        </div>
        {unitAllocation.length === 0 ? (
          <div className="card-body muted">No units have been allotted yet.</div>
        ) : (
          <UnitAllocationTable rows={unitAllocation} planDepartment={plan.planDepartment} />
        )}
      </div>
      )}

      {/* --- Order allocation across departments --------------------------- */}
      {orderAllocation.otherDepartments.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span>Other plans on order {plan.order?.orderNo}</span>
            <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
              each department plans the order independently
            </span>
          </div>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Plan No</th>
                  <th>Department</th>
                  <th className="num">Planned</th>
                  <th>Approval</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orderAllocation.otherDepartments.map((d) => (
                  <tr className="clickable" key={d.id} onClick={() => navigate(`/planning/${d.id}`)}>
                    <td className="code">
                      {d.planNo}
                      {d.version > 1 && <span className="faint"> v{d.version}</span>}
                    </td>
                    <td>{fmtEnum(d.planDepartment)}</td>
                    <td className="num">{fmtQty(d.plannedQty)}</td>
                    <td>
                      <span className={`badge ${STATE_BADGE[d.state]}`}>{STATE_LABEL[d.state]}</span>
                    </td>
                    <td>
                      <StatusBadge status={d.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      {/* --- Approval rounds and the trail --------------------------------- */}
      <div className="card">
        <div className="card-header">
          <span>Approval flow</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {approvals.length} round(s)
          </span>
        </div>
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Round</th>
                <th>Approval No</th>
                <th>Submitted</th>
                <th>Prepared By</th>
                <th>Submitted To</th>
                <th>Status</th>
                <th>Approved</th>
                <th>Reason / Rectification</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((a) => (
                <tr key={a.id}>
                  <td className="faint">{a.round}</td>
                  <td className="code">{a.approvalNo}</td>
                  <td className="nowrap">{fmtDate(a.submittedDate)}</td>
                  <td>{a.preparedBy}</td>
                  <td>{a.submittedTo}</td>
                  <td>
                    <StatusBadge status={a.approvalStatus} />
                  </td>
                  <td className="nowrap">{fmtDate(a.approvedDate)}</td>
                  <td className="muted">
                    {a.rejectionReason ?? '-'}
                    {a.rectificationRemarks && <div className="faint">{a.rectificationRemarks}</div>}
                  </td>
                </tr>
              ))}
              {approvals.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ padding: 20 }}>
                    This plan has not been submitted for approval yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableWrap>

        <div className="card-body">
          <div className="fieldset-title">Trail</div>
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
                    <td>{h.action.replace(/_/g, ' ')}</td>
                    <td className="muted">
                      {h.fromStatus ?? '-'} &rarr; {h.toStatus ?? '-'}
                    </td>
                    <td>{h.actedByName ?? '-'}</td>
                    <td className="muted">{h.remarks ?? '-'}</td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted" style={{ padding: 20 }}>
                      Nothing recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        </div>
      </div>

      {editing && (
        <Modal title={`Edit plan ${plan.planNo}`} size="wide" onClose={() => setEditing(false)}>
          <PlanningForm
            plan={plan}
            onCancel={() => setEditing(false)}
            onSaved={async () => {
              setEditing(false);
              setBanner({ kind: 'success', text: 'Plan saved.' });
              await load();
            }}
          />
        </Modal>
      )}

      {dialog && (
        <FlowDialog
          plan={plan}
          mode={dialog}
          usage={usage}
          onCancel={() => setDialog(null)}
          onDone={async (message) => {
            setDialog(null);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete plan"
          danger
          busy={busy}
          confirmLabel="Delete"
          message={`Delete plan ${plan.planNo}? It is hidden rather than erased, and the plan number is never reused.`}
          onConfirm={doDelete}
          onCancel={() => setDeleting(false)}
        />
      )}
    </>
  );
}

function Detail({ label, value, mono, className = '' }) {
  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      <div className={mono ? 'mono' : ''} style={{ paddingTop: 2 }}>
        {value || <span className="faint">-</span>}
      </div>
    </div>
  );
}

/**
 * Submit, recall, approve, reject and revise - one dialog, because they differ
 * only in which text they need and which endpoint they call.
 */
function FlowDialog({ plan, mode, onCancel, onDone }) {
  const [text, setText] = useState('');
  const [rectification, setRectification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const config = {
    /*
     * No `needsRecipient`. The dialog used to open on a required "Submitted
     * To" dropdown listing the two people a plan could go to - a question with
     * one real answer, asked every single time, that could only be got wrong.
     * The server routes it (DEFAULT_APPROVER in planning.service.js), so this
     * dialog now states what the plan does and asks for nothing but optional
     * remarks.
     */
    submit: {
      title: 'Submit plan for approval',
      confirm: 'Submit',
      danger: false,
      needsReason: false,
    },
    recall: { title: 'Recall plan', confirm: 'Recall', danger: false, needsReason: true },
    approve: { title: 'Approve plan', confirm: 'Approve', danger: false, needsReason: false },
    reject: { title: 'Reject plan', confirm: 'Reject', danger: true, needsReason: true },
    revise: { title: 'Revise plan', confirm: 'Open for revision', danger: false, needsReason: false },
  }[mode];

  const blocked = busy || (config.needsReason && text.trim().length < 3);

  async function go() {
    setBusy(true);
    setError('');
    try {
      if (mode === 'submit') {
        const sent = await planningsApi.submit(plan.id, { remarks: text || undefined });
        onDone(`Plan submitted to ${sent.submittedTo ?? 'the Director'} for approval.`);
      } else if (mode === 'recall') {
        await planningsApi.recall(plan.id, text);
        onDone('Plan recalled. It is a draft again and can be edited.');
      } else if (mode === 'approve') {
        const approved = await planningsApi.approve(plan.id, { remarks: text || undefined });
        onDone(
          `Plan approved for ${Number(approved.plannedQty).toLocaleString()} pieces. Cutting may now be issued against it.`,
        );
      } else if (mode === 'reject') {
        await planningsApi.reject(plan.id, { reason: text, rectification: rectification || undefined });
        onDone('Plan rejected and sent back to the planner.');
      } else {
        const revised = await planningsApi.revise(plan.id, { remarks: text || undefined });
        onDone(`Plan reopened as v${revised.version}. Edit the grid and submit it again.`);
      }
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={config.title}
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${config.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={go}
            disabled={blocked}
          >
            {busy ? 'Working...' : config.confirm}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>

        <p style={{ marginTop: 0 }}>
          Plan <strong>{plan.planNo}</strong> allots{' '}
          <strong>{fmtQty(plan.allocation.plannedQty)}</strong> pieces against order{' '}
          {plan.order?.orderNo}, which permits {fmtQty(plan.allocation.permittedQty)}.
        </p>

        {plan.allocation.usesExcess && (
          <Alert kind="warning">
            This plan uses {fmtQty(plan.allocation.excessUsedQty)} pieces of the excess the Director
            approved on the order.
          </Alert>
        )}

        {mode === 'approve' && !plan.allocation.withinPermitted && (
          <Alert kind="error">
            This plan is over the permitted quantity and will be refused. Send it back instead.
          </Alert>
        )}

        <Field
          label={config.needsReason ? 'Reason' : 'Remarks'}
          required={config.needsReason}
        >
          <TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>

        {mode === 'reject' && (
          <Field
            label="Rectification remarks"
            hint='What the planner should change, e.g. "Shift 1500 pcs to Unit 4".'
          >
            <TextArea rows={2} value={rectification} onChange={(e) => setRectification(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
