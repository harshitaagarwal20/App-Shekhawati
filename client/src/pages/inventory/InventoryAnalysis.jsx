/**
 * Inventory analysis - the store, supplier by supplier.
 *
 * Three views, each one a report from the server's registry
 * (reports.inventory.js), so the figures, the permission and the CSV are the
 * same ones the Reports screen gives. This screen adds what a report table
 * cannot: the headline tiles above it, and one place to move between the
 * three questions people ask of a supplier's fabric -
 *
 *     how much of theirs do we hold?          Stock by supplier
 *     how well does their cloth cut?          Supplier yield
 *     what did inspection find on arrival?    Inward inspection
 *
 * The active view lives in `?tab=`, so a link opens on it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { reports as reportsApi, vendors as vendorsApi } from '../../services/erp.js';
import { Alert, EmptyState, PageHeader, Pagination, Spinner } from '../../components/ui.jsx';
import { fmtDate, fmtMoney, fmtNum } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import ReportTable from '../../components/ReportTable.jsx';
import { ReportFilter, loadFabricItems } from '../reports/Reports.jsx';

/*
 * `tiles` turns the report's totals into the headline row. Every figure is
 * already computed on the server; this only picks which ones to show and how.
 */
const VIEWS = [
  {
    key: 'supplier-stock',
    label: 'Stock by supplier',
    tiles: (t) => [
      { label: 'Suppliers', value: fmtNum(t.suppliers) },
      { label: 'Items', value: fmtNum(t.items) },
      { label: 'On hand', value: fmtNum(t.onHandQty) },
      { label: 'Stock value', value: fmtMoney(t.value) },
      { label: 'With job workers', value: fmtNum(t.withJobWorkerQty) },
      { label: 'Held / rejected', value: fmtNum(t.heldQty), bad: Number(t.heldQty) > 0 },
      { label: 'Older than 90 days', value: fmtNum(t.agedQty), bad: Number(t.agedQty) > 0 },
      { label: 'Rolls awaiting inspection', value: fmtNum(t.inspectionPending), bad: t.inspectionPending > 0 },
    ],
  },
  {
    key: 'supplier-yield',
    label: 'Supplier yield',
    tiles: (t) => [
      { label: 'Suppliers', value: fmtNum(t.suppliers) },
      { label: 'Items', value: fmtNum(t.items) },
      { label: 'Received', value: fmtNum(t.receivedQty) },
      { label: 'Issued to cutting', value: fmtNum(t.cutIssuedQty) },
      { label: 'Overall cutting yield', value: t.yieldPct ?? '—' },
      { label: 'Best yield', value: t.bestSupplier ?? '—', small: true },
    ],
  },
  {
    key: 'inward-inspection',
    label: 'Inward inspection',
    tiles: (t) => [
      {
        label: 'Awaiting inspection',
        value: fmtNum(t.pending),
        sub: `${fmtNum(t.pendingQty)} on those rolls`,
        bad: t.pending > 0,
      },
      { label: 'Passed', value: fmtNum(t.passed) },
      { label: 'Failed', value: fmtNum(t.failed), bad: t.failed > 0 },
      { label: 'Faulty length found', value: fmtNum(t.defectQty) },
      { label: 'Short length found', value: fmtNum(t.shortQty) },
    ],
  },
];

export default function InventoryAnalysis() {
  const [params, setParams] = useSearchParams();

  const [catalogue, setCatalogue] = useState(null);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [itemOptions, setItemOptions] = useState([]);
  const [filters, setFilters] = useState({});
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    reportsApi
      .catalogue('INVENTORY')
      .then((c) => setCatalogue(c.reports))
      .catch((e) => setError(e.message));
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
    loadFabricItems().then(setItemOptions);
  }, []);

  // Only the views this user's role may run - the catalogue is already
  // filtered by permission on the server.
  const views = useMemo(
    () =>
      (catalogue ?? [])
        .map((d) => {
          const view = VIEWS.find((v) => v.key === d.key);
          return view ? { ...view, descriptor: d } : null;
        })
        .filter(Boolean)
        .sort((a, b) => VIEWS.findIndex((v) => v.key === a.key) - VIEWS.findIndex((v) => v.key === b.key)),
    [catalogue],
  );

  const active = views.find((v) => v.key === params.get('tab')) ?? views[0] ?? null;

  const cleanFilters = useMemo(() => {
    if (!active) return {};
    return Object.fromEntries(
      active.descriptor.filters
        .map((f) => [f, filters[f]])
        .filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
  }, [active, filters]);

  const run = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError('');
    try {
      setReport(await reportsApi.run(active.key, { ...cleanFilters, page, pageSize }));
    } catch (e) {
      setError(e.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [active, cleanFilters, page, pageSize]);

  useEffect(() => {
    const id = setTimeout(run, 250);
    return () => clearTimeout(id);
  }, [run]);

  const filterKey = JSON.stringify(cleanFilters);
  useEffect(() => {
    setPage(1);
  }, [filterKey, active?.key, pageSize]);

  function choose(key) {
    // The supplier and the dates carry across views - "this supplier, this
    // quarter" is usually the question asked of all three.
    // `?tab=`, not `?view=`: the Inventory hub owns `?view=` and renders
    // this screen under `?view=analysis`, so every other parameter is kept.
    setReport(null);
    const next = new URLSearchParams(params);
    next.set('tab', key);
    setParams(next, { replace: true });
  }

  if (!catalogue && !error) {
    return (
      <div className="loading-row">
        <Spinner label="Loading..." />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Inventory Analysis"
        actions={
          active && (
            <button
              type="button"
              className="btn"
              disabled={downloading}
              onClick={() => {
                setDownloading(true);
                reportsApi
                  .downloadCsv(active.key, cleanFilters)
                  .catch((e) => setError(e.message))
                  .finally(() => setDownloading(false));
              }}
            >
              {downloading ? 'Preparing...' : 'Download CSV'}
            </button>
          )
        }
      />

      {error && <Alert kind="error">{error}</Alert>}

      {catalogue && views.length === 0 && (
        <EmptyState
          title="Nothing to analyse"
          message="Your role does not have access to the inventory analysis reports."
        />
      )}

      {views.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {views.map((v) => (
            <button
              key={v.key}
              type="button"
              className={`btn ${active?.key === v.key ? 'btn-primary' : ''}`}
              onClick={() => choose(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {active && (
        <>
          <div className="filter-row">
            {active.descriptor.filters.map((f) => (
              <ReportFilter
                key={f}
                name={f}
                value={filters[f] ?? ''}
                onChange={(v) => setFilters((prev) => ({ ...prev, [f]: v }))}
                buyerOptions={[]}
                vendorOptions={vendorOptions}
                orderOptions={[]}
                itemOptions={itemOptions}
              />
            ))}
          </div>

          {report?.totals && report.key === active.key && (
            <div className="stat-grid" style={{ marginBottom: 16 }}>
              {active.tiles(report.totals).map((t) => (
                <div key={t.label} className="stat">
                  <div className="label">{t.label}</div>
                  <div
                    className="value"
                    style={{
                      ...(t.small ? { fontSize: 15 } : {}),
                      ...(t.bad ? { color: 'var(--danger, #b02020)' } : {}),
                    }}
                  >
                    {t.value}
                  </div>
                  {t.sub && <div className="sub">{t.sub}</div>}
                </div>
              ))}
            </div>
          )}

          {loading && (
            <div className="loading-row">
              <Spinner label={`Running ${active.label.toLowerCase()}...`} />
            </div>
          )}

          {report && !loading && report.key === active.key && (
            <>
              {report.truncated && (
                <Alert kind="warning">
                  This hit its {report.rowCount}-row ceiling, so what follows is what was read
                  rather than everything. Narrow the dates or the filters.
                </Alert>
              )}
              <ReportTable report={report} />
              {report.meta && (
                <Pagination
                  meta={report.meta}
                  page={report.meta.page}
                  pageSize={report.meta.pageSize}
                  onPage={setPage}
                  onPageSize={setPageSize}
                />
              )}
              <p className="faint" style={{ margin: '6px 2px 0', fontSize: 11.5 }}>
                {report.rowCount} row(s) · the CSV covers all of them · generated{' '}
                {fmtDate(report.generatedAt)}
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
