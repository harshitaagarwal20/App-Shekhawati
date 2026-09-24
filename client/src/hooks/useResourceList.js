/**
 * List-screen state: search, filters, sorting, paging and reload, shared by
 * every master and (from Phase 3) every transaction list.
 *
 * ===========================================================================
 *  THE QUERY LIVES IN THE ADDRESS BAR
 * ===========================================================================
 *
 * Search, filters, sort, page and page size are mirrored into the URL, and
 * read back out of it on the way in. Three things follow, and all three were
 * missing before:
 *
 *   A REFRESH KEEPS YOUR PLACE. Store staff work these screens with F5 as a
 *   reflex, and losing page 4 of the gate pass register every time is the kind
 *   of small tax nobody reports as a bug.
 *
 *   A FILTERED LIST CAN BE SENT TO SOMEBODY. "The POs still open for this
 *   vendor" becomes a link, rather than six words of instructions about which
 *   dropdowns to set.
 *
 *   BACK COMES BACK TO WHAT YOU WERE LOOKING AT. Open a record from row 40 of
 *   page 2, press Back, and page 2 is still there.
 *
 * ---------------------------------------------------------------------------
 *  HOW IT AVOIDS THE TWO CLASSIC FAILURES
 *
 *  A HISTORY ENTRY PER KEYSTROKE. The URL is written with `replace: true`, so
 *  typing "canvas" into a search box leaves one history entry rather than six,
 *  and Back still leaves the screen rather than deleting a letter at a time.
 *  The search value written is the DEBOUNCED one, for the same reason the
 *  fetch uses it.
 *
 *  TWO LISTS FIGHTING OVER ONE URL. A screen with two lists on it - the Excess
 *  Rules page has rules and authorisations side by side - would have both
 *  writing `page` and `search`. Pass `urlPrefix` and each gets its own
 *  namespace (`rules.page`, `approvals.page`). Pass `syncUrl: false` to opt
 *  out entirely.
 *
 *  Parameters this hook does not own are preserved on every write, so a screen
 *  that keeps its own `?recordId=` in the URL is unaffected. Where a screen
 *  drives one of its OWN filters from the URL - Job Work's `?process=` tabs -
 *  name it in `urlIgnore` so this hook reads it but never writes it back.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Debounces a value so typing in the search box does not fire a request per keystroke. */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/**
 * Builds the query string one list should have, given the one it already has.
 *
 * ---------------------------------------------------------------------------
 *  PURE, AND SEPARATE FROM THE HOOK, BECAUSE THIS IS THE FIDDLY PART
 *
 *  Four rules interact here, and getting any of them wrong is quiet:
 *
 *    A value equal to its default is REMOVED, not written. Otherwise an
 *    untouched list sits at `?page=1&pageSize=25&sortDir=asc`, and every link
 *    anybody copies carries settings they never chose.
 *
 *    Parameters this list does not own are PRESERVED. A screen that keeps its
 *    own `?recordId=` in the URL must not lose it because a filter changed.
 *
 *    `prefix` namespaces every key, so two lists on one screen do not collide.
 *
 *    `ignore` names keys the screen writes itself; they are left exactly as
 *    they are found.
 *
 *  See test/urlParams.rules.test.js.
 * ---------------------------------------------------------------------------
 *
 * @param {URLSearchParams} current
 * @param {{prefix?: string, ignore?: string[], values: object, defaults: object}} spec
 * @returns {URLSearchParams}
 */
export function listUrlParams(current, { prefix = '', ignore = [], values, defaults }) {
  const next = new URLSearchParams(current);
  const nameOf = (n) => (prefix ? `${prefix}.${n}` : n);

  for (const [name, value] of Object.entries(values)) {
    if (ignore.includes(name)) continue;

    const k = nameOf(name);
    const fallback = defaults[name];
    const isEmpty = value === undefined || value === null || value === '';

    // Sort direction is meaningless without a column to sort, and noise in the
    // URL when the column is the default one.
    const isDefault = String(value) === String(fallback ?? '');

    if (isEmpty || isDefault) next.delete(k);
    else next.set(k, String(value));
  }

  return next;
}

/**
 * @param {(params: object) => Promise<{rows: any[], meta: object}>} fetcher
 * @param {object} [opts]
 * @param {string} [opts.defaultSort]
 * @param {'asc'|'desc'} [opts.defaultDir]
 * @param {number} [opts.pageSize]
 * @param {object} [opts.initialFilters]
 */
export function useResourceList(fetcher, opts = {}) {
  const {
    defaultSort = '',
    defaultDir = 'asc',
    pageSize: initialPageSize = 25,
    initialFilters = {},
    syncUrl = true,
    urlPrefix = '',
    urlIgnore = [],
  } = opts;

  const [searchParams, setSearchParams] = useSearchParams();

  /** Callers pass `urlIgnore` as an inline array, so depend on its contents. */
  const ignoreKey = urlIgnore.join(',');

  /** This list's name for a parameter, namespaced when a screen has two. */
  const key = useCallback((name) => (urlPrefix ? `${urlPrefix}.${name}` : name), [urlPrefix]);

  /**
   * The address bar is read ONCE, to seed the state.
   *
   * After that the state is the authority and the URL is written from it.
   * Deriving the state from the URL on every render instead would make each
   * write a re-render that triggers another write; this direction has one
   * source of truth and no loop.
   *
   * `useState(fn)` rather than `useState(value)` so the parameters are read on
   * the first render only - a later navigation must not silently reset a list
   * the user has since filtered.
   */
  const seed = useCallback(
    (name, fallback) => (syncUrl ? searchParams.get(key(name)) ?? fallback : fallback),
    // Deliberately not reactive: this is the initial read, and re-running it
    // when the URL changes is exactly the loop described above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [search, setSearch] = useState(() => seed('search', ''));
  const [filters, setFilters] = useState(() =>
    Object.fromEntries(
      Object.entries(initialFilters).map(([k, v]) => [k, seed(k, v) ?? v]),
    ),
  );
  const [sortBy, setSortBy] = useState(() => seed('sortBy', defaultSort));
  const [sortDir, setSortDir] = useState(() => (seed('sortDir', defaultDir) === 'desc' ? 'desc' : 'asc'));
  const [page, setPage] = useState(() => Math.max(Number(seed('page', 1)) || 1, 1));
  const [pageSize, setPageSize] = useState(
    () => Math.max(Number(seed('pageSize', initialPageSize)) || initialPageSize, 1),
  );

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const debouncedSearch = useDebounced(search);

  // `fetcher` is almost always an inline arrow, so its identity changes every
  // render. Holding it in a ref keeps the effect below driven by the query
  // alone while still calling the latest function.
  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; });

  const filterKey = JSON.stringify(filters);
  const initialFilterKey = JSON.stringify(initialFilters);

  /**
   * A change to what is being asked for resets to the first page - but NOT on
   * the first render.
   *
   * This effect runs on mount like any other, and before the URL was read it
   * did not matter: page was already 1. Now a link to `?page=3` seeds page 3
   * and this would immediately snap it back to 1, so the deep link would look
   * broken in a way that was hard to attribute to anything.
   */
  const settled = useRef(false);
  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    setPage(1);
  }, [debouncedSearch, filterKey, pageSize]);

  /**
   * State -> address bar.
   *
   * Only this list's own parameters are touched; anything else in the query
   * string is copied across untouched, so a screen holding its own `?process=`
   * or `?recordId=` keeps it.
   *
   * A value equal to its default is REMOVED rather than written, which keeps
   * an unfiltered list at a clean `/orders` instead of a URL restating every
   * default it is not using.
   */
  useEffect(() => {
    if (!syncUrl) return;

    const next = listUrlParams(searchParams, {
      prefix: urlPrefix,
      ignore: urlIgnore,
      values: {
        search: debouncedSearch,
        page,
        pageSize,
        sortBy,
        // A direction with no column to apply it to is noise in the URL.
        sortDir: sortBy ? sortDir : '',
        ...filters,
      },
      defaults: {
        search: '',
        page: 1,
        pageSize: initialPageSize,
        sortBy: defaultSort,
        sortDir: defaultDir,
        ...initialFilters,
      },
    });

    // Writing an identical query string still pushes a history entry in some
    // routers, and re-renders in all of them. Compare first.
    if (next.toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
    // `filters` and `initialFilters` are driven by their serialised keys -
    // `filterKey` and `initialFilterKey` - because callers pass `initialFilters`
    // as an inline object literal, so its identity changes on every render and
    // depending on it directly would write the URL forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    syncUrl,
    urlPrefix,
    searchParams,
    setSearchParams,
    debouncedSearch,
    page,
    pageSize,
    sortBy,
    sortDir,
    filterKey,
    initialFilterKey,
    initialPageSize,
    defaultSort,
    defaultDir,
    ignoreKey,
  ]);

  const params = useMemo(() => {
    const cleanFilters = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined && v !== null),
    );
    return {
      page,
      pageSize,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(sortBy ? { sortBy, sortDir } : {}),
      ...cleanFilters,
    };
  }, [page, pageSize, debouncedSearch, sortBy, sortDir, filters]);

  /** Serialised query - the only thing that should re-trigger a fetch. */
  const paramsKey = useMemo(() => JSON.stringify(params), [params]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcherRef.current(JSON.parse(paramsKey))
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows ?? []);
        setMeta(result.meta ?? { total: 0, page: 1, pageCount: 0 });
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e);
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [paramsKey, reloadKey]);

  const toggleSort = useCallback(
    (field) => {
      if (sortBy === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortBy(field);
        setSortDir('asc');
      }
    },
    [sortBy],
  );

  const setFilter = useCallback((key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);

  // Keyed on the serialised initial filters rather than the object identity,
  // which callers recreate on every render.
  const clearFilters = useCallback(() => {
    setFilters(JSON.parse(initialFilterKey));
    setSearch('');
  }, [initialFilterKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return {
    rows,
    meta,
    loading,
    error,
    /**
     * The query this list is currently showing - search, filters, sort - as the
     * API takes it.
     *
     * Exposed so that "export this table" can be exactly that. The export
     * endpoint takes the same query the list endpoint does, so handing it this
     * object is what guarantees the file holds the rows on screen rather than
     * a second, similar-looking set. `page` and `pageSize` ride along and are
     * ignored: an export is never a page of a table.
     */
    query: params,
    search,
    setSearch,
    filters,
    setFilter,
    clearFilters,
    sortBy,
    sortDir,
    toggleSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    reload,
  };
}

export default useResourceList;
