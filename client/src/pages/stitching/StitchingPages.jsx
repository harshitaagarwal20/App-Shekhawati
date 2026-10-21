/**
 * Stitching Record - what a unit stitched in a day.
 *
 * ---------------------------------------------------------------------------
 *  THE FIELDS, AND WHO FILLS THEM
 *
 *      Unit             AUTO from the supervisor's login; a dropdown for Admin
 *      Date             AUTO (today), may be moved back, never forward
 *      Order / Style    DROPDOWN - only what has been cut for this unit
 *      Deliverable Qty  AUTO from the approved stitching plan, editable
 *      Actual Stitched  MANUAL
 *      Remaining        AUTO = Deliverable - Actual (the server's figure)
 *
 *  The server refuses a count that takes the unit past the cut pieces issued
 *  to it. The form says so first, from the same figures, so the supervisor is
 *  told before pressing Save rather than after.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { stitching as api } from '../../services/erp.js';
import {
  Alert,
  CollapsibleField,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  SortableTh,
  Spinner,
  TextArea,
  TextInput,
  ViewTabs,
} from '../../components/ui.jsx';
import { Detail, DetailGrid } from '../shared/Detail.jsx';
import { fmtDate, fmtDateTime, fmtNum } from '../../utils/format.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import {
  OrderStylePicker,
  PositionBar,
  STITCHING_TABS,
  UnitPicker,
  orderLabel,
  useStitchingContext,
  useUnitOrders,
} from './stitchingShared.jsx';

const n0 = (v) => fmtNum(v, { decimals: 0 });

// ===========================================================================
//  LIST
// ===========================================================================

export function StitchingList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { ctx, error: ctxError } = useStitchingContext();

  const list = useResourceList((params) => api.list(params), {
    defaultSort: 'recordDate',
    defaultDir: 'desc',
    initialFilters: { unit: '', orderId: '', dateFrom: '', dateTo: '' },
  });

  const unit = ctx?.fixedUnit ?? list.filters.unit;
  const { orders, loading: ordersLoading, reload: reloadOrders } = useUnitOrders(unit);
  const [recording, setRecording] = useState(false);
  const canRecord = can('STITCHING_RECORD.CREATE') && ctx?.canWrite;
  const totals = list.meta?.totals;

  return (
    <>
      <PageHeader
        title="Stitching record"
        actions={
          <>
            <ExportButton dataset="stitching-records" params={list.query} rowCount={list.meta.total} />
            {canRecord && (
              <button type="button" className="btn btn-primary" onClick={() => setRecording(true)}>
                Record stitching
              </button>
            )}
          </>
        }
      />
      <ViewTabs active="stitching" tabs={STITCHING_TABS} />

      {ctxError && <Alert kind="error">{ctxError}</Alert>}

      <div className="filter-row">
        <UnitPicker ctx={ctx} value={list.filters.unit} onChange={(v) => list.setFilter('unit', v)} allowAll />
        <Field label="Order">
          <select
            value={list.filters.orderId}
            onChange={(e) => list.setFilter('orderId', e.target.value)}
            disabled={!unit}
          >
            <option value="">{unit ? 'All orders' : 'Choose a unit first'}</option>
            {[...new Map(orders.map((o) => [o.orderId, o])).values()].map((o) => (
              <option key={o.orderId} value={o.orderId}>{o.orderNo}</option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <TextInput type="date" value={list.filters.dateFrom} onChange={(e) => list.setFilter('dateFrom', e.target.value)} />
        </Field>
        <Field label="To">
          <TextInput type="date" value={list.filters.dateTo} onChange={(e) => list.setFilter('dateTo', e.target.value)} />
        </Field>
      </div>

      {unit && <UnitPositionCard unit={unit} orders={orders} loading={ordersLoading} />}

      {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
      {list.loading ? (
        <Spinner label="Loading stitching records" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title="No stitching recorded yet"
          message={canRecord ? 'Record what the unit stitched today with "Record stitching".' : 'Nothing matches these filters.'}
        />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="recordDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="unit" label="Unit" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Order</th>
                <th>Style</th>
                <SortableTh field="deliverableQty" label="Deliverable" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="actualStitched" label="Actual" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="remaining" label="Remaining" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/stitching/${r.id}`)}>
                  <td className="nowrap">{fmtDate(r.recordDate)}</td>
                  <td>{r.unit}</td>
                  <td>{r.order?.orderNo}</td>
                  <td className="code">{r.style?.styleNo}</td>
                  <td className="num">{n0(r.deliverableQty)}</td>
                  <td className="num"><strong>{n0(r.actualStitched)}</strong></td>
                  <td className={`num ${Number(r.remaining) > 0 ? 'text-danger' : ''}`}>{n0(r.remaining)}</td>
                  <td>{r.recordedByName}</td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  <td colSpan={4}><strong>All matching records</strong></td>
                  <td className="num"><strong>{n0(totals.deliverableQty)}</strong></td>
                  <td className="num"><strong>{n0(totals.actualStitched)}</strong></td>
                  <td className="num"><strong>{n0(totals.remaining)}</strong></td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </TableWrap>
      )}

      <Pagination meta={list.meta} page={list.page} pageSize={list.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />

      {recording && ctx && (
        <RecordModal
          ctx={ctx}
          initialUnit={unit}
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            list.reload();
            reloadOrders();
          }}
        />
      )}
    </>
  );
}

/** The unit's total stitched against its total cut pieces issued, per order. */
function UnitPositionCard({ unit, orders, loading }) {
  const issued = orders.reduce((a, o) => a + Number(o.pcsIssued), 0);
  const stitched = orders.reduce((a, o) => a + Number(o.pcsStitched), 0);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">{unit} - stitched against cut pieces issued</div>
      <div className="card-body">
        {loading ? (
          <Spinner label="Loading" />
        ) : orders.length === 0 ? (
          <p className="faint" style={{ margin: 0 }}>No cutting has been issued to this unit yet.</p>
        ) : (
          <>
            <PositionBar issued={issued} stitched={stitched} />
            <TableWrap>
              <table className="data compact">
                <thead>
                  <tr>
                    <th>Order / Style</th>
                    <th className="num">Cut pcs issued</th>
                    <th className="num">Stitched</th>
                    <th className="num">Left to stitch</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.key}>
                      <td>{orderLabel(o)}</td>
                      <td className="num">{n0(o.pcsIssued)}</td>
                      <td className="num">{n0(o.pcsStitched)}</td>
                      <td className="num"><strong>{n0(o.pcsBalance)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
//  DETAIL
// ===========================================================================

export function StitchingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { ctx } = useStitchingContext();

  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRow(await api.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !row) return <Spinner label="Loading stitching record..." />;
  if (!row) return <Alert kind="error">{banner?.text ?? 'Stitching record not found'}</Alert>;

  async function remove() {
    setBusy(true);
    try {
      await api.remove(row.id);
      navigate('/stitching');
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
      setBusy(false);
    }
  }

  const typedOver = row.deliverableFromPlan != null && Number(row.deliverableFromPlan) !== Number(row.deliverableQty);

  return (
    <>
      <PageHeader
        title={`Stitching - ${row.unit}, ${fmtDate(row.recordDate)}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/stitching')}>Back to list</button>
            {can('STITCHING_RECORD.DELETE') && (
              <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>Delete</button>
            )}
            {can('STITCHING_RECORD.EDIT') && ctx?.canWrite && (
              <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>Edit</button>
            )}
          </>
        }
      />

      {banner && <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>{banner.text}</Alert>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">The day</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Unit" value={row.unit} />
            <Detail label="Date" value={fmtDate(row.recordDate)} />
            <Detail
              label="Order No"
              value={row.order ? <Link to={`/orders/${row.order.id}`}>{row.order.orderNo}</Link> : '-'}
              sub={row.order?.buyer?.buyerName}
            />
            <Detail label="Style No" value={row.style?.styleNo} mono sub={row.style?.styleDescription} />
            <Detail
              label="Deliverable Qty"
              value={n0(row.deliverableQty)}
              sub={
                row.deliverableFromPlan == null
                  ? 'Typed - no approved plan line for the day'
                  : typedOver
                    ? `Typed over the plan's ${n0(row.deliverableFromPlan)}`
                    : 'From the stitching plan'
              }
            />
            <Detail label="Actual Stitched" value={<strong>{n0(row.actualStitched)}</strong>} />
            <Detail
              label="Remaining"
              value={n0(row.remaining)}
              sub={Number(row.remaining) < 0 ? 'Ahead of the day\'s target' : 'Deliverable - Actual'}
            />
            <Detail label="Recorded by" value={row.recordedByName} sub={fmtDateTime(row.updatedAt)} />
            {row.remarks && <Detail label="Remarks" value={row.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      {row.position && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">{row.unit} on {row.order?.orderNo} / {row.style?.styleNo}</div>
          <div className="card-body">
            <PositionBar issued={row.position.pcsIssued} stitched={row.position.pcsStitched} />
          </div>
        </div>
      )}

      {editing && ctx && (
        <RecordModal
          ctx={ctx}
          existing={row}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            setBanner({ kind: 'success', text: 'Stitching record updated.' });
            await load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this stitching record?"
          message="The day's count is removed from the unit's total. The audit trail keeps a record of it."
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onCancel={() => setDeleting(false)}
        />
      )}
    </>
  );
}

// ===========================================================================
//  THE FORM
// ===========================================================================

function RecordModal({ ctx, existing, initialUnit, onClose, onSaved }) {
  const [unit, setUnit] = useState(existing?.unit ?? ctx.fixedUnit ?? initialUnit ?? '');
  const [date, setDate] = useState(existing ? String(existing.recordDate).slice(0, 10) : ctx.today);
  const [choice, setChoice] = useState(
    existing ? { key: `${existing.orderId}:${existing.styleId}`, orderId: existing.orderId, styleId: existing.styleId } : null,
  );
  const { orders, loading: ordersLoading } = useUnitOrders(unit);

  const [day, setDay] = useState(null);
  const [dayError, setDayError] = useState('');
  const [editingId, setEditingId] = useState(existing?.id ?? null);
  const [deliverable, setDeliverable] = useState(existing ? String(Number(existing.deliverableQty)) : '');
  const [actual, setActual] = useState(existing ? String(Number(existing.actualStitched)) : '');
  const [remarks, setRemarks] = useState(existing?.remarks ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /*
   * The day's own figures, every time the unit, date or order changes. If the
   * day already has a record the form becomes an edit of it - a second row for
   * the same day is what the server refuses, and saying so here is kinder.
   */
  useEffect(() => {
    if (!unit || !date || !choice) {
      setDay(null);
      return;
    }
    let live = true;
    setDayError('');
    api
      .day({ unit, date, orderId: choice.orderId, styleId: choice.styleId })
      .then((d) => {
        if (!live) return;
        setDay(d);
        if (existing) return;
        if (d.existing) {
          setEditingId(d.existing.id);
          setDeliverable(String(Number(d.existing.deliverableQty)));
          setActual(String(Number(d.existing.actualStitched)));
          setRemarks(d.existing.remarks ?? '');
        } else {
          setEditingId(null);
          /*
           * PRE-FILLED, NOT GUESSED. Actual starts at the hourly grid's total
           * for the day when the tailors were logged, otherwise at everything
           * still in the unit for this order - the number the supervisor most
           * often types anyway. Deliverable falls back to the same when no plan
           * line sets a target. Both stay editable.
           */
          const left = Number(d.maxForThisRecord ?? 0);
          const fill = d.hourlyTotal != null && Number(d.hourlyTotal) > 0
            ? Math.min(Number(d.hourlyTotal), left)
            : left;
          setDeliverable(
            d.plannedDeliverable != null ? String(Number(d.plannedDeliverable)) : left > 0 ? String(left) : '',
          );
          setActual(fill > 0 ? String(fill) : '');
        }
      })
      .catch((e) => live && setDayError(e.message));
    return () => {
      live = false;
    };
  }, [unit, date, choice, existing]);

  const max = day ? Number(day.maxForThisRecord) : null;
  const overCeiling = max != null && actual !== '' && Number(actual) > max;
  const remaining = deliverable !== '' && actual !== '' ? Number(deliverable) - Number(actual) : null;
  const ready = unit && date && choice && actual !== '' && !overCeiling && !busy;

  async function save() {
    setBusy(true);
    setError('');
    try {
      const body = { deliverableQty: deliverable === '' ? '0' : deliverable, actualStitched: actual, remarks: remarks || null };
      if (editingId) await api.update(editingId, body);
      else {
        await api.create({
          ...body,
          unit: ctx.fixedUnit ? undefined : unit,
          recordDate: date,
          orderId: choice.orderId,
          styleId: choice.styleId,
          deliverableQty: deliverable === '' ? undefined : deliverable,
        });
      }
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const locked = Boolean(existing);

  return (
    <Modal
      title={existing ? 'Edit stitching record' : 'Record stitching'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={save}>
            {busy ? 'Saving…' : editingId ? 'Save changes' : 'Save'}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {dayError && <Alert kind="error">{dayError}</Alert>}
      {!existing && editingId && (
        <Alert kind="info">This day is already recorded for this order. You are editing it.</Alert>
      )}

      <div className="form-grid">
        {locked ? (
          <Field label="Unit"><div className="unit-fact">{unit}</div></Field>
        ) : (
          <UnitPicker ctx={ctx} value={unit} onChange={(v) => { setUnit(v); setChoice(null); }} required />
        )}

        <Field label="Date" required>
          <TextInput type="date" value={date} max={ctx.today} disabled={locked} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {locked ? (
          <Field label="Order No / Style No">
            <div className="unit-fact">{existing.order?.orderNo} · {existing.style?.styleNo}</div>
          </Field>
        ) : (
          <OrderStylePicker
            orders={orders}
            value={choice?.key ?? ''}
            onChange={setChoice}
            loading={ordersLoading}
            required
            placeholder={!unit ? 'Choose the unit first' : orders.length ? 'Choose the order' : 'Nothing cut for this unit yet'}
            hint="Only orders with cutting issued to this unit."
          />
        )}
      </div>

      {day && (
        <div className="stitch-facts">
          <PositionBar issued={day.pcsIssued} stitched={day.pcsStitched} />
          <p className="hint" style={{ margin: '4px 0 0' }}>
            This entry can be at most <strong>{n0(day.maxForThisRecord)}</strong> pieces.{' '}
            {Number(day.maxForThisRecord) > 0 && (
              <button type="button" className="btn btn-link" onClick={() => setActual(String(Number(day.maxForThisRecord)))}>
                Use all
              </button>
            )}
            {day.hourlyTotal != null && (
              <>
                {' '}The hourly grid adds up to <strong>{n0(day.hourlyTotal)}</strong> for this day.{' '}
                <button type="button" className="btn btn-link" onClick={() => setActual(String(Number(day.hourlyTotal)))}>
                  Use it
                </button>
              </>
            )}
          </p>
        </div>
      )}

      <div className="form-grid">
        <Field
          label="Deliverable Qty"
          hint={
            !day
              ? 'Filled in from the stitching plan once the order is chosen.'
              : day.plannedDeliverable != null
                ? `The plan asks ${n0(day.plannedDeliverable)} of this unit today. You may change it.`
                : 'No approved stitching plan line for this unit and day - type the target.'
          }
        >
          <TextInput type="number" inputMode="numeric" min="0" step="1" value={deliverable} onChange={(e) => setDeliverable(e.target.value)} />
        </Field>

        <Field label="Actual Stitched" required error={overCeiling ? `More than the ${n0(max)} pieces left for this unit` : undefined}>
          <TextInput
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={actual}
            error={overCeiling}
            onChange={(e) => setActual(e.target.value)}
            autoFocus={!existing}
          />
        </Field>

        <Field label="Remaining" hint="Deliverable - Actual. Worked out again by the server.">
          <div className={`unit-fact ${remaining != null && remaining > 0 ? 'text-danger' : ''}`}>
            {remaining == null ? '-' : n0(remaining)}
            {remaining != null && remaining < 0 && <span className="faint"> (ahead of target)</span>}
          </div>
        </Field>

        <CollapsibleField className="span-2">
          <Field label="Remarks">
            <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </CollapsibleField>
      </div>
    </Modal>
  );
}
