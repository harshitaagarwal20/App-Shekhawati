/**
 * The dashboard.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THIS SCREEN IS FOR
 *
 *  It is the first thing every user sees, and it answers three questions in
 *  the order somebody standing in the office actually asks them:
 *
 *    1. THE HEADLINE      five figures, read in one glance
 *    2. AWAITING DECISION what is waiting, and how much of it is waiting on me
 *    3. THE PIPELINE      where the work is sitting, stage by stage
 *
 *  The reference panels that used to sit below - stock, recent activity, the
 *  master counts - have been removed: each is a screen of its own, and none of
 *  them was a reason to act.
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
import { Alert, EmptyState, PageHeader, Spinner } from '../components/ui.jsx';
import { fmtNum } from '../utils/format.js';

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
 * Whether this user holds nothing at all.
 *
 * Only what the screen actually draws counts. A store manager may hold gate
 * passes and GRNs and no approval at all, and telling them their role grants
 * nothing while eleven pipeline stages sit above the message would be both
 * wrong and alarming. Every section has to be absent before that is the right
 * thing to say.
 *
 * `masters` and `activity` are not consulted: the server still sends them, but
 * nothing on this screen renders them, so their presence would claim a section
 * the reader cannot see. `stock` still counts - it feeds three KPI tiles.
 *
 * An empty `attention` is not evidence either way - it means nothing is wrong,
 * which is the good case, so it is not consulted here.
 */
function isEmptyDashboard(data) {
  return (data.pipeline?.length ?? 0) === 0 && !data.approvals && !data.stock;
}

/** "3 days", "1 day", "today" - the way somebody would say it out loud. */
function ageLabel(days) {
  if (days === null || days === undefined) return null;
  if (days <= 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
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

  if (loading && !data) {
    return (
      <>
        <PageHeader title={`Welcome, ${firstName}`} />
        <div className="card">
          <div className="loading-row">
            <Spinner label="Reading the pipeline..." />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={`Welcome, ${firstName}`} />

      {error && <Alert kind="error">{error}</Alert>}

      {status?.database === 'down' && (
        <Alert kind="error">
          The API cannot reach the database. Nothing on this screen is current until the connection
          is restored.
        </Alert>
      )}

      {data && isEmptyDashboard(data) && (
        <EmptyState
          title="Nothing is assigned to your role yet"
          message={`You are signed in as ${roleNames}, which does not currently grant access to any screen. An administrator can add permissions to your role.`}
        />
      )}

      {data && !isEmptyDashboard(data) && (
        <>
          <ApprovalsSection approvals={data.approvals} />
          <PipelineSection stages={data.pipeline} />
        </>
      )}
    </>
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
          The shared queue screen is guarded by REPORT.VIEW, which is not the
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
          rather than a colour per document type. Two series, so there is a
          legend - identity is never carried by colour alone. */}
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
             * when this user lacks REPORT.VIEW, so the fallback can never land
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

// ---------------------------------------------------------------------------
//  3. THE PIPELINE
// ---------------------------------------------------------------------------

/**
 * Masters -> Cutting Issue, stage by stage, in pipeline order.
 *
 * `open` is what is in flight; `recent` is what has moved in the last seven
 * days. Both are needed, because they tell a quiet stage apart from a stuck
 * one: nine open and nothing this week is a different problem from nine open
 * with six booked yesterday, and a single number cannot say which it is.
 *
 * `open` arrives as `null` for a stage whose documents are terminal the moment
 * they are written - a goods receipt is posted as it is created, so there is no
 * such thing as an open one. That is drawn as a dash rather than a zero:
 * "none in flight" and "no such thing as in flight here" are different facts,
 * and a confident 0 in the all-clear styling reads as the first.
 */
function PipelineSection({ stages }) {
  if (!stages || stages.length === 0) return null;

  const openMax = Math.max(...stages.map((s) => s.open ?? 0), 1);
  /* A stage with no such thing as "open" sinks to the bottom rather than
     sorting as a zero, which would read as "this stage is clear". */
  const ranked = [...stages].sort((a, b) => {
    if (a.open === null) return 1;
    if (b.open === null) return -1;
    return b.open - a.open;
  });

  return (
    <section className="dash-section">
      <h2 className="dash-heading">
        The pipeline
        <span className="dash-heading-note">open now, busiest first · last 7 days</span>
      </h2>

      {/* Sorted by what is in flight rather than left in pipeline order: the
          question this chart answers is "where is the work piling up", and the
          answer should be the top bar. The stage's own position in the pipeline
          is on the left of each row, so the sequence is not lost. */}
      <div className="bar-chart">
        {ranked.map((s) => (
          <Bar
            key={s.key}
            label={s.label}
            value={s.open ?? 0}
            max={openMax}
            tone={s.open === null ? 'is-na' : ''}
            note={s.open === null ? '—' : undefined}
            sub={
              s.open === null
                ? 'posted as written'
                : s.recent > 0
                  ? `+${fmtNum(s.recent, { decimals: 0 })} this week`
                  : 'nothing this week'
            }
            to={s.to}
          />
        ))}
      </div>

      <p className="faint dash-foot">
        The pipeline ends at Cutting Issue. Stitching, QC records, packing and dispatch are not part
        of this system.
      </p>
    </section>
  );
}

