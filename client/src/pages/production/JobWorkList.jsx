/**
 * Job Work — Dyeing and Printing.
 *
 * ---------------------------------------------------------------------------
 *  ONE REGISTER, FOUR PROCESSES — AND THE UI SAYS WHICH
 *
 *  The four share a table and a service. What they do NOT share is their
 *  vocabulary: a dyeing job loses "shrinkage", a printing job loses "process
 *  loss", and a slip that says the wrong one is a slip somebody acts on wrongly.
 *
 *  So the process filter is a row of tabs rather than a dropdown buried in the
 *  toolbar, every row is colour-coded by process, and the labels come from
 *  GET /job-works/processes rather than being written here.
 *
 *  The active tab lives in the URL (`?process=DYEING`), which is what lets the
 *  sidebar offer Dyeing and Printing as separate destinations without either
 *  becoming a separate screen. It also means a link somebody pastes into a
 *  message opens on the process they were looking at.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { useOptionalColumns } from '../../hooks/useOptionalColumns.js';
import { jobWorks as jwApi, vendors as vendorsApi } from '../../services/erp.js';
import {
  ColumnMenu,
  Alert,
  EmptyState,
  EnumSelect,
  Field,
  Modal,
  PageHeader,
  Pagination,
  RecordSelect,
  SortableTh,
  Spinner,
  StatusBadge,
  TextInput,
} from '../../components/ui.jsx';
import { fmtDate, fmtEnum, fmtMoney, fmtNum } from '../../utils/format.js';
import JobWorkForm from './JobWorkForm.jsx';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

/**
 * What this register can show, and what it shows unasked.
 *
 * A job is read as: which job, when, what process, which vendor has it, how
 * much went out, how much came back, and is it finished. Loss, rate and amount
 * are the reconciliation - checked on the job itself - and a job over its
 * shrinkage allowance still paints its whole row whether or not the Loss
 * column is showing.
 */
const COLUMNS = [
  { key: 'jobNo', label: 'Job No' },
  { key: 'date', label: 'Date' },
  { key: 'process', label: 'Process' },
  { key: 'roll', label: 'Roll', optional: true },
  { key: 'colour', label: 'Colour', optional: true },
  { key: 'vendor', label: 'Vendor' },
  { key: 'sent', label: 'Sent' },
  { key: 'returned', label: 'Returned' },
  { key: 'loss', label: 'Loss', optional: true },
  { key: 'rate', label: 'Rate', optional: true },
  { key: 'amount', label: 'Amount', optional: true },
  { key: 'order', label: 'Order', optional: true },
  { key: 'status', label: 'Status' },
];

export default function JobWorkList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL is the authority for which process is showing. `?process=` absent
  // means all of them, which is what the plain /job-works link gives.
  const urlProcess = searchParams.get('process') ?? '';

  const cols = useOptionalColumns('job-work', COLUMNS);

  const list = useResourceList((params) => jwApi.list(params), {
    defaultSort: 'issueDate',
    defaultDir: 'desc',
    initialFilters: {
      process: urlProcess,
      status: '',
      vendorId: '',
      pendingReturn: '',
    },
    // This screen owns `?process=` - the tabs below write it, and the effect
    // further down turns it back into a filter. The list hook reads it on the
    // way in but must not write it, or it would undo a tab click.
    urlIgnore: ['process'],
  });

  const [processes, setProcesses] = useState([]);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    jwApi.processes().then(setProcesses).catch(loadFailed(setProcesses, 'processes'));
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
  }, []);

  const active = list.filters.process ?? '';

  // Keep the filter following the URL, so that moving between the sidebar's
  // Dyeing and Printing entries re-filters an already-mounted screen.
  useEffect(() => {
    if (urlProcess !== active) list.setFilter('process', urlProcess);
    // `list` is rebuilt on every render; only the URL should drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlProcess]);

  /**
   * The heading follows the process, because a screen headed "Job Work" when
   * somebody clicked "Printing" leaves them wondering whether the link worked.
   */
  const activeProcess = processes.find((p) => p.process === active);
  const heading = activeProcess ? activeProcess.documentName : 'Job Work';
  /** Tabs write to the URL; the effect above turns that into a filter. */
  const selectProcess = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('process', value);
    else next.delete('process');
    setSearchParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={heading}
        actions={
          <>
            <ExportButton
              dataset="job-works"
              params={list.query}
              rowCount={list.meta.total}
            />
            {can('DYE_ISSUE.CREATE') && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                New job work
              </button>
            )}
          </>
        }
      />

      {banner && (
        <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Alert>
      )}
      {list.error && <Alert kind="error">{list.error.message}</Alert>}

      {/* The process is the first thing on the screen, not a hidden filter. */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={`btn ${active === '' ? 'btn-primary' : ''}`}
          onClick={() => selectProcess('')}
        >
          All processes
        </button>
        {processes.map((p) => (
          <button
            key={p.process}
            type="button"
            className={`btn ${active === p.process ? 'btn-primary' : ''}`}
            onClick={() => selectProcess(p.process)}
            title={`${p.documentName} · ${p.vendorLabel} · ${p.lossLabel}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor="jw-search">
              <TextInput
                id="jw-search"
                type="search"
                placeholder="Search job no, colour, content, construction..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Vendor" htmlFor="jw-f-vendor">
            <RecordSelect
              id="jw-f-vendor"
              options={vendorOptions}
              getLabel={(v) => v.vendorName}
              placeholder="All vendors"
              value={list.filters.vendorId ?? ''}
              onChange={(e) => list.setFilter('vendorId', e.target.value)}
            />
          </Field>

          <div className="field">
            <label htmlFor="jw-f-pending">Show</label>
            <EnumSelect
              id="jw-f-pending"
              options={[{ value: 'true', label: 'Still at the vendor' }]}
              placeholder="All jobs"
              value={list.filters.pendingReturn ?? ''}
              onChange={(e) => list.setFilter('pendingReturn', e.target.value)}
            />
          </div>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="dyeIssueNo" label="Job No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="issueDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="process" label="Process" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                {cols.show('roll') && <th>Roll</th>}
                {cols.show('colour') && <th>Colour</th>}
                <th>Vendor</th>
                <SortableTh field="qty" label="Sent" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <SortableTh field="receivedQty" label="Returned" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                {cols.show('loss') && <SortableTh field="shrinkagePct" label="Loss" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />}
                {cols.show('rate') && <SortableTh field="rate" label="Rate" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />}
                {cols.show('amount') && <SortableTh field="amount" label="Amount" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />}
                {cols.show('order') && <th>Order</th>}
                <SortableTh field="status" label="Status" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <ColumnMenu {...cols} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={cols.colSpan} className="loading-row">
                    <Spinner label="Loading job work..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={cols.colSpan}>
                    <EmptyState title="No job work found" />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((j) => (
                  <tr
                    key={j.id}
                    onClick={() => navigate(`/job-works/${j.id}`)}
                    className={`clickable ${j.shrinkageBreached ? 'row-warn' : ''}`}
                  >
                    <td className="code">{j.dyeIssueNo}</td>
                    <td className="nowrap">{fmtDate(j.issueDate)}</td>
                    <td>
                      <strong>{j.meta.label}</strong>
                      <div className="faint">{fmtEnum(j.fabricStage)}</div>
                    </td>
                    {cols.show('roll') && <td className="code">{j.roll?.rollNo ?? '-'}</td>}
                    {cols.show('colour') && <td>{j.colourCode ?? '-'}</td>}
                    <td>{j.vendor?.vendorName ?? '-'}</td>
                    <td className="num">{fmtNum(j.qty)}</td>
                    <td className="num">
                      {fmtNum(j.receivedQty)}
                      {Number(j.pendingQty) > 0 && (
                        <div className="faint">{fmtNum(j.pendingQty)} out</div>
                      )}
                    </td>
                    {cols.show('loss') && (
                      <td className="num">
                        {j.shrinkagePctDisplay}%
                        <div className="faint">
                          {j.meta.lossLabel.toLowerCase()} · {j.standardShrinkagePctDisplay}% allowed
                        </div>
                      </td>
                    )}
                    {cols.show('rate') && <td className="num">{fmtNum(j.rate, { decimals: 4 })}</td>}
                    {cols.show('amount') && <td className="num">{fmtMoney(j.amount)}</td>}
                    {cols.show('order') && <td className="code">{j.order?.orderNo ?? '-'}</td>}
                    <td>
                      <StatusBadge status={j.status} />
                    </td>
                    <td />
                  </tr>
                ))}
            </tbody>
          </table>
        </TableWrap>

        <Pagination
          meta={list.meta}
          page={list.page}
          pageSize={list.pageSize}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      </div>

      {creating && (
        <Modal title="New job work issue" size="wide" onClose={() => setCreating(false)}>
          <JobWorkForm
            processes={processes}
            onCancel={() => setCreating(false)}
            onSaved={(saved) => {
              setCreating(false);
              setBanner({
                kind: 'success',
                text: `${saved.dyeIssueNo} raised — ${saved.meta.label.toLowerCase()} at ${saved.vendor?.vendorName}.`,
              });
              navigate(`/job-works/${saved.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}
