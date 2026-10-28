/**
 * An analysis screen - a few reports from the server's registry, shown as
 * tabs, each with headline tiles, its charts and its table.
 *
 * Inventory Analysis and Vendor Performance are both this screen with a
 * different list of views. Every view is a report from report.service.js, so
 * the figures, the permission and the CSV are the ones the Reports screen
 * gives; this adds what a report table cannot - the tiles above it, the
 * charts the report sends, and one place to move between related questions.
 *
 * A view is `{ key, label, tiles(totals) => [...], chartEmpty?(totals) }`.
 * The active view lives in `?tab=`, so a link opens on it; the filters carry
 * across tabs, because "this supplier, this quarter" is usually the question
 * asked of all of them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { orders as ordersApi, reports as reportsApi, vendors as vendorsApi } from '../../services/erp.js';
import { Alert, EmptyState, PageHeader, Pagination, Spinner } from '../../components/ui.jsx';
import { fmtDate } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import ReportTable from '../../components/ReportTable.jsx';
import RankedBars from '../../components/RankedBars.jsx';
import { ReportFilter, loadFabricItems } from './Reports.jsx';

/**
 * `showTable={false}` draws the tiles and charts only - Vendor Performance.
 * The rows are still in the CSV download.
 */
export default function AnalysisScreen({ title, views: VIEWS, category, emptyMessage, showTable = true }) {
  const [params, setParams] = useSearchParams();

  const [catalogue, setCatalogue] = useState(null);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [itemOptions, setItemOptions] = useState([]);
  const [orderOptions, setOrderOptions] = useState([]);
  const [filters, setFilters] = useState({});
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    reportsApi
      .catalogue(category)
      .then((c) => setCatalogue(c.reports))
      .catch((e) => setError(e.message));
  }, [category]);

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
    [catalogue, VIEWS],
  );

  // The dropdowns the offered views actually use, each fetched once.
  const wants = useMemo(() => new Set(views.flatMap((v) => v.descriptor.filters)), [views]);
  useEffect(() => {
    if (wants.has('vendorId')) vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
    if (wants.has('itemId')) loadFabricItems().then(setItemOptions);
    if (wants.has('orderId')) ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, [wants]);

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
    // `?tab=`, not `?view=`: the Inventory hub owns `?view=` and renders
    // Inventory Analysis under `?view=analysis`, so every other parameter is
    // kept.
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

  const current = report && report.key === active?.key ? report : null;

  return (
    <>
      <PageHeader
        title={title}
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

      {catalogue && views.length === 0 && <EmptyState title="Nothing to analyse" message={emptyMessage} />}

      {views.length > 1 && (
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
          {active.intro && (
            <p className="faint" style={{ margin: '0 2px 12px', fontSize: 13 }}>
              {active.intro}
            </p>
          )}

          <div className="filter-row">
            {active.descriptor.filters.map((f) => (
              <ReportFilter
                key={f}
                name={f}
                value={filters[f] ?? ''}
                onChange={(v) => setFilters((prev) => ({ ...prev, [f]: v }))}
                buyerOptions={[]}
                vendorOptions={vendorOptions}
                orderOptions={orderOptions}
                itemOptions={itemOptions}
              />
            ))}
          </div>

          {current?.totals && (
            <div className="stat-grid analysis-tiles" style={{ marginBottom: 16 }}>
              {active.tiles(current.totals).map((t) => (
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

          {current && !loading && (
            <>
              {current.truncated && (
                <Alert kind="warning">
                  This hit its {current.rowCount}-row ceiling, so what follows is what was read
                  rather than everything. Narrow the dates or the filters.
                </Alert>
              )}

              {/* The charts cover the whole report; the table below is one page. */}
              {current.charts?.length > 0 && (
                <div className="rb-grid">
                  {current.charts.map((c) => (
                    <RankedBars
                      key={c.key}
                      chart={c}
                      emptyText={active.chartEmpty?.(c, current.totals) ?? undefined}
                    />
                  ))}
                </div>
              )}

              {/* A view with no charts and no table would be blank; say why. */}
              {!showTable && !current.charts?.length && (
                <p className="faint" style={{ margin: '0 2px 12px', fontSize: 13 }}>
                  Nothing recorded for these filters.
                </p>
              )}

              {showTable && (
                <>
                  <ReportTable report={current} />
                  {current.meta && (
                    <Pagination
                      meta={current.meta}
                      page={current.meta.page}
                      pageSize={current.meta.pageSize}
                      onPage={setPage}
                      onPageSize={setPageSize}
                    />
                  )}
                </>
              )}
              <p className="faint" style={{ margin: '6px 2px 0', fontSize: 11.5 }}>
                {current.rowCount} row(s) · the CSV covers all of them · generated{' '}
                {fmtDate(current.generatedAt)}
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
