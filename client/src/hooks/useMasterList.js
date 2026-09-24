/**
 * Dropdown data hooks.
 *
 * Every business dropdown in this application reads its values from the List
 * Master through these hooks. There are no hardcoded business dropdown values
 * anywhere in the React code - adding a colour, a GSM or a stitching unit is a
 * data change in the List Master screen, exactly as adding a row to the bottom
 * of a column was in the workbook.
 *
 * Values are cached per list code for the lifetime of the page, because they
 * change rarely and a form with eight dropdowns should not fire eight requests
 * every time it opens. `invalidateMasterList()` clears the cache after an edit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { masterLists } from '../services/erp.js';
import { useIsMounted } from './useIsMounted.js';

const cache = new Map(); // code -> { values, at }
const inflight = new Map(); // code -> Promise

/** Drop cached values so the next read re-fetches. */
export function invalidateMasterList(code) {
  if (code) {
    cache.delete(code);
    inflight.delete(code);
  } else {
    cache.clear();
    inflight.clear();
  }
}

async function fetchList(code) {
  if (cache.has(code)) return cache.get(code).values;
  if (inflight.has(code)) return inflight.get(code);

  const promise = masterLists
    .values(code)
    .then((result) => {
      const values = result.values ?? [];
      cache.set(code, { values, at: Date.now() });
      inflight.delete(code);
      return values;
    })
    .catch((err) => {
      inflight.delete(code);
      throw err;
    });

  inflight.set(code, promise);
  return promise;
}

/**
 * Values of one master list.
 * @param {string} code e.g. 'ColorCode'
 * @returns {{values: {id:string,value:string}[], loading: boolean, error: Error|null, reload: () => void}}
 */
export function useMasterList(code) {
  const [values, setValues] = useState(() => cache.get(code)?.values ?? []);
  const [loading, setLoading] = useState(() => !cache.has(code));
  const [error, setError] = useState(null);
  const mounted = useIsMounted();

  const load = useCallback(() => {
    if (!code) return;
    setLoading(true);
    fetchList(code)
      .then((v) => {
        if (mounted.current) {
          setValues(v);
          setError(null);
        }
      })
      .catch((e) => {
        if (mounted.current) setError(e);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  }, [code, mounted]);

  useEffect(() => { load(); }, [load]);

  const reload = useCallback(() => {
    invalidateMasterList(code);
    load();
  }, [code, load]);

  return { values, loading, error, reload };
}

/**
 * Several master lists at once, in a single request.
 * @param {string[]} codes
 * @returns {{lists: Record<string, {id:string,value:string}[]>, loading: boolean, error: Error|null}}
 */
export function useMasterLists(codes) {
  const key = useMemo(() => [...new Set(codes)].sort().join(','), [codes]);
  const [lists, setLists] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const wanted = key ? key.split(',') : [];
    if (!wanted.length) {
      setLists({});
      setLoading(false);
      return () => {};
    }

    const missing = wanted.filter((c) => !cache.has(c));
    const seed = Object.fromEntries(
      wanted.filter((c) => cache.has(c)).map((c) => [c, cache.get(c).values]),
    );

    if (!missing.length) {
      setLists(seed);
      setLoading(false);
      return () => {};
    }

    setLoading(true);
    masterLists
      .manyValues(missing)
      .then((result) => {
        for (const [code, values] of Object.entries(result)) {
          cache.set(code, { values, at: Date.now() });
        }
        if (!cancelled) {
          setLists({ ...seed, ...result });
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [key]);

  return { lists, loading, error };
}

export default useMasterList;
