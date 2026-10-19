/**
 * A month-by-month line chart, drawn in SVG with no chart library.
 *
 * One y-axis for every series - they all count documents. Lines are 2px with
 * an end dot; a hairline crosshair follows the pointer (or the arrow keys) and
 * one tooltip lists every series for that month. The legend carries each
 * series' total over the window, and the Table toggle shows every value
 * without hovering - which is required, because the aqua series sits below
 * 3:1 against white and must not be readable only by its colour.
 *
 * Every figure - the counts, each total, the peak - arrives from the server.
 * The only arithmetic here is placing points on the canvas.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtNum } from '../utils/format.js';

const H = 230;
const PAD = { top: 14, right: 18, bottom: 28, left: 36 };

/** A round step that gives about four gridlines: 1, 2, 5, 10, 20, 50... */
function niceStep(peak) {
  if (peak <= 4) return 1;
  const raw = peak / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
}

const num = (v) => fmtNum(v, { decimals: 0 });

export default function TrendChart({ trend }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof window.ResizeObserver === 'undefined') return undefined;
    const ro = new window.ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);

  const { months, series } = trend;
  const step = niceStep(trend.peak);
  const top = Math.max(step * Math.ceil(trend.peak / step), 4);
  const ticks = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);

  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (months.length === 1 ? plotW / 2 : (i * plotW) / (months.length - 1));
  const y = (v) => PAD.top + plotH * (1 - v / top);

  function pick(clientX) {
    const box = wrapRef.current.getBoundingClientRect();
    const px = clientX - box.left;
    let best = 0;
    months.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    setHover(best);
  }

  function onKey(e) {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(months.length - 1, (h ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? months.length) - 1));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  }

  return (
    <div className="trend">
      <div className="trend-top">
        <ul className="trend-legend">
          {series.map((s, i) => (
            <li key={s.key}>
              <i className={`line-key s${i + 1}`} aria-hidden="true" />
              <Link to={s.to}>{s.label}</Link>
              <span className="trend-total">{num(s.total)}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-sm" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Chart' : 'Table'}
        </button>
      </div>

      {asTable ? (
        <div className="table-wrap">
          <table className="data trend-table">
            <thead>
              <tr>
                <th>Month</th>
                {series.map((s) => (
                  <th key={s.key} className="num">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => (
                <tr key={m.key}>
                  <td>{m.label} {m.key.slice(0, 4)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="num">{num(s.counts[i])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="trend-plot"
          ref={wrapRef}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`Documents per month, ${months[0].label} to ${months[months.length - 1].label}. Use the arrow keys to read each month.`}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
                <text className="axis" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                  {num(t)}
                </text>
              </g>
            ))}
            {months.map((m, i) => (
              <text key={m.key} className="axis" x={x(i)} y={H - 8} textAnchor="middle">
                {m.label}
              </text>
            ))}

            {hover !== null && (
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />
            )}

            {series.map((s, si) => (
              <g key={s.key} className={`series s${si + 1}`}>
                <polyline points={s.counts.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
                {/* The end dot, and the hovered month's dot. */}
                <circle cx={x(months.length - 1)} cy={y(s.counts[months.length - 1])} r="4" />
                {hover !== null && hover !== months.length - 1 && (
                  <circle cx={x(hover)} cy={y(s.counts[hover])} r="4" />
                )}
              </g>
            ))}
          </svg>

          {hover !== null && (
            <div
              className="chart-tip"
              style={{
                left: Math.min(Math.max(x(hover) + 12, 0), width - 180),
                top: PAD.top,
              }}
              role="status"
            >
              <div className="chart-tip-head">
                {months[hover].label} {months[hover].key.slice(0, 4)}
              </div>
              {series.map((s, si) => (
                <div key={s.key} className="chart-tip-row">
                  <i className={`line-key s${si + 1}`} aria-hidden="true" />
                  <strong>{num(s.counts[hover])}</strong>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
