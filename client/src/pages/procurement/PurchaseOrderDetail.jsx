/**
 * Purchase Order detail: the PO, the chain it came from, what has been received
 * against it, the decision, and the trail.
 *
 * The chain is the point of this screen. A PO that cannot say where its
 * authority came from is a PO nobody can audit, so `traceability` -
 * Order → Quotation → PO - is rendered at the top, with each link marked
 * present or absent rather than silently omitted.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { purchaseOrders as poApi } from '../../services/erp.js';
import {
  Alert,
  ConfirmDialog,
  Field,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  TextArea,
} from '../../components/ui.jsx';
import {
  StateBadge,
  WorkflowTrail,
} from '../../components/workflow.jsx';
import { Detail, DetailGrid, TraceChain } from '../shared/Detail.jsx';
import { fmtDate, fmtMoney, fmtNum } from '../../utils/format.js';
import PurchaseOrderForm from './PurchaseOrderForm.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { PartOfDocument } from './DocumentPages.jsx';

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState(null); // approve | reject | reopen
  const [deleting, setDeleting] = useState(false);

  const canEdit = can('PURCHASE_ORDER.EDIT');
  // F-10: the permission says what this ROLE may do; `canApprove` from the
  // server says whether THIS user may approve THIS document - it is false
  // when they raised it themselves. Both must hold, or the button would be
  // offered and then refused with a 403.
  const canApprove = can('PURCHASE_ORDER.APPROVE') && po?.canApprove !== false;
  const canDelete = can('PURCHASE_ORDER.DELETE');
  const canPrint = can('PURCHASE_ORDER.EXPORT');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPo(await poApi.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function doDelete() {
    setBusy(true);
    try {
      await poApi.remove(id);
      navigate('/purchase-orders', { replace: true });
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !po) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading purchase order..." />
        </div>
      </div>
    );
  }
  if (!po) return <Alert kind="error">{banner?.text ?? 'Purchase order not found'}</Alert>;

  const { traceability, receipts, gatePasses, editable, history, usage } = po;

  return (
    <>
      <PageHeader
        title={`Purchase Order ${po.poId}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/purchase-orders')}>
              Back to list
            </button>
            {canPrint && (
              <button
                type="button"
                className="btn"
                onClick={() => navigate(`/print/purchase-order/${po.id}`)}
              >
                Print
              </button>
            )}
            {canEdit && editable.canEdit && (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {/*
              * The decision itself. `editable.canDecide` is the server's own
              * answer - still pending, not cancelled, and complete enough for a
              * vendor to act on - so the button is offered only when pressing it
              * would succeed. Without these two the Approvals queue sent an
              * approver to a screen with nothing to approve with.
              */}
            {canApprove && editable.canDecide && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => setDialog('approve')}>
                  Approve
                </button>
                <button type="button" className="btn btn-danger" onClick={() => setDialog('reject')}>
                  Reject
                </button>
              </>
            )}
            {canApprove && editable.canReopen && (
              <button type="button" className="btn" onClick={() => setDialog('reopen')}>
                Reopen
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

      <PartOfDocument header={po.header} to={`/purchase-orders/documents/${po.header?.id}`} label="purchase order" />

      {banner && (
        <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Alert>
      )}

      {po.approvalStatus === 'REJECTED' && (
        <Alert kind="error">
          Rejected by {po.approvedByName} on {fmtDate(po.decidedAt)}: {po.rejectionReason}
        </Alert>
      )}

      {po.approvalStatus === 'APPROVED' && (
        <Alert kind="success">
          Approved by {po.approvedByName} on {fmtDate(po.approvedAt)}. Goods may be received
          against it.
        </Alert>
      )}

      {/*
        * Why there is no Approve button. An approver who arrives from the
        * queue and finds nothing to press has been told nothing; the server
        * already lists every gap at once, so say all of them here rather than
        * let them discover one per attempt.
        */}
      {canApprove && po.approvalStatus === 'PENDING' && !editable.canDecide
        && editable.missingForApproval?.length > 0 && (
        <Alert kind="warning">
          This purchase order cannot be approved yet: it does not specify{' '}
          {editable.missingForApproval.map((m) => m.label).join(', ')}. A vendor cannot act on
          a purchase order that does not say these things.
        </Alert>
      )}

      {/* Order → Quotation → PO. The brief asks a PO to be traceable back
          through the chain; this is that chain, assembled on the server. */}
      <TraceChain
        title="Traceability"
        chain={traceability.chain}
        complete={traceability.complete}
        incompleteNote={
          !traceability.order
            ? 'This PO names no buyer order, so it cannot be traced back to one.'
            : !traceability.quotation
              ? 'This PO was raised without a quotation. That is permitted, but the rate was not competitively authorised.'
              : null
        }
        links={[
          traceability.order && {
            label: 'Buyer Order',
            value: traceability.order.orderNo,
            sub: `${traceability.order.buyerName ?? ''} · ${traceability.order.styleNo ?? ''}`,
            to: `/orders/${traceability.order.id}`,
          },
          traceability.quotation && {
            label: 'Quotation',
            value: traceability.quotation.quotationNo,
            sub: `${fmtNum(traceability.quotation.rateQuoted, { decimals: 4 })} · ${traceability.quotation.authorisationStatus.toLowerCase()}`,
            to: `/quotations/${traceability.quotation.id}`,
            warn: !traceability.quotation.rateMatchesPo
              ? 'The PO rate differs from the rate that was approved.'
              : null,
          },
          {
            label: 'Purchase Order',
            value: po.poId,
            sub: po.approvalStatus.toLowerCase(),
            current: true,
          },
        ].filter(Boolean)}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Purchase Order</div>
        <div className="stat">
          <div className="label">Workflow</div>
          <div className="value" style={{ fontSize: 18 }}>
            <StateBadge state={po.workflowState} size="lg" />
          </div>
          <div className="sub">
            <StatusBadge status={po.status} />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Purchase order</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="PO ID" value={po.poId} mono />
            <Detail label="Date" value={fmtDate(po.poDate)} />
            <Detail label="Order mode" value={po.orderMode.replace(/_/g, ' ').toLowerCase()} />
            <Detail label="Vendor" value={`${po.vendor?.vendorName} (${po.vendor?.vendorCode})`} />
            <Detail label="Address" value={po.address} className="span-2" />
            <Detail label="GST No" value={po.vendor?.gstNo} />
            <Detail label="Excess Allowed" value={`${po.excessAllowedPct}%`} />
            {/*
              C1: what this PO was actually judged against, as stored on the
              row. Shown rather than recomputed, because the BOM behind it is
              free to have moved since - and the point of persisting it is that
              the ceiling applied here does not move with it.
            */}
            {po.computedRequirementQty != null && (
              <Detail
                label="Style requirement (frozen at creation)"
                value={`${po.computedRequirementQty} ${po.uom}`}
              />
            )}
            {po.requirementBasis && (
              <Detail label="How that was arrived at" value={po.requirementBasis} className="span-2" />
            )}
            {po.bulkVarianceQty != null && (
              <Detail
                label="Variance vs reference style"
                value={`${po.bulkVarianceQty} ${po.uom} — recorded, not enforced (bulk order)`}
                className="span-2"
              />
            )}
            {po.remarks && <Detail label="Remarks" value={po.remarks} className="span-2" />}
            {po.rejectionReason && (
              <Detail label="Rejection Reason" value={po.rejectionReason} className="span-2" />
            )}
          </DetailGrid>
        </div>
      </div>

      {/* --- What was bought ----------------------------------------------- */}
      <MaterialSpec po={po} />

      {/* --- Receipts ------------------------------------------------------ */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Receipts</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {receipts.count} GRN(s) · {fmtNum(receipts.receivedQty)} {po.uom} ·{' '}
            {fmtMoney(receipts.receivedValue)}
            {receipts.breaches > 0 && ` · ${receipts.breaches} over tolerance`}
          </span>
        </div>
        {receipts.count === 0 ? (
          <div className="card-body muted">Nothing has been received against this PO yet.</div>
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>GRN No</th>
                  <th>Date</th>
                  <th>Bill No</th>
                  <th className="num">Receiving Qty</th>
                  <th className="num">Rate</th>
                  <th className="num">Amount</th>
                  <th className="num">Variation</th>
                  <th>Location</th>
                  <th>Posted</th>
                </tr>
              </thead>
              <tbody>
                {receipts.grns.map((g) => (
                  <tr
                    key={g.id}
                    onClick={() => navigate(`/grns/${g.id}`)}
                    className={`clickable ${g.toleranceBreached ? 'row-warn' : ''}`}
                  >
                    <td className="code">{g.grnNo}</td>
                    <td className="nowrap">{fmtDate(g.grnDate)}</td>
                    <td>{g.billNo}</td>
                    <td className="num">{fmtNum(g.receivingQty)}</td>
                    <td className="num">{fmtNum(g.inventoryRate, { decimals: 4 })}</td>
                    <td className="num">{fmtMoney(g.amount)}</td>
                    <td className="num">
                      {(Number(g.variationPct) * 100).toFixed(2)}%
                      {g.toleranceBreached && <div className="faint">over tolerance</div>}
                    </td>
                    <td>{g.location}</td>
                    <td>{g.postedAt ? fmtDate(g.postedAt) : <span className="faint">not posted</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>

      {/* --- Gate passes --------------------------------------------------- */}
      {gatePasses.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Gate passes</div>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Gate Pass No</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Purpose</th>
                  <th className="num">Qty</th>
                  <th className="num">Received</th>
                  <th className="num">Variation</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {gatePasses.map((g) => (
                  <tr className="clickable" key={g.id} onClick={() => navigate(`/gate-passes/${g.id}`)}>
                    <td className="code">{g.gatePassNo}</td>
                    <td className="nowrap">{fmtDate(g.gatePassDate)}</td>
                    <td>{g.type}</td>
                    <td>{g.purpose}</td>
                    <td className="num">{fmtNum(g.qty)}</td>
                    <td className="num">{g.receivedQty === null ? '-' : fmtNum(g.receivedQty)}</td>
                    <td className="num">{(Number(g.variationPct) * 100).toFixed(2)}%</td>
                    <td>
                      <StatusBadge status={g.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      <WorkflowTrail history={history} />

      {editing && (
        <Modal title={`Edit ${po.poId}`} size="wide" onClose={() => setEditing(false)}>
          <PurchaseOrderForm
            purchaseOrder={po}
            onCancel={() => setEditing(false)}
            onSaved={async () => {
              setEditing(false);
              setBanner({ kind: 'success', text: 'Saved. The amount was recalculated.' });
              await load();
            }}
          />
        </Modal>
      )}

      {dialog && (
        <DecisionDialog
          po={po}
          mode={dialog}
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
          title="Delete purchase order"
          danger
          busy={busy}
          confirmLabel="Delete"
          message={`Delete ${po.poId}? It is hidden rather than erased, and the number is never reused.`}
          onConfirm={doDelete}
          onCancel={() => setDeleting(false)}
        />
      )}
    </>
  );
}

/** The Director's decision on the PO. */
function DecisionDialog({ po, mode, onCancel, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const config = {
    approve: { title: `Approve ${po.poId}`, confirm: 'Approve', danger: false, needsReason: false },
    reject: { title: `Reject ${po.poId}`, confirm: 'Reject', danger: true, needsReason: true },
    reopen: { title: `Reopen ${po.poId}`, confirm: 'Reopen', danger: false, needsReason: true },
  }[mode];

  async function go() {
    setBusy(true);
    setError('');
    try {
      if (mode === 'approve') {
        const approved = await poApi.approve(po.id, { remarks: text || undefined });
        onDone(`${po.poId} approved at ${fmtMoney(approved.amount)}.`);
      } else if (mode === 'reject') {
        await poApi.reject(po.id, text);
        onDone(`${po.poId} rejected. Nothing can be received against it.`);
      } else {
        await poApi.reopen(po.id, text);
        onDone(`${po.poId} reopened and is awaiting a fresh decision.`);
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
          <strong>{po.vendor?.vendorName}</strong> — {fmtNum(po.orderQty)} {po.uom} at{' '}
          {fmtNum(po.rate, { decimals: 4 })}, an amount of <strong>{fmtMoney(po.amount)}</strong>.
        </p>

        {po.traceability.quotation && !po.traceability.quotation.rateMatchesPo && (
          <Alert kind="warning">
            The approved quotation {po.traceability.quotation.quotationNo} was at{' '}
            {fmtNum(po.traceability.quotation.rateQuoted, { decimals: 4 })}, not{' '}
            {fmtNum(po.rate, { decimals: 4 })}.
          </Alert>
        )}
        {!po.traceability.quotation && mode === 'approve' && (
          <Alert kind="warning">
            No quotation is attached. This rate was not competitively authorised.
          </Alert>
        )}

        {po.remarks && <p className="muted">Remarks: {po.remarks}</p>}

        <Field label={config.needsReason ? 'Reason' : 'Remarks'} required={config.needsReason}>
          <TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * What the order is FOR, described by the columns that actually apply to it.
 *
 * ===========================================================================
 *  WHY EMPTY SPECS ARE OMITTED RATHER THAN DASHED
 * ===========================================================================
 *
 *  These nine columns are one shape covering every material the company buys,
 *  so most of them are blank on any given order: a fabric PO has no
 *  accessories item, an accessories PO has no GSM, count or content. Rendered
 *  unconditionally they produced a panel that was more dashes than data - five
 *  of twelve fields on an ordinary fabric order - and a dash reads as "this is
 *  missing" when the truth is "this does not apply here".
 *
 *  The omission itself lives in `Detail`, which does this for every detail
 *  screen; the reasoning is written out there. The order's binding figures -
 *  quantity, rate, amount - are on the panel above and are never hidden.
 */
function MaterialSpec({ po }) {
  /* Not filtered here: `Detail` omits a field with nothing in it, so the ones
     that do not describe this material simply do not appear. */
  const specs = [
    ['Item', po.item],
    ['Sub Category', po.subCategory],
    ['Accessories Item', po.accessoriesItem],
    ['Variety', po.accessoryType],
    ['Size', po.size],
    ['Colour', po.colorCode],
    ['Content', po.content],
    ['GSM', po.gsm],
    ['Count', po.count],
    ['UOM', po.uom],
    ['HSN Code', po.hsnCode],
  ];

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <span>Material</span>
        <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
          as it will be received and stocked
        </span>
      </div>
      <div className="card-body">
        <DetailGrid>
          {specs.map(([label, value]) => (
            <Detail key={label} label={label} value={value} />
          ))}
        </DetailGrid>
      </div>
    </div>
  );
}
