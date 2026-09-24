/**
 * Gate Pass detail: the pass, the document it is against, the count, and the
 * clearing.
 *
 * Clearing is the act this screen exists for, so it is a big obvious button
 * with a confirmation - the pass is what a GRN is later raised on, and a
 * cleared pass says goods physically moved.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { gatePasses as gpApi } from '../../services/erp.js';
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
  TextInput,
} from '../../components/ui.jsx';

import { Detail, DetailGrid, TraceChain } from '../shared/Detail.jsx';
import { PURPOSE_OPTIONS } from './GatePassList.jsx';
import { QtyStepper } from '../../components/mobile.jsx';
import { fmtDate, fmtDateTime, fmtEnum, fmtMoney, fmtNum } from '../../utils/format.js';
import TableWrap from '../../components/TableWrap.jsx';

export default function GatePassDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [gp, setGp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [allocating, setAllocating] = useState(false);
  const [allocDoc, setAllocDoc] = useState('');
  const [allocPurpose, setAllocPurpose] = useState('');
  const [allocBusy, setAllocBusy] = useState(false);
  const [allocError, setAllocError] = useState('');
  const [reopening, setReopening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const canClear = can('GATE_PASS.APPROVE');
  const canAllocate = can('GATE_PASS.EDIT');
  const canDelete = can('GATE_PASS.DELETE');
  const canPrint = can('GATE_PASS.EXPORT');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGp(await gpApi.get(id));
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
      await gpApi.remove(id);
      navigate('/gate-passes', { replace: true });
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !gp) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading gate pass..." />
        </div>
      </div>
    );
  }
  if (!gp) return <Alert kind="error">{banner?.text ?? 'Gate pass not found'}</Alert>;

  const { reference, editable, grns, usage } = gp;

  return (
    <>
      <PageHeader
        title={`${gp.type === 'INWARD' ? 'Inward' : 'Outward'} Gate Pass ${gp.gatePassNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/gate-passes')}>
              Back to list
            </button>
            {canPrint && (
              <button type="button" className="btn" onClick={() => navigate(`/print/gate-pass/${gp.id}`)}>
                Print
              </button>
            )}
            {canClear && editable.canReopen && (
              <button type="button" className="btn" onClick={() => setReopening(true)}>
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

      {/*
        An unallocated pass is a delivery nobody has matched to an order yet.
        It is shown before the "not cleared" notice because it is the thing
        standing in the way: a pass cannot be cleared until it is allocated.
      */}
      {!gp.linkedDocNo && (
        <Alert kind="warning">
          <strong>Not allocated.</strong> This delivery was recorded at the gate from{' '}
          {gp.partyName}
          {gp.movementTime && ` at ${fmtDateTime(gp.movementTime)}`}, but has not been matched to a
          purchase order, job work or cutting challan yet. It cannot be cleared until it is.
          {canAllocate && (
            <span className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setAllocating(true)}>
                Allocate to a document
              </button>
            </span>
          )}
        </Alert>
      )}

      {gp.status === 'PENDING' && gp.linkedDocNo && (
        <Alert kind="warning">
          This pass has not been cleared. The goods have not been confirmed as counted.
          {canClear && (
            <span className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setClearing(true)}>
                Clear the pass
              </button>
            </span>
          )}
        </Alert>
      )}

      {gp.status === 'CLEARED' && (
        <Alert kind="success">
          Cleared by {gp.clearedByName ?? 'the gate'} on {fmtDateTime(gp.clearedAt)}.
        </Alert>
      )}

      {gp.variationDirection && gp.variationDirection !== 'EXACT' && (
        <Alert kind={gp.variationDirection === 'SHORT' ? 'warning' : 'info'}>
          {gp.variationDirection === 'SHORT' ? 'Short delivery' : 'Over delivery'} —{' '}
          {gp.variationPctDisplay}% variation. {gp.variationCalculation}
        </Alert>
      )}

      <TraceChain
        title="Reference document"
        chain={reference.chain}
        complete={reference.kind !== 'UNRESOLVED'}
        incompleteNote={reference.note}
        links={[
          reference.kind !== 'UNRESOLVED' && {
            label: fmtEnum(reference.kind),
            value: reference.no,
            sub: reference.party ?? undefined,
            to: reference.route ?? undefined,
          },
          { label: 'Gate Pass', value: gp.gatePassNo, sub: gp.status.toLowerCase(), current: true },
        ].filter(Boolean)}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Gate Pass</div>
        <div className="card-body">
          <div className="value" style={{ fontSize: 18 }}>
            <StatusBadge status={gp.status} />
          </div>
          <div className="sub">{fmtEnum(gp.purpose, 'not allocated')}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Gate pass</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Gate Pass No" value={gp.gatePassNo} mono />
            <Detail label="Date" value={fmtDate(gp.gatePassDate)} />
            <Detail label="Type" value={gp.type === 'INWARD' ? 'Inward' : 'Outward'} />
            <Detail label="Reference" value={gp.linkedDocNo} mono />
            <Detail label="Item" value={gp.item} />
            <Detail label="Party" value={gp.vendor?.vendorName ?? gp.partyName} />
            <Detail label="UOM" value={gp.uom} />
            <Detail label="Purpose" value={fmtEnum(gp.purpose)} />
            <Detail label="Vehicle no" value={gp.vehicleNo} mono />
            <Detail label="Driver name" value={gp.driverName} />
            <Detail label="Cleared by" value={gp.clearedByName} showEmpty />
            <Detail label="Cleared at" value={gp.clearedAt ? fmtDateTime(gp.clearedAt) : null} showEmpty />
            {gp.remarks && <Detail label="Remarks" value={gp.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      {grns.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Goods received on this pass</div>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>GRN No</th>
                  <th>Date</th>
                  <th>Bill No</th>
                  <th className="num">Receiving Qty</th>
                  <th className="num">Amount</th>
                  <th>Posted</th>
                </tr>
              </thead>
              <tbody>
                {grns.map((g) => (
                  <tr className="clickable" key={g.id} onClick={() => navigate(`/grns/${g.id}`)}>
                    <td className="code">{g.grnNo}</td>
                    <td className="nowrap">{fmtDate(g.grnDate)}</td>
                    <td>{g.billNo}</td>
                    <td className="num">{fmtNum(g.receivingQty)}</td>
                    <td className="num">{fmtMoney(g.amount)}</td>
                    <td>{g.postedAt ? fmtDate(g.postedAt) : <span className="faint">not posted</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      {clearing && (
        <ClearDialog
          gatePass={gp}
          onCancel={() => setClearing(false)}
          onDone={async (message) => {
            setClearing(false);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}

      {reopening && (
        <ReopenDialog
          gatePass={gp}
          onCancel={() => setReopening(false)}
          onDone={async (message) => {
            setReopening(false);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}

      {allocating && (
        <Modal title={`Allocate ${gp.gatePassNo}`} size="narrow" onClose={() => setAllocating(false)}>
          <div className="modal-body">
            {allocError && <Alert kind="error">{allocError}</Alert>}
            <p className="muted" style={{ marginTop: 0 }}>
              {gp.partyName} delivered
              {gp.movementTime && ` at ${fmtDateTime(gp.movementTime)}`}. Name the document this
              load answers - the item, quantity and UOM are taken from it.
            </p>
            <Field
              label="Document"
              required
              hint="The purchase order, job work or cutting challan number."
              htmlFor="alloc-doc"
            >
              <TextInput
                id="alloc-doc"
                value={allocDoc}
                onChange={(e) => setAllocDoc(e.target.value)}
                placeholder="RF-001, DY-001, CH-001..."
                autoFocus
              />
            </Field>
            <Field label="Purpose" required htmlFor="alloc-purpose">
              {/* An enum, not a Master List. This asked for a list called
                  "Purpose", which is not one of the twenty-five that exist, so
                  the control rendered "List unavailable" on a required field
                  and the dialog could not be completed as intended. */}
              <EnumSelect
                id="alloc-purpose"
                options={PURPOSE_OPTIONS}
                value={allocPurpose}
                onChange={(e) => setAllocPurpose(e.target.value)}
              />
            </Field>
            <p className="faint" style={{ fontSize: 11.5, marginBottom: 0 }}>
              A pass is allocated once. If it goes to the wrong document, cancel it and raise the
              right one - that leaves both facts on the record.
            </p>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={() => setAllocating(false)}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={allocBusy || !allocDoc.trim()}
              onClick={async () => {
                setAllocBusy(true);
                setAllocError('');
                try {
                  await gpApi.allocate(gp.id, {
                    linkedDocNo: allocDoc.trim(),
                    purpose: allocPurpose || undefined,
                  });
                  setAllocating(false);
                  setBanner({ kind: 'success', text: `${gp.gatePassNo} allocated to ${allocDoc.trim()}.` });
                  await load();
                } catch (e) {
                  setAllocError(e.message);
                } finally {
                  setAllocBusy(false);
                }
              }}
            >
              {allocBusy ? 'Allocating...' : 'Allocate'}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete gate pass"
          danger
          busy={busy}
          confirmLabel="Delete"
          message={`Delete ${gp.gatePassNo}? It is hidden rather than erased, and the number is never reused.`}
          onConfirm={doDelete}
          onCancel={() => setDeleting(false)}
        />
      )}
    </>
  );
}

/** The count at the gate. The variation follows from it, on the server. */
function ClearDialog({ gatePass, onCancel, onDone }) {
  const [receivedQty, setReceivedQty] = useState(String(gatePass.qty));
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      const cleared = await gpApi.clear(gatePass.id, {
        receivedQty: String(receivedQty),
        remarks: remarks || undefined,
      });
      onDone(
        `${gatePass.gatePassNo} cleared at ${fmtNum(cleared.receivedQty)} ${gatePass.uom}` +
          (cleared.variationDirection !== 'EXACT'
            ? ` — ${cleared.variationPctDisplay}% ${cleared.variationDirection.toLowerCase()}.`
            : '.'),
      );
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Clear ${gatePass.gatePassNo}`}
      size="narrow"
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
            disabled={busy || receivedQty === '' || Number(receivedQty) < 0}
          >
            {busy ? 'Clearing...' : 'Clear the pass'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>
        <p style={{ marginTop: 0 }}>
          The document says <strong>{fmtNum(gatePass.qty)} {gatePass.uom}</strong>. Enter what was
          actually counted; the variation is worked out from the two.
        </p>
        <QtyStepper
          value={receivedQty}
          onChange={setReceivedQty}
          uom={gatePass.uom}
          label="Received Qty"
          max={gatePass.qty}
        />
        <Field label="Remarks" className="span-2">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ReopenDialog({ gatePass, onCancel, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      await gpApi.reopen(gatePass.id, reason);
      onDone(`${gatePass.gatePassNo} reopened.`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Reopen ${gatePass.gatePassNo}`}
      size="narrow"
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
            disabled={busy || reason.trim().length < 3}
          >
            {busy ? 'Working...' : 'Reopen'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>
        <p style={{ marginTop: 0 }}>
          A cleared pass records goods that crossed the gate. Reopening it says that record was
          wrong.
        </p>
        <Field label="Reason" required>
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
