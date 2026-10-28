import { useId } from 'react';
import { TextInput } from './ui.jsx';
import { todayInput } from '../utils/format.js';

/** YYYY-MM-DD arithmetic on the calendar date alone, so no timezone can shift it. */
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The quick ranges, each ending today except Yesterday. */
function presets(today = todayInput()) {
  return [
    { key: 'today', label: 'Today', range: [today, today] },
    { key: 'yesterday', label: 'Yesterday', range: [addDays(today, -1), addDays(today, -1)] },
    { key: '7', label: '7 days', range: [addDays(today, -6), today] },
    { key: '30', label: '30 days', range: [addDays(today, -29), today] },
  ];
}

/**
 * Inclusive date range for dated registers: one label, the quick ranges beside
 * it, and the two dates under it.
 */
export default function DateRangeFilter({
  filters,
  setFilter,
  fromKey = 'dateFrom',
  toKey = 'dateTo',
  label = 'Date',
  fromLabel = 'Date from',
  toLabel = 'Date to',
}) {
  const id = useId();
  const from = filters[fromKey] ?? '';
  const to = filters[toKey] ?? '';

  return (
    <div className="field date-range">
      <div className="date-range-head">
        <label htmlFor={id}>{label}</label>
        <span className="date-range-quick">
          {presets().map((p) => (
            <button
              key={p.key}
              type="button"
              className={p.range[0] === from && p.range[1] === to ? 'is-active' : ''}
              onClick={() => {
                setFilter(fromKey, p.range[0]);
                setFilter(toKey, p.range[1]);
              }}
            >
              {p.label}
            </button>
          ))}
        </span>
      </div>
      <div className="date-range-inputs">
        <TextInput id={id} type="date" aria-label={fromLabel} value={from} max={to || undefined}
          onChange={(e) => setFilter(fromKey, e.target.value)} />
        <span aria-hidden="true">–</span>
        <TextInput type="date" aria-label={toLabel} value={to} min={from || undefined}
          onChange={(e) => setFilter(toKey, e.target.value)} />
      </div>
    </div>
  );
}
