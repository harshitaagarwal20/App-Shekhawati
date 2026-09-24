/**
 * Vendor Quotation detail: the quotation, the server-computed amount, the
 * competing quotes for the same thing, the authorisation decision, and the
 * trail.
 *
 * Every number rendered here arrives from the API already calculated.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { quotations as quotationsApi } from '../../services/erp.js';
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
import QuotationForm from './QuotationForm.jsx';
import { fmtDate, fmtDateTime } from '../../utils/format.js';
import TableWrap from '../../components/TableWrap.jsx';


const fmtNum = (v) =>
  v === null || v === undefined ? '-' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function QuotationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [quotation, setQuotation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState(null); // 'approve' | 'reject' | 'reopen'
  const [deleting, setDeleting] = useState(false);

  const canEdit = can('VENDOR_QUOTATION.EDIT');
  // F-10: the permission says what this ROLE may do; `canApprove` from the
  // server says whether THIS user may approve THIS document - it is false
  // when they raised it themselves. Both must hold, or the button would be
  // offered and then refused with a 403.
  const canApprove = can('VENDOR_QUOTATION.APPROVE') && quotation?.canApprove !== false;
  const canDelete = can('VENDOR_QUOTATION.DELETE');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setQuotation(await quotationsApi.get(id));
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
      await quotationsApi.remove(id);
      navigate('/quotations', { replace: true });
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !quotation) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading quotation..." />
        </div>
      </div>
    );
  }
  if (!quotation) return <Alert kind="error">{banner?.text ?? 'Quotation not found'}</Alert>;

  const { competing, usage, editable, history } = quotation;
  const pending = quotation.authorisationStatus === 'PENDING';

  return (
    <>
      <PageHeader
        title={`Quotation ${quotation.quotationNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/quotations')}>
              Back to list
            </button>
            {canEdit && editable.canEdit && (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {canApprove && !pending && usage.purchaseOrders === 0 && (
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

      {banner && (
        <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Alert>
      )}

      {pending && (
        <Alert kind="warning">
          This quotation is awaiting authorisation. Nothing can be purchased against it until it is
          approved.
          {canApprove && (
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

      {quotation.authorisationStatus === 'REJECTED' && (
        <Alert kind="error">
          Rejected by {quotation.approvedByName} on {fmtDate(quotation.decidedAt)}:{' '}
          {quotation.rejectionReason}
        </Alert>
      )}

      {quotation.authorisationStatus === 'APPROVED' && (
        <Alert kind="success">
          Approved by {quotation.approvedByName} on {fmtDate(quotation.approvedAt)}. A purchase order
          may be raised against it.
        </Alert>
      )}

      {competing.count > 0 && !competing.isLowestRate && (
        <Alert kind="warning">
          This is not the lowest rate quoted for this item. {competing.lowestRateVendor} quoted{' '}
          {fmtNum(competing.lowestRate)} &mdash; choosing this one costs{' '}
          <strong>{fmtNum(competing.premiumOverLowest)}</strong> more on this quantity.
        </Alert>
      )}

      {/* --- Quotation details -------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Quotation</div>
        <div className="card-body">
          <div className="form-grid">
            <Detail label="Quotation No" value={quotation.quotationNo} mono />
            <Detail label="Date" value={fmtDate(quotation.quotationDate)} />
            <Detail label="Vendor" value={`${quotation.vendor?.vendorName} (${quotation.vendor?.vendorCode})`} />
            <Detail label="Vendor Category" value={quotation.vendor?.category} />
            <Detail label="Item" value={quotation.item} />
            <Detail label="Sub Category" value={quotation.subCategory} />
            <Detail label="Accessories Item" value={quotation.accessoriesItem} />
            <Detail label="Accessory Type" value={quotation.accessoryType} />
            <Detail label="UOM" value={quotation.uom} />
            <Detail label="Order No" value={quotation.order?.orderNo} mono />
            <Detail label="Buyer" value={quotation.order?.buyer?.buyerName} />
            <Detail label="Style No" value={quotation.order?.style?.styleNo} mono />
            <Detail label="Authorised By" value={quotation.authorisedBy} />
            {quotation.remarks && <Detail label="Remarks" value={quotation.remarks} className="span-2" />}
            {quotation.rejectionReason && (
              <Detail label="Rejection Reason" value={quotation.rejectionReason} className="span-2" />
            )}
          </div>

          {!editable.canEdit && (
            <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>
              {usage.purchaseOrders > 0
                ? `This quotation is locked by ${editable.lockedBy.join(', ')}.`
                : 'A decided quotation is the record of that decision and does not change. Raise a fresh quotation instead.'}
            </p>
          )}
        </div>
      </div>

      {/* --- Competing quotations ----------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Competing quotations</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            same item, same order &mdash; {competing.count} other quote(s)
          </span>
        </div>
        {competing.count === 0 ? (
          <div className="card-body muted">
            No other vendor has quoted for this item on this order.
          </div>
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Quotation No</th>
                  <th>Vendor</th>
                  <th className="num">Rate</th>
                  <th className="num">Qty</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="code">
                    <strong>{quotation.quotationNo}</strong>
                    <div className="faint">this quotation</div>
                  </td>
                  <td>{quotation.vendor?.vendorName}</td>
                  <td className="num">
                    {fmtNum(quotation.rateQuoted)}
                    {competing.isLowestRate && <div className="faint">lowest</div>}
                  </td>
                  <td className="num">{fmtNum(quotation.qty)}</td>
                  <td className="num">{fmtNum(quotation.amount)}</td>
                  <td>
                    <StatusBadge status={quotation.authorisationStatus} />
                  </td>
                </tr>
                {competing.quotations.map((q) => (
                  <tr className="clickable"
                    key={q.id}
                    onClick={() => navigate(`/quotations/${q.id}`)}
                  >
                    <td className="code">{q.quotationNo}</td>
                    <td>{q.vendor?.vendorName}</td>
                    <td className="num">
                      {fmtNum(q.rateQuoted)}
                      {String(q.rateQuoted) === String(competing.lowestRate) && (
                        <div className="faint">lowest</div>
                      )}
                    </td>
                    <td className="num">{fmtNum(q.qty)}</td>
                    <td className="num">{fmtNum(q.amount)}</td>
                    <td>
                      <StatusBadge status={q.authorisationStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>

      {/* --- Trail --------------------------------------------------------- */}
      <div className="card">
        <div className="card-header">Authorisation trail</div>
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

      {editing && (
        <Modal title={`Edit quotation ${quotation.quotationNo}`} size="wide" onClose={() => setEditing(false)}>
          <QuotationForm
            quotation={quotation}
            onCancel={() => setEditing(false)}
            onSaved={async () => {
              setEditing(false);
              setBanner({ kind: 'success', text: 'Quotation saved. The amount was recalculated.' });
              await load();
            }}
          />
        </Modal>
      )}

      {dialog && (
        <DecisionDialog
          quotation={quotation}
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
          title="Delete quotation"
          danger
          busy={busy}
          confirmLabel="Delete"
          message={`Delete quotation ${quotation.quotationNo}? It is hidden rather than erased, and the number is never reused.`}
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

/** The Director's decision on the "Authorisation Status" column. */
function DecisionDialog({ quotation, mode, onCancel, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const config = {
    approve: { title: 'Approve quotation', confirm: 'Approve', danger: false, needsReason: false },
    reject: { title: 'Reject quotation', confirm: 'Reject', danger: true, needsReason: true },
    reopen: { title: 'Reopen quotation', confirm: 'Reopen', danger: false, needsReason: true },
  }[mode];

  async function go() {
    setBusy(true);
    setError('');
    try {
      if (mode === 'approve') {
        const approved = await quotationsApi.approve(quotation.id, { remarks: text || undefined });
        onDone(`Quotation approved at ${fmtNum(approved.amount)}.`);
      } else if (mode === 'reject') {
        await quotationsApi.reject(quotation.id, text);
        onDone('Quotation rejected. It cannot become a purchase order.');
      } else {
        await quotationsApi.reopen(quotation.id, text);
        onDone('Quotation reopened and is awaiting a fresh decision.');
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
          <strong>{quotation.vendor?.vendorName}</strong> quoted{' '}
          <strong>{fmtNum(quotation.rateQuoted)}</strong> per {quotation.uom} for{' '}
          {fmtNum(quotation.qty)} {quotation.uom} &mdash; an amount of{' '}
          <strong>{fmtNum(quotation.amount)}</strong>.
        </p>

        {quotation.competing.count > 0 && (
          <p className="muted">
            {quotation.competing.isLowestRate
              ? `This is the lowest of ${quotation.competing.count + 1} quotes for this item.`
              : `${quotation.competing.lowestRateVendor} quoted ${fmtNum(quotation.competing.lowestRate)} — ` +
                `${fmtNum(quotation.competing.premiumOverLowest)} less on this quantity.`}
          </p>
        )}

        {quotation.remarks && <p className="muted">Remarks: {quotation.remarks}</p>}

        <Field label={config.needsReason ? 'Reason' : 'Remarks'} required={config.needsReason}>
          <TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
