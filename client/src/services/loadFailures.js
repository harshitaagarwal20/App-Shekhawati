/**
 * Background loads that failed, and a way to say so.
 *
 * ===========================================================================
 *  THE PROBLEM THIS EXISTS FOR
 * ===========================================================================
 *
 *  Fifty-nine places in this client fetched a dropdown and ended the chain
 *  with `.catch(() => setThings([]))`. The intent was reasonable - a form
 *  should not blank out because one list would not load - but the effect was
 *  that EVERY failure became an empty list, and an empty list is
 *  indistinguishable from "there is nothing to show".
 *
 *  It cost a real diagnosis: every vendor dropdown in the application was
 *  empty for one login, on every screen, with no error anywhere. The cause was
 *  a 403 - that role had no VENDOR.VIEW - and finding it took a permission
 *  audit rather than a glance, because the screen said "no vendors" instead of
 *  "you may not read vendors".
 *
 *  The fallback stays. What changes is that the failure is now ANNOUNCED.
 *
 * ---------------------------------------------------------------------------
 *  WHY A MODULE-LEVEL EMITTER RATHER THAN A CONTEXT
 *
 *  A React context would have to be read with a hook, and a hook can only be
 *  called from a component - so every one of those fifty-nine call sites, most
 *  of them inside `useEffect`, would have needed restructuring. This is
 *  importable from anywhere and subscribed to once, at the layout, so the call
 *  sites changed by exactly one word.
 * ---------------------------------------------------------------------------
 */

const listeners = new Set();

/** What has failed since the last dismissal, keyed so a retry loop cannot flood it. */
const failures = new Map();

function emit() {
  const snapshot = [...failures.values()];
  for (const fn of listeners) fn(snapshot);
}

/** Subscribe to the current failure list. Returns an unsubscribe. */
export function subscribeLoadFailures(fn) {
  listeners.add(fn);
  fn([...failures.values()]);
  return () => listeners.delete(fn);
}

export function clearLoadFailures() {
  failures.clear();
  emit();
}

/**
 * Record that a background load failed.
 *
 * Keyed on `what`, so a screen that retries on every keystroke reports one
 * failure rather than forty.
 */
export function reportLoadFailure(what, error) {
  const status = error?.status ?? error?.response?.status ?? null;
  failures.set(what, {
    what,
    status,
    message: error?.message ?? 'Could not load',
    /** A 403 is not a fault - it is an answer, and it needs different words. */
    denied: status === 403,
    at: Date.now(),
  });
  emit();
}

/**
 * The replacement for `.catch(() => setThings([]))`.
 *
 * Keeps the empty fallback so the screen still renders, and says out loud that
 * the list is empty because a request failed rather than because there is
 * nothing there.
 *
 *   vendorsApi.options().then(setVendors).catch(loadFailed(setVendors, 'vendors'))
 *
 * @param {Function} setter   the state setter to fall back on
 * @param {string}   what     what the user was trying to see, in their words
 * @param {*}        [fallback] what to fall back TO; an empty list by default
 */
export function loadFailed(setter, what, fallback = []) {
  return (error) => {
    reportLoadFailure(what, error);
    setter(fallback);
  };
}
