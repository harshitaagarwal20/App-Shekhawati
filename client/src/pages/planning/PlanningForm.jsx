/**
 * Planning create / edit form. Sheets: "Planning_" header + "Planning" grid.
 *
 * The allocation panel is fetched from POST /plannings/preview. Nothing on this
 * screen adds up a plan: the browser sends the rows the planner typed and
 * renders the totals, the ceiling and the verdict the server sent back. The
 * refusal shown while typing is the same string the save would return, because
 * it comes from the same function.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { orders as ordersApi, plannings as planningsApi } from '../../services/erp.js';
import {
  Alert,
  EnumSelect,
  Field,
  MasterSelect,
  RecordSelect,
  Spinner,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import { CeilingNote, UnitAllocationTable, fmtQty } from './planningShared.jsx';
import { loadFailed, reportLoadFailure } from '../../services/loadFailures.js';
import TableWrap from '../../components/TableWrap.jsx';

/**
 * What the one allotment column is called, per department.
 *
 * A plan line carries a single quantity and the department says what it means:
 * cloth goes out to cutting, cut pieces to stitching, and finished pieces to
 * packing and dispatch. Mirrors ALLOTMENT_LABEL in planning.service.js, which
 * is what enforces it.
 */
const ALLOTMENT_LABEL = {
  CUTTING: 'Pieces to cut',
  STITCHING: 'Pieces to stitch',
  IRON: 'Pieces to iron',
  PACKING: 'Produced pieces',
  SHIPPING: 'Produced pieces',
};

const DEPARTMENT_OPTIONS = [
  { value: 'CUTTING', label: 'Cutting' },
  { value: 'STITCHING', label: 'Stitching' },
  { value: 'IRON', label: 'Iron' },
  /* Called DISPATCH by the office. The stored value stays SHIPPING - it is
     what every existing plan holds, and renaming stored data to change a word
     on screen is how one thing ends up with two names. */
  { value: 'SHIPPING', label: 'Dispatch' },
  /**
   * C14 - a packing PLAN. This system records no packing work and has no table
   * that could; the department names who owns the plan, not who does the job.
   */
  { value: 'PACKING', label: 'Packing' },
];

const LINE_STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ON_HOLD', label: 'On Hold' },
];

const today = () => new Date().toISOString().slice(0, 10);
const asDateInput = (v) => (v ? String(v).slice(0, 10) : '');

const blankLine = () => ({
  key: `l${Math.random().toString(36).slice(2, 10)}`,
  lineDate: today(),
  unit: '',
  deliverableSize: '',
  cuttingPcsAllotted: '',
  fabricQty: '',
  fabricUom: 'Mtrs',
  status: 'PENDING',
  remark: '',
});

/** A row is worth sending once it names a date and how many pieces. */
const isComplete = (l) => Boolean(l.lineDate) && Number(l.deliverableSize) > 0;

/**
 * Has the planner put anything in the grid yet?
 *
 * The default below only ever replaces an UNTOUCHED grid. One row with no unit,
 * no quantity and no remark is what the form opens with; anything else is work
 * somebody has done, and a helpful default that overwrites it is not helpful.
 */
const isUntouched = (rows) =>
  rows.length === 1
  && !rows[0].unit
  && !String(rows[0].deliverableSize).trim()
  && !String(rows[0].remark).trim();

/**
 * Strips the local row key and empty optional fields before sending.
 *
 * PIECES ONLY. Every department plans a number of pieces; the fabric a cutting
 * plan consumes is worked out by the server from the style's BOM and is not
 * sent from here - see `estimateFabric` in planning.service.js. A number typed
 * in the browser would be a second opinion on a multiplication that already
 * has one answer.
 */
function toPayloadLine(l, planDepartment) {
  return {
    lineDate: l.lineDate,
    // Only a stitching plan is split by unit; see `usesUnit` below.
    unit: planDepartment === 'STITCHING' ? l.unit || null : null,
    deliverableSize: l.deliverableSize === '' ? null : String(l.deliverableSize),
    status: l.status || 'PENDING',
    remark: l.remark || null,
  };
}

export default function PlanningForm({ plan, onSaved, onCancel }) {
  const isNew = !plan;

  const [header, setHeader] = useState(() =>
    isNew
      ? {
          orderId: '',
          // Which style of the order this plan is for. An order carries a line
          // per style, and planning is done style by style.
          orderLineId: '',
          planDepartment: 'CUTTING',
          containerNo: '',
          planDate: today(),
          remarks: '',
        }
      : {
          orderId: plan.order?.id ?? plan.orderId,
          orderLineId: plan.orderLine?.id ?? plan.orderLineId ?? '',
          planDepartment: plan.planDepartment,
          containerNo: plan.containerNo ?? '',
          planDate: asDateInput(plan.planDate),
          remarks: plan.remarks ?? '',
        },
  );

  const [lines, setLines] = useState(() =>
    isNew || !plan.lines?.length
      ? [blankLine()]
      : plan.lines.map((l) => ({
          key: l.id,
          lineDate: asDateInput(l.lineDate),
          unit: l.unit ?? '',
          deliverableSize: String(l.deliverableSize ?? ''),
          cuttingPcsAllotted:
            l.cuttingPcsAllotted === null || l.cuttingPcsAllotted === undefined
              ? ''
              : String(l.cuttingPcsAllotted),
          fabricQty:
            l.fabricQty === null || l.fabricQty === undefined ? '' : String(l.fabricQty),
          fabricUom: l.fabricUom ?? 'Mtrs',
          status: l.status ?? 'PENDING',
          remark: l.remark ?? '',
        })),
  );

  const [orderOptions, setOrderOptions] = useState(null);
  const [orderInfo, setOrderInfo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);

  const setField = (k) => (e) => setHeader((h) => ({ ...h, [k]: e.target.value }));

  useEffect(() => {
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  // The ceiling is read the moment an order is picked, so the planner sees the
  // limit before typing a single deliverable size - not at save time.
  useEffect(() => {
    if (!header.orderId) {
      setOrderInfo(null);
      return;
    }
    let cancelled = false;
    planningsApi
      .orderAllocation(header.orderId, isNew ? undefined : { excludePlanId: plan.id })
      .then((r) => {
        if (cancelled) return;
        setOrderInfo(r);
        // A single-style order has one line and nothing to choose, so pick it
        // rather than making the planner select from a list of one.
        if (isNew && r?.lines?.length === 1) {
          setHeader((h) => (h.orderLineId ? h : { ...h, orderLineId: r.lines[0].orderLineId }));
        }
      })
      .catch((err) => {
        // The guard stays: an unmounted screen must not report or set state.
        if (cancelled) return;
        reportLoadFailure('the order', err);
        setOrderInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [header.orderId, isNew, plan?.id]);

  /** The line the planner has chosen, with its own ceiling. */
  /*
   * ===========================================================================
   *  A DEPARTMENT'S PLAN STARTS FROM THE ONE ALREADY MADE
   * ===========================================================================
   *
   *  Picking a department on a NEW plan fills the grid in, rather than leaving
   *  the planner to retype a split that already exists somewhere.
   *
   *  IF THIS STYLE IS ALREADY PLANNED, that plan's rows are copied - the same
   *  dates, the same units, the same pieces. You cut what you stitch, and
   *  transcribing one grid into another is how the two stop agreeing.
   *
   *  IF IT IS NOT, one row is seeded with the quantity still unplanned, dated
   *  today. That is the whole order the first time, and the remainder if some
   *  of it has been planned already.
   *
   *  EVERY ROW STAYS EDITABLE. This is a starting point, not a decision - the
   *  planner changes what they need to and adds or removes rows as usual.
   *
   *  IT NEVER OVERWRITES WORK. `isUntouched` is checked first, so a grid that
   *  has been typed into is left exactly as it is, including when the
   *  department is changed after the fact.
   */
  /*
   * `lines` is read here but must not re-run this effect - the effect writes
   * it, and depending on what you write is a loop. A ref carries the current
   * value without joining the dependency list.
   */
  const linesRef = useRef(lines);
  linesRef.current = lines;
  /** Which (style, department) pair has already been filled in. */
  const prefilledFor = useRef(null);

  useEffect(() => {
    if (!isNew || !header.orderLineId || !orderInfo) return undefined;

    const pairKey = `${header.orderLineId}|${header.planDepartment}`;
    if (prefilledFor.current === pairKey) return undefined;

    const orderLine = (orderInfo.lines ?? []).find((l) => l.orderLineId === header.orderLineId);
    if (!orderLine) return undefined;
    if (!isUntouched(linesRef.current)) return undefined;

    prefilledFor.current = pairKey;
    let cancelled = false;

    // The most recent plan for this style, whatever department it belongs to.
    const sibling = [...(orderLine.plans ?? [])].pop();

    if (sibling) {
      planningsApi
        .get(sibling.id)
        .then((full) => {
          if (cancelled) return;
          const copied = (full.lines ?? []).map((l) => ({
            ...blankLine(),
            lineDate: asDateInput(l.lineDate),
            unit: l.unit ?? '',
            deliverableSize: String(l.deliverableSize ?? ''),
          }));
          // Guarded again on arrival: the fetch is asynchronous, and the
          // planner may have started typing while it was in flight.
          if (copied.length && isUntouched(linesRef.current)) setLines(copied);
        })
        .catch(() => {});
      return () => { cancelled = true; };
    }

    // Nothing planned yet: one row for what is still to be planned.
    const remaining = Number(orderLine.remainingQty ?? orderLine.orderQty ?? 0);
    if (remaining > 0) setLines([{ ...blankLine(), deliverableSize: String(remaining) }]);

    return () => { cancelled = true; };
  }, [isNew, header.orderLineId, header.planDepartment, orderInfo]);

  const chosenLine = useMemo(
    () => (orderInfo?.lines ?? []).find((l) => l.orderLineId === header.orderLineId) ?? null,
    [orderInfo, header.orderLineId],
  );

  /* Which column the allotment grid shows, and which one is sent. */
  const isCutting = header.planDepartment === 'CUTTING';
  /* Only stitching is split across units; the other floors are one place.
     Mirrors departmentUsesUnit in planning.service.js. */
  const usesUnit = header.planDepartment === 'STITCHING';
  const completeLines = useMemo(() => lines.filter(isComplete), [lines]);

  /*
   * The server's fabric estimate, against the row it belongs to.
   *
   * MATCHED BY POSITION, NOT BY VALUE. It was matched on date-and-unit, which
   * looked like an identity and is not one: two rows allotting the same unit
   * on the same date are ordinary - a morning lot and an afternoon lot - and
   * both then matched the first estimate, so 1,000 pieces and 20,000 pieces
   * were both shown as 87.5 Mtrs.
   *
   * The server sorts the rows it is given by date, and `Array.sort` is stable,
   * so sorting the same rows the same way here lines the two lists up exactly.
   * `row.key` is the row's own identity, which is what the map is keyed on.
   *
   * The quantity is checked before the figure is used, because the preview is
   * debounced: while a number is being typed the answer in hand belongs to
   * what was there a moment ago, and showing it against a row that has since
   * changed would be worse than showing nothing.
   */
  const fabricByRow = useMemo(() => {
    const out = new Map();
    const ordered = [...completeLines].sort(
      (a, b) => String(a.lineDate).localeCompare(String(b.lineDate)),
    );
    (preview?.lines ?? []).forEach((estimate, i) => {
      const row = ordered[i];
      if (!row || !Number(estimate.fabricQty)) return;
      if (Number(estimate.deliverableSize) !== Number(row.deliverableSize)) return;
      out.set(row.key, `${fmtQty(estimate.fabricQty)} ${estimate.fabricUom ?? ''}`.trim());
    });
    return out;
  }, [preview, completeLines]);

  const fabricFor = useCallback((row) => fabricByRow.get(row.key) ?? null, [fabricByRow]);
  const previewKey = useMemo(
    () => JSON.stringify({
      orderId: header.orderId,
      orderLineId: header.orderLineId,
      planDepartment: header.planDepartment,
      lines: completeLines.map((l) => toPayloadLine(l, header.planDepartment)),
    }),
    // The department decides whether a fabric estimate comes back, so the
    // preview is re-asked when it changes.
    [header.orderId, header.orderLineId, header.planDepartment, completeLines],
  );

  // Ask the SERVER where this grid stands. Debounced, because it fires as the
  // planner types a quantity.
  const runPreview = useCallback(async () => {
    const body = JSON.parse(previewKey);
    if (!body.orderId || !body.orderLineId || body.lines.length === 0) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    try {
      setPreview(await planningsApi.preview(body));
    } catch {
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [previewKey]);

  useEffect(() => {
    const id = setTimeout(runPreview, 400);
    return () => clearTimeout(id);
  }, [runPreview]);

  function updateLine(key, field, value) {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }
  function addLine() {
    setLines((rows) => {
      const last = rows[rows.length - 1];
      return [...rows, { ...blankLine(), unit: last?.unit ?? '', lineDate: last?.lineDate ?? today() }];
    });
  }
  function removeLine(key) {
    setLines((rows) => (rows.length === 1 ? [blankLine()] : rows.filter((r) => r.key !== key)));
  }

  async function submit(e) {
    e.preventDefault();
    setServerError('');

    if (!header.orderId) return setServerError('Pick the order this plan is for.');
    if (!header.orderLineId) return setServerError('Pick which style of the order this plan covers.');
    if (completeLines.length === 0) {
      return setServerError('Add at least one allotment line with a date and a deliverable size.');
    }

    const payload = {
      // Both are fixed once the plan exists: a plan belongs to its order, and
      // to the one style of it the plan was raised for.
      ...(isNew ? { orderId: header.orderId, orderLineId: header.orderLineId } : {}),
      planDepartment: header.planDepartment,
      containerNo: header.containerNo || null,
      planDate: header.planDate,
      remarks: header.remarks || null,
      lines: completeLines.map((l) => toPayloadLine(l, header.planDepartment)),
    };

    setSaving(true);
    try {
      const saved = isNew
        ? await planningsApi.create(payload)
        : await planningsApi.update(plan.id, payload);
      onSaved(saved, isNew);
    } catch (err) {
      setServerError(err.message);
      setSaving(false);
    }
  }

  const allocation = preview?.allocation;
  const blocked = Boolean(preview?.violation);

  return (
    <form onSubmit={submit} noValidate>
      <div className="modal-body">
        <Alert kind="error">{serverError}</Alert>

        {/* The server's own refusal, shown before the planner tries to save. */}
        {preview?.violation && <Alert kind="error">{preview.violation}</Alert>}

        <div className="form-grid">
          <div className="fieldset-title">Plan header</div>

          <Field
            label="Order No"
            required
            hint={isNew ? 'Pick the order, then the style on it.' : 'An order cannot be changed once the plan exists.'}
            htmlFor="pl-order"
          >
            <RecordSelect
              id="pl-order"
              options={orderOptions ?? []}
              loading={orderOptions === null}
              disabled={!isNew}
              getValue={(o) => o.id}
              getLabel={(o) => `${o.orderNo} - ${o.style?.styleNo ?? ''} (${fmtQty(o.orderQty)} pcs)`}
              placeholder="Select order..."
              value={header.orderId}
              onChange={(e) => {
                // A different order means a different set of styles, so the
                // chosen one cannot survive the change.
                const orderId = e.target ? e.target.value : e;
                setHeader((h) => ({ ...h, orderId, orderLineId: '' }));
              }}
            />
          </Field>

          {/*
            WHICH STYLE THIS PLAN IS FOR.
            An order carries a line per style / colour / size and planning is
            done style by style, so the plan names one of them. Its quantity and
            its ceiling come from that line - not from the order total, which on
            a multi-style order belongs to every style at once.
          */}
          <Field
            label="Style"
            required
            hint={
              !header.orderId
                ? 'Pick an order first.'
                : !isNew
                  ? 'A plan stays with the style it was raised for.'
                  : (orderInfo?.lines?.length ?? 0) > 1
                    ? `This order has ${orderInfo.lines.length} styles. Each is planned separately.`
                    : 'Order Qty and the ceiling follow this style.'
            }
            htmlFor="pl-line"
          >
            <RecordSelect
              id="pl-line"
              options={orderInfo?.lines ?? []}
              loading={Boolean(header.orderId) && orderInfo === null}
              disabled={!isNew || !header.orderId}
              getValue={(l) => l.orderLineId}
              getLabel={(l) =>
                `${l.style?.styleNo ?? ''}`
                + `${l.colorCode ? ` / ${l.colorCode}` : ''}`
                + ` - ${fmtQty(l.orderQty)} pcs`
                + (Number(l.plannedQty) > 0 ? ` (${fmtQty(l.plannedQty)} planned)` : '')
              }
              placeholder="Select style..."
              value={header.orderLineId}
              onChange={setField('orderLineId')}
            />
          </Field>

          <Field label="Planning Department" required htmlFor="pl-dept">
            <EnumSelect
              id="pl-dept"
              includeBlank={false}
              options={DEPARTMENT_OPTIONS}
              value={header.planDepartment}
              onChange={setField('planDepartment')}
            />
          </Field>

          {/*
            A CONTAINER NUMBER IS TYPED, NOT CHOSEN FROM A LIST.

            It was a dropdown reading L_ContainerNo, which asks the office to
            register every container in a master before it can be planned
            against - and a container number belongs to one shipment and is
            never used again, so the list could only ever grow into a thousand
            dead entries with the one needed today missing from it.
          */}
          <Field label="Container No" htmlFor="pl-container">
            <TextInput
              id="pl-container"
              value={header.containerNo}
              onChange={setField('containerNo')}
              placeholder="As printed on the container"
            />
          </Field>

          <Field label="Plan Date" required htmlFor="pl-date">
            <TextInput id="pl-date" type="date" value={header.planDate} onChange={setField('planDate')} />
          </Field>

          {/*
            The figures describe THE STYLE being planned, not the order.
            They used to read the order header, which on a multi-style order is
            every style's quantity added together - so a plan for a 500-piece
            style was shown a ceiling of 800 and looked 300 under when it was
            exactly right.
          */}
          {orderInfo && (
            <>
              <Detail label="Buyer" value={orderInfo.order.buyer?.buyerName} />
              <Detail
                label="Style No"
                value={chosenLine?.style?.styleNo ?? '-'}
                mono
                hint={chosenLine?.colorCode ?? undefined}
              />
              {/* DELIVERABLE SIZE, which the office reads as the order
                  quantity - and it is exactly that, taken from the order line.
                  It used to be a typed column on every row of the grid below,
                  which is why plans arrived with the order total on each row
                  and were refused for allotting it twice over. Read-only, and
                  stated once. */}
              <Detail
                label="Deliverable Size"
                value={chosenLine ? `${fmtQty(chosenLine.orderQty)} pcs` : '-'}
                hint={
                  (orderInfo.lines?.length ?? 0) > 1
                    ? `This style only. The order totals ${fmtQty(orderInfo.order.orderQty)} pcs across ${orderInfo.lines.length} styles.`
                    : 'The order quantity. The rows below say how it is split.'
                }
              />
              <Detail
                label="Permitted Qty"
                value={chosenLine ? fmtQty(chosenLine.permittedQty) : '-'}
                hint="This style's quantity plus the excess the Director approved."
              />
            </>
          )}

          <Field label="Remarks" className="span-2" htmlFor="pl-remarks">
            <TextArea id="pl-remarks" rows={2} value={header.remarks} onChange={setField('remarks')} />
          </Field>
        </div>

        {/* What is already planned on this STYLE, so a clash is visible before
            the save is attempted. Other styles of the same order are not a
            clash - they are separate plans - so they are not listed here. */}
        {chosenLine?.plans?.length > 0 && (
          <p className="faint" style={{ fontSize: 12 }}>
            Already planned on {chosenLine.style?.styleNo}:{' '}
            {chosenLine.plans
              .map((d) => `${d.planDepartment} (${d.planNo}, ${fmtQty(d.plannedQty)} pcs, ${d.state.toLowerCase()})`)
              .join(' · ')}
          </p>
        )}

        {/* --- The allotment grid: Excel "Planning" ------------------------ */}
        {/* A CUTTING PLAN ALLOTS FABRIC.

            What is handed to a cutting floor is cloth, measured in metres, and
            what comes back is panels - so the plan states the fabric that will
            be issued. Stitching, shipping and packing receive a count, and keep
            the pieces column. The server enforces the same split; see
            `validateLines` in planning.service.js. */}
        <div className="fieldset-title" style={{ marginTop: 18 }}>
          Allotment
          <span className="faint">
            {' '}&mdash; Date / {usesUnit && 'Unit / '}{ALLOTMENT_LABEL[header.planDepartment] ?? 'Quantity'}
          </span>
        </div>

        <TableWrap>
          <table className="bom-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Date</th>
                {usesUnit && <th style={{ width: 200 }}>Unit</th>}
                <th style={{ width: 150, textAlign: 'right' }}>
                  {ALLOTMENT_LABEL[header.planDepartment] ?? 'Quantity'}
                </th>
                {isCutting && (
                  <th style={{ width: 150, textAlign: 'right' }}>Fabric to issue</th>
                )}
                <th style={{ width: 140 }}>Status</th>
                <th>Remark</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td>
                    <TextInput
                      type="date"
                      value={l.lineDate}
                      onChange={(e) => updateLine(l.key, 'lineDate', e.target.value)}
                      aria-label="Line date"
                    />
                  </td>
                  {usesUnit && (
                  <td>
                    <MasterSelect
                      listCode="StitchingUnit"
                      currentValue={l.unit}
                      value={l.unit}
                      onChange={(e) => updateLine(l.key, 'unit', e.target.value)}
                      aria-label="Unit"
                    />
                  </td>
                  )}
                  {/* HOW MANY PIECES. Every department plans in pieces; the
                      cutting floor's cloth follows from them. */}
                  <td>
                    <TextInput
                      type="number"
                      min="1"
                      step="1"
                      value={l.deliverableSize}
                      onChange={(e) => updateLine(l.key, 'deliverableSize', e.target.value)}
                      aria-label={ALLOTMENT_LABEL[header.planDepartment] ?? 'Pieces'}
                    />
                  </td>
                  {/* THE FABRIC THOSE PIECES CONSUME, from the style's BOM.
                      Read-only: it is the same multiplication the order screen,
                      the PO ceiling and the cutting challan all use, and a
                      second opinion typed here would only disagree with them. */}
                  {isCutting && (
                    <td className="num faint">
                      {fabricFor(l) ?? <span className="faint">&mdash;</span>}
                    </td>
                  )}
                  <td>
                    <EnumSelect
                      includeBlank={false}
                      options={LINE_STATUS_OPTIONS}
                      value={l.status}
                      onChange={(e) => updateLine(l.key, 'status', e.target.value)}
                      aria-label="Line status"
                    />
                  </td>
                  <td>
                    <TextInput
                      value={l.remark}
                      onChange={(e) => updateLine(l.key, 'remark', e.target.value)}
                      aria-label="Remark"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeLine(l.key)}
                      aria-label="Remove line"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>

        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-sm" onClick={addLine}>
            Add line
          </button>
          {previewing && <Spinner label="Checking against the order..." />}
        </div>

        {/* --- Everything below is the server's arithmetic, not the browser's */}
        {allocation && (
          <div style={{ marginTop: 18 }}>
            <div className="fieldset-title">
              Allocation <span className="faint">&mdash; calculated by the server</span>
            </div>
            <CeilingNote allocation={allocation} />
            {preview.unitAllocation?.length > 0 && (
              <>
                <div className="fieldset-title" style={{ marginTop: 12 }}>
                  Unit allocation
                </div>
                <UnitAllocationTable rows={preview.unitAllocation} planDepartment={header.planDepartment} />
              </>
            )}
          </div>
        )}
      </div>

      <div className="modal-footer">
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || blocked}>
          {saving ? 'Saving...' : blocked ? 'Over the permitted quantity' : isNew ? 'Create plan' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function Detail({ label, value, mono, hint }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className={mono ? 'mono' : ''} style={{ paddingTop: 2 }}>
        {value || <span className="faint">-</span>}
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
