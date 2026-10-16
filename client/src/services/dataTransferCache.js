/**
 * The export and import catalogues, cached once per session.
 *
 * Kept apart from components/dataTransfer.jsx so that AuthContext - which is in
 * the startup bundle - can clear it at sign-out without dragging the export
 * button and import dialog into every cold load.
 *
 * Held in a module variable rather than in React state because it is the same
 * answer for every screen and it does not change while the user is signed in -
 * their permissions are re-read server-side on every request anyway, so the
 * worst a stale catalogue can do is show a button whose action is then refused
 * with a sentence saying why.
 */
const cache = { exports: null, imports: null };

/** One request per catalogue per session, shared by every button. */
export function catalogueOnce(which, fetcher) {
  cache[which] ??= fetcher().catch(() => {
    // A catalogue that will not load hides the buttons rather than breaking
    // the screen they sit on. Exporting is never the reason someone opened it.
    cache[which] = null;
    return null;
  });
  return cache[which];
}

/** Resets the cached catalogues. Called on sign-out. */
export function forgetDataTransferCatalogues() {
  cache.exports = null;
  cache.imports = null;
}
