/**
 * GRN list. Sheet: "GRN".
 *
 * The footer totals come from the server with the page - receipts and value for
 * the whole filtered set, not just the rows on screen, and not summed here.
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
 */
const COLUMNS = [
  { key: 'grnNo', label: 'GRN No' },
  { key: 'date', label: 'Date' },
  { key: 'poId', label: 'PO ID', optional: true },
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

export default function GrnList() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const cols = useOptionalColumns('grns', COLUMNS);

  const list = useResourceList((params) => grnApi.list(params), {
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
                {cols.show('poId') && <th>PO ID</th>}
                {cols.show('billNo') && <SortableTh field="billNo" label="Bill No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />}
                <th>Vendor</th>
                <th>Item</th>
                {cols.show('uom') && <th>UOM</th>}
                <SortableTh field="orderQty" label="Order Qty" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <SortableTh field="receivingQty" label="Receiving Qty" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                {cols.show('rate') && <SortableTh field="inventoryRate" label="Rate" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />}
                {cols.show('amount') && <SortableTh field="amount" label="Amount" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />}
                {cols.show('variation') && <SortableTh field="variationPct" label="Variation" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />}
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
                list.rows.map((g) => (
                  <tr
                    key={g.id}
                    onClick={() => navigate(`/grns/${g.id}`)}
                    className={`clickable ${g.toleranceBreached ? 'row-warn' : ''}`}
                  >
                    <td className="code">{g.grnNo}</td>
                    <td className="nowrap">{fmtDate(g.grnDate)}</td>
                    {cols.show('poId') && <td className="code">{g.purchaseOrder?.poId ?? '-'}</td>}
                    {cols.show('billNo') && <td>{g.billNo}</td>}
                    <td>{g.vendor?.vendorName ?? '-'}</td>
                    <td>
                      {g.item}
                      {g.inventoryItem && <div className="faint">{g.inventoryItem.itemCode}</div>}
                    </td>
                    {cols.show('uom') && <td>{g.uom}</td>}
                    <td className="num">{fmtNum(g.orderQty)}</td>
                    <td className="num">
                      <strong>{fmtNum(g.receivingQty)}</strong>
                    </td>
                    {cols.show('rate') && <td className="num">{fmtNum(g.inventoryRate, { decimals: 4 })}</td>}
                    {cols.show('amount') && <td className="num">{fmtMoney(g.amount)}</td>}
                    {cols.show('variation') && (
                      <td className="num">
                        {g.variationPctDisplay}%
                        {g.toleranceBreached && <div className="faint">over tolerance</div>}
                      </td>
                    )}
                    <td>
                      {g.posted ? (
                        <StatusBadge status="COMPLETED" />
                      ) : (
                        <span className="faint">not posted</span>
                      )}
                    </td>
                    <td />
                  </tr>
                ))}
            </tbody>

            {/* Totals for the whole filtered set, summed by the server. */}
            {totals && !list.loading && list.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={8} className="faint">
                    Totals for the filtered set
                  </td>
                  <td className="num">
                    <strong>{fmtNum(totals.receivingQty)}</strong>
                  </td>
                  <td />
                  <td className="num">
                    <strong>{fmtMoney(totals.amount)}</strong>
                  </td>
                  <td colSpan={2} />
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
