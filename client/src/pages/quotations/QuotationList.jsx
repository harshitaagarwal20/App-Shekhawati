/**
 * Vendor Quotation list. Sheet: "Vendor Quotation-Approval"
 * (Role Acess - Procurement Dept (Manager) - Approved by Dinesh Sir).
 *
 * Columns follow the workbook. The Amount column shows what the server stored;
 * this file never multiplies a rate by a quantity.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import {
  orders as ordersApi,
  quotations as quotationsApi,
  vendors as vendorsApi,
} from '../../services/erp.js';
import {
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
import QuotationForm from './QuotationForm.jsx';
import { fmtDate } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';


const fmtNum = (v) =>
  v === null || v === undefined ? '-' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Awaiting Director' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

export default function QuotationList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useResourceList((params) => quotationsApi.list(params), {
    defaultSort: 'quotationDate',
    defaultDir: 'desc',
    initialFilters: {
      authorisationStatus: '',
      vendorId: '',
      orderId: '',
    },
  });

  const [vendorOptions, setVendorOptions] = useState([]);
  const [orderOptions, setOrderOptions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState(null);

  const canCreate = can('VENDOR_QUOTATION.CREATE');

  useEffect(() => {
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  return (
    <>
      <PageHeader
        title="Vendor Quotations"
        actions={
          <>
            <ExportButton
              dataset="quotations"
              params={list.query}
              rowCount={list.meta.total}
            />
            {canCreate && (
              <>
              <button type="button" className="btn" onClick={() => navigate('/quotations/new-document')}>
                New multi-item quote
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                New quotation
              </button>
              </>
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

      {/* The "N documents on this page are awaiting a decision" banner that
          used to sit here has gone. It counted the rows of the CURRENT page
          and then told the reader to look at the rows of the current page -
          where every one of them already carries its own status badge, and
          where the Approvals queue lists the same documents across every
          module without the paging caveat. */}

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor="q-search">
              <TextInput
                id="q-search"
                type="search"
                placeholder="Search quotation no, item, remarks..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Vendor" htmlFor="q-f-vendor">
            <RecordSelect
              id="q-f-vendor"
              options={vendorOptions}
              getValue={(v) => v.id}
              getLabel={(v) => v.vendorName}
              placeholder="All vendors"
              value={list.filters.vendorId ?? ''}
              onChange={(e) => list.setFilter('vendorId', e.target.value)}
            />
          </Field>

          <Field label="Order" htmlFor="q-f-order">
            <RecordSelect
              id="q-f-order"
              options={orderOptions}
              getValue={(o) => o.id}
              getLabel={(o) => o.orderNo}
              placeholder="All orders"
              value={list.filters.orderId ?? ''}
              onChange={(e) => list.setFilter('orderId', e.target.value)}
            />
          </Field>

          <Field label="Authorisation" htmlFor="q-f-status">
            <EnumSelect
              id="q-f-status"
              options={STATUS_OPTIONS}
              placeholder="All"
              value={list.filters.authorisationStatus ?? ''}
              onChange={(e) => list.setFilter('authorisationStatus', e.target.value)}
            />
          </Field>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="quotationNo" label="Quotation No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="quotationDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="item" label="Item" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Vendor Name</th>
                <SortableTh field="rateQuoted" label="Rate Quoted" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <th>UOM</th>
                <SortableTh field="qty" label="Qty" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <SortableTh field="amount" label="Amount" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <th>Order No</th>
                <th>Authorised By</th>
                <SortableTh field="authorisationStatus" label="Status" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={11} className="loading-row">
                    <Spinner label="Loading quotations..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={11}>
                    <EmptyState
                      title="No quotations found"
                      message={
                        list.search
                          ? 'Try clearing the search or filters.'
                          : canCreate
                            ? 'Raise the first vendor quotation to get started.'
                            : undefined
                      }
                    />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((q) => (
                  <tr
                    key={q.id}
                    onClick={() => navigate(`/quotations/${q.id}`)}
                    className={`clickable ${q.authorisationStatus === 'REJECTED' ? 'inactive' : ''}`}
                  >
                    <td className="code">{q.quotationNo}</td>
                    <td className="nowrap">{fmtDate(q.quotationDate)}</td>
                    <td>
                      {q.item}
                      {(q.subCategory || q.accessoriesItem) && (
                        <div className="faint">{q.subCategory ?? q.accessoriesItem}</div>
                      )}
                    </td>
                    <td>{q.vendor?.vendorName ?? '-'}</td>
                    <td className="num">{fmtNum(q.rateQuoted)}</td>
                    <td>{q.uom}</td>
                    <td className="num">{fmtNum(q.qty)}</td>
                    <td className="num">
                      <strong>{fmtNum(q.amount)}</strong>
                      <div className="faint">{q.amountCalculation}</div>
                    </td>
                    <td className="code">{q.order?.orderNo ?? '-'}</td>
                    <td>{q.authorisedBy ?? '-'}</td>
                    <td>
                      <StatusBadge status={q.authorisationStatus} />
                    </td>
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
        <Modal title="New vendor quotation" size="wide" onClose={() => setCreating(false)}>
          <QuotationForm
            onCancel={() => setCreating(false)}
            onSaved={(saved) => {
              setCreating(false);
              setBanner({
                kind: 'success',
                text: `Quotation ${saved.quotationNo} raised at ${fmtNum(saved.amount)}. It is awaiting authorisation.`,
              });
              navigate(`/quotations/${saved.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}
