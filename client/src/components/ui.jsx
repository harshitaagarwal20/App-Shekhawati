/**
 * Shared presentational components.
 *
 * Note on `MasterSelect`: it is the ONLY dropdown used for business values in
 * this application, and it always reads its options from the List Master by
 * code. There are no hardcoded business option lists in the client.
 *
 * All three dropdowns - EnumSelect, MasterSelect and RecordSelect - render a
 * `Combobox`, so every one of them can be typed into. Their props are
 * unchanged: each still takes `value` / `onChange` and still works with
 * react-hook-form's `register()`. See Combobox.jsx for how that is kept true.
 */

import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMasterList } from '../hooks/useMasterList.js';
import { Combobox } from './Combobox.jsx';

// --- Feedback --------------------------------------------------------------

export function Alert({ kind = 'info', children, onDismiss }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="spread">
        <div>{children}</div>
        {onDismiss && (
          <button type="button" className="btn-link" onClick={onDismiss}>
            dismiss
          </button>
        )}
      </div>
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <span className="row">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="muted">{label}</span>}
    </span>
  );
}

export function EmptyState({ title = 'Nothing here yet', message, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {message && <p className="muted">{message}</p>}
      {action}
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    ACTIVE: 'badge-active',
    INACTIVE: 'badge-inactive',
    PENDING: 'badge-pending',
    APPROVED: 'badge-approved',
    REJECTED: 'badge-rejected',
    IN_PROGRESS: 'badge-info',
    COMPLETED: 'badge-approved',
    ON_HOLD: 'badge-pending',
    CANCELLED: 'badge-inactive',
  };
  const label = String(status ?? '').replace(/_/g, ' ');
  return <span className={`badge ${map[status] ?? 'badge-inactive'}`}>{label || '-'}</span>;
}

// --- Page chrome -----------------------------------------------------------

/**
 * The heading every screen opens with: the name of the screen, and the buttons
 * that act on it.
 *
 * DELIBERATELY JUST THE TITLE. Every screen used to carry a `subtitle` - a
 * sentence explaining what it was for - and an `excelRef` naming the workbook
 * sheet it replaced. Both are gone: a line of prose under every heading reads
 * as clutter once you know the screen, which is after the first day and for
 * the rest of the years the office uses this.
 *
 * The explaining now happens where somebody looks when they are ACTUALLY
 * stuck - the field hints, the empty states and the error messages - none of
 * which are on screen until they are needed.
 */
export function PageHeader({ title, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

// --- Form primitives -------------------------------------------------------

export function Field({ label, required, error, hint, htmlFor, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label htmlFor={htmlFor}>
          {label}
          {required && <span className="req">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

export const TextInput = forwardRef(function TextInput({ error, ...props }, ref) {
  return <input ref={ref} aria-invalid={error ? 'true' : undefined} {...props} />;
});

/**
 * An input that shows its unit inside the box - "2 %", "0.0525 Mtrs".
 *
 * The unit was living in the LABEL ("Excess %") and in a hint underneath
 * ("Entered as a percentage: 2 means 2%"). Both are read once, when the form
 * opens; neither is on screen at the moment somebody is looking at the number
 * they typed and asking "two what?". A figure that could be either a fraction
 * or a percentage - and 0.02 and 2 are both plausible answers here - has to
 * carry its unit beside the digits.
 *
 * The suffix is decoration, not a field: `aria-hidden` keeps a screen reader
 * from announcing it twice (the label already says it), and pointer-events are
 * off so clicking it lands in the input behind.
 */
export const SuffixInput = forwardRef(function SuffixInput({ suffix, ...props }, ref) {
  /*
   * No unit, no ornament. RHFQty passes the roll's unit, which is empty until
   * a roll is chosen and absent altogether on a field like Rate - and an empty
   * badge plus the padding reserved for it is a box that looks broken rather
   * than a box with nothing to add.
   */
  if (!suffix) return <TextInput ref={ref} {...props} />;

  return (
    <span className="input-suffix-wrap">
      <TextInput ref={ref} {...props} />
      <span className="input-suffix" aria-hidden="true">{suffix}</span>
    </span>
  );
});

export const TextArea = forwardRef(function TextArea({ error, ...props }, ref) {
  return <textarea ref={ref} aria-invalid={error ? 'true' : undefined} {...props} />;
});

/**
 * A select whose options come from a plain array. Use this only for
 * non-business enumerations (sort direction, page size, workflow enums that are
 * fixed in the schema). Business dropdowns must use MasterSelect.
 */
export const EnumSelect = forwardRef(function EnumSelect(
  { error, options, placeholder = 'Select...', includeBlank = true, ...props },
  ref,
) {
  return (
    <Combobox
      ref={ref}
      error={error}
      options={options}
      getValue={(o) => (typeof o === 'string' ? o : o.value)}
      getLabel={(o) => (typeof o === 'string' ? o : (o.label ?? o.value))}
      placeholder={placeholder}
      includeBlank={includeBlank}
      {...props}
    />
  );
});

/**
 * Business dropdown. Reads its options from the List Master at runtime.
 *
 * @param {string} listCode  A Master List code, e.g. 'ColorCode', 'UOM'
 */
export const MasterSelect = forwardRef(function MasterSelect(
  { listCode, error, placeholder = 'Select...', includeBlank = true, currentValue, ...props },
  ref,
) {
  const { values, loading, error: loadError } = useMasterList(listCode);

  // A record may hold a value that has since been deactivated. Keep showing it
  // rather than silently blanking the field on edit.
  const known = values.some((v) => v.value === currentValue);
  const extra = currentValue && !known && !loading ? [{ id: '__current', value: currentValue }] : [];

  return (
    <Combobox
      ref={ref}
      error={error}
      loading={loading}
      options={[...values, ...extra]}
      getValue={(v) => v.value}
      getLabel={(v) => `${v.value}${v.id === '__current' ? ' (inactive)' : ''}`}
      placeholder={loadError ? 'List unavailable' : placeholder}
      includeBlank={includeBlank}
      emptyLabel={loadError ? 'List unavailable' : 'No match'}
      {...props}
    />
  );
});

/** Select backed by a record master's /options endpoint (Buyer, Vendor, ...). */
export const RecordSelect = forwardRef(function RecordSelect(
  { options = [], getValue = (o) => o.id, getLabel = (o) => o.name, error, placeholder = 'Select...', loading, ...props },
  ref,
) {
  return (
    <Combobox
      ref={ref}
      error={error}
      loading={loading}
      options={options}
      getValue={getValue}
      getLabel={getLabel}
      placeholder={placeholder}
      {...props}
    />
  );
});

// --- Modal -----------------------------------------------------------------

export function Modal({ title, onClose, children, footer, size = '' }) {
  const boxRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  /*
   * THE CURSOR STARTS IN THE DIALOG, NOT BEHIND IT.
   *
   * Opening a dialog used to leave focus on the button that opened it, which
   * is on the page underneath. Three things follow from that, and all three
   * were happening:
   *
   *   Typing went nowhere. "New buyer" opens on Buyer Code, and the natural
   *   thing is to start typing it - but the keystrokes reached the list
   *   behind the dialog.
   *
   *   Tab walked the page, not the form. The first Tab moved to whatever
   *   followed the New button in the list toolbar - invisible, under the
   *   backdrop - so a keyboard user had no way into their own dialog.
   *
   *   A screen reader announced nothing, because nothing had moved.
   *
   * The first enabled field is chosen where there is one, because that is
   * where the person is about to type. Failing that the dialog box itself
   * takes focus (it carries tabIndex={-1} for exactly this), which still puts
   * Tab inside the dialog and still lets the reader announce it.
   *
   * Deliberately NOT a focus trap. Trapping needs care to do correctly, and
   * getting it half-right is worse than not doing it - Escape closes, the
   * backdrop closes, and focus now starts in the right place, which is the
   * part people were actually losing.
   */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const field = box.querySelector(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    (field ?? box).focus({ preventScroll: true });
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className={`modal ${size}`}
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        {/*
          THE BODY IS THE DIALOG'S JOB, NOT THE CALLER'S.

          This used to render `children` bare and leave every caller to
          remember its own `.modal-body` wrapper for the padding. Eighteen of
          the twenty-eight dialogs in the app forgot, and their content sat
          flush against the edge of the box. A wrapper that is always here
          cannot be forgotten; the ones that still pass their own nest
          harmlessly, because `.modal-body .modal-body` carries no padding.
        */}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }) {
  return (
    <Modal
      title={title}
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="modal-body">{message}</div>
    </Modal>
  );
}

// --- Table -----------------------------------------------------------------

/**
 * A small menu hung off a button, rendered through a portal.
 *
 * ===========================================================================
 *  WHY A PORTAL, AND NOT `position: absolute`
 * ===========================================================================
 *
 *  Both of this file's menus live INSIDE a table: the column menu in the
 *  header cell, the row actions in the last cell of every row. That table sits
 *  in `.table-wrap`, which sets `overflow-x: auto` - and a box that scrolls on
 *  one axis clips on both. An absolutely positioned menu is therefore sliced
 *  off at the wrapper's edge: fine in the middle of a long list, cut in half on
 *  the last row, and cut immediately on a table with two rows in it.
 *
 *  Combobox already met this and solved it by portalling its list to the body
 *  and positioning it `fixed` against the trigger's own rectangle. That is the
 *  same problem, so this is the same answer, written once for both menus
 *  rather than a third time.
 *
 *  The rectangle is re-measured on scroll (capture phase, so an ancestor
 *  scrolling counts) and on resize, and the menu flips above the button when
 *  there is more room up than down.
 * ===========================================================================
 */
const MENU_MAX_H = 320;

export function DropdownMenu({ trigger, children, label, align = 'right', menuClassName = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const measure = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const flip = below < 180 && r.top > below;
    setPos({
      ...(align === 'right'
        ? { right: window.innerWidth - r.right }
        : { left: r.left }),
      ...(flip
        ? { bottom: window.innerHeight - r.top + 4, top: 'auto', maxHeight: Math.min(MENU_MAX_H, r.top - 8) }
        : { top: r.bottom + 4, bottom: 'auto', maxHeight: Math.min(MENU_MAX_H, below - 8) }),
    });
  }, [align]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      // The menu is portalled out of the button's subtree, so it has to be
      // asked about separately - otherwise clicking an item counts as
      // "outside" and shuts the menu before the click lands.
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      {trigger({ ref: btnRef, open, toggle: () => setOpen((v) => !v), label })}
      {open && pos && createPortal(
        <div
          className={`portal-menu ${menuClassName}`}
          role="menu"
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', ...pos }}
        >
          {children({ close: () => setOpen(false) })}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Several values chosen from a list, behind one control.
 *
 * ---------------------------------------------------------------------------
 *  WHY NOT A PLAIN <select>
 *
 *  The thing being chosen here is a SET - a user holds Admin and QC, or three
 *  roles, or one. A single-value dropdown cannot say that, and a native
 *  `<select multiple>` says it with ctrl-click, which nobody outside a
 *  developer's machine discovers.
 *
 *  So the trigger reads back what is chosen and the menu holds the checkboxes,
 *  which is the same shape as the column menu two components up. Nine roles
 *  standing permanently open as a checklist was nine rows of form that were
 *  only ever read once; folded away, the form is one line until it is needed.
 * ---------------------------------------------------------------------------
 */
export function MultiSelect({
  options = [],
  selected = [],
  onChange,
  placeholder = 'Select...',
  emptyLabel = 'Nothing to choose from',
  id,
}) {
  const chosen = options.filter((o) => selected.includes(o.value));

  /*
   * Name them while the list is short enough to read, and count them after.
   * "Admin, QC" tells you what you picked; "Admin, Cutting Supervisor, Head
   * Office, Merchandising & Planning" is a paragraph inside a button.
   */
  const summary = chosen.length === 0
    ? placeholder
    : chosen.length <= 2
      ? chosen.map((o) => o.label).join(', ')
      : `${chosen.length} selected`;

  const toggle = (value) => {
    onChange(selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value]);
  };

  return (
    <DropdownMenu
      align="left"
      label={placeholder}
      menuClassName="multi-menu"
      trigger={({ ref, open, toggle: t }) => (
        <button
          type="button"
          id={id}
          ref={ref}
          className={`multi-trigger ${open ? 'is-open' : ''} ${chosen.length ? '' : 'is-empty'}`}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={t}
        >
          <span className="multi-summary">{summary}</span>
          <span className="multi-caret" aria-hidden="true">▾</span>
        </button>
      )}
    >
      {() => (
        <>
          {options.map((o) => (
            <label key={o.value} className="col-menu-item">
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
              />
              <span>
                {o.label}
                {o.hint && <span className="faint mono"> {o.hint}</span>}
              </span>
            </label>
          ))}
          {options.length === 0 && <div className="col-menu-item muted">{emptyLabel}</div>}
        </>
      )}
    </DropdownMenu>
  );
}

/**
 * The actions on one row: Edit, Activate/Deactivate, Delete.
 *
 * ---------------------------------------------------------------------------
 *  THREE LINKS ON EVERY ROW IS THREE LINKS TOO MANY
 *
 *  They were rendered inline, so a list of forty buyers carried a hundred and
 *  twenty buttons. Two problems follow from that, and the second is the one
 *  that matters:
 *
 *    The column is wide and loud. "Edit Deactivate Delete" repeated down the
 *    page competes with the data it belongs to, and Delete - in red - is the
 *    single most eye-catching thing on a screen whose purpose is to look
 *    things up.
 *
 *    DELETE IS ONE CLICK AWAY, ON EVERY ROW, FOR EVERYONE WHO CAN SEE IT.
 *    A mis-aimed click on a dense table is not a rare event, and the target
 *    sits a few pixels from the Edit people actually want.
 *
 *  Behind one button, the destructive action costs a deliberate second click
 *  and cannot be hit by accident. Nothing is removed; the confirmation dialog
 *  that already guards Delete still runs.
 * ---------------------------------------------------------------------------
 */
export function RowActions({ items }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;

  return (
    <DropdownMenu
      label="Row actions"
      trigger={({ ref, open, toggle, label }) => (
        <button
          type="button"
          ref={ref}
          className={`row-actions-btn ${open ? 'is-open' : ''}`}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={label}
          title={label}
          onClick={toggle}
        >
          {/* Three dots, the usual sign for "more on this row". */}
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="3" r="1.5" fill="currentColor" />
            <circle cx="8" cy="8" r="1.5" fill="currentColor" />
            <circle cx="8" cy="13" r="1.5" fill="currentColor" />
          </svg>
        </button>
      )}
    >
      {({ close }) => shown.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`portal-menu-item ${item.danger ? 'danger' : ''}`}
          disabled={item.disabled}
          /* A refused action says why on hover - "3 user(s) still hold this
             role" - rather than being greyed out with no explanation. */
          title={item.title}
          onClick={() => {
            close();
            item.onClick();
          }}
        >
          {item.label}
        </button>
      ))}
    </DropdownMenu>
  );
}

/**
 * The column menu, in the top-right corner of a list header - Odoo's pattern.
 *
 * It sits in the header ROW rather than in the toolbar on purpose: it is a
 * control over the columns, and putting it anywhere else makes people hunt for
 * it among the search and filter controls, which do something else entirely.
 *
 * Driven by useOptionalColumns, which owns the state and remembers it.
 */
export function ColumnMenu({ options, toggle, reset, customised }) {
  if (!options?.length) return null;

  return (
    <th className="col-menu-cell">
      <DropdownMenu
        label="Choose columns"
        menuClassName="col-menu"
        trigger={({ ref, open, toggle: t, label }) => (
          <button
            type="button"
            ref={ref}
            className="col-menu-btn"
            aria-haspopup="true"
            aria-expanded={open}
            aria-label={label}
            title={label}
            onClick={t}
          >
            {/* Three stacked bars: a table, seen end-on. */}
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.5" y="2.5" width="13" height="2.4" rx="1" fill="currentColor" />
              <rect x="1.5" y="6.8" width="13" height="2.4" rx="1" fill="currentColor" />
              <rect x="1.5" y="11.1" width="13" height="2.4" rx="1" fill="currentColor" />
            </svg>
          </button>
        )}
      >
        {() => (
          <>
            <div className="col-menu-head">Columns</div>
            {options.map((c) => (
              <label key={c.key} className="col-menu-item">
                <input type="checkbox" checked={c.checked} onChange={() => toggle(c.key)} />
                <span>{c.label}</span>
              </label>
            ))}
            {customised && (
              <button type="button" className="col-menu-reset" onClick={reset}>
                Reset to default
              </button>
            )}
          </>
        )}
      </DropdownMenu>
    </th>
  );
}

export function SortableTh({ field, label, sortBy, sortDir, onSort, className = '' }) {
  const active = sortBy === field;
  return (
    <th
      className={`sortable ${className}`}
      onClick={() => onSort(field)}
      role="columnheader"
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      {active && <span className="dir">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

export function Pagination({ meta, page, pageSize, onPage, onPageSize }) {
  const pageCount = meta.pageCount ?? 0;
  const from = meta.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, meta.total ?? 0);

  /*
   * NOTHING TO PAGE THROUGH, NOTHING TO SHOW.
   *
   * A register that fits on one page was still drawing the whole apparatus:
   * a rows-per-page selector, First, Prev, "Page 1 of 1", Next, Last. On an
   * empty screen that read as "No records" followed by five controls for
   * moving between pages that do not exist - and on a phone it is a block of
   * chrome taller than the emptiness it is explaining.
   *
   * The count stays either way. "No records" and "Showing 1-7 of 7" are the
   * answer to a question somebody asked; the pager is machinery for a problem
   * they do not have until the list outgrows a page.
   */
  const paged = pageCount > 1;

  return (
    <div className="pagination">
      <div>
        {meta.total === 0 ? 'No records' : `Showing ${from}-${to} of ${meta.total}`}
      </div>
      {paged && (
      <div className="row">
        <label className="row" style={{ gap: 6 }}>
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            style={{ width: 'auto' }}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="pages">
          {/* `pg-edge` so the phone stylesheet can drop First and Last. On a
              narrow screen five controls do not fit, and jumping to the last
              page is the one nobody standing on a factory floor needs. */}
          <button
            type="button"
            className="btn btn-sm pg-edge"
            onClick={() => onPage(1)}
            disabled={page <= 1}
          >
            First
          </button>
          <button type="button" className="btn btn-sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
            Prev
          </button>
          <span className="nowrap" style={{ padding: '0 6px' }}>
            Page {page} of {Math.max(pageCount, 1)}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onPage(page + 1)}
            disabled={page >= pageCount}
          >
            Next
          </button>
          <button
            type="button"
            className="btn btn-sm pg-edge"
            onClick={() => onPage(pageCount)}
            disabled={page >= pageCount}
          >
            Last
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
