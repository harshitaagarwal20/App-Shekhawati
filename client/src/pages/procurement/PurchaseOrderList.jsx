/**
 * Purchase Order list. Sheet: "PO".
 *
 * Server-side paginated, filtered and sorted - `useResourceList` sends the
 * query and the API answers with one page. Nothing here loads a table of
 * purchase orders into the browser and filters it locally.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { useOptionalColumns } from '../../hooks/useOptionalColumns.js';
import {
  orders as ordersApi,
  purchaseOrders as poApi,
  vendors as vendorsApi,
} from '../../services/erp.js';
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
import { StateBadge } from '../../components/workflow.jsx';
import { fmtDate, fmtMoney, fmtNum } from '../../utils/format.js';
import PurchaseOrderForm from './PurchaseOrderForm.jsx';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const ORDER_TYPE_OPTIONS = [
  { value: 'AS_PER_STYLE', label: 'As per style' },
  { value: 'BULK', label: 'Bulk' },
];

/**
 * What this register can show, and what it shows unasked.
 *
 * A purchase order is found by its number, its vendor and what it buys; the
 * two figures that decide whether to open it are the quantity and the money.
 * Unit rate, UOM, how much has arrived and which buyer order it serves are
 * checked on the order itself, so they are in the column menu.
 *
 * Workflow and Status are two different badges - where the document has got to
 * in its approval, and whether it is live. The list keeps Status; Workflow is
 * one click away for whoever is chasing approvals.
 */
const COLUMNS = [
  { key: 'poId', label: 'PO ID' },
  { key: 'date', label: 'Date' },
  { key: 'item', label: 'Item' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'uom', label: 'UOM', optional: true },
  { key: 'orderQty', label: 'Order Qty' },
  { key: 'rate', label: 'Rate', optional: true },
  { key: 'amount', label: 'Amount' },
  { key: 'received', label: 'Received', optional: true },
  { key: 'orderNo', label: 'Order No', optional: true },
  { key: 'workflow', label: 'Workflow', optional: true },
  { key: 'status', label: 'Status' },
];

export default function PurchaseOrderList() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const cols = useOptionalColumns('purchase-orders', COLUMNS);

  const list = useResourceList((params) => poApi.list(params), {
    defaultSort: 'poDate',
    defaultDir: 'desc',
    initialFilters: {
      status: '',
      vendorId: '',
      orderId: '',
      orderMode: '',
    },
  });

  const [vendorOptions, setVendorOptions] = useState([]);
  const [orderOptions, setOrderOptions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState(null);

  const canCreate = can('PURCHASE_ORDER.CREATE');

  useEffect(() => {
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        actions={
          <>
            <ExportButton
              dataset="purchase-orders"
              params={list.query}
              rowCount={list.meta.total}
            />
            {canCreate && (
              <>
              <button type="button" className="btn" onClick={() => navigate('/purchase-orders/new-document')}>
                New multi-item PO
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                New purchase order
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
            <Field label="Search" htmlFor="po-search">
              <TextInput
                id="po-search"
                type="search"
                placeholder="Search PO ID, item, HSN, remarks..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Vendor" htmlFor="po-f-vendor">
            <RecordSelect
              id="po-f-vendor"
              options={vendorOptions}
              getLabel={(v) => v.vendorName}
              placeholder="All vendors"
              value={list.filters.vendorId ?? ''}
              onChange={(e) => list.setFilter('vendorId', e.target.value)}
            />
          </Field>

          <Field label="Order" htmlFor="po-f-order">
            <RecordSelect
              id="po-f-order"
              options={orderOptions}
              getLabel={(o) => o.orderNo}
              placeholder="All orders"
              value={list.filters.orderId ?? ''}
              onChange={(e) => list.setFilter('orderId', e.target.value)}
            />
          </Field>

          <Field label="Status" htmlFor="po-f-status">
            <EnumSelect
              id="po-f-status"
              options={STATUS_OPTIONS}
              placeholder="All"
              value={list.filters.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
            />
          </Field>

          <Field label="Order type" htmlFor="po-f-type">
            <EnumSelect
              id="po-f-type"
              options={ORDER_TYPE_OPTIONS}
              placeholder="All"
              value={list.filters.orderMode ?? ''}
              onChange={(e) => list.setFilter('orderMode', e.target.value)}
            />
          </Field>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="poId" label="PO ID" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="poDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="item" label="Item" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Vendor</th>
                {cols.show('uom') && <th>UOM</th>}
                <SortableTh field="orderQty" label="Order Qty" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                {cols.show('rate') && <SortableTh field="rate" label="Rate" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />}
                <SortableTh field="amount" label="Amount" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                {cols.show('received') && <SortableTh field="receivedQty" label="Received" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />}
                {cols.show('orderNo') && <th>Order No</th>}
                {cols.show('workflow') && <th>Workflow</th>}
                <SortableTh field="status" label="Status" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <ColumnMenu {...cols} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={cols.colSpan} className="loading-row">
                    <Spinner label="Loading purchase orders..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={cols.colSpan}>
                    <EmptyState
                      title="No purchase orders found"
                      message={
                        list.search
                          ? 'Try clearing the search or filters.'
                          : canCreate
                            ? 'Raise the first purchase order to get started.'
                            : undefined
                      }
                    />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((po) => (
                  <tr
                    key={po.id}
                    onClick={() => navigate(`/purchase-orders/${po.id}`)}
                    className={`clickable ${po.approvalStatus === 'REJECTED' || po.status === 'CANCELLED' ? 'inactive' : ''}`}
                  >
                    <td className="code">{po.poId}</td>
                    <td className="nowrap">{fmtDate(po.poDate)}</td>
                    <td>
                      {po.item}
                      {(po.subCategory || po.accessoriesItem) && (
                        <div className="faint">{po.subCategory ?? [po.accessoriesItem, po.accessoryType].filter(Boolean).join(' · ')}</div>
                      )}
                    </td>
                    <td>{po.vendor?.vendorName ?? '-'}</td>
                    {cols.show('uom') && <td>{po.uom}</td>}
                    <td className="num">{fmtNum(po.orderQty)}</td>
                    {cols.show('rate') && <td className="num">{fmtNum(po.rate, { decimals: 4 })}</td>}
                    <td className="num">
                      <strong>{fmtMoney(po.amount)}</strong>
                      <div className="faint">{po.amountCalculation}</div>
                    </td>
                    {cols.show('received') && (
                      <td className="num">
                        {fmtNum(po.receivedQty)}
                        {Number(po.pendingQty) > 0 && (
                          <div className="faint">{fmtNum(po.pendingQty)} due</div>
                        )}
                      </td>
                    )}
                    {cols.show('orderNo') && <td className="code">{po.order?.orderNo ?? '-'}</td>}
                    {cols.show('workflow') && (
                      <td>
                        <StateBadge state={po.workflowState} />
                      </td>
                    )}
                    <td>
                      <StatusBadge status={po.status} />
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
        <Modal title="New purchase order" size="wide" onClose={() => setCreating(false)}>
          <PurchaseOrderForm
            onCancel={() => setCreating(false)}
            onSaved={(saved) => {
              setCreating(false);
              setBanner({
                kind: 'success',
                text: `${saved.poId} raised at ${fmtMoney(saved.amount)}. It is awaiting approval.`,
              });
              navigate(`/purchase-orders/${saved.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}
