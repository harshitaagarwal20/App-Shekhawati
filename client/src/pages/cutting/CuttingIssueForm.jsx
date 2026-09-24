/**
 * Cutting Issue — the last document in the application.
 *
 * ===========================================================================
 *  NINE CHECKS, ALL VISIBLE, ALL THE TIME
 * ===========================================================================
 *
 * Cloth that has been cut cannot be un-cut, and there is no module downstream
 * of this one to correct it with. So the verification is not a gate at the end
 * of the form - it is the form's centrepiece, running against the server as the
 * supervisor fills it in:
 *
 *      1 Order exists              6 Fabric process complete
 *      2 Order is valid            7 Stock and availability
 *      3 Planning exists           8 Within permitted quantity
 *      4 Plan approval exists      9 Excess authorised
 *      5 Approval is approved
 *
 * Every check shows, passed as well as failed - a supervisor waiting on a plan
 * approval needs to see that the other eight are fine, not just that something
 * is wrong. The Post button is disabled until all nine pass, and the server
 * runs the whole set again inside the transaction regardless.
 *
 * A shop-floor screen: big pickers, minimal typing, a confirmation sheet, and
 * an explicit warning that posting cannot be undone.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  FloorFact,
  PickerCard,
  PickerList,
  QtyStepper,
} from '../../components/mobile.jsx';
import { ExcessPanel } from '../../components/workflow.jsx';
import { Field, MasterSelect, PageHeader, TextArea, TextInput } from '../../components/ui.jsx';
import { fmtNum, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';

export default function CuttingIssueForm() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [issues, setIssues] = useState([]);
  /** Cut pieces counted in from the cutting floor and not yet issued. */
  const [cutPieces, setCutPieces] = useState(null);

  const [orderId, setOrderId] = useState('');
  const [approvalId, setApprovalId] = useState('');
  const [planningId, setPlanningId] = useState('');
  const [fabricIssueId, setFabricIssueId] = useState('');
  const [containerNo, setContainerNo] = useState('');
  const [firmName, setFirmName] = useState('');
  const [unitPcs, setUnitPcs] = useState('');
  const [cuttingPcs, setCuttingPcs] = useState('');
  const [cuttingPcsDamaged, setCuttingPcsDamaged] = useState('');
  const [handleIssued, setHandleIssued] = useState('');
  const [remarks, setRemarks] = useState('');

  /**
   * C6 - THE FABRIC EQUATION.
   *
  *     issuedQty = consumedQty + remainderQty + wastageQty + fabricDamageQty
   *
   * All four are required to post, and the tenth check REMAINDER_RECONCILES
   * refuses the posting if they do not balance. WASTAGE IS TYPED, NEVER
   * INFERRED: deriving it as the leftover would make the equation balance by
   * construction and check nothing at all - a mis-count would be absorbed in
   * silence, which is the exact failure the check exists to catch.
   */
  const [fabricIssued, setFabricIssued] = useState('');
  const [consumedQty, setConsumedQty] = useState('');
  const [remainderQty, setRemainderQty] = useState('');
  /** End-bits kept as remnants - booked back as a short roll of their own. */
  const [remnantQty, setRemnantQty] = useState('');
  const [wastageQty, setWastageQty] = useState('');
  /** The order's style panel list, when it has one: handles are then derived. */
  const [perBag, setPerBag] = useState(null);
  const [fabricDamageQty, setFabricDamageQty] = useState('');

  const [preview, setPreview] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    ordersApi.options().then(setOrders).catch(loadFailed(setOrders, 'orders'));
  }, []);

  // Only APPROVED plan approvals: check 5 would fail on anything else, so it is
  // not offered rather than offered-and-refused.
  useEffect(() => {
    if (!orderId) {
      setApprovals([]);
      setIssues([]);
      setCutPieces(null);
      return;
    }
    // Informational only - a user without the receipt register simply sees nothing.
    cprApi.summary({ orderId }).then(setCutPieces).catch(() => setCutPieces(null));
    const styleId = orders.find((o) => o.id === orderId)?.style?.id;
    if (styleId) {
      stylesApi.get(styleId).then((st) => setPerBag(st?.panelsPerBag ?? null)).catch(() => setPerBag(null));
    } else {
      setPerBag(null);
    }
    paApi
      .options({ orderId, approvedOnly: 'true' })
      .then(setApprovals)
      .catch(loadFailed(setApprovals, 'approvals'));
    fiApi
      .list({ orderId, purpose: 'CUTTING', pageSize: 50 })
      .then((r) => setIssues(r.rows ?? []))
      .catch(loadFailed(setIssues, 'issues'));
  }, [orderId, orders]);

  /** The ten checks, run by the server as the form is filled in. */
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
          firmName: firmName || null,
          unitWiseCuttingPcsToBeIssued: unitPcs === '' ? undefined : String(unitPcs),
          cuttingPcsIssued: cuttingPcs === '' ? undefined : String(cuttingPcs),
        }),
      );
      setError('');
    } catch (e) {
      setPreview(null);
      setError(e.message);
    }
  }, [orderId, planningId, approvalId, fabricIssueId, containerNo, firmName, unitPcs, cuttingPcs]);

  useEffect(() => {
    const id = setTimeout(runPreview, 350);
    return () => clearTimeout(id);
  }, [runPreview]);

  /**
   * Drafting then posting, in two calls.
   *
   * A draft is not verified - it is a form somebody is filling in - and posting
   * runs the ten checks again inside the transaction. Doing it in two steps
   * means a challan that fails on the ninth check still exists as a draft to
   * come back to, rather than being lost.
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
        unitWiseCuttingPcsToBeIssued: unitPcs === '' ? undefined : String(unitPcs),
        cuttingPcsIssued: String(cuttingPcs),
        cuttingPcsDamaged: String(cuttingPcsDamaged || 0),
        // Derived on the server from the style's panel list where it has one.
        handleIssued: perBag || handleIssued === '' ? undefined : String(handleIssued),
        // C6 - the four numbers the ledger movements are built from.
        issuedQty: String(fabricIssued),
        consumedQty: String(consumedQty),
        remainderQty: String(remainderQty || 0),
        remnantQty: String(remnantQty || 0),
        wastageQty: String(wastageQty || 0),
        fabricDamageQty: String(fabricDamageQty || 0),
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

  /**
   * C6 - the equation, checked live so the supervisor sees it balance (or not)
   * before pressing anything. The server checks it again on the transaction and
   * a CHECK constraint refuses an unbalanced row underneath that; this is the
   * courtesy, not the control.
   */
  const eq = (() => {
    const issued = Number(fabricIssued || 0);
    const accounted =
      Number(consumedQty || 0) + Number(remainderQty || 0) + Number(remnantQty || 0) +
      Number(wastageQty || 0) + Number(fabricDamageQty || 0);
    const difference = Number((issued - accounted).toFixed(4));
    return {
      issued,
      accounted: Number(accounted.toFixed(4)),
      difference,
      entered: fabricIssued !== '' && consumedQty !== '',
      balances: issued > 0 && difference === 0,
    };
  })();

  const ready =
    preview?.canPost && Number(cuttingPcs) > 0 && firmName && eq.balances;

  return (
    <div className="floor-page">
      <PageHeader
        title="Issue Cutting"
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

      {/* --- 1. The order -------------------------------------------------- */}
      <div className="fieldset-title">1 · Which order</div>
      <PickerList
        items={orders}
        selectedId={orderId}
        onSelect={(id) => {
          setOrderId(id);
          setApprovalId('');
          setPlanningId('');
          setFabricIssueId('');
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
                <div className="faint" style={{ fontSize: 11, fontWeight: 400 }}>
                  pcs
                </div>
              </>
            }
          />
        )}
      />

      {/* --- 2. The approved plan ------------------------------------------ */}
      {orderId && (
        <>
          <div className="fieldset-title">2 · Which approved plan</div>
          {approvals.length === 0 ? (
            <FloorAlert kind="error" title="No approved plan for this order">
              Cutting cannot be issued until a plan approval for this order and container has been
              approved. Check the Plan Approvals screen.
            </FloorAlert>
          ) : (
            <PickerList
              items={approvals}
              selectedId={approvalId}
              onSelect={(id, a) => {
                setApprovalId(id);
                setContainerNo(a.containerNo ?? '');
                if (a.planning?.id) setPlanningId(a.planning.id);
              }}
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
                      <div className="faint" style={{ fontSize: 11, fontWeight: 400 }}>
                        planned
                      </div>
                    </>
                  }
                />
              )}
            />
          )}
        </>
      )}

      {/* --- 3. The fabric issue ------------------------------------------- */}
      {orderId && approvalId && (
        <>
          <div className="fieldset-title">3 · Which fabric</div>
          {issues.length === 0 ? (
            <FloorAlert kind="warning" title="No fabric issued for cutting on this order">
              Check 7 needs a posted fabric issue — cutting has to come from fabric that was drawn
              from the store, or nothing reconciles.
            </FloorAlert>
          ) : (
            <PickerList
              items={issues}
              selectedId={fabricIssueId}
              onSelect={setFabricIssueId}
              searchPlaceholder="Search an issue or roll number..."
              searchKeys={['issueNo']}
              render={(i, { selected, select }) => (
                <PickerCard
                  selected={selected}
                  onSelect={select}
                  title={i.issueNo}
                  subtitle={`roll ${i.roll?.rollNo ?? '—'} · ${i.fabricName ?? ''}`}
                  meta={i.posted ? 'posted to the ledger' : 'NOT POSTED'}
                  right={
                    <>
                      {fmtNum(i.fabricQtyIssued)}
                      <div className="faint" style={{ fontSize: 11, fontWeight: 400 }}>
                        {i.uom}
                      </div>
                    </>
                  }
                />
              )}
            />
          )}
        </>
      )}

      {/* --- 4. The unit and the quantities -------------------------------- */}
      {orderId && approvalId && (
        <>
          <div className="fieldset-title">4 · Which unit, and how many</div>

          {ctx && (
            <div className="floor-facts">
              <FloorFact label="Order" value={ctx.orderNo} sub={ctx.buyerName} />
              <FloorFact label="Style" value={ctx.styleNo} />
              <FloorFact
                label="Plan"
                value={ctx.planNo ?? '—'}
                sub={ctx.plannedCuttingPcs ? `${fmtNum(ctx.plannedCuttingPcs)} pcs planned` : ''}
              />
              <FloorFact
                label="Approval"
                value={ctx.approvalNo ?? '—'}
                sub={ctx.approvalVersion ? `v${ctx.approvalVersion} · ${ctx.approvalStatus?.toLowerCase()}` : ''}
              />
              {cutPieces && (
                <FloorFact
                  label="Cut pieces in hand"
                  value={fmtNum(cutPieces.pcsInHand)}
                  sub={`${fmtNum(cutPieces.pcsReceived)} received from cutting · ${fmtNum(cutPieces.pcsIssuedToStitching)} issued`}
                />
              )}
            </div>
          )}

          <Field label="Firm / unit" required>
            <MasterSelect
              listCode="StitchingUnit"
              value={firmName}
              currentValue={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              placeholder="Choose the receiving unit..."
            />
          </Field>

          {/* Inherited from the plan when left blank. Typed, not chosen -
              see planning.service.js. */}
          <Field label="Container No" hint="Leave blank to take it from the plan.">
            <TextInput
              value={containerNo}
              onChange={(e) => setContainerNo(e.target.value)}
              placeholder="From the plan"
            />
          </Field>

          <Field label="Unit-wise pieces to be issued" hint="From the plan. Leave blank to use the whole plan.">
            <QtyStepper
              value={unitPcs}
              onChange={setUnitPcs}
              uom="Pcs"
              label="Unit-wise pcs"
              max={ctx?.plannedCuttingPcs}
              compact
            />
          </Field>

          <div style={{ marginTop: 12 }}>
            <QtyStepper
              value={cuttingPcs}
              onChange={setCuttingPcs}
              uom="Pcs"
              label="Good cut pieces given to stitching"
              available={preview?.excess?.maxPermittedQty}
              max={unitPcs || ctx?.plannedCuttingPcs}
              compact
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <QtyStepper
              value={cuttingPcsDamaged}
              onChange={setCuttingPcsDamaged}
              uom="Pcs"
              label="Cut pieces damaged / rejected"
              compact
            />
          </div>

          <div style={{ marginTop: 12 }}>
            {perBag ? (
              <p className="hint">
                Handles issued: <strong>{fmtNum(Number(cuttingPcs || 0) * perBag.handlesPerBag)}</strong>{' '}
                ({perBag.handlesPerBag} per bag) and{' '}
                <strong>{fmtNum(Number(cuttingPcs || 0) * perBag.panelsPerBag)}</strong> panels in all,
                worked out from the style&apos;s panel list.
              </p>
            ) : (
              <QtyStepper
                value={handleIssued}
                onChange={setHandleIssued}
                uom="Pcs"
                label="Handles issued"
                compact
              />
            )}
          </div>

          {/* --- C6: the fabric equation ------------------------------------
              Everything that came onto the cutting floor has to be accounted
              for: cut into panels, thrown away, or put back on the rack. */}
          <div className="fieldset-title">5 · Cutting output and fabric accounting</div>
          <div className="form-grid">
            <Field label="Fabric received on the floor" required>
              <TextInput
                type="number"
                step="0.0001"
                min="0"
                value={fabricIssued}
                onChange={(e) => setFabricIssued(e.target.value)}
              />
            </Field>
            <Field label="Consumed (cut into panels)" required>
              <TextInput
                type="number"
                step="0.0001"
                min="0"
                value={consumedQty}
                onChange={(e) => setConsumedQty(e.target.value)}
              />
            </Field>
            <Field label="Remainder returned to store" hint="Goes back on the same roll it came off.">
              <TextInput
                type="number"
                step="0.0001"
                min="0"
                value={remainderQty}
                onChange={(e) => setRemainderQty(e.target.value)}
              />
            </Field>
            <Field
              label="Remnants kept"
              hint="End-bits too short for the roll but good for a pocket or a sample. Booked back as a remnant roll."
            >
              <TextInput
                type="number"
                step="0.0001"
                min="0"
                value={remnantQty}
                onChange={(e) => setRemnantQty(e.target.value)}
              />
            </Field>
            <Field label="Wastage" hint="Offcuts and rejects. Stated, never inferred.">
              <TextInput
                type="number"
                step="0.0001"
                min="0"
                value={wastageQty}
                onChange={(e) => setWastageQty(e.target.value)}
              />
            </Field>
            <Field label="Fabric damaged" hint="Damage recorded separately from normal wastage.">
              <TextInput
                type="number"
                step="0.0001"
                min="0"
                value={fabricDamageQty}
                onChange={(e) => setFabricDamageQty(e.target.value)}
              />
            </Field>
          </div>

          {eq.entered && (
            <FloorAlert kind={eq.balances ? 'success' : 'error'} title={eq.balances ? 'Reconciles' : 'Does not reconcile'}>
              {fmtNum(eq.issued)} received = {fmtNum(consumedQty || 0)} consumed +{' '}
              {fmtNum(remainderQty || 0)} returned + {fmtNum(remnantQty || 0)} remnants +{' '}
              {fmtNum(wastageQty || 0)} wastage
              {' + '}{fmtNum(fabricDamageQty || 0)} damaged
              {eq.balances
                ? '.'
                : ` — ${fmtNum(Math.abs(eq.difference))} ${eq.difference > 0 ? 'unaccounted for' : 'more than was issued'}.`}
            </FloorAlert>
          )}

          <Field label="Remarks">
            <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </>
      )}

      {preview?.excess && !preview.excess.within && (
        <ExcessPanel excess={preview.excess} title="Excess over the approved plan" />
      )}

      {orderId && approvalId && (
        <div className="floor-actions">
          <BigButton kind="ghost" onClick={() => navigate('/cutting-issues')}>
            Cancel
          </BigButton>
          <BigButton onClick={() => setConfirming(true)} disabled={!ready}>
            Post the challan
          </BigButton>
        </div>
      )}

      {/* --- Confirm. Cloth gets cut. -------------------------------------- */}
      <ConfirmSheet
        open={confirming}
        title="Cut and issue this cloth?"
        summary={
          `${fmtNum(cuttingPcs)} pieces to ${firmName}, against ${ctx?.orderNo ?? ''}` +
          `${containerNo ? ` / ${containerNo}` : ''}.`
        }
        lines={[
          { label: 'Order', value: ctx?.orderNo },
          { label: 'Style', value: ctx?.styleNo },
          { label: 'Unit', value: firmName },
          { label: 'Cutting pieces', value: fmtNum(cuttingPcs) },
          {
            label: 'Handles',
            value: perBag
              ? fmtNum(Number(cuttingPcs || 0) * perBag.handlesPerBag)
              : handleIssued === '' ? '—' : fmtNum(handleIssued),
          },
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
