/**
 * GRN detail: the receipt, the rolls it created, the stock movements it wrote,
 * and the chain it sits at the end of.
 *
 * The movements panel is the point. A GRN is only true if the ledger says so,
 * and showing the ledger entries beside the receipt is how a store manager
 * satisfies themselves that the two agree.
 *
 * ---------------------------------------------------------------------------
 *  F-04 - AND THIS IS WHERE A WRONG RECEIPT IS PUT RIGHT
 *
 *  A receipt posts to stock the instant it is saved, so there is no draft to
 *  fix and no cancel to press. The remedy is a REVERSAL: an approved
 *  counter-entry that takes the goods back out and gives the purchase order
 *  its quantity back. This screen is the only place one is ever raised from,
 *  because it is the only place somebody looks when they realise the figure
 *  is wrong.
 *
 *  Three states are drawn, and they are deliberately different things:
 *
 *    reversed          the correction has posted. A red banner, and no
 *                      actions - the receipt is history now.
 *    reversal open     somebody has raised one and it is waiting on a
 *                      signature. Shown to everybody, with approve/reject
 *                      offered only to whoever may actually decide it.
 *    reversible        nothing raised yet. The action is offered only if the
 *                      server says the goods are still there to take back.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { grns as grnApi, grnReversals as revApi } from '../../services/erp.js';
import { Alert, PageHeader, Spinner } from '../../components/ui.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { PartOfDocument } from './DocumentPages.jsx';
import { Detail, DetailGrid, TraceChain } from '../shared/Detail.jsx';
import { fmtDate, fmtEnum, fmtMoney, fmtNum } from '../../utils/format.js';

export default function GrnDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [grn, setGrn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);

  /*
   * F-04 - the reversal panel's own state.
   *
   * `eligibility` is fetched lazily, on the first click, rather than with the
   * receipt: it costs several queries - the rolls, their movements, the
   * balance - and the overwhelming majority of receipts are never reversed.
   * Loading it on every detail view would make every reader pay for the rare
   * case.
   */
  const [reversing, setReversing] = useState(false);
  const [eligibility, setEligibility] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');

  const canPrint = can('GRN.EXPORT');
  const canRaiseReversal = can('GRN_REVERSAL.CREATE');
  const canDecideReversal = can('GRN_REVERSAL.APPROVE');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGrn(await grnApi.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /** Runs an action, then reloads, so the screen never shows a stale state. */
  const act = useCallback(
    async (label, fn) => {
      setBusy(label);
      setBanner(null);
      try {
        const result = await fn();
        await load();
        return result;
      } catch (e) {
        setBanner({ kind: 'error', text: e.message });
        return null;
      } finally {
        setBusy('');
      }
    },
    [load],
  );

  /**
   * Opens the reversal form, and asks the server whether it is even possible.
   *
   * The question is asked BEFORE the form is filled in, so a storeman whose
   * cloth has already gone to the dye house is told that now - naming the
   * roll - rather than after typing out a reason.
   */
  const openReversal = useCallback(async () => {
    setReversing(true);
    setEligibility(null);
    setReason('');
    try {
      setEligibility(await revApi.eligibility(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setReversing(false);
    }
  }, [id]);

  if (loading && !grn) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading receipt..." />
        </div>
      </div>
    );
  }
  if (!grn) return <Alert kind="error">{banner?.text ?? 'GRN not found'}</Alert>;

  const { traceability, assessment, movements, rolls, purchaseOrder } = grn;

  /*
   * `grn.reversed` and not a check on workflowState: a reversed receipt is
   * still POSTED and still COMPLETED, because it WAS posted and the goods DID
   * arrive. Neither column is rewritten by the correction, so reading them
   * here would show a live receipt. See project() in grn.service.js.
   */
  const reversal = grn.reversal ?? null;
  const showReverseAction = grn.posted && !grn.reversed && !grn.reversalOpen && canRaiseReversal;

  return (
    <>
      <PageHeader
        title={`GRN ${grn.grnNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/grns')}>
              Back to list
            </button>
            {canPrint && (
              <button type="button" className="btn" onClick={() => navigate(`/print/grn/${grn.id}`)}>
                Print GRN
              </button>
            )}
            {/*
              A second document from the same receipt: the GRN says what
              arrived, the invoice says what it cost. Same permission - anybody
              who may export a receipt may see what was paid for it.
            */}
            {canPrint && (
              <button
                type="button"
                className="btn"
                onClick={() => navigate(`/print/purchase-invoice/${grn.id}`)}
              >
                Print invoice
              </button>
            )}
            {/*
              F-04. Offered only when the server has said the receipt is
              posted and not already corrected; whether the GOODS are still
              there is a further question, asked by openReversal() before the
              form is shown, because answering it costs several queries.
            */}
            {showReverseAction && (
              <button
                type="button"
                className="btn btn-danger"
                disabled={Boolean(busy)}
                onClick={openReversal}
              >
                Reverse receipt
              </button>
            )}
          </>
        }
      />

      <PartOfDocument header={grn.header} to={`/grns/documents/${grn.header?.id}`} label="receipt" />

      {banner && (
        <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Alert>
      )}

      {/* --- F-04: the correction, in whatever state it has reached ------- */}
      {grn.reversed && (
        <Alert kind="error">
          <strong>This receipt has been reversed.</strong> {reversal?.reversalNo} took{' '}
          {fmtNum(reversal?.reversedQty)} {grn.uom} back out of {grn.location} on{' '}
          {fmtDate(reversal?.reversalDate)}
          {reversal?.approvedByName ? `, approved by ${reversal.approvedByName}` : ''}.
          {reversal?.reason ? ` Reason: ${reversal.reason}` : ''}
          <div className="faint" style={{ marginTop: 6, fontSize: 12 }}>
            The receipt itself is left as it was — it was posted, and the goods did arrive. The
            stock was taken back out by a separate counter-entry, which is why both documents are
            still on the ledger below.
          </div>
        </Alert>
      )}

      {grn.reversalOpen && reversal && (
        <Alert kind="warning">
          <strong>A reversal is open against this receipt.</strong> {reversal.reversalNo} —{' '}
          {reversal.stateLabel?.toLowerCase()}. {reversal.reason}
          {canDecideReversal && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {/*
                Approving POSTS the counter-movements, in the same transaction.
                The button says so, because "approve" alone would understate
                what pressing it does to the ledger.

                Maker-checker is the server's rule, not this screen's: a user
                who raised the reversal is refused by
                approvalEngine.transition() whatever this button offers. The
                refusal comes back as a banner rather than being predicted
                here, because predicting it would be the rule written twice.
              */}
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busy)}
                onClick={() =>
                  act('approve', () => revApi.approve(reversal.id, { remarks: undefined }))
                }
              >
                {busy === 'approve' ? 'Posting…' : 'Approve and post reversal'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={Boolean(busy)}
                onClick={() => {
                  const why = window.prompt('Why is this reversal being refused?');
                  if (why && why.trim().length >= 3) {
                    act('reject', () => revApi.reject(reversal.id, why.trim()));
                  }
                }}
              >
                Reject reversal
              </button>
            </div>
          )}
        </Alert>
      )}

      {/* --- F-04: raising one -------------------------------------------- */}
      {reversing && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Reverse this receipt</div>
          <div className="card-body">
            {!eligibility && <Spinner label="Checking whether the goods are still in store..." />}

            {eligibility && !eligibility.reversible && (
              <Alert kind="error">
                <strong>This receipt can no longer be reversed.</strong>
                <ul style={{ margin: '8px 0 0 18px' }}>
                  {eligibility.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {eligibility?.reversible && (
              <>
                <p className="faint" style={{ marginTop: 0 }}>
                  {eligibility.wouldReverse.reversalNo} will take{' '}
                  <strong>
                    {eligibility.wouldReverse.qty} {eligibility.wouldReverse.uom}
                  </strong>{' '}
                  back out of {eligibility.wouldReverse.location}
                  {eligibility.wouldReverse.rollCount > 0 &&
                    `, writing off ${eligibility.wouldReverse.rollCount} roll(s) (${eligibility.wouldReverse.rollNos.join(', ')})`}
                  {eligibility.wouldReverse.purchaseOrder &&
                    `, and take ${eligibility.wouldReverse.purchaseOrder.poId} from ${eligibility.wouldReverse.purchaseOrder.receivedQty} received to ${eligibility.wouldReverse.purchaseOrder.receivedQtyAfter}`}
                  . Nothing moves until somebody else approves it.
                </p>

                <label className="field" style={{ display: 'block' }}>
                  <span className="label">Why is this receipt wrong?</span>
                  <textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Quantity keyed as 1,000 when the delivery note says 100."
                  />
                  {/*
                    Ten characters, matching the server's validator and the
                    grn_reversals_reason_is_a_sentence CHECK. This is the only
                    account of what went wrong that anybody will have in a
                    year, so the floor is under "x" rather than a hurdle.
                  */}
                  <span className="faint" style={{ fontSize: 12 }}>
                    A sentence, not a keystroke — this is what the approver reads, and what the
                    record will say a year from now.
                  </span>
                </label>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={reason.trim().length < 10 || Boolean(busy)}
                    onClick={async () => {
                      const made = await act('raise', () =>
                        revApi.create({ grnId: grn.id, reason: reason.trim() }),
                      );
                      if (made) {
                        setReversing(false);
                        setBanner({
                          kind: 'success',
                          text: `${made.reversalNo} raised and sent for approval. Nothing has moved yet — the stock comes back out when it is signed.`,
                        });
                      }
                    }}
                  >
                    {busy === 'raise' ? 'Raising…' : 'Raise reversal for approval'}
                  </button>
                  <button type="button" className="btn" onClick={() => setReversing(false)}>
                    Cancel
                  </button>
                </div>
              </>
            )}

            {eligibility && !eligibility.reversible && (
              <button
                type="button"
                className="btn"
                style={{ marginTop: 12 }}
                onClick={() => setReversing(false)}
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {grn.toleranceBreached && (
        <Alert kind="warning">
          <strong>Over tolerance.</strong> {assessment.cumulativeVariationPctDisplay}% received
          against a permitted {assessment.tolerancePct}%. {assessment.toleranceRule}
        </Alert>
      )}

      <TraceChain
        title="Traceability"
        chain={traceability.chain}
        complete={Boolean(traceability.orderNo && traceability.quotationNo && traceability.poId)}
        links={[
          traceability.orderNo && {
            label: 'Buyer Order',
            value: traceability.orderNo,
            sub: `${traceability.buyerName ?? ''} · ${traceability.styleNo ?? ''}`,
          },
          traceability.quotationNo && { label: 'Quotation', value: traceability.quotationNo },
          purchaseOrder && {
            label: 'Purchase Order',
            value: purchaseOrder.poId,
            to: `/purchase-orders/${purchaseOrder.id}`,
          },
          traceability.gatePassNo && {
            label: 'Gate Pass',
            value: traceability.gatePassNo,
            to: grn.gatePass ? `/gate-passes/${grn.gatePass.id}` : undefined,
          },
          { label: 'GRN', value: grn.grnNo, sub: grn.posted ? 'posted' : 'not posted', current: true },
        ].filter(Boolean)}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Receipt</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="GRN No" value={grn.grnNo} mono />
            <Detail label="Date" value={fmtDate(grn.grnDate)} />
            <Detail label="Bill No" value={grn.billNo} />
            <Detail label="Purpose" value={fmtEnum(grn.purpose)} />
            <Detail label="Vendor" value={`${grn.vendor?.vendorName} (${grn.vendor?.vendorCode})`} />
            <Detail label="Item" value={grn.item} />
            {/* Typed on the PO; shown here so the store checks the right button arrived. */}
            <Detail label="Variety" value={purchaseOrder?.accessoryType} />
            <Detail
              label="Stock item"
              value={grn.inventoryItem?.itemCode}
              sub={grn.inventoryItem?.description}
              mono
            />
            <Detail label="HSN Code" value={grn.hsnCode} />
            <Detail label="UOM" value={grn.uom} />
            <Detail label="Location" value={grn.location} />
            <Detail label="Posted by" value={grn.postedByName} />
            <Detail label="Payable" value={fmtMoney(assessment.payableAmount)} sub="payment is made on the quantity actually received" />
            {grn.remarks && <Detail label="Remarks" value={grn.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      {/* --- The rolls this receipt created ------------------------------- */}
      {rolls.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span>Fabric rolls created</span>
            <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
              {rolls.length} roll(s) — created in the same transaction as the receipt
            </span>
          </div>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Roll No</th>
                  <th className="num">Received</th>
                  <th className="num">Balance</th>
                  <th>UOM</th>
                  <th>Colour</th>
                  <th>GSM</th>
                  <th className="num">Width</th>
                  <th>Stage</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {rolls.map((r) => (
                  <tr className="clickable" key={r.id} onClick={() => navigate(`/inventory/rolls/${r.id}`)}>
                    <td className="code">{r.rollNo}</td>
                    <td className="num">{fmtNum(r.receivedQty)}</td>
                    <td className="num">{fmtNum(r.balanceQty)}</td>
                    <td>{r.uom}</td>
                    <td>{r.colorCode ?? '-'}</td>
                    <td>{r.gsm ?? '-'}</td>
                    <td className="num">{r.width ? fmtNum(r.width) : '-'}</td>
                    <td>{fmtEnum(r.stage)}</td>
                    <td>{r.location ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      {/* --- The ledger entries this receipt wrote ------------------------ */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Stock movements</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            written in the same transaction — the receipt is only true if these are
          </span>
        </div>
        {movements.length === 0 ? (
          <div className="card-body muted">
            No stock movements. This receipt never reached the ledger.
          </div>
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th>Roll</th>
                  <th>Location</th>
                  <th className="num">In</th>
                  <th className="num">Out</th>
                  <th className="num">Rate</th>
                  <th className="num">Value</th>
                  <th className="num">Balance after</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{fmtDate(m.entryDate)}</td>
                    <td>
                      {m.item?.itemCode}
                      <div className="faint">{m.item?.description}</div>
                    </td>
                    <td className="code">{m.roll?.rollNo ?? '-'}</td>
                    <td>{m.location}</td>
                    <td className="num">{Number(m.qtyIn) > 0 ? fmtNum(m.qtyIn) : '-'}</td>
                    <td className="num">{Number(m.qtyOut) > 0 ? fmtNum(m.qtyOut) : '-'}</td>
                    <td className="num">{fmtNum(m.rate, { decimals: 4 })}</td>
                    <td className="num">{fmtMoney(m.value)}</td>
                    <td className="num">{fmtNum(m.balanceQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>
    </>
  );
}
