/**
 * Fabric Issue — issued off a rack, on a phone.
 *
 * ===========================================================================
 *  THE SHOP FLOOR'S SCREEN
 * ===========================================================================
 *
 * A storeman standing at a rack, one hand on a roll. Four taps and a number:
 *
 *   1  pick the roll        — scanned, or tapped from a list that already shows
 *                             the fabric, the colour and the balance
 *   2  pick the order       — a short list, not a search
 *   3  pick the purpose     — big buttons, because purpose routes the roll
 *   4  type the quantity    — one numeric field, with a Max button
 *
 * Everything else - the fabric name, the colour, the UOM, the style - is copied
 * from the roll and the order. Nothing is transcribed.
 *
 * ---------------------------------------------------------------------------
 *  REQUESTED QUANTITY ≤ AVAILABLE STOCK, CHECKED BY THE SERVER
 *
 *  The availability panel comes from POST /fabric-issues/preview, which runs
 *  the same `checkAvailability()` the posting transaction runs - at BOTH
 *  levels, the roll's own balance and the ledger's. The button disables when it
 *  says no, and the server refuses again inside the transaction if two people
 *  reach for the same roll at once.
 *
 *  AFTER POSTING, A STOCK LEDGER OUT EXISTS. Always. The issue and the movement
 *  are one transaction, so there is no confirmation screen that lies.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  cuttingChallans as ccApi,
  employees as employeesApi,
  fabricIssues as fiApi,
  orders as ordersApi,
  vendors as vendorsApi,
} from '../../services/erp.js';
import {
  BigButton,
  ConfirmSheet,
  FloorAlert,
  PickerCard,
  PickerList,
  QtyStepper,
} from '../../components/mobile.jsx';
import { Field, PageHeader, TextArea } from '../../components/ui.jsx';
import { fmtEnum, fmtNum, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';

/**
 * The purposes, as big buttons.
 *
 * Purpose is not a footnote here: it decides where the roll goes next and what
 * stage it moves to, so it gets the space that decision deserves.
 */
/*
 * FOUR, NOT SEVEN.
 *
 * Cloth leaves this store to be cut, dyed or printed, and comes back on a
 * return. Stitching, Sampling and Other were offered and never used - not one
 * fabric issue in the register carries any of them - and each one that a
 * screen offers is a location and a stage somebody has to keep correct.
 *
 * The IssuePurpose enum still holds them, deliberately: gate passes share it
 * and DO use STITCHING and OTHER. This list is what the fabric store is
 * offered, not what the enum permits.
 */
const PURPOSES = [
  { value: 'CUTTING', label: 'Cutting', hint: 'to the cutting floor' },
  { value: 'DYEING', label: 'Dyeing', hint: 'out to a dyeing unit' },
  { value: 'PRINTING', label: 'Printing', hint: 'out to a printing unit' },
  { value: 'RETURN', label: 'Return', hint: 'back to the store' },
];

export default function FabricIssueForm() {
  const navigate = useNavigate();

  const [rolls, setRolls] = useState([]);
  const [rollsLoading, setRollsLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [vendors, setVendors] = useState([]);

  const [rollId, setRollId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [qty, setQty] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [issuedByName, setIssuedByName] = useState('');
  const [remarks, setRemarks] = useState('');
  // Only asked for when the roll's shade or dye lot differs from the one the
  // cutting line was started on. See domain/shade.js on the server.
  const [shadeMixReason, setShadeMixReason] = useState('');

  /**
   * C5 - THE CUTTING CHALLAN LINE THIS ISSUE FULFILS.
   *
   * Required for anything going to the cutting floor. NOT required for a job
   * worker (a dyeing issue is authorised by its Job Work order) and not for a
   * return, which fulfils no requirement.
   *
   * The options come from `issuableLines`, which returns only approved challans
   * with something still outstanding - so the picker cannot offer a line the
   * posting would refuse.
   */
  const [challanLines, setChallanLines] = useState([]);
  const [challanLineId, setChallanLineId] = useState('');

  /**
   * C5 - the cutting floor draws against a challan; a job worker does not.
   *
   * STITCHING is not tested for. A stitching unit never receives FABRIC - it
   * receives cut panels, which leave on a Cutting Issue, a different document
   * with its own challan. Fabric goes to cutting, dyeing or printing, and
   * comes back on a return.
   *
   * Declared HERE, beside the state it derives from, rather than further down
   * with the other derived values: the effect that loads the challan lines
   * reads it, and a `const` referenced above its own declaration is a temporal
   * dead zone error that blanks the whole screen at runtime.
   */
  const needsChallanLine = purpose === 'CUTTING';

  /*
   * Which step is open. Derived would be wrong: after choosing a roll the flow
   * should move on by itself, but somebody reopening step 1 to change the roll
   * must stay there rather than be thrown forward again by their own answer.
   */
  const [step, setStep] = useState(1);

  const [preview, setPreview] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fiApi
      .rolls()
      .then(setRolls)
      .catch(loadFailed(setRolls, 'rolls'))
      .finally(() => setRollsLoading(false));
    ordersApi.options().then(setOrders).catch(loadFailed(setOrders, 'orders'));
    employeesApi.options().then(setEmployees).catch(loadFailed(setEmployees, 'employees'));
  }, []);

  // The job worker list narrows to the right kind of vendor for the purpose.
  useEffect(() => {
    if (purpose !== 'DYEING' && purpose !== 'PRINTING') {
      setVendors([]);
      setVendorId('');
      return;
    }
    vendorsApi
      .options({ category: purpose === 'DYEING' ? 'Dyeing' : 'Printing' })
      .then(setVendors)
      .catch(loadFailed(setVendors, 'vendors'));
  }, [purpose]);

  /** "Can I issue this much off this roll?" — answered by the server. */
  const runPreview = useCallback(async () => {
    if (!rollId) {
      setPreview(null);
      return;
    }
    try {
      setPreview(
        await fiApi.preview({
          rollId,
          fabricQtyIssued: qty === '' ? undefined : String(qty),
          purpose: purpose || undefined,
          cuttingChallanLineId: needsChallanLine && challanLineId ? challanLineId : undefined,
        }),
      );
    } catch (e) {
      setPreview(null);
      setError(e.message);
    }
  }, [rollId, qty, purpose, needsChallanLine, challanLineId]);

  useEffect(() => {
    const id = setTimeout(runPreview, 250);
    return () => clearTimeout(id);
  }, [runPreview]);

  /**
   * C5 - the challan lines this issue could fulfil.
   *
   * Reloaded whenever the order changes, and cleared when the purpose stops
   * needing one - otherwise switching from Cutting to Dyeing would leave a
   * stale line id attached to a job-work issue.
   */
  useEffect(() => {
    if (!needsChallanLine || !orderId) {
      setChallanLines([]);
      setChallanLineId('');
      return;
    }
    ccApi
      .issuableLines({ orderId })
      .then((r) => setChallanLines(r?.rows ?? []))
      .catch(loadFailed(setChallanLines, 'challan lines'));
  }, [needsChallanLine, orderId]);

  async function post() {
    setBusy(true);
    setError('');
    try {
      const saved = await fiApi.create({
        issueDate: todayInput(),
        rollId,
        purpose,
        orderId,
        // C5 - sent only where a challan actually governs the issue.
        cuttingChallanLineId: needsChallanLine ? challanLineId : undefined,
        vendorId: vendorId || null,
        issuedByEmployeeId: employeeId || null,
        issuedByName: issuedByName || null,
        fabricQtyIssued: String(qty),
        shadeMixReason: shadeMix ? shadeMixReason.trim() : undefined,
        remarks: remarks || null,
      });
      setConfirming(false);
      navigate(`/fabric-issues/${saved.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
      setConfirming(false);
    }
  }

  const roll = preview?.roll;
  const order = orders.find((o) => o.id === orderId);
  const availability = preview?.availability;
  const needsVendor = preview?.needsJobWorker;

  /*
   * Step 3 is done when the purpose AND anything the purpose drags in with it
   * are answered - a cutting issue needs its challan line, a job work issue
   * needs the unit it is going to. Without this the Continue button would let
   * somebody past a half-answered step and fail at the very end instead.
   */
  // The shade verdict for this roll against the chosen cutting line.
  const shadeMix = needsChallanLine && preview?.shade && !preview.shade.ok;
  const shadeReasonOk = !shadeMix || shadeMixReason.trim().length >= 10;

  const stepThreeDone =
    shadeReasonOk &&
    Boolean(purpose) &&
    (!needsChallanLine || Boolean(challanLineId)) &&
    (!needsVendor || Boolean(vendorId));

  const ready =
    Boolean(rollId && orderId && purpose) &&
    Number(qty) > 0 &&
    availability?.permitted &&
    (!needsVendor || vendorId) &&
    (!needsChallanLine || challanLineId) &&
    shadeReasonOk &&
    (employeeId || issuedByName.trim());

  return (
    <div className="floor-page">
      <PageHeader
        title="Issue Fabric"
        actions={
          <button type="button" className="btn" onClick={() => navigate('/fabric-issues')}>
            All issues
          </button>
        }
      />

      {error && (
        <FloorAlert kind="error" title="Could not issue the fabric" onDismiss={() => setError('')}>
          {error}
        </FloorAlert>
      )}

      {/* --- 1. The roll --------------------------------------------------- */}
      <Step
        index={1}
        title="Which roll"
        open={step === 1}
        done={Boolean(rollId)}
        onReopen={() => setStep(1)}
        summary={
          roll
            ? `${roll.rollNo} · ${[roll.fabricName, roll.colorCode].filter(Boolean).join(' · ')} · ${fmtNum(roll.balanceQty)} ${roll.uom} left`
            : ''
        }
      >
      <PickerList
        items={rolls}
        loading={rollsLoading}
        selectedId={rollId}
        onSelect={(id) => {
          setRollId(id);
          setQty('');
          setStep(2);
        }}
        searchPlaceholder="Scan or search a roll number, colour or fabric..."
        searchKeys={['rollNo', 'fabricName', 'colorCode', 'gsm', 'orderNo', 'poId']}
        emptyMessage="No rolls with any balance left."
        render={(r, { selected, select }) => (
          <PickerCard
            selected={selected}
            onSelect={select}
            title={r.rollNo}
            badge={r.forThisOrder === false && orderId ? 'other order' : undefined}
            subtitle={[r.fabricName, r.colorCode, r.gsm].filter(Boolean).join(' · ')}
            meta={[
              fmtEnum(r.stage),
              r.location,
              r.orderNo ? `for ${r.orderNo}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            right={
              <>
                {fmtNum(r.balanceQty)}
                <div className="faint" style={{ fontSize: 11, fontWeight: 400 }}>
                  {r.uom}
                </div>
              </>
            }
          />
        )}
      />
      </Step>

      {/* --- 2. The order -------------------------------------------------- */}
      <Step
        index={2}
        title="Which order"
        open={step === 2}
        done={Boolean(orderId)}
        onReopen={() => setStep(2)}
        summary={order ? `${order.orderNo} · ${order.buyer?.buyerName ?? ''}` : ''}
      >
          <PickerList
            items={orders}
            selectedId={orderId}
            onSelect={(id) => {
              setOrderId(id);
              setStep(3);
            }}
            searchPlaceholder="Search an order number or style..."
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
      </Step>

      {/* --- 3. The purpose ------------------------------------------------ */}
      <Step
        index={3}
        title="What for"
        open={step === 3}
        done={Boolean(purpose)}
        onReopen={() => setStep(3)}
        summary={PURPOSES.find((p) => p.value === purpose)?.label ?? ''}
      >
          <div className="picker-scroll" style={{ maxHeight: 'none' }}>
            {PURPOSES.map((p) => (
              <PickerCard
                key={p.value}
                selected={purpose === p.value}
                onSelect={() => setPurpose(p.value)}
                title={p.label}
                subtitle={p.hint}
              />
            ))}
          </div>

          {preview?.willMoveTo && purpose && (
            <FloorAlert kind="info">
              After this issue the roll will be at <strong>{preview.willMoveTo}</strong>, at stage{' '}
              <strong>{fmtEnum(preview.willBecomeStage)}</strong>.
            </FloorAlert>
          )}

          {needsChallanLine && (
            <Field
              label="Cutting challan line"
              required
              hint={
                challanLines.length
                  ? 'The approved requirement this issue fulfils.'
                  : 'No approved challan has anything outstanding for this order. Raise one first.'
              }
            >
              <select value={challanLineId} onChange={(e) => setChallanLineId(e.target.value)}>
                <option value="">Choose the requirement...</option>
                {challanLines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {shadeMix && (
            <FloorAlert kind="error" title="Different shade or dye lot">
              {preview.shade.message}
              <Field label="Reason for mixing" required hint="At least 10 characters. Stored on the issue.">
                <TextArea
                  rows={2}
                  value={shadeMixReason}
                  onChange={(e) => setShadeMixReason(e.target.value)}
                />
              </Field>
            </FloorAlert>
          )}

          {needsVendor && (
            <Field label="Job worker" required hint="The fabric is leaving the factory.">
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">Choose the {purpose.toLowerCase()} unit...</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.vendorName}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* Step 3 can need a challan line or a job worker, so it is left to
              the user to move on rather than advancing on the purpose alone. */}
          {purpose && (
            <div className="floor-actions">
              <BigButton onClick={() => setStep(4)} disabled={!stepThreeDone}>
                Continue
              </BigButton>
            </div>
          )}
      </Step>

      {/* --- 4. The quantity ----------------------------------------------- */}
      <Step
        index={4}
        title="How much"
        open={step === 4}
        done={Boolean(qty) && Number(qty) > 0}
        onReopen={() => setStep(4)}
        summary={qty ? `${fmtNum(qty)} ${roll?.uom ?? ''}` : ''}
      >
          <QtyStepper
            value={qty}
            onChange={setQty}
            uom={roll?.uom}
            label="Fabric Qty Issued"
            available={availability?.maxIssuable}
            max={availability?.maxIssuable}
            error={
              availability && !availability.permitted
                ? !availability.withinRoll
                  ? `Roll ${availability.rollNo} only has ${availability.rollBalance} ${availability.uom} left.`
                  : `Only ${availability.ledgerAvailable} ${availability.uom} of this fabric is in stock at ${availability.location}.`
                : undefined
            }
          />

          {availability && !availability.permitted && (
            <FloorAlert kind="error" title="Not enough stock">
              Short by{' '}
              {!availability.withinRoll ? availability.rollShort : availability.ledgerShort}{' '}
              {availability.uom}. The server checks the roll's own balance and the stock ledger, and
              this fails on{' '}
              {!availability.withinRoll ? 'the roll' : 'the ledger'}.
            </FloorAlert>
          )}

          <Field label="Issued by" required>
            <select
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                setIssuedByName('');
              }}
            >
              <option value="">Choose the person issuing...</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.empName} ({e.empId})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Remarks">
            <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>

          <div className="floor-actions">
            <BigButton kind="ghost" onClick={() => navigate('/fabric-issues')}>
              Cancel
            </BigButton>
            <BigButton onClick={() => setConfirming(true)} disabled={!ready}>
              Issue fabric
            </BigButton>
          </div>
      </Step>

      {/* --- 5. Confirm. The fabric leaves the rack. ----------------------- */}
      <ConfirmSheet
        open={confirming}
        title="Issue this fabric?"
        summary={
          `${fmtNum(qty)} ${roll?.uom ?? ''} off roll ${roll?.rollNo ?? ''} for ` +
          `${purpose.toLowerCase()}, against ${orders.find((o) => o.id === orderId)?.orderNo ?? ''}.`
        }
        lines={[
          { label: 'Roll', value: roll?.rollNo },
          { label: 'Fabric', value: [roll?.fabricName, roll?.colorCode].filter(Boolean).join(' · ') },
          { label: 'Quantity', value: `${fmtNum(qty)} ${roll?.uom ?? ''}` },
          {
            label: 'Left on the roll',
            value: `${fmtNum(Number(roll?.balanceQty ?? 0) - Number(qty || 0))} ${roll?.uom ?? ''}`,
          },
          { label: 'Purpose', value: PURPOSES.find((p) => p.value === purpose)?.label },
          ...(vendorId
            ? [{ label: 'Going to', value: vendors.find((v) => v.id === vendorId)?.vendorName }]
            : []),
        ]}
        warning="This writes a stock ledger OUT in the same transaction. The fabric leaves the store."
        confirmLabel="Issue"
        onConfirm={post}
        onCancel={() => setConfirming(false)}
        busy={busy}
      />
    </div>
  );
}

/**
 * One step of the issue, either open or folded away.
 *
 * ===========================================================================
 *  WHY THE STEPS COLLAPSE
 * ===========================================================================
 *
 *  Every step used to stay expanded once it was done, so the page only ever
 *  grew: by the time somebody reached "how much" they were scrolling past a
 *  full roll list and a full order list to get to a number box, on a screen
 *  that is used standing at a rack. Nothing said which step you were on, and
 *  changing the roll meant scrolling back up through both lists to find it.
 *
 *  A finished step now folds to a single line carrying its answer, and the one
 *  being worked on is the only thing open. The line stays clickable, because
 *  the commonest correction on this screen is "wrong roll" and it should cost
 *  one tap rather than a scroll.
 */
function Step({ index, title, summary, open, done, onReopen, children }) {
  if (!open && done) {
    return (
      <button type="button" className="floor-step is-done" onClick={onReopen}>
        <span className="floor-step-no">{index}</span>
        <span className="floor-step-body">
          <span className="floor-step-title">{title}</span>
          <span className="floor-step-summary">{summary}</span>
        </span>
        <span className="floor-step-change">Change</span>
      </button>
    );
  }

  if (!open) {
    return (
      <div className="floor-step is-waiting" aria-disabled="true">
        <span className="floor-step-no">{index}</span>
        <span className="floor-step-body">
          <span className="floor-step-title">{title}</span>
        </span>
      </div>
    );
  }

  return (
    <section className="floor-step-open">
      <div className="fieldset-title">
        {index} &middot; {title}
      </div>
      {children}
    </section>
  );
}

