/**
 * Fabric rolls.
 *
 * Roll numbers are unique for the life of the system and are never reused, so
 * this list is also the answer to "where is FAB-014?" — which is the question
 * it actually gets asked.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
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
  Modal,
  PageHeader,
  Pagination,
  SortableTh,
  Spinner,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import { fmtEnum, fmtNum } from '../../utils/format.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

/**
 * Eligible for "Reverse opening balance", worked out from fields this list
 * already carries rather than a flag the server would otherwise add for this
 * one screen: no GRN behind it (the only other thing that creates a roll),
 * nothing issued since, not held. `reverse()` re-checks all of this itself
 * under a lock before it writes anything - this only decides what is worth
 * offering a checkbox for.
 */
function reversible(r) {
  return !r.grnId && !r.isHeld && Number(r.consumedQty) === 0;
}

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
  const { can } = useAuth();

  const cols = useOptionalColumns('rolls', COLUMNS);
  const canReverseOpeningBalance = can('FABRIC_ROLL.CREATE');

  const [selected, setSelected] = useState(() => new Set());
  const [reversing, setReversing] = useState(false);
  const [banner, setBanner] = useState(null);

  const list = useResourceList((params) => invApi.rolls(params), {
    defaultSort: 'rollNo',
    defaultDir: 'asc',
    initialFilters: {
      stage: '',
      location: '',
      inStockOnly: '',
    },
  });

  const eligibleRows = canReverseOpeningBalance ? list.rows.filter(reversible) : [];
  const allEligibleSelected = eligibleRows.length > 0 && eligibleRows.every((r) => selected.has(r.id));

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllEligible() {
    setSelected((prev) => {
      if (allEligibleSelected) {
        const next = new Set(prev);
        for (const r of eligibleRows) next.delete(r.id);
        return next;
      }
      return new Set([...prev, ...eligibleRows.map((r) => r.id)]);
    });
  }

  return (
    <>
      <PageHeader
        title="Fabric Rolls"
        actions={
          <>
            {canReverseOpeningBalance && selected.size > 0 && (
              <button type="button" className="btn btn-danger" onClick={() => setReversing(true)}>
                Reverse opening balance ({selected.size})
              </button>
            )}
            <ExportButton dataset="rolls" params={list.query} rowCount={list.meta.total} />
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
                {canReverseOpeningBalance && (
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      checked={allEligibleSelected}
                      onChange={toggleAllEligible}
                      disabled={eligibleRows.length === 0}
                      aria-label="Select all opening-balance rolls on this page"
                      title="Selects every roll on this page eligible for opening-balance reversal"
                    />
                  </th>
                )}
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
                  <td colSpan={cols.colSpan + (canReverseOpeningBalance ? 1 : 0)} className="loading-row">
                    <Spinner label="Loading rolls..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={cols.colSpan + (canReverseOpeningBalance ? 1 : 0)}>
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
                    {canReverseOpeningBalance && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleOne(r.id)}
                          disabled={!reversible(r)}
                          aria-label={`Select ${r.rollNo} for opening-balance reversal`}
                          title={reversible(r) ? undefined : 'Not an untouched opening-balance roll'}
                        />
                      </td>
                    )}
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

      {reversing && (
        <ReverseBatchDialog
          count={selected.size}
          onCancel={() => setReversing(false)}
          /*
           * Fires once the server has answered, whether every roll reversed
           * or only some did - a reversed roll is gone from this list and its
           * checkbox is gone with it either way, so the list and the
           * selection both have to catch up right away. The dialog itself
           * decides separately whether to stay open and show which rolls
           * could not be reversed.
           */
          onSettled={async (reversedIds) => {
            setSelected((prev) => {
              const next = new Set(prev);
              for (const id of reversedIds) next.delete(id);
              return next;
            });
            await list.reload();
          }}
          run={(reason) => invApi.reverseOpeningBalanceBatch({ rollIds: [...selected], reason })}
        />
      )}
    </>
  );
}

/**
 * One reason for the whole selection, one report back.
 *
 * Each roll in `rollIds` is reversed independently on the server - see
 * `reverseMany()` - so this dialog's job is only to show what happened to
 * each one, not to decide whether the batch as a whole succeeded. A batch
 * where thirty-eight reverse and two cannot (already issued against, say) is
 * a normal result here, not a failure.
 */
function ReverseBatchDialog({ count, onCancel, onSettled, run }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  async function go() {
    setBusy(true);
    setError('');
    try {
      const r = await run(reason);
      setReport(r);
      await onSettled(r.reversed.map((x) => x.rollId));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Reverse opening balance on ${count} roll(s)?`}
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {report ? 'Close' : 'Cancel'}
          </button>
          {!report && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={go}
              disabled={busy || !reason.trim()}
            >
              {busy ? 'Reversing...' : `Reverse ${count} roll(s)`}
            </button>
          )}
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>

        {!report && (
          <>
            <p style={{ marginTop: 0 }}>
              Each of these {count} rolls is taken back out and written off, independently - one
              already issued against, or held, is skipped and reported rather than stopping the
              rest. This cannot be undone.
            </p>
            <Field label="Reason" required hint="Why these rolls should not have been loaded.">
              <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </>
        )}

        {report && (
          <>
            <Alert kind={report.failed.length ? 'warning' : 'success'}>
              {report.reversed.length} of {count} reversed.
              {report.failed.length > 0 && ` ${report.failed.length} could not be.`}
            </Alert>
            {report.failed.length > 0 && (
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr><th>Roll</th><th>Reason</th></tr>
                  </thead>
                  <tbody>
                    {report.failed.map((f) => (
                      <tr key={f.rollId}>
                        <td className="code">{f.rollNo}</td>
                        <td className="muted">{f.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
