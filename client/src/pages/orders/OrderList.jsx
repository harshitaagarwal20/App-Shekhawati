/**
 * Buyer Order list. Sheet: "Order" (Role Acess - Merchandising Team).
 *
 * Columns follow the workbook so a merchandiser recognises the screen, with
 * two additions the sheet cannot show: the excess approval state, and the
 * server-calculated effective quantity that the excess decision produces.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { useOptionalColumns } from '../../hooks/useOptionalColumns.js';
import { buyers as buyersApi, orders as ordersApi } from '../../services/erp.js';
import {
  Alert,
  ColumnMenu,
  EmptyState,
  EnumSelect,
  Field,
  MasterSelect,
  Modal,
  PageHeader,
  Pagination,
  RecordSelect,
  SortableTh,
  Spinner,
  StatusBadge,
  TextInput,
} from '../../components/ui.jsx';
import OrderForm from './OrderForm.jsx';

/**
 * What this list can show, and what it shows unasked.
 *
 * The defaults answer the question the screen is opened with: WHICH ORDER, for
 * whom, of what, how many, when is it due, and where has it got to. The rest
 * are real columns that real people need - accounts wants Currency, the
 * Director wants Excess, planning wants Effective Qty - and each is one click
 * away in the column menu, remembered per person from then on.
 *
 * Order No, Buyer, Style No, Order Qty, Delivery and Status are not optional.
 * A list of orders you cannot identify, price the work of, or place in the
 * pipeline is not a shorter list - it is a broken one.
 */
const COLUMNS = [
  { key: 'orderNo', label: 'Order No' },
  { key: 'orderDate', label: 'Order Date', optional: true },
  { key: 'buyer', label: 'Buyer' },
  { key: 'styleNo', label: 'Style No' },
  { key: 'itemDescription', label: 'Item Description', optional: true },
  { key: 'orderQty', label: 'Order Qty' },
  { key: 'effectiveQty', label: 'Effective Qty', optional: true },
  { key: 'excess', label: 'Excess', optional: true },
  { key: 'colour', label: 'Colour', optional: true },
  { key: 'currency', label: 'Currency', optional: true },
  { key: 'buyerPoNo', label: 'Buyer PO', optional: true },
  { key: 'containerNo', label: 'Container', optional: true },
  { key: 'orderValue', label: 'Order Value', optional: true },
  { key: 'exFactory', label: 'Ex-Factory', optional: true },
  { key: 'delivery', label: 'Delivery' },
  { key: 'status', label: 'Status' },
];
import { fmtDate } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';


const fmtQty = (v) => (v === null || v === undefined ? '-' : Number(v).toLocaleString());

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const EXCESS_OPTIONS = [
  { value: 'NOT_REQUIRED', label: 'No excess' },
  { value: 'PENDING', label: 'Awaiting Director' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

const EXCESS_BADGE = {
  NOT_REQUIRED: 'badge-inactive',
  PENDING: 'badge-pending',
  APPROVED: 'badge-approved',
  REJECTED: 'badge-rejected',
};

export default function OrderList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const cols = useOptionalColumns('orders', COLUMNS);

  const list = useResourceList((params) => ordersApi.list(params), {
    defaultSort: 'orderDate',
    defaultDir: 'desc',
    initialFilters: {
      status: '',
      excessApprovalStatus: '',
      buyerId: '',
      currency: '',
    },
  });

  const [buyerOptions, setBuyerOptions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState(null);

  const canCreate = can('BUYER_ORDER.CREATE');

  useEffect(() => {
    buyersApi.options().then(setBuyerOptions).catch(loadFailed(setBuyerOptions, 'buyers'));
  }, []);

  return (
    <>
      <PageHeader
        title="Buyer Orders"
        actions={
          <>
            <ExportButton
              dataset="orders"
              params={list.query}
              rowCount={list.meta.total}
            />
            {canCreate && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                New order
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

      {/* The "N documents on this page are awaiting a decision" banner that
          used to sit here has gone. It counted the rows of the CURRENT page
          and then told the reader to look at the rows of the current page -
          where every one of them already carries its own status badge, and
          where the Approvals queue lists the same documents across every
          module without the paging caveat. */}

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor="o-search">
              <TextInput
                id="o-search"
                type="search"
                placeholder="Search order no, description, colour, container, remarks..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Buyer" htmlFor="o-buyer">
            <RecordSelect
              id="o-buyer"
              options={buyerOptions}
              getValue={(b) => b.id}
              getLabel={(b) => b.buyerName}
              placeholder="All buyers"
              value={list.filters.buyerId ?? ''}
              onChange={(e) => list.setFilter('buyerId', e.target.value)}
            />
          </Field>

          <Field label="Status" htmlFor="o-status">
            <EnumSelect
              id="o-status"
              options={STATUS_OPTIONS}
              placeholder="All"
              value={list.filters.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
            />
          </Field>

          <Field label="Excess" htmlFor="o-excess">
            <EnumSelect
              id="o-excess"
              options={EXCESS_OPTIONS}
              placeholder="All"
              value={list.filters.excessApprovalStatus ?? ''}
              onChange={(e) => list.setFilter('excessApprovalStatus', e.target.value)}
            />
          </Field>

          <Field label="Currency" htmlFor="o-currency">
            <MasterSelect
              id="o-currency"
              listCode="Currency"
              placeholder="All"
              value={list.filters.currency ?? ''}
              onChange={(e) => list.setFilter('currency', e.target.value)}
            />
          </Field>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="orderNo" label="Order No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                {cols.show('orderDate') && <SortableTh field="orderDate" label="Order Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />}
                <th>Buyer</th>
                <th>Style No</th>
                {cols.show('itemDescription') && <th>Item Description</th>}
                <SortableTh field="orderQty" label="Order Qty" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                {cols.show('effectiveQty') && <th className="num">Effective Qty</th>}
                {cols.show('excess') && <th>Excess</th>}
                {cols.show('colour') && <th>Colour</th>}
                {cols.show('currency') && <th>Curr.</th>}
                {cols.show('buyerPoNo') && <th>Buyer PO</th>}
                {cols.show('containerNo') && <th>Container</th>}
                {cols.show('orderValue') && <SortableTh field="orderValue" label="Value" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />}
                {cols.show('exFactory') && <SortableTh field="exFactoryDate" label="Ex-Factory" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />}
                <SortableTh field="buyerDeliveryDate" label="Delivery" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="status" label="Status" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <ColumnMenu {...cols} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={cols.colSpan} className="loading-row">
                    <Spinner label="Loading orders..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={cols.colSpan}>
                    <EmptyState
                      title="No orders found"
                      message={
                        list.search
                          ? 'Try clearing the search or filters.'
                          : canCreate
                            ? 'Create the first buyer order to get started.'
                            : undefined
                      }
                    />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => navigate(`/orders/${o.id}`)}
                    className={`clickable ${o.status === 'CANCELLED' ? 'inactive' : ''}`}
                  >
                    <td className="code">{o.orderNo}</td>
                    {cols.show('orderDate') && <td className="nowrap">{fmtDate(o.orderDate)}</td>}
                    <td>{o.buyer?.buyerName ?? '-'}</td>
                    <td className="code">{o.style?.styleNo ?? '-'}</td>
                    {cols.show('itemDescription') && <td>{o.itemDescription ?? '-'}</td>}
                    <td className="num">{fmtQty(o.orderQty)}</td>
                    {cols.show('effectiveQty') && (
                      <td className="num">
                        <strong>{fmtQty(o.effectiveQty)}</strong>
                        {Number(o.excessQty) > 0 && (
                          <div className="faint">+{fmtQty(o.excessQty)}</div>
                        )}
                      </td>
                    )}
                    {cols.show('excess') && (
                      <td>
                        <span className={`badge ${EXCESS_BADGE[o.excessApprovalStatus]}`}>
                          {o.excessApprovalStatus === 'NOT_REQUIRED'
                            ? '-'
                            : `${(Number(o.excessPct) * 100).toFixed(1)}%`}
                        </span>
                      </td>
                    )}
                    {cols.show('colour') && <td>{o.colorCode ?? '-'}</td>}
                    {cols.show('currency') && <td>{o.currency ?? '-'}</td>}
                    {cols.show('buyerPoNo') && <td className="code">{o.buyerPoNo ?? '-'}</td>}
                    {cols.show('containerNo') && <td className="code">{o.containerNo ?? '-'}</td>}
                    {cols.show('orderValue') && (
                      <td className="num">
                        {o.orderValue != null
                          ? Number(o.orderValue).toLocaleString('en-IN', { maximumFractionDigits: 2 })
                          : <span className="faint">{o.pricePending ? 'unpriced' : '-'}</span>}
                      </td>
                    )}
                    {cols.show('exFactory') && <td className="nowrap">{fmtDate(o.exFactoryDate)}</td>}
                    <td className="nowrap">{fmtDate(o.buyerDeliveryDate)}</td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    {/* The column menu's own cell, so every row is one width. */}
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
        <Modal title="New buyer order" size="wide" onClose={() => setCreating(false)}>
          <OrderForm
            onCancel={() => setCreating(false)}
            onSaved={(saved) => {
              setCreating(false);
              setBanner({
                kind: 'success',
                text: `Order ${saved.orderNo} created${
                  saved.excessApprovalStatus === 'PENDING'
                    ? '. The excess request has gone to the Director.'
                    : '.'
                }`,
              });
              navigate(`/orders/${saved.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}
