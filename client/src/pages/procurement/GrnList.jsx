/**
 * GRN list. Sheet: "GRN".
 *
 * ONE ROW PER RECEIPT DOCUMENT - a delivery that received three lines of the
 * same purchase order is one entry, not three. The lines are GRN-001,
 * GRN-001/2, GRN-001/3; they share a lorry, a vendor bill and a GRN number,
 * and they are listed on the document page.
 *
 * The footer totals come from the server with the page - quantity and value
 * for the whole filtered set, not just the rows on screen, and not summed
 * here. They stay LINE-level on purpose: filter to one item and the footer
 * totals that item, not the whole deliveries it arrived in.
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
import GrnForm from './GrnForm.jsx';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const PURPOSE_OPTIONS = [
  { value: 'RAW_MATERIAL', label: 'Raw material' },
  { value: 'ACCESSORIES', label: 'Accessories' },
  { value: 'DYEING', label: 'Dyeing' },
  { value: 'PRINTING', label: 'Printing' },
  { value: 'JOB_WORK_RETURN', label: 'Job work return' },
];

/**
 * What this register can show, and what it shows unasked.
 *
 * Stores open Goods Received to find a receipt: whose it was, what came in,
 * how much, and whether it has been posted. The commercial detail - ordered
 * quantity, rate, amount, variation against the order - is what accounts and
 * the buyer check on one receipt, so it is optional here rather than absent.
 * A receipt over tolerance still paints its whole row, with or without the
 * Variation column showing.
 *
 * Rate and Variation belong to a LINE, not to a delivery: a three-line receipt
 * has three of each, and averaging them would invent a figure the system does
 * not hold. They show for a single-line receipt and say "per line" otherwise,
 * which is the document page's cue.
 */
const COLUMNS = [
  { key: 'grnNo', label: 'GRN No' },
  { key: 'date', label: 'Date' },
  { key: 'poId', label: 'PO No', optional: true },
  { key: 'billNo', label: 'Bill No', optional: true },
  { key: 'vendor', label: 'Vendor' },
  { key: 'item', label: 'Item' },
  { key: 'uom', label: 'UOM', optional: true },
  { key: 'orderQty', label: 'Order Qty' },
  { key: 'receivingQty', label: 'Receiving Qty' },
  { key: 'rate', label: 'Rate', optional: true },
  { key: 'amount', label: 'Amount', optional: true },
  { key: 'variation', label: 'Variation', optional: true },
  { key: 'posted', label: 'Posted' },
];

/** How a line reads in the Item column - what distinguishes it from a sibling. */
const describeLine = (l) =>
  [l.purchaseOrder?.subCategory, l.purchaseOrder?.accessoriesItem, l.purchaseOrder?.accessoryType]
    .filter(Boolean)
    .join(' · ');

export default function GrnList() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const cols = useOptionalColumns('grns', COLUMNS);

  const list = useResourceList((params) => grnApi.listDocuments(params), {
    defaultSort: 'grnDate',
    defaultDir: 'desc',
    initialFilters: {
      purpose: '',
      vendorId: '',
      status: '',
      breachesOnly: '',
    },
  });

  const [vendorOptions, setVendorOptions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState(null);

  const canCreate = can('GRN.CREATE');
  const totals = list.meta?.totals;

  /*
   * Where the footer's figures sit, counted rather than written as literals.
   *
   * The label runs up to the column before Receiving Qty, the quantity and the
   * amount sit under their own columns, and whatever is left is spanned. With
   * columns that come and go, a hard-coded colSpan here is wrong the moment
   * somebody hides one - which is what the Rate column did to the old `8`.
   */
  const span = (...keys) => keys.filter((k) => cols.show(k)).length;
  const footLabelSpan = span('grnNo', 'date', 'poId', 'billNo', 'vendor', 'item', 'uom', 'orderQty');
  // Variation, Posted, and the column menu's own header cell.
  const footTailSpan = span('variation', 'posted') + 1;

  useEffect(() => {
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
  }, []);

  return (
    <>
      <PageHeader
        title="Goods Receipt Notes"
        actions={
          <>
            <ExportButton
              dataset="grns"
              params={list.query}
              rowCount={list.meta.total}
            />
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
              getLabel={(v) => v.vendorName}
              placeholder="All vendors"
              value={list.filters.vendorId ?? ''}
              onChange={(e) => list.setFilter('vendorId', e.target.value)}
            />
          </Field>

          <Field label="Purpose" htmlFor="grn-f-purpose">
            <EnumSelect
              id="grn-f-purpose"
              options={PURPOSE_OPTIONS}
              placeholder="All"
              value={list.filters.purpose ?? ''}
              onChange={(e) => list.setFilter('purpose', e.target.value)}
            />
          </Field>

          <div className="field">
            <label htmlFor="grn-f-breach">Receipts</label>
            <EnumSelect
              id="grn-f-breach"
              options={[{ value: 'true', label: 'Over tolerance' }]}
              placeholder="All"
              value={list.filters.breachesOnly ?? ''}
              onChange={(e) => list.setFilter('breachesOnly', e.target.value)}
            />
          </div>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="grnNo" label="GRN No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="grnDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                {cols.show('poId') && <th>PO No</th>}
                {cols.show('billNo') && <SortableTh field="billNo" label="Bill No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />}
                <th>Vendor</th>
                <th>Item</th>
                {cols.show('uom') && <th>UOM</th>}
                {/* Not sortable: these are sums over a document's lines, and
                    the database orders the HEADERS this register pages. */}
                <th className="num">Order Qty</th>
                <th className="num">Receiving Qty</th>
                {cols.show('rate') && <th className="num">Rate</th>}
                {cols.show('amount') && <th className="num">Amount</th>}
                {cols.show('variation') && <th className="num">Variation</th>}
                <th>Posted</th>
                <ColumnMenu {...cols} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={cols.colSpan} className="loading-row">
                    <Spinner label="Loading receipts..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={cols.colSpan}>
                    <EmptyState
                      title="No receipts found"
                      message={list.search ? 'Try clearing the search or filters.' : undefined}
                    />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((doc) => {
                  const [first] = doc.lines;
                  const more = doc.lineCount - 1;
                  // Rate and variation are a line's own; a one-line receipt has
                  // exactly one of each, and nothing else does.
                  const single = doc.lineCount === 1 ? first : null;
                  return (
                    <tr
                      key={doc.id}
                      onClick={() => navigate(`/grns/documents/${doc.id}`)}
                      className={`clickable ${doc.toleranceBreached ? 'row-warn' : ''} ${doc.reversed ? 'inactive' : ''}`}
                    >
                      <td className="code">{doc.grnNo}</td>
                      <td className="nowrap">{fmtDate(doc.grnDate)}</td>
                      {/* A delivery may answer more than one purchase order. */}
                      {cols.show('poId') && (
                        <td className="code">{doc.poNos?.length ? doc.poNos.join(', ') : '-'}</td>
                      )}
                      {cols.show('billNo') && <td>{doc.billNo}</td>}
                      <td>{doc.vendor?.vendorName ?? '-'}</td>
                      <td>
                        {first?.item}
                        {first && describeLine(first) && (
                          <span className="faint"> {'·'} {describeLine(first)}</span>
                        )}
                        {more > 0 && <div className="faint">+ {more} more line{more === 1 ? '' : 's'}</div>}
                      </td>
                      {cols.show('uom') && <td>{doc.uom ?? 'Mixed'}</td>}
                      <td className="num">
                        {doc.orderQty == null
                          ? <span className="faint">Mixed UOM</span>
                          : fmtNum(doc.orderQty)}
                      </td>
                      <td className="num">
                        {doc.receivingQty == null
                          ? <span className="faint">Mixed UOM</span>
                          : <strong>{fmtNum(doc.receivingQty)}</strong>}
                        {doc.lineCount > 1 && <div className="faint">{doc.lineCount} lines</div>}
                      </td>
                      {cols.show('rate') && (
                        <td className="num">
                          {single
                            ? fmtNum(single.inventoryRate, { decimals: 4 })
                            : <span className="faint">per line</span>}
                        </td>
                      )}
                      {cols.show('amount') && <td className="num">{fmtMoney(doc.totalAmount)}</td>}
                      {cols.show('variation') && (
                        <td className="num">
                          {single
                            ? `${single.variationPctDisplay}%`
                            : <span className="faint">per line</span>}
                          {doc.toleranceBreached && <div className="faint">over tolerance</div>}
                        </td>
                      )}
                      <td>
                        {doc.reversed ? (
                          <StatusBadge status="CANCELLED" />
                        ) : doc.posted ? (
                          <StatusBadge status="COMPLETED" />
                        ) : (
                          <span className="faint">not posted</span>
                        )}
                        {doc.partlyReversed && <div className="faint">part reversed</div>}
                      </td>
                      <td />
                    </tr>
                  );
                })}
            </tbody>

            {/* Totals for the whole filtered set, summed by the server. */}
            {totals && !list.loading && list.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={footLabelSpan} className="faint">
                    Totals for the filtered set
                  </td>
                  <td className="num">
                    <strong>{fmtNum(totals.receivingQty)}</strong>
                  </td>
                  {cols.show('rate') && <td />}
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
