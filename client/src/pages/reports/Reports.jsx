/**
 * Operational reports.
 *
 * ===========================================================================
 *  ONE SCREEN, FOURTEEN REPORTS
 * ===========================================================================
 *
 * The server sends each report's columns — key, label, and how to format the
 * value — so this file renders all fourteen without knowing what any of them
 * is. Fourteen bespoke screens would be fourteen chances to format a quantity
 * differently, and a report that disagrees with the screen it came from is
 * worse than no report.
 *
 * The same descriptors drive the filter controls: a report declares which
 * filters it accepts, and only those are shown.
 *
 * LAID OUT LIKE ZOHO'S REPORTS CENTER. The landing page lists every report
 * by category, with a category rail, a search and starred favourites; opening
 * one gives a toolbar (period preset, Customize report, Export, Print) over
 * the report set out as a page - company, title and period above the table.
 * The URL carries `?report=` and `?category=`, so a report can be linked to.
 *
 * RBAC comes from the catalogue, which the server has already filtered by
 * permission — so a user is never offered a report the API would refuse. The
 * API checks the same permission again on every run.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  buyers as buyersApi,
  inventory as inventoryApi,
  orders as ordersApi,
  reports as reportsApi,
  vendors as vendorsApi,
} from '../../services/erp.js';
import {
  Alert,
  EmptyState,
  EnumSelect,
  Field,
  Pagination,
  MasterSelect,
  RecordSelect,
  Spinner,
  TextInput,
} from '../../components/ui.jsx';
import { fmtDate, fmtDateTime, fmtEnum, toDateInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import ReportTable from '../../components/ReportTable.jsx';

/** Which control to render for each filter a report declares. */
const FILTER_LABEL = {
  buyerId: 'Buyer',
  vendorId: 'Vendor',
  orderId: 'Order',
  itemId: 'Item',
  location: 'Location',
  firmName: 'Unit',
  itemCategory: 'Item category',
  colorCode: 'Colour',
  purpose: 'Purpose',
  stage: 'Roll stage',
  status: 'Status',
  approvalStatus: 'Approval',
  decision: 'Decision',
  inspectionStatus: 'Inspection',
  dateFrom: 'From',
  dateTo: 'To',
};

const ENUM_OPTIONS = {
  purpose: ['CUTTING', 'DYEING', 'PRINTING', 'STITCHING', 'RETURN', 'SAMPLING', 'OTHER'],
  stage: [
    'RAW', 'ISSUED_FOR_DYEING', 'ISSUED_FOR_PRINTING', 'DYED', 'PRINTED',
    'SCRUTINY_HOLD', 'ISSUED_TO_CUTTING', 'CONSUMED', 'REJECTED',
  ],
  status: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED'],
  approvalStatus: ['PENDING', 'APPROVED', 'REJECTED'],
  decision: ['ACCEPT', 'REJECT', 'REWORK'],
  inspectionStatus: ['PENDING', 'PASSED', 'FAILED'],
};

/**
 * The roll-tracked stock items - the fabrics - for the Item filter. Empty,
 * not an error, for a role that may not list stock items.
 */
export function loadFabricItems() {
  return inventoryApi.itemOptions({ rollTrackedOnly: 'true' }).catch(() => []);
}

/** Which List Master a filter reads from, where it is a business dropdown. */
const MASTER_LIST = {
  location: 'StockLocation',
  itemCategory: 'ItemCategory',
  colorCode: 'ColorCode',
  firmName: 'StitchingUnit',
};

/**
 * The categories, in the order the rail lists them. A category the catalogue
 * holds no report for (for this role) is not shown.
 */
const CATEGORIES = [
  { value: 'PLANNING', label: 'Orders & Planning' },
  { value: 'PROCUREMENT', label: 'Procurement' },
  { value: 'INVENTORY', label: 'Inventory' },
  { value: 'STAFF_EFFICIENCY', label: 'Job Work & Quality' },
];
const categoryLabel = (c) => CATEGORIES.find((x) => x.value === c)?.label ?? fmtEnum(c);

/** Favourites are a per-person convenience, so they live in this browser. */
const FAV_KEY = 'reports.favourites';
function readFavourites() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function writeFavourites(keys) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(keys));
  } catch {
    // Private window or blocked storage: the star just does not persist.
  }
}

/**
 * Date-range presets, as in Zoho: the reader picks a period by name and the
 * From / To filters are filled in. "Custom" leaves the two dates to them.
 * These are inputs to the report, not figures in it - the server still does
 * all of the arithmetic on what comes back.
 */
const iso = (d) => toDateInput(d);
function presetRange(key) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = now.getDay() || 7; // Monday-first week
  switch (key) {
    case 'today':
      return [iso(now), iso(now)];
    case 'week': {
      const start = new Date(now);
      start.setDate(now.getDate() - day + 1);
      return [iso(start), iso(now)];
    }
    case 'month':
      return [iso(new Date(y, m, 1)), iso(now)];
    case 'lastMonth':
      return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case 'quarter': {
      // The Indian financial quarter: Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar.
      const q = Math.floor(((m + 9) % 12) / 3);
      const startMonth = (q * 3 + 3) % 12;
      const startYear = startMonth > m ? y - 1 : y;
      return [iso(new Date(startYear, startMonth, 1)), iso(now)];
    }
    case 'fy': {
      const startYear = m >= 3 ? y : y - 1;
      return [iso(new Date(startYear, 3, 1)), iso(now)];
    }
    default:
      return null;
  }
}
const PRESETS = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'fy', label: 'This financial year' },
  { value: 'custom', label: 'Custom' },
];

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('report') ?? '';

  const [catalogue, setCatalogue] = useState(null);
  const [error, setError] = useState('');

  const [buyerOptions, setBuyerOptions] = useState([]);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [orderOptions, setOrderOptions] = useState([]);
  const [itemOptions, setItemOptions] = useState([]);

  useEffect(() => {
    // The whole catalogue once; the rail and the search narrow it here. The
    // server has already filtered it by permission.
    reportsApi
      .catalogue('')
      .then((c) => setCatalogue(c.reports))
      .catch((e) => setError(e.message));

    buyersApi.options().then(setBuyerOptions).catch(loadFailed(setBuyerOptions, 'buyers'));
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
    // Quietly empty for a role without INVENTORY.VIEW: the Item filter then
    // offers nothing, which is all such a role could be shown anyway.
    loadFabricItems().then(setItemOptions);
  }, []);

  const descriptor = useMemo(
    () => catalogue?.find((r) => r.key === selected) ?? null,
    [catalogue, selected],
  );

  if (!catalogue && !error) {
    return (
      <div className="loading-row">
        <Spinner label="Loading reports..." />
      </div>
    );
  }

  if (descriptor) {
    return (
      <ReportView
        key={descriptor.key}
        descriptor={descriptor}
        onBack={() => setParams(params.get('category') ? { category: params.get('category') } : {})}
        options={{ buyerOptions, vendorOptions, orderOptions, itemOptions }}
      />
    );
  }

  return (
    <ReportsCenter
      catalogue={catalogue ?? []}
      error={error}
      category={params.get('category') ?? 'ALL'}
      onCategory={(c) => setParams(c === 'ALL' ? {} : { category: c })}
      onOpen={(key) =>
        setParams({ report: key, ...(params.get('category') ? { category: params.get('category') } : {}) })
      }
    />
  );
}

// ===========================================================================
//  THE REPORTS CENTER - every report this role may run, by category
// ===========================================================================

function ReportsCenter({ catalogue, error, category, onCategory, onOpen }) {
  const [query, setQuery] = useState('');
  const [favourites, setFavourites] = useState(readFavourites);

  function toggleFavourite(key) {
    setFavourites((f) => {
      const next = f.includes(key) ? f.filter((k) => k !== key) : [...f, key];
      writeFavourites(next);
      return next;
    });
  }

  const categories = CATEGORIES.filter((c) => catalogue.some((r) => r.category === c.value));
  const q = query.trim().toLowerCase();
  const matches = catalogue.filter(
    (r) =>
      (category === 'ALL' ||
        (category === 'FAVOURITES' ? favourites.includes(r.key) : r.category === category)) &&
      (!q || r.title.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)),
  );
  const groups = (category === 'ALL' || category === 'FAVOURITES' ? categories : categories.filter((c) => c.value === category))
    .map((c) => ({ ...c, reports: matches.filter((r) => r.category === c.value) }))
    .filter((g) => g.reports.length > 0);

  const railItem = (value, label, count) => (
    <button
      key={value}
      type="button"
      className={`rc-rail-item${category === value ? ' is-active' : ''}`}
      onClick={() => onCategory(value)}
    >
      <span>{label}</span>
      <span className="rc-rail-count">{count}</span>
    </button>
  );

  return (
    <div className="rc">
      <div className="rc-head">
        <div>
          <h1 className="rc-title">Reports Center</h1>
        </div>
        <div className="rc-search">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6" />
            <line x1="15" y1="15" x2="20" y2="20" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports"
            aria-label="Search reports"
          />
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {catalogue.length === 0 ? (
        <EmptyState
          title="No reports available"
          message="Your role does not have access to any of the operational reports."
        />
      ) : (
        <div className="rc-body">
          <nav className="rc-rail" aria-label="Report categories">
            {railItem('ALL', 'All reports', catalogue.length)}
            {railItem('FAVOURITES', 'Favourites', favourites.filter((k) => catalogue.some((r) => r.key === k)).length)}
            <div className="rc-rail-label">Categories</div>
            {categories.map((c) =>
              railItem(c.value, c.label, catalogue.filter((r) => r.category === c.value).length),
            )}
          </nav>

          <div className="rc-main">
            {groups.length === 0 && (
              <div className="rc-empty">
                {category === 'FAVOURITES' && !q
                  ? 'No favourites yet. Star a report to keep it here.'
                  : `No report matches “${query}”.`}
              </div>
            )}
            {groups.map((g) => (
              <section key={g.value} className="rc-group">
                <h2 className="rc-group-title">{g.label}</h2>
                <ul className="rc-list">
                  {g.reports.map((r) => {
                    const fav = favourites.includes(r.key);
                    return (
                      <li key={r.key} className="rc-row">
                        <button
                          type="button"
                          className={`rc-star${fav ? ' is-on' : ''}`}
                          onClick={() => toggleFavourite(r.key)}
                          aria-pressed={fav}
                          aria-label={fav ? `Remove ${r.title} from favourites` : `Add ${r.title} to favourites`}
                          title={fav ? 'Remove from favourites' : 'Add to favourites'}
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                            <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
                          </svg>
                        </button>
                        <button type="button" className="rc-open" onClick={() => onOpen(r.key)}>
                          <span className="rc-name">{r.title}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
//  ONE REPORT - toolbar, customise panel, and the report as a page
// ===========================================================================

function ReportView({ descriptor, onBack, options }) {
  const hasDates = descriptor.filters.includes('dateFrom') || descriptor.filters.includes('dateTo');
  const otherFilters = descriptor.filters.filter((f) => f !== 'dateFrom' && f !== 'dateTo');

  const [preset, setPreset] = useState('all');
  const [filters, setFilters] = useState({});
  const [customising, setCustomising] = useState(false);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // The CSV is fetched with the token rather than linked to; see erp.downloadCsv.
  const [downloading, setDownloading] = useState(false);

  /**
   * Which page of the report is on screen.
   *
   * The report itself is assembled whole on the server - the row count and the
   * CSV are of every matching row, not of this page - and only the rows for
   * this page are sent. See `run()` in report.service.js.
   */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  function choosePreset(value) {
    setPreset(value);
    if (value === 'custom') return;
    const range = presetRange(value);
    setFilters((f) => ({ ...f, dateFrom: range?.[0] ?? '', dateTo: range?.[1] ?? '' }));
  }

  const cleanFilters = useMemo(
    () =>
      Object.fromEntries(
        descriptor.filters
          .map((f) => [f, filters[f]])
          .filter(([, v]) => v !== undefined && v !== null && v !== ''),
      ),
    [descriptor, filters],
  );

  const runReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await reportsApi.run(descriptor.key, { ...cleanFilters, page, pageSize }));
    } catch (e) {
      setError(e.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [descriptor.key, cleanFilters, page, pageSize]);

  // Re-run when the filters change, after a short pause for typing.
  useEffect(() => {
    const id = setTimeout(runReport, 250);
    return () => clearTimeout(id);
  }, [runReport]);

  // Narrowing the dates while on page 7 of the old result would otherwise ask
  // for a page that no longer exists. The server clamps too, but landing the
  // user back at the top is what they meant.
  const filterKey = JSON.stringify(cleanFilters);
  useEffect(() => {
    setPage(1);
  }, [filterKey, pageSize]);

  const activeOther = otherFilters.filter((f) => cleanFilters[f] !== undefined).length;
  const period =
    cleanFilters.dateFrom || cleanFilters.dateTo
      ? `From ${cleanFilters.dateFrom ? fmtDate(cleanFilters.dateFrom) : 'the start'} to ${cleanFilters.dateTo ? fmtDate(cleanFilters.dateTo) : 'today'}`
      : 'All dates';

  return (
    <div className="rv">
      <div className="rv-crumbs">
        <button type="button" className="link-button" onClick={onBack}>
          Reports Center
        </button>
        <span aria-hidden="true">›</span>
        <span>{categoryLabel(descriptor.category)}</span>
      </div>

      <div className="rv-toolbar">
        <h1 className="rv-title">{descriptor.title}</h1>
        <div className="rv-actions">
          {hasDates && (
            <label className="rv-period">
              <span className="sr-only">Report period</span>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="15" rx="1.8" />
                <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
                <line x1="8" y1="3" x2="8" y2="6.5" />
                <line x1="16" y1="3" x2="16" y2="6.5" />
              </svg>
              <select value={preset} onChange={(e) => choosePreset(e.target.value)}>
                {PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
          )}
          {otherFilters.length > 0 && (
            <button
              type="button"
              className={`btn${customising ? ' btn-primary' : ''}`}
              onClick={() => setCustomising((v) => !v)}
              aria-expanded={customising}
            >
              Customize report{activeOther > 0 ? ` (${activeOther})` : ''}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDownloading(true);
              reportsApi
                .downloadCsv(descriptor.key, cleanFilters)
                .catch((e) => setError(e.message))
                .finally(() => setDownloading(false));
            }}
            disabled={downloading}
          >
            {downloading ? 'Preparing…' : 'Export CSV'}
          </button>
          <button type="button" className="btn" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>

      {(customising || (hasDates && preset === 'custom')) && (
        <div className="rv-customise">
          {/* `.filter-row`, not `.toolbar`: see styles.css. These filters are
              never hidden on a phone either, because a report's filters ARE the
              report and there is no search box here to fall back to. */}
          <div className="filter-row">
            {hasDates && preset === 'custom' &&
              ['dateFrom', 'dateTo']
                .filter((f) => descriptor.filters.includes(f))
                .map((f) => (
                  <ReportFilter
                    key={f}
                    name={f}
                    value={filters[f] ?? ''}
                    onChange={(v) => setFilters((prev) => ({ ...prev, [f]: v }))}
                    {...options}
                  />
                ))}
            {customising &&
              otherFilters.map((f) => (
                <ReportFilter
                  key={f}
                  name={f}
                  value={filters[f] ?? ''}
                  onChange={(v) => setFilters((prev) => ({ ...prev, [f]: v }))}
                  {...options}
                />
              ))}
          </div>
          {customising && activeOther > 0 && (
            <button
              type="button"
              className="link-button"
              onClick={() =>
                setFilters((f) => Object.fromEntries(Object.entries(f).filter(([k]) => k === 'dateFrom' || k === 'dateTo')))
              }
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {error && <Alert kind="error">{error}</Alert>}

      <article className="rv-sheet">
        <header className="rv-sheet-head">
          <div className="rv-company">Sekawati Impex</div>
          <div className="rv-sheet-title">{descriptor.title}</div>
          <div className="rv-sheet-period">{period}</div>
        </header>

        {loading && !report && (
          <div className="loading-row">
            <Spinner label={`Running ${descriptor.title}...`} />
          </div>
        )}

        {report && (
          <div className={loading ? 'rv-stale' : undefined}>
            {report.note && <Alert kind="info">{report.note}</Alert>}
            {report.truncated && (
              <Alert kind="warning">
                This report hit its {report.rowCount}-row ceiling, so what follows is
                what was read rather than everything. Narrow the dates or the filters.
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

            <p className="rv-foot">
              {/* rowCount is the whole report, which is what the CSV export
                  describes too - not the page. */}
              {report.rowCount} row(s) · the CSV covers all of them · generated{' '}
              {fmtDateTime(report.generatedAt)}
            </p>
          </div>
        )}
      </article>
    </div>
  );
}

/**
 * The right control for a filter the report declared.
 *
 * Exported for the Inventory Analysis screen, which runs reports from this
 * same registry and must offer their filters the same way.
 */
export function ReportFilter({
  name,
  value,
  onChange,
  buyerOptions,
  vendorOptions,
  orderOptions,
  itemOptions = [],
}) {
  const label = FILTER_LABEL[name] ?? fmtEnum(name);
  const id = `rf-${name}`;

  if (name === 'itemId') {
    return (
      <Field label={label} htmlFor={id}>
        <RecordSelect
          id={id}
          options={itemOptions}
          getLabel={(o) => `${o.description} (${o.itemCode})`}
          placeholder="All items"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    );
  }

  if (name === 'dateFrom' || name === 'dateTo') {
    return (
      <Field label={label} htmlFor={id}>
        <TextInput id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }

  if (name === 'buyerId' || name === 'vendorId' || name === 'orderId') {
    const options =
      name === 'buyerId' ? buyerOptions : name === 'vendorId' ? vendorOptions : orderOptions;
    const getLabel =
      name === 'buyerId'
        ? (o) => o.buyerName
        : name === 'vendorId'
          ? (o) => o.vendorName
          : (o) => o.orderNo;
    return (
      <Field label={label} htmlFor={id}>
        <RecordSelect
          id={id}
          options={options}
          getLabel={getLabel}
          placeholder={`All ${label.toLowerCase()}s`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    );
  }

  if (MASTER_LIST[name]) {
    return (
      <Field label={label} htmlFor={id}>
        <MasterSelect
          id={id}
          listCode={MASTER_LIST[name]}
          placeholder="All"
          value={value}
          currentValue={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    );
  }

  if (ENUM_OPTIONS[name]) {
    return (
      <Field label={label} htmlFor={id}>
        <EnumSelect
          id={id}
          options={ENUM_OPTIONS[name].map((v) => ({ value: v, label: fmtEnum(v) }))}
          placeholder="All"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    );
  }

  return (
    <Field label={label} htmlFor={id}>
      <TextInput id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
