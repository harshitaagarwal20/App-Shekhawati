/**
 * Job Work issue form.
 *
 * The process is picked FIRST and drives everything after it: the document
 * title, what the vendor is called, which vendors are offered, the default
 * loss allowance, and what the loss is called. All of that comes from
 * GET /job-works/processes, so the four processes read differently on screen
 * while sharing one table underneath.
 */

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import {
  fabricIssues as fiApi,
  jobWorks as jwApi,
  orders as ordersApi,
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
import { fmtNum, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';

const schema = z.object({
  dyeIssueNo: z.string().trim().max(40).optional(),
  issueDate: z.string().min(1, 'Date is required'),
  // Dyeing and printing are what this store sends cloth out for. The server
  // decides what is offered (jobWork.service.js `OFFERED`); this refuses
  // anything else being submitted from a stale form.
  process: z.enum(['DYEING', 'PRINTING']),
  rollId: z.string().uuid('Choose a roll'),
  vendorId: z.string().uuid('Choose a vendor'),
  fabricIssueId: z.string().optional(),
  orderId: z.string().optional(),
  qty: z.coerce.number().positive('Quantity must be greater than zero'),
  uom: z.string().optional(),
  rate: z.coerce.number().min(0, 'Rate cannot be negative'),
  fabricStage: z.enum(['BEFORE_STITCHING', 'AFTER_STITCHING']),
  standardShrinkagePct: z.coerce.number().min(0).max(99).optional(),
  colourCode: z.string().optional(),
  content: z.string().optional(),
  gsm: z.string().optional(),
  remark: z.string().trim().max(2000).optional(),
});

const STAGES = [
  { value: 'BEFORE_STITCHING', label: 'Before stitching' },
  { value: 'AFTER_STITCHING', label: 'After stitching' },
];

const pctToFraction = (pct) => (pct === '' || pct === undefined ? undefined : String(Number(pct) / 100));

export default function JobWorkForm({ processes = [], onSaved, onCancel }) {
  const form = useZodForm(schema, {
    dyeIssueNo: '',
    issueDate: todayInput(),
    process: 'DYEING',
    rollId: '',
    vendorId: '',
    fabricIssueId: '',
    orderId: '',
    qty: '',
    uom: '',
    rate: '',
    fabricStage: 'BEFORE_STITCHING',
    standardShrinkagePct: '',
    colourCode: '',
    content: '',
    gsm: '',
    remark: '',
  });

  const [rolls, setRolls] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [orders, setOrders] = useState([]);
  const [issues, setIssues] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  const process = form.watch('process');
  const rollId = form.watch('rollId');
  const qty = form.watch('qty');
  const rate = form.watch('rate');
  const standardShrinkagePct = form.watch('standardShrinkagePct');

  const meta = processes.find((p) => p.process === process);

  useEffect(() => {
    fiApi.rolls({ includeEmpty: 'true' }).then(setRolls).catch(loadFailed(setRolls, 'rolls'));
    ordersApi.options().then(setOrders).catch(loadFailed(setOrders, 'orders'));
  }, []);

  // The vendor list follows the process: printing work goes to a printer.
  useEffect(() => {
    if (!meta) return;
    vendorsApi
      .options({ category: meta.vendorCategory })
      .then(setVendors)
      .catch(loadFailed(setVendors, 'vendors'));
  }, [meta]);

  // The fabric issue that released this roll, so the job can point back at it.
  useEffect(() => {
    if (!rollId) {
      setIssues([]);
      return;
    }
    fiApi
      .list({ rollId, pageSize: 25 })
      .then((r) => setIssues(r.rows ?? []))
      .catch(loadFailed(setIssues, 'issues'));
  }, [rollId]);

  const runPreview = useCallback(async () => {
    if (!process) return;
    setPreviewing(true);
    try {
      const p = await jwApi.preview({
        process,
        rollId: rollId || undefined,
        qty: qty === '' ? undefined : String(qty),
        rate: rate === '' ? undefined : String(rate),
        standardShrinkageAllowed: pctToFraction(standardShrinkagePct),
      });
      setPreview(p);

      // Fill the fabric characteristics from the roll, once.
      if (p.roll && !form.getValues('colourCode')) {
        form.setValue('colourCode', p.roll.colorCode ?? '');
        form.setValue('content', p.roll.content ?? '');
        form.setValue('gsm', p.roll.gsm ?? '');
        form.setValue('uom', p.roll.uom ?? '');
      }
      if (standardShrinkagePct === '') {
        form.setValue('standardShrinkagePct', Number(p.standardShrinkagePctDisplay));
      }
    } catch {
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [process, rollId, qty, rate, standardShrinkagePct]);

  useEffect(() => {
    const id = setTimeout(runPreview, 300);
    return () => clearTimeout(id);
  }, [runPreview]);

  const { submit, busy, banner, setBanner } = useSubmit(
    form,
    (values) =>
      jwApi.create({
        dyeIssueNo: values.dyeIssueNo || undefined,
        issueDate: values.issueDate,
        process: values.process,
        rollId: values.rollId,
        vendorId: values.vendorId,
        fabricIssueId: values.fabricIssueId || null,
        orderId: values.orderId || null,
        qty: String(values.qty),
        uom: values.uom || null,
        rate: String(values.rate),
        fabricStage: values.fabricStage,
        standardShrinkageAllowed: pctToFraction(values.standardShrinkagePct),
        colourCode: values.colourCode || null,
        content: values.content || null,
        /*
         * WIDTH IS NOT SENT, BY DESIGN.
         *
         * It was a box on this form that arrived pre-filled from the roll and
         * was then re-submitted as if somebody had decided it - a second copy
         * of a number the roll already holds, free to drift from it the moment
         * anyone typed in the box.
         *
         * jobWork.service.js already states the rule and applies it:
         *
         *     // Fabric characteristics travel with the roll, not with the typist.
         *     width: input.width ... : roll.width
         *
         * so sending nothing means the job work takes the roll's own width,
         * and there is exactly one width for a given roll again.
         *
         * COUNT and CONSTRUCTION went the same way and for the same reason.
         * The service applies the identical fallback to both, so the job work
         * still records them - read off the roll rather than re-chosen from a
         * dropdown by whoever happened to raise the issue.
         */
        gsm: values.gsm || null,
        remark: values.remark || null,
      }),
    { onDone: (saved) => onSaved(saved) },
  );

  return (
    <FormShell
      onSubmit={submit}
      banner={banner}
      onDismissBanner={() => setBanner('')}
      busy={busy}
      submitLabel={meta ? `Raise ${meta.label.toLowerCase()} job` : 'Raise job'}
      busyLabel="Raising..."
      onCancel={onCancel}
      footerNote={
        preview?.nextJobNo ? `Will be numbered ${preview.nextJobNo} — the ${meta?.label.toLowerCase()} series.` : undefined
      }
    >
      {meta && (
        <Alert kind="info">
          <strong>{meta.documentName}</strong> — goes to a {meta.vendorLabel.toLowerCase()}, and its
          loss is measured as <strong>{meta.lossLabel.toLowerCase()}</strong>.
        </Alert>
      )}

      <div className="form-grid">
        <FieldGroup title="Job" hint="the process decides everything below it">
          <RHFEnumSelect
            form={form}
            name="process"
            label="Process"
            required
            includeBlank={false}
            options={processes.map((p) => ({ value: p.process, label: p.label }))}
          />
          <RHFInput form={form} name="issueDate" label="Date" type="date" required />
          <RHFInput
            form={form}
            name="dyeIssueNo"
            label="Job No"
            hint="Left blank, the process's own series issues one."
          />
          <RHFEnumSelect
            form={form}
            name="fabricStage"
            label="Fabric stage"
            required
            includeBlank={false}
            options={STAGES}
          />
        </FieldGroup>

        <FieldGroup title="What is going out">
          <RHFRecordSelect
            form={form}
            name="rollId"
            label="Roll"
            required
            options={rolls}
            getLabel={(r) => r.label}
            placeholder="Choose a roll..."
          />
          <RHFRecordSelect
            form={form}
            name="vendorId"
            label={meta?.vendorLabel ?? 'Vendor'}
            required
            options={vendors}
            getLabel={(v) => `${v.vendorName} (${v.vendorCode})`}
            placeholder={`Choose a ${meta?.vendorCategory?.toLowerCase() ?? ''} vendor...`}
            hint="Only vendors of the right category are offered."
          />
          <RHFRecordSelect
            form={form}
            name="fabricIssueId"
            label="Fabric issue"
            options={issues}
            getLabel={(i) => `${i.issueNo} — ${fmtNum(i.fabricQtyIssued)} ${i.uom}`}
            disabled={!rollId}
            placeholder={rollId ? 'No fabric issue reference' : 'Choose a roll first'}
            noOptionsLabel={
              rollId
                ? 'No fabric issue was raised for this roll'
                : 'Choose a roll first - issues belong to a roll'
            }
            hint="The issue that released this roll to the vendor."
          />
          <RHFRecordSelect
            form={form}
            name="orderId"
            label="Order"
            options={orders}
            getLabel={(o) => `${o.orderNo} — ${o.style?.styleNo ?? ''}`}
            placeholder="No order reference"
          />
          <RHFQty form={form} name="qty" label="Qty" required uom={preview?.roll?.uom} />
          <RHFQty form={form} name="rate" label="Rate" required hint="Job work rate per unit." />
          <RHFInput
            form={form}
            name="standardShrinkagePct"
            label={`Standard ${meta?.lossLabel?.toLowerCase() ?? 'loss'} allowed (%)`}
            type="number"
            step="any"
            min="0"
            hint="Defaults from the configured rule for this process."
          />
        </FieldGroup>

        <FieldGroup title="Fabric" hint="copied from the roll — edit only if the roll record is wrong">
          <RHFMasterSelect form={form} name="colourCode" label="Colour" listCode="ColorCode" />
          <RHFMasterSelect form={form} name="content" label="Content" listCode="FabricContent" />
          <RHFMasterSelect form={form} name="gsm" label="GSM" listCode="GSM" />
          <RHFMasterSelect form={form} name="uom" label="UOM" listCode="UOM" />
          <RHFTextArea form={form} name="remark" label="Remark" className="span-2" />
        </FieldGroup>
      </div>

      {previewing && !preview && <Spinner label="Calculating..." />}

      {preview && (
        <div style={{ marginTop: 18 }}>
          <div className="fieldset-title">
            Calculated <span className="faint">&mdash; by the server</span>
          </div>
        </div>
      )}
    </FormShell>
  );
}
