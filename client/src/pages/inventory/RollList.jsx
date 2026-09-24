/**
 * Fabric rolls.
 *
 * Roll numbers are unique for the life of the system and are never reused, so
 * this list is also the answer to "where is FAB-014?" — which is the question
 * it actually gets asked.
 */

import { useNavigate } from 'react-router-dom';
import { useResourceList } from '../../hooks/useResourceList.js';
import { useOptionalColumns } from '../../hooks/useOptionalColumns.js';
import { inventory as invApi } from '../../services/erp.js';
import {
  ColumnMenu,
  Alert,
  EmptyState,
  EnumSelect,
  Field,
  MasterSelect,
  PageHeader,
  Pagination,
  SortableTh,
  Spinner,
  TextInput,
} from '../../components/ui.jsx';
import { fmtEnum, fmtNum } from '../../utils/format.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const STAGES = [
  'RAW',
  'ISSUED_FOR_DYEING',
  'ISSUED_FOR_PRINTING',
  'DYED',
  'PRINTED',
  'SCRUTINY_HOLD',
  'ISSUED_TO_CUTTING',
  'CONSUMED',
  'REJECTED',
].map((v) => ({ value: v, label: fmtEnum(v) }));

/** Stages where the roll is not usable, so the row reads as unavailable. */
const HELD_STAGES = new Set(['SCRUTINY_HOLD', 'REJECTED']);

/**
 * What this register can show, and what it shows unasked.
 *
 * The store opens Fabric Rolls to find a roll and see how much of it is left,
 * where it is, and whether it is free to use. The cloth specification (GSM,
 * count, unit) and the paper trail behind the roll (GRN, PO, order) matter
 * when you are checking one roll, not when you are scanning for it - so they
 * are one click away in the column menu, and stay on once turned on.
 */
const COLUMNS = [
  { key: 'rollNo', label: 'Roll No' },
  { key: 'fabric', label: 'Fabric' },
  { key: 'colour', label: 'Colour' },
  { key: 'shade', label: 'Shade / Lot', optional: true },
  { key: 'gsm', label: 'GSM', optional: true },
  { key: 'count', label: 'Count', optional: true },
  { key: 'uom', label: 'UOM', optional: true },
  { key: 'received', label: 'Received' },
  { key: 'balance', label: 'Balance' },
  { key: 'stage', label: 'Stage' },
  { key: 'location', label: 'Location' },
  { key: 'grn', label: 'GRN', optional: true },
  { key: 'po', label: 'PO', optional: true },
  { key: 'order', label: 'Order', optional: true },
];

export default function RollList() {
  const navigate = useNavigate();

  const cols = useOptionalColumns('rolls', COLUMNS);

  const list = useResourceList((params) => invApi.rolls(params), {
    defaultSort: 'rollNo',
    defaultDir: 'asc',
    initialFilters: {
      stage: '',
      location: '',
      inStockOnly: '',
    },
  });

  return (
    <>
      <PageHeader
        title="Fabric Rolls"
        actions={
          <ExportButton dataset="rolls" params={list.query} rowCount={list.meta.total} />
        }
      />

      {list.error && <Alert kind="error">{list.error.message}</Alert>}

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor="roll-search">
              <TextInput
                id="roll-search"
                type="search"
                placeholder="Search roll no, fabric, colour, shade, lot..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Stage" htmlFor="roll-f-stage">
            <EnumSelect
              id="roll-f-stage"
              options={STAGES}
              placeholder="All stages"
              value={list.filters.stage ?? ''}
              onChange={(e) => list.setFilter('stage', e.target.value)}
            />
          </Field>

          <Field label="Location" htmlFor="roll-f-loc">
            <MasterSelect
              id="roll-f-loc"
              listCode="StockLocation"
              placeholder="All"
              value={list.filters.location ?? ''}
              onChange={(e) => list.setFilter('location', e.target.value)}
            />
          </Field>

          <div className="field">
            <label htmlFor="roll-f-stock">Show</label>
            <EnumSelect
              id="roll-f-stock"
              options={[{ value: 'true', label: 'With balance only' }]}
              placeholder="All rolls"
              value={list.filters.inStockOnly ?? ''}
              onChange={(e) => list.setFilter('inStockOnly', e.target.value)}
            />
          </div>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="rollNo" label="Roll No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Fabric</th>
                <th>Colour</th>
                {cols.show('shade') && <th>Shade / Lot</th>}
                {cols.show('gsm') && <th>GSM</th>}
                {cols.show('count') && <th>Count</th>}
                {cols.show('uom') && <th>UOM</th>}
                <SortableTh field="receivedQty" label="Received" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <SortableTh field="balanceQty" label="Balance" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <SortableTh field="stage" label="Stage" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Location</th>
                {cols.show('grn') && <th>GRN</th>}
                {cols.show('po') && <th>PO</th>}
                {cols.show('order') && <th>Order</th>}
                <ColumnMenu {...cols} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={cols.colSpan} className="loading-row">
                    <Spinner label="Loading rolls..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={cols.colSpan}>
                    <EmptyState
                      title="No rolls found"
                      message="Rolls are created when a fabric GRN is posted."
                    />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/inventory/rolls/${r.id}`)}
                    className={`clickable ${r.isHeld || HELD_STAGES.has(r.stage) ? 'row-bad' : ''}`}
                  >
                    <td className="code">
                      {r.rollNo}
                      {r.isHeld && <div className="faint">held</div>}
                    </td>
                    <td>
                      {r.fabricName ?? '-'}
                      {r.inventoryItem && <div className="faint">{r.inventoryItem.itemCode}</div>}
                    </td>
                    <td>{r.colorCode ?? '-'}</td>
                    {cols.show('shade') && (
                      <td className="code">
                        {r.shade ?? '-'}
                        {r.dyeLot && <div className="faint">{r.dyeLot}</div>}
                      </td>
                    )}
                    {cols.show('gsm') && <td>{r.gsm ?? '-'}</td>}
                    {cols.show('count') && <td>{r.count ?? '-'}</td>}
                    {cols.show('uom') && <td>{r.uom}</td>}
                    <td className="num">{fmtNum(r.receivedQty)}</td>
                    <td className="num">
                      <strong>{fmtNum(r.balanceQty)}</strong>
                      {Number(r.consumedQty) > 0 && (
                        <div className="faint">{fmtNum(r.consumedQty)} used</div>
                      )}
                    </td>
                    <td>{fmtEnum(r.stage)}</td>
                    <td>{r.location ?? '-'}</td>
                    {cols.show('grn') && <td className="code">{r.grn?.grnNo ?? '-'}</td>}
                    {cols.show('po') && <td className="code">{r.poId ?? '-'}</td>}
                    {cols.show('order') && <td className="code">{r.orderNo ?? '-'}</td>}
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
    </>
  );
}
