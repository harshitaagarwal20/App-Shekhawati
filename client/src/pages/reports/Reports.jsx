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
 * RBAC comes from the catalogue, which the server has already filtered by
 * permission — so a user is never offered a report the API would refuse. The
 * API checks the same permission again on every run.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import {
  buyers as buyersApi,
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
  PageHeader,
  RecordSelect,
  Spinner,
  StatusBadge,
  TextInput,
} from '../../components/ui.jsx';
import { StateBadge } from '../../components/workflow.jsx';
import { fmtDate, fmtEnum, fmtMoney, fmtNum } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import TableWrap from '../../components/TableWrap.jsx';

/** Which control to render for each filter a report declares. */
const FILTER_LABEL = {
  buyerId: 'Buyer',
  vendorId: 'Vendor',
  orderId: 'Order',
  location: 'Location',
  firmName: 'Unit',
  itemCategory: 'Item category',
  colorCode: 'Colour',
  purpose: 'Purpose',
  stage: 'Roll stage',
  status: 'Status',
  approvalStatus: 'Approval',
  decision: 'Decision',
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
};

/** Which List Master a filter reads from, where it is a business dropdown. */
const MASTER_LIST = {
  location: 'StockLocation',
  itemCategory: 'ItemCategory',
  colorCode: 'ColorCode',
  firmName: 'StitchingUnit',
};

export default function Reports() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [catalogue, setCatalogue] = useState(null);
  const [selected, setSelected] = useState(params.get('report') ?? '');
  const [selectedCategory, setSelectedCategory] = useState(params.get('category') ?? 'ALL');
  const [filters, setFilters] = useState({});
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

  const [buyerOptions, setBuyerOptions] = useState([]);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [orderOptions, setOrderOptions] = useState([]);

  useEffect(() => {
    const categoryParam = selectedCategory === 'ALL' ? '' : selectedCategory;
    reportsApi
      .catalogue(categoryParam)
      .then((c) => setCatalogue(c.reports))
      .catch((e) => setError(e.message));

    buyersApi.options().then(setBuyerOptions).catch(loadFailed(setBuyerOptions, 'buyers'));
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, [selectedCategory]);

  const descriptor = useMemo(
    () => catalogue?.find((r) => r.key === selected) ?? null,
    [catalogue, selected],
  );

  const cleanFilters = useMemo(() => {
    if (!descriptor) return {};
    return Object.fromEntries(
      descriptor.filters
        .map((f) => [f, filters[f]])
        .filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
  }, [descriptor, filters]);

  const runReport = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setError('');
    try {
      setReport(await reportsApi.run(selected, { ...cleanFilters, page, pageSize }));
    } catch (e) {
      setError(e.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [selected, cleanFilters, page, pageSize]);

  // Re-run when the report or its filters change.
  useEffect(() => {
    if (!selected) {
      setReport(null);
      return undefined;
    }
    const id = setTimeout(runReport, 250);
    return () => clearTimeout(id);
  }, [runReport, selected]);

  // Narrowing the dates while on page 7 of the old result would otherwise ask
  // for a page that no longer exists. The server clamps too, but landing the
  // user back at the top is what they meant.
  const filterKey = JSON.stringify(cleanFilters);
  useEffect(() => {
    setPage(1);
  }, [filterKey, selected, pageSize]);

  function choose(key) {
    setSelected(key);
    setFilters({});
    setPage(1);
    const newParams = key ? { report: key } : {};
    if (selectedCategory !== 'ALL') {
      newParams.category = selectedCategory;
    }
    setParams(newParams);
  }

  function chooseCategory(category) {
    setSelectedCategory(category);
    setSelected('');
    setFilters({});
    setPage(1);
    if (category !== 'ALL') {
      setParams({ category });
    } else {
      setParams({});
    }
  }

  if (!catalogue && !error) {
    return (
      <div className="loading-row">
        <Spinner label="Loading reports..." />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          descriptor && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDownloading(true);
                reportsApi
                  .downloadCsv(selected, cleanFilters)
                  .catch((e) => setError(e.message))
                  .finally(() => setDownloading(false));
              }}
              disabled={downloading}
            >
              {downloading ? 'Preparing...' : 'Download CSV'}
            </button>
          )
        }
      />

      {error && <Alert kind="error">{error}</Alert>}

      {catalogue?.length === 0 && (
        <EmptyState
          title="No reports available"
          message="Your role does not have access to any of the operational reports."
        />
      )}

      {/* --- Category filter ------------------------------------------------ */}
      {catalogue?.length > 0 && (
        <div className="report-picker">
          <Field label="Report Category" htmlFor="category-select">
            <EnumSelect
              id="category-select"
              options={[
                { value: 'ALL', label: 'All Reports' },
                { value: 'INVENTORY', label: 'Inventory Management' },
                { value: 'STAFF_EFFICIENCY', label: 'Staff Efficiency' },
                { value: 'PLANNING', label: 'Planning' },
                { value: 'PROCUREMENT', label: 'Procurement' },
              ].filter((opt) => opt.value === 'ALL' || catalogue.some((r) => r.category === opt.value))}
              value={selectedCategory}
              onChange={(e) => chooseCategory(e.target.value)}
            />
          </Field>
        </div>
      )}

      {/* --- The catalogue -------------------------------------------------
          One control, not fourteen cards.

          The card grid showed every report's description at once and pushed
          the report itself below the fold on anything smaller than a desktop.
          A description belongs to the report you actually chose, so it is
          rendered under the picker rather than fourteen times above it. The
          catalogue is still the server's - filtered by permission - and
          choosing from it still goes through `choose()`, so the URL, the
          filters and the page reset exactly as they did before. */}
      {catalogue?.length > 0 && (
        <div className="report-picker">
          <Field label="Report" htmlFor="report-picker-select">
            <EnumSelect
              id="report-picker-select"
              options={catalogue.map((r) => ({ value: r.key, label: r.title }))}
              placeholder={`Choose a report (${catalogue.length} available to you)`}
              value={selected}
              onChange={(e) => choose(e.target.value)}
            />
          </Field>
        </div>
      )}

      {/* --- Filters, from the report's own descriptor --------------------- */}
      {descriptor && (
        <>
          {/* `.filter-row`, not `.toolbar`: see styles.css. These filters are
              never hidden on a phone either, because a report's filters ARE the
              report and there is no search box here to fall back to. */}
          <div className="filter-row">
            {descriptor.filters.map((f) => (
              <ReportFilter
                key={f}
                name={f}
                value={filters[f] ?? ''}
                onChange={(v) => setFilters((prev) => ({ ...prev, [f]: v }))}
                buyerOptions={buyerOptions}
                vendorOptions={vendorOptions}
                orderOptions={orderOptions}
              />
            ))}
          </div>

          {loading && (
            <div className="loading-row">
              <Spinner label={`Running ${descriptor.title}...`} />
            </div>
          )}

          {report && !loading && (
            <>
              {report.note && <Alert kind="info">{report.note}</Alert>}
              {report.truncated && (
                <Alert kind="warning">
                  This report hit its {report.rowCount}-row ceiling, so what follows is
                  what was read rather than everything. Narrow the dates or the filters.
                </Alert>
              )}

              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      {report.columns.map((col) => (
                        <th key={col.key} className={isNumeric(col.format) ? 'num' : ''}>
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.length === 0 && (
                      <tr>
                        <td colSpan={report.columns.length}>
                          <EmptyState
                            title="Nothing to report"
                          />
                        </td>
                      </tr>
                    )}
                    {report.rows.map((row) => (
                      <tr className="clickable"
                        key={row.id}
                        onClick={row.route ? () => navigate(row.route) : undefined}
                        style={row.route ? { cursor: 'pointer' } : undefined}
                      >
                        {report.columns.map((col) => (
                          <td key={col.key} className={isNumeric(col.format) ? 'num' : ''}>
                            <Cell value={row[col.key]} format={col.format} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

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
                {/* rowCount is the whole report, which is what the CSV export
                    describes too - not the page. */}
                {report.rowCount} row(s) matched · the CSV covers all of them ·
                generated {fmtDate(report.generatedAt)}
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}

const isNumeric = (format) => format === 'qty' || format === 'money';

/**
 * One cell, rendered by the format the server declared.
 *
 * Every value arrives already computed and already rounded. This chooses the
 * typography, and nothing else.
 */
function Cell({ value, format }) {
  if (value === null || value === undefined || value === '') {
    return <span className="faint">—</span>;
  }
  switch (format) {
    case 'qty':
      return fmtNum(value);
    case 'money':
      return fmtMoney(value);
    case 'date':
      return <span className="nowrap">{fmtDate(value)}</span>;
    case 'state':
      return <StateBadge state={value} />;
    default:
      // Status-shaped values get the badge; everything else is text.
      return /^[A-Z_]{3,}$/.test(String(value)) ? (
        <StatusBadge status={value} />
      ) : (
        String(value)
      );
  }
}


/** The right control for a filter the report declared. */
function ReportFilter({ name, value, onChange, buyerOptions, vendorOptions, orderOptions }) {
  const label = FILTER_LABEL[name] ?? fmtEnum(name);
  const id = `rf-${name}`;

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
