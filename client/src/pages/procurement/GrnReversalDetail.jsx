/**
 * F-04 - GRN reversal detail: the correction raised against a posted receipt,
 * and the decision it is waiting on.
 *
 * ---------------------------------------------------------------------------
 *  WHY THERE IS NO LIST SCREEN BESIDE THIS ONE
 *
 *  A reversal is not a register somebody browses. It is reached from the two
 *  places it is actually relevant: the receipt it corrects, which shows a
 *  banner and links here, and the approval queue, which lists it because
 *  somebody has to sign it. A "Reversals" entry in the navigation would be a
 *  screen nobody opens except to find out that there are none.
 *
 *  That is also why this file exists at all rather than the queue linking
 *  straight back to the GRN: the approver needs to see the REASON and the
 *  figures being taken out, and the receipt's own screen is about what
 *  arrived.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THE APPROVE BUTTON DOES, AND WHY IT SAYS SO
 *
 *  Approving posts. The counter-movements are written in the same transaction
 *  as the approval, so pressing this button is what takes the goods out of
 *  stock - there is no second "post" step, deliberately. The button is
 *  labelled with both halves, because "Approve" alone would understate it.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { grnReversals as revApi } from '../../services/erp.js';
import { Alert, PageHeader, Spinner, StatusBadge } from '../../components/ui.jsx';
import { Detail, DetailGrid } from '../shared/Detail.jsx';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from '../../utils/format.js';

export default function GrnReversalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRow(await revApi.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (label, fn) => {
      setBusy(label);
      setBanner(null);
      try {
        await fn();
        await load();
      } catch (e) {
        setBanner({ kind: 'error', text: e.message });
      } finally {
        setBusy('');
      }
    },
    [load],
  );

  if (loading && !row) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading reversal..." />
        </div>
      </div>
    );
  }
  if (!row) return <Alert kind="error">{banner?.text ?? 'Reversal not found'}</Alert>;

  const grn = row.grn ?? {};
  const waiting = ['SUBMITTED', 'PENDING_APPROVAL', 'RESUBMITTED'].includes(row.workflowState);

  /*
   * Both must hold. The permission says what this ROLE may do; `canApprove`
   * from the server says whether THIS user may decide THIS document - it is
   * false when they raised it themselves. Offering the button anyway would
   * mean a 403 on press, and a screen the user learns to distrust.
   */
  const canDecide = can('GRN_REVERSAL.APPROVE') && row.canApprove !== false && waiting;

  return (
    <>
      <PageHeader
        title={`Reversal ${row.reversalNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate(`/grns/${grn.id}`)}>
              Open the receipt
            </button>
            {row.workflowState === 'DRAFT' && can('GRN_REVERSAL.EDIT') && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busy)}
                onClick={() => act('submit', () => revApi.submit(row.id, {}))}
              >
                {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
              </button>
            )}
            {canDecide && (
              <>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={Boolean(busy)}
                  onClick={() => act('approve', () => revApi.approve(row.id, {}))}
                >
                  {busy === 'approve' ? 'Posting…' : 'Approve and post'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    const why = window.prompt('Why is this reversal being refused?');
                    if (why && why.trim().length >= 3) {
                      act('reject', () => revApi.reject(row.id, why.trim()));
                    }
                  }}
                >
                  Reject
                </button>
              </>
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
        The server's own explanation of why the button is absent. Shown rather
        than silently hiding it, because "there is no Approve button" and "you
        may not approve this one" look identical to the reader otherwise.
      */}
      {waiting && can('GRN_REVERSAL.APPROVE') && row.canApprove === false && (
        <Alert kind="info">{row.approvalBlockedReason}</Alert>
      )}

      {row.workflowState === 'REJECTED' && (
        <Alert kind="error">
          <strong>Refused.</strong> {row.rejectionReason} The receipt stands as it was, and nothing
          moved.
        </Alert>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">GRN Reversal</div>
        <div className="card-body">
          <div className="value" style={{ fontSize: 18 }}>
            <StatusBadge status={row.workflowState} />
          </div>
          <div className="sub">{row.stateLabel}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Why</div>
        <div className="card-body">
          {/*
            First, and on its own. This is what the approver is being asked to
            agree with, and it is the only account of what went wrong that
            anybody will have in a year.
          */}
          <p style={{ margin: 0, fontSize: 15 }}>{row.reason}</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">The receipt being corrected</div>
        <div className="card-body">
          <DetailGrid>
            <Detail
              label="GRN"
              value={grn.grnNo ? <Link to={`/grns/${grn.id}`}>{grn.grnNo}</Link> : '—'}
              mono
            />
            <Detail label="Bill No" value={grn.billNo} />
            <Detail label="Received on" value={fmtDate(grn.grnDate)} />
            <Detail label="Vendor" value={grn.vendor?.vendorName} />
            <Detail label="Purchase order" value={grn.purchaseOrder?.poId} mono />
            <Detail label="Item" value={grn.item} />
            <Detail
              label="Stock item"
              value={row.inventoryItem?.itemCode}
              sub={row.inventoryItem?.description}
              mono
            />
            <Detail label="Receipt quantity" value={`${fmtNum(grn.receivingQty)} ${grn.uom ?? ''}`} />
          </DetailGrid>
        </div>
      </div>

      <div className="card">
        <div className="card-header">The correction</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Reversal No" value={row.reversalNo} mono />
            <Detail label="Date" value={fmtDate(row.reversalDate)} />
            <Detail label="Raised by" value={row.submittedByName} sub={fmtDateTime(row.submittedAt)} />
            <Detail label="Sent to" value={row.submittedTo} />
            <Detail
              label="Approved by"
              value={row.approvedByName}
              sub={row.approvedAt ? fmtDateTime(row.approvedAt) : undefined}
            />
            <Detail label="Approval" value={row.approvalStatus} />
            <Detail
              label="Posted"
              value={row.postedByName}
              sub={row.postedAt ? fmtDateTime(row.postedAt) : 'not yet — nothing has moved'}
            />
            {row.remarks && <Detail label="Remarks" value={row.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>
    </>
  );
}
