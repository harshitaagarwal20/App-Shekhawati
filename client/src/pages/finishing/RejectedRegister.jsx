/**
 * The Rejected Register - pieces out of the order for good.
 *
 * Read-only. Every row was written by the stage that rejected the pieces -
 * the Alteration Unit, for what it found not repairable, keeping the reason
 * the piece first left the line (Defected, Spoiled, Ironing damage ...). A
 * wrong row is corrected on the entry that made it.
 *
 * Packed is the order and style's packed qty, so each reject reads against
 * what went into the boxes.
 */

import { Link } from 'react-router-dom';
import { useResourceList } from '../../hooks/useResourceList.js';
import { rejectedRegister as api } from '../../services/erp.js';
import { Alert, EmptyState, Field, PageHeader, Pagination, SortableTh, Spinner, TextInput, ViewTabs, ClearFilters } from '../../components/ui.jsx';
import { fmtDate, fmtEnum, fmtNum } from '../../utils/format.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { QC_TABS } from './ExternalQcPages.jsx';
import DateRangeFilter from '../../components/DateRangeFilter.jsx';

const n0 = (v) => fmtNum(v, { decimals: 0 });
const ORIGIN = { EXTERNAL_QC: 'External QC', IRONING: 'Ironing (internal)' };

export default function RejectedRegister() {
  const list = useResourceList((params) => api.list(params), {
    defaultSort: 'rejectDate',
    defaultDir: 'desc',
    initialFilters: { stage: '', reason: '', dateFrom: '', dateTo: '' },
  });
  const totals = list.meta?.totals;

  return (
    <>
      <PageHeader title="Rejected Register" actions={<ExportButton dataset="rejected-register" params={list.query} rowCount={list.meta.total} />} />
      <ViewTabs active="rejected" tabs={QC_TABS} />
      <div className="filter-row">
        <Field label="Stage">
          <select value={list.filters.stage} onChange={(e) => list.setFilter('stage', e.target.value)}>
            <option value="">Every stage</option>
            <option value="ALTERATION_UNIT">Alteration Unit</option>
          </select>
        </Field>
        <Field label="Reason">
          <select value={list.filters.reason} onChange={(e) => list.setFilter('reason', e.target.value)}>
            <option value="">Every reason</option>
            {['Alter', 'Defected', 'Spoiled', 'Other', 'Ironing damage'].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <DateRangeFilter filters={list.filters} setFilter={list.setFilter} fromLabel="From" toLabel="To" />
        <div className="grow">
          <Field label="Search">
            <TextInput value={list.search} onChange={(e) => list.setSearch(e.target.value)} placeholder="Order, style, reason, unit" />
          </Field>
        </div>
        <ClearFilters list={list} />
      </div>

      {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
      {list.loading ? (
        <Spinner label="Loading the register" />
      ) : list.rows.length === 0 ? (
        <EmptyState title="Nothing rejected" message="Pieces the Alteration Unit cannot repair are entered here." />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="rejectDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="stage" label="Stage" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Order</th>
                <th>Style</th>
                <SortableTh field="qty" label="Pcs" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="reason" label="Reason" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Came from</th>
                <th>Why not repairable</th>
                <th>Staff</th>
                <th className="num" title="Packed pcs of this order and style">Packed</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">
                    {r.alterationEntry ? <Link to={`/alteration/entries/${r.alterationEntry.id}`}>{fmtDate(r.rejectDate)}</Link>
                      : fmtDate(r.rejectDate)}
                  </td>
                  <td>{fmtEnum(r.stage)}</td>
                  <td>{r.order?.orderNo}</td>
                  <td className="code">{r.style?.styleNo}</td>
                  <td className="num"><strong>{n0(r.qty)}</strong></td>
                  <td>{r.reason}{r.defectType ? <span className="faint"> - {r.defectType}</span> : null}</td>
                  <td>
                    {ORIGIN[r.origin] ?? r.origin}
                    {r.alterationReceipt?.externalQcEntry?.agency && <div className="faint">{r.alterationReceipt.externalQcEntry.agency.vendorName}</div>}
                    {r.unit && <div className="faint">{r.unit}</div>}
                  </td>
                  <td>{r.notRepairableReason}</td>
                  <td>{r.alterationEntry?.staff?.empName}</td>
                  <td className="num">{n0(r.orderStylePacked)}</td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  <td colSpan={4}><strong>All matching rejects</strong></td>
                  <td className="num"><strong>{n0(totals.qty)}</strong></td>
                  <td colSpan={4} />
                  <td className="num">{totals.packed != null && <strong>{n0(totals.packed)}</strong>}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </TableWrap>
      )}
      <Pagination meta={list.meta} page={list.page} pageSize={list.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />
    </>
  );
}
