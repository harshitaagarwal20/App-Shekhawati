/**
 * Everything that ever happened to one record.
 *
 * ---------------------------------------------------------------------------
 *  THREE SOURCES, ONE COLUMN
 *
 *  The server merges row-level writes, workflow decisions and amendments into a
 *  single time-ordered list. This screen keeps them merged and colour-codes the
 *  source instead of splitting them into tabs, because the useful question is
 *  "what happened, in order" — and the edit that caused a rejection is usually
 *  minutes before it, not on another screen.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { audit as auditApi } from '../../../services/erp.js';
import { Alert, EmptyState, Spinner } from '../../../components/ui.jsx';
import { fmtDateTime } from '../../../utils/format.js';
import ChangeTable from './ChangeTable.jsx';

const SOURCE_STYLE = {
  WRITE: { label: 'Edit', className: 'badge' },
  DECISION: { label: 'Decision', className: 'badge badge-approved' },
  AMENDMENT: { label: 'Amendment', className: 'badge badge-rejected' },
};

export default function RecordTrail({ tableName, recordId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    auditApi
      .trail(tableName, recordId)
      .then((res) => { if (live) setData(res); })
      .catch((err) => { if (live) setError(err); });
    return () => { live = false; };
  }, [tableName, recordId]);

  if (error) return <Alert kind="error">{error.message}</Alert>;
  if (!data) return <Spinner label="Loading the trail" />;

  if (!data.events.length) {
    return (
      <EmptyState
        title="Nothing recorded"
        message={`No changes, decisions or amendments have been recorded against this ${data.label.toLowerCase()}.`}
      />
    );
  }

  return (
    <>
      <div className="row" style={{ gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{data.label}</div>
          {data.route ? (
            <Link to={data.route}>Open the record</Link>
          ) : (
            <span className="muted">No screen for this record</span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          {data.counts.writes} edit(s) · {data.counts.decisions} decision(s) ·{' '}
          {data.counts.amendments} amendment(s)
        </div>
      </div>

      <ol className="trail">
        {data.events.map((e, i) => {
          const style = SOURCE_STYLE[e.source] ?? SOURCE_STYLE.WRITE;
          const hasChanges = Boolean(e.changes?.length);
          const key = `${e.source}-${e.id}`;
          return (
            <li key={key} className="trail-item">
              <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="muted trail-when">
                  {fmtDateTime(e.at)}
                </span>
                <span className={style.className}>{style.label}</span>
                <strong>{e.summary}</strong>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {e.by ? `by ${e.by}` : 'by the system'}
                </span>
                {hasChanges && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setExpanded(expanded === key ? null : key)}
                  >
                    {expanded === key ? 'Hide fields' : `Show ${e.changes.length} field(s)`}
                  </button>
                )}
              </div>

              {e.remarks && (
                <p className="muted trail-detail" style={{ fontSize: 12.5 }}>
                  “{e.remarks}”
                </p>
              )}

              {expanded === key && (
                <div className="trail-detail" style={{ marginTop: 8 }}>
                  <ChangeTable changes={e.changes} />
                </div>
              )}

              {i < data.events.length - 1 && <div className="trail-rule" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </>
  );
}
