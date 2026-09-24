/**
 * Material Plan — what fabric and accessories an order needs bought in.
 *
 * ---------------------------------------------------------------------------
 *  THERE IS NO QUANTITY FIELD ON THIS SCREEN
 *
 *  Raising a plan asks for one thing: which order. Everything else follows —
 *  the style, the pieces, the materials and every quantity — because the plan
 *  IS the Style BOM exploded through the one requirement calculation this
 *  application has.
 *
 *      Cotton Handle   2 Pcs/pc × 10,100 pcs × 1.01   =   20,402 Pcs
 *      ─────────────   ─────────────────────────────       ──────────
 *      from the BOM    the basis, printed on the line       what to buy
 *
 *  A planner who disagrees with a figure is disagreeing with the Style Master,
 *  and that is where the fix belongs — it corrects the PO ceiling and the
 *  cutting challan at the same time. A field here would produce a plan no
 *  other screen in the system agrees with, so there is no field here.
 *
 *  ---------------------------------------------------------------------------
 *  NO GRAND TOTAL, EVER
 *
 *  Fabric is metres and accessories are pieces. A single number summing them
 *  would be arithmetic that means nothing, and a screen that prints one invites
 *  somebody to act on it. Totals are per category and stay that way.
 *
 *  ---------------------------------------------------------------------------
 *  DRIFT IS REPORTED, NOT REPAIRED
 *
 *  The lines are frozen at creation, so a BOM edited afterwards leaves the plan
 *  saying what it said when it was signed. That is the point of the document,
 *  not a staleness bug — so the drift panel states the difference and offers no
 *  "update" button. A superseded plan is rejected and raised again.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { materialPlans as mpApi, orders as ordersApi } from '../../services/erp.js';
import {
  Alert,
  EmptyState,
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
import {} from '../../components/form.jsx';
import { StateBadge, WorkflowTrail } from '../../components/workflow.jsx';
import { fmtDate, fmtEnum, fmtNum, fmtPctFromFraction, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const CATEGORY_LABEL = {
  FABRIC: 'Fabric',
  ACCESSORIES: 'Accessories',
  PACKAGING: 'Packaging',
};

/** The requirement table. Shared by the preview and the saved plan. */
function LineTable({ lines = [] }) {
  if (!lines.length) return null;
  return (
    <div className="table-scroll">
      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>Material</th>
              <th>Category</th>
              <th className="num">Per pc</th>
              <th className="num">Wastage</th>
              <th className="num">Base</th>
              <th className="num">To buy</th>
              <th>UOM</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id ?? i}>
                <td>{l.lineNo}</td>
                <td>
                  {l.description ?? l.accessoriesItem ?? l.subCategory ?? l.itemCategory}
                  {/* The multiplication, in words, so a signed figure can always
                      be re-checked by hand. */}
                  {l.requirementBasis && <div className="faint small">{l.requirementBasis}</div>}
                </td>
                <td>{CATEGORY_LABEL[l.category] ?? l.category}</td>
                <td className="num">{fmtNum(l.avgUtilisationPerPiece, { decimals: 4 })}</td>
                <td className="num">{fmtPctFromFraction(l.wastagePct)}</td>
                <td className="num">{fmtNum(l.baseRequirement)}</td>
                <td className="num">
                  <strong>{fmtNum(l.requiredQty)}</strong>
                </td>
                <td>{l.uom}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}

/**
 * BOM lines the calculation could not price.
 *
 * Reported rather than silently dropped: a material the order genuinely needs
 * that carries no utilisation per piece is a gap in the Style Master, and a
 * plan that quietly omitted it would read as "we need none of this".
 */
function SkippedNotice({ skipped = [] }) {
  if (!skipped.length) return null;
  return (
    <Alert kind="warning">
      <strong>{skipped.length} material(s) could not be priced and are not on this plan.</strong>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {skipped.map((s, i) => (
          <li key={i}>
            {s.itemCategory}
            {s.accessoriesItem ? ` / ${s.accessoriesItem}` : ''} — {s.reason}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

// ===========================================================================
//  LIST
// ===========================================================================

/** See PlanningList: the hub supplies the title, which defaults to standalone. */
export function MaterialPlanList({ title = 'Material Plans' }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const list = useResourceList((params) => mpApi.list(params), {
    defaultSort: 'planDate',
    defaultDir: 'desc',
    initialFilters: { approvalStatus: '', orderId: '' },
  });

  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <>
            <ExportButton
              dataset="material-plans"
              params={list.query}
              rowCount={list.meta.total}
            />
            {can('MATERIAL_PLAN.CREATE') && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                New material plan
              </button>
            )}
          </>
        }
      />

      <div className="filter-row">
        <div className="grow">
          <Field label="Search">
            <TextInput
              value={list.search}
              onChange={(e) => list.setSearch(e.target.value)}
              placeholder="Plan no, container, remarks"
            />
          </Field>
        </div>
        <Field label="Approval">
          <select
            value={list.filters.approvalStatus}
            onChange={(e) => list.setFilter('approvalStatus', e.target.value)}
          >
            <option value="">All</option>
            {['PENDING', 'APPROVED', 'REJECTED'].map((s) => (
              <option key={s} value={s}>
                {fmtEnum(s)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {list.error && <Alert kind="error">{list.error}</Alert>}
      {list.loading ? (
        <Spinner label="Loading material plans" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title="No material plans"
        />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="planNo" label="Plan" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="planDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Order</th>
                <th>Style</th>
                <th>Container</th>
                <th className="num">Pcs planned</th>
                <th className="num">Materials</th>
                <th className="num">Ver</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/material-plans/${r.id}`)}>
                  <td>{r.planNo}</td>
                  <td>{fmtDate(r.planDate)}</td>
                  <td>{r.order?.orderNo ?? '-'}</td>
                  <td>{r.style?.styleNo ?? '-'}</td>
                  <td>{r.containerNo ?? '-'}</td>
                  <td className="num">{fmtNum(r.effectiveQty, { decimals: 0 })}</td>
                  <td className="num">{r.lineCount}</td>
                  <td className="num">{r.version}</td>
                  <td>
                    <StateBadge state={r.workflowState} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <Pagination
        meta={list.meta}
        page={list.page}
        pageSize={list.pageSize}
        onPage={list.setPage}
        onPageSize={list.setPageSize}
      />

      {creating && (
        <CreateMaterialPlanModal
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            navigate(`/material-plans/${saved.id}`);
          }}
        />
      )}
    </>
  );
}

// ===========================================================================
//  CREATE
// ===========================================================================

/**
 * Pick an order, see exactly what will be stored, save it.
 *
 * The preview runs the server's own explosion, so what the planner approves on
 * this screen is what the plan will contain — not a second rendering of it
 * that could disagree.
 */
function CreateMaterialPlanModal({ onClose, onSaved }) {
  const [orderOptions, setOrderOptions] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [planDate, setPlanDate] = useState(todayInput());
  const [containerNo, setContainerNo] = useState('');
  const [remarks, setRemarks] = useState('');

  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    ordersApi
      .list({ pageSize: 100 })
      .then((r) => setOrderOptions(Array.isArray(r) ? r : (r?.rows ?? [])))
      .catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  useEffect(() => {
    if (!orderId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    setError('');
    mpApi
      .preview({ orderId })
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e) => {
        if (!cancelled) {
          setPreview(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      onSaved(
        await mpApi.create({
          orderId,
          planDate,
          containerNo: containerNo || null,
          remarks: remarks || null,
        }),
      );
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const ready = orderId && preview?.lines?.length > 0 && !previewing;

  return (
    <Modal
      title="New material plan"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={save}>
            {busy ? 'Saving…' : 'Raise plan'}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}

      <div className="form-grid">
        <Field label="Order" required>
          {/*
            RECORDS IN, ACCESSORS OUT - NOT {value, label} PAIRS.

            RecordSelect takes the records themselves and is told how to read
            an id and a caption off them; its defaults are `o.id` and `o.name`.
            This was pre-mapping the orders into {value, label}, so both
            defaults read `undefined` - and a list of orders rendered as a list
            of blank rows with nothing to pick. The options were loading
            correctly the whole time; only their captions were missing.
          */}
          <RecordSelect
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            options={orderOptions}
            getValue={(o) => o.id}
            getLabel={(o) => `${o.orderNo} — ${o.style?.styleNo ?? ''}`.trim()}
            placeholder="Select an order..."
          />
        </Field>
        <Field label="Plan date">
          <TextInput type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
        </Field>
        <Field label="Container no">
          <TextInput value={containerNo} onChange={(e) => setContainerNo(e.target.value)} />
        </Field>
        <Field label="Remarks" className="span-2">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>

      {previewing && <Spinner label="Working out the requirement…" />}

      {preview && !previewing && (
        <>
          <SkippedNotice skipped={preview.skipped} />
          <LineTable lines={preview.lines} />
        </>
      )}
    </Modal>
  );
}

// ===========================================================================
//  DETAIL
// ===========================================================================

export function MaterialPlanDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [row, setRow] = useState(null);
  const [drift, setDrift] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRow(await mpApi.get(id));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Whether the BOM has moved since the plan was raised. A read; it never
  // corrects the plan, and a failure here must not break the page.
  useEffect(() => {
    mpApi
      .drift(id)
      .then(setDrift)
      .catch(loadFailed(setDrift, 'plan drift', null));
  }, [id, row?.workflowState]);

  async function act(label, fn) {
    setBusy(label);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  if (loading) return <Spinner label="Loading material plan" />;
  if (!row) return <Alert kind="error">{error || 'Not found'}</Alert>;

  const state = row.workflowState;
  // F-10: the permission says what this ROLE may do; `canApprove` from the
  // server says whether THIS user may approve THIS document - it is false
  // when they raised it themselves. Both must hold, or the button would be
  // offered and then refused with a 403.
  const canApprove = can('MATERIAL_PLAN.APPROVE') && row.canApprove !== false;

  return (
    <>
      <PageHeader
        title={`${row.planNo} — material plan`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/material-plans')}>
              Back
            </button>
            {['DRAFT', 'REJECTED'].includes(state) && can('MATERIAL_PLAN.EDIT') && (
              <button
                type="button"
                className="btn"
                disabled={!!busy}
                onClick={() => act('submit', () => mpApi.submit(row.id, {}))}
              >
                {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
              </button>
            )}
            {['SUBMITTED', 'PENDING_APPROVAL', 'RESUBMITTED'].includes(state) && canApprove && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!!busy}
                  onClick={() => act('approve', () => mpApi.approve(row.id, {}))}
                >
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
                </button>
                <button type="button" className="btn btn-danger" onClick={() => setRejecting(true)}>
                  Reject
                </button>
              </>
            )}
          </>
        }
      />

      {error && (
        <Alert kind="error" onDismiss={() => setError('')}>
          {error}
        </Alert>
      )}

      <div className="detail-head">
        <StateBadge state={state} />
      </div>

      {row.rejectionReason && state === 'REJECTED' && (
        <Alert kind="error">Rejected: {row.rejectionReason}</Alert>
      )}

      <DriftPanel drift={drift} />


      <div className="card">
        <div className="card-header">
          <span>What to buy</span>
        </div>
        <div className="card-body">
          <p className="muted dash-sub" style={{ marginTop: 0 }}>
            Worked out from the style BOM when this plan was raised, and frozen. Editing the Style
            Master will not change these figures — raise the next version instead.
          </p>
          <LineTable lines={row.lines} />
        </div>
      </div>

      <WorkflowTrail history={row.stageEvents} />

      {rejecting && (
        <Modal
          title="Reject material plan"
          onClose={() => setRejecting(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRejecting(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={reason.trim().length < 3 || !!busy}
                onClick={() =>
                  act('reject', async () => {
                    await mpApi.reject(row.id, reason);
                    setRejecting(false);
                    setReason('');
                  })
                }
              >
                {busy === 'reject' ? 'Rejecting…' : 'Reject'}
              </button>
            </>
          }
        >
          <Field label="Reason" required>
            <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      )}
    </>
  );
}

/**
 * Has the style BOM moved since this plan was raised?
 *
 * Deliberately offers no "update" button. The frozen lines are the document's
 * whole value; a plan that quietly caught up with the BOM would carry a
 * signature for figures nobody signed.
 */
function DriftPanel({ drift }) {
  if (!drift || drift.inStep) return null;

  return (
    <Alert kind="warning">
      <strong>The style BOM has changed since this plan was raised.</strong>
      <div className="table-scroll" style={{ marginTop: 8 }}>
        <TableWrap>
          <table className="data dash-mini">
            <tbody>
              {drift.changes.map((c, i) => (
                <tr key={i}>
                  <td>{c.item}</td>
                  <td>{fmtEnum(c.kind)}</td>
                  <td className="num nowrap">
                    {c.was ? fmtNum(c.was) : '—'} → {c.now ? fmtNum(c.now) : '—'} {c.uom ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>
      <p style={{ margin: '8px 0 0' }}>{drift.advice}</p>
    </Alert>
  );
}
