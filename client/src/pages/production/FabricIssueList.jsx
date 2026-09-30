/**
 * Fabric Issue list and detail. Sheet: "Fabric Issue".
 *
 * Two exports in one file because the detail is small - an issue is a posted
 * fact with one ledger entry behind it, not a document with a lifecycle.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { useOptionalColumns } from '../../hooks/useOptionalColumns.js';
import {
  fabricIssues as fiApi,
  orders as ordersApi,
  vendors as vendorsApi,
} from '../../services/erp.js';
import {
  ColumnMenu,
  Alert,
  EmptyState,
  EnumSelect,
  Field,
  PageHeader,
  Pagination,
  RecordSelect,
  SortableTh,
  Spinner,
  StatusBadge,
  TextInput,
} from '../../components/ui.jsx';
import { Detail, DetailGrid, TraceChain } from '../shared/Detail.jsx';
import { fmtDate, fmtEnum, fmtNum } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const PURPOSES = ['CUTTING', 'DYEING', 'PRINTING', 'STITCHING', 'RETURN', 'SAMPLING', 'OTHER'].map(
  (v) => ({ value: v, label: fmtEnum(v) }),
);

/**
 * What this register can show, and what it shows unasked.
 *
 * The question this screen answers is which issue, from which roll, of what
 * cloth, how much, and where it has got to. Who signed it out, what it was
 * for, where it went and which order it belongs to are what you check on ONE
 * issue - so they are in the column menu rather than in every row.
 */
const COLUMNS = [
  { key: 'issueNo', label: 'Issue No' },
  { key: 'date', label: 'Date' },
  { key: 'roll', label: 'Roll' },
  { key: 'fabric', label: 'Fabric' },
  { key: 'colour', label: 'Colour', optional: true },
  { key: 'purpose', label: 'Purpose', optional: true },
  { key: 'qtyIssued', label: 'Qty Issued' },
  { key: 'order', label: 'Order', optional: true },
  { key: 'style', label: 'Style', optional: true },
  { key: 'issuedBy', label: 'Issued by', optional: true },
  { key: 'destination', label: 'Destination', optional: true },
  { key: 'status', label: 'Status' },
];

export function FabricIssueList() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const cols = useOptionalColumns('fabric-issues', COLUMNS);

  const list = useResourceList((params) => fiApi.list(params), {
    defaultSort: 'issueDate',
    defaultDir: 'desc',
    initialFilters: { purpose: '', orderId: '', vendorId: '' },
  });

  const [orderOptions, setOrderOptions] = useState([]);
  const [vendorOptions, setVendorOptions] = useState([]);
  const totals = list.meta?.totals;

  useEffect(() => {
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
  }, []);

  return (
    <>
      <PageHeader
        title="Fabric Issues"
        actions={
          <>
            <ExportButton
              dataset="fabric-issues"
              params={list.query}
              rowCount={list.meta.total}
            />
            {can('FABRIC_ISSUE.CREATE') && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate('/fabric-issues/new')}
              >
                Issue fabric
              </button>
            )}
          </>
        }
      />

      {list.error && <Alert kind="error">{list.error.message}</Alert>}

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor="fi-search">
              <TextInput
                id="fi-search"
                type="search"
                placeholder="Search issue no, fabric, colour, issuer..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Purpose" htmlFor="fi-f-purpose">
            <EnumSelect
              id="fi-f-purpose"
              options={PURPOSES}
              placeholder="All"
              value={list.filters.purpose ?? ''}
              onChange={(e) => list.setFilter('purpose', e.target.value)}
            />
          </Field>

          <Field label="Order" htmlFor="fi-f-order">
            <RecordSelect
              id="fi-f-order"
              options={orderOptions}
              getLabel={(o) => o.orderNo}
              placeholder="All orders"
              value={list.filters.orderId ?? ''}
              onChange={(e) => list.setFilter('orderId', e.target.value)}
            />
          </Field>

          <Field label="Job worker" htmlFor="fi-f-vendor">
            <RecordSelect
              id="fi-f-vendor"
              options={vendorOptions}
              getLabel={(v) => v.vendorName}
              placeholder="All"
              value={list.filters.vendorId ?? ''}
              onChange={(e) => list.setFilter('vendorId', e.target.value)}
            />
          </Field>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="issueNo" label="Issue No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="issueDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Roll</th>
                <th>Fabric</th>
                {cols.show('colour') && <th>Colour</th>}
                {cols.show('purpose') && <SortableTh field="purpose" label="Purpose" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />}
                <SortableTh field="fabricQtyIssued" label="Qty Issued" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                {cols.show('order') && <th>Order</th>}
                {cols.show('style') && <th>Style</th>}
                {cols.show('issuedBy') && <th>Issued by</th>}
                {cols.show('destination') && <th>Destination</th>}
                <SortableTh field="status" label="Status" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <ColumnMenu {...cols} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={cols.colSpan} className="loading-row">
                    <Spinner label="Loading issues..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={cols.colSpan}>
                    <EmptyState title="No fabric issues found" />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((f) => (
                  <tr className="clickable"
                    key={f.id}
                    onClick={() => navigate(`/fabric-issues/${f.id}`)}
                  >
                    <td className="code">{f.issueNo}</td>
                    <td className="nowrap">{fmtDate(f.issueDate)}</td>
                    <td className="code">{f.roll?.rollNo ?? '-'}</td>
                    <td>{f.fabricName ?? f.roll?.fabricName ?? '-'}</td>
                    {cols.show('colour') && <td>{f.colorCode ?? '-'}</td>}
                    {cols.show('purpose') && <td>{fmtEnum(f.purpose)}</td>}
                    <td className="num">
                      <strong>{fmtNum(f.fabricQtyIssued)}</strong>
                      <div className="faint">{f.uom}</div>
                    </td>
                    {cols.show('order') && <td className="code">{f.order?.orderNo ?? '-'}</td>}
                    {cols.show('style') && <td className="code">{f.style?.styleNo ?? '-'}</td>}
                    {cols.show('issuedBy') && <td>{f.issuedByName}</td>}
                    {cols.show('destination') && <td>{f.destination}</td>}
                    <td>
                      <StatusBadge status={f.status} />
                    </td>
                    <td />
                  </tr>
                ))}
            </tbody>

            {totals && !list.loading && list.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={6} className="faint">
                    Total issued in the filtered set
                  </td>
                  <td className="num">
                    <strong>{fmtNum(totals.fabricQtyIssued)}</strong>
                  </td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            )}
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
    </>
  );
}

export function FabricIssueDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [issue, setIssue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setIssue(await fiApi.get(id));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !issue) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading issue..." />
        </div>
      </div>
    );
  }
  if (!issue) return <Alert kind="error">{error || 'Fabric issue not found'}</Alert>;

  const { movements, jobWorks, cuttingIssues } = issue;

  return (
    <>
      <PageHeader
        title={`Fabric Issue ${issue.issueNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/fabric-issues')}>
              Back to list
            </button>
            {can('FABRIC_ISSUE.EXPORT') && (
              <button type="button" className="btn" onClick={() => navigate(`/print/fabric-issue/${issue.id}`)}>
                {issue.purpose === 'DYEING' || issue.purpose === 'PRINTING' ? 'Print challan' : 'Print'}
              </button>
            )}
          </>
        }
      />

      <TraceChain
        title="What this issue touched"
        chain={[issue.order?.orderNo, issue.roll?.rollNo, issue.issueNo].filter(Boolean).join(' → ')}
        complete
        links={[
          issue.order && {
            label: 'Buyer Order',
            value: issue.order.orderNo,
            sub: issue.order.buyer?.buyerName,
            to: `/orders/${issue.order.id}`,
          },
          issue.roll && {
            label: 'Roll',
            value: issue.roll.rollNo,
            sub: `${fmtNum(issue.roll.balanceQty)} ${issue.roll.uom} left`,
            to: `/inventory/rolls/${issue.roll.id}`,
          },
          { label: 'Fabric Issue', value: issue.issueNo, sub: fmtEnum(issue.purpose), current: true },
        ].filter(Boolean)}
      />


      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Issue</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Issue No" value={issue.issueNo} mono />
            <Detail label="Date" value={fmtDate(issue.issueDate)} />
            <Detail label="Roll No" value={issue.roll?.rollNo} mono />
            <Detail label="Fabric name" value={issue.fabricName} />
            <Detail label="Colour" value={issue.colorCode} />
            <Detail label="Purpose" value={fmtEnum(issue.purpose)} />
            <Detail label="Order No" value={issue.order?.orderNo} mono />
            <Detail label="Style No" value={issue.style?.styleNo} mono />
            <Detail
              label="Issued by"
              value={issue.issuedByName}
              sub={issue.issuedByEmployee?.designation}
            />
            <Detail label="Job worker" value={issue.vendor?.vendorName} />
            <Detail label="From location" value={issue.location} />
            <Detail
              label="Stock item"
              value={issue.inventoryItem?.itemCode}
              sub={issue.inventoryItem?.description}
              mono
            />
            {issue.remarks && <Detail label="Remarks" value={issue.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Stock movement</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            written in the same transaction as the issue
          </span>
        </div>
        {movements.length === 0 ? (
          <div className="card-body muted">
            No stock movement. This issue never reached the ledger.
          </div>
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th>Location</th>
                  <th className="num">Out</th>
                  <th className="num">Balance after</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{fmtDate(m.entryDate)}</td>
                    <td>
                      <span className="code">{m.item?.itemCode}</span>
                      <div className="faint">{m.item?.description}</div>
                    </td>
                    <td>{m.location}</td>
                    <td className="num">
                      <strong>{fmtNum(m.qtyOut)}</strong>
                    </td>
                    <td className="num">{fmtNum(m.balanceQty)}</td>
                    <td className="muted">{m.remarks ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>

      {jobWorks.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Job work PO this challan was sent against</div>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Job No</th>
                  <th>Date</th>
                  <th>Process</th>
                  <th>Vendor</th>
                  <th className="num">PO qty</th>
                  <th className="num">Sent to date</th>
                  <th className="num">Returned</th>
                  <th className="num">Shrinkage</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {jobWorks.map((j) => (
                  <tr className="clickable" key={j.id} onClick={() => navigate(`/job-works/${j.id}`)}>
                    <td className="code">{j.dyeIssueNo}</td>
                    <td className="nowrap">{fmtDate(j.issueDate)}</td>
                    <td>{fmtEnum(j.process)}</td>
                    <td>{j.vendor?.vendorName}</td>
                    <td className="num">{fmtNum(j.qty)}</td>
                    <td className="num">{fmtNum(j.issuedQty)}</td>
                    <td className="num">{fmtNum(j.receivedQty)}</td>
                    <td className="num">{(Number(j.shrinkagePct) * 100).toFixed(2)}%</td>
                    <td>
                      <StatusBadge status={j.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      {cuttingIssues.length > 0 && (
        <div className="card">
          <div className="card-header">Cut against this issue</div>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Challan No</th>
                  <th>Date</th>
                  <th>Unit</th>
                  <th className="num">Pcs issued</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {cuttingIssues.map((c) => (
                  <tr className="clickable" key={c.id} onClick={() => navigate(`/cutting-issues/${c.id}`)}>
                    <td className="code">{c.challanNo}</td>
                    <td className="nowrap">{fmtDate(c.issueDate)}</td>
                    <td>{c.firmName}</td>
                    <td className="num">{fmtNum(c.cuttingPcsIssued)}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}
    </>
  );
}

export default FabricIssueList;
