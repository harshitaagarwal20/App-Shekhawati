/**
 * A form's unsent work, kept in this browser until it is saved.
 *
 * ---------------------------------------------------------------------------
 *  WHAT IT PROTECTS AGAINST
 *
 *  A buyer order, a plan or a fabric issue is several minutes of typing, and
 *  until it is saved that work lives only in React state. Escape, a click on
 *  the backdrop, a dropped connection that forces a reload, a closed tab -
 *  each threw all of it away. Now the form's values are written to
 *  localStorage half a second after each change, and the next time the same
 *  form is opened it opens on them.
 *
 *  RESTORED BEFORE THE FIRST RENDER. `initial` is read synchronously, so a form
 *  seeds its own state from it rather than having values pushed in by an
 *  effect afterwards. That matters: the order form fills Bill To from the
 *  buyer and the plan form fills its grid from the order, both in effects, and
 *  a draft arriving after them would race them.
 *
 *  NEW DOCUMENTS ONLY. Callers pass `enabled: isNew`. A draft of an EDIT is a
 *  copy of a record taken some time ago; laid back over the record it would
 *  silently undo whatever anybody else changed since.
 *
 *  PER USER. The key carries the username, so on a shared desk one person's
 *  half-typed order never opens in front of the next person.
 *
 *  OPENING IS NOT A CHANGE. The first render's values are the baseline, and
 *  nothing is written until they differ - so opening a blank form and closing
 *  it again leaves no draft behind.
 *
 *  `clear()` is called once the document has saved; `discard()` throws the
 *  draft away and asks the caller to remount the form blank.
 *
 *  localStorage can be missing or full (private windows, blocked site data).
 *  Every access is guarded: the form then simply works as it did before.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const PREFIX = 'si.draft.';
/** A draft nobody came back to in a fortnight is not going to be finished. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const SAVE_DELAY_MS = 500;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (!stored || !(Date.now() - stored.savedAt < MAX_AGE_MS)) {
      localStorage.removeItem(key);
      return null;
    }
    return stored.value ?? null;
  } catch {
    return null;
  }
}

/** `json` is the value already serialised - it is compared as a string anyway. */
function write(key, json) {
  try {
    localStorage.setItem(key, `{"savedAt":${Date.now()},"value":${json}}`);
  } catch {
    /* storage full or blocked - the form still works, it is just not kept */
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to remove */
  }
}

/**
 * The saved draft, read once - call before the form's own state, which seeds
 * from `initial`. Pair with `useKeepDraft` once the form's values exist.
 *
 * @param {string} name     Which form, e.g. 'buyer-order'
 * @param {object} [opts]
 * @param {boolean} [opts.enabled]      False for an edit - see above
 * @param {() => void} [opts.onDiscard] Remount the form blank
 */
export function useDraft(name, { enabled = true, onDiscard } = {}) {
  const { user } = useAuth();
  const key = `${PREFIX}${user?.username ?? 'anon'}.${name}`;

  const [initial] = useState(() => (enabled ? read(key) : null));
  // Set once the draft is cleared or discarded: nothing may write it back,
  // including the flush when the form closes a moment later.
  const doneRef = useRef(!enabled);

  const clear = useCallback(() => {
    doneRef.current = true;
    remove(key);
  }, [key]);

  const discard = useCallback(() => {
    clear();
    onDiscard?.();
  }, [clear, onDiscard]);

  return { key, doneRef, initial, restored: initial !== null, clear, discard };
}

/**
 * Writes the form's current values as the draft, half a second after they
 * change.
 *
 * @param {ReturnType<typeof useDraft>} draft
 * @param {object} value  The form's values; must be JSON-serialisable
 */
export function useKeepDraft(draft, value) {
  const { key, doneRef } = draft;
  const json = JSON.stringify(value);
  const lastRef = useRef(json);
  const pendingRef = useRef(null);

  useEffect(() => {
    if (doneRef.current || json === lastRef.current) return undefined;
    pendingRef.current = json;
    const id = setTimeout(() => {
      if (doneRef.current) return;
      write(key, json);
      lastRef.current = json;
      pendingRef.current = null;
    }, SAVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [json, key, doneRef]);

  // The last half-second of typing is not lost to the delay: it is written
  // when the form closes and when the tab goes away.
  useEffect(() => {
    const flush = () => {
      if (doneRef.current || pendingRef.current === null) return;
      write(key, pendingRef.current);
      pendingRef.current = null;
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [key, doneRef]);
}

/**
 * The remount `discard()` asks for: render the form under a key that changes,
 * so a discarded draft comes back as a genuinely fresh form - every piece of
 * state re-initialised - rather than each form writing its own reset.
 */
export function useRemountKey() {
  const [round, setRound] = useState(0);
  const remount = useCallback(() => setRound((r) => r + 1), []);
  return [round, remount];
}
