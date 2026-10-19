/**
 * Picks up a new deployment by itself, without losing anybody's typing.
 *
 * Each build writes its id into the bundle (__APP_VERSION__) and into
 * /version.json. This checks version.json every minute and whenever the
 * window/app comes back to the foreground; once the deployed id differs from
 * the one this page was built with, a newer build is live.
 *
 * ---------------------------------------------------------------------------
 *  WHEN IT RELOADS ON ITS OWN
 *
 *  A reload throws away whatever is typed into an unsaved form, and a storeman
 *  halfway through a GRN must never lose it to a deployment. So the reload
 *  waits for a moment when there is nothing to lose:
 *
 *   1. ON THE NEXT SCREEN CHANGE. Moving to another screen already discards
 *      the old one's form, so loading the new build there costs nothing. The
 *      URL has already changed, so the reload lands on the screen they chose.
 *
 *   2. WHEN NOTHING HAS BEEN TYPED on this screen and the page is either in
 *      the background or has been left alone for IDLE_BEFORE_RELOAD_MS - nobody
 *      is mid-click on a button whose request a reload would cut off.
 *
 *  Anything typed on the current screen - even a search box - holds the reload
 *  until the next screen change. Being too careful here costs one more minute
 *  on the old build; not careful enough costs somebody's work.
 *
 *  The bar stays up meanwhile, and Refresh applies the update at once.
 *
 *  A SCREEN THAT FAILS TO LOAD after a deploy is reloaded too. Screens are
 *  loaded on demand, and a page still running the old build asks for the old
 *  build's files, which the deploy replaced. Vite reports that as
 *  `vite:preloadError`; reloading fetches the new build, which has the screen.
 *
 *  NEVER A RELOAD LOOP. If the server is still handing out the old page (a
 *  cache mid-deploy), reloading would find the "new" version again and go
 *  round forever. An automatic reload is skipped if one already happened in
 *  the last RELOAD_GUARD_MS; the bar and its Refresh button remain.
 * ---------------------------------------------------------------------------
 *
 * Works the same in a browser tab and inside the Android app, which loads the
 * live site. The login survives the reload - tokens are in localStorage.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

const CHECK_EVERY_MS = 60_000;
const IDLE_BEFORE_RELOAD_MS = 30_000;
const RELOAD_GUARD_MS = 5 * 60_000;
const RELOAD_GUARD_KEY = 'si.autoReloadAt';

async function fetchDeployedVersion() {
  // The query string defeats the long cache Express puts on static files.
  const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.version || null;
}

/** Whether an automatic reload already happened moments ago - see NEVER A RELOAD LOOP. */
function reloadedRecently() {
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0) < RELOAD_GUARD_MS;
  } catch {
    // No storage, no way to tell: assume yes, and leave it to the Refresh button.
    return true;
  }
}

/** Reloads onto the deployed build, making sure the page that comes back is not a cached old one. */
async function reloadOntoNewBuild({ automatic }) {
  if (automatic) {
    try {
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch {
      // Unreachable in practice - reloadedRecently() already refused without storage.
    }
  }
  try {
    await fetch('/index.html', { cache: 'reload' });
  } catch {
    // Reload anyway.
  }
  window.location.reload();
}

export default function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [reloading, setReloading] = useState(false);
  const { pathname } = useLocation();

  /* Read inside listeners registered once, so they live in refs, not state. */
  const availableRef = useRef(false);
  /** Something was typed on this screen since it was opened. */
  const typedRef = useRef(false);
  const lastActiveRef = useRef(Date.now());
  const pathRef = useRef(pathname);
  const reloadingRef = useRef(false);

  const reloadNow = (automatic) => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    setReloading(true);
    reloadOntoNewBuild({ automatic });
  };

  // --- What the user is doing: typing holds the reload, any activity delays it.
  useEffect(() => {
    const onType = () => {
      typedRef.current = true;
      lastActiveRef.current = Date.now();
    };
    const onActive = () => {
      lastActiveRef.current = Date.now();
    };
    // Capture phase: a component that stops propagation still counts as typing.
    document.addEventListener('input', onType, true);
    document.addEventListener('change', onType, true);
    document.addEventListener('pointerdown', onActive, true);
    document.addEventListener('keydown', onActive, true);
    return () => {
      document.removeEventListener('input', onType, true);
      document.removeEventListener('change', onType, true);
      document.removeEventListener('pointerdown', onActive, true);
      document.removeEventListener('keydown', onActive, true);
    };
  }, []);

  // --- Checking for a new build, and applying it when nothing would be lost.
  useEffect(() => {
    if (import.meta.env.DEV) return undefined;
    let stopped = false;

    const applyIfSafe = () => {
      if (stopped || !availableRef.current || typedRef.current || reloadedRecently()) return;
      const inBackground = document.visibilityState === 'hidden';
      const idle = Date.now() - lastActiveRef.current >= IDLE_BEFORE_RELOAD_MS;
      if (inBackground || idle) reloadNow(true);
    };

    const check = async () => {
      if (stopped) return;
      // Going to the background is the best moment to apply an update already found.
      if (document.visibilityState === 'hidden') {
        applyIfSafe();
        return;
      }
      try {
        const deployed = await fetchDeployedVersion();
        if (!stopped && deployed && deployed !== __APP_VERSION__) {
          availableRef.current = true;
          setAvailable(true);
        }
      } catch {
        // Offline or mid-deploy; try again next time.
      }
      applyIfSafe();
    };

    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  // --- A screen of the old build that no longer exists on the server.
  useEffect(() => {
    if (import.meta.env.DEV) return undefined;
    const onPreloadError = (event) => {
      if (reloadedRecently()) return; // Let the error surface rather than loop.
      // Stops Vite rethrowing; the reload replaces the half-loaded screen.
      event.preventDefault();
      reloadNow(true);
    };
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => window.removeEventListener('vite:preloadError', onPreloadError);
  }, []);

  // --- The next screen change: the old screen's form is gone either way.
  useEffect(() => {
    if (pathname === pathRef.current) return;
    pathRef.current = pathname;
    typedRef.current = false;
    if (availableRef.current && !reloadedRecently()) reloadNow(true);
  }, [pathname]);

  if (!available) return null;

  return (
    <div className="update-banner" role="status">
      <span>A new version of the app is available. It loads by itself when you next open a screen.</span>
      <button type="button" className="update-banner-btn" onClick={() => reloadNow(false)} disabled={reloading}>
        {reloading ? 'Refreshing…' : 'Refresh now'}
      </button>
    </div>
  );
}
