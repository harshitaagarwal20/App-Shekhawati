/**
 * Plan Approval — versioned, and an approved version is immutable.
 *
 * ---------------------------------------------------------------------------
 *  THE VERSION CHAIN IS THE SCREEN
 *
 *      PA-003  v1  REJECTED   "Unit 3 overloaded"          locked
 *         │              rectify
 *         ▼
 *      PA-004  v2  APPROVED                                locked, forever
 *
 *  A plan on its third attempt is not the same risk as one on its first, so the
 *  detail screen leads with the whole chain rather than the current row. Each
 *  version shows why it was rejected and what was done about it.
 *
 *  Rectifying does not edit the rejected version. It raises a SUCCESSOR and
 *  locks the predecessor - which is why "Rectify" opens a form for a new
 *  version rather than an edit dialog.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import {
  orders as ordersApi,
  planApprovals as paApi,
  plannings as planningsApi,
} from '../../services/erp.js';
import {
  Alert,
  EmptyState,
  EnumSelect,
  Field,
  Modal,
  PageHeader,
  Pagination,
  RecordSelect,
  SortableTh,
  Spinner,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import {
  FieldGroup,
  FormShell,
  RHFInput,
  RHFMasterSelect,
  RHFRecordSelect,
  RHFTextArea,
  useSubmit,
  useZodForm,
} from '../../components/form.jsx';
import {
  StateBadge,
  WorkflowTrail,
} from '../../components/workflow.jsx';
import { Detail, DetailGrid } from '../shared/Detail.jsx';
import { fmtDate, fmtDateTime, fmtNum, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Awaiting decision' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

// ===========================================================================
//  LIST
// ===========================================================================

export function PlanApprovalList() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const list = useResourceList((params) => paApi.list(params), {
    defaultSort: 'submittedDate',
    defaultDir: 'desc',
    initialFilters: {
      approvalStatus: '',
      orderId: '',
      awaitingRectification: '',
    },
  });

  const [orderOptions, setOrderOptions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  return (
    <>
      <PageHeader
        title="Plan Approvals"
        actions={
          <>
            <ExportButton
              dataset="plan-approvals"
              params={list.query}
              rowCount={list.meta.total}
            />
            {can('PLAN_APPROVAL.CREATE') && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                Submit a plan
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
      {list.error && <Alert kind="error">{list.error.message}</Alert>}

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor="pa-search">
              <TextInput
                id="pa-search"
                type="search"
                placeholder="Search approval no, container, reason..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Order" htmlFor="pa-f-order">
            <RecordSelect
              id="pa-f-order"
              options={orderOptions}
              getLabel={(o) => o.orderNo}
              placeholder="All orders"
              value={list.filters.orderId ?? ''}
              onChange={(e) => list.setFilter('orderId', e.target.value)}
            />
          </Field>

          <Field label="Status" htmlFor="pa-f-status">
            <EnumSelect
              id="pa-f-status"
              options={STATUS_OPTIONS}
              placeholder="All"
              value={list.filters.approvalStatus ?? ''}
              onChange={(e) => list.setFilter('approvalStatus', e.target.value)}
            />
          </Field>

          <div className="field">
            <label htmlFor="pa-f-rect">Needing action</label>
            <EnumSelect
              id="pa-f-rect"
              options={[{ value: 'true', label: 'Rejected, not yet rectified' }]}
              placeholder="All"
              value={list.filters.awaitingRectification ?? ''}
              onChange={(e) => list.setFilter('awaitingRectification', e.target.value)}
            />
          </div>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="approvalNo" label="Approval No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="submittedDate" label="Submitted" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Order</th>
                <th>Container</th>
                <th>Prepared by</th>
                <th>Submitted to</th>
                <th>Replaces</th>
                <SortableTh field="approvedDate" label="Approved" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Workflow</th>
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={9} className="loading-row">
                    <Spinner label="Loading plan approvals..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <EmptyState title="No plan approvals found" />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => navigate(`/plan-approvals/${a.id}`)}
                    className={`clickable ${a.awaitingRectification ? 'row-warn' : ''}`}
                  >
                    <td className="code">{a.approvalNo}</td>
                    <td className="nowrap">{fmtDate(a.submittedDate)}</td>
                    <td className="code">{a.order?.orderNo ?? '-'}</td>
                    <td>{a.containerNo ?? '-'}</td>
                    <td>{a.preparedBy}</td>
                    <td>{a.submittedTo}</td>
                    <td className="code">
                      {a.supersedes ? `${a.supersedes.approvalNo} (v${a.supersedes.round})` : '-'}
                    </td>
                    <td className="nowrap">{a.approvedDate ? fmtDate(a.approvedDate) : '-'}</td>
                    <td>
                      <StateBadge state={a.workflowState} />
                      {a.awaitingRectification && (
                        <div className="faint">needs rectifying</div>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableWrap>

        <Pagination
          meta={list.meta}
          page={list.page}
          pageSize={list.pageSize}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      </div>

      {creating && (
        <Modal title="Submit a plan for approval" size="wide" onClose={() => setCreating(false)}>
          <PlanApprovalForm
            onCancel={() => setCreating(false)}
            onSaved={(saved) => {
              setCreating(false);
              setBanner({ kind: 'success', text: `${saved.approvalNo} submitted as version 1.` });
              navigate(`/plan-approvals/${saved.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}

// ===========================================================================
//  FORM  (version 1, and the rectification that raises version n+1)
// ===========================================================================

const schema = z.object({
  submittedDate: z.string().min(1, 'Date is required'),
  orderId: z.string().uuid('Choose an order'),
  containerNo: z.string().optional(),
  preparedBy: z.string().trim().min(1, 'Who prepared the plan?').max(120),
  submittedTo: z.string().trim().min(1, 'Who is it going to?').max(120),
  planningId: z.string().optional(),
  rectificationRemarks: z.string().trim().max(2000).optional(),
});

export function PlanApprovalForm({ rectifying, onSaved, onCancel }) {
  const isRectification = Boolean(rectifying);

  const form = useZodForm(
    isRectification
      ? schema.extend({
          rectificationRemarks: z
            .string()
            .trim()
            .min(3, 'Say what was done about the rejection')
            .max(2000),
        })
      : schema,
    {
      submittedDate: todayInput(),
      orderId: rectifying?.order?.id ?? '',
      containerNo: rectifying?.containerNo ?? '',
      preparedBy: rectifying?.preparedBy ?? '',
      submittedTo: rectifying?.submittedTo ?? '',
      planningId: rectifying?.planning?.id ?? '',
      rectificationRemarks: '',
    },
  );

  const [orders, setOrders] = useState([]);
  const [plans, setPlans] = useState([]);
  const orderId = form.watch('orderId');

  useEffect(() => {
    ordersApi.options().then(setOrders).catch(loadFailed(setOrders, 'orders'));
  }, []);

  useEffect(() => {
    if (!orderId) {
      setPlans([]);
      return;
    }
    planningsApi
      .options({ orderId })
      .then(setPlans)
      .catch(loadFailed(setPlans, 'plans'));
  }, [orderId]);

  const { submit, busy, banner, setBanner } = useSubmit(
    form,
    (values) => {
      const payload = {
        submittedDate: values.submittedDate,
        containerNo: values.containerNo || null,
        preparedBy: values.preparedBy,
        submittedTo: values.submittedTo,
        planningId: values.planningId || null,
        rectificationRemarks: values.rectificationRemarks || null,
      };
      return isRectification
        ? paApi.rectify(rectifying.id, {
            ...payload,
            rectificationRemarks: values.rectificationRemarks,
          })
        : paApi.create({ ...payload, orderId: values.orderId });
    },
    { onDone: onSaved },
  );

  return (
    <FormShell
      onSubmit={submit}
      banner={banner}
      onDismissBanner={() => setBanner('')}
      busy={busy}
      submitLabel={isRectification ? `Raise version ${rectifying.version + 1}` : 'Submit for approval'}
      busyLabel="Submitting..."
      onCancel={onCancel}
      footerNote={
        isRectification
          ? `${rectifying.approvalNo} will be locked as rectified. The new version starts pending.`
          : 'Version 1. Later versions are raised by rectifying a rejection, never here.'
      }
    >
      {isRectification && (
        <Alert kind="warning">
          <strong>
            Version {rectifying.version} was rejected:
          </strong>{' '}
          {rectifying.rejectionReason}
          {rectifying.rectificationRemarks && (
            <div className="muted" style={{ marginTop: 4 }}>
              Asked for: {rectifying.rectificationRemarks}
            </div>
          )}
        </Alert>
      )}

      <div className="form-grid">
        <FieldGroup title={isRectification ? `Version ${rectifying.version + 1}` : 'Version 1'}>
          <RHFInput form={form} name="submittedDate" label="Submitted date" type="date" required />
          <RHFRecordSelect
            form={form}
            name="orderId"
            label="Order"
            required
            options={orders}
            getLabel={(o) => `${o.orderNo} — ${o.style?.styleNo ?? ''}`}
            placeholder="Choose the order..."
            hint={isRectification ? 'Carried over from the rejected version.' : undefined}
          />
          {/* Carried from the plan being submitted. Typed rather than chosen -
              see planning.service.js. */}
          <RHFInput form={form} name="containerNo" label="Container No" />
          <RHFRecordSelect
            form={form}
            name="planningId"
            label="Plan"
            options={plans}
            getLabel={(p) => `${p.planNo} — ${fmtNum(p.plannedCuttingPcs ?? 0)} pcs`}
            disabled={!orderId}
            placeholder={orderId ? 'No plan linked' : 'Choose an order first'}
            noOptionsLabel={
              orderId
                ? 'This order has no plan yet'
                : 'Choose an order first - plans belong to an order'
            }
          />
          <RHFInput form={form} name="preparedBy" label="Prepared by" required />
          <RHFMasterSelect
            form={form}
            name="submittedTo"
            label="Submitted to"
            listCode="AuthorisedBy"
            required
          />
          <RHFTextArea
            form={form}
            name="rectificationRemarks"
            label={isRectification ? 'What was done about the rejection' : 'Rectification remarks'}
            required={isRectification}
            className="span-2"
            rows={3}
          />
        </FieldGroup>
      </div>
    </FormShell>
  );
}

// ===========================================================================
//  DETAIL
// ===========================================================================

export function PlanApprovalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [a, setA] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [dialog, setDialog] = useState(null); // approve | reject | recall
  const [rectifying, setRectifying] = useState(false);

  // F-10: the permission says what this ROLE may do; `canApprove` from the
  // server says whether THIS user may approve THIS document - it is false
  // when they raised it themselves. Both must hold, or the button would be
  // offered and then refused with a 403.
  const canDecide = can('PLAN_APPROVAL.APPROVE') && a?.canApprove !== false;
  const canEdit = can('PLAN_APPROVAL.EDIT');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setA(await paApi.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !a) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading plan approval..." />
        </div>
      </div>
    );
  }
  if (!a) return <Alert kind="error">{banner?.text ?? 'Plan approval not found'}</Alert>;

  const { versions, editable, history, usage } = a;

  return (
    <>
      <PageHeader
        title={`${a.approvalNo} — version ${a.version}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/plan-approvals')}>
              Back to list
            </button>
            {canEdit && editable.canRectify && (
              <button type="button" className="btn btn-primary" onClick={() => setRectifying(true)}>
                Rectify — raise version {a.version + 1}
              </button>
            )}
            {canEdit && editable.canRecall && (
              <button type="button" className="btn" onClick={() => setDialog('recall')}>
                Recall
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

      {a.approvalStatus === 'PENDING' && (
        <Alert kind="warning">
          Version {a.version} is awaiting a decision. Nothing can be cut against this order and
          container until a version is approved.
          {canDecide && (
            <span className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog('approve')}>
                Approve
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setDialog('reject')}>
                Reject
              </button>
            </span>
          )}
        </Alert>
      )}

      {a.approvalStatus === 'REJECTED' && (
        <Alert kind="error">
          <strong>Rejected:</strong> {a.rejectionReason}
          {a.rectificationRemarks && (
            <div className="muted" style={{ marginTop: 4 }}>
              Asked for: {a.rectificationRemarks}
            </div>
          )}
          {a.awaitingRectification && (
            <div style={{ marginTop: 6 }}>
              This rejection has not been rectified yet. Raising the next version is how it moves on.
            </div>
          )}
        </Alert>
      )}

      {a.approvalStatus === 'APPROVED' && (
        <Alert kind="success">
          Approved by {a.approvedByName} on {fmtDate(a.approvedDate)}. Cutting may be issued against
          it, and this version can never change.
        </Alert>
      )}

      {/* --- The version chain -------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Version history</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {versions.count} version(s) · current is v{versions.currentVersion}
            {versions.approvedVersion ? ` · v${versions.approvedVersion} approved` : ''}
          </span>
        </div>
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th className="num">Version</th>
                <th>Approval No</th>
                <th>Submitted</th>
                <th>Workflow</th>
                <th>Rejection reason</th>
                <th>Rectification remarks</th>
                <th>Decided</th>
              </tr>
            </thead>
            <tbody>
              {versions.rows.map((v) => (
                <tr
                  key={v.id}
                  onClick={() => !v.isThisOne && navigate(`/plan-approvals/${v.id}`)}
                  style={{ cursor: v.isThisOne ? 'default' : 'pointer' }}
                  className={`clickable ${v.isThisOne ? 'row-warn' : ''}`}
                >
                  <td className="num">
                    <strong>v{v.version}</strong>
                    {v.isThisOne && <div className="faint">this one</div>}
                  </td>
                  <td className="code">{v.approvalNo}</td>
                  <td className="nowrap">{fmtDate(v.submittedDate)}</td>
                  <td>
                    <StateBadge state={v.workflowState} />
                  </td>
                  <td className="muted">{v.rejectionReason ?? '-'}</td>
                  <td className="muted">{v.rectificationRemarks ?? '-'}</td>
                  <td className="nowrap">{v.decidedAt ? fmtDate(v.decidedAt) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">This version</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Approval No" value={a.approvalNo} mono />
            <Detail label="Version" value={`v${a.version}`} />
            <Detail label="Submitted date" value={fmtDate(a.submittedDate)} />
            <Detail label="Order No" value={a.order?.orderNo} mono />
            <Detail label="Buyer" value={a.order?.buyer?.buyerName} />
            <Detail label="Style No" value={a.order?.style?.styleNo} mono />
            <Detail label="Container No" value={a.containerNo} />
            <Detail
              label="Plan"
              value={a.planning?.planNo}
              sub={
                a.planning
                  ? `${fmtNum(a.planning.plannedCuttingPcs)} cutting pcs planned`
                  : undefined
              }
              mono
            />
            <Detail label="Prepared by" value={a.preparedBy} />
            <Detail label="Submitted to" value={a.submittedTo} />
            <Detail label="Approved by" value={a.approvedByName} showEmpty />
            <Detail label="Decided at" value={a.decidedAt ? fmtDateTime(a.decidedAt) : null} />
            <Detail
              label="Replaces"
              value={a.supersedes ? `${a.supersedes.approvalNo} (v${a.supersedes.round})` : null}
              mono
            />
            <Detail label="Cutting challans raised" value={String(usage.cuttingIssues)} />
            {a.rectificationRemarks && (
              <Detail label="Rectification remarks" value={a.rectificationRemarks} className="span-2" />
            )}
            {a.rejectionReason && (
              <Detail label="Rejection reason" value={a.rejectionReason} className="span-2" />
            )}
          </DetailGrid>
        </div>
      </div>

      <WorkflowTrail history={history} />

      {dialog && (
        <DecisionDialog
          approval={a}
          mode={dialog}
          onCancel={() => setDialog(null)}
          onDone={async (message) => {
            setDialog(null);
            setBanner({ kind: 'success', text: message });
            if (message.includes('recalled')) navigate('/plan-approvals');
            else await load();
          }}
        />
      )}

      {rectifying && (
        <Modal
          title={`Rectify ${a.approvalNo} — raise version ${a.version + 1}`}
          size="wide"
          onClose={() => setRectifying(false)}
        >
          <PlanApprovalForm
            rectifying={a}
            onCancel={() => setRectifying(false)}
            onSaved={(saved) => {
              setRectifying(false);
              navigate(`/plan-approvals/${saved.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function DecisionDialog({ approval, mode, onCancel, onDone }) {
  const [text, setText] = useState('');
  const [asked, setAsked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const config = {
    approve: {
      title: `Approve version ${approval.version}`,
      confirm: 'Approve',
      danger: false,
      needsReason: false,
    },
    reject: {
      title: `Reject version ${approval.version}`,
      confirm: 'Reject',
      danger: true,
      needsReason: true,
    },
    recall: {
      title: `Recall ${approval.approvalNo}`,
      confirm: 'Recall',
      danger: true,
      needsReason: false,
    },
  }[mode];

  async function go() {
    setBusy(true);
    setError('');
    try {
      if (mode === 'approve') {
        await paApi.approve(approval.id, { remarks: text || undefined });
        onDone(`Version ${approval.version} approved. It is now immutable.`);
      } else if (mode === 'reject') {
        await paApi.reject(approval.id, { reason: text, rectificationRemarks: asked || undefined });
        onDone(`Version ${approval.version} rejected. It can be rectified into version ${approval.version + 1}.`);
      } else {
        await paApi.recall(approval.id, text || 'Recalled before decision');
        onDone(`${approval.approvalNo} recalled.`);
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
            disabled={busy || (config.needsReason && text.trim().length < 3)}
          >
            {busy ? 'Working...' : config.confirm}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>

        <p style={{ marginTop: 0 }}>
          {approval.order?.orderNo}
          {approval.containerNo && ` / ${approval.containerNo}`} — version {approval.version},
          prepared by {approval.preparedBy}
          {approval.planning && `, plan ${approval.planning.planNo}`}.
        </p>

        {mode === 'approve' && (
          <Alert kind="warning">
            An approved version is immutable. Cutting can be issued against it from the moment it is
            approved, so there is no window in which it can be edited afterwards.
          </Alert>
        )}

        <Field label={config.needsReason ? 'Reason' : 'Remarks'} required={config.needsReason}>
          <TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>

        {mode === 'reject' && (
          <Field
            label="Rectification remarks"
            hint="What should the planner change? This carries onto the next version."
          >
            <TextArea rows={2} value={asked} onChange={(e) => setAsked(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

export default PlanApprovalList;
