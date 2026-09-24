/**
 * GRN — posting a goods receipt.
 *
 * ---------------------------------------------------------------------------
 *  ONE PRESS, ONE TRANSACTION
 *
 *  Saving this form posts the whole receipt: the GRN, the inventory item, one
 *  fabric roll per roll received, one stock ledger IN per roll, the balance and
 *  the PO's running total. The server does all of it inside a single
 *  transaction - so there is no "save draft, post later" here, and the submit
 *  button says what it does.
 *
 *  THE TOLERANCE IS CONFIGURED, NOT ASSUMED
 *
 *  The preview endpoint resolves the excess rule for this item and returns the
 *  permitted variance with its basis. This file prints the number it is given;
 *  it does not know that "2%" exists.
 *
 *  AN OVER-RECEIPT IS RECORDED, NOT REFUSED - BUT NEVER SILENTLY
 *
 *  The goods are in the yard either way. The first attempt comes back with the
 *  numbers and a refusal; the checker has to tick the acknowledgement to say
 *  they know. That tick is the whole control.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { grns as grnApi, purchaseOrders as poApi } from '../../services/erp.js';
import {
  FieldGroup,
  FormShell,
  RHFEnumSelect,
  RHFInput,
  RHFQty,
  RHFRecordSelect,
  RHFTextArea,
  useSubmit,
  useZodForm,
} from '../../components/form.jsx';
import { Alert, Field, Spinner, TextInput } from '../../components/ui.jsx';
import { fmtNum, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import TableWrap from '../../components/TableWrap.jsx';

const schema = z.object({
  grnNo: z.string().trim().max(40).optional(),
  purchaseOrderId: z.string().uuid('Choose a purchase order'),
  billNo: z.string().trim().min(1, 'The vendor bill number is required').max(60),
  grnDate: z.string().min(1, 'Date is required'),
  purpose: z.enum(['RAW_MATERIAL', 'DYEING', 'PRINTING', 'JOB_WORK_RETURN', 'ACCESSORIES']),
  receivingQty: z.coerce.number().positive('Receiving quantity must be greater than zero'),
  inventoryRate: z.coerce.number().min(0).optional(),
  hsnCode: z.string().trim().max(20).optional(),
  // The label from the GST Rate master list ('5%'), not a number. The
  // server turns it into the fraction and refuses anything not on the list.
  gstRatePct: z.string().trim().max(20).optional(),
  location: z.string().optional(),
  remarks: z.string().trim().max(2000).optional(),
});

const PURPOSES = [
  { value: 'RAW_MATERIAL', label: 'Raw material' },
  { value: 'ACCESSORIES', label: 'Accessories' },
  { value: 'DYEING', label: 'Dyeing' },
  { value: 'PRINTING', label: 'Printing' },
  { value: 'JOB_WORK_RETURN', label: 'Job work return' },
];

/**
 * One roll line on a multi-roll delivery.
 *
 * The key is a local counter, not a roll number: roll numbers are the SERVER's
 * to issue, and a client-side identifier that looked like one would be the
 * beginning of somebody generating them here.
 */
let rollLineSeq = 0;
const blankRoll = () => ({ key: `line-${(rollLineSeq += 1)}`, rollNo: '', qty: '', width: '', shade: '', dyeLot: '' });

export default function GrnForm({ purchaseOrderId, gatePassId, onSaved, onCancel }) {
  const form = useZodForm(schema, {
    grnNo: '',
    purchaseOrderId: purchaseOrderId ?? '',
    billNo: '',
    grnDate: todayInput(),
    purpose: 'RAW_MATERIAL',
    receivingQty: '',
    inventoryRate: '',
    hsnCode: '',
    gstRatePct: '',
    /*
     * Still sent, no longer asked for.
     *
     * Stock is held per (item, location) - StockBalance is keyed on the pair -
     * so a receipt with no location has nowhere to land. The screen stopped
     * asking; the default did not stop applying.
     */
    location: 'MAIN STORE',
    remarks: '',
  });

  const [poOptions, setPoOptions] = useState(null);
  const [gstRates, setGstRates] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [rolls, setRolls] = useState([]);
  const [acknowledge, setAcknowledge] = useState(false);

  // The statutory slabs, from the master list. Not written into this file, so
  // a rate change is a data edit rather than a deployment.
  useEffect(() => {
    grnApi.gstRates().then(setGstRates).catch(loadFailed(setGstRates, 'GST rates'));
  }, []);

  const poId = form.watch('purchaseOrderId');
  const receivingQty = form.watch('receivingQty');
  const inventoryRate = form.watch('inventoryRate');

  useEffect(() => {
    // Approved and still open: an unapproved PO cannot receive goods, so it is
    // not offered rather than offered-and-refused.
    poApi
      .options({ approvedOnly: 'true', openOnly: 'true' })
      .then(setPoOptions)
      .catch(loadFailed(setPoOptions, 'pos'));
  }, []);

  /** The receipt figures, from the server. */
  const runPreview = useCallback(async () => {
    if (!poId) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    try {
      const p = await grnApi.preview({
        purchaseOrderId: poId,
        receivingQty: receivingQty === '' ? undefined : String(receivingQty),
        inventoryRate: inventoryRate === '' ? null : String(inventoryRate),
      });
      setPreview(p);
      // Default the rate and the purpose from the PO, once.
      if (inventoryRate === '') form.setValue('inventoryRate', p.purchaseOrder.rate);
      if (!form.getValues('hsnCode')) form.setValue('hsnCode', p.purchaseOrder.hsnCode ?? '');
    } catch {
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
    // form is stable across renders; including it would re-run on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId, receivingQty, inventoryRate]);

  useEffect(() => {
    const id = setTimeout(runPreview, 350);
    return () => clearTimeout(id);
  }, [runPreview]);

  // A tolerance breach has to be re-acknowledged whenever the numbers move.
  useEffect(() => {
    setAcknowledge(false);
  }, [receivingQty, poId]);

  const rollTotal = rolls.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const rollsBalance = rolls.length === 0 || Math.abs(rollTotal - Number(receivingQty || 0)) < 0.00005;

  const { submit, busy, banner, setBanner } = useSubmit(
    form,
    (values) =>
      grnApi.create({
        grnNo: values.grnNo || undefined,
        purchaseOrderId: values.purchaseOrderId,
        billNo: values.billNo,
        grnDate: values.grnDate,
        purpose: values.purpose,
        receivingQty: String(values.receivingQty),
        inventoryRate: values.inventoryRate === '' ? null : String(values.inventoryRate),
        hsnCode: values.hsnCode || null,
        // Omitted means the receipt carries no tax, which is what an
        // unregistered vendor's bill looks like. Never defaulted to a slab.
        gstRatePct: values.gstRatePct || null,
        location: values.location || null,
        gatePassId: gatePassId ?? null,
        rolls:
          rolls.length > 0
            ? rolls.map((r) => ({
                rollNo: r.rollNo || null,
                qty: String(r.qty),
                width: r.width === '' ? null : String(r.width),
                shade: r.shade || undefined,
                dyeLot: r.dyeLot || undefined,
              }))
            : undefined,
        acknowledgeToleranceBreach: acknowledge || undefined,
        remarks: values.remarks || null,
      }),
    { onDone: (saved) => onSaved(saved) },
  );

  const breached = preview?.toleranceBreached;

  return (
    <FormShell
      onSubmit={submit}
      banner={banner}
      onDismissBanner={() => setBanner('')}
      busy={busy}
      submitLabel="Post receipt"
      busyLabel="Posting..."
      onCancel={onCancel}
      disabled={!rollsBalance || (breached && !acknowledge)}
      footerNote={
        preview?.nextGrnNo
          ? `Will be numbered ${preview.nextGrnNo}. Posting writes the GRN, the roll(s) and the stock ledger together.`
          : undefined
      }
    >
      <div className="form-grid">
        <FieldGroup title="Receipt">
          <RHFRecordSelect
            form={form}
            name="purchaseOrderId"
            label="PO ID"
            required
            options={poOptions}
            loading={poOptions === null}
            getLabel={(p) =>
              `${p.poId} — ${p.vendor.vendorName} · ${fmtNum(p.pendingQty)} ${p.uom} due`
            }
            placeholder="Select an approved purchase order..."
            hint="Only approved purchase orders with something outstanding."
          />
          <RHFInput form={form} name="billNo" label="Bill No" required hint="The vendor's invoice. One bill, one receipt." />
          <RHFInput form={form} name="grnDate" label="Date" type="date" required />
          <RHFEnumSelect
            form={form}
            name="purpose"
            label="Purpose"
            required
            includeBlank={false}
            options={PURPOSES}
          />
          <RHFInput form={form} name="grnNo" label="GRN No" hint="Left blank, the server issues one." />
        </FieldGroup>

        <FieldGroup title="Quantities">
          <RHFQty
            form={form}
            name="receivingQty"
            label="Receiving Qty"
            required
            uom={preview?.purchaseOrder.uom}
            hint={
              preview
                ? `PO is for ${fmtNum(preview.purchaseOrder.orderQty)}; ${fmtNum(preview.purchaseOrder.receivedQty)} already received.`
                : undefined
            }
          />
          <RHFQty
            form={form}
            name="inventoryRate"
            label="Inventory Rate"
            hint="Defaults to the PO rate. Override to value the receipt differently."
          />
          <RHFInput form={form} name="hsnCode" label="HSN Code" />
          <RHFEnumSelect
            form={form}
            name="gstRatePct"
            label="GST Rate"
            options={gstRates.map((r) => ({ value: r.value, label: r.label }))}
            placeholder="No GST on this bill"
          />
        </FieldGroup>
      </div>

      <ReceiptFigures preview={preview} loading={previewing} />

      {/* An over-receipt is recorded, not refused - but never silently. */}
      {breached && (
        <Alert kind="warning">
          <strong>Over tolerance.</strong> This receipt takes the total on{' '}
          {preview.purchaseOrder.poId} to {preview.cumulativeReceived} against an order of{' '}
          {preview.orderQty} — {preview.cumulativeVariationPctDisplay}% over, where{' '}
          {preview.tolerancePct}% is allowed. {preview.toleranceRule}
          <label className="row" style={{ marginTop: 10, gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={acknowledge}
              onChange={(e) => setAcknowledge(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <span>I know this is over tolerance, and the goods are physically here.</span>
          </label>
        </Alert>
      )}

      {preview?.isRollTracked && (
        <RollLines
          rolls={rolls}
          setRolls={setRolls}
          uom={preview.purchaseOrder.uom}
          receivingQty={receivingQty}
          total={rollTotal}
          balanced={rollsBalance}
          nextRollNo={preview.nextRollNo}
        />
      )}

      <div className="form-grid" style={{ marginTop: 14 }}>
        <RHFTextArea form={form} name="remarks" label="Remarks" className="span-2" />
      </div>
    </FormShell>
  );
}

/** The receipt figures, exactly as the server computed them. */
function ReceiptFigures({ preview, loading }) {
  if (loading && !preview) {
    return (
      <div style={{ marginTop: 16 }}>
        <Spinner label="Checking the receipt..." />
      </div>
    );
  }
  if (!preview) return null;

  return (
    <div style={{ marginTop: 18 }}>
      <div className="fieldset-title">
        Calculated <span className="faint">&mdash; by the server</span>
      </div>


      {/* Which stock item this lands on, and whether it is a new one. */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-header">
          <span>Stock item</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {preview.item.exists ? preview.item.itemCode : 'will be created'}
          </span>
        </div>
        <div className="card-body">
          <p style={{ marginTop: 0, marginBottom: preview.item.balances.length ? 8 : 0 }}>
            <strong>{preview.item.description}</strong>
            {preview.item.isRollTracked && <span className="faint"> · tracked roll by roll</span>}
          </p>
          {preview.item.note && <p className="muted" style={{ marginBottom: 0 }}>{preview.item.note}</p>}
          {preview.item.balances.length > 0 && (
            <p className="muted" style={{ marginBottom: 0 }}>
              On hand:{' '}
              {preview.item.balances
                .map((b) => `${fmtNum(b.qty)} at ${b.location}`)
                .join(' · ')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The rolls on a fabric delivery.
 *
 * A fabric receipt is usually several rolls, each with its own number and its
 * own length. The quantities must add up to the receiving quantity - stock that
 * no roll accounts for is stock nobody can find - and that is checked here for
 * the sake of the person typing, and again on the server, which is what counts.
 */
function RollLines({ rolls, setRolls, uom, receivingQty, total, balanced, nextRollNo }) {
  const add = () => setRolls((r) => [...r, blankRoll()]);
  const remove = (key) => setRolls((r) => r.filter((x) => x.key !== key));
  const set = (key, field, value) =>
    setRolls((r) => r.map((x) => (x.key === key ? { ...x, [field]: value } : x)));

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <span>Rolls</span>
        <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
          {rolls.length === 0
            ? `Leave empty for a single roll — it will be numbered ${nextRollNo ?? 'automatically'}`
            : `${rolls.length} roll(s) · ${fmtNum(total)} of ${fmtNum(receivingQty || 0)} ${uom}`}
        </span>
      </div>
      <div className="card-body">
        {rolls.length > 0 && (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Roll No</th>
                  <th className="num">Qty ({uom})</th>
                  <th className="num">Width</th>
                  <th title="Shade band, if graded">Shade</th>
                  <th title="Dye lot from the mill's packing list">Dye lot</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rolls.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <TextInput
                        value={r.rollNo}
                        placeholder="auto"
                        onChange={(e) => set(r.key, 'rollNo', e.target.value)}
                      />
                    </td>
                    <td>
                      <TextInput
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={r.qty}
                        onChange={(e) => set(r.key, 'qty', e.target.value)}
                      />
                    </td>
                    <td>
                      <TextInput
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={r.width}
                        onChange={(e) => set(r.key, 'width', e.target.value)}
                      />
                    </td>
                    <td>
                      <TextInput
                        value={r.shade}
                        placeholder="-"
                        maxLength={20}
                        aria-label="Shade"
                        onChange={(e) => set(r.key, 'shade', e.target.value)}
                      />
                    </td>
                    <td>
                      <TextInput
                        value={r.dyeLot}
                        placeholder="-"
                        maxLength={40}
                        aria-label="Dye lot"
                        onChange={(e) => set(r.key, 'dyeLot', e.target.value)}
                      />
                    </td>
                    <td className="actions">
                      <button type="button" className="btn btn-sm" onClick={() => remove(r.key)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}

        {!balanced && (
          <Alert kind="error">
            The rolls add up to {fmtNum(total)} {uom}, but the receipt is for{' '}
            {fmtNum(receivingQty || 0)}. They have to match — stock that no roll accounts for is
            stock nobody can find.
          </Alert>
        )}

        <Field>
          <button type="button" className="btn" onClick={add} style={{ marginTop: 8 }}>
            Add a roll
          </button>
        </Field>
      </div>
    </div>
  );
}
