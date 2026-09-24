/**
 * Gate Pass — raised at the gate, on a phone.
 *
 * ===========================================================================
 *  A SHOP-FLOOR SCREEN
 * ===========================================================================
 *
 * This is filled in by a checker standing at a gate, watching a lorry, often in
 * daylight on a scratched screen. The design follows from that:
 *
 *   ONE THING TO TYPE.  The reference number - scanned or keyed - resolves the
 *                       whole rest of the pass. Party, item, UOM and the
 *                       expected quantity all come back from
 *                       POST /gate-passes/preview and fill themselves in. The
 *                       checker's only real input is the count.
 *
 *   THE SCANNER WORKS.  `ScanBox` treats a barcode wedge as what it is - a
 *                       keyboard that finishes with Enter - so RF-001 on a
 *                       printed PO scans straight in.
 *
 *   BIG QUANTITY BOX.   `QtyStepper`, numeric keypad, with the expected
 *                       quantity underneath and a Max button, because "all of
 *                       it" is the commonest answer by a distance.
 *
 *   VARIATION IS THE SERVER'S.  (Qty − Received) ÷ Qty, from the preview
 *                       endpoint, shown as the checker types. Nothing here
 *                       divides anything.
 *
 *   CONFIRM BEFORE POSTING.  Goods through a gate cannot be un-passed.
 */

import { useCallback, useEffect, useState } from 'react';
import { gatePasses as gpApi, vendors as vendorsApi } from '../../services/erp.js';
import {
  BigButton,
  ConfirmSheet,
  FloorAlert,
  FloorFact,
  QtyStepper,
  ScanBox,
} from '../../components/mobile.jsx';
import { Field, RecordSelect, Spinner, TextArea, TextInput } from '../../components/ui.jsx';
import { fmtNum, nowLocalInput, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';

const TYPES = [
  { value: 'INWARD', label: 'Inward — goods coming in' },
  { value: 'OUTWARD', label: 'Outward — goods going out' },
];

const PURPOSES = ['CUTTING', 'DYEING', 'PRINTING', 'STITCHING', 'RETURN', 'SAMPLING', 'OTHER'];

/**
 * What a number plate can actually look like.
 *
 * THE SAME FOUR SHAPES the server enforces - see `looksLikeAPlate` in
 * gatePass.validator.js. Duplicated rather than shared because the two run in
 * different workspaces; if one list changes the other has to follow, and the
 * server is the one that decides.
 *
 *   RJ 14 GA 1234    state, district, 0-3 series letters, number
 *   26 BH 1234 AA    the all-India BH series
 *   10 EF 123456 K   defence
 *   33 CD 0001       diplomatic / consular / UN
 *
 * Checking here as well is not belt and braces - it is so the checker is told
 * at the field, while looking at the lorry, rather than after pressing save.
 */
const PLATE_PATTERNS = [
  /^[A-Z]{2} ?\d{1,2} ?[A-Z]{0,3} ?\d{1,4}$/,
  /^\d{2} ?BH ?\d{4} ?[A-Z]{1,2}$/,
  /^\d{2} ?[A-Z]{1,2} ?\d{6} ?[A-Z]?$/,
  /^\d{1,3} ?(CD|CC|UN) ?\d{1,4}$/,
];

const tidyPlate = (v) => v.toUpperCase().replace(/[\s-]+/g, ' ').trim();
const looksLikeAPlate = (v) => PLATE_PATTERNS.some((re) => re.test(tidyPlate(v)));

export default function GatePassForm({ onSaved, onCancel }) {
  const [docNo, setDocNo] = useState('');
  const [resolved, setResolved] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');

  const [type, setType] = useState('INWARD');
  const [purpose, setPurpose] = useState('OTHER');
  const [qty, setQty] = useState('');
  const [receivedQty, setReceivedQty] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [driverName, setDriverName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [clearNow, setClearNow] = useState(false);

  /**
   * C8 - WHEN THE GOODS ACTUALLY CROSSED THE GATE.
   *
   * Defaulted to now, because the overwhelmingly common case is a guard writing
   * the pass up as the lorry stands there - but EDITABLE, because the case that
   * matters is the one that is not: a vehicle cleared at 21:40 and written up
   * the next morning. Stage timing is measured from this column - the screen
   * that rendered it has gone, the `/workflow/stage-durations` endpoint has
   * not - and if it silently equalled the record's creation time it would
   * report that every consignment waited zero minutes at the gate.
   */
  const [movementTime, setMovementTime] = useState(nowLocalInput());

  /*
   * THE ONLY WAY IN, NOW.
   *
   * A checker watching a lorry knows who delivered and what time it is. He does
   * not know which purchase order the load answers, and looking it up is not
   * his job. So an INWARD pass is raised on the vendor and the time alone, and
   * somebody at a desk attaches the document afterwards via `allocate()`.
   *
   * The gate used to be offered a choice between this and resolving a document
   * on the spot. It was not a choice the gate wanted: the short way is the one
   * that got used, and the document path only ever produced guessed numbers.
   * Outward is different and still resolves a document - goods cannot leave
   * the building without the paper saying where they are going.
   */
  const [vendorId, setVendorId] = useState('');
  const [vendorOptions, setVendorOptions] = useState(null);

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
  }, []);

  /**
   * Resolve the reference. Everything else on the pass follows from it, so this
   * is the only step that has to happen before the form is usable.
   */
  const resolve = useCallback(
    async (numberToResolve) => {
      const value = (numberToResolve ?? docNo).trim();
      if (!value) return;
      setResolving(true);
      setResolveError('');
      try {
        const p = await gpApi.preview({ linkedDocNo: value, type });
        setResolved(p);
        setQty(p.qty);
        setType(p.reference.naturalType ?? type);
        setError('');
      } catch (e) {
        setResolved(null);
        setResolveError(e.message);
      } finally {
        setResolving(false);
      }
    },
    [docNo, type],
  );

  /** Re-price the variation as the checker types a count. */
  const [variation, setVariation] = useState(null);
  useEffect(() => {
    if (!resolved || receivedQty === '') {
      setVariation(null);
      return undefined;
    }
    const id = setTimeout(async () => {
      try {
        setVariation(
          await gpApi.preview({
            linkedDocNo: docNo.trim(),
            type,
            qty: String(qty),
            receivedQty: String(receivedQty),
          }),
        );
      } catch {
        setVariation(null);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [resolved, receivedQty, qty, docNo, type]);

  async function post() {
    setBusy(true);
    setError('');
    try {
      const saved = await gpApi.create({
        gatePassDate: todayInput(),
        // C8 - sent as a full local timestamp; the server refuses a future one.
        movementTime: new Date(movementTime).toISOString(),
        type,
        vehicleNo: vehicleNo.trim() || null,
        driverName: driverName.trim() || null,
        remarks: remarks || null,
        // The short form sends who delivered and nothing the document decides:
        // item, quantity, UOM and purpose all arrive with the allocation.
        ...(shortForm
          ? { vendorId }
          : {
            linkedDocNo: docNo.trim(),
            qty: String(qty),
            receivedQty: receivedQty === '' ? null : String(receivedQty),
            purpose,
            status: clearNow && receivedQty !== '' ? 'CLEARED' : undefined,
          }),
      });
      setConfirming(false);
      onSaved(saved);
    } catch (e) {
      setError(e.message);
      setBusy(false);
      setConfirming(false);
    }
  }

  // Goods leaving the building must name where they are going, so an outward
  // pass still resolves a document. Inward never does at the gate: the checker
  // records who delivered and when, and `allocate()` attaches the order later.
  const shortForm = type === 'INWARD';

  /** C8 - a movement time in the future is refused by the server; say so here. */
  const movementInFuture = Boolean(movementTime) && new Date(movementTime).getTime() > Date.now();
  /* Blank is fine - plenty of goods arrive without a vehicle. Something that
     is not a plate is not, because it names a lorry and identifies none. */
  const plateError =
    vehicleNo.trim() && !looksLikeAPlate(vehicleNo)
      ? 'That does not look like a vehicle number. For example: RJ 14 GA 1234.'
      : '';

  const ready = !plateError && shortForm
    // Who and when. That is the whole record the gate is being asked for.
    ? Boolean(vendorId) && Boolean(movementTime) && !movementInFuture
    : Boolean(resolved) && Number(qty) > 0 && purpose && Boolean(movementTime) && !movementInFuture;

  return (
    <div className="floor-page">
      {error && (
        <FloorAlert kind="error" title="Could not raise the gate pass" onDismiss={() => setError('')}>
          {error}
        </FloorAlert>
      )}

      {/* --- 1a. THE SHORT FORM: who delivered. ---------------------------- */}
      {shortForm && (
        <Field
          label="Received from"
          required
          hint="The vendor whose lorry is at the gate."
        >
          <RecordSelect
            id="gp-vendor"
            options={vendorOptions ?? []}
            loading={vendorOptions === null}
            getValue={(v) => v.id}
            getLabel={(v) => `${v.vendorName} (${v.vendorCode})`}
            placeholder="Select vendor..."
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
          />
        </Field>
      )}

      {/* --- 1b. The reference. Everything else follows from it. ------------ */}
      {!shortForm && (
        <Field
          label="Reference document"
          required
          hint="Scan or type the PO, job work or cutting challan number."
        >
          <ScanBox
            value={docNo}
            onChange={(v) => {
              setDocNo(v);
              if (resolved) setResolved(null);
            }}
            placeholder="RF-001, DY-001, CH-001..."
            onScan={(code) => resolve(code)}
            autoFocus
          />
        </Field>
      )}

      {!shortForm && !resolved && (
        <div className="floor-actions">
          <BigButton onClick={() => resolve()} busy={resolving} disabled={!docNo.trim()}>
            Find document
          </BigButton>
        </div>
      )}

      {resolving && <Spinner label="Looking it up..." />}

      {resolveError && (
        <FloorAlert kind="error" title="Not found">
          {resolveError}
        </FloorAlert>
      )}

      {/* --- 2. What the document says. Read-only: nothing to retype. ------
          Shown once the document is resolved, OR - on the short form - as soon
          as the vendor is named. The movement time, the authoriser and the
          submit button belong to both paths; only the figures the document
          decides are hidden when there is no document yet. */}
      {(resolved || (shortForm && vendorId)) && (
        <>
          {resolved && (
            <FloorAlert kind="success" title={`${resolved.reference.no} found`}>
              {resolved.reference.partyName}
              {resolved.reference.orderNo && ` · order ${resolved.reference.orderNo}`}
            </FloorAlert>
          )}

          {resolved && (
            <div className="floor-facts">
              <FloorFact label="Party" value={resolved.reference.partyName} />
              <FloorFact label="Item" value={resolved.reference.item} />
              <FloorFact
                label="Expected"
                value={fmtNum(resolved.reference.expectedQty)}
                sub={resolved.reference.uom}
              />
              <FloorFact
                label="Document total"
                value={fmtNum(resolved.reference.documentQty)}
                sub={resolved.reference.uom}
              />
            </div>
          )}

          <div className="form-grid">
            <Field label="Type" required>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>

            {/* What the goods are FOR is a property of the document, so the
                short form does not ask - allocation supplies it. */}
            {!shortForm && (
            <Field label="Purpose" required>
              <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                {PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            )}

            {/* C8 - the moment the goods crossed. Defaulted to now, editable,
                and refused if it is in the future. */}
            <Field
              label="Movement time"
              required
              error={movementInFuture ? 'A gate pass records goods that have already crossed.' : ''}
            >
              <input
                type="datetime-local"
                value={movementTime}
                max={nowLocalInput()}
                onChange={(e) => setMovementTime(e.target.value)}
              />
            </Field>

            {/* The number on the lorry. Optional - hand-carried goods and
                couriers that do not wait are ordinary - but it is the first
                thing asked for when a consignment is disputed, so it gets a
                field of its own rather than a line in the remarks. */}
            <Field
              label="Vehicle no"
              error={plateError}
            >
              {/* Cleaned as it is typed rather than refused afterwards: upper
                  case, single spaces, and nothing that cannot be on a plate.
                  The same lorry then files under one number instead of three
                  ("rj14ga1234", "RJ-14-GA-1234", "RJ 14 GA 1234").

                  The SHAPE is not enforced. Temporary registrations, army and
                  diplomatic plates, the BH series and other states' padding
                  all turn up at a gate, and a checker copying a number plate
                  has to be able to write down what it says. */}
              <TextInput
                id="gp-vehicle"
                value={vehicleNo}
                onChange={(e) =>
                  setVehicleNo(e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, ''))
                }
                onBlur={() => setVehicleNo(tidyPlate)}
                placeholder="RJ 14 GA 1234"
                maxLength={30}
                autoCapitalize="characters"
              />
            </Field>

            {/* The plate identifies the lorry; this identifies the person who
                signed for the load. They are the pair a guard is asked to
                produce when a consignment is disputed, so they sit together.
                Optional for the same reason the plate is. */}
            <Field
              label="Driver name"
            >
              <TextInput
                id="gp-driver"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="as on the licence"
                maxLength={120}
              />
            </Field>
          </div>

          {/* --- 3. The quantities. The only real typing on this screen. ---
              Both come from the document - what is expected, and what may be
              counted against it - so the short form has neither. The count is
              taken when the pass is cleared, after it has been allocated. */}
          {resolved && (
            <>
              <Field label="Qty passing the gate" hint="Defaulted from the document. Narrow it for a part load.">
                <QtyStepper
                  value={qty}
                  onChange={setQty}
                  uom={resolved.reference.uom}
                  label="Qty"
                  available={resolved.reference.expectedQty}
                  max={resolved.reference.expectedQty}
                />
              </Field>

              <div style={{ marginTop: 12 }}>
                <QtyStepper
                  value={receivedQty}
                  onChange={setReceivedQty}
                  uom={resolved.reference.uom}
                  label="Received Qty (counted at the gate)"
                  max={qty}
                  hint="Leave blank if the count has not been done yet."
                />
              </div>
            </>
          )}

          {/* Variation, from the server. Nothing here divides anything. */}
          {variation && (
            <FloorAlert
              kind={
                variation.variationDirection === 'EXACT'
                  ? 'success'
                  : variation.variationDirection === 'SHORT'
                    ? 'warning'
                    : 'info'
              }
              title={`Variation ${variation.variationPctDisplay}%`}
            >
              {variation.variationDirection === 'EXACT' && 'The count matches the document exactly.'}
              {variation.variationDirection === 'SHORT' &&
                `Short delivery — ${fmtNum(Number(qty) - Number(receivedQty))} ${resolved.reference.uom} less than the document says.`}
              {variation.variationDirection === 'EXCESS' &&
                `Over delivery — ${fmtNum(Number(receivedQty) - Number(qty))} ${resolved.reference.uom} more than the document says.`}
              <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                {variation.formula}
              </div>
            </FloorAlert>
          )}

          {receivedQty !== '' && (
            <label className="row" style={{ marginTop: 12, gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={clearNow}
                onChange={(e) => setClearNow(e.target.checked)}
                style={{ width: 20, height: 20 }}
              />
              <span>Clear the pass now — the goods have been counted and moved.</span>
            </label>
          )}

          <Field label="Remarks" className="span-2">
            <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>

          <div className="floor-actions">
            <BigButton kind="ghost" onClick={onCancel}>
              Cancel
            </BigButton>
            <BigButton onClick={() => setConfirming(true)} disabled={!ready}>
              Raise gate pass
            </BigButton>
          </div>
        </>
      )}

      {/* --- 4. Confirm. Goods through a gate cannot be un-passed. -------- */}
      <ConfirmSheet
        open={confirming}
        title={type === 'INWARD' ? 'Admit these goods?' : 'Release these goods?'}
        /*
         * The summary describes what is actually being recorded.
         *
         * Built from the document, it read "- of from , against ." on the short
         * form - every blank a field the gate was never asked for. A
         * confirmation that describes nothing is worse than no confirmation:
         * the checker is being asked to agree to a sentence with holes in it.
         */
        summary={
          shortForm
            ? `A delivery from ${
              vendorOptions?.find((v) => v.id === vendorId)?.vendorName ?? 'this vendor'
            }, arriving ${movementTime ? new Date(movementTime).toLocaleString() : 'now'}. `
              + 'The order it answers is matched to it afterwards.'
            : `${fmtNum(qty)} ${resolved?.reference.uom ?? ''} of ${resolved?.reference.item ?? ''} `
              + `${type === 'INWARD' ? 'from' : 'to'} ${resolved?.reference.partyName ?? ''}, `
              + `against ${docNo.trim()}.`
        }
        lines={
          shortForm
            ? [
              { label: 'Type', value: 'Inward' },
              {
                label: 'Received from',
                value: vendorOptions?.find((v) => v.id === vendorId)?.vendorName ?? '-',
              },
              {
                label: 'Crossed at',
                value: movementTime ? new Date(movementTime).toLocaleString() : '-',
              },
              { label: 'Document', value: 'to be allocated' },
              { label: 'Status', value: 'Pending' },
            ]
            : [
              { label: 'Type', value: type === 'INWARD' ? 'Inward' : 'Outward' },
              { label: 'Purpose', value: purpose.charAt(0) + purpose.slice(1).toLowerCase() },
              {
                label: 'Crossed at',
                value: movementTime ? new Date(movementTime).toLocaleString() : '-',
              },
              { label: 'Qty', value: `${fmtNum(qty)} ${resolved?.reference.uom ?? ''}` },
              {
                label: 'Received',
                value: receivedQty === '' ? 'not counted yet' : `${fmtNum(receivedQty)} ${resolved?.reference.uom ?? ''}`,
              },
              ...(variation ? [{ label: 'Variation', value: `${variation.variationPctDisplay}%` }] : []),
              { label: 'Status', value: clearNow && receivedQty !== '' ? 'Cleared' : 'Pending' },
            ]
        }
        warning={
          variation && variation.variationDirection !== 'EXACT'
            ? `The count does not match the document — ${variation.variationPctDisplay}% variation. This will be recorded.`
            : null
        }
        confirmLabel={type === 'INWARD' ? 'Admit' : 'Release'}
        onConfirm={post}
        onCancel={() => setConfirming(false)}
        busy={busy}
      />
    </div>
  );
}
