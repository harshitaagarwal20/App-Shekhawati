/**
 * Cutting Issue — the last document in the application.
 *
 * ===========================================================================
 *  ELEVEN CHECKS, ALL VISIBLE, ALL THE TIME
 * ===========================================================================
 *
 * Cloth that has been cut cannot be un-cut, and there is no module downstream
 * of this one to correct it with. So the verification is not a gate at the end
 * of the form - it is the form's centrepiece, running against the server as the
 * supervisor fills it in, in a panel that stays in view beside the steps:
 *
 *      1 Order exists              7 Stock and availability
 *      2 Order is valid            8 Within permitted quantity
 *      3 Planning exists           9 Excess authorised
 *      4 Plan approval exists     10 Remainder reconciles
 *      5 Approval is approved     11 Cut pieces checked
 *      6 Fabric process complete
 *
 * Every check shows, passed as well as failed - a supervisor waiting on a plan
 * approval needs to see that the other ten are fine, not just that something
 * is wrong. The Post button is disabled until all of them pass, and the server
 * runs the whole set again inside the transaction regardless.
 *
 * ===========================================================================
 *  FOUR STEPS, EACH FOLDING AWAY WHEN IT IS ANSWERED
 * ===========================================================================
 *
 *  Order -> plan approval -> fabric issue -> pieces. A finished step folds to
 *  one line carrying its answer (tap it to change), so the page does not grow
 *  into three long lists above the one number that matters.
 *
 *  Where there is only one possible answer - one approved plan for the order,
 *  one cutting issue of fabric - it is picked and the step moves on by itself.
 *  The container comes from the plan approval; it is typed only when the
 *  approval carries none.
 *
 *  The pieces stepper is measured against the checked pieces ready for
 *  stitching (Cut Pieces Receipt), which is the quantity check 11 holds it to,
 *  and its Max fills that in.
 *
 * A shop-floor screen: big pickers, minimal typing, a confirmation sheet, and
 * an explicit warning that posting cannot be undone.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  cutPiecesReceipts as cprApi,
  cuttingIssues as ciApi,
  fabricIssues as fiApi,
  orders as ordersApi,
  planApprovals as paApi,
  styles as stylesApi,
} from '../../services/erp.js';
import {
  BigButton,
  CheckList,
  ConfirmSheet,
  FloorAlert,
  FloorStep,
  PickerCard,
  PickerList,
  QtyStepper,
} from '../../components/mobile.jsx';
import { ExcessPanel } from '../../components/workflow.jsx';
import { CollapsibleField, Field, MasterSelect, PageHeader, TextArea, TextInput } from '../../components/ui.jsx';
import { fmtNum, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';

export default function CuttingIssueForm() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [approvals, setApprovals] = useState(null);
  const [issues, setIssues] = useState(null);
  /** Checked cut pieces for the order - what check 11 lets go to stitching. */
  const [pieces, setPieces] = useState(null);

  const [orderId, setOrderId] = useState('');
  const [approvalId, setApprovalId] = useState('');
  const [planningId, setPlanningId] = useState('');
  const [fabricIssueId, setFabricIssueId] = useState('');
  const [containerNo, setContainerNo] = useState('');
  const [cuttingPcs, setCuttingPcs] = useState('');
  const [cuttingPcsDamaged, setCuttingPcsDamaged] = useState('');
  const [handleIssued, setHandleIssued] = useState('');
  const [remarks, setRemarks] = useState('');
  /*
   * The stitching unit the pieces go to. Required: Stitching, Hourly
   * Monitoring and Inline QC each list only the orders cut FOR their unit
   * (CuttingIssue.firmName), so a challan posted with no unit sent its pieces
   * nowhere any later screen could find them.
   */
  const [firmName, setFirmName] = useState('');

  // No fabric quantities here: the cloth the pieces were cut from is accounted
  // for on the Cut Pieces Receipt, where they were counted in. This challan
  // sends checked pieces to stitching and moves no fabric.

  /** The order's style panel list, when it has one: handles are then derived. */
  const [perBag, setPerBag] = useState(null);

  /*
   * Which step is open. Not derived: after an answer the flow moves on by
   * itself, but somebody reopening a step to change it must stay there.
   */
  const [step, setStep] = useState(1);

  const [preview, setPreview] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    ordersApi.options().then(setOrders).catch(loadFailed(setOrders, 'orders'));
  }, []);

  const order = orders.find((o) => o.id === orderId);
  const approval = (approvals ?? []).find((a) => a.id === approvalId);
  const issue = (issues ?? []).find((i) => i.id === fabricIssueId);

  function chooseApproval(a) {
    setApprovalId(a.id);
    setContainerNo(a.containerNo ?? '');
    setPlanningId(a.planning?.id ?? '');
    setStep(3);
  }

  // Everything that hangs off the order. Only APPROVED plan approvals: check 5
  // would fail on anything else, so it is not offered rather than offered-and-
  // refused.
  useEffect(() => {
    setApprovals(null);
    setIssues(null);
    setPieces(null);
    if (!orderId) return undefined;
    let live = true;

    const styleId = orders.find((o) => o.id === orderId)?.style?.id;
    if (styleId) {
      stylesApi.get(styleId).then((st) => live && setPerBag(st?.panelsPerBag ?? null)).catch(() => setPerBag(null));
    } else {
      setPerBag(null);
    }
    paApi
      .options({ orderId, approvedOnly: 'true' })
      .then((rows) => {
        if (!live) return;
        setApprovals(rows);
        // One approved plan is the usual case - take it and move on.
        if (rows.length === 1) chooseApproval(rows[0]);
      })
      .catch(loadFailed(setApprovals, 'approvals'));
    fiApi
      .list({ orderId, purpose: 'CUTTING', pageSize: 50 })
      .then((r) => {
        if (!live) return;
        const rows = r.rows ?? [];
        setIssues(rows);
        const posted = rows.filter((i) => i.posted);
        if (posted.length === 1) setFabricIssueId(posted[0].id);
      })
      .catch(loadFailed(setIssues, 'issues'));
    // Informational: a role without the receipt register simply gets no figure.
    cprApi.summary({ orderId }).then((s) => live && setPieces(s)).catch(() => setPieces(null));
    return () => {
      live = false;
    };
    // `orders` is only read for the style id; re-running on it would reset the
    // answers whenever the order list reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // The fabric step answers itself when the approval step did and there was
  // only one issue to choose - move straight on to the pieces.
  useEffect(() => {
    if (step === 3 && approvalId && fabricIssueId && issues?.filter((i) => i.posted).length === 1) setStep(4);
  }, [step, approvalId, fabricIssueId, issues]);

  /** The eleven checks, run by the server as the form is filled in. */
  const runPreview = useCallback(async () => {
    if (!orderId) {
      setPreview(null);
      return;
    }
    try {
      setPreview(
        await ciApi.preview({
          orderId,
          planningId: planningId || null,
          planApprovalId: approvalId || null,
          fabricIssueId: fabricIssueId || null,
          containerNo: containerNo || null,
          cuttingPcsIssued: cuttingPcs === '' ? undefined : String(cuttingPcs),
        }),
      );
      setError('');
    } catch (e) {
      setPreview(null);
      setError(e.message);
    }
  }, [orderId, planningId, approvalId, fabricIssueId, containerNo, cuttingPcs]);

  useEffect(() => {
    const id = setTimeout(runPreview, 350);
    return () => clearTimeout(id);
  }, [runPreview]);

  /**
   * Drafting then posting, in two calls.
   *
   * A draft is not verified - it is a form somebody is filling in - and posting
   * runs the checks again inside the transaction. Doing it in two steps means a
   * challan that fails on the last check still exists as a draft to come back
   * to, rather than being lost.
   */
  async function post() {
    setBusy(true);
    setError('');
    try {
      const draft = await ciApi.create({
        issueDate: todayInput(),
        orderId,
        planningId: planningId || null,
        planApprovalId: approvalId || null,
        fabricIssueId: fabricIssueId || null,
        containerNo: containerNo || null,
        firmName,
        plannedCutting: preview?.context.plannedCuttingPcs ?? undefined,
        cuttingPcsIssued: String(cuttingPcs),
        cuttingPcsDamaged: String(cuttingPcsDamaged || 0),
        // Derived on the server from the style's panel list where it has one.
        handleIssued: perBag || handleIssued === '' ? undefined : String(handleIssued),
        remarks: remarks || null,
      });

      const posted = await ciApi.post(draft.id, { remarks: remarks || undefined });
      setConfirming(false);
      navigate(`/cutting-issues/${posted.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
      setConfirming(false);
    }
  }

  const ctx = preview?.context;
  const ready = preview?.canPost && Number(cuttingPcs) > 0 && Boolean(firmName);
  const readyPcs = pieces ? Math.max(0, Number(pieces.pcsReadyToIssue ?? 0)) : null;
  const handles = perBag
    ? fmtNum(Number(cuttingPcs || 0) * perBag.handlesPerBag)
    : handleIssued === '' ? '—' : fmtNum(handleIssued);

  /** Why Post is still disabled, in one line under the button. */
  const blocker = !orderId
    ? 'Choose the order.'
    : !approvalId
      ? 'Choose the approved plan.'
      : !(Number(cuttingPcs) > 0)
        ? 'Enter the pieces going to stitching.'
        : !firmName
          ? 'Choose the stitching unit the pieces go to.'
          : preview && !preview.canPost
          ? `${preview.failures.length} check${preview.failures.length === 1 ? '' : 's'} not passed - see above.`
          : null;

  return (
    <div className="floor-page ci-page">
      <PageHeader
        title="Issue cutting to stitching"
        actions={
          <button type="button" className="btn" onClick={() => navigate('/cutting-issues')}>
            All challans
          </button>
        }
      />

      {error && (
        <FloorAlert kind="error" title="Could not issue cutting" onDismiss={() => setError('')}>
          {error}
        </FloorAlert>
      )}

      <div className="ci-layout">
        <div className="ci-steps">
          {/* --- 1. The order ------------------------------------------------ */}
          <FloorStep
            index={1}
            title="Which order"
            open={step === 1}
            done={Boolean(orderId)}
            onReopen={() => setStep(1)}
            summary={order ? `${order.orderNo} · ${order.buyer?.buyerName ?? ''} · ${order.style?.styleNo ?? ''}` : ''}
          >
            <PickerList
              items={orders}
              selectedId={orderId}
              onSelect={(id) => {
                setOrderId(id);
                setApprovalId('');
                setPlanningId('');
                setFabricIssueId('');
                setContainerNo('');
                setCuttingPcs('');
                setStep(2);
              }}
              searchPlaceholder="Search or scan an order number..."
              searchKeys={['orderNo']}
              emptyMessage="No open orders."
              render={(o, { selected, select }) => (
                <PickerCard
                  selected={selected}
                  onSelect={select}
                  title={o.orderNo}
                  subtitle={`${o.buyer?.buyerName ?? ''} · ${o.style?.styleNo ?? ''}`}
                  meta={o.style?.styleDescription}
                  right={
                    <>
                      {fmtNum(o.orderQty)}
                      <div className="faint" style={{ fontSize: 11, fontWeight: 400 }}>pcs</div>
                    </>
                  }
                />
              )}
            />
          </FloorStep>

          {/* --- 2. The approved plan ---------------------------------------- */}
          <FloorStep
            index={2}
            title="Which approved plan"
            open={step === 2 && Boolean(orderId)}
            done={Boolean(approvalId)}
            onReopen={() => setStep(2)}
            summary={
              approval
                ? `${approval.approvalNo} v${approval.version}` +
                  `${approval.containerNo ? ` · container ${approval.containerNo}` : ''}` +
                  `${approval.plannedCuttingPcs ? ` · ${fmtNum(approval.plannedCuttingPcs)} pcs planned` : ''}`
                : ''
            }
          >
            {approvals === null ? (
              <p className="hint">Looking for approved plans…</p>
            ) : approvals.length === 0 ? (
              <FloorAlert kind="error" title="No approved plan for this order">
                Cutting cannot be issued until a plan approval for this order has been approved. See{' '}
                <Link to="/plan-approvals">Plan Approval</Link>.
              </FloorAlert>
            ) : (
              <PickerList
                items={approvals}
                selectedId={approvalId}
                onSelect={(id, a) => chooseApproval(a)}
                searchPlaceholder="Search an approval number..."
                searchKeys={['approvalNo', 'containerNo']}
                render={(a, { selected, select }) => (
                  <PickerCard
                    selected={selected}
                    onSelect={select}
                    title={a.approvalNo}
                    badge={`v${a.version}`}
                    subtitle={a.containerNo ? `container ${a.containerNo}` : 'no container'}
                    meta={a.planning ? `plan ${a.planning.planNo}` : 'no plan linked'}
                    right={
                      <>
                        {a.plannedCuttingPcs ? fmtNum(a.plannedCuttingPcs) : '—'}
                        <div className="faint" style={{ fontSize: 11, fontWeight: 400 }}>planned</div>
                      </>
                    }
                  />
                )}
              />
            )}
          </FloorStep>

          {/* --- 3. The fabric issue ----------------------------------------- */}
          <FloorStep
            index={3}
            title="Which fabric it was cut from"
            open={step === 3 && Boolean(approvalId)}
            done={Boolean(approvalId && fabricIssueId)}
            onReopen={() => setStep(3)}
            summary={
              issue
                ? `${issue.issueNo} · roll ${issue.roll?.rollNo ?? '—'} · ${fmtNum(issue.fabricQtyIssued)} ${issue.uom}`
                : ''
            }
          >
            {issues === null ? (
              <p className="hint">Looking for fabric issued to cutting…</p>
            ) : issues.length === 0 ? (
              <FloorAlert kind="warning" title="No fabric issued for cutting on this order">
                Cutting has to come from fabric drawn from the store against a cutting challan. Issue it
                from the order&apos;s <Link to="/cutting-challans">cutting challan</Link> first.
              </FloorAlert>
            ) : (
              <>
                <PickerList
                  items={issues}
                  selectedId={fabricIssueId}
                  onSelect={(id) => {
                    setFabricIssueId(id);
                    setStep(4);
                  }}
                  searchPlaceholder="Search an issue or roll number..."
                  searchKeys={['issueNo']}
                  render={(i, { selected, select }) => (
                    <PickerCard
                      selected={selected}
                      onSelect={select}
                      disabled={!i.posted}
                      title={i.issueNo}
                      subtitle={`roll ${i.roll?.rollNo ?? '—'} · ${i.fabricName ?? ''}`}
                      meta={i.posted ? 'posted to the ledger' : 'not posted - cannot be cut from yet'}
                      right={
                        <>
                          {fmtNum(i.fabricQtyIssued)}
                          <div className="faint" style={{ fontSize: 11, fontWeight: 400 }}>{i.uom}</div>
                        </>
                      }
                    />
                  )}
                />
              </>
            )}
          </FloorStep>

          {/* --- 4. The pieces ----------------------------------------------- */}
          <FloorStep
            index={4}
            title="How many pieces"
            open={step === 4 && Boolean(approvalId)}
            done={Number(cuttingPcs) > 0}
            onReopen={() => setStep(4)}
            summary={`${fmtNum(cuttingPcs)} pcs to ${firmName || 'stitching'}`}
          >
            {/* Typed only when the approval does not carry one. Otherwise it is
                the approval's and is shown, not edited. */}
            {approval && !approval.containerNo && (
              <Field label="Container No" hint="The plan approval carries none - type it if the lot has one.">
                <TextInput value={containerNo} onChange={(e) => setContainerNo(e.target.value)} />
              </Field>
            )}

            <Field label="Stitching unit" required hint="The unit these pieces go to. Its Stitching screen lists only what was cut for it.">
              <MasterSelect
                listCode="StitchingUnit"
                value={firmName}
                currentValue={firmName}
                onChange={(e) => setFirmName(e.target.value)}
                placeholder="Choose the receiving unit..."
              />
            </Field>

            <QtyStepper
              id="ci-pcs"
              value={cuttingPcs}
              onChange={setCuttingPcs}
              uom="Pcs"
              label="Good pieces going to stitching"
              available={readyPcs}
              max={readyPcs ?? ctx?.plannedCuttingPcs}
              hint={
                readyPcs === null
                  ? 'Only pieces checked on a Cut Pieces Receipt can be issued.'
                  : undefined
              }
            />
            {readyPcs === 0 && (
              <FloorAlert kind="warning" title="No checked pieces ready">
                Count the cut pieces in and record their check on a{' '}
                <Link to="/cut-pieces-receipts">Cut Pieces Receipt</Link> first.
              </FloorAlert>
            )}

            <div className="ci-two">
              <QtyStepper
                id="ci-damaged"
                value={cuttingPcsDamaged}
                onChange={setCuttingPcsDamaged}
                uom="Pcs"
                label="Damaged / rejected"
                compact
              />
              {perBag ? (
                <div className="ci-derived">
                  <div className="qty-label">Handles</div>
                  <div className="ci-derived-value">{handles}</div>
                  <div className="hint">
                    {perBag.handlesPerBag} per bag, from the style&apos;s panel list ·{' '}
                    {fmtNum(Number(cuttingPcs || 0) * perBag.panelsPerBag)} panels in all
                  </div>
                </div>
              ) : (
                <QtyStepper
                  id="ci-handles"
                  value={handleIssued}
                  onChange={setHandleIssued}
                  uom="Pcs"
                  label="Handles issued"
                  compact
                />
              )}
            </div>

            <CollapsibleField>
              <Field label="Remarks">
                <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
            </CollapsibleField>
          </FloorStep>
        </div>

        {/* --- The checks and the decision, kept in view -------------------- */}
        <aside className="ci-side">
          {!orderId ? (
            <div className="ci-side-empty">
              Pick an order and the eleven checks run here as you fill the form in. Post stays off
              until every one of them passes.
            </div>
          ) : (
            <>
              {preview ? (
                <CheckList checks={preview.verification} title="Checks" />
              ) : (
                <p className="hint">Running the checks…</p>
              )}

              {preview?.excess && !preview.excess.within && (
                <ExcessPanel excess={preview.excess} title="Excess over the approved plan" />
              )}

              {ctx && (
                <dl className="ci-summary">
                  <dt>Order</dt><dd>{ctx.orderNo}</dd>
                  <dt>Style</dt><dd>{ctx.styleNo}</dd>
                  <dt>Plan</dt>
                  <dd>
                    {ctx.planNo ?? '—'}
                    {ctx.plannedCuttingPcs ? ` · ${fmtNum(ctx.plannedCuttingPcs)} pcs` : ''}
                  </dd>
                  <dt>Container</dt><dd>{containerNo || ctx.containerNo || '—'}</dd>
                  <dt>Fabric</dt><dd>{ctx.fabricIssueNo ?? '—'}{ctx.rollNo ? ` · roll ${ctx.rollNo}` : ''}</dd>
                  <dt>To stitching</dt><dd><strong>{cuttingPcs ? `${fmtNum(cuttingPcs)} pcs` : '—'}</strong></dd>
                </dl>
              )}
            </>
          )}

          <div className="ci-post">
            <BigButton onClick={() => setConfirming(true)} disabled={!ready}>
              Post the challan
            </BigButton>
            {blocker && <div className="hint ci-blocker">{blocker}</div>}
          </div>
        </aside>
      </div>

      {/* --- Confirm. Cloth gets cut. ---------------------------------------- */}
      <ConfirmSheet
        open={confirming}
        title="Issue these pieces to stitching?"
        summary={
          `${fmtNum(cuttingPcs)} pieces to stitching, against ${ctx?.orderNo ?? ''}` +
          `${containerNo ? ` / ${containerNo}` : ''}.`
        }
        lines={[
          { label: 'Order', value: ctx?.orderNo },
          { label: 'Style', value: ctx?.styleNo },
          { label: 'Stitching unit', value: firmName },
          { label: 'Pieces', value: fmtNum(cuttingPcs) },
          { label: 'Damaged', value: cuttingPcsDamaged ? fmtNum(cuttingPcsDamaged) : '0' },
          { label: 'Handles', value: handles },
          { label: 'Plan approval', value: `${ctx?.approvalNo} (v${ctx?.approvalVersion})` },
          { label: 'Fabric issue', value: ctx?.fabricIssueNo ?? '—' },
        ]}
        warning={
          'This is the last document in the pipeline. Once posted it is permanent — there is nothing ' +
          'downstream of it that could correct it, and cloth that has been cut cannot be un-cut.'
        }
        confirmLabel="Post the challan"
        onConfirm={post}
        onCancel={() => setConfirming(false)}
        busy={busy}
      />
    </div>
  );
}
