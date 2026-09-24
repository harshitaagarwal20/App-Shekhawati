/**
 * Says out loud that something on this screen did not load.
 *
 * Deliberately not a modal and not per-field: these are background lists, the
 * screen is still usable without them, and interrupting somebody mid-entry to
 * tell them the colour dropdown is empty would be worse than the silence it
 * replaces. It sits at the top of the page area, states what is missing, and
 * gets out of the way.
 *
 * A 403 gets different words from a failure. "Vendors could not be loaded"
 * sends somebody looking for a broken server; "you do not have access to
 * vendors" sends them to whoever administers roles, which is where the answer
 * actually is.
 */

import { useEffect, useState } from 'react';
import { clearLoadFailures, subscribeLoadFailures } from '../services/loadFailures.js';

export default function LoadFailureBanner() {
  const [failures, setFailures] = useState([]);

  useEffect(() => subscribeLoadFailures(setFailures), []);

  if (failures.length === 0) return null;

  const denied = failures.filter((f) => f.denied);
  const broken = failures.filter((f) => !f.denied);
  const list = (rows) => rows.map((f) => f.what).join(', ');

  return (
    <div className="load-failure" role="status">
      <div className="load-failure-body">
        {denied.length > 0 && (
          <div>
            <strong>You do not have access to {list(denied)}.</strong>{' '}
            Those lists are empty for that reason, not because there is nothing in them.
            An administrator can add the permission to your role.
          </div>
        )}
        {broken.length > 0 && (
          <div>
            <strong>{list(broken)} could not be loaded.</strong>{' '}
            Those lists are empty because the request failed. Reload the page to try again.
          </div>
        )}
      </div>
      <button type="button" className="btn btn-sm btn-ghost" onClick={clearLoadFailures}>
        Dismiss
      </button>
    </div>
  );
}
