/**
 * Purchase Order list. Sheet: "PO".
 *
 * One row per PO DOCUMENT - a multi-item PO is one entry, not one per item.
 * Its lines are listed on the document page.
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
  styles as stylesApi,
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
  { key: 'poId', label: 'PO No' },
  { key: 'date', label: 'Date' },
  { key: 'item', label: 'Items' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'uom', label: 'UOM', optional: true },
  { key: 'orderQty', label: 'Order Qty' },
  { key: 'rate', label: 'Rate', optional: true },
  { key: 'amount', label: 'Amount' },
  { key: 'received', label: 'Received', optional: true },
  { key: 'orderNo', label: 'Order No', optional: true },
  { key: 'styleNo', label: 'Style No', optional: true },
  { key: 'containerNo', label: 'Container', optional: true },
  { key: 'workflow', label: 'Approval', optional: true },
  { key: 'status', label: 'Status' },
];

export default function PurchaseOrderList() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const cols = useOptionalColumns('purchase-orders', COLUMNS);

  const list = useResourceList((params) => poApi.listDocuments(params), {
    defaultSort: 'poDate',
    defaultDir: 'desc',
    initialFilters: {
      status: '',
      vendorId: '',
      orderId: '',
      styleId: '',
      orderMode: '',
    },
  });

  const [vendorOptions, setVendorOptions] = useState([]);
  const [orderOptions, setOrderOptions] = useState([]);
  const [styleOptions, setStyleOptions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState(null);

  const canCreate = can('PURCHASE_ORDER.CREATE');

  useEffect(() => {
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
    stylesApi.options().then(setStyleOptions).catch(loadFailed(setStyleOptions, 'styles'));
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
                placeholder="Search PO ID, item, HSN, container, remarks..."
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

          <Field label="Style" htmlFor="po-f-style">
            <RecordSelect
              id="po-f-style"
              options={styleOptions}
              getLabel={(s) => s.styleNo}
              placeholder="All styles"
              value={list.filters.styleId ?? ''}
              onChange={(e) => list.setFilter('styleId', e.target.value)}
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
                <SortableTh field="poNo" label="PO No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="poDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Items</th>
                <th>Vendor</th>
                {cols.show('uom') && <th>UOM</th>}
                <th className="num">Order Qty</th>
                {cols.show('rate') && <th className="num">Rate</th>}
                <th className="num">Amount</th>
                {cols.show('received') && <th className="num">Received</th>}
                {cols.show('orderNo') && <th>Order No</th>}
                {cols.show('styleNo') && <th>Style No</th>}
                {cols.show('containerNo') && <th>Container</th>}
                {cols.show('workflow') && <th>Approval</th>}
                <th>Status</th>
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
                list.rows.map((doc) => {
                  const [first] = doc.lines;
                  const more = doc.lineCount - 1;
                  const single = doc.lineCount === 1 ? first : null;
                  return (
                  <tr
                    key={doc.id}
                    onClick={() => navigate(`/purchase-orders/documents/${doc.id}`)}
                    className={`clickable ${doc.approvalStatus === 'REJECTED' || doc.status === 'CANCELLED' ? 'inactive' : ''}`}
                  >
                    <td className="code">{doc.poNo}</td>
                    <td className="nowrap">{fmtDate(doc.poDate)}</td>
                    <td>
                      {first?.item}
                      {first && (first.subCategory || first.accessoriesItem) && (
                        <span className="faint"> · {first.subCategory ?? [first.accessoriesItem, first.accessoryType].filter(Boolean).join(' · ')}</span>
                      )}
                      {more > 0 && <div className="faint">+ {more} more item{more === 1 ? '' : 's'}</div>}
                    </td>
                    <td>{doc.vendor?.vendorName ?? '-'}</td>
                    {cols.show('uom') && <td>{doc.uom ?? 'Mixed'}</td>}
                    <td className="num">{doc.orderQty == null ? <span className="faint">Mixed UOM</span> : fmtNum(doc.orderQty)}</td>
                    {cols.show('rate') && <td className="num">{single ? fmtNum(single.rate, { decimals: 4 }) : '-'}</td>}
                    <td className="num">
                      <strong>{fmtMoney(doc.totalAmount)}</strong>
                      {doc.lineCount > 1 && <div className="faint">{doc.lineCount} lines</div>}
                    </td>
                    {cols.show('received') && (
                      <td className="num">{doc.receivedQty == null ? '-' : fmtNum(doc.receivedQty)}</td>
                    )}
                    {cols.show('orderNo') && <td className="code">{doc.orderNos.length ? doc.orderNos.join(', ') : '-'}</td>}
                    {cols.show('styleNo') && <td className="code">{doc.styleNos?.length ? doc.styleNos.join(', ') : '-'}</td>}
                    {/* A document may buy for more than one container, exactly as
                        it may buy for more than one order - both are listed. */}
                    {cols.show('containerNo') && (
                      <td className="code">{doc.containerNos?.length ? doc.containerNos.join(', ') : '-'}</td>
                    )}
                    {cols.show('workflow') && (
                      <td>
                        <StatusBadge status={doc.approvalStatus} />
                      </td>
                    )}
                    <td>
                      <StatusBadge status={doc.status} />
                    </td>
                    <td />
                  </tr>
                  );
                })}
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
