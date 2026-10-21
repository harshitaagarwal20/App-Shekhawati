/**
 * A ranked horizontal bar chart - one measure, one hue, worst or biggest first.
 *
 * Draws a `chart` block exactly as a report sent it (see reports.vendor.js):
 *
 *     { title, note, unit, max?, markerLabel?, bars: [{ label, value, display,
 *       marker?, sub?, tone? }] }
 *
 * The ranking, every figure and every label arrive from the server; the only
 * arithmetic here is placing a bar's end on the scale.
 *
 * Reuses the dashboard's bar rows (styles.css, "Horizontal bars"): every bar
 * is direct-labelled with its own number, so there is no axis to read. Two
 * additions:
 *
 *   MARKER   a tick across the track at a reference value - the shrinkage a
 *            job worker was allowed. Text ink, not a second colour, and named
 *            in a legend line, so it never reads as a second series.
 *   TONE     `bad` marks a bar that breached its reference. The fill turns the
 *            status red AND the row says so in words, so the state is never
 *            carried by colour alone.
 *
 * A Table toggle shows every value without hovering.
 */

import { useState } from 'react';

/**
 * The round number the scale runs to: 1, 2, 5, 10, 20, 50... at or above the
 * largest value drawn. Scaling to the largest value itself would draw two
 * 2.1% bars the full width of the panel, which reads as alarming however small
 * the figure; to 5 they read as what they are.
 */
function niceCeil(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= v - 1e-9);
}

export default function RankedBars({ chart, emptyText = 'Nothing to chart for these filters.' }) {
  const [asTable, setAsTable] = useState(false);
  const bars = chart.bars ?? [];
  const hasMarker = bars.some((b) => b.marker != null);

  // One scale for the whole chart: the stated ceiling (100 for a rate), else
  // a round number above the largest value or reference drawn. Printed on the
  // chart, since there is no axis to read it from.
  const max =
    chart.max != null
      ? Number(chart.max)
      : niceCeil(Math.max(0, ...bars.flatMap((b) => [Number(b.value), b.marker != null ? Number(b.marker) : 0])));
  const scaleText = chart.unit === '%' ? `Bars run 0–${max}%` : `Bars run 0–${max} ${chart.unit ?? ''}`.trim();
  const at = (v) => (max > 0 ? Math.min(Math.max((Number(v) / max) * 100, 0), 100) : 0);

  return (
    <section className="rb-panel" aria-label={chart.title}>
      <header className="rb-head">
        <div>
          <h3 className="rb-title">{chart.title}</h3>
          {chart.note && <p className="rb-note">{chart.note}</p>}
        </div>
        {bars.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => setAsTable((v) => !v)}>
            {asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </header>

      {bars.length === 0 ? (
        <p className="rb-empty">{emptyText}</p>
      ) : asTable ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{chart.title}</th>
                <th className="num">Value</th>
                {hasMarker && <th className="num">{chart.markerLabel ?? 'Reference'}</th>}
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td className="num">{b.display}</td>
                  {hasMarker && <td className="num">{b.marker != null ? `${b.marker}${chart.unit === '%' ? '%' : ''}` : '—'}</td>}
                  <td>{b.sub}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="chart-legend rb-legend">
            {hasMarker && (
              <span className="legend-item">
                <i className="rb-marker-key" aria-hidden="true" /> {chart.markerLabel ?? 'Reference'}
              </span>
            )}
            <span className="rb-scale">{scaleText}</span>
          </div>
          <div className="bar-chart">
            {bars.map((b) => {
              const bad = b.tone === 'bad';
              const sub = bad ? `Over · ${b.sub ?? ''}` : b.sub;
              return (
                <div
                  key={b.label}
                  className="bar-row"
                  title={`${b.label}: ${b.display}${sub ? ` · ${sub}` : ''}`}
                >
                  <span className="bar-label">{b.label}</span>
                  <span className="bar-track rb-track">
                    <span
                      className={`bar-fill${bad ? ' is-bad' : ''}`}
                      // A non-zero value always shows a sliver, so it never reads as zero.
                      style={{ width: `${Number(b.value) > 0 ? Math.max(at(b.value), 1.5) : 0}%` }}
                    />
                    {b.marker != null && (
                      <span className="rb-marker" style={{ left: `${at(b.marker)}%` }} aria-hidden="true" />
                    )}
                  </span>
                  <span className="bar-value">{b.display}</span>
                  {sub && <span className={`bar-sub${bad ? ' rb-sub-bad' : ''}`}>{sub}</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
