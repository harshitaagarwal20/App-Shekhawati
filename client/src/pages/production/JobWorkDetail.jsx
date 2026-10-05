/**
 * Job Work detail, and the return.
 *
 * Booking a return is the act this screen exists for. It is one transaction on
 * the server - receipt, stock ledger IN for what actually came back, the roll's
 * balance and stage, and the job's running totals - so the confirmation here
 * says what all of that will do before it does it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { jobWorks as jwApi } from '../../services/erp.js';
import {
  Alert,
  EnumSelect,
  Field,
  MasterSelect,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import { QtyStepper } from '../../components/mobile.jsx';
import { Detail, DetailGrid, TraceChain } from '../shared/Detail.jsx';
import { fmtDate, fmtEnum, fmtNum } from '../../utils/format.js';
import TableWrap from '../../components/TableWrap.jsx';

export default function JobWorkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [receiving, setReceiving] = useState(false);

  const canReceive = can('DYEING_RECEIPT.CREATE');
  const canPrint = can('DYE_ISSUE.EXPORT');

  /**
   * C3 - a job work order is [A][S] and starts as a DRAFT.
   *
   * Until it is APPROVED no fabric can be issued against it: `assertJobWorkAuthorised()`
   * refuses the Fabric Issue by name. Without these buttons the order could be
   * raised and then never acted on, which is how the screen stood before C3 -
   * the workflow existed on the server and had no way in from the UI.
   *
   * Approving does NOT move stock. The Fabric Issue against the approved order
   * posts both ledger legs and moves this document to POSTED.
   */
  // F-10: the permission says what this ROLE may do; `canApprove` from the
  // server says whether THIS user may approve THIS document - it is false
  // when they raised it themselves. Both must hold, or the button would be
  // offered and then refused with a 403.
  const canApproveJob = can('DYE_ISSUE.APPROVE') && job?.canApprove !== false;
  const [workflowBusy, setWorkflowBusy] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setJob(await jwApi.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  /** One place the three workflow actions report success and failure. */
  async function runWorkflow(label, fn) {
    setWorkflowBusy(label);
    try {
      await fn();
      await load();
      setBanner({ kind: 'success', text: `Job work order ${label}d.` });
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setWorkflowBusy('');
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !job) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading job..." />
        </div>
      </div>
    );
  }
  if (!job) return <Alert kind="error">{banner?.text ?? 'Job work not found'}</Alert>;

  const { meta, editable, receipts, rollMovements, gatePasses } = job;

  return (
    <>
      <PageHeader
        title={`${meta.documentName} ${job.dyeIssueNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/job-works')}>
              Back to list
            </button>
            {canPrint && (
              <button type="button" className="btn" onClick={() => navigate(`/print/job-work/${job.id}`)}>
                Print
              </button>
            )}
            {/* C3 - the approval half of [A][S]. */}
            {job.workflowState === 'DRAFT' && can('DYE_ISSUE.EDIT') && (
              <button
                type="button"
                className="btn"
                disabled={Boolean(workflowBusy)}
                onClick={() => runWorkflow('submit', () => jwApi.submit(job.id, { submittedTo: 'Approver' }))}
              >
                {workflowBusy === 'submit' ? 'Submitting…' : 'Submit for approval'}
              </button>
            )}
            {['SUBMITTED', 'PENDING_APPROVAL', 'RESUBMITTED'].includes(job.workflowState) &&
              canApproveJob && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={Boolean(workflowBusy)}
                    onClick={() => runWorkflow('approve', () => jwApi.approve(job.id, {}))}
                  >
                    {workflowBusy === 'approve' ? 'Approving…' : 'Approve'}
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => setRejecting(true)}>
                    Reject
                  </button>
                </>
              )}
            {canReceive && editable.canReceive && (
              <button type="button" className="btn btn-primary" onClick={() => setReceiving(true)}>
                Book a return
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

      {/* The process, said plainly. The four share a table; they must not share
          a label. */}
      <Alert kind="info">
        <strong>{meta.label}</strong> job at a {meta.vendorLabel.toLowerCase()}. Loss is measured as{' '}
        {meta.lossLabel.toLowerCase()}, with {job.standardShrinkagePctDisplay}% allowed.
      </Alert>

      {job.shrinkageBreached && (
        <Alert kind="warning">
          <strong>{meta.lossLabel} over the allowance.</strong> {job.shrinkagePctDisplay}% against a
          permitted {job.standardShrinkagePctDisplay}%. The roll was held for scrutiny.
        </Alert>
      )}

      <TraceChain
        title="Traceability"
        chain={[job.order?.orderNo, job.fabricIssue?.issueNo, job.roll?.rollNo, job.dyeIssueNo]
          .filter(Boolean)
          .join(' → ')}
        complete={Boolean(job.order && job.fabricIssue)}
        links={[
          job.order && {
            label: 'Buyer Order',
            value: job.order.orderNo,
            sub: job.order.buyer?.buyerName,
            to: `/orders/${job.order.id}`,
          },
          job.fabricIssue && {
            label: 'Fabric Issue',
            value: job.fabricIssue.issueNo,
            sub: `${fmtNum(job.fabricIssue.fabricQtyIssued)} released`,
            to: `/fabric-issues/${job.fabricIssue.id}`,
          },
          job.roll && {
            label: 'Roll',
            value: job.roll.rollNo,
            sub: fmtEnum(job.roll.stage),
            to: `/inventory/rolls/${job.roll.id}`,
          },
          { label: meta.label, value: job.dyeIssueNo, sub: fmtEnum(job.status), current: true },
        ].filter(Boolean)}
      />

      {/* --- Challans: one PO may go out in parts ---------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Challans against this PO</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            PO {fmtNum(job.qty)} · sent {fmtNum(job.issuedQty)} · still to send {fmtNum(job.toSendQty)}{' '}
            {job.uom}
          </span>
        </div>
        {(job.challans ?? []).length === 0 ? (
          <div className="card-body muted">
            No fabric has gone out yet. Once this PO is approved, issue fabric for{' '}
            {meta.label.toLowerCase()} from Fabric Issue — each issue is a challan, and several
            challans can be sent against one PO.
          </div>
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Challan No</th>
                  <th>Date</th>
                  <th className="num">Qty</th>
                  <th>UOM</th>
                </tr>
              </thead>
              <tbody>
                {job.challans.map((c) => (
                  <tr className="clickable" key={c.id} onClick={() => navigate(`/fabric-issues/${c.id}`)}>
                    <td className="code">{c.issueNo}</td>
                    <td className="nowrap">{fmtDate(c.issueDate)}</td>
                    <td className="num">{fmtNum(c.fabricQtyIssued)}</td>
                    <td>{c.uom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Job work issue</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Job No" value={job.dyeIssueNo} mono />
            <Detail label="Date" value={fmtDate(job.issueDate)} />
            <Detail label="Process" value={meta.label} />
            <Detail label="Fabric stage" value={fmtEnum(job.fabricStage)} />
            <Detail label={meta.vendorLabel} value={job.vendor?.vendorName} />
            <Detail label="Address" value={job.address} className="span-2" />
            <Detail label="Pin code" value={job.pinCode} />
            {/* C16: one roll is named here as it always was. Several are a
                table of their own below - a header field cannot carry three
                rolls with three balances. */}
            {job.multiRoll ? (
              <Detail label="Rolls" value={`${job.rollCount} rolls — see below`} />
            ) : (
              <Detail label="Roll No" value={job.roll?.rollNo} mono />
            )}
            <Detail label="Colour" value={job.colourCode} />
            <Detail label="Content" value={job.content} />
            <Detail label="Count" value={job.count} />
            <Detail label="Construction" value={job.construction} />
            <Detail label="Width" value={job.width ? fmtNum(job.width) : null} />
            <Detail label="GSM" value={job.gsm} />
            <Detail label="UOM" value={job.uom} />
            <Detail label="Rate" value={fmtNum(job.rate, { decimals: 4 })} />
            <Detail label="Order No" value={job.order?.orderNo} mono />
            <Detail label="Style No" value={job.style?.styleNo} mono />
            {job.remark && <Detail label="Remark" value={job.remark} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      {/*
        C16 - THE ROLLS, each with its own balance.

        Shown whenever the job carries lines, including a single-roll job:
        "how much of this roll is still to go out, and how much is still at the
        vendor" is the question the store asks, and on a one-roll job it was
        only answerable by reading the header's three totals together.

        Every figure comes from the server. `toSendQty` in particular is the
        number fabricIssue.assertJobWorkAuthorised() enforces, so what is shown
        here and what the next challan is allowed to draw are the same
        arithmetic rather than two that can drift.
      */}
      {(job.rolls?.length ?? 0) > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span>Rolls on this job</span>
            <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
              {job.rollCount} roll(s) · {fmtNum(job.qty)} {job.uom} authorised
            </span>
          </div>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Roll</th>
                  <th className="num">Authorised</th>
                  <th className="num">Sent out</th>
                  <th className="num">Still to send</th>
                  <th className="num">At vendor</th>
                  <th className="num">Returned</th>
                </tr>
              </thead>
              <tbody>
                {job.rolls.map((r) => (
                  <tr key={r.id}>
                    <td>{r.lineNo}</td>
                    <td className="code">{r.rollNo ?? '-'}</td>
                    <td className="num">{fmtNum(r.qty)}</td>
                    <td className="num">{fmtNum(r.issuedQty)}</td>
                    <td className="num">{fmtNum(r.toSendQty)}</td>
                    <td className="num">{fmtNum(r.pendingQty)}</td>
                    <td className="num">
                      {fmtNum(r.receivedQty)}
                      {r.fullyReturned && <span className="faint"> · back</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      {/* --- Returns ------------------------------------------------------ */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Returns</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {receipts.length} receipt(s) — each writes a stock ledger IN for what actually arrived
          </span>
        </div>
        {receipts.length === 0 ? (
          <div className="card-body muted">Nothing has come back from the vendor yet.</div>
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Receipt No</th>
                  <th>Date</th>
                  <th className="num">Qty issued</th>
                  <th className="num">Qty received</th>
                  <th className="num">{meta.lossLabel} %</th>
                  <th className="num">Allowed %</th>
                  <th>Flag</th>
                  <th>Status</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className={r.variationFlag ? 'row-warn' : ''}>
                    <td className="code">{r.receiptNo}</td>
                    <td className="nowrap">{fmtDate(r.receiptDate)}</td>
                    <td className="num">{fmtNum(r.qtyIssued)}</td>
                    <td className="num">
                      <strong>{fmtNum(r.qtyReceived)}</strong>
                    </td>
                    <td className="num">{(Number(r.shrinkagePct) * 100).toFixed(2)}%</td>
                    <td className="num">
                      {(Number(r.standardShrinkageAllowed) * 100).toFixed(2)}%
                    </td>
                    <td>{r.variationFlag ? 'Over' : 'OK'}</td>
                    <td>
                      <StatusBadge status={r.status === 'OK' ? 'APPROVED' : 'PENDING'} />
                    </td>
                    <td className="muted">{r.remarks ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>

      {/* --- The roll's whole history, which is the job's real context ----- */}
      {rollMovements.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Roll movements</div>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Location</th>
                  <th>Direction</th>
                  <th className="num">Qty</th>
                  <th className="num">Balance after</th>
                </tr>
              </thead>
              <tbody>
                {rollMovements.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{fmtDate(m.entryDate)}</td>
                    <td>
                      <div>{fmtEnum(m.documentType)}</div>
                      <div className="code faint">{m.documentNo}</div>
                    </td>
                    <td>{m.location}</td>
                    <td>{m.direction}</td>
                    <td className="num">{fmtNum(m.qty)}</td>
                    <td className="num">{fmtNum(m.balanceQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      {gatePasses.length > 0 && (
        <div className="card">
          <div className="card-header">Gate passes</div>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Gate Pass No</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th className="num">Qty</th>
                  <th className="num">Received</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {gatePasses.map((g) => (
                  <tr className="clickable" key={g.id} onClick={() => navigate(`/gate-passes/${g.id}`)}>
                    <td className="code">{g.gatePassNo}</td>
                    <td className="nowrap">{fmtDate(g.gatePassDate)}</td>
                    <td>{g.type}</td>
                    <td className="num">{fmtNum(g.qty)}</td>
                    <td className="num">{g.receivedQty === null ? '-' : fmtNum(g.receivedQty)}</td>
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

      {rejecting && (
        <Modal
          title="Reject this job work order"
          onClose={() => setRejecting(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRejecting(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={rejectReason.trim().length < 3 || Boolean(workflowBusy)}
                onClick={() =>
                  runWorkflow('reject', async () => {
                    await jwApi.reject(job.id, rejectReason);
                    setRejecting(false);
                    setRejectReason('');
                  })
                }
              >
                Reject
              </button>
            </>
          }
        >
          <p className="hint">
            The fabric stays in the store. Nothing is issued against a rejected order.
          </p>
          <Field label="Reason" required>
            <TextArea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </Field>
        </Modal>
      )}

      {receiving && (
        <ReceiveDialog
          job={job}
          onCancel={() => setReceiving(false)}
          onDone={async (message) => {
            setReceiving(false);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}
    </>
  );
}

/**
 * Booking a return.
 *
 * The shrinkage preview runs as the storeman types, from the server, so the
 * consequence - "this goes to scrutiny and the roll will be held" - is on
 * screen before the button is pressed rather than after.
 */
function ReceiveDialog({ job, onCancel, onDone }) {
  /*
   * C16 - WHICH ROLL IS COMING BACK.
   *
   * Only the lines that still have cloth at the vendor can be returned
   * against. A single-roll job preselects the one answer and never shows the
   * picker; a multi-roll job must be told, because shrinkage is measured
   * against what went out ON THAT ROLL and guessing would post the return
   * against the wrong balance. The server refuses an unstated roll for the
   * same reason - this is the screen agreeing with it, not substituting for it.
   */
  const returnable = (job.rolls ?? []).filter((r) => Number(r.pendingQty) > 0);
  const [rollLineId, setRollLineId] = useState(
    returnable.length === 1 ? returnable[0].rollId : '',
  );
  const line = (job.rolls ?? []).find((r) => r.rollId === rollLineId) ?? null;

  const [qtyReceived, setQtyReceived] = useState('');
  const [location, setLocation] = useState('MAIN STORE');
  const [dyeLot, setDyeLot] = useState('');
  const [shade, setShade] = useState('');
  const [remarks, setRemarks] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (qtyReceived === '') {
      setPreview(null);
      return undefined;
    }
    const id = setTimeout(async () => {
      try {
        setPreview(
          await jwApi.previewReceipt({ dyeIssueId: job.id, qtyReceived: String(qtyReceived) }),
        );
      } catch {
        setPreview(null);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [qtyReceived, job.id]);

  async function go() {
    setBusy(true);
    setError('');
    try {
      const result = await jwApi.receive(job.id, {
        ...(rollLineId ? { rollId: rollLineId } : {}),
        qtyReceived: String(qtyReceived),
        location: location || undefined,
        dyeLot: dyeLot || undefined,
        shade: shade || undefined,
        remarks: remarks || undefined,
      });
      onDone(
        `${result.receipt.receiptNo} booked — ${fmtNum(qtyReceived)} ${job.uom} back` +
          (result.receipt.variationFlag
            ? `, ${job.meta.lossLabel.toLowerCase()} over the allowance. The roll is held for scrutiny.`
            : '.'),
      );
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Book a return against ${job.dyeIssueNo}`}
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
            disabled={
              busy ||
              !(Number(qtyReceived) > 0) ||
              preview?.exceedsIssued ||
              (returnable.length > 1 && !rollLineId)
            }
          >
            {busy ? 'Booking...' : 'Book the return'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>

        {returnable.length > 1 && (
          <Field label="Roll coming back" required>
            <EnumSelect
              placeholder="Which roll has arrived?"
              value={rollLineId}
              onChange={(e) => {
                setRollLineId(e.target.value);
                // The quantity belonged to the previous roll's balance.
                setQtyReceived('');
              }}
              options={returnable.map((r) => ({
                value: r.rollId,
                label: `${r.rollNo} — ${fmtNum(r.pendingQty)} ${job.uom} at the vendor`,
              }))}
            />
          </Field>
        )}

        <p style={{ marginTop: 0 }}>
          {line ? (
            <>
              {fmtNum(line.issuedQty)} {job.uom} of roll {line.rollNo} went out on{' '}
              {job.dyeIssueNo}; {fmtNum(line.receivedQty)} has already come back. Enter what
              arrived now.
            </>
          ) : (
            <>
              {fmtNum(job.issuedQty)} {job.uom} went out on {job.dyeIssueNo};{' '}
              {fmtNum(job.receivedQty)} has already come back. Choose the roll that has arrived.
            </>
          )}
        </p>

        <QtyStepper
          value={qtyReceived}
          onChange={setQtyReceived}
          uom={job.uom}
          label="Qty received"
          available={line ? line.pendingQty : job.pendingQty}
          max={job.pendingQty}
        />

        <Field label="Back into" style={{ marginTop: 12 }}>
          <MasterSelect
            listCode="StockLocation"
            value={location}
            currentValue={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </Field>

        <div className="form-grid">
          <Field
            label="Dye lot"
            hint={job.process === 'DYEING' ? "From the dye house's challan. Replaces the roll's old lot." : "Leave blank to keep the roll's lot."}
          >
            <TextInput value={dyeLot} maxLength={40} onChange={(e) => setDyeLot(e.target.value)} />
          </Field>
          <Field label="Shade band" hint="Only if graded on arrival.">
            <TextInput value={shade} maxLength={20} onChange={(e) => setShade(e.target.value)} />
          </Field>
        </div>

        {preview && (
          <Alert kind={preview.variationFlag ? 'warning' : 'success'}>
            <strong>
              {preview.lossLabel} {preview.shrinkagePctDisplay}%
            </strong>{' '}
            against a permitted {preview.standardShrinkagePctDisplay}%.
            {preview.variationFlag
              ? ` This goes to ${preview.willStatus.replace(/_/g, ' ').toLowerCase()} and the roll will be held.`
              : ' Within the allowance.'}
            <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
              {preview.formula}
            </div>
          </Alert>
        )}

        {preview?.exceedsIssued && (
          <Alert kind="error">
            That would return more than was ever sent. Fabric shrinks; it does not multiply. Check
            the roll numbers.
          </Alert>
        )}

        <Field label="Remarks">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
