/**
 * Vendor Quotation create / edit form. Sheet: "Vendor Quotation-Approval".
 *
 * The Amount box is filled from POST /quotations/preview. This file never
 * multiplies a rate by a quantity - the amount is what the Director approves
 * and what a purchase order is later raised against, so exactly one piece of
 * code owns it, and that code runs on the server.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  orders as ordersApi,
  quotations as quotationsApi,
  vendors as vendorsApi,
} from '../../services/erp.js';
import {
  Alert,
  Field,
  MasterSelect,
  RecordSelect,
  Spinner,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import { loadFailed } from '../../services/loadFailures.js';
import { focusFirstError } from '../../components/form.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const asDateInput = (v) => (v ? String(v).slice(0, 10) : '');

export default function QuotationForm({ quotation, onSaved, onCancel }) {
  const isNew = !quotation;

  const [form, setForm] = useState(() =>
    isNew
      ? {
          quotationNo: '',
          quotationDate: today(),
          item: '',
          subCategory: '',
          accessoriesItem: '',
          accessoryType: '',
          vendorId: '',
          qty: '',
          uom: '',
          rateQuoted: '',
          orderId: '',
          remarks: '',
        }
      : {
          quotationNo: quotation.quotationNo,
          quotationDate: asDateInput(quotation.quotationDate),
          item: quotation.item ?? '',
          subCategory: quotation.subCategory ?? '',
          accessoriesItem: quotation.accessoriesItem ?? '',
          accessoryType: quotation.accessoryType ?? '',
          vendorId: quotation.vendor?.id ?? quotation.vendorId,
          qty: String(quotation.qty ?? ''),
          uom: quotation.uom ?? '',
          rateQuoted: String(quotation.rateQuoted ?? ''),
          orderId: quotation.order?.id ?? quotation.orderId ?? '',
          remarks: quotation.remarks ?? '',
        },
  );

  const [vendorOptions, setVendorOptions] = useState(null);
  const [orderOptions, setOrderOptions] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [serverError, setServerError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  // Ask the SERVER for the amount. Debounced, because it fires as the buyer
  // types a quantity or a rate.
  const runPreview = useCallback(async () => {
    if (!(Number(form.qty) > 0) || form.rateQuoted === '' || !Number.isFinite(Number(form.rateQuoted))) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    try {
      setPreview(
        await quotationsApi.preview({ qty: String(form.qty), rateQuoted: String(form.rateQuoted) }),
      );
    } catch {
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [form.qty, form.rateQuoted]);

  useEffect(() => {
    const id = setTimeout(runPreview, 350);
    return () => clearTimeout(id);
  }, [runPreview]);

  async function submit(e) {
    e.preventDefault();
    setServerError('');
    setFieldErrors({});

    const missing = {};
    if (!form.vendorId) missing.vendorId = 'Select a vendor';
    if (!form.item) missing.item = 'Select an item';
    if (!form.uom) missing.uom = 'Select a UOM';
    if (!(Number(form.qty) > 0)) missing.qty = 'Quantity must be greater than zero';
    if (form.rateQuoted === '' || Number(form.rateQuoted) < 0) missing.rateQuoted = 'Enter a rate';
    if (Object.keys(missing).length) {
      setFieldErrors(missing);
      return;
    }

    const payload = {
      quotationNo: form.quotationNo || undefined,
      quotationDate: form.quotationDate,
      item: form.item,
      subCategory: form.subCategory || null,
      accessoriesItem: form.accessoriesItem || null,
      accessoryType: form.accessoryType || null,
      vendorId: form.vendorId,
      qty: String(form.qty),
      uom: form.uom,
      rateQuoted: String(form.rateQuoted),
      orderId: form.orderId || null,
      /*
       * `authorisedBy` IS NOT SENT, AND IS NOT MISSING.
       *
       * It used to be a dropdown on this form - "who the quotation is being
       * put in front of" - typed by whoever raised the quotation, before any
       * decision existed. That is a guess about the future recorded as if it
       * were a fact, and it sat in the same column the real answer goes into.
       *
       * The server already does the right thing on approve and reject:
       *
       *     authorisedBy: quotation.authorisedBy ?? actor.fullName
       *
       * so with nothing pre-filled here, the column ends up holding the person
       * who ACTUALLY authorised it. Authorisation is the Director's act, not a
       * box the raiser fills in - and the detail screen, the list and the
       * printed quotation all read the same column as before.
       */
      remarks: form.remarks || null,
      // `amount` is deliberately absent. The server computes qty x rate and
      // would strip it from this body anyway.
    };

    setSaving(true);
    try {
      const saved = isNew
        ? await quotationsApi.create(payload)
        : await quotationsApi.update(quotation.id, payload);
      onSaved(saved, isNew);
    } catch (err) {
      if (err.fieldErrors) setFieldErrors(err.fieldErrors);
      setServerError(err.message);
      // Not a react-hook-form, so there is no setFocus to try - the DOM lookup
      // inside focusFirstError is the whole mechanism here.
      focusFirstError({}, Object.keys(err.fieldErrors ?? {}));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="modal-body">
        <Alert kind="error">{serverError}</Alert>

        {!isNew && quotation.decided && (
          <Alert kind="warning">
            This quotation was already {quotation.authorisationStatus.toLowerCase()} and cannot be
            edited. Raise a fresh quotation instead.
          </Alert>
        )}

        <div className="form-grid">
          <div className="fieldset-title">Quotation</div>

          <Field
            label="Quotation No"
            error={fieldErrors.quotationNo}
            hint={isNew ? 'Left blank, the system issues one (QT-001).' : undefined}
            htmlFor="q-no"
          >
            <TextInput id="q-no" value={form.quotationNo} onChange={set('quotationNo')} />
          </Field>

          <Field label="Date" required error={fieldErrors.quotationDate} htmlFor="q-date">
            <TextInput id="q-date" type="date" value={form.quotationDate} onChange={set('quotationDate')} />
          </Field>

          <Field label="Vendor Name" required error={fieldErrors.vendorId} htmlFor="q-vendor">
            <RecordSelect
              id="q-vendor"
              options={vendorOptions ?? []}
              loading={vendorOptions === null}
              getValue={(v) => v.id}
              getLabel={(v) => `${v.vendorName} (${v.vendorCode})`}
              placeholder="Select vendor..."
              value={form.vendorId}
              onChange={set('vendorId')}
            />
          </Field>

          <Field
            label="Order No"
            error={fieldErrors.orderId}
            hint="The buyer order this quotation is for."
            htmlFor="q-order"
          >
            <RecordSelect
              id="q-order"
              options={orderOptions ?? []}
              loading={orderOptions === null}
              getValue={(o) => o.id}
              getLabel={(o) => `${o.orderNo} - ${o.style?.styleNo ?? ''}`}
              placeholder="No order reference"
              value={form.orderId}
              onChange={set('orderId')}
            />
          </Field>

          <div className="fieldset-title">What is being quoted</div>

          <Field label="Item" required error={fieldErrors.item} htmlFor="q-item">
            <MasterSelect
              id="q-item"
              listCode="ItemCategory"
              currentValue={form.item}
              value={form.item}
              onChange={set('item')}
            />
          </Field>

          <Field
            label="Sub Category"
            error={fieldErrors.subCategory}
            hint="Fabric detail, e.g. 10 oz."
            htmlFor="q-sub"
          >
            <MasterSelect
              id="q-sub"
              listCode="FabricSubCat"
              currentValue={form.subCategory}
              value={form.subCategory}
              onChange={set('subCategory')}
            />
          </Field>

          <Field
            label="Accessories Item"
            error={fieldErrors.accessoriesItem}
            hint="Accessory detail, e.g. Zipper."
            htmlFor="q-acc"
          >
            <MasterSelect
              id="q-acc"
              listCode="AccessoriesItem"
              currentValue={form.accessoriesItem}
              value={form.accessoriesItem}
              onChange={set('accessoriesItem')}
            />
          </Field>

          <Field
            label="Accessory Type"
            error={fieldErrors.accessoryType}
            hint="e.g. for a Button: 4-hole horn, 18L"
            htmlFor="q-acc-type"
          >
            <TextInput id="q-acc-type" maxLength={120} value={form.accessoryType} onChange={set('accessoryType')} />
          </Field>

          <Field label="UOM" required error={fieldErrors.uom} htmlFor="q-uom">
            <MasterSelect
              id="q-uom"
              listCode="UOM"
              currentValue={form.uom}
              value={form.uom}
              onChange={set('uom')}
            />
          </Field>

          <Field label="Qty" required error={fieldErrors.qty} htmlFor="q-qty">
            <TextInput id="q-qty" type="number" min="0" step="any" value={form.qty} onChange={set('qty')} />
          </Field>

          <Field label="Rate Quoted" required error={fieldErrors.rateQuoted} htmlFor="q-rate">
            <TextInput
              id="q-rate"
              type="number"
              min="0"
              step="any"
              value={form.rateQuoted}
              onChange={set('rateQuoted')}
            />
          </Field>

          <Field label="Remarks" className="span-2" htmlFor="q-remarks">
            <TextArea id="q-remarks" rows={2} value={form.remarks} onChange={set('remarks')} />
          </Field>
        </div>

        <AmountPanel preview={preview} loading={previewing} uom={form.uom} />
      </div>

      <div className="modal-footer">
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving...' : isNew ? 'Raise quotation' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

/**
 * The amount, exactly as the server computed it. Deliberately not a controlled
 * input: there is nothing for a user to type here, because there is nothing the
 * server would accept.
 */
function AmountPanel({ preview, loading, uom }) {
  if (loading && !preview) {
    return (
      <div style={{ marginTop: 16 }}>
        <Spinner label="Calculating amount..." />
      </div>
    );
  }
  if (!preview) return null;

  return (
    <div style={{ marginTop: 18 }}>
      <div className="fieldset-title">
        Amount <span className="faint">&mdash; calculated by the server</span>
      </div>
    </div>
  );
}
