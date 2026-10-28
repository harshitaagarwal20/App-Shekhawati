/**
 * What every stitching screen shares: which unit this login works for, the
 * orders cut for it, and the two pickers.
 *
 * The unit is decided by the SERVER from the Unit / Line on the login's
 * Employee record (see stitching.service.js). A supervisor is shown their
 * unit as a fact, not a dropdown; Admin and the office choose one. Hiding
 * the dropdown is a convenience - the server ignores a unit it would refuse.
 */

import { useCallback, useEffect, useState } from 'react';
import { stitching as api } from '../../services/erp.js';
import { Field, RecordSelect } from '../../components/ui.jsx';
import { fmtNum, fmtOrderStyle } from '../../utils/format.js';

/** Units, slots and the write right, loaded once per screen. */
export function useStitchingContext() {
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.context().then(setCtx).catch((e) => setError(e.message));
  }, []);
  return { ctx, error };
}

/** The (order, style) pairs cut for a unit, with issued / stitched / balance. */
export function useUnitOrders(unit) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!unit) {
      setOrders([]);
      return;
    }
    setLoading(true);
    try {
      setOrders(await api.orders({ unit }));
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [unit]);
  useEffect(() => {
    load();
  }, [load]);
  return { orders, loading, reload: load };
}

/** The unit: a fact for a supervisor, a dropdown for everyone else. */
export function UnitPicker({ ctx, value, onChange, required, allowAll = false }) {
  if (!ctx) return null;
  if (ctx.fixedUnit) {
    return (
      <Field label="Unit">
        <div className="unit-fact">{ctx.fixedUnit}</div>
      </Field>
    );
  }
  return (
    <Field label="Unit" required={required}>
      <RecordSelect
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={ctx.units.map((u) => ({ id: u, name: u }))}
        placeholder={allowAll ? 'All units' : 'Choose the unit'}
      />
    </Field>
  );
}

export const orderLabel = fmtOrderStyle;

/**
 * Printing after stitching is optional, so it is a tab beside the stitching
 * record rather than a sidebar link of its own. See ViewTabs.
 */
export const STITCHING_TABS = [
  { key: 'stitching', label: 'Stitching record', to: '/stitching', permission: 'STITCHING_RECORD.VIEW' },
  { key: 'printing', label: 'Printing after stitching', to: '/stitching/printing', permission: 'PRINTING.VIEW' },
];

/** Order No and Style No, chosen together - the style comes with the order. */
export function OrderStylePicker({ orders, value, onChange, loading, required, placeholder, hint }) {
  return (
    <Field label="Order No / Style No" required={required} hint={hint}>
      <RecordSelect
        value={value}
        onChange={(e) => onChange(orders.find((o) => o.key === e.target.value) ?? null)}
        options={orders}
        getValue={(o) => o.key}
        getLabel={orderLabel}
        loading={loading}
        placeholder={placeholder ?? 'Choose the order'}
      />
    </Field>
  );
}

/** Issued, stitched, balance - and a bar, because it is read across a room. */
export function PositionBar({ issued, stitched }) {
  const i = Number(issued) || 0;
  const s = Number(stitched) || 0;
  const pct = i > 0 ? Math.min(100, Math.round((s / i) * 100)) : 0;
  return (
    <div className="stitch-position">
      <div className="stitch-position-track" aria-hidden="true">
        <div className="stitch-position-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="stitch-position-text">
        <strong>{fmtNum(s, { decimals: 0 })}</strong> stitched of {fmtNum(i, { decimals: 0 })} cut pieces issued
        <span className="faint"> · {fmtNum(i - s, { decimals: 0 })} left</span>
      </div>
    </div>
  );
}

/**
 * Minutes after midnight of a slot label. The floor writes the afternoon as
 * "1:00" .. "6:30", so an hour below 8 is read as p.m. A label that is not a
 * time sorts last and is never "now".
 */
export function slotMinutes(label) {
  const m = /^(\d{1,2})(?::(\d{2}))?/.exec(String(label).trim());
  if (!m) return null;
  let h = Number(m[1]);
  if (h < 8) h += 12;
  return h * 60 + Number(m[2] ?? 0);
}

/** The slot the supervisor is most likely filling right now (India time). */
export function currentSlot(slots, now = new Date()) {
  if (!slots?.length) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const mins = Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value);
  let pick = slots[0];
  for (const s of slots) {
    const at = slotMinutes(s);
    if (at != null && at <= mins) pick = s;
  }
  return pick;
}
