/**
 * Stock on hand.
 *
 * ---------------------------------------------------------------------------
 *  THIS IS A CACHE, AND THE SCREEN SAYS SO
 *
 *  Every figure here comes from `stock_balances`, which is derived from the
 *  stock ledger and nothing else. The Reconcile action re-derives every balance
 *  from the movements - `?dryRun=true` reports the differences without writing.
 *
 *  A derived cache that cannot be rebuilt was never really derived, so the
 *  rebuild is on the screen rather than in a runbook.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { inventory as invApi } from '../../services/erp.js';
import useResourceList from '../../hooks/useResourceList.js';
import {
  Alert,
  EmptyState,
  Field,
  MasterSelect,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
  TextInput,
} from '../../components/ui.jsx';
import { fmtMoney, fmtNum } from '../../utils/format.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

export default function StockSummary() {
  const navigate = useNavigate();
  const { can } = useAuth();

  const [reconciling, setReconciling] = useState(false);

  const canReconcile = can('INVENTORY.EXPORT');

  /**
   * Search, the two filters and paging are all the server's now.
   *
   * They used to be the browser's: the screen fetched every balance in the
   * store and filtered the array. That works until the store has more items
   * than a laptop wants to hold, and it silently makes the three tiles above
   * the table describe whatever survived the filter. Both problems go away by
   * asking the server the question instead of asking it for everything.
   */
  const list = useResourceList((params) => invApi.stock(params), {
    pageSize: 25,
    initialFilters: { location: '', itemCategory: '' },
  });

  const { rows, meta, loading, error, search, setSearch, filters, setFilter } = list;

  /**
   * Lines, value and the below-reorder tally, for the whole filter.
   *
   * The server sends them beside the page rather than in it, so they do not
   * change when you turn the page. See okListWithTotals on the server.
   */
  const totals = meta?.totals;

  return (
    <>
      <PageHeader
        title="Stock"
        actions={
          <>
            <ExportButton
              dataset="stock"
              params={list.query}
              rowCount={list.meta.total}
            />
            {canReconcile && (
              <button type="button" className="btn" onClick={() => setReconciling(true)}>
                Reconcile
              </button>
            )}
          </>
        }
      />

      {error && <Alert kind="error">{error.message}</Alert>}

      {/* No card: the table is the page. `.filter-row` is `.toolbar` without
          the card chrome - see styles.css. */}
      <div className="filter-row">
        <div className="grow">
          <Field label="Search" htmlFor="stock-search">
            <TextInput
              id="stock-search"
              type="search"
              placeholder="Search item code or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Location" htmlFor="stock-loc">
          <MasterSelect
            id="stock-loc"
            listCode="StockLocation"
            placeholder="All locations"
            value={filters.location}
            onChange={(e) => setFilter('location', e.target.value)}
          />
        </Field>

        <Field label="Category" htmlFor="stock-cat">
          <MasterSelect
            id="stock-cat"
            listCode="ItemCategory"
            placeholder="All categories"
            value={filters.itemCategory}
            onChange={(e) => setFilter('itemCategory', e.target.value)}
          />
        </Field>
      </div>

      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <th>Item Code</th>
              <th>Description</th>
              <th>Category</th>
              <th>Location</th>
              <th>UOM</th>
              <th className="num">On hand</th>
              <th className="num">In process</th>
              <th className="num">Avg rate</th>
              <th className="num">Value</th>
              <th className="num">Reorder level</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="loading-row">
                  <Spinner label="Loading stock..." />
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={10}>
                  <EmptyState
                    title="No stock to show"
                    message="Stock appears here once a GRN has been posted."
                  />
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((r) => (
                <tr
                  key={`${r.itemId}-${r.location}`}
                  onClick={() => navigate(`/inventory/items/${r.itemId}`)}
                  className={`clickable ${r.belowReorderLevel ? 'row-warn' : ''}`}
                >
                  <td className="code">{r.itemCode}</td>
                  <td>
                    {r.description}
                    {r.isRollTracked && <div className="faint">tracked roll by roll</div>}
                  </td>
                  <td>{r.itemCategory}</td>
                  <td>{r.location}</td>
                  <td>{r.uom}</td>
                  <td className="num">
                    <strong>{fmtNum(r.qty)}</strong>
                  </td>
                  <td className="num">{fmtNum(r.inProcessQty)}</td>
                  <td className="num">{fmtNum(r.avgRate, { decimals: 4 })}</td>
                  <td className="num">{fmtMoney(r.value)}</td>
                  <td className="num">
                    {Number(r.reorderLevel) > 0 ? fmtNum(r.reorderLevel) : '-'}
                    {r.belowReorderLevel && <div className="faint">below</div>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </TableWrap>

      <Pagination
        meta={meta}
        page={list.page}
        pageSize={list.pageSize}
        onPage={list.setPage}
        onPageSize={list.setPageSize}
      />

      {reconciling && (
        <ReconcileDialog onClose={() => setReconciling(false)} onDone={list.reload} />
      )}
    </>
  );
}

/**
 * Rebuilds every balance from the ledger.
 *
 * The dry run first, always: an auditor wants to see the differences before
 * anything is written, and a rebuild that silently fixed a discrepancy would
 * destroy the evidence that there had been one.
 */
function ReconcileDialog({ onClose, onDone }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (dryRun) => {
    setBusy(true);
    setError('');
    try {
      const r = await invApi.reconcile(dryRun ? 'true' : 'false');
      setResult(r);
      if (!dryRun) await onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    run(true);
    // Run the dry run once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal
      title="Reconcile stock balances"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => run(true)}
            disabled={busy}
          >
            Check again
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => run(false)}
            disabled={busy || result?.inAgreement}
          >
            {busy ? 'Working...' : 'Rebuild from the ledger'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>

        <p style={{ marginTop: 0 }}>
          Every balance in this system is a cache of the stock ledger. This re-derives all of them
          from the movements and reports anything that had drifted.
        </p>

        {busy && !result && <Spinner label="Checking every balance against the ledger..." />}

        {result && (
          <>
            {result.inAgreement ? (
              <Alert kind="success">
                All {result.checked} balances agree with the ledger. Nothing to rebuild.
              </Alert>
            ) : (
              <Alert kind="warning">
                {result.differences.length} of {result.checked} balances disagree with the ledger.
                {result.rebuilt && ' They have been rebuilt.'}
              </Alert>
            )}

            {result.differences.length > 0 && (
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Location</th>
                      <th className="num">Cached</th>
                      <th className="num">Ledger</th>
                      <th className="num">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.differences.map((d) => (
                      <tr key={`${d.itemId}-${d.location}`}>
                        <td>
                          <span className="code">{d.itemCode}</span>
                          <div className="faint">{d.description}</div>
                        </td>
                        <td>{d.location}</td>
                        <td className="num">{fmtNum(d.storedQty)}</td>
                        <td className="num">{fmtNum(d.ledgerQty)}</td>
                        <td className="num">
                          <strong>{fmtNum(d.difference)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
