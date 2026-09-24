/**
 * Optional columns on a list, the way Odoo does them.
 *
 * ===========================================================================
 *  A WIDE TABLE IS NOT FIXED BY DELETING COLUMNS
 * ===========================================================================
 *
 *  The busiest lists in this system carry twelve to sixteen columns. Buyer
 *  Orders reads Order No, Order Date, Buyer, Style No, Item Description, Order
 *  Qty, Effective Qty, Excess, Colour, Currency, Delivery, Status - and on an
 *  office machine that scrolls sideways, which means the columns nobody is
 *  looking at are pushing the ones they are looking at off the screen.
 *
 *  The obvious fix is to cut columns. It is the wrong one, because the office
 *  is not one reader: merchandising opens Buyer Orders for delivery dates,
 *  accounts opens it for currency, and the Director opens it for excess. A
 *  column that is clutter to two of them is the reason the third came.
 *
 *  So the column is not removed - it is made OPTIONAL. Each list declares a
 *  lean default set, every other column is one click away in the column menu,
 *  and the choice is remembered for that person on that screen. Nobody loses a
 *  column; everybody stops carrying somebody else's.
 *
 * ---------------------------------------------------------------------------
 *  WHY LOCALSTORAGE AND NOT THE SERVER
 *
 *  This is a per-person display preference, in the same class as which
 *  navigation groups are expanded (AppLayout keeps that here too). It is worth
 *  nothing to anybody else, it must survive a reload, and it must never be the
 *  reason a screen fails to render. Private browsing loses it, which is the
 *  correct amount of damage for a remembered column choice.
 *
 *  A STORED PREFERENCE IS NEVER TRUSTED AS THE COLUMN LIST. It is filtered
 *  against the columns the code actually declares, so a column renamed or
 *  dropped in a later release cannot resurrect itself, and a key that is no
 *  longer real cannot leave a header with no cells under it.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useMemo, useState } from 'react';

const KEY_PREFIX = 'si.columns.';

function readStored(key) {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    /* private browsing, or a value some other version wrote */
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(KEY_PREFIX + key, JSON.stringify(value));
  } catch {
    /* the preference simply does not persist */
  }
}

/**
 * @param {string} screenKey  stable id for this list, e.g. 'orders'
 * @param {Array<{key: string, label: string, optional?: boolean}>} columns
 *        Every column the list can show, in display order. `optional: true`
 *        means "hidden until asked for"; a column without it is always shown
 *        and cannot be turned off - the ones the screen would be meaningless
 *        without, like the document number.
 */
export function useOptionalColumns(screenKey, columns) {
  const always = useMemo(
    () => columns.filter((c) => !c.optional).map((c) => c.key),
    [columns],
  );
  const optional = useMemo(() => columns.filter((c) => c.optional), [columns]);

  const [chosen, setChosen] = useState(() => {
    const stored = readStored(screenKey);
    if (!Array.isArray(stored)) return [];
    // Only keys this build still declares as optional survive the read.
    const known = new Set(optional.map((c) => c.key));
    return stored.filter((k) => known.has(k));
  });

  const visible = useMemo(
    () => new Set([...always, ...chosen]),
    [always, chosen],
  );

  const toggle = useCallback((key) => {
    setChosen((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      writeStored(screenKey, next);
      return next;
    });
  }, [screenKey]);

  const reset = useCallback(() => {
    setChosen([]);
    writeStored(screenKey, []);
  }, [screenKey]);

  return {
    /** `show('colour')` - true when that column is on screen right now. */
    show: useCallback((key) => visible.has(key), [visible]),
    /**
     * How many columns are actually rendered.
     *
     * Every list has a full-width row - the spinner, and the empty state - and
     * its colSpan was written as a literal (`colSpan={12}`) in every one of
     * them. That number was already a maintenance trap: add a column and the
     * loading row silently stops spanning the table. With columns that come
     * and go it would be wrong most of the time, so it is computed.
     */
    colSpan: visible.size,
    /** What the column menu renders: every optional column and its state. */
    options: optional.map((c) => ({ ...c, checked: visible.has(c.key) })),
    toggle,
    reset,
    /** True when the user has changed anything, so "Reset" can be offered. */
    customised: chosen.length > 0,
  };
}
