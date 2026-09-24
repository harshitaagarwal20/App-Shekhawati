/**
 * The approval queue — everything waiting on a decision, across every module.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS SCREEN EXISTS
 *
 *  The Director is the last gate on buyer orders, quotations, purchase orders,
 *  plans, scrutinies and cutting challans. Without this they would open six
 *  screens every morning to find out what is waiting for them, and the thing
 *  that has been waiting longest — which is nearly always the thing that
 *  matters — would be the hardest to find.
 *
 *  The list is one call. It is built on the shared workflow state, which is the
 *  practical payoff of having one approval engine rather than six: "waiting on
 *  a decision" means the same thing in every module, so it can be asked once.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { workflow as workflowApi } from '../services/erp.js';
import { Alert, EmptyState, PageHeader, Spinner } from '../components/ui.jsx';
import { StateBadge } from '../components/workflow.jsx';
import { fmtDateTime } from '../utils/format.js';
import TableWrap from '../components/TableWrap.jsx';

/** Where each document type's detail screen lives. */
/**
 * Where each queued document opens.
 *
 * THIS MAP MUST COVER EVERY KEY IN THE APPROVAL ENGINE'S REGISTRY. The queue is
 * built from `Object.keys(REGISTRY)`, so a document type registered with the
 * engine but missing here is still LISTED — it just sends the reader to `/`
 * when they click it. A dead click on the one screen whose whole job is "here
 * is what is waiting on you" is worse than not listing the row at all.
 *
 * DYE_ISSUE and CUTTING_CHALLAN were exactly that: both registered with the
 * engine, both appearing in the queue, neither openable from it. The rules test
 * below the fold does not catch it because it checks the navigation, not this
 * map — so the guard is `assertRoutesCoverRegistry()` in the queue's own test.
 */
const ROUTE_FOR = {
  BUYER_ORDER: (id) => `/orders/${id}`,
  PLANNING: (id) => `/planning/${id}`,
  VENDOR_QUOTATION: (id) => `/quotations/${id}`,
  PURCHASE_ORDER: (id) => `/purchase-orders/${id}`,
  GATE_PASS: (id) => `/gate-passes/${id}`,
  GRN: (id) => `/grns/${id}`,
  /**
   * F-04 - a correction waiting on a signature.
   *
   * It has no list screen and no navigation entry, so THIS is how an
   * approver reaches one. A missing entry here would have been the exact
   * dead click this map's guard test was written for.
   */
  GRN_REVERSAL: (id) => `/grn-reversals/${id}`,
  /** C3 - the job work order. One register, so dyeing and printing share it. */
  DYE_ISSUE: (id) => `/job-works/${id}`,
  FABRIC_SCRUTINY: (id) => `/scrutinies/${id}`,
  PLAN_APPROVAL: (id) => `/plan-approvals/${id}`,
  /** C12 - the raw material plan waiting on a signature. */
  MATERIAL_PLAN: (id) => `/material-plans/${id}`,
  /** C5 - the cutting requirement, raised before any fabric is issued. */
  CUTTING_CHALLAN: (id) => `/cutting-challans/${id}`,
  CUTTING_ISSUE: (id) => `/cutting-issues/${id}`,
};

export default function ApprovalQueue() {
  const navigate = useNavigate();

  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setQueue(await workflowApi.queue());
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

  if (loading && !queue) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Finding everything that is waiting..." />
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Awaiting decision"
        actions={
          <button type="button" className="btn" onClick={load}>
            Refresh
          </button>
        }
      />

      {error && <Alert kind="error">{error}</Alert>}

      {queue && queue.total === 0 && (
        <EmptyState
          title="Nothing is waiting"
          message="Every document in the system has been decided or is still a draft."
        />
      )}

      {queue && queue.total > 0 && (
        <>
          {queue.oldest && queue.oldest.ageDays >= 3 && (
            <Alert kind="warning">
              {queue.oldest.label} <strong>{queue.oldest.documentNo}</strong> has been waiting{' '}
              {queue.oldest.ageDays} days.
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginLeft: 10 }}
                onClick={() => navigate(ROUTE_FOR[queue.oldest.documentType]?.(queue.oldest.id) ?? '/')}
              >
                Open it
              </button>
            </Alert>
          )}

          {queue.groups.map((g) => (
            <div key={g.documentType} className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span>{g.label}</span>
                <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
                  {g.count} waiting
                </span>
              </div>
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>State</th>
                      <th>Waiting since</th>
                      <th className="num">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => navigate(ROUTE_FOR[g.documentType]?.(r.id) ?? '/')}
                        className={`clickable ${r.ageDays >= 3 ? 'row-warn' : ''}`}
                      >
                        <td className="code">{r.documentNo}</td>
                        <td>
                          <StateBadge state={r.state} />
                        </td>
                        <td className="nowrap">{fmtDateTime(r.waitingSince)}</td>
                        <td className="num">{r.ageDays}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          ))}
        </>
      )}

    </>
  );
}
