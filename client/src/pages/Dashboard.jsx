/**
 * The dashboard.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THIS SCREEN IS FOR
 *
 *  It is the first thing every user sees, laid out like an Odoo dashboard -
 *  stat cards across the top, then chart panels in a two-column grid:
 *
 *    THE HEADLINE         a row of stat cards, read in one glance
 *    THE TREND            documents per month at four points of the pipeline
 *    AWAITING DECISION    what is waiting, and how much of it is waiting on me
 *    NEEDS ATTENTION      what has been left too long, worst first
 *    LOW STOCK            the items furthest under their reorder level
 *    MASTERS              how many buyers, vendors, styles... a footer strip
 *
 *  Every panel is optional: a section the server did not send is not drawn,
 *  and the grid closes up around it.
 *
 *  WHY BARS RATHER THAN A GRID OF NUMBERS
 *
 *  Both of the middle sections answer "compare these counts", and a column of
 *  numerals makes the reader do the comparing. A bar does it for them: eleven
 *  pipeline stages sorted by what is in flight show the bottleneck at a glance,
 *  which eleven numerals in boxes never did.
 *
 *  The bars are one hue (`--chart`, a colour from the company's own site,
 *  validated for contrast and colour-vision separation) because every bar in a
 *  chart measures the SAME thing - length carries the magnitude, so colour has
 *  no work left to do. The one exception is the approvals chart, where the
 *  split between "yours" and "everyone else's" is the point: that is emphasis,
 *  one hue against a de-emphasis grey, with a legend.
 *
 *  ONE CALL. `GET /api/dashboard` returns all of it, already filtered by this
 *  user's permissions and with every figure worked out. This file contains no
 *  arithmetic: no count, no total, no age in days. That is the same rule the
 *  rest of the client holds to, and on a screen made entirely of numbers it is
 *  the rule that matters most.
 *
 *  A section the server did not send is a section this user may not see, and
 *  it is simply not rendered. That is why there is no permission check in this
 *  file - the response shape IS the permission check, and duplicating it here
 *  would be a second place for it to drift.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { dashboard as dashboardApi, health } from '../services/erp.js';
import { Alert, EmptyState, Spinner } from '../components/ui.jsx';
import TrendChart from '../components/TrendChart.jsx';
import { fmtMoney, fmtNum } from '../utils/format.js';

/**
 * The stage a document type's queue is worked from.
 *
 * The approval queue screen already lists every pending document across every
 * module, so a group here links into it rather than reimplementing the list.
 *
 * THIS MAP MUST NAME EVERY KEY IN THE APPROVAL ENGINE'S REGISTRY, because the
 * bars are built from `pendingSummary()` and that is built from the registry.
 * A type missing here renders a bar with no `to`, so the reader is told four
 * material plans are waiting on them and given nowhere to go — the same dead
 * end `ROUTE_FOR` in ApprovalQueue.jsx was fixed for, one screen earlier.
 * MATERIAL_PLAN, DYE_ISSUE and CUTTING_CHALLAN were all in that state. The
 * guard is in dashboard.rules.test.js.
 *
 * A `null` means the type has no list screen of its own; the bar falls back to
 * the approval queue, which is the only place it can be worked from.
 */
const QUEUE_ROUTE = {
  BUYER_ORDER: '/orders',
  PLANNING: '/planning',
  /** C12 - the raw material plan, signed before procurement goes to market. */
  MATERIAL_PLAN: '/material-plans',
  VENDOR_QUOTATION: '/quotations',
  PURCHASE_ORDER: '/purchase-orders',
  GATE_PASS: '/gate-passes',
  GRN: '/grns',
  /**
   * F-04 - the correction has a detail screen and no list screen, deliberately:
   * it is only ever raised from the receipt it reverses. So there is no stage
   * to send the reader to, and the bar falls back to the approval queue below.
   */
  GRN_REVERSAL: null,
  /** C3 - the job work order. One register, so dyeing and printing share it. */
  DYE_ISSUE: '/job-works',
  FABRIC_SCRUTINY: '/scrutinies',
  PLAN_APPROVAL: '/plan-approvals',
  /** C5 - the cutting requirement, raised before any fabric is issued. */
  CUTTING_CHALLAN: '/cutting-challans',
  CUTTING_ISSUE: '/cutting-issues',
};

/**
 * Whether the server sent nothing this screen draws.
 *
 * Only what the screen actually draws counts. Every drawn section has to be
 * absent before "your role grants nothing" is the right thing to say.
 *
 * `masters` and `activity` are not consulted: on their own they are reference,
 * not work, and a role holding only those still has nothing to act on. (The
 * activity feed is not drawn at all - the Audit Trail screen is where it lives.)
 * Nor is `pipeline`: the server still sends it, but the card was removed from
 * this screen.
 */
function isEmptyDashboard(data) {
  return (
    !data.approvals &&
    !data.stock &&
    !data.attention &&
    !data.trend
  );
}

/** "3 days", "1 day", "today" - the way somebody would say it out loud. */
function ageLabel(days) {
  if (days === null || days === undefined) return null;
  if (days <= 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Health is a separate call because it must still answer when the
      // dashboard cannot - a database that is down is exactly the case where
      // the user needs to be told why the screen is empty.
      const [summary, healthResult] = await Promise.all([
        dashboardApi(),
        health().catch(() => null),
      ]);
      setData(summary);
      setStatus(healthResult);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const firstName = user?.fullName?.split(' ')[0] ?? 'there';
  const roleNames = (user?.roles ?? []).map((r) => r.name).join(', ') || 'no role';

  return (
    <div className="home">
      <header className="home-hero">
        <div>
          <h1 className="home-title">
            {greeting()}, {firstName}
          </h1>
        </div>
        <button type="button" className="btn" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && <Alert kind="error">{error}</Alert>}

      {status?.database === 'down' && (
        <Alert kind="error">
          The API cannot reach the database. Nothing on this screen is current until the connection
          is restored.
        </Alert>
      )}

      {loading && !data && (
        <div className="card">
          <div className="loading-row">
            <Spinner label="Loading the dashboard..." />
          </div>
        </div>
      )}

      {data && isEmptyDashboard(data) && (
        <EmptyState
          title="Nothing is assigned to your role yet"
          message={`You are signed in as ${roleNames}, which does not currently grant access to any screen. An administrator can add permissions to your role.`}
        />
      )}

      {data && !isEmptyDashboard(data) && (
        <>
          <KpiRow approvals={data.approvals} stock={data.stock} />

          {/* Panels flow into a two-column grid; `wide` spans both. A panel
              whose section was not sent is simply absent and the grid closes
              up around it. */}
          <div className="home-grid">
            {data.trend && (
              <Panel title="Documents per month" note="last 6 months" wide>
                <TrendChart trend={data.trend} />
              </Panel>
            )}
            {data.approvals?.total > 0 && (
              <Panel>
                <ApprovalsSection approvals={data.approvals} />
              </Panel>
            )}
            {data.attention && (
              <Panel>
                <AttentionSection items={data.attention} />
              </Panel>
            )}
            {data.stock?.lowest?.length > 0 && (
              <Panel>
                <LowStockSection stock={data.stock} />
              </Panel>
            )}
          </div>

          <MastersStrip masters={data.masters} />
        </>
      )}
    </div>
  );
}

/** A white card on the grey page - the unit the dashboard grid is made of. */
function Panel({ title, note, wide = false, children }) {
  return (
    <div className={`home-panel${wide ? ' is-wide' : ''}`}>
      {title && (
        <h2 className="dash-heading">
          {title}
          {note && <span className="dash-heading-note">{note}</span>}
        </h2>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  1. THE HEADLINE
// ---------------------------------------------------------------------------

/**
 * Stat cards, Odoo-style: a coloured edge, a label, one large figure and a
 * line of context. Every figure is the server's; a card whose section was not
 * sent is not drawn.
 */
function Kpi({ label, value, sub, to, tone = '' }) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </>
  );
  return to ? (
    <Link to={to} className={`kpi kpi-link ${tone}`}>{body}</Link>
  ) : (
    <div className={`kpi ${tone}`}>{body}</div>
  );
}

function KpiRow({ approvals, stock }) {
  if (!approvals && !stock) return null;
  return (
    <div className="kpi-row">
      {approvals && (
        <Kpi
          label="Awaiting decision"
          value={fmtNum(approvals.total, { decimals: 0 })}
          sub={
            approvals.mineTotal > 0
              ? `${fmtNum(approvals.mineTotal, { decimals: 0 })} yours to decide`
              : 'none waiting on you'
          }
          to={approvals.queueTo ?? undefined}
          tone={approvals.mineTotal > 0 ? 'is-mine' : ''}
        />
      )}
      {stock && (
        <>
          <Kpi
            label="Fabric stock value"
            value={fmtMoney(stock.stockValue)}
            sub="all locations"
            to="/inventory"
            tone="is-mine"
          />
          <Kpi
            label="Rolls on hand"
            value={fmtNum(stock.rollsOnHand, { decimals: 0 })}
            sub={stock.heldRolls > 0 ? `${fmtNum(stock.heldRolls, { decimals: 0 })} on hold` : 'none on hold'}
            to="/inventory"
            tone={stock.heldRolls > 0 ? 'is-warn' : ''}
          />
          <Kpi
            label="Fabric below reorder"
            value={fmtNum(stock.belowReorder, { decimals: 0 })}
            sub={stock.belowReorder > 0 ? (stock.lowest?.[0]?.description ?? 'items short') : 'nothing short'}
            to="/inventory"
            tone={stock.belowReorder > 0 ? 'is-bad' : ''}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  NEEDS ATTENTION
// ---------------------------------------------------------------------------

/**
 * Like Odoo's activity list: what is overdue, worst first. The server already
 * sorted it by severity and then age. An empty list is the good case and says
 * so; `null` (not this user's to see) never reaches here.
 */
function AttentionSection({ items }) {
  return (
    <section className="dash-section">
      <h2 className="dash-heading">Needs attention</h2>
      {items.length === 0 ? (
        <p className="attn-clear">Nothing is overdue. All clear.</p>
      ) : (
        <ul className="attn-list">
          {items.map((a) => (
            <li key={a.key}>
              <Link to={a.to} className={`attn-row sev-${a.severity}`}>
                <span className="attn-dot" aria-hidden="true" />
                <span className="attn-text">
                  <strong>{a.title}</strong>
                  <span>
                    {a.detail}
                    {a.oldestAgeDays > 0 ? ` · oldest ${ageLabel(a.oldestAgeDays)}` : ''}
                  </span>
                </span>
                <span className="attn-count">{fmtNum(a.count, { decimals: 0 })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
//  LOW STOCK
// ---------------------------------------------------------------------------

/**
 * The five items furthest under their reorder level, worst first (the server
 * ranked them). Each bar is the stock on hand against a track that is the
 * reorder level, so how empty the track is shows how short the item is.
 */
function LowStockSection({ stock }) {
  return (
    <section className="dash-section">
      <h2 className="dash-heading">
        Fabric below reorder level
        <span className="dash-heading-count">{fmtNum(stock.belowReorder, { decimals: 0 })}</span>
        <Link to="/inventory" className="dash-heading-link">Open inventory</Link>
      </h2>
      <div className="bar-chart">
        {stock.lowest.map((it) => (
          <Bar
            key={it.itemId}
            label={it.description || it.itemCode}
            value={Number(it.qty)}
            max={Number(it.reorderLevel)}
            tone="is-bad"
            note={fmtNum(it.qty, { decimals: 0 })}
            sub={`of ${fmtNum(it.reorderLevel, { decimals: 0 })} ${it.uom ?? ''} · short ${fmtNum(it.shortfall, { decimals: 0 })}`}
            to="/inventory"
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
//  MASTERS
// ---------------------------------------------------------------------------

function MastersStrip({ masters }) {
  if (!masters || masters.length === 0) return null;
  return (
    <div className="masters-strip">
      {masters.map((m) => (
        <Link key={m.key} to={m.to} className="master-chip">
          <strong>{fmtNum(m.count, { decimals: 0 })}</strong>
          <span>{m.label}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * One horizontal bar.
 *
 * `value` sets the length against `max`; a zero-length bar still renders its
 * track, because "this stage is clear" is a reading and a missing bar is not.
 * The number is direct-labelled at the end rather than left to an axis, so the
 * chart needs no gridlines and stays legible at any width.
 */
function Bar({ label, value, max, sub, note, to, tone = '' }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0;
  const body = (
    <>
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        <span className={`bar-fill ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="bar-value">{note ?? fmtNum(value, { decimals: 0 })}</span>
      {sub && <span className="bar-sub">{sub}</span>}
    </>
  );
  const title = `${label}: ${note ?? value}${sub ? ` · ${sub}` : ''}`;
  return to ? (
    <Link to={to} className="bar-row" title={title}>{body}</Link>
  ) : (
    <div className="bar-row" title={title}>{body}</div>
  );
}

// ---------------------------------------------------------------------------
//  2. AWAITING DECISION
// ---------------------------------------------------------------------------

/**
 * `mine` is the whole point of this section.
 *
 * A planner and the Director both see that six quotations are pending, but
 * only one of them is the reason they are still pending. The groups this user
 * can actually decide are shown first and marked; the rest are context.
 */
function ApprovalsSection({ approvals }) {
  if (!approvals || approvals.total === 0) return null;

  const mine = approvals.groups.filter((g) => g.mine);
  const others = approvals.groups.filter((g) => !g.mine);
  /* One scale for every bar in the chart. Scaling each group to itself would
     make a queue of two look like a queue of twenty. */
  const queueMax = Math.max(...approvals.groups.map((g) => g.count), 1);

  return (
    <section className="dash-section">
      <h2 className="dash-heading">
        Awaiting decision
        <span className="dash-heading-count">{approvals.total}</span>
        {/*
          The shared queue screen is guarded by APPROVAL_QUEUE.VIEW, which is not the
          permission that put any of these groups on screen. The server sends
          `queueTo: null` when this user cannot reach it, rather than offering
          a link that lands on Forbidden.
        */}
        {approvals.queueTo && (
          <Link to={approvals.queueTo} className="dash-heading-link">
            Open the queue
          </Link>
        )}
      </h2>

      {approvals.mineTotal > 0 && (
        <p className="dash-lede">
          <strong>{fmtNum(approvals.mineTotal, { decimals: 0 })}</strong> of these are yours to
          decide.
        </p>
      )}

      {/* Emphasis, not categorical: the reader's own queue is the series that
          matters and the rest is context, so it is one hue against a grey
          rather than a color per document type. Two series, so there is a
          legend - identity is never carried by color alone. */}
      <div className="chart-legend">
        <span className="legend-item"><i className="swatch sw-mine" />Yours to decide</span>
        <span className="legend-item"><i className="swatch sw-other" />Waiting on someone else</span>
      </div>

      <div className="bar-chart">
        {[...mine, ...others].map((g) => (
          <Bar
            key={g.documentType}
            label={g.label}
            value={g.count}
            max={queueMax}
            tone={g.mine ? '' : 'is-other'}
            sub={g.oldestAgeDays > 0 ? `oldest ${ageLabel(g.oldestAgeDays)}` : 'all raised today'}
            /**
             * The stage screen, or the approval queue for a type that has no
             * list of its own. `queueTo` is the server's decision and is null
             * when this user lacks APPROVAL_QUEUE.VIEW, so the fallback can never land
             * them on Forbidden — it just leaves the bar unlinked, which is
             * the honest answer when there is nowhere they may go.
             */
            to={QUEUE_ROUTE[g.documentType] ?? approvals.queueTo ?? undefined}
          />
        ))}
      </div>

      {approvals.oldest && approvals.oldest.ageDays >= 3 && (
        <Alert kind="warning">
          {approvals.oldest.label} <strong>{approvals.oldest.documentNo}</strong> has been waiting{' '}
          {ageLabel(approvals.oldest.ageDays)} — the longest of anything you can see. It is measured
          across the document types this role may view, not the whole system.
        </Alert>
      )}
    </section>
  );
}

