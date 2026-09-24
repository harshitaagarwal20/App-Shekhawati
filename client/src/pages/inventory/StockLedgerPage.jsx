/**
 * The stock ledger, as a register.
 *
 * ---------------------------------------------------------------------------
 *  APPEND-ONLY, AND THE SOURCE OF TRUTH
 *
 *  There is no "add movement" button on this screen, and there is no endpoint
 *  behind one either. Stock moves only as a consequence of a document - a GRN
 *  in, a fabric issue out, a job-work return back in - and every row here names
 *  the document that caused it.
 *
 *  A ledger with a public write endpoint is not a ledger. It is a spreadsheet
 *  with extra steps.
 *
 *  Every column the brief asks for is here: date, item, category, roll, colour,
 *  GSM, content, UOM, quantity in, quantity out, rate, order, reference type,
 *  reference id, location and user.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useResourceList } from '../../hooks/useResourceList.js';
import { useOptionalColumns } from '../../hooks/useOptionalColumns.js';
import { inventory as invApi, orders as ordersApi } from '../../services/erp.js';
import {
  ColumnMenu,
  Alert,
  EmptyState,
  EnumSelect,
  Field,
  MasterSelect,
  PageHeader,
  Pagination,
  RecordSelect,
  SortableTh,
  Spinner,
  TextInput,
} from '../../components/ui.jsx';
import { fmtDate, fmtEnum, fmtNum } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const DOC_TYPES = [
  'GRN',
  'FABRIC_ISSUE',
  'DYE_ISSUE',
  'DYEING_RECEIPT',
  'PRINTING',
  'FABRIC_SCRUTINY',
  'CUTTING_ISSUE',
].map((v) => ({ value: v, label: fmtEnum(v) }));

const DIRECTIONS = [
  { value: 'IN', label: 'In' },
  { value: 'OUT', label: 'Out' },
];

/** Where a reference document lives, so the register can link to it. */
const ROUTE_FOR = {
  GRN: (id) => `/grns/${id}`,
  /** F-04 - the counter-entry that took a receipt back out of stock. */
  GRN_REVERSAL: (id) => `/grn-reversals/${id}`,
  FABRIC_ISSUE: (id) => `/fabric-issues/${id}`,
  DYE_ISSUE: (id) => `/job-works/${id}`,
  CUTTING_ISSUE: (id) => `/cutting-issues/${id}`,
};

/**
 * What this register can show, and what it shows unasked.
 *
 * Sixteen columns, of which six answer the question the register is opened
 * with: on what day did this item move, in or out, what is the running
 * balance, and which document did it. The cloth specification (category,
 * colour, GSM, content, unit), the roll, the rate, the order, the location and
 * the user are the audit detail - which is exactly what this register is FOR,
 * so none of it is removed; it is simply not carried by every row of a
 * five-hundred-row scroll.
 */
const COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'item', label: 'Item' },
  { key: 'category', label: 'Category', optional: true },
  { key: 'roll', label: 'Roll', optional: true },
  { key: 'colour', label: 'Colour', optional: true },
  { key: 'gsm', label: 'GSM', optional: true },
  { key: 'content', label: 'Content', optional: true },
  { key: 'uom', label: 'UOM', optional: true },
  { key: 'in', label: 'In' },
  { key: 'out', label: 'Out' },
  { key: 'rate', label: 'Rate', optional: true },
  { key: 'order', label: 'Order', optional: true },
  { key: 'reference', label: 'Reference' },
  /*
   * NOT OPTIONAL, AND THAT IS NOT A PREFERENCE.
   *
   * `balanceQty` is the running on-hand for (ITEM, LOCATION) - see the column
   * comment in schema.prisma. Hide the location and the Balance column becomes
   * a sequence nobody can read: 920, then 2, then 919, then 1, then 918, as
   * the rows walk between two stores. Each figure is right; the column is
   * unintelligible without the thing it is counted per.
   */
  { key: 'location', label: 'Location' },
  { key: 'balance', label: 'Balance' },
  { key: 'user', label: 'User', optional: true },
];

export default function StockLedgerPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const cols = useOptionalColumns('stock-ledger', COLUMNS);

  const list = useResourceList((query) => invApi.ledger(query), {
    defaultSort: 'entryDate',
    defaultDir: 'desc',
    initialFilters: {
      itemId: params.get('itemId') ?? '',
      rollId: params.get('rollId') ?? '',
      orderId: '',
      location: '',
      documentType: '',
      direction: '',
    },
  });

  const [orderOptions, setOrderOptions] = useState([]);

  useEffect(() => {
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  return (
    <>
      <PageHeader
        title="Stock Movement"
        actions={
          <ExportButton dataset="stock-ledger" params={list.query} rowCount={list.meta.total} />
        }
      />

      {list.error && <Alert kind="error">{list.error.message}</Alert>}

      {/* No card: the table is the page. `.filter-row` is `.toolbar` without
          the card chrome - see styles.css. */}
      <div className="filter-row">
        <div className="grow">
          <Field label="Search" htmlFor="led-search">
            <TextInput
              id="led-search"
              type="search"
              placeholder="Search document no, remarks, category, colour..."
              value={list.search}
              onChange={(e) => list.setSearch(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Order" htmlFor="led-f-order">
          <RecordSelect
            id="led-f-order"
            options={orderOptions}
            getLabel={(o) => o.orderNo}
            placeholder="All orders"
            value={list.filters.orderId ?? ''}
            onChange={(e) => list.setFilter('orderId', e.target.value)}
          />
        </Field>

        <Field label="Location" htmlFor="led-f-loc">
          <MasterSelect
            id="led-f-loc"
            listCode="StockLocation"
            placeholder="All"
            value={list.filters.location ?? ''}
            onChange={(e) => list.setFilter('location', e.target.value)}
          />
        </Field>

        <Field label="Reference type" htmlFor="led-f-doc">
          <EnumSelect
            id="led-f-doc"
            options={DOC_TYPES}
            placeholder="All"
            value={list.filters.documentType ?? ''}
            onChange={(e) => list.setFilter('documentType', e.target.value)}
          />
        </Field>

        <Field label="Direction" htmlFor="led-f-dir">
          <EnumSelect
            id="led-f-dir"
            options={DIRECTIONS}
            placeholder="Both"
            value={list.filters.direction ?? ''}
            onChange={(e) => list.setFilter('direction', e.target.value)}
          />
        </Field>
      </div>

      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <SortableTh field="entryDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
              <th>Item</th>
              {cols.show('category') && <th>Category</th>}
              {cols.show('roll') && <th>Roll</th>}
              {cols.show('colour') && <th>Colour</th>}
              {cols.show('gsm') && <th>GSM</th>}
              {cols.show('content') && <th>Content</th>}
              {cols.show('uom') && <th>UOM</th>}
              <th className="num">In</th>
              <th className="num">Out</th>
              {cols.show('rate') && <th className="num">Rate</th>}
              {cols.show('order') && <th>Order</th>}
              <th>Reference</th>
              <th>Location</th>
              <th className="num">Balance</th>
              {cols.show('user') && <th>User</th>}
              <ColumnMenu {...cols} />
            </tr>
          </thead>
          <tbody>
            {list.loading && (
              <tr>
                <td colSpan={cols.colSpan} className="loading-row">
                  <Spinner label="Loading the register..." />
                </td>
              </tr>
            )}

            {!list.loading && list.rows.length === 0 && (
              <tr>
                <td colSpan={cols.colSpan}>
                  <EmptyState
                    title="No movements"
                    message="Movements appear here as documents are posted."
                  />
                </td>
              </tr>
            )}

            {!list.loading &&
              list.rows.map((m) => {
                const route = ROUTE_FOR[m.documentType]?.(m.documentId);
                return (
                  <tr className="clickable"
                    key={m.id}
                    onClick={route ? () => navigate(route) : undefined}
                    style={route ? { cursor: 'pointer' } : undefined}
                  >
                    <td className="nowrap">{fmtDate(m.entryDate)}</td>
                    <td>
                      <span className="code">{m.item?.itemCode}</span>
                      <div className="faint">{m.item?.description}</div>
                    </td>
                    {cols.show('category') && <td>{m.itemCategory || '-'}</td>}
                    {cols.show('roll') && <td className="code">{m.roll?.rollNo ?? '-'}</td>}
                    {cols.show('colour') && <td>{m.colorCode ?? '-'}</td>}
                    {cols.show('gsm') && <td>{m.gsm ?? '-'}</td>}
                    {cols.show('content') && <td>{m.content ?? '-'}</td>}
                    {cols.show('uom') && <td>{m.uom || '-'}</td>}
                    <td className="num">
                      {Number(m.qtyIn) > 0 ? <strong>{fmtNum(m.qtyIn)}</strong> : '-'}
                    </td>
                    <td className="num">
                      {Number(m.qtyOut) > 0 ? <strong>{fmtNum(m.qtyOut)}</strong> : '-'}
                    </td>
                    {cols.show('rate') && <td className="num">{fmtNum(m.rate, { decimals: 4 })}</td>}
                    {cols.show('order') && <td className="code">{m.order?.orderNo ?? '-'}</td>}
                    <td>
                      <div>{fmtEnum(m.documentType)}</div>
                      <div className="code faint">{m.documentNo}</div>
                    </td>
                    <td>{fmtEnum(m.location)}</td>
                    <td className="num">{fmtNum(m.balanceQty)}</td>
                    {cols.show('user') && <td>{m.createdByName ?? '-'}</td>}
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
    </>
  );
}
