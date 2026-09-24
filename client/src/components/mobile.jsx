/**
 * Shop-floor components: Fabric Issue, Gate Pass and Cutting Issue.
 *
 * ===========================================================================
 *  THESE SCREENS ARE USED STANDING UP
 * ===========================================================================
 *
 * Not at a desk. On a phone, next to a rack or at the gate, often one-handed,
 * often by somebody also holding a roll of fabric. Everything below follows
 * from that:
 *
 *   LARGE TOUCH TARGETS.  `PickerCard` and `BigButton` are 56px+ tall. The
 *                         thumb of somebody wearing a work glove is not a
 *                         mouse pointer.
 *
 *   MINIMAL TYPING.       `PickerCard` shows a roll's number, fabric, colour
 *                         and balance so nothing has to be transcribed, and
 *                         `ScanBox` takes a scanner or a typed code. The only
 *                         thing a storeman should have to key is a quantity.
 *
 *   CLEAR QUANTITY ENTRY. `QtyStepper` is a big numeric field with a numeric
 *                         keypad, the UOM beside it, the available balance
 *                         under it, and a "max" button - because the commonest
 *                         entry by far is "all of it".
 *
 *   ERRORS YOU CANNOT MISS. `FloorAlert` is full-width and high-contrast. A
 *                         four-point red hint under an input is invisible in
 *                         daylight on a scratched screen.
 *
 *   CONFIRM BEFORE POSTING. `ConfirmSheet` restates what is about to happen in
 *                         a sentence, from the bottom of the screen where the
 *                         thumb is. Posting is irreversible in all three of
 *                         these modules.
 */

import { useEffect, useRef, useState } from 'react';
import { fmtNum } from '../utils/format.js';

/**
 * A big, tappable row for choosing a roll, a document or a unit.
 *
 * The whole card is the target, not a radio button inside it.
 */
export function PickerCard({ selected, onSelect, title, subtitle, meta, right, disabled, badge }) {
  return (
    <button
      type="button"
      className={`picker-card ${selected ? 'picker-selected' : ''} ${disabled ? 'picker-disabled' : ''}`}
      onClick={() => !disabled && onSelect?.()}
      disabled={disabled}
      aria-pressed={selected}
    >
      <span className="picker-main">
        <span className="picker-title">
          {title}
          {badge && <span className="picker-badge">{badge}</span>}
        </span>
        {subtitle && <span className="picker-subtitle">{subtitle}</span>}
        {meta && <span className="picker-meta">{meta}</span>}
      </span>
      {right && <span className="picker-right">{right}</span>}
    </button>
  );
}

/**
 * A searchable, scrollable list of PickerCards.
 *
 * Search filters what is already loaded rather than firing a request per
 * keystroke: these lists are a page of rolls, not a table of ten thousand, and
 * a filter that works with no signal is worth more on a factory floor than one
 * that is always current.
 */
export function PickerList({
  items,
  loading,
  selectedId,
  onSelect,
  getId = (i) => i.id,
  render,
  searchPlaceholder = 'Search or scan...',
  searchKeys = [],
  emptyMessage = 'Nothing to choose from.',
  onScan,
}) {
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const filtered = !needle
    ? items
    : items.filter((item) =>
        searchKeys.some((k) => String(item[k] ?? '').toLowerCase().includes(needle)),
      );

  return (
    <div className="picker-list">
      <ScanBox
        value={query}
        onChange={setQuery}
        placeholder={searchPlaceholder}
        onScan={(code) => {
          // An exact match on a scanned code selects it outright - the whole
          // point of scanning is not having to then tap the right row.
          const hit = items.find((item) =>
            searchKeys.some((k) => String(item[k] ?? '').toLowerCase() === code.toLowerCase()),
          );
          if (hit) {
            onSelect(getId(hit), hit);
            setQuery('');
          } else {
            onScan?.(code);
          }
        }}
      />

      {loading && <div className="picker-empty muted">Loading...</div>}

      {!loading && filtered.length === 0 && (
        <div className="picker-empty muted">{needle ? 'Nothing matches that.' : emptyMessage}</div>
      )}

      <div className="picker-scroll">
        {filtered.map((item) => {
          const id = getId(item);
          return (
            <div key={id}>
              {render(item, { selected: id === selectedId, select: () => onSelect(id, item) })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A search box that also takes a barcode scanner.
 *
 * A hardware scanner behaves as a keyboard that types fast and finishes with
 * Enter. Catching that Enter is the whole of "barcode-ready": no camera
 * permission, no library, and it works with the cheap USB and Bluetooth wedges
 * a factory already owns. If a camera-based scanner is added later it calls the
 * same `onScan`.
 */
export function ScanBox({ value, onChange, placeholder, onScan, autoFocus }) {
  const ref = useRef(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <div className="scan-box">
      <span className="scan-icon" aria-hidden="true">
        ⌕
      </span>
      <input
        ref={ref}
        type="search"
        inputMode="search"
        className="scan-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const code = value.trim();
            if (code) onScan?.(code);
          }
        }}
        aria-label={placeholder}
      />
      {value && (
        <button type="button" className="scan-clear" onClick={() => onChange('')} aria-label="Clear">
          ×
        </button>
      )}
    </div>
  );
}

/**
 * The quantity field.
 *
 * Big, numeric-keypad, with the available balance underneath and a "max"
 * button - because on a shop floor the commonest entry by a distance is the
 * whole roll, and making that one tap removes the commonest typing mistake.
 */
export function QtyStepper({
  value,
  onChange,
  uom,
  label = 'Quantity',
  available,
  max,
  error,
  hint,
  disabled,
  compact = false,
}) {
  const over = available !== undefined && available !== null && Number(value) > Number(available);

  return (
    <div className={`qty-stepper ${compact ? 'qty-stepper-compact' : ''} ${error || over ? 'qty-error' : ''}`}>
      <label className="qty-label" htmlFor="qty-stepper-input">
        {label}
        {uom && <span className="qty-uom">{uom}</span>}
      </label>

      <div className="qty-row">
        <input
          id="qty-stepper-input"
          className="qty-input"
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error || over ? 'true' : undefined}
        />
        {max !== undefined && max !== null && (
          <button
            type="button"
            className="btn qty-max"
            disabled={disabled}
            onClick={() => onChange(String(max))}
          >
            Max
          </button>
        )}
      </div>

      {available !== undefined && available !== null && (
        <div className={`qty-available ${over ? 'qty-available-over' : ''}`}>
          {over ? 'Only ' : 'Available: '}
          <strong>{fmtNum(available, { decimals: 2 })}</strong> {uom}
          {over && ' — this is more than that.'}
        </div>
      )}
      {hint && !error && !over && <div className="hint">{hint}</div>}
      {error && <div className="err">{error}</div>}
    </div>
  );
}

/** A full-width, unmissable message. Not a four-point hint under an input. */
export function FloorAlert({ kind = 'info', title, children, onDismiss }) {
  if (!children && !title) return null;
  return (
    <div className={`floor-alert floor-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="floor-alert-body">
        {title && <strong className="floor-alert-title">{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="floor-alert-dismiss" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}

/** A primary action sized for a thumb. */
export function BigButton({ children, onClick, kind = 'primary', disabled, busy, type = 'button' }) {
  return (
    <button
      type={type}
      className={`big-button big-${kind}`}
      onClick={onClick}
      disabled={disabled || busy}
    >
      {busy ? 'Working...' : children}
    </button>
  );
}

/**
 * The confirmation before an irreversible post.
 *
 * Rises from the bottom of the screen, where the thumb already is, and restates
 * in one sentence what is about to happen. All three shop-floor modules post
 * something that cannot be taken back - fabric off a rack, goods through a
 * gate, cloth cut - so all three ask first.
 */
export function ConfirmSheet({
  open,
  title,
  summary,
  lines = [],
  warning,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  busy,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onCancel, busy]);

  if (!open) return null;

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel?.()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grabber" aria-hidden="true" />
        <h2 className="sheet-title">{title}</h2>

        {summary && <p className="sheet-summary">{summary}</p>}

        {lines.length > 0 && (
          <dl className="sheet-lines">
            {lines.map((l) => (
              <div key={l.label} className="sheet-line">
                <dt>{l.label}</dt>
                <dd>{l.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {warning && <FloorAlert kind="warning">{warning}</FloorAlert>}

        <div className="sheet-actions">
          <BigButton kind="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </BigButton>
          <BigButton kind="primary" onClick={onConfirm} busy={busy}>
            {confirmLabel}
          </BigButton>
        </div>
      </div>
    </div>
  );
}

/**
 * The verification checklist a Cutting Issue must satisfy.
 *
 * Every check is shown - passed as well as failed - because a supervisor
 * waiting on a plan approval needs to see that the other eight are fine, not
 * just that something is wrong.
 */
export function CheckList({ checks = [], title = 'Verification' }) {
  if (checks.length === 0) return null;
  const failed = checks.filter((c) => !c.passed).length;

  return (
    <div className={`checklist ${failed ? 'checklist-failed' : 'checklist-passed'}`}>
      <div className="checklist-header">
        <strong>{title}</strong>
        <span className={failed ? 'checklist-count-bad' : 'checklist-count-ok'}>
          {failed === 0 ? `All ${checks.length} checks passed` : `${failed} of ${checks.length} failed`}
        </span>
      </div>
      <ol className="checklist-items">
        {checks.map((c) => (
          <li key={c.code} className={c.passed ? 'check-pass' : 'check-fail'}>
            <span className="check-mark" aria-hidden="true">
              {c.passed ? '✓' : '✕'}
            </span>
            <span className="check-body">
              <span className="check-label">{c.label}</span>
              <span className="check-message">{c.message}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A labelled read-only fact, sized to be read at arm's length. */
export function FloorFact({ label, value, sub, tone = '' }) {
  return (
    <div className={`floor-fact ${tone}`}>
      <div className="floor-fact-label">{label}</div>
      <div className="floor-fact-value">{value ?? '-'}</div>
      {sub && <div className="floor-fact-sub">{sub}</div>}
    </div>
  );
}
