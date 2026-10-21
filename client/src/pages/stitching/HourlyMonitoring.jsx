/**
 * Hourly Monitoring - pieces per tailor, slot by slot.
 *
 * ---------------------------------------------------------------------------
 *  BUILT FOR A PHONE IN ONE HAND
 *
 *  The supervisor walks the line once an hour and fills ONE slot. So the
 *  screen opens on "This hour": the slot for the current time already chosen,
 *  one big number box per tailor, and nothing else. Each box saves the moment
 *  it is left (or Enter is pressed, which also moves to the next tailor), so a
 *  half-filled day is normal and losing signal loses one number, not a sheet.
 *
 *  "Whole day" is the grid as the workbook draws it - tailors down, slots
 *  across, totals both ways - for the office, a tablet, or a correction.
 *
 *  Every total on screen is the server's: each save returns the whole grid.
 *  A slot under the style's hourly target is shown red.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { stitching as api } from '../../services/erp.js';
import { Alert, EmptyState, Field, PageHeader, Spinner, TextInput } from '../../components/ui.jsx';
import { ExportButton } from '../../components/dataTransfer.jsx';
import { fmtNum } from '../../utils/format.js';
import {
  OrderStylePicker,
  UnitPicker,
  currentSlot,
  useStitchingContext,
  useUnitOrders,
} from './stitchingShared.jsx';

const n0 = (v) => fmtNum(v, { decimals: 0 });
const cellKey = (employeeId, slot) => `${employeeId}|${slot}`;

export default function HourlyMonitoring() {
  const { can } = useAuth();
  const { ctx, error: ctxError } = useStitchingContext();

  const [unit, setUnit] = useState('');
  const [date, setDate] = useState('');
  const [choice, setChoice] = useState(null);
  const [mode, setMode] = useState('hour');
  const [slot, setSlot] = useState('');

  useEffect(() => {
    if (!ctx) return;
    setUnit((u) => ctx.fixedUnit ?? u);
    setDate((d) => d || ctx.today);
    setSlot((s) => s || currentSlot(ctx.slots));
  }, [ctx]);

  const { orders, loading: ordersLoading } = useUnitOrders(unit);
  // One order cut for the unit is the usual case: choose it without asking.
  useEffect(() => {
    if (!choice && orders.length === 1) setChoice(orders[0]);
  }, [orders, choice]);

  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!unit || !date || !choice) {
      setGrid(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setGrid(await api.hourlyGrid({ unit, date, orderId: choice.orderId, styleId: choice.styleId }));
    } catch (e) {
      setError(e.message);
      setGrid(null);
    } finally {
      setLoading(false);
    }
  }, [unit, date, choice]);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * Drafts are what is in a box that the server has not confirmed yet. A box
   * shows its draft while it has one, else the server's number - so a total
   * refreshing after one save never wipes what is being typed in the next.
   */
  const [drafts, setDrafts] = useState({});
  const [cellState, setCellState] = useState({});
  const inFlight = useRef(0);
  const [saving, setSaving] = useState(0);

  const canWrite = Boolean(ctx?.canWrite) && (can('HOURLY_MONITORING.CREATE') || can('HOURLY_MONITORING.EDIT'));

  const serverValue = (employeeId, s) => grid?.rows.find((r) => r.employeeId === employeeId)?.cells[s]?.pcs ?? '';

  async function saveCell(employeeId, s) {
    const key = cellKey(employeeId, s);
    if (!(key in drafts)) return;
    const value = drafts[key].trim();
    const was = serverValue(employeeId, s);
    if (value === '' ? was === '' : Number(value) === Number(was)) {
      setDrafts(({ [key]: _, ...rest }) => rest);
      return;
    }
    if (value !== '' && (!/^\d+(\.\d+)?$/.test(value))) {
      setCellState((c) => ({ ...c, [key]: { status: 'error', message: 'Numbers only' } }));
      return;
    }

    setCellState((c) => ({ ...c, [key]: { status: 'saving' } }));
    inFlight.current += 1;
    setSaving(inFlight.current);
    try {
      const next = await api.saveSlot({
        unit: ctx.fixedUnit ? undefined : unit,
        date,
        orderId: choice.orderId,
        styleId: choice.styleId,
        employeeId,
        slot: s,
        pcs: value,
      });
      setGrid(next);
      setDrafts((d) => {
        if (d[key] !== drafts[key]) return d; // typed again while saving
        const { [key]: _, ...rest } = d;
        return rest;
      });
      setCellState((c) => ({ ...c, [key]: { status: 'saved' } }));
    } catch (e) {
      setCellState((c) => ({ ...c, [key]: { status: 'error', message: e.message } }));
    } finally {
      inFlight.current -= 1;
      setSaving(inFlight.current);
    }
  }

  const cellProps = (employeeId, s) => {
    const key = cellKey(employeeId, s);
    const shown = key in drafts ? drafts[key] : String(serverValue(employeeId, s) === '' ? '' : Number(serverValue(employeeId, s)));
    const short = !(key in drafts) && grid?.rows.find((r) => r.employeeId === employeeId)?.cells[s]?.short;
    return {
      value: shown,
      short,
      state: cellState[key],
      onChange: (e) => setDrafts((d) => ({ ...d, [key]: e.target.value })),
      onBlur: () => saveCell(employeeId, s),
    };
  };

  const filled = grid && slot ? grid.rows.filter((r) => r.cells[slot]).length : 0;

  return (
    <div className="hourly-page">
      <PageHeader
        title="Hourly monitoring"
        actions={
          <ExportButton
            dataset="hourly-monitoring"
            params={{ unit: ctx?.fixedUnit ? undefined : unit || undefined, dateFrom: date, dateTo: date, orderId: choice?.orderId }}
          />
        }
      />

      {ctxError && <Alert kind="error">{ctxError}</Alert>}

      <div className="form-grid hourly-pickers">
        <UnitPicker ctx={ctx} value={unit} onChange={(v) => { setUnit(v); setChoice(null); }} required />
        <Field label="Date">
          <TextInput type="date" value={date} max={ctx?.today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <OrderStylePicker
          orders={orders}
          value={choice?.key ?? ''}
          onChange={setChoice}
          loading={ordersLoading}
          required
          placeholder={!unit ? 'Choose the unit first' : orders.length ? 'Choose the order' : 'Nothing cut for this unit yet'}
        />
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {!choice ? (
        <EmptyState title="Choose the order" message="The grid shows one row per tailor in the unit, for the order being stitched." />
      ) : loading && !grid ? (
        <Spinner label="Loading the grid" />
      ) : grid ? (
        <>
          <div className="hourly-summary">
            <SummaryFact label="This order today" value={n0(grid.total)} />
            <SummaryFact label={`${grid.unit} today`} value={n0(grid.unitDayTotal)} sub="every order" />
            <SummaryFact
              label="Hourly target"
              value={grid.hourlyTarget == null ? '-' : `${n0(grid.hourlyTarget)} / tailor`}
              sub={grid.hourlyTarget == null ? 'Set it on the style' : 'Under it shows red'}
            />
            <div className="hourly-saving" aria-live="polite">{saving > 0 ? 'Saving…' : 'All saved'}</div>
          </div>

          <div className="hourly-mode" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'hour'} className={`btn ${mode === 'hour' ? 'btn-primary' : ''}`} onClick={() => setMode('hour')}>
              This hour
            </button>
            <button type="button" role="tab" aria-selected={mode === 'day'} className={`btn ${mode === 'day' ? 'btn-primary' : ''}`} onClick={() => setMode('day')}>
              Whole day
            </button>
          </div>

          {grid.rows.length === 0 ? (
            <EmptyState
              title="No tailors in this unit"
              message={`Add the tailors on the Employee master with Designation "Tailor" and Unit / Line "${grid.unit}".`}
            />
          ) : mode === 'hour' ? (
            <HourView grid={grid} slot={slot} setSlot={setSlot} cellProps={cellProps} canWrite={canWrite} filled={filled} />
          ) : (
            <DayView grid={grid} slot={slot} cellProps={cellProps} canWrite={canWrite} />
          )}
        </>
      ) : null}
    </div>
  );
}

function SummaryFact({ label, value, sub }) {
  return (
    <div className="hourly-fact">
      <div className="hourly-fact-label">{label}</div>
      <div className="hourly-fact-value">{value}</div>
      {sub && <div className="hourly-fact-sub">{sub}</div>}
    </div>
  );
}

/** Enter saves (by leaving the box) and moves to the next tailor's box. */
function nextOnEnter(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const boxes = [...document.querySelectorAll('[data-hourly-box]')];
  const i = boxes.indexOf(e.currentTarget);
  if (boxes[i + 1]) boxes[i + 1].focus();
  else e.currentTarget.blur();
}

function CellStatus({ state }) {
  if (!state) return null;
  if (state.status === 'saving') return <span className="cell-status">saving…</span>;
  if (state.status === 'saved') return <span className="cell-status ok">saved</span>;
  return <span className="cell-status bad" title={state.message}>{state.message}</span>;
}

/**
 * The current slot is often past the edge of a phone screen (4:00 is the
 * seventh chip). Bring it into view, sideways only, so the page does not jump.
 */
function useScrollSlotIntoView(slot) {
  const ref = useRef(null);
  useEffect(() => {
    const box = ref.current;
    const target = box?.querySelector(`[data-slot="${CSS.escape(slot)}"]`);
    if (!box || !target) return;
    const left = target.offsetLeft - box.clientWidth / 2 + target.offsetWidth / 2;
    box.scrollTo({ left: Math.max(0, left) });
  }, [slot]);
  return ref;
}

function HourView({ grid, slot, setSlot, cellProps, canWrite, filled }) {
  const stripRef = useScrollSlotIntoView(slot);
  return (
    <>
      <div className="slot-strip" role="tablist" aria-label="Time slot" ref={stripRef}>
        {grid.slots.map((s) => (
          <button
            key={s}
            data-slot={s}
            type="button"
            role="tab"
            aria-selected={s === slot}
            className={`slot-chip ${s === slot ? 'is-active' : ''}`}
            onClick={() => setSlot(s)}
          >
            {s}
            <span className="slot-chip-total">{n0(grid.slotTotals[s] ?? 0)}</span>
          </button>
        ))}
      </div>
      <p className="hint" style={{ margin: '6px 0 10px' }}>
        {slot}: {filled} of {grid.rows.length} tailors filled · {n0(grid.slotTotals[slot] ?? 0)} pieces
      </p>

      <ul className="tailor-list">
        {grid.rows.map((r) => {
          const p = cellProps(r.employeeId, slot);
          return (
            <li key={r.employeeId} className={`tailor-row ${p.short ? 'is-short' : ''}`}>
              <div className="tailor-who">
                <div className="tailor-name">{r.empName}</div>
                <div className="tailor-sub">
                  {r.empId} · day {n0(r.total)}
                  {r.offRoster && <span className="chip" style={{ marginLeft: 6 }}>not on the unit roster</span>}
                </div>
              </div>
              <div className="tailor-input">
                <input
                  data-hourly-box
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  enterKeyHint="next"
                  aria-label={`${r.empName}, ${slot}`}
                  value={p.value}
                  onChange={p.onChange}
                  onBlur={p.onBlur}
                  onKeyDown={nextOnEnter}
                  disabled={!canWrite}
                  aria-invalid={p.state?.status === 'error' ? 'true' : undefined}
                />
                <CellStatus state={p.state} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function DayView({ grid, slot, cellProps, canWrite }) {
  const wrapRef = useScrollSlotIntoView(slot);
  return (
    <div className="hourly-grid-wrap" ref={wrapRef}>
      <table className="hourly-grid">
        <thead>
          <tr>
            <th className="sticky-col">Tailor</th>
            {grid.slots.map((s) => (
              <th key={s} data-slot={s} className={`num ${s === slot ? 'is-now' : ''}`}>{s}</th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r) => (
            <tr key={r.employeeId}>
              <th className="sticky-col" scope="row">
                <div className="tailor-name">{r.empName}</div>
                <div className="tailor-sub">{r.empId}</div>
              </th>
              {grid.slots.map((s) => {
                const p = cellProps(r.employeeId, s);
                return (
                  <td key={s} className={p.short ? 'is-short' : ''}>
                    <input
                      data-hourly-box
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label={`${r.empName}, ${s}`}
                      title={p.state?.status === 'error' ? p.state.message : undefined}
                      value={p.value}
                      onChange={p.onChange}
                      onBlur={p.onBlur}
                      onKeyDown={nextOnEnter}
                      disabled={!canWrite}
                      aria-invalid={p.state?.status === 'error' ? 'true' : undefined}
                    />
                  </td>
                );
              })}
              <td className="num"><strong>{n0(r.total)}</strong></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th className="sticky-col" scope="row">Unit total</th>
            {grid.slots.map((s) => <td key={s} className="num"><strong>{n0(grid.slotTotals[s] ?? 0)}</strong></td>)}
            <td className="num"><strong>{n0(grid.total)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
