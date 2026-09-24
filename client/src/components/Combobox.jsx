/**
 * A dropdown you can type into.
 *
 * ===========================================================================
 *  WHY THIS EXISTS
 * ===========================================================================
 *
 *  Every dropdown in this application was a native `<select>`. That is fine for
 *  a list of five, and unusable for the ones that matter: an order picker with
 *  every live order in it, a style picker, a vendor picker, a colour list that
 *  grows every season. Finding "TR-0751-009" in a native select means scrolling
 *  a list that offers no way to narrow itself - and the one thing the person
 *  looking always knows is roughly what it is called.
 *
 * ---------------------------------------------------------------------------
 *  WHY IT EMULATES A `<select>` RATHER THAN REPLACING IT
 *
 *  Around fifty call sites pass `value` / `onChange` and read `e.target.value`,
 *  and a dozen more hand this control straight to react-hook-form's
 *  `register()`, which supplies `name`, `onChange`, `onBlur` and a `ref` and
 *  expects a real form element on the end of them.
 *
 *  So this renders a hidden `<input>` that IS the form element - the ref goes
 *  there, RHF reads its value, a plain `<form>` would submit it - and drives it
 *  from the visible combobox above. Selecting an option calls
 *  `onChange({ target: { name, value } })`, which is the shape every existing
 *  handler already destructures. Nothing at any call site had to change.
 *
 *  WHY NOT A LIBRARY
 *
 *  The client has four runtime dependencies and no component kit. Adding one
 *  for a single control - and the bundle, the version and the styling override
 *  that come with it - is a worse trade than two hundred lines that match the
 *  application's own CSS and behave exactly as this application needs.
 * ---------------------------------------------------------------------------
 *
 *  Keyboard, which is the whole point for a data-entry screen:
 *
 *      type          filters, and opens the list if it is shut
 *      Down / Up     move the highlight, opening the list on the first Down
 *      Enter         take the highlighted option
 *      Escape        shut the list and put the text back
 *      Tab           leave; whatever was committed stays committed
 */

import { forwardRef, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** How tall the list is allowed to get; matches `max-height` on .combo-list. */
const LIST_MAX_H = 260;

/** Case- and space-insensitive "contains", which is how people actually search. */
function matches(haystack, needle) {
  return String(haystack ?? '')
    .toLowerCase()
    .includes(needle.toLowerCase().trim());
}

export const Combobox = forwardRef(function Combobox(
  {
    options = [],
    getValue = (o) => o.value,
    getLabel = (o) => o.label,
    /* NO DEFAULT. `value = ''` would make `isControlled` below always true,
       which is exactly the bug this pair of modes exists to avoid. */
    value,
    onChange,
    onBlur,
    name,
    id,
    placeholder = 'Select...',
    emptyLabel = 'No match',
    /*
     * WHAT TO SAY WHEN THERE WAS NEVER ANYTHING TO CHOOSE.
     *
     * `emptyLabel` answers a SEARCH - "No match" means what you typed matched
     * nothing. A list that arrived empty was not searched, and saying "No
     * match" about it blames the user for a box they had not touched.
     *
     * The two cases look identical on screen and are completely different
     * underneath: one is fixed by typing less, the other by filling in the
     * field this list depends on. The Job Work form showed the worst version -
     * the placeholder said "Choose a roll first", and opening it offered
     * "Choose a roll first" as a pickable line AND "No match" underneath, so
     * one empty list gave three contradictory signals.
     */
    noOptionsLabel = 'Nothing to choose from yet',
    disabled,
    loading,
    error,
    includeBlank = true,
    blankLabel,
    className = '',
    ...rest
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  /*
   * WHERE THE LIST IS DRAWN, AND WHY IT IS NOT DRAWN WHERE IT LIVES.
   *
   * The list used to be `position: absolute` inside `.combo`, which is correct
   * until the combo sits inside a scrolling container. `.table-wrap` sets
   * `overflow-x: auto`, and CSS computes the other axis to `auto` with it - so
   * the wrapper clips vertically, and a dropdown opening below the last row of
   * a table was sliced off at the wrapper's edge. `z-index` cannot help: this
   * is clipping, not stacking.
   *
   * So the list is portalled to <body> and positioned in viewport coordinates.
   * It is measured when it opens and re-measured while it is open, because the
   * thing it is anchored to can be scrolled out from under it.
   */
  const [menuPos, setMenuPos] = useState(null);
  const hiddenRef = useRef(null);
  const listId = useId();

  /*
   * CONTROLLED OR UNCONTROLLED, BECAUSE BOTH ARE IN USE.
   *
   * Most screens pass `value` and `onChange` and this behaves as a controlled
   * input. But a dozen hand the control straight to react-hook-form's
   * `register()`, which passes `name`, `onChange`, `onBlur` and a `ref` and NO
   * `value` - a native <select> is uncontrolled there, and RHF reads the value
   * off the DOM node the ref points at.
   *
   * The first version assumed `value` always arrived. On those screens it was
   * always `undefined`, so nothing ever looked selected: picking a buyer wrote
   * the id into the form and the box went straight back to "Select buyer...".
   *
   * So: `value` wins when it is given, and otherwise this keeps its own and
   * mirrors it onto the hidden input that RHF is holding. `syncFromDom` covers
   * the other direction - RHF setting a value itself, which is what happens
   * when an edit form loads its defaults.
   */
  const isControlled = value !== undefined && value !== null;
  const [innerValue, setInnerValue] = useState('');
  const current = isControlled ? value : innerValue;

  // Deliberately runs on every render, with no dependency list: it is watching
  // for a value react-hook-form wrote straight onto the DOM node, which no
  // dependency can describe. Both branches only set state when something has
  // actually changed, so this cannot loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isControlled) {
      // Keep the form element in step with the prop, so a controlled caller's
      // value is what a native submit or RHF would read.
      if (hiddenRef.current && hiddenRef.current.value !== String(value)) {
        hiddenRef.current.value = String(value);
      }
      return;
    }
    const fromDom = hiddenRef.current?.value ?? '';
    if (fromDom !== innerValue) setInnerValue(fromDom);
  });

  const selected = useMemo(
    () => options.find((o) => String(getValue(o)) === String(current)) ?? null,
    [options, current, getValue],
  );
  const selectedLabel = selected ? getLabel(selected) : '';

  /*
   * The filter runs only while the list is open AND something has been typed.
   * A closed control shows the selected label, and re-opening a control the
   * user has not typed into shows everything - so "open it and look" still
   * works for somebody who does not know what they are looking for.
   */
  const shown = useMemo(() => {
    if (!query.trim()) return options;
    return options.filter((o) => matches(getLabel(o), query) || matches(getValue(o), query));
  }, [options, query, getLabel, getValue]);

  /** Anchor the portalled list to the field, flipping above it when short of room. */
  const measure = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const flip = below < Math.min(LIST_MAX_H, 160) && r.top > below;
    setMenuPos({
      left: r.left,
      width: r.width,
      ...(flip
        ? { bottom: window.innerHeight - r.top + 2, top: 'auto', maxHeight: Math.min(LIST_MAX_H, r.top - 8) }
        : { top: r.bottom + 2, bottom: 'auto', maxHeight: Math.min(LIST_MAX_H, below - 8) }),
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return undefined;
    }
    measure();
    // Capture phase, so scrolling of ANY ancestor is heard - a table that
    // scrolls sideways under the list included.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  // Close when the focus or the pointer goes elsewhere. The list is portalled
  // out of `.combo`, so it has to be asked about separately - without this a
  // mousedown on an option counts as "outside" and shuts the list.
  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (!wrapRef.current?.contains(e.target) && !listRef.current?.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  // Keep the highlighted row in view when it moves by keyboard.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function commit(option) {
    const next = option === null ? '' : String(getValue(option));

    // The DOM node RHF is holding, so `getValues()` and a native submit both
    // see the new value even though nothing re-rendered yet.
    if (hiddenRef.current) hiddenRef.current.value = next;
    if (!isControlled) setInnerValue(next);

    // The shape every existing handler already reads, and the shape
    // react-hook-form's own onChange expects.
    onChange?.({ target: { name, value: next, type: 'text' } });
    setOpen(false);
    setQuery('');
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (disabled || loading) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const count = shown.length + (includeBlank ? 1 : 0);
      if (count === 0) return;
      setActive((i) => (i + step + count) % count);
      return;
    }

    /*
     * ENTER NEVER SUBMITS THE FORM FROM HERE.
     *
     * This is a text input inside a <form>, so an un-prevented Enter submits
     * it. The first version only called preventDefault() when the list was
     * open, and the moment that guard was wrong - a race, a re-render, a list
     * closed by a click - pressing Enter to choose a buyer saved the order
     * instead. Half-finished records are not a thing to leave to timing.
     *
     * So Enter is always swallowed: it takes the highlighted option if the
     * list is open, and opens the list if it is not. To submit, the user tabs
     * to the button - which is what they were going to do anyway.
     */
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const offset = includeBlank ? 1 : 0;
      if (includeBlank && active === 0) commit(null);
      else if (shown[active - offset]) commit(shown[active - offset]);
      return;
    }

    /*
     * ESCAPE CLOSES THE LIST, NOT THE SCREEN.
     *
     * `Modal` listens for Escape on the document and closes itself. Without
     * stopping propagation here, a person pressing Escape to dismiss an open
     * dropdown lost the entire form they were filling in - the modal shut and
     * took every unsaved field with it.
     *
     * So Escape is consumed while the list is open, and only reaches the modal
     * when there is no list to close, which is when the user actually meant
     * "shut this screen".
     */
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent?.stopImmediatePropagation?.();
      setOpen(false);
      setQuery('');
      return;
    }

    if (e.key === 'Tab') setOpen(false);
  }

  const text = open ? query : selectedLabel;
  const shownPlaceholder = loading ? 'Loading...' : (selectedLabel || placeholder);

  return (
    <div className={`combo ${className}`} ref={wrapRef}>
      {/*
        The real form element. RHF's ref lands here, so `register()` reads and
        writes it exactly as it would a <select>, and it carries the name into
        a native submit.

        NO `defaultValue`. On a hidden input the `value` property IS the
        `value` attribute, and so is `defaultValue` - so React re-applying
        `defaultValue=""` on every render wiped each pick straight back to
        blank on register()-driven screens. The effect above already mirrors
        a controlled `value` onto this node.
      */}
      <input
        type="hidden"
        name={name}
        ref={(el) => {
          hiddenRef.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
      />

      <input
        {...rest}
        id={id}
        ref={inputRef}
        type="text"
        className="combo-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={error ? 'true' : undefined}
        autoComplete="off"
        disabled={disabled || loading}
        placeholder={shownPlaceholder}
        value={text}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        /*
         * Clicking the field opens it, even when it already has focus.
         *
         * `onFocus` alone was not enough: after picking an option this control
         * keeps focus, so the next click fired no focus event and the list
         * stayed shut. It looked like a dead field - and worse, Escape then
         * had no list to close, fell through to the modal's own Escape
         * handler, and shut the whole form.
         */
        onClick={() => setOpen(true)}
        onBlur={(e) => {
          // Leaving without choosing keeps whatever was already committed.
          if (!wrapRef.current?.contains(e.relatedTarget)) {
            setOpen(false);
            setQuery('');
          }
          onBlur?.(e);
        }}
        onKeyDown={onKeyDown}
      />

      <span className="combo-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>

      {open && !disabled && !loading && menuPos && createPortal(
        <ul
          className="combo-list is-portalled"
          id={listId}
          role="listbox"
          ref={listRef}
          style={{
            position: 'fixed',
            left: menuPos.left,
            width: menuPos.width,
            top: menuPos.top,
            bottom: menuPos.bottom,
            right: 'auto',
            maxHeight: menuPos.maxHeight,
          }}
        >
          {/*
            The blank line is "clear my choice". With nothing to choose it
            clears nothing, and repeats the placeholder the closed box is
            already showing - so it is not drawn at all.
          */}
          {includeBlank && options.length > 0 && (
            <li
              role="option"
              aria-selected={!current}
              data-active={active === 0 ? 'true' : undefined}
              className={`combo-option is-blank ${active === 0 ? 'is-active' : ''}`}
              onMouseEnter={() => setActive(0)}
              onMouseDown={(e) => { e.preventDefault(); commit(null); }}
            >
              {blankLabel ?? placeholder}
            </li>
          )}

          {shown.map((o, i) => {
            const index = i + (includeBlank ? 1 : 0);
            const optionValue = String(getValue(o));
            return (
              <li
                key={optionValue}
                role="option"
                aria-selected={optionValue === String(current)}
                data-active={active === index ? 'true' : undefined}
                className={`combo-option ${active === index ? 'is-active' : ''} ${
                  optionValue === String(current) ? 'is-selected' : ''
                }`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(e) => { e.preventDefault(); commit(o); }}
              >
                {getLabel(o)}
              </li>
            );
          })}

          {shown.length === 0 && (
            <li className="combo-empty">
              {options.length === 0 ? noOptionsLabel : emptyLabel}
            </li>
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
});

export default Combobox;
