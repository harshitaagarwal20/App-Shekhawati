/**
 * Purchase Order create / edit form. Sheet: "PO".
 *
 * ---------------------------------------------------------------------------
 *  THE THREE NUMBERS ON THIS FORM ALL COME FROM THE SERVER
 *
 *    the amount            orderQty x rate
 *    the excess ceiling    1% for accessories, 3% otherwise - both CONFIGURED
 *                          rules, not constants, resolved per line
 *    the quantity ceiling  style requirement x order qty, plus excess, less
 *                          what other POs already claimed against this order
 *
 *  All three arrive from POST /purchase-orders/preview, debounced as the buyer
 *  types. This file multiplies nothing and compares nothing: the figures a user
 *  sees while deciding are the figures the server will store, because they are
 *  produced by the same code.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import {
  orders as ordersApi,
  purchaseOrders as poApi,
  quotations as quotationsApi,
  vendors as vendorsApi,
} from '../../services/erp.js';
import {
  FieldGroup,
  FormShell,
  RHFEnumSelect,
  RHFInput,
  RHFMasterSelect,
  RHFQty,
  RHFRecordSelect,
  RHFTextArea,
  useSubmit,
  useZodForm,
} from '../../components/form.jsx';
import { Alert, Spinner } from '../../components/ui.jsx';
import { fmtNum, todayInput, toDateInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';

/**
 * The client's mirror of the server schema.
 *
 * Deliberately smaller than the server's: this validates SHAPE - a quantity is
 * a positive number, a vendor was chosen - so the person typing hears about an
 * empty box without a round trip. It does not know what the style permits or
 * what the excess ceiling is, because those are business rules and business
 * rules live on the server.
 */
const schema = z.object({
  poId: z.string().trim().max(40).optional(),
  poDate: z.string().min(1, 'Date is required'),
  vendorId: z.string().uuid('Choose a vendor'),
  orderId: z.string().optional(),
  styleId: z.string().optional(),
  quotationId: z.string().optional(),
  orderMode: z.enum(['AS_PER_STYLE', 'BULK'], {
    required_error: 'Choose how this PO is bounded',
    invalid_type_error: 'Choose how this PO is bounded',
  }),
  item: z.string().min(1, 'Choose an item'),
  subCategory: z.string().optional(),
  accessoriesItem: z.string().optional(),
  accessoryType: z.string().max(120, 'At most 120 characters').optional(),
  uom: z.string().min(1, 'Choose a UOM'),
  orderQty: z.coerce.number().positive('Quantity must be greater than zero'),
  rate: z.coerce.number().min(0, 'Rate cannot be negative'),
  excessAllowedPct: z.coerce.number().min(0).max(99).optional(),
  hsnCode: z.string().trim().max(20).optional(),
  gsm: z.string().optional(),
  content: z.string().optional(),
  colorCode: z.string().optional(),
  address: z.string().trim().max(2000).optional(),
  remarks: z.string().trim().max(2000).optional(),
});

/**
 * C1. There is no pre-selected mode: the operator states it.
 *
 * The blank first option is deliberate. Defaulting the control to "as per
 * style" would look harmless - it is the stricter of the two - but it would
 * mean a bulk order could be saved as style-bounded by nobody touching the
 * field, and the server would then refuse a quantity the buyer actually wants.
 * The server refuses an unstated mode outright; this makes that visible here.
 */
const ORDER_MODES = [
  { value: '', label: 'Choose how this PO is bounded…' },
  { value: 'AS_PER_STYLE', label: 'As per style — capped by the BOM requirement' },
  { value: 'BULK', label: 'Bulk — deliberately not capped' },
];

/** Percent in the form, fraction on the wire. The server stores fractions. */
const pctToFraction = (pct) => (pct === '' || pct === undefined ? undefined : String(Number(pct) / 100));

export default function PurchaseOrderForm({ purchaseOrder, onSaved, onCancel }) {
  const isNew = !purchaseOrder;

  const form = useZodForm(schema, {
    poId: purchaseOrder?.poId ?? '',
    poDate: purchaseOrder ? toDateInput(purchaseOrder.poDate) : todayInput(),
    vendorId: purchaseOrder?.vendor?.id ?? purchaseOrder?.vendorId ?? '',
    orderId: purchaseOrder?.order?.id ?? purchaseOrder?.orderId ?? '',
    styleId: purchaseOrder?.style?.id ?? purchaseOrder?.styleId ?? '',
    quotationId: purchaseOrder?.quotation?.id ?? purchaseOrder?.quotationId ?? '',
    orderMode: purchaseOrder?.orderMode ?? '',
    item: purchaseOrder?.item ?? '',
    subCategory: purchaseOrder?.subCategory ?? '',
    accessoriesItem: purchaseOrder?.accessoriesItem ?? '',
    accessoryType: purchaseOrder?.accessoryType ?? '',
    uom: purchaseOrder?.uom ?? '',
    orderQty: purchaseOrder?.orderQty ?? '',
    rate: purchaseOrder?.rate ?? '',
    excessAllowedPct: purchaseOrder ? Number(purchaseOrder.excessAllowed) * 100 : 2,
    hsnCode: purchaseOrder?.hsnCode ?? '',
    gsm: purchaseOrder?.gsm ?? '',
    content: purchaseOrder?.content ?? '',
    colorCode: purchaseOrder?.colorCode ?? '',
    address: purchaseOrder?.address ?? '',
    remarks: purchaseOrder?.remarks ?? '',
  });

  const [vendorOptions, setVendorOptions] = useState(null);
  const [orderOptions, setOrderOptions] = useState(null);
  const [quotationOptions, setQuotationOptions] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  const vendorId = form.watch('vendorId');
  const orderId = form.watch('orderId');
  const item = form.watch('item');
  const subCategory = form.watch('subCategory');
  const accessoriesItem = form.watch('accessoriesItem');
  const uom = form.watch('uom');
  const orderQty = form.watch('orderQty');
  const rate = form.watch('rate');
  const excessAllowedPct = form.watch('excessAllowedPct');
  const orderMode = form.watch('orderMode');

  // Only APPROVED quotations may become a PO - that is what the authorisation
  // step is for - so the dropdown asks for approved ones only.
  useEffect(() => {
    if (!vendorId) {
      setQuotationOptions([]);
      return;
    }
    quotationsApi
      .options({ vendorId, orderId: orderId || undefined, approvedOnly: 'true' })
      .then(setQuotationOptions)
      .catch(loadFailed(setQuotationOptions, 'quotations'));
  }, [vendorId, orderId]);

  /**
   * Ask the SERVER for the amount and both ceilings. Debounced, because it
   * fires as somebody types a quantity.
   */
  const runPreview = useCallback(async () => {
    if (!item) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    try {
      setPreview(
        await poApi.preview({
          item,
          subCategory: subCategory || null,
          accessoriesItem: accessoriesItem || null,
          uom: uom || null,
          vendorId: vendorId || undefined,
          orderQty: orderQty === '' ? undefined : String(orderQty),
          rate: rate === '' ? undefined : String(rate),
          excessAllowed: pctToFraction(excessAllowedPct),
          orderMode: orderMode || undefined,
          orderId: orderId || null,
          excludeId: purchaseOrder?.id,
        }),
      );
    } catch {
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [
    item, subCategory, accessoriesItem, uom, vendorId, orderQty, rate,
    excessAllowedPct, orderMode, orderId, purchaseOrder?.id,
  ]);

  useEffect(() => {
    const id = setTimeout(runPreview, 350);
    return () => clearTimeout(id);
  }, [runPreview]);

  const { submit, busy, banner, setBanner } = useSubmit(
    form,
    (values) => {
      const payload = {
        poId: values.poId || undefined,
        poDate: values.poDate,
        vendorId: values.vendorId,
        orderId: values.orderId || null,
        styleId: values.styleId || null,
        quotationId: values.quotationId || null,
        orderMode: values.orderMode,
        item: values.item,
        subCategory: values.subCategory || null,
        accessoriesItem: values.accessoriesItem || null,
        accessoryType: values.accessoryType || null,
        uom: values.uom,
        orderQty: String(values.orderQty),
        rate: String(values.rate),
        excessAllowed: pctToFraction(values.excessAllowedPct) ?? '0',
        hsnCode: values.hsnCode || null,
        gsm: values.gsm || null,
        content: values.content || null,
        colorCode: values.colorCode || null,
        address: values.address || null,
        remarks: values.remarks || null,
        // `amount` is deliberately absent. The server computes qty x rate and
        // would strip it from this body anyway.
      };
      return isNew ? poApi.create(payload) : poApi.update(purchaseOrder.id, payload);
    },
    { onDone: (saved) => onSaved(saved, isNew) },
  );

  const isAccessory = item === 'Accessories' || Boolean(accessoriesItem);

  /*
   * A HIDDEN FIELD MUST NOT KEEP ITS VALUE.
   *
   * react-hook-form holds what was typed whether or not the control is on
   * screen, so choosing 320 GSM against a fabric and then switching the item
   * to Accessories submitted a zip carrying a GSM - a value the user could no
   * longer see, and one that goes on to form part of the stock item's identity
   * in itemIdentity(). Clearing on the switch keeps what is submitted equal to
   * what is shown.
   *
   * `item` alone is the trigger, not `isAccessory`: isAccessory is partly
   * derived FROM accessoriesItem, so clearing that field here would re-run the
   * effect on its own result.
   */
  useEffect(() => {
    if (!item) return;
    const accessory = item === 'Accessories';
    for (const [field, keepWhenAccessory] of [
      ['subCategory', false],
      ['gsm', false],
      ['content', false],
      ['accessoriesItem', true],
      ['accessoryType', true],
    ]) {
      if (accessory !== keepWhenAccessory && form.getValues(field)) {
        form.setValue(field, '', { shouldDirty: true });
      }
    }
  }, [item, form]);

  return (
    <FormShell
      onSubmit={submit}
      banner={banner}
      onDismissBanner={() => setBanner('')}
      busy={busy}
      submitLabel={isNew ? 'Raise purchase order' : 'Save changes'}
      busyLabel={isNew ? 'Raising...' : 'Saving...'}
      onCancel={onCancel}
      footerNote={
        preview?.nextPoId && isNew
          ? `Will be numbered ${preview.nextPoId} — the vendor's own series.`
          : undefined
      }
    >
      {!isNew && purchaseOrder.decided && (
        <Alert kind="warning">
          This PO was already {purchaseOrder.approvalStatus.toLowerCase()}. Reopen it before
          changing it, or raise a fresh one.
        </Alert>
      )}

      <div className="form-grid">
        <FieldGroup title="Purchase order">
          <RHFInput
            form={form}
            name="poId"
            label="PO ID"
            hint={isNew ? 'Left blank, the vendor series issues one (RF-001).' : undefined}
          />
          <RHFInput form={form} name="poDate" label="Date" type="date" required />

          <RHFRecordSelect
            form={form}
            name="vendorId"
            label="Vendor Name"
            required
            options={vendorOptions}
            loading={vendorOptions === null}
            getLabel={(v) => `${v.vendorName} (${v.vendorCode})`}
            placeholder="Select vendor..."
          />

          <RHFRecordSelect
            form={form}
            name="orderId"
            label="Order No"
            hint="The buyer order this PO procures for."
            options={orderOptions}
            loading={orderOptions === null}
            getLabel={(o) => `${o.orderNo} — ${o.style?.styleNo ?? ''}`}
            placeholder="No order reference"
          />

          <RHFRecordSelect
            form={form}
            name="quotationId"
            label="Quotation No"
            hint="Only approved quotations can become a purchase order."
            options={quotationOptions}
            getLabel={(q) => `${q.quotationNo} — ${q.item} @ ${fmtNum(q.rateQuoted, { decimals: 4 })}`}
            disabled={!vendorId}
            placeholder={vendorId ? 'No quotation reference' : 'Choose a vendor first'}
            noOptionsLabel={
              vendorId
                ? 'This vendor has no quotation on file'
                : 'Choose a vendor first - quotations belong to a vendor'
            }
          />

          <RHFEnumSelect
            form={form}
            name="orderMode"
            label="Order mode"
            required
            includeBlank={false}
            options={ORDER_MODES}
            hint="As per style caps the quantity at the BOM requirement plus the tolerance. Bulk is exempt — deliberately, and it is recorded as a choice."
          />
        </FieldGroup>

        <FieldGroup title="What is being bought">
          <RHFMasterSelect form={form} name="item" label="Item" listCode="ItemCategory" required />
          {/*
            The two halves of "what is it", and only one of them applies.
            Sub Category is a fabric weight; Accessories Item is a piece of
            trim. Asking for both on every order is what filled the detail
            screen with dashes - and the Accessories Item hint already claimed
            it appeared "when the item is an accessory", which it did not.
          */}
          {!isAccessory && (
            <RHFMasterSelect
              form={form}
              name="subCategory"
              label="Sub Category"
              listCode="FabricSubCat"
              hint="Fabric detail, e.g. 10 oz."
            />
          )}
          {isAccessory && (
            <RHFMasterSelect
              form={form}
              name="accessoriesItem"
              label="Accessories Item"
              listCode="AccessoriesItem"
            />
          )}
          {isAccessory && (
            <RHFInput
              form={form}
              name="accessoryType"
              label="Accessory Type"
              maxLength={120}
              hint="e.g. for a Button: 4-hole horn, 18L"
            />
          )}
          <RHFMasterSelect form={form} name="uom" label="UOM" listCode="UOM" required />
          <RHFQty form={form} name="orderQty" label="Order Qty" required uom={uom} />
          <RHFQty form={form} name="rate" label="Rate" required />
          <RHFInput
            form={form}
            name="excessAllowedPct"
            label="Excess Allowed (%)"
            type="number"
            step="any"
            min="0"
            hint={
              preview?.excess
                ? `Ceiling ${preview.excess.ceilingPct}% — ${preview.excess.rule}`
                : isAccessory
                  ? 'Accessories are held tighter than materials.'
                  : undefined
            }
          />
        </FieldGroup>

        <FieldGroup title="Specification">
          <RHFInput form={form} name="hsnCode" label="HSN Code" />
          {/* GSM and Content describe cloth. A zip has neither. */}
          {!isAccessory && (
            <>
              <RHFMasterSelect form={form} name="gsm" label="GSM" listCode="GSM" />
              <RHFMasterSelect form={form} name="content" label="Content" listCode="FabricContent" />
            </>
          )}
          <RHFMasterSelect form={form} name="colorCode" label="Color code" listCode="ColorCode" />
          <RHFTextArea
            form={form}
            name="address"
            label="Address"
            hint="Left blank, the vendor's current address is snapshotted onto the PO."
            className="span-2"
          />
          <RHFTextArea form={form} name="remarks" label="Remarks" className="span-2" />
        </FieldGroup>
      </div>

      <ServerFigures preview={preview} loading={previewing} uom={uom} />
    </FormShell>
  );
}

/**
 * The amount and both ceilings, exactly as the server computed them.
 *
 * Deliberately not inputs. There is nothing here for a user to type, because
 * there is nothing here the server would accept.
 */
function ServerFigures({ preview, loading, uom }) {
  if (loading && !preview) {
    return (
      <div style={{ marginTop: 16 }}>
        <Spinner label="Checking the amount and the ceilings..." />
      </div>
    );
  }
  if (!preview) return null;

  const { quantity, excess } = preview;

  return (
    <div style={{ marginTop: 18 }}>
      <div className="fieldset-title">
        Calculated <span className="faint">&mdash; by the server</span>
      </div>


      {!excess.withinCeiling && (
        <Alert kind="error">
          Excess allowed is {excess.allowedPct}%, above the {excess.ceilingPct}% ceiling.{' '}
          {excess.rule}
        </Alert>
      )}

      {/* The style ceiling. Bounded orders show the arithmetic; a bulk order
          shows why it is exempt rather than showing nothing. */}
      <div className={`card excess-panel ${quantity.bounded ? (quantity.withinCeiling ? 'excess-ok' : 'excess-bad') : 'excess-warn'}`} style={{ marginTop: 14 }}>
        <div className="card-header">
          <span>Quantity ceiling</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {quantity.orderMode === 'BULK' ? 'bulk order' : 'order as per style'}
          </span>
        </div>
        <div className="card-body">
          {!quantity.bounded ? (
            <p className="muted" style={{ marginBottom: 0 }}>{quantity.basis}</p>
          ) : (
            <>
              <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>{quantity.basis}</p>
              {!quantity.withinCeiling && (
                <Alert kind="error">
                  This exceeds what the order permits by {fmtNum(quantity.exceedsBy)}{' '}
                  {quantity.requirementUom}. Raise it as a bulk order if the quantity is deliberate.
                </Alert>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
