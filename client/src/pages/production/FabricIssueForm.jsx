/**
 * Fabric Issue — issued off a rack, on a phone.
 *
 * ===========================================================================
 *  THE SHOP FLOOR'S SCREEN
 * ===========================================================================
 *
 * A storeman standing at a rack, one hand on a roll. Four taps and a number:
 *
 *   1  pick the roll(s)     — scanned, or tapped from a list that already shows
 *                             the fabric, the colour and the balance. Tap more
 *                             than one to issue several rolls at once.
 *   2  pick the order       — a short list, not a search
 *   3  pick the purpose     — big buttons, because purpose routes the roll
 *   4  type the quantity    — one numeric field per roll, with a Max button
 *
 * Everything else - the fabric name, the colour, the UOM, the style - is copied
 * from the roll and the order. Nothing is transcribed.
 *
 * ---------------------------------------------------------------------------
 *  SEVERAL ROLLS AT ONCE
 *
 *  The store sends three or four rolls to the cutting floor at a time. Picked
 *  together, they share the order, purpose, challan line, job worker and
 *  issuer, and post in ONE transaction under a batch number (FIB-0001): each
 *  roll becomes its own issue, and either all of them post or none do. One
 *  roll posts exactly as it always did.
 * ---------------------------------------------------------------------------
 *  OPENED FROM A CUTTING CHALLAN (old links only)
 *
 *  Cutting issues are now made on the challan itself - see
 *  pages/cutting/IssueFabricModal.jsx - and Cutting is not offered as a
 *  purpose below. A bookmarked link of the old form still lands here with
 *  ?order=<id>&challanLine=<id>. The order, the purpose (Cutting) and the line
 *  are filled in, and the rolls to cover what is still outstanding are picked
 *  by suggestRolls() - one colour, one shade, this order's rolls first. The
 *  screen opens on the quantities; the storeman checks the rolls against the
 *  rack and confirms. Nothing posts by itself.
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
  FloorStep,
} from '../../components/mobile.jsx';
import { Field, PageHeader, TextArea } from '../../components/ui.jsx';
import { fmtEnum, fmtNum, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { suggestRolls } from '../../utils/rollSuggest.js';

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
  /*
   * NO "CUTTING" HERE. Fabric for the cutting floor is issued on the cutting
   * challan itself (IssueFabricModal), against the line it fulfils - the
   * challan already knows the order, the purpose and the line. This screen is
   * for fabric going OUT to a job worker, and for returns.
   */
  { value: 'DYEING', label: 'Dyeing', hint: 'out to a dyeing unit' },
  { value: 'PRINTING', label: 'Printing', hint: 'out to a printing unit' },
  { value: 'RETURN', label: 'Return', hint: 'back to the store' },
];

/** The server's batch limit - see MAX_BATCH_ROLLS in fabricIssue.service.js. */
const MAX_ROLLS = 30;

export default function FabricIssueForm() {
  const navigate = useNavigate();

  // Opened from a cutting challan line - see "OPENED FROM A CUTTING CHALLAN".
  const [params] = useSearchParams();
  const fromLineId = params.get('challanLine') || '';

  const [rolls, setRolls] = useState([]);
  const [rollsLoading, setRollsLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [vendors, setVendors] = useState([]);

  // The rolls being issued, in the order they were picked - which is the
  // order they post in, and so the order the shade check judges them in.
  const [rollIds, setRollIds] = useState([]);
  // Quantity per roll, keyed by roll id.
  const [qtys, setQtys] = useState({});
  const [orderId, setOrderId] = useState(() => (fromLineId && params.get('order')) || '');
  const [purpose, setPurpose] = useState(fromLineId ? 'CUTTING' : '');
  const [vendorId, setVendorId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [issuedByName, setIssuedByName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  // Only asked for when a roll's shade or dye lot differs from the one the
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
  const [challanLinesLoaded, setChallanLinesLoaded] = useState(false);
  const [challanLineId, setChallanLineId] = useState(fromLineId);

  // What was picked for the challan line, shown above the steps. Made once:
  // a storeman who then changes the rolls must not have them put back.
  const [suggestion, setSuggestion] = useState(null);
  const suggested = useRef(false);

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

  // One preview per roll, keyed by roll id.
  const [previews, setPreviews] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /*
   * The rolls are fetched for the order, so each says whether it was bought
   * for it - the "other order" badge, and the suggestion's first preference.
   * The list itself is never narrowed to the order.
   */
  useEffect(() => {
    let live = true;
    fiApi
      .rolls(orderId ? { orderId } : undefined)
      .then((r) => live && setRolls(r))
      .catch(loadFailed(setRolls, 'rolls'))
      .finally(() => live && setRollsLoading(false));
    return () => {
      live = false;
    };
  }, [orderId]);

  useEffect(() => {
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

  /** Tapping a roll adds it to the issue, or takes it back off. */
  function toggleRoll(id) {
    setRollIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      if (ids.length >= MAX_ROLLS) return ids;
      return [...ids, id];
    });
    setQtys(({ [id]: _dropped, ...rest }) => rest);
  }

  /** A scan only ever adds - scanning the same label twice must not undo it. */
  function addRoll(id) {
    setRollIds((ids) => (ids.includes(id) || ids.length >= MAX_ROLLS ? ids : [...ids, id]));
  }

  /**
   * "Can I issue this much off each roll?" — answered by the server.
   *
   * Each roll is told which rolls of the batch post ahead of it, so the shade
   * verdict is the one the posting will reach.
   */
  const runPreview = useCallback(async () => {
    if (!rollIds.length) {
      setPreviews({});
      return;
    }
    try {
      const results = await Promise.all(
        rollIds.map((id, i) =>
          fiApi.preview({
            rollId: id,
            fabricQtyIssued: qtys[id] === undefined || qtys[id] === '' ? undefined : String(qtys[id]),
            purpose: purpose || undefined,
            cuttingChallanLineId: needsChallanLine && challanLineId ? challanLineId : undefined,
            batchRollIds: i > 0 ? rollIds.slice(0, i) : undefined,
          }),
        ),
      );
      setPreviews(Object.fromEntries(rollIds.map((id, i) => [id, results[i]])));
    } catch (e) {
      setPreviews({});
      setError(e.message);
    }
  }, [rollIds, qtys, purpose, needsChallanLine, challanLineId]);

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
      .catch(loadFailed(setChallanLines, 'challan lines'))
      .finally(() => setChallanLinesLoaded(true));
  }, [needsChallanLine, orderId]);

  /** Opened from a challan line: pick the rolls for it, once both lists are in. */
  useEffect(() => {
    if (!fromLineId || suggested.current || rollsLoading || !challanLinesLoaded) return;
    suggested.current = true;
    const line = challanLines.find((l) => l.id === fromLineId);
    if (!line) {
      // Filled, closed or no longer approved since the challan was opened.
      setChallanLineId('');
      setSuggestion({ missing: true });
      return;
    }
    const s = suggestRolls(rolls, line, MAX_ROLLS);
    setSuggestion({ line, ...s });
    if (s.picks.length) {
      setRollIds(s.picks.map((p) => p.id));
      setQtys(Object.fromEntries(s.picks.map((p) => [p.id, String(p.qty)])));
      setStep(4);
    }
  }, [fromLineId, rollsLoading, challanLinesLoaded, challanLines, rolls]);

  const many = rollIds.length > 1;
  const picked = rollIds.map((id) => rolls.find((r) => r.id === id)).filter(Boolean);
  const order = orders.find((o) => o.id === orderId);
  const firstPreview = previews[rollIds[0]];
  const needsVendor = firstPreview?.needsJobWorker;
  const uoms = [...new Set(picked.map((r) => r.uom))];
  const uomLabel = uoms.length === 1 ? uoms[0] : '';
  const totalQty = rollIds.reduce((sum, id) => sum + Number(qtys[id] || 0), 0);
  const totalBalance = picked.reduce((sum, r) => sum + Number(r.balanceQty || 0), 0);

  async function post() {
    setBusy(true);
    setError('');
    const shared = {
      issueDate: todayInput(),
      purpose,
      orderId,
      // C5 - sent only where a challan actually governs the issue.
      cuttingChallanLineId: needsChallanLine ? challanLineId : undefined,
      vendorId: vendorId || null,
      issuedByEmployeeId: employeeId || null,
      issuedByName: issuedByName || null,
      shadeMixReason: shadeMix ? shadeMixReason.trim() : undefined,
      deliveryDate: deliveryDate || null,
      remarks: remarks || null,
    };
    try {
      let firstId;
      if (many) {
        const batch = await fiApi.createBatch({
          ...shared,
          rolls: rollIds.map((id) => ({ rollId: id, fabricQtyIssued: String(qtys[id]) })),
        });
        firstId = batch.issues[0].id;
      } else {
        const saved = await fiApi.create({
          ...shared,
          rollId: rollIds[0],
          fabricQtyIssued: String(qtys[rollIds[0]]),
        });
        firstId = saved.id;
      }
      setConfirming(false);
      // A batch opens on its first issue, which lists the rest and prints them all.
      navigate(`/fabric-issues/${firstId}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
      setConfirming(false);
    }
  }

  /*
   * Step 3 is done when the purpose AND anything the purpose drags in with it
   * are answered - a cutting issue needs its challan line, a job work issue
   * needs the unit it is going to. Without this the Continue button would let
   * somebody past a half-answered step and fail at the very end instead.
   */
  // The shade verdicts for these rolls against the chosen cutting line.
  const shadeMisses = needsChallanLine
    ? rollIds.map((id) => previews[id]?.shade).filter((s) => s && !s.ok)
    : [];
  const shadeMix = shadeMisses.length > 0;
  const shadeReasonOk = !shadeMix || shadeMixReason.trim().length >= 10;

  const stepThreeDone =
    shadeReasonOk &&
    Boolean(purpose) &&
    (!needsChallanLine || Boolean(challanLineId)) &&
    (!needsVendor || Boolean(vendorId));

  const short = rollIds.filter((id) => previews[id]?.availability && !previews[id].availability.permitted);
  const allQtys = rollIds.length > 0 && rollIds.every((id) => Number(qtys[id]) > 0);
  const allPermitted = rollIds.every((id) => previews[id]?.availability?.permitted);

  const ready =
    rollIds.length > 0 &&
    Boolean(orderId && purpose) &&
    allQtys &&
    allPermitted &&
    (!needsVendor || vendorId) &&
    (!needsChallanLine || challanLineId) &&
    shadeReasonOk &&
    (employeeId || issuedByName.trim());

  /** Why a roll's quantity cannot be issued, in the storeman's terms. */
  const shortMessage = (availability) =>
    !availability.withinRoll
      ? `Roll ${availability.rollNo} only has ${availability.rollBalance} ${availability.uom} left.`
      : `Only ${availability.ledgerAvailable} ${availability.uom} of this fabric is in stock at ${availability.location}.`;

  const rollSummary = !picked.length
    ? ''
    : many
      ? `${picked.length} rolls · ${picked.map((r) => r.rollNo).join(', ')} · ${fmtNum(totalBalance)} ${uomLabel} on them`
      : `${picked[0].rollNo} · ${[picked[0].fabricName, picked[0].colorCode].filter(Boolean).join(' · ')} · ${fmtNum(picked[0].balanceQty)} ${picked[0].uom} left`;

  const purposeLabel = PURPOSES.find((p) => p.value === purpose)?.label;
  const vendorName = vendors.find((v) => v.id === vendorId)?.vendorName;

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

      {suggestion?.missing && (
        <FloorAlert kind="error" title="That challan line is no longer open" onDismiss={() => setSuggestion(null)}>
          It has been filled, closed or taken out of approval. Choose the requirement in step 3.
        </FloorAlert>
      )}
      {suggestion?.line && (
        <FloorAlert
          kind={suggestion.shortQty > 0 ? 'error' : 'info'}
          title={'For ' + suggestion.line.challanNo + ' line ' + suggestion.line.lineNo}
          onDismiss={() => setSuggestion(null)}
        >
          {suggestion.picks.length
            ? suggestion.picks.length + (suggestion.picks.length > 1 ? ' rolls' : ' roll') + ' picked for ' +
              fmtNum(suggestion.suggestedQty) + ' of the ' + fmtNum(suggestion.line.outstandingQty) + ' ' +
              suggestion.line.uom + ' outstanding. Check them against the rack before issuing.'
            : 'No ' + (suggestion.line.colorCode ?? '') + ' roll in ' + suggestion.line.uom +
              ' has any balance - pick one in step 1.'}
          {suggestion.picks.length > 0 && suggestion.shortQty > 0 && (
            <div>
              Short by {fmtNum(suggestion.shortQty)} {suggestion.line.uom} - add rolls in step 1, or issue what
              there is.
            </div>
          )}
        </FloorAlert>
      )}

      {/* --- 1. The roll(s) ------------------------------------------------ */}
      <FloorStep
        index={1}
        title="Which rolls"
        open={step === 1}
        done={rollIds.length > 0}
        onReopen={() => setStep(1)}
        summary={rollSummary}
      >
      <PickerList
        items={rolls}
        loading={rollsLoading}
        onSelect={addRoll}
        searchPlaceholder="Scan or search a roll number, color or fabric..."
        searchKeys={['rollNo', 'fabricName', 'colorCode', 'gsm', 'orderNo', 'poId']}
        emptyMessage="No rolls with any balance left."
        render={(r) => (
          <PickerCard
            selected={rollIds.includes(r.id)}
            onSelect={() => toggleRoll(r.id)}
            title={r.rollNo}
            badge={r.forThisOrder === false && orderId ? 'other order' : undefined}
            subtitle={[r.fabricName, r.colorCode, r.gsm].filter(Boolean).join(' · ')}
            meta={[
              fmtEnum(r.stage),
              r.location,
              r.orderNo ? `for ${r.orderNo}` : null,
              r.shade || r.dyeLot
                ? [r.shade && `shade ${r.shade}`, r.dyeLot && `lot ${r.dyeLot}`].filter(Boolean).join(', ')
                : null,
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
      {/* Tapping no longer moves on by itself: a second and third roll are
          picked from the same list, so the storeman says when they are done. */}
      {rollIds.length > 0 && (
        <div className="floor-actions">
          <BigButton onClick={() => setStep(2)}>
            Continue with {rollIds.length} roll{many ? 's' : ''}
          </BigButton>
        </div>
      )}
      {rollIds.length >= MAX_ROLLS && (
        <FloorAlert kind="info">{MAX_ROLLS} rolls is the most one issue can carry.</FloorAlert>
      )}
      </FloorStep>

      {/* --- 2. The order -------------------------------------------------- */}
      <FloorStep
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
      </FloorStep>

      {/* --- 3. The purpose ------------------------------------------------ */}
      <FloorStep
        index={3}
        title="What for"
        open={step === 3}
        done={Boolean(purpose)}
        onReopen={() => setStep(3)}
        summary={purposeLabel ?? ''}
      >
          <p className="hint" style={{ margin: '0 0 8px' }}>
            Fabric for cutting is issued from its{' '}
            <Link to="/cutting-challans">cutting challan</Link>, against the line it fulfils.
          </p>
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

          {firstPreview?.willMoveTo && purpose && (
            <FloorAlert kind="info">
              After this issue {many ? 'the rolls' : 'the roll'} will be at{' '}
              <strong>{firstPreview.willMoveTo}</strong>, at stage{' '}
              <strong>{fmtEnum(firstPreview.willBecomeStage)}</strong>.
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
              {shadeMisses.map((s, i) => (
                <div key={i}>{s.message}</div>
              ))}
              <Field
                label="Reason for mixing"
                required
                hint={`At least 10 characters. Stored on ${shadeMisses.length > 1 ? 'each issue that mixes' : 'the issue'}.`}
              >
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
      </FloorStep>

      {/* --- 4. The quantity ----------------------------------------------- */}
      <FloorStep
        index={4}
        title="How much"
        open={step === 4}
        done={allQtys}
        onReopen={() => setStep(4)}
        summary={allQtys ? `${fmtNum(totalQty)} ${uomLabel}${many ? ` off ${rollIds.length} rolls` : ''}` : ''}
      >
          {/* The commonest batch is "all of each roll" - one tap for that. */}
          {many && (
            <div className="floor-actions">
              <BigButton
                kind="ghost"
                onClick={() =>
                  setQtys(
                    Object.fromEntries(
                      rollIds.map((id) => [id, String(previews[id]?.availability?.maxIssuable ?? qtys[id] ?? '')]),
                    ),
                  )
                }
              >
                Max on every roll
              </BigButton>
            </div>
          )}

          {rollIds.map((id) => {
            const availability = previews[id]?.availability;
            const r = picked.find((x) => x.id === id);
            return (
              <QtyStepper
                key={id}
                id={`qty-${id}`}
                value={qtys[id] ?? ''}
                onChange={(v) => setQtys((q) => ({ ...q, [id]: v }))}
                uom={r?.uom}
                label={many ? `Roll ${r?.rollNo ?? ''}` : 'Fabric Qty Issued'}
                compact={many}
                available={availability?.maxIssuable}
                max={availability?.maxIssuable}
                error={availability && !availability.permitted ? shortMessage(availability) : undefined}
              />
            );
          })}

          {short.length > 0 && (
            <FloorAlert kind="error" title="Not enough stock">
              {short.map((id) => {
                const a = previews[id].availability;
                return (
                  <div key={id}>
                    Roll {a.rollNo}: short by {!a.withinRoll ? a.rollShort : a.ledgerShort} {a.uom}, on{' '}
                    {!a.withinRoll ? 'the roll' : 'the ledger'}.
                  </div>
                );
              })}
              The server checks each roll&apos;s own balance and the stock ledger.
            </FloorAlert>
          )}

          {many && allQtys && (
            <div className="muted" style={{ textAlign: 'right' }}>
              Total <strong>{fmtNum(totalQty)}</strong> {uomLabel}
            </div>
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

          <Field label="Delivery date">
            <input
              type="date"
              value={deliveryDate}
              min={todayInput()}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
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
      </FloorStep>

      {/* --- 5. Confirm. The fabric leaves the rack. ----------------------- */}
      <ConfirmSheet
        open={confirming}
        title={many ? `Issue these ${rollIds.length} rolls?` : 'Issue this fabric?'}
        summary={
          many
            ? `${fmtNum(totalQty)} ${uomLabel} off ${rollIds.length} rolls for ${purpose.toLowerCase()}, ` +
              `against ${order?.orderNo ?? ''}. All of them post together, or none do.`
            : `${fmtNum(totalQty)} ${picked[0]?.uom ?? ''} off roll ${picked[0]?.rollNo ?? ''} for ` +
              `${purpose.toLowerCase()}, against ${order?.orderNo ?? ''}.`
        }
        lines={
          many
            ? [
                ...picked.map((r) => ({
                  label: r.rollNo,
                  value:
                    `${fmtNum(qtys[r.id])} ${r.uom} · ` +
                    `${fmtNum(Number(r.balanceQty ?? 0) - Number(qtys[r.id] || 0))} left`,
                })),
                { label: 'Purpose', value: purposeLabel },
                ...(vendorId ? [{ label: 'Going to', value: vendorName }] : []),
              ]
            : [
                { label: 'Roll', value: picked[0]?.rollNo },
                {
                  label: 'Fabric',
                  value: [picked[0]?.fabricName, picked[0]?.colorCode].filter(Boolean).join(' · '),
                },
                { label: 'Quantity', value: `${fmtNum(totalQty)} ${picked[0]?.uom ?? ''}` },
                {
                  label: 'Left on the roll',
                  value: `${fmtNum(Number(picked[0]?.balanceQty ?? 0) - totalQty)} ${picked[0]?.uom ?? ''}`,
                },
                { label: 'Purpose', value: purposeLabel },
                ...(vendorId ? [{ label: 'Going to', value: vendorName }] : []),
              ]
        }
        warning={
          many
            ? 'This writes a stock ledger OUT for every roll in one transaction. The fabric leaves the store.'
            : 'This writes a stock ledger OUT in the same transaction. The fabric leaves the store.'
        }
        confirmLabel="Issue"
        onConfirm={post}
        onCancel={() => setConfirming(false)}
        busy={busy}
      />
    </div>
  );
}
