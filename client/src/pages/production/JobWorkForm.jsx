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
import { Alert, RecordSelect, Spinner, TextInput } from '../../components/ui.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { fmtNum, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';

const schema = z.object({
  dyeIssueNo: z.string().trim().max(40).optional(),
  issueDate: z.string().min(1, 'Date is required'),
  // Dyeing and printing are what this store sends cloth out for. The server
  // decides what is offered (jobWork.service.js `OFFERED`); this refuses
  // anything else being submitted from a stale form.
  process: z.enum(['DYEING', 'PRINTING']),
  /*
   * C16 - THE ROLLS ARE NOT IN THIS SCHEMA.
   *
   * A job covers a set of rolls with a quantity each, and the header quantity
   * is their sum - worked out by the server, never typed. A repeating grid is
   * awkward to express through react-hook-form and would duplicate a rule the
   * server already owns, so the grid is component state and is checked on
   * submit. What stays here is everything that is genuinely one value.
   */
  vendorId: z.string().uuid('Choose a vendor'),
  fabricIssueId: z.string().optional(),
  orderId: z.string().optional(),
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

/** A stable row key - the roll can change under it, so the id cannot be one. */
let rowSeq = 0;
const rowKey = () => `r${++rowSeq}`;

const pctToFraction = (pct) => (pct === '' || pct === undefined ? undefined : String(Number(pct) / 100));

export default function JobWorkForm({ processes = [], onSaved, onCancel }) {
  const form = useZodForm(schema, {
    dyeIssueNo: '',
    issueDate: todayInput(),
    process: 'DYEING',
    vendorId: '',
    fabricIssueId: '',
    orderId: '',
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

  /*
   * C16 - THE ROLLS GOING OUT ON THIS JOB.
   *
   * One line per roll, each with its own quantity. A lot is usually several
   * rolls of the same cloth to the same vendor on one despatch, which is why
   * the row is roll + quantity and nothing else: the process, the vendor, the
   * rate and the shrinkage tolerance belong to the job, not to a roll.
   */
  const [rollLines, setRollLines] = useState([{ key: rowKey(), rollId: '', qty: '' }]);
  const setRollLine = (key, patch) =>
    setRollLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const process = form.watch('process');
  const rate = form.watch('rate');
  const standardShrinkagePct = form.watch('standardShrinkagePct');

  /** The lead roll - line 1, as the server treats it. Drives the preview. */
  const rollId = rollLines[0]?.rollId ?? '';
  /** The job's quantity is the sum of its rolls', here as on the server. */
  const qty = rollLines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const chosenRollIds = rollLines.map((l) => l.rollId).filter(Boolean);

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

  /*
   * The fabric issues that released ANY of the job's rolls, so it can point
   * back at one. The server accepts an issue for any roll on the job and
   * measures it against that roll's line, so offering only the lead roll's
   * issues would hide a legitimate choice on a multi-roll lot.
   */
  const rollKey = chosenRollIds.join(',');
  useEffect(() => {
    const ids = rollKey ? rollKey.split(',') : [];
    if (!ids.length) {
      setIssues([]);
      return;
    }
    let cancelled = false;
    Promise.all(ids.map((id) => fiApi.list({ rollId: id, pageSize: 25 })))
      .then((results) => {
        if (cancelled) return;
        setIssues(results.flatMap((r) => r.rows ?? []));
      })
      .catch(loadFailed(setIssues, 'issues'));
    return () => { cancelled = true; };
  }, [rollKey]);

  const runPreview = useCallback(async () => {
    if (!process) return;
    setPreviewing(true);
    try {
      const p = await jwApi.preview({
        process,
        rollId: rollId || undefined,
        // The grid's running total. Zero means nothing is typed yet, not a
        // job for nothing, so the preview is asked without a quantity.
        qty: qty > 0 ? String(qty) : undefined,
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
    (values) => {
      /*
       * The grid is not part of the RHF schema, so it is checked here. These
       * refusals are the same ones the server makes - they are repeated for
       * the round trip, not instead of it.
       */
      const lines = rollLines.filter((l) => l.rollId);
      if (!lines.length) throw new Error('Add at least one roll to this job.');
      const blank = lines.find((l) => !(Number(l.qty) > 0));
      if (blank) {
        const roll = rolls.find((r) => r.id === blank.rollId);
        throw new Error(`Enter a quantity for roll ${roll?.rollNo ?? roll?.label ?? ''}.`.trim());
      }
      const ids = lines.map((l) => l.rollId);
      const dup = ids.find((id, i) => ids.indexOf(id) !== i);
      if (dup) {
        const roll = rolls.find((r) => r.id === dup);
        throw new Error(
          `Roll ${roll?.rollNo ?? roll?.label ?? ''} is on this job twice. `.trim() +
            'Put it on one line with the total quantity.',
        );
      }

      return jwApi.create({
        dyeIssueNo: values.dyeIssueNo || undefined,
        issueDate: values.issueDate,
        process: values.process,
        // C16 - the set. The server derives the header quantity and the lead
        // roll from it, so neither is sent.
        rolls: lines.map((l) => ({ rollId: l.rollId, qty: String(l.qty) })),
        vendorId: values.vendorId,
        fabricIssueId: values.fabricIssueId || null,
        orderId: values.orderId || null,
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
      });
    },
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

      {/*
        C16 - THE ROLLS, AS A GRID.

        A dyeing lot is several rolls going to one vendor on one despatch. It
        used to be one roll per job, so five rolls meant five job orders and
        five numbers for one physical lot - and the vendor got one pile of
        cloth with five papers that did not add up to it.

        The quantity is per roll because shrinkage is judged per roll: one roll
        four per cent short among four clean ones nets out across a lot total
        and looks like nothing happened.
      */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Rolls going out</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {rollLines.filter((l) => l.rollId).length} roll(s) · {fmtNum(qty)}{' '}
            {form.watch('uom') || preview?.roll?.uom || ''} in total
          </span>
        </div>
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Roll</th>
                <th className="num">Qty</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rollLines.map((l, i) => (
                <tr key={l.key}>
                  <td>{i + 1}</td>
                  <td style={{ minWidth: 280 }}>
                    <RecordSelect
                      options={rolls}
                      getValue={(r) => r.id}
                      getLabel={(r) => r.label}
                      aria-label="Roll"
                      placeholder="Choose a roll..."
                      value={l.rollId}
                      onChange={(e) => setRollLine(l.key, { rollId: e.target.value })}
                    />
                  </td>
                  <td className="num" style={{ minWidth: 120 }}>
                    <TextInput
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      aria-label="Quantity"
                      style={{ width: 120, textAlign: 'right' }}
                      value={l.qty}
                      onChange={(e) => setRollLine(l.key, { qty: e.target.value })}
                    />
                  </td>
                  <td className="actions">
                    {rollLines.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setRollLines((ls) => ls.filter((x) => x.key !== l.key))}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <div className="card-body">
          <button
            type="button"
            className="btn"
            onClick={() => setRollLines((ls) => [...ls, { key: rowKey(), rollId: '', qty: '' }])}
          >
            Add a roll
          </button>
          <span className="hint" style={{ marginLeft: 10 }}>
            The job&apos;s quantity is the total of these - the server works it out, so there is
            no total to type.
          </span>
        </div>
      </div>

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
