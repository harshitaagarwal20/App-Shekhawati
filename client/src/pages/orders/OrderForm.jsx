/**
 * Buyer Order create / edit form. Sheet: "Order" - Order Format.
 *
 * Nothing on this screen multiplies a quantity. Every derived figure - the
 * requirement, the effective quantity, the ceiling - is the server's, because
 * a figure the browser worked out is a figure a user can tamper with.
 *
 * IT NO LONGER PREVIEWS THE MATERIAL REQUIREMENT. A live BOM table used to sit
 * under the fields, refreshed from POST /orders/preview 400ms after every
 * keystroke in the quantity box. On a style with no BOM - which is most of
 * them at the point an order is first taken - it showed a full table header
 * over a single line saying there was nothing to show, so the commonest case
 * was a block of furniture around an apology. The requirement is still on the
 * order's own detail screen once the order exists, computed from the same
 * endpoint, where there is a saved order to compute it for.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { buyers as buyersApi, orders as ordersApi, styles as stylesApi } from '../../services/erp.js';
import {
  Alert,
  EnumSelect,
  Field,
  MasterSelect,
  RecordSelect,
  TextArea,
  SuffixInput,
  TextInput,
} from '../../components/ui.jsx';
import { loadFailed } from '../../services/loadFailures.js';
import { focusFirstError } from '../../components/form.jsx';
import ColourwayGrid, {
  blankGrid,
  gridFromLines,
  gridProblem,
  gridTotal,
  linesFromGrid,
} from './ColourwayGrid.jsx';

const optional = (max) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

/**
 * The excess the office grants without asking, as a PERCENTAGE (the server
 * holds the same number as the fraction 0.02). Above this the excess goes to
 * the Director and the ceiling does not move until they sign.
 */
const AUTO_APPROVED_PCT = 2;

const schema = z
  .object({
    orderNo: optional(40),
    orderDate: z.string().trim().min(1, 'Order date is required'),
    buyerId: z.string().uuid('Select a buyer'),
    styleId: z.string().uuid('Select a style'),
    itemDescription: optional(200),
    orderQty: z
      .string()
      .trim()
      .min(1, 'Order quantity is required')
      .refine((v) => Number(v) > 0, 'Order quantity must be greater than zero'),
    colorCode: optional(60),
    sizeGroup: optional(40),
    currency: optional(10),
    shipMode: optional(40),
    containerNo: optional(40),
    billTo: optional(1000),
    shipTo: optional(1000),
    buyerDeliveryDate: optional(40),
    buyerPoNo: optional(60),
    buyerPoDate: optional(40),
    exFactoryDate: optional(40),
    priceTerms: optional(150),
    paymentTerms: optional(150),
    unitPrice: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || (Number.isFinite(Number(v)) && Number(v) >= 0), 'Price must be zero or more'),
    exchangeRate: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || (Number.isFinite(Number(v)) && Number(v) > 0), 'Rate must be greater than zero'),
    excessPctInput: z
      .string()
      .trim()
      .optional()
      .refine(
        (v) => !v || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 100),
        'Excess must be between 0 and 100 percent',
      ),
    excessJustification: optional(2000),
    remarks: optional(2000),
  })
  /*
   * Only an excess that needs a DECISION needs a case made for it. Up to and
   * including AUTO_APPROVED_PCT the excess is granted on entry - see
   * excessOnEntry() in buyerOrder.service.js, which is the authority - so
   * demanding a justification here would be asking the merchandiser to argue
   * a point nobody is going to read. Kept in step with the server by hand:
   * the server refuses either way, this only decides when to ask.
   */
  .refine((d) => Number(d.excessPctInput || 0) <= AUTO_APPROVED_PCT || Boolean(d.excessJustification), {
    message: `A justification is required for an excess above ${AUTO_APPROVED_PCT}%`,
    path: ['excessJustification'],
  })
  // The same rule the server holds: goods leave the factory before they are due.
  .refine((d) => !d.exFactoryDate || !d.buyerDeliveryDate || d.exFactoryDate <= d.buyerDeliveryDate, {
    message: 'Ex-factory must be on or before the buyer delivery date',
    path: ['exFactoryDate'],
  });

const today = () => new Date().toISOString().slice(0, 10);
const asDateInput = (v) => (v ? String(v).slice(0, 10) : '');

/** The form takes a human percentage (2); the API takes a fraction (0.02). */
const toFraction = (pct) => (pct ? String(Number(pct) / 100) : '0');
const toPercent = (fraction) =>
  fraction === undefined || fraction === null ? '' : String(Number(fraction) * 100);

export default function OrderForm({ order, onSaved, onCancel }) {
  const isNew = !order;
  // A price on this form means ONE line. An order holding several styles is
  // priced line by line from its detail screen.
  const multiLine = !isNew && (order.lines?.length ?? 0) > 1;
  /*
   * The colourway grid. An existing order opens in it when its lines are all
   * one style - which is exactly the shape the grid saves. An order holding
   * several styles is not a matrix of one style and stays line-by-line.
   */
  const existingGrid = isNew ? null : gridFromLines(order.lines);
  const gridEligible = isNew || existingGrid !== null;
  const [gridMode, setGridMode] = useState(!isNew && multiLine && existingGrid !== null);
  const [grid, setGrid] = useState(existingGrid);
  const [serverError, setServerError] = useState('');
  const [buyerOptions, setBuyerOptions] = useState(null);
  const [styleOptions, setStyleOptions] = useState(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: isNew
      ? { orderDate: today(), orderQty: '', excessPctInput: '' }
      : {
          orderNo: order.orderNo,
          orderDate: asDateInput(order.orderDate),
          buyerId: order.buyer?.id ?? order.buyerId,
          styleId: order.style?.id ?? order.styleId,
          itemDescription: order.itemDescription ?? '',
          orderQty: String(order.orderQty ?? ''),
          colorCode: order.colorCode ?? '',
          sizeGroup: order.sizeGroup ?? '',
          currency: order.currency ?? '',
          shipMode: order.shipMode ?? '',
          containerNo: order.containerNo ?? '',
          billTo: order.billTo ?? '',
          shipTo: order.shipTo ?? '',
          buyerDeliveryDate: asDateInput(order.buyerDeliveryDate),
          buyerPoNo: order.buyerPoNo ?? '',
          buyerPoDate: asDateInput(order.buyerPoDate),
          exFactoryDate: asDateInput(order.exFactoryDate),
          priceTerms: order.priceTerms ?? '',
          paymentTerms: order.paymentTerms ?? '',
          unitPrice: order.lines?.length === 1 && order.lines[0].unitPrice != null ? String(Number(order.lines[0].unitPrice)) : '',
          exchangeRate: order.exchangeRate != null ? String(Number(order.exchangeRate)) : '',
          excessPctInput: toPercent(order.excessPct),
          excessJustification: order.excessJustification ?? '',
          remarks: order.remarks ?? '',
        },
  });

  const buyerId = watch('buyerId');
  const styleId = watch('styleId');
  const excessPctInput = watch('excessPctInput');

  useEffect(() => {
    buyersApi.options().then(setBuyerOptions).catch(loadFailed(setBuyerOptions, 'buyers'));
  }, []);

  // Styles are buyer-specific, so the style list follows the buyer.
  useEffect(() => {
    if (!buyerId) {
      setStyleOptions([]);
      return;
    }
    setStyleOptions(null);
    stylesApi
      .options({ buyerId })
      .then(setStyleOptions)
      .catch(loadFailed(setStyleOptions, 'styles'));
  }, [buyerId]);

  // Defaults that the workbook marks "Auto": Bill To from the buyer, and
  // currency / ship mode from the buyer's standing terms.
  const buyerRef = useRef(null);
  useEffect(() => {
    if (!buyerId || !buyerOptions) return;
    const buyer = buyerOptions.find((b) => b.id === buyerId);
    if (!buyer || buyerRef.current === buyerId) return;
    const first = buyerRef.current === null;
    buyerRef.current = buyerId;
    if (isNew || !first) {
      setValue('billTo', [buyer.buyerName, buyer.address].filter(Boolean).join(', '));
      if (buyer.currency) setValue('currency', buyer.currency);
      if (buyer.shipMode) setValue('shipMode', buyer.shipMode);
      if (buyer.priceTerms) setValue('priceTerms', buyer.priceTerms);
      if (buyer.paymentTerms) setValue('paymentTerms', buyer.paymentTerms);
    }
  }, [buyerId, buyerOptions, isNew, setValue]);

  /*
   * THE SAME "Auto" RULE, APPLIED TO THE STYLE - WITH ONE IMPORTANT LIMIT.
   *
   * ---------------------------------------------------------------------------
   *  THREE FIELDS THE SYSTEM ALREADY KNEW AND ASKED FOR ANYWAY
   *
   *  Picking a style used to leave Item Description, Colour and Size Group
   *  blank, and somebody typed all three from the same sheet the style was
   *  registered from. The style carries every one of them - the colourway most
   *  of all, because the buyer NUMBERS a colourway as its own style
   *  (TP-0007-008 is the Natural pouch, TP-0007-009 the Black one).
   *
   * ---------------------------------------------------------------------------
   *  BUT AN ORDER MAY DIFFER FROM THE MASTER, AND THAT IS NOT AN ERROR
   *
   *  A buyer can order a registered style in a colour the master does not
   *  carry, in a different size group, described in their own words for that
   *  season. The order is the document that was actually placed; the style is
   *  the standing specification. Where they disagree, the ORDER is right.
   *
   *  That makes a pre-filled value dangerous in a way a blank one never was.
   *  Blank had to be answered. Pre-filled can be walked past - and an order
   *  that quietly carries the master's colour instead of the one the buyer
   *  asked for is how the wrong cloth gets bought, which is the exact failure
   *  the colour column was added to prevent.
   *
   *  So the fill is deliberately timid:
   *
   *    1. IT NEVER OVERWRITES A VALUE SOMEBODY TYPED. `filledRef` remembers
   *       what this effect last wrote. If the box still holds that, it was
   *       ours and may be replaced; if it holds anything else, a person put it
   *       there and it stands - including when they then change the style.
   *
   *    2. A DIFFERENCE IS STATED ON SCREEN rather than left to be noticed.
   *       Where the order's colour or size group is not the style's, the field
   *       says so underneath (see `differsFromStyle` below). A deliberate
   *       difference reads as deliberate; an accidental one is caught by the
   *       person who made it, at the moment they made it.
   *
   *    3. AN EXISTING ORDER IS NEVER TOUCHED ON OPEN. Its own values win; only
   *       actually changing the style re-fills anything.
   * ---------------------------------------------------------------------------
   */
  const styleRef = useRef(null);
  const filledRef = useRef({});
  useEffect(() => {
    if (!styleId || !styleOptions) return;
    const style = styleOptions.find((s) => s.id === styleId);
    if (!style || styleRef.current === styleId) return;
    const first = styleRef.current === null;
    styleRef.current = styleId;

    // Opening an existing order: the record's values are the order's own.
    if (!isNew && first) {
      filledRef.current = {};
      return;
    }

    for (const [field, value] of [
      ['itemDescription', style.styleDescription],
      ['colorCode', style.colorCode],
      ['sizeGroup', style.sizeGroup],
    ]) {
      if (!value) continue;
      const current = getValues(field);
      // Empty, or still exactly what we last put there. Anything else is a
      // person's answer and is left alone.
      const ours = !current || current === filledRef.current[field];
      if (!ours) continue;
      setValue(field, value, { shouldDirty: !first });
      filledRef.current[field] = value;
    }
  }, [styleId, styleOptions, isNew, setValue, getValues]);

  /**
   * Where this order departs from the style master, said out loud.
   *
   * Not a validation error - the order is allowed to differ and is the
   * document that counts. It is a note under the field so that a difference is
   * a decision somebody can see they made.
   */
  const selectedStyle = (styleOptions ?? []).find((s) => s.id === styleId);
  const differsFromStyle = (field, value) => {
    const master = selectedStyle?.[field];
    if (!master || !value || master === value) return undefined;
    return `The style master says ${master}. This order will be placed as ${value}.`;
  };

  /*
   * THE ADDRESSES THIS BUYER IS KNOWN TO SHIP TO.
   *
   * A buyer keeps three in the master - its own, the consignee's and the
   * notify party's - and they are different places. Ship To was free text with
   * the consignee pre-filled, so shipping to either of the other two meant
   * retyping an address from memory, which is how a container goes to last
   * season's warehouse.
   *
   * Offered as a list with the labels the buyer master uses, plus whatever the
   * order already holds if it matches none of them - an order shipped somewhere
   * one-off keeps its address rather than being silently re-pointed.
   */
  const shipToOptions = useMemo(() => {
    const buyer = (buyerOptions ?? []).find((b) => b.id === buyerId);
    if (!buyer) return [];
    /*
     * THE ADDRESS THAT GOES ON THE ORDER NAMES WHO IT IS GOING TO.
     *
     * Consignee and Notify party used to contribute their ADDRESS ALONE, while
     * the buyer's own option contributed "name, address" - so picking the
     * consignee dropped the consignee's name out of Ship To entirely, and the
     * order shipped to a street with nobody on it. Bill To has always been
     * built as "name, address" (see the buyer effect above); Ship To is the
     * same kind of thing and is now built the same way.
     *
     * Blank parts fall out, so a buyer holding an address but no consignee
     * name still produces a usable line rather than ", 12 Harbour Road".
     */
    const line = (...parts) => parts.filter(Boolean).join(', ');

    const found = [
      {
        label: buyer.consigneeName ? `Consignee - ${buyer.consigneeName}` : 'Consignee',
        value: line(buyer.consigneeName, buyer.consigneeAddress),
      },
      {
        label: buyer.notifyPartyName ? `Notify party - ${buyer.notifyPartyName}` : 'Notify party',
        value: line(buyer.notifyPartyName, buyer.notifyPartyAddress),
      },
      { label: `Buyer - ${buyer.buyerName}`, value: line(buyer.buyerName, buyer.address) },
      /*
       * THE BUYER'S ADDRESS BOOK - everywhere else it has goods sent.
       *
       * The three above are roles on the shipping paperwork, and for a long
       * time they were the only three a buyer could hold. Any other
       * destination had to be typed onto each order and was remembered by
       * nothing: Trade Word's orders went twice to "Trade Word DC, New
       * Jersey", which the picker could not offer either time.
       *
       * The buyer's own label leads, because "DC New Jersey" is what somebody
       * asks for; the role headings above read the same way.
       */
      ...(buyer.addresses ?? []).map((a) => ({
        label: a.label,
        value: line(a.name, a.address),
      })),
    ].filter((o) => o.value);

    /*
     * Two of them are often the same place - a buyer that consigns to itself,
     * most commonly, or a book entry repeating the consignee. Offering the
     * identical line twice under different headings makes the picker look
     * broken and gives the combobox two options that cannot be told apart once
     * chosen. The first heading wins, so the named roles keep their wording.
     */
    const seen = new Set();
    const unique = found.filter((o) => !seen.has(o.value) && seen.add(o.value));

    const current = watch('shipTo');
    if (current && !unique.some((o) => o.value === current)) {
      unique.push({ label: 'On this order', value: current });
    }
    return unique;
  }, [buyerOptions, buyerId, watch]);

  async function onSubmit(values) {
    setServerError('');
    if (gridMode) {
      const problem = gridProblem(grid);
      if (problem) {
        setServerError(problem);
        return;
      }
    }
    const payload = {
      orderNo: values.orderNo,
      orderDate: values.orderDate,
      buyerId: values.buyerId,
      styleId: values.styleId,
      itemDescription: values.itemDescription,
      orderQty: values.orderQty,
      colorCode: values.colorCode,
      sizeGroup: values.sizeGroup,
      currency: values.currency,
      shipMode: values.shipMode,
      containerNo: values.containerNo,
      billTo: values.billTo,
      shipTo: values.shipTo,
      buyerDeliveryDate: values.buyerDeliveryDate || null,
      buyerPoNo: values.buyerPoNo ?? '',
      buyerPoDate: values.buyerPoDate || null,
      exFactoryDate: values.exFactoryDate || null,
      priceTerms: values.priceTerms ?? '',
      paymentTerms: values.paymentTerms ?? '',
      exchangeRate: values.exchangeRate ? values.exchangeRate : null,
      // The value is the server's: only the price per piece is sent.
      ...(multiLine ? {} : { unitPrice: values.unitPrice ? values.unitPrice : null }),
      // Only the requested excess is sent. effectiveQty and the approved
      // percentage are the server's to decide.
      excessPct: toFraction(values.excessPctInput),
      excessJustification: values.excessJustification,
      remarks: values.remarks,
    };

    // In the grid, every filled cell is a line and the header is the server's
    // to derive: the single-line quantity, colour, size and price are not sent.
    if (gridMode) {
      payload.lines = linesFromGrid(grid, values.styleId);
      delete payload.orderQty;
      delete payload.colorCode;
      delete payload.sizeGroup;
      delete payload.unitPrice;
    }

    try {
      const saved = isNew ? await ordersApi.create(payload) : await ordersApi.update(order.id, payload);
      onSaved(saved, isNew);
    } catch (e) {
      const fields = e.fieldErrors;
      const marked = [];
      if (fields) {
        for (const [name, message] of Object.entries(fields)) {
          // The server knows this figure as a fraction called `excessPct`; the
          // form asks for it as a percentage in `excessPctInput`. The refusal
          // has to land on the box the user actually typed in.
          const onForm = name === 'excessPct' ? 'excessPctInput' : name;
          setError(onForm, { type: 'server', message });
          marked.push(onForm);
        }
      }
      setServerError(e.message);
      focusFirstError({ setFocus }, marked);
    }
  }

  const excessRequested = Number(excessPctInput) > 0;

  // Shown, never sent: the server derives the stored value the same way.
  const currency = watch('currency');
  const isInr = String(currency ?? '').toUpperCase() === 'INR';
  const qtyNow = Number(watch('orderQty'));
  const priceNow = Number(watch('unitPrice'));
  const valuePreview =
    !multiLine && watch('unitPrice') && qtyNow > 0 && Number.isFinite(priceNow)
      ? (qtyNow * priceNow).toLocaleString('en-IN', { maximumFractionDigits: 2 })
      : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="modal-body">
        <Alert kind="error">{serverError}</Alert>

        {!isNew && order.excessApprovalStatus === 'APPROVED' && (
          <Alert kind="warning">
            The excess on this order is approved. Changing the quantity or the excess sends it back
            to the Director for a fresh decision.
          </Alert>
        )}

        <div className="form-grid">
          <div className="fieldset-title">Order</div>

          <Field
            label="Order No"
            error={errors.orderNo?.message}
            hint={isNew ? 'The buyer PO number. Left blank, the system issues one.' : undefined}
            htmlFor="orderNo"
          >
            <TextInput id="orderNo" error={errors.orderNo} {...register('orderNo')} />
          </Field>

          <Field label="Order Date" required error={errors.orderDate?.message} htmlFor="orderDate">
            <TextInput id="orderDate" type="date" error={errors.orderDate} {...register('orderDate')} />
          </Field>

          <Field label="Buyer" required error={errors.buyerId?.message} htmlFor="buyerId">
            <RecordSelect
              id="buyerId"
              options={buyerOptions ?? []}
              loading={buyerOptions === null}
              getValue={(b) => b.id}
              getLabel={(b) => `${b.buyerName} (${b.buyerCode})`}
              placeholder="Select buyer..."
              error={errors.buyerId}
              value={buyerId ?? ''}
              {...register('buyerId')}
            />
          </Field>

          <Field
            label="Style No"
            required
            error={errors.styleId?.message}
            hint={buyerId ? undefined : 'Pick a buyer first - styles belong to a buyer.'}
            htmlFor="styleId"
          >
            <RecordSelect
              id="styleId"
              options={styleOptions ?? []}
              loading={Boolean(buyerId) && styleOptions === null}
              disabled={!buyerId}
              getValue={(s) => s.id}
              getLabel={(s) => `${s.styleNo} - ${s.styleDescription}`}
              placeholder={buyerId ? 'Select style...' : 'Select a buyer first'}
              error={errors.styleId}
              value={styleId ?? ''}
              {...register('styleId')}
            />
          </Field>

          <Field
            label="Item Description"
            error={errors.itemDescription?.message}
            hint="Defaults to the style description."
            className="span-2"
            htmlFor="itemDescription"
          >
            <TextInput id="itemDescription" {...register('itemDescription')} />
          </Field>

          {gridEligible && (
            <div className="span-2 row" style={{ gap: 8, alignItems: 'center' }}>
              <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={gridMode}
                  disabled={!styleId}
                  onChange={(e) => {
                    const on = e.target.checked;
                    if (on && !grid) {
                      const style = (styleOptions ?? []).find((s) => s.id === styleId);
                      const start = blankGrid(style);
                      // Carry what the single-line fields already say into the first cell.
                      const colour = getValues('colorCode');
                      const qty = getValues('orderQty');
                      if (colour) start.rows[0].colorCode = colour;
                      if (qty) start.rows[0].qty[start.sizes[0]] = qty;
                      setGrid(start);
                    }
                    setGridMode(on);
                  }}
                />
                Enter as a colourway grid
              </label>
              <span className="hint">
                {styleId
                  ? 'One style in several colours and sizes - each filled cell becomes an order line.'
                  : 'Pick a style first.'}
              </span>
            </div>
          )}

          {gridMode && grid ? (
            <>
              <ColourwayGrid
                grid={grid}
                onChange={(next) => {
                  setGrid(next);
                  // The header total is the server's; this only keeps the
                  // form's own required-quantity check satisfied.
                  setValue('orderQty', String(gridTotal(next) || ''), { shouldValidate: false });
                }}
                currency={watch('currency')}
              />
              <input type="hidden" {...register('orderQty')} />
            </>
          ) : (
            <>
              <Field label="Order Qty" required error={errors.orderQty?.message} hint="Finished pieces." htmlFor="orderQty">
                <TextInput id="orderQty" type="number" min="1" step="1" error={errors.orderQty} {...register('orderQty')} />
              </Field>

              <Field
                label="Color Code"
                error={errors.colorCode?.message}
                hint={differsFromStyle('colorCode', watch('colorCode'))}
                htmlFor="colorCode"
              >
                <MasterSelect id="colorCode" listCode="ColorCode" currentValue={watch('colorCode')} value={watch('colorCode') ?? ''} {...register('colorCode')} />
              </Field>

              <Field
                label="Size Group"
                error={errors.sizeGroup?.message}
                hint={differsFromStyle('sizeGroup', watch('sizeGroup'))}
                htmlFor="sizeGroup"
              >
                <MasterSelect id="sizeGroup" listCode="SizeGroup" currentValue={watch('sizeGroup')} value={watch('sizeGroup') ?? ''} {...register('sizeGroup')} />
              </Field>
            </>
          )}

          <div className="fieldset-title">Shipping</div>

          <Field label="Currency" error={errors.currency?.message} htmlFor="currency">
            <MasterSelect id="currency" listCode="Currency" currentValue={watch('currency')} value={watch('currency') ?? ''} {...register('currency')} />
          </Field>

          <Field label="Ship Mode" error={errors.shipMode?.message} htmlFor="shipMode">
            <MasterSelect id="shipMode" listCode="ShipMode" currentValue={watch('shipMode')} value={watch('shipMode') ?? ''} {...register('shipMode')} />
          </Field>

          {/*
            A CONTAINER NUMBER IS TYPED, NOT CHOSEN FROM A LIST.

            The same box, with the same wording, as the Planning form - and for
            the same reason: a container belongs to one shipment and is never
            used again, so a master list of them could only grow into dead
            entries with the one needed today missing. Recorded here so the
            number is booked once, on the order, instead of first appearing at
            Planning where somebody retypes it from an email.
          */}
          <Field
            label="Container No"
            error={errors.containerNo?.message}
            htmlFor="containerNo"
            hint="As printed on the container. Leave blank until it is booked."
          >
            <TextInput id="containerNo" placeholder="e.g. MSKU7654321" {...register('containerNo')} />
          </Field>

          <Field label="Buyer Delivery Date" error={errors.buyerDeliveryDate?.message} htmlFor="deliveryDate">
            <TextInput id="deliveryDate" type="date" {...register('buyerDeliveryDate')} />
          </Field>

          <Field label="Bill To" hint="Defaults from the Buyer Master." className="span-2" htmlFor="billTo">
            <TextArea id="billTo" rows={2} {...register('billTo')} />
          </Field>

          <Field
            label="Ship To"
            className="span-2"
            htmlFor="shipTo"
            hint={
              buyerId
                ? "Pick one of this buyer's addresses, or type another below."
                : 'Pick a buyer to see its addresses.'
            }
          >
            {shipToOptions.length > 0 && (
              <EnumSelect
                id="shipTo-pick"
                placeholder="Choose a known address..."
                options={shipToOptions}
                value={shipToOptions.some((o) => o.value === watch('shipTo')) ? watch('shipTo') : ''}
                onChange={(e) => setValue('shipTo', e.target.value, { shouldDirty: true })}
                style={{ marginBottom: 6 }}
              />
            )}
            {/* Still editable: a one-off destination is a real thing, and the
                picker is a shortcut rather than a restriction. */}
            <TextArea id="shipTo" rows={2} {...register('shipTo')} />
          </Field>

          <div className="fieldset-title">Commercial</div>

          <Field
            label="Buyer PO No"
            error={errors.buyerPoNo?.message}
            hint="The buyer's own PO number, as their paperwork quotes it."
            htmlFor="buyerPoNo"
          >
            <TextInput id="buyerPoNo" {...register('buyerPoNo')} />
          </Field>

          <Field label="Buyer PO Date" error={errors.buyerPoDate?.message} htmlFor="buyerPoDate">
            <TextInput id="buyerPoDate" type="date" {...register('buyerPoDate')} />
          </Field>

          <Field
            label="Ex-Factory Date"
            error={errors.exFactoryDate?.message}
            hint="When the goods must leave the factory."
            htmlFor="exFactoryDate"
          >
            <TextInput id="exFactoryDate" type="date" error={errors.exFactoryDate} {...register('exFactoryDate')} />
          </Field>

          <Field
            label={`Unit Price${currency ? ` (${currency})` : ''}`}
            error={errors.unitPrice?.message}
            hint={
              gridMode
                ? 'Priced per colourway in the grid above.'
                : multiLine
                ? 'This order has several styles - price each line from the order screen.'
                : valuePreview
                  ? `Order value ${valuePreview}${currency ? ` ${currency}` : ''}`
                  : 'Price per piece. Leave blank until it is agreed.'
            }
            htmlFor="unitPrice"
          >
            <TextInput
              id="unitPrice"
              type="number"
              min="0"
              step="0.0001"
              disabled={multiLine || gridMode}
              error={errors.unitPrice}
              {...register('unitPrice')}
            />
          </Field>

          <Field
            label="Exchange Rate"
            error={errors.exchangeRate?.message}
            hint={isInr ? 'Not needed for an INR order.' : `Rupees per 1 ${currency || 'unit of currency'}.`}
            htmlFor="exchangeRate"
          >
            <TextInput
              id="exchangeRate"
              type="number"
              min="0"
              step="0.0001"
              disabled={isInr}
              error={errors.exchangeRate}
              {...register('exchangeRate')}
            />
          </Field>

          <Field label="Price Terms" hint="Incoterm - FOB, CIF. Defaults from the buyer." htmlFor="priceTerms">
            <TextInput id="priceTerms" {...register('priceTerms')} />
          </Field>

          <Field label="Payment Terms" hint="Defaults from the buyer." className="span-2" htmlFor="paymentTerms">
            <TextInput id="paymentTerms" {...register('paymentTerms')} />
          </Field>

          <div className="fieldset-title">Excess &mdash; approved by the Director</div>

          <Field
            label="Excess %"
            error={errors.excessPctInput?.message}
            hint="2 means 2%. The Director approves anything above zero."
            htmlFor="excessPct"
          >
            <SuffixInput
              id="excessPct"
              type="number"
              min="0"
              max="99"
              step="0.01"
              suffix="%"
              error={errors.excessPctInput}
              {...register('excessPctInput')}
            />
          </Field>

          <Field
            label="Excess Justification"
            required={excessRequested}
            error={errors.excessJustification?.message}
            hint="Goes to the Director with the request."
            className="span-2"
            htmlFor="excessJustification"
          >
            <TextArea id="excessJustification" rows={2} disabled={!excessRequested} {...register('excessJustification')} />
          </Field>

          <Field label="Remarks" className="span-2" htmlFor="remarks">
            <TextArea id="remarks" rows={2} {...register('remarks')} />
          </Field>
        </div>
      </div>

      <div className="modal-footer">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : isNew ? 'Create order' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

