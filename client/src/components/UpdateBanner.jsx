/**
 * "A new version is available" bar across the top of every screen.
 *
 * Each build writes its id into the bundle (__APP_VERSION__) and into
 * /version.json. This checks version.json every minute and whenever the
 * window/app comes back to the foreground; once the deployed id differs from
 * the one this page was built with, it shows the bar. Refresh reloads onto
 * the new build, whose id then matches, so the bar is gone after the reload.
 *
 * Works the same in a browser tab and inside the Android app, which loads the
 * live site.
 */

import { useEffect, useState } from 'react';

const CHECK_EVERY_MS = 60_000;

async function fetchDeployedVersion() {
  // The query string defeats the long cache Express puts on static files.
  const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.version || null;
}

export default function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return undefined;
    let stopped = false;

    const check = async () => {
      if (stopped || document.visibilityState === 'hidden') return;
      try {
        const deployed = await fetchDeployedVersion();
        if (!stopped && deployed && deployed !== __APP_VERSION__) setAvailable(true);
      } catch {
        // Offline or mid-deploy; try again next time.
      }
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

  if (!available) return null;

  const refresh = async () => {
    setReloading(true);
    try {
      // Make sure the reload does not come back with a cached old index.html.
      await fetch('/index.html', { cache: 'reload' });
    } catch {
      // Reload anyway.
    }
    window.location.reload();
  };

  return (
    <div className="update-banner" role="status">
      <span>A new version of the app is available.</span>
      <button type="button" className="update-banner-btn" onClick={refresh} disabled={reloading}>
        {reloading ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
