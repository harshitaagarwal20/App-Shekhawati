/**
 * Cutting Issue — the list and the detail.
 *
 * The detail is the end of the whole pipeline, so it renders the whole chain:
 *
 *      Order → Plan → Plan Approval → Fabric Issue → Cutting Challan
 *
 * and states plainly that a posted challan is permanent. There is no Edit
 * button on a posted one, no amend, and no unpost — because there is nothing
 * downstream of this document to correct it with.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { cuttingIssues as ciApi, orders as ordersApi } from '../../services/erp.js';
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
  StatusBadge,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import { CheckList } from '../../components/mobile.jsx';
import {
  ExcessPanel,
  StateBadge,
  WorkflowTrail,
} from '../../components/workflow.jsx';
import { Detail, DetailGrid, TraceChain } from '../shared/Detail.jsx';
import { fmtDate, fmtDateTime, fmtNum } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

// ===========================================================================
//  LIST
// ===========================================================================

export function CuttingIssueList() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const list = useResourceList((params) => ciApi.list(params), {
    defaultSort: 'issueDate',
    defaultDir: 'desc',
    initialFilters: {
      status: '',
      orderId: '',
      isLocked: '',
    },
  });

  const [orderOptions, setOrderOptions] = useState([]);
  const totals = list.meta?.totals;

  useEffect(() => {
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  return (
    <>
      <PageHeader
        title="Cutting Issues"
        actions={
          <>
            <ExportButton
              dataset="cutting-issues"
              params={list.query}
              rowCount={list.meta.total}
            />
            {can('CUTTING_ISSUE.CREATE') && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate('/cutting-issues/new')}
              >
                Issue cutting
              </button>
            )}
          </>
        }
      />

      {list.error && <Alert kind="error">{list.error.message}</Alert>}

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor="ci-search">
              <TextInput
                id="ci-search"
                type="search"
                placeholder="Search challan no, unit, container, remarks..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Order" htmlFor="ci-f-order">
            <RecordSelect
              id="ci-f-order"
              options={orderOptions}
              getLabel={(o) => o.orderNo}
              placeholder="All orders"
              value={list.filters.orderId ?? ''}
              onChange={(e) => list.setFilter('orderId', e.target.value)}
            />
          </Field>

          <Field label="Status" htmlFor="ci-f-status">
            <EnumSelect
              id="ci-f-status"
              options={STATUS_OPTIONS}
              placeholder="All"
              value={list.filters.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
            />
          </Field>

          <div className="field">
            <label htmlFor="ci-f-locked">Record</label>
            <EnumSelect
              id="ci-f-locked"
              options={[
                { value: 'false', label: 'Drafts' },
                { value: 'true', label: 'Posted' },
              ]}
              placeholder="All"
              value={list.filters.isLocked ?? ''}
              onChange={(e) => list.setFilter('isLocked', e.target.value)}
            />
          </div>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="challanNo" label="Challan No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="issueDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Order</th>
                <th>Style</th>
                <th>Container</th>
                <SortableTh field="plannedCutting" label="Planned" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <SortableTh field="cuttingPcsIssued" label="Issued" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <th className="num">Handles</th>
                <th>Approval</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={10} className="loading-row">
                    <Spinner label="Loading challans..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    <EmptyState title="No cutting challans found" />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/cutting-issues/${c.id}`)}
                    className={`clickable ${c.status === 'CANCELLED' ? 'inactive' : ''}`}
                  >
                    <td className="code">{c.challanNo}</td>
                    <td className="nowrap">{fmtDate(c.issueDate)}</td>
                    <td className="code">{c.order?.orderNo ?? '-'}</td>
                    <td className="code">{c.style?.styleNo ?? '-'}</td>
                    <td>{c.containerNo ?? '-'}</td>
                    <td className="num">{fmtNum(c.plannedCutting)}</td>
                    <td className="num">
                      <strong>{fmtNum(c.cuttingPcsIssued)}</strong>
                      {c.variancePct && c.variancePct !== '0.00' && (
                        <div className="faint">{c.variancePct}% vs allotment</div>
                      )}
                    </td>
                    <td className="num">{fmtNum(c.handleIssued)}</td>
                    <td className="code">
                      {c.planApproval
                        ? `${c.planApproval.approvalNo} v${c.planApproval.round}`
                        : '-'}
                    </td>
                    <td>
                      <StateBadge state={c.workflowState} />
                      {c.posted && <div className="faint">locked</div>}
                    </td>
                  </tr>
                ))}
            </tbody>

            {totals && !list.loading && list.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={8} className="faint">
                    Totals for the filtered set
                  </td>
                  <td className="num">
                    <strong>{fmtNum(totals.cuttingPcsIssued)}</strong>
                  </td>
                  <td className="num">
                    <strong>{fmtNum(totals.handleIssued)}</strong>
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
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
    </>
  );
}

// ===========================================================================
//  DETAIL
// ===========================================================================

export function CuttingIssueDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [c, setC] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [posting, setPosting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const canPost = can('CUTTING_ISSUE.APPROVE');
  const canPrint = can('CUTTING_ISSUE.EXPORT');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setC(await ciApi.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !c) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading challan..." />
        </div>
      </div>
    );
  }
  if (!c) return <Alert kind="error">{banner?.text ?? 'Cutting issue not found'}</Alert>;

  const { traceability, editable, workflow, excessApproval } = c;

  return (
    <>
      <PageHeader
        title={`Cutting Challan ${c.challanNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/cutting-issues')}>
              Back to list
            </button>
            {canPrint && (
              <button
                type="button"
                className="btn"
                onClick={() => navigate(`/print/cutting-issue/${c.id}`)}
              >
                Print
              </button>
            )}
            {canPost && editable.canPost && (
              <button type="button" className="btn btn-primary" onClick={() => setPosting(true)}>
                Post the challan
              </button>
            )}
            {canPost && editable.canDelete && (
              <button type="button" className="btn btn-danger" onClick={() => setCancelling(true)}>
                Cancel
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

      {!c.posted && c.status !== 'CANCELLED' && (
        <Alert kind="warning">
          This challan is a <strong>draft</strong>. No cloth has been cut against it, and nothing
          has been issued to the unit. Posting runs all ten checks again and locks it permanently.
        </Alert>
      )}

      {/* The whole pipeline, in one line. */}
      <TraceChain
        title="The whole chain"
        chain={traceability.chain}
        complete={Boolean(traceability.approvalNo && traceability.fabricIssueNo)}
        links={[
          traceability.orderNo && {
            label: 'Buyer Order',
            value: traceability.orderNo,
            sub: traceability.buyerName,
            to: c.order ? `/orders/${c.order.id}` : undefined,
          },
          traceability.planNo && { label: 'Plan', value: traceability.planNo },
          traceability.approvalNo && {
            label: 'Plan Approval',
            value: `${traceability.approvalNo} v${traceability.approvalVersion}`,
            to: c.planApproval ? `/plan-approvals/${c.planApproval.id}` : undefined,
          },
          traceability.fabricIssueNo && {
            label: 'Fabric Issue',
            value: traceability.fabricIssueNo,
            sub: traceability.rollNo ? `roll ${traceability.rollNo}` : undefined,
            to: c.fabricIssue ? `/fabric-issues/${c.fabricIssue.id}` : undefined,
          },
          { label: 'Cutting Challan', value: c.challanNo, sub: c.posted ? 'posted' : 'draft', current: true },
        ].filter(Boolean)}
      />

      {/* An authorised over-cut carries its authority on the record. */}
      {excessApproval && (
        <ExcessPanel
          title="Excess over the approved plan — authorised"
          excess={{
            baseQty: excessApproval.baseQty,
            permittedPct: excessApproval.permittedPct,
            permittedPctDisplay: (Number(excessApproval.permittedPct) * 100).toFixed(2),
            permittedQty: excessApproval.permittedQty,
            maxPermittedQty: excessApproval.maxPermittedQty,
            actualQty: excessApproval.actualQty,
            actualExcessQty: excessApproval.actualExcessQty,
            actualExcessPctDisplay: (Number(excessApproval.actualExcessPct) * 100).toFixed(2),
            overLimitQty: excessApproval.overLimitQty,
            uom: 'Pcs',
            within: false,
            explanation: `Authorised by ${excessApproval.approvedByName} on ${fmtDate(excessApproval.approvedAt)}: ${excessApproval.reason}`,
            rule: { basis: null },
          }}
        />
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Challan</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Challan No" value={c.challanNo} mono />
            <Detail label="Date" value={fmtDate(c.issueDate)} />
            <Detail label="Order No" value={c.order?.orderNo} mono />
            <Detail label="Buyer" value={c.order?.buyer?.buyerName} />
            <Detail label="Style No" value={c.style?.styleNo} mono />
            <Detail label="Style" value={c.style?.styleDescription} />
            <Detail label="Firm / unit" value={c.firmName} />
            <Detail label="Good pieces given to stitching" value={fmtNum(c.cuttingPcsIssued)} />
            <Detail label="Cut pieces damaged / rejected" value={fmtNum(c.cuttingPcsDamaged)} />
            <Detail label="Fabric consumed" value={fmtNum(c.consumedQty, { decimals: 2 })} />
            <Detail label="Fabric wastage" value={fmtNum(c.wastageQty, { decimals: 2 })} />
            <Detail label="Fabric damaged" value={fmtNum(c.fabricDamageQty, { decimals: 2 })} />
            <Detail label="Fabric remainder returned" value={fmtNum(c.remainderQty, { decimals: 2 })} />
            <Detail label="Remnants kept" value={fmtNum(c.remnantQty, { decimals: 2 })} />
            {c.panelsIssued != null && (
              <Detail label="Panels" value={fmtNum(c.panelsIssued)} sub={`${c.panelsPerBag} per bag, from the style`} />
            )}
            {c.plannedConsumptionQty != null && (
              <Detail
                label="Planned vs actual fabric"
                value={`${fmtNum(c.plannedConsumptionQty, { decimals: 2 })} / ${fmtNum(c.actualConsumptionQty, { decimals: 2 })}`}
                sub={`${fmtNum(c.stdConsumptionPerPc, { decimals: 4 })} per piece`}
              />
            )}
            {c.cuttingEfficiency != null && (
              <Detail
                label="Cutting efficiency"
                value={`${(Number(c.cuttingEfficiency) * 100).toFixed(1)}%`}
                sub={Number(c.cuttingEfficiency) < 1 ? 'Used more cloth than the style allows' : 'Within the style standard'}
              />
            )}
            <Detail label="Container No" value={c.containerNo} />
            <Detail label="Plan" value={c.planning?.planNo} mono />
            <Detail
              label="Plan approval"
              value={c.planApproval ? `${c.planApproval.approvalNo} (v${c.planApproval.round})` : null}
              sub={c.planApproval?.approvedByName}
              mono
            />
            <Detail label="Fabric issue" value={c.fabricIssue?.issueNo} mono />
            <Detail label="Roll" value={c.fabricIssue?.roll?.rollNo} mono />
            <Detail label="Posted by" value={c.postedByName} />
            <Detail label="Posted at" value={c.postedAt ? fmtDateTime(c.postedAt) : null} />
            {c.remarks && <Detail label="Remarks" value={c.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      <WorkflowTrail history={workflow?.history ?? []} />

      {posting && (
        <PostDialog
          challan={c}
          onCancel={() => setPosting(false)}
          onDone={async (message) => {
            setPosting(false);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}

      {cancelling && (
        <CancelDialog
          challan={c}
          onCancel={() => setCancelling(false)}
          onDone={async (message) => {
            setCancelling(false);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}
    </>
  );
}

/**
 * Posting from the detail screen.
 *
 * Re-runs the ten checks before showing the button, so the dialog can say what
 * is still wrong rather than just failing when pressed.
 */
function PostDialog({ challan, onCancel, onDone }) {
  const [verification, setVerification] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    ciApi
      .preview({
        orderId: challan.order?.id,
        planningId: challan.planning?.id ?? null,
        planApprovalId: challan.planApproval?.id ?? null,
        fabricIssueId: challan.fabricIssue?.id ?? null,
        containerNo: challan.containerNo ?? null,
        firmName: challan.firmName,
        unitWiseCuttingPcsToBeIssued: String(challan.unitWiseCuttingPcsToBeIssued),
        cuttingPcsIssued: String(challan.cuttingPcsIssued),
        excludeId: challan.id,
      })
      .then(setVerification)
      .catch((e) => setError(e.message));
  }, [challan]);

  async function go() {
    setBusy(true);
    setError('');
    try {
      await ciApi.post(challan.id, { remarks: remarks || undefined });
      onDone(`${challan.challanNo} posted. The record is now permanent.`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Post ${challan.challanNo}`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={go}
            disabled={busy || !verification?.canPost}
          >
            {busy ? 'Posting...' : 'Post the challan'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>

        <p style={{ marginTop: 0 }}>
          {fmtNum(challan.cuttingPcsIssued)} pieces to {challan.firmName}, against{' '}
          {challan.order?.orderNo}.
        </p>

        {!verification && <Spinner label="Running the ten checks..." />}
        {verification && <CheckList checks={verification.verification} title="The ten checks" />}

        {verification?.excess && !verification.excess.within && (
          <ExcessPanel excess={verification.excess} title="Excess over the approved plan" />
        )}

        <Field label="Remarks">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>

        <Alert kind="warning">
          <strong>This cannot be undone.</strong> Cloth gets cut and issued to the unit. There is no
          module downstream of this one to correct it — the challan locks permanently.
        </Alert>
      </div>
    </Modal>
  );
}

function CancelDialog({ challan, onCancel, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      await ciApi.cancel(challan.id, reason);
      onDone(`${challan.challanNo} cancelled.`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Cancel ${challan.challanNo}`}
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Keep it
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={go}
            disabled={busy || reason.trim().length < 3}
          >
            {busy ? 'Working...' : 'Cancel the challan'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>
        <p style={{ marginTop: 0 }}>
          This challan is still a draft — nothing has been cut against it.
        </p>
        <Field label="Reason" required>
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export default CuttingIssueList;
