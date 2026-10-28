/**
 * Goods Receipt register. Sheet: "GRN".
 *
 * ONE ROW PER PURCHASE ORDER, not per receipt.
 *
 * An order is delivered in instalments, and each instalment is necessarily its
 * own receipt document: the vendor's bill number lives on the GRN header, and
 * one bill may be receipted against one PO exactly once. So SSO-001 arriving on
 * bill 354 and again on bill 355 is two GRNs by construction - and read one per
 * row, the register could not answer the question it is opened to answer, which
 * is how much of SSO-001 has actually turned up.
 *
 * Here the order is the row and the cumulative figure is the headline. Its
 * receipts are still every one of them there, one line each, when the row is
 * opened - with their own GRN numbers, bills, dates and quantities.
 *
 * The footer totals come from the server with the page - they add up RECEIPTS
 * across the whole filtered set, not just the rows on screen, and not summed
 * here.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { useOptionalColumns } from '../../hooks/useOptionalColumns.js';
import { grns as grnApi, vendors as vendorsApi } from '../../services/erp.js';
import {
  ColumnMenu,
  Alert,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  RecordSelect,
  SortableTh,
  Spinner,
  StatusBadge,
  TextInput,
  ClearFilters,
} from '../../components/ui.jsx';
import { fmtDate, fmtMoney, fmtNum, fmtVendor } from '../../utils/format.js';
import GrnForm from './GrnForm.jsx';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import DateRangeFilter from '../../components/DateRangeFilter.jsx';


/**
 * What this register can show, and what it shows unasked.
 *
 * Stores open Goods Received to ask what has arrived against an order: whose it
 * was, what it was, how much was ordered and how much is actually in. The
 * commercial detail - value, variation against the order - is what accounts and
 * the buyer check, so it is optional here rather than absent.
 *
 * There is no Rate column any more and no single Bill No: an order delivered on
 * three bills has three of each, and averaging them would invent a figure the
 * system does not hold. Both live on the receipt lines inside the row.
 */
const COLUMNS = [
  { key: 'poNo', label: 'PO No' },
  { key: 'lastReceipt', label: 'Last Receipt' },
  { key: 'poDate', label: 'PO Date', optional: true },
  { key: 'container', label: 'Container', optional: true },
  { key: 'vendor', label: 'Vendor' },
  { key: 'item', label: 'Item' },
  { key: 'uom', label: 'UOM', optional: true },
  { key: 'orderQty', label: 'Order Qty' },
  { key: 'receivedQty', label: 'Received' },
  { key: 'receipts', label: 'Receipts' },
  { key: 'amount', label: 'Amount', optional: true },
  { key: 'status', label: 'Status' },
];

/** What distinguishes one PO line from its siblings in the Item column. */
const describeLine = (l) =>
  [l.subCategory, l.accessoriesItem, l.accessoryType, l.colorCode]
    .filter(Boolean)
    .join(' · ');

export default function GrnList() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const cols = useOptionalColumns('grns', COLUMNS);

  const list = useResourceList((params) => grnApi.listByPurchaseOrder(params), {
    defaultSort: 'poDate',
    defaultDir: 'desc',
    initialFilters: {
      vendorId: '',
      status: '',
      dateFrom: '',
      dateTo: '',
    },
  });

  const [vendorOptions, setVendorOptions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState(null);
  /** Which orders are opened to show their receipts. Ids, not indexes. */
  const [opened, setOpened] = useState(() => new Set());

  const toggle = (id) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canCreate = can('GRN.CREATE');
  const totals = list.meta?.totals;

  /*
   * Where the footer's figures sit, counted rather than written as literals -
   * with columns that come and go, a hard-coded colSpan is wrong the moment
   * somebody hides one. The chevron cell is the +1.
   */
  const span = (...keys) => keys.filter((k) => cols.show(k)).length;
  const footLabelSpan =
    span('poNo', 'lastReceipt', 'poDate', 'container', 'vendor', 'item', 'uom', 'orderQty') + 1;
  const footTailSpan = span('receipts', 'status') + 1;

  useEffect(() => {
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
  }, []);

  return (
    <>
      <PageHeader
        title="Goods Receipt Notes"
        actions={
          <>
            <ExportButton dataset="grns" params={list.query} rowCount={list.meta.total} />
            {canCreate && (
              <>
                <button type="button" className="btn" onClick={() => navigate('/grns/new-document')}>
                  Receive several PO lines
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                  Post a receipt
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

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor="grn-search">
              <TextInput
                id="grn-search"
                type="search"
                placeholder="Search GRN no, bill no, roll no, item..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Vendor" htmlFor="grn-f-vendor">
            <RecordSelect
              id="grn-f-vendor"
              options={vendorOptions}
              getLabel={fmtVendor}
              placeholder="All vendors"
              value={list.filters.vendorId ?? ''}
              onChange={(e) => list.setFilter('vendorId', e.target.value)}
            />
          </Field>


          <DateRangeFilter filters={list.filters} setFilter={list.setFilter} />
          <ClearFilters list={list} />
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <SortableTh field="poNo" label="PO No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Last Receipt</th>
                {cols.show('poDate') && (
                  <SortableTh field="poDate" label="PO Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                )}
                {cols.show('container') && <th>Container</th>}
                <th>Vendor</th>
                <th>Item</th>
                {cols.show('uom') && <th>UOM</th>}
                {/* Not sortable: these are sums over an order's receipts, and
                    the database orders the PURCHASE ORDERS this register pages. */}
                <th className="num">Order Qty</th>
                <th className="num">Received</th>
                <th className="num">Receipts</th>
                {cols.show('amount') && <th className="num">Amount</th>}
                <th>Status</th>
                <ColumnMenu {...cols} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={cols.colSpan + 1} className="loading-row">
                    <Spinner label="Loading receipts..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={cols.colSpan + 1}>
                    <EmptyState
                      title="No receipts found"
                      message={list.search ? 'Try clearing the search or filters.' : undefined}
                    />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((po) => {
                  const [first] = po.lines;
                  const more = po.lineCount - 1;
                  const isOpen = opened.has(po.id);
                  return [
                    <tr
                      key={po.id}
                      onClick={() => toggle(po.id)}
                      className={`clickable ${po.toleranceBreached ? 'row-warn' : ''} ${po.reversed ? 'inactive' : ''}`}
                    >
                      <td className="faint" style={{ textAlign: 'center' }}>
                        {isOpen ? '▾' : '▸'}
                      </td>
                      <td className="code">{po.poNo}</td>
                      <td className="nowrap">{fmtDate(po.lastReceiptDate)}</td>
                      {cols.show('poDate') && <td className="nowrap">{fmtDate(po.poDate)}</td>}
                      {cols.show('container') && <td className="code">{po.containerNo ?? '-'}</td>}
                      <td>{po.vendor?.vendorName ?? '-'}</td>
                      <td>
                        {first?.item}
                        {first && describeLine(first) && (
                          <span className="faint"> {'·'} {describeLine(first)}</span>
                        )}
                        {more > 0 && (
                          <div className="faint">+ {more} more line{more === 1 ? '' : 's'}</div>
                        )}
                      </td>
                      {cols.show('uom') && <td>{po.uom ?? 'Mixed'}</td>}
                      <td className="num">
                        {po.orderQty == null ? <span className="faint">Mixed UOM</span> : fmtNum(po.orderQty)}
                      </td>
                      <td className="num">
                        {po.receivedQty == null ? (
                          <span className="faint">Mixed UOM</span>
                        ) : (
                          <strong>{fmtNum(po.receivedQty)}</strong>
                        )}
                      </td>
                      <td className="num">
                        {po.receiptCount}
                        {po.billNos?.length > 0 && (
                          <div className="faint">bill {po.billNos.slice(0, 3).join(', ')}{po.billNos.length > 3 ? '...' : ''}</div>
                        )}
                      </td>
                      {cols.show('amount') && <td className="num">{fmtMoney(po.totalAmount)}</td>}
                      <td>
                        {po.reversed ? (
                          <StatusBadge status="CANCELLED" />
                        ) : po.posted ? (
                          <StatusBadge status="COMPLETED" />
                        ) : (
                          <span className="faint">not posted</span>
                        )}
                        {po.partlyReversed && <div className="faint">part reversed</div>}
                        {po.toleranceBreached && <div className="faint">over tolerance</div>}
                      </td>
                      <td />
                    </tr>,

                    /* The receipts themselves - what the old register showed one
                       per row, now nested under the order they belong to. */
                    isOpen && (
                      <tr key={`${po.id}-receipts`} className="subrow">
                        <td />
                        <td colSpan={cols.colSpan}>
                          <table className="data" style={{ margin: 0 }}>
                            <thead>
                              <tr>
                                <th>GRN No</th>
                                <th>Date</th>
                                <th>Bill No</th>
                                <th>Item</th>
                                <th className="num">Received</th>
                                <th className="num">Rate</th>
                                <th className="num">Amount</th>
                                <th className="num">Variation</th>
                                <th>Posted</th>
                              </tr>
                            </thead>
                            <tbody>
                              {po.receipts.map((g) => (
                                <tr
                                  key={g.id}
                                  className={`clickable ${g.toleranceBreached ? 'row-warn' : ''} ${g.reversed ? 'inactive' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/grns/${g.id}`);
                                  }}
                                >
                                  <td className="code">{g.grnNo}</td>
                                  <td className="nowrap">{fmtDate(g.grnDate)}</td>
                                  <td>{g.billNo}</td>
                                  <td>
                                    {g.item}
                                    {g.poLine && describeLine(g.poLine) && (
                                      <span className="faint"> {'·'} {describeLine(g.poLine)}</span>
                                    )}
                                  </td>
                                  <td className="num">
                                    <strong>{fmtNum(g.receivingQty)}</strong> {g.uom}
                                  </td>
                                  <td className="num">{fmtNum(g.inventoryRate, { decimals: 4 })}</td>
                                  <td className="num">{fmtMoney(g.amount)}</td>
                                  <td className="num">{g.variationPctDisplay}%</td>
                                  <td>
                                    {g.reversed ? (
                                      <span className="badge badge-inactive">reversed</span>
                                    ) : g.posted ? (
                                      <StatusBadge status="COMPLETED" />
                                    ) : (
                                      <span className="faint">not posted</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                        <td />
                      </tr>
                    ),
                  ];
                })}
            </tbody>

            {/* Totals for the whole filtered set, summed by the server. They
                add up RECEIPTS, not orders - which is why they sit under the
                Received column rather than the Order Qty one. */}
            {totals && !list.loading && list.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={footLabelSpan} className="faint">
                    Totals for the filtered set
                  </td>
                  <td className="num">
                    <strong>{fmtNum(totals.receivingQty)}</strong>
                  </td>
                  {cols.show('amount') && (
                    <td className="num">
                      <strong>{fmtMoney(totals.amount)}</strong>
                    </td>
                  )}
                  <td colSpan={footTailSpan} />
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

      {creating && (
        <Modal title="Post a goods receipt" size="wide" onClose={() => setCreating(false)}>
          <GrnForm
            onCancel={() => setCreating(false)}
            onSaved={(saved) => {
              setCreating(false);
              setBanner({
                kind: 'success',
                text: `${saved.grnNo} posted — ${fmtNum(saved.receivingQty)} ${saved.uom} into ${saved.location}.`,
              });
              navigate(`/grns/${saved.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}
