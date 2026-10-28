/**
 * Dispatch - one order going out.
 *
 * ---------------------------------------------------------------------------
 *  THE FIELDS, AND WHO FILLS THEM
 *
 *      Dispatch No                  AUTO
 *      Date                         AUTO - today, may be moved back
 *      Order No                     DROPDOWN
 *      Buyer                        FORMULA - from the order
 *      Container No                 FORMULA - from the order's plan (Planning)
 *      Invoice No                   MANUAL
 *      Total Boxes / Total Qty      AUTO - from packing
 *      Ship Mode                    DROPDOWN - the order's, unless changed
 *      Carrier / AWB-BL No          MANUAL
 *      ETA                          MANUAL
 *      Status                       DROPDOWN - Pending / Dispatched / Delivered
 *      Remarks                      TEXT
 *
 *  And the buyer's shipment details and address, from the buyer and the
 *  order. The boxes are the packing lines ticked for it - all of them to
 *  begin with - so what is packed can go in more than one container; once
 *  Dispatched it keeps what left. Dispatched and Delivered set the order
 *  Partially Shipped or Shipped. Prints: dispatch note, packing list.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { dispatches as api } from '../../services/erp.js';
import {
  Alert,
  ConfirmDialog,
  EmptyState,
  Field,
  MasterSelect,
  PageHeader,
  Pagination,
  RecordSelect,
  SortableTh,
  Spinner,
  StatusBadge,
  TextArea,
  TextInput,
  ClearFilters,
} from '../../components/ui.jsx';
import { Detail, DetailGrid } from '../shared/Detail.jsx';
import { fmtDate, fmtDateTime, fmtNum, fmtOrder, todayInput } from '../../utils/format.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import DateRangeFilter from '../../components/DateRangeFilter.jsx';

const n0 = (v) => fmtNum(v, { decimals: 0 });

export const DISPATCH_PRINTS = [
  { kind: 'dispatch-note', label: 'Dispatch note' },
  { kind: 'packing-list', label: 'Packing list' },
];

const STATUSES = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'DELIVERED', label: 'Delivered' },
];

const orderLabel = (o) => `${fmtOrder(o)} - ${n0(o.pcsReady)} pcs ready`;

/** The buyer's shipment details and address, as one block. */
function ShipmentDetails({ d }) {
  return (
    <DetailGrid>
      <Detail label="Buyer" value={d.buyerName} />
      <Detail label="Buyer PO" value={d.buyerPoNo} />
      <Detail label="Buyer address" value={d.buyerAddress} className="span-2" />
      <Detail label="Ship to" value={d.shipTo} className="span-2" />
      <Detail label="Consignee" value={d.consigneeName} sub={d.consigneeAddress} className="span-2" />
      <Detail label="Notify party" value={d.notifyPartyName} sub={d.notifyPartyAddress} className="span-2" />
      <Detail label="Port of discharge" value={d.portOfDischarge} />
      <Detail label="Final destination" value={d.finalDestination} />
      <Detail label="Price terms" value={d.priceTerms} />
      <Detail label="Freight terms" value={d.freightTerms} />
    </DetailGrid>
  );
}

// ===========================================================================
//  LIST
// ===========================================================================

export function DispatchList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [orders, setOrders] = useState([]);
  const list = useResourceList((params) => api.list(params), {
    defaultSort: 'dispatchDate',
    defaultDir: 'desc',
    initialFilters: { orderId: '', status: '', dateFrom: '', dateTo: '' },
  });
  useEffect(() => {
    api.orders().then(setOrders).catch(() => setOrders([]));
  }, []);
  const ready = orders.filter((o) => Number(o.pcsReady) > 0);
  const totals = list.meta?.totals;
  const sortProps = { sortBy: list.sortBy, sortDir: list.sortDir, onSort: list.toggleSort };

  return (
    <>
      <PageHeader
        title="Dispatch"
        actions={
          <>
            <ExportButton dataset="dispatches" params={list.query} rowCount={list.meta.total} />
            {can('DISPATCH.CREATE') && <button type="button" className="btn btn-primary" onClick={() => navigate('/dispatches/new')}>New dispatch</button>}
          </>
        }
      />

      {ready.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Packed and ready to go</div>
          <div className="card-body">
            <TableWrap>
              <table className="data">
                <thead>
                  <tr><th>Order</th><th>Buyer</th><th className="num">Packed</th><th className="num">Ready pcs</th><th className="num">Ready boxes</th><th /></tr>
                </thead>
                <tbody>
                  {ready.map((o) => (
                    <tr key={o.orderId}>
                      <td>{o.orderNo}</td>
                      <td>{o.buyerName}</td>
                      <td className="num">{n0(o.pcsPacked)}</td>
                      <td className="num"><strong>{n0(o.pcsReady)}</strong></td>
                      <td className="num">{n0(o.boxesReady)}</td>
                      <td className="num">
                        {can('DISPATCH.CREATE') && (
                          <button type="button" className="btn btn-sm" onClick={() => navigate(`/dispatches/new?order=${o.orderId}`)}>Dispatch</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        </div>
      )}

      <div className="filter-row">
        <Field label="Order">
          <select value={list.filters.orderId} onChange={(e) => list.setFilter('orderId', e.target.value)}>
            <option value="">All orders</option>
            {orders.map((o) => <option key={o.orderId} value={o.orderId}>{fmtOrder(o)}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
            <option value="">Every status</option>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <DateRangeFilter filters={list.filters} setFilter={list.setFilter} fromLabel="From" toLabel="To" />
        <ClearFilters list={list} />
      </div>

      {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
      {list.loading ? (
        <Spinner label="Loading dispatches" />
      ) : list.rows.length === 0 ? (
        <EmptyState title="Nothing dispatched yet" message="An order can be dispatched once it has packed pieces." />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="dispatchDate" label="Date" {...sortProps} />
                <SortableTh field="dispatchNo" label="Dispatch No" {...sortProps} />
                <th>Order No</th>
                <th>Buyer</th>
                <SortableTh field="containerNo" label="Container No" {...sortProps} />
                <th>Invoice No</th>
                <th className="num">Total boxes</th>
                <th className="num">Total qty</th>
                <th>Ship mode</th>
                <th>Carrier / AWB-BL No</th>
                <SortableTh field="eta" label="ETA" {...sortProps} />
                <SortableTh field="status" label="Status" {...sortProps} />
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/dispatches/${r.id}`)}>
                  <td className="nowrap">{fmtDate(r.dispatchDate)}</td>
                  <td className="code">{r.dispatchNo}</td>
                  <td>{r.order?.orderNo}</td>
                  <td>{r.buyerName}</td>
                  <td className="code">{r.containerNo}</td>
                  <td>{r.invoiceNo}</td>
                  <td className="num">{n0(r.totalBoxes)}</td>
                  <td className="num"><strong>{n0(r.totalPcs)}</strong></td>
                  <td>{r.shipMode}</td>
                  <td>{r.carrierRef}</td>
                  <td className="nowrap">{r.eta ? fmtDate(r.eta) : ''}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{r.remarks}</td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  <td colSpan={6}><strong>All matching dispatches</strong></td>
                  <td className="num"><strong>{n0(totals.totalBoxes)}</strong></td>
                  <td className="num"><strong>{n0(totals.totalPcs)}</strong></td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            )}
          </table>
        </TableWrap>
      )}
      <Pagination meta={list.meta} page={list.page} pageSize={list.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />
    </>
  );
}

// ===========================================================================
//  FORM
// ===========================================================================

export function DispatchForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [existing, setExisting] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({
    orderId: new URLSearchParams(window.location.search).get('order') ?? '',
    dispatchDate: todayInput(),
    invoiceNo: '',
    shipMode: '',
    carrierRef: '',
    eta: '',
    status: 'PENDING',
    remarks: '',
  });
  const [shipModeTyped, setShipModeTyped] = useState(editing);
  // The packing lines ticked, for the order they were ticked on.
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    api.orders().then(setOrders).catch(() => setOrders([]));
    if (!editing) return;
    api.get(id)
      .then((d) => {
        setExisting(d);
        setForm({
          orderId: d.orderId,
          dispatchDate: String(d.dispatchDate).slice(0, 10),
          invoiceNo: d.invoiceNo ?? '',
          shipMode: d.shipMode ?? '',
          carrierRef: d.carrierRef ?? '',
          eta: d.eta ? String(d.eta).slice(0, 10) : '',
          status: d.status,
          remarks: d.remarks ?? '',
        });
      })
      .catch((e) => setError(e.message));
  }, [id, editing]);

  useEffect(() => {
    if (!form.orderId) {
      setPreview(null);
      return;
    }
    api.preview({ orderId: form.orderId, ...(editing ? { excluding: id } : {}) })
      .then((p) => {
        setPreview(p);
        setPicked((cur) => (cur?.orderId === form.orderId
          ? cur
          : { orderId: form.orderId, ids: new Set(p.available.filter((a) => !editing || a.onThis).map((a) => a.id)) }));
        if (!shipModeTyped) set({ shipMode: p.shipMode ?? '' });
      })
      .catch((e) => setError(e.message));
  }, [form.orderId, editing, id, shipModeTyped]);

  // A dispatch that has left keeps what it carried; a Pending one carries the boxes ticked.
  const frozen = editing && existing && existing.status !== 'PENDING' && form.status !== 'PENDING';
  const shown = frozen ? existing : preview;
  const available = preview?.available ?? [];
  const chosen = available.filter((a) => picked?.ids.has(a.id));
  const allChosen = available.length > 0 && chosen.length === available.length;
  const totalBoxes = frozen ? existing.totalBoxes : chosen.reduce((s, a) => s + a.boxesPacked, 0);
  const totalPcs = frozen ? existing.totalPcs : chosen.reduce((s, a) => s + Number(a.pcsPacked), 0);
  const nothing = !frozen && preview && available.length === 0;
  const etaEarly = form.eta && form.dispatchDate && form.eta < form.dispatchDate;
  const ready = form.orderId && shown && !nothing && (frozen || chosen.length > 0) && !etaEarly && !busy;

  const pick = (ids, on) => setPicked((cur) => {
    const next = new Set(cur?.ids);
    for (const i of ids) {
      if (on) next.add(i);
      else next.delete(i);
    }
    return { ...cur, ids: next };
  });

  async function save() {
    setBusy(true);
    setError('');
    const body = {
      dispatchDate: form.dispatchDate,
      invoiceNo: form.invoiceNo || null,
      shipMode: form.shipMode || null,
      carrierRef: form.carrierRef || null,
      eta: form.eta || null,
      status: form.status,
      remarks: form.remarks || null,
      ...(frozen ? {} : { packingEntryIds: chosen.map((a) => a.id) }),
    };
    try {
      const saved = editing ? await api.update(id, body) : await api.create({ ...body, orderId: form.orderId });
      navigate(`/dispatches/${saved.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (editing && !existing && !error) return <Spinner label="Loading..." />;

  return (
    <>
      <PageHeader
        title={editing ? `Edit ${existing?.dispatchNo ?? 'dispatch'}` : 'New dispatch'}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate(editing ? `/dispatches/${id}` : '/dispatches')}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!ready} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </>
        }
      />
      {error && <Alert kind="error">{error}</Alert>}
      {nothing && <Alert kind="warning">Nothing of this order is packed and waiting to be dispatched.</Alert>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Dispatch</div>
        <div className="card-body">
          <div className="form-grid four">
            <Field label="Date" required>
              <TextInput type="date" value={form.dispatchDate} max={todayInput()} onChange={(e) => set({ dispatchDate: e.target.value })} />
            </Field>
            {editing ? (
              <Field label="Order No"><div className="unit-fact">{existing?.order?.orderNo}</div></Field>
            ) : (
              <Field label="Order No" required>
                <RecordSelect
                  value={form.orderId}
                  onChange={(e) => set({ orderId: e.target.value })}
                  options={orders.filter((o) => Number(o.pcsReady) > 0 || o.orderId === form.orderId)}
                  getValue={(o) => o.orderId}
                  getLabel={orderLabel}
                  placeholder="Choose the order"
                />
              </Field>
            )}
            <Field label="Buyer" hint="From the order."><div className="unit-fact">{shown?.buyerName ?? '-'}</div></Field>
            <Field label="Container No" hint="From the order's plan.">
              <div className="unit-fact code">{shown ? (shown.containerNo || <span className="faint">not planned</span>) : '-'}</div>
            </Field>
            <Field label="Invoice No">
              <TextInput value={form.invoiceNo} maxLength={60} onChange={(e) => set({ invoiceNo: e.target.value })} />
            </Field>
            <Field label="Total boxes" hint={frozen ? 'As it left.' : 'From the boxes ticked.'}><div className="unit-fact">{shown ? n0(totalBoxes) : '-'}</div></Field>
            <Field label="Total qty" hint={frozen ? 'As it left.' : 'From the boxes ticked.'}><div className="unit-fact"><strong>{shown ? n0(totalPcs) : '-'}</strong></div></Field>
            <Field label="Ship mode">
              <MasterSelect listCode="ShipMode" value={form.shipMode} currentValue={form.shipMode} onChange={(e) => { setShipModeTyped(true); set({ shipMode: e.target.value }); }} />
            </Field>
            <Field label="Carrier / AWB-BL No">
              <TextInput value={form.carrierRef} maxLength={120} onChange={(e) => set({ carrierRef: e.target.value })} />
            </Field>
            <Field label="ETA" error={etaEarly ? 'Before the dispatch date.' : undefined}>
              <TextInput type="date" value={form.eta} onChange={(e) => set({ eta: e.target.value })} />
            </Field>
            <Field label="Status" required>
              <select value={form.status} onChange={(e) => set({ status: e.target.value })}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Remarks">
            <TextArea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          </Field>
        </div>
      </div>

      {shown && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">Buyer's shipment details and address</div>
            <div className="card-body"><ShipmentDetails d={shown} /></div>
          </div>
          {frozen ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">What goes, style by style</div>
              <div className="card-body">
                <TableWrap>
                  <table className="data">
                    <thead><tr><th>Style</th><th>Name</th><th className="num">Boxes</th><th className="num">Pcs</th></tr></thead>
                    <tbody>
                      {(shown.lines ?? []).map((l) => (
                        <tr key={l.styleId}>
                          <td className="code">{l.styleNo ?? l.style?.styleNo}</td>
                          <td>{l.styleDescription ?? l.style?.styleDescription}</td>
                          <td className="num">{n0(l.boxes)}</td>
                          <td className="num"><strong>{n0(l.pcs)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </div>
            </div>
          ) : available.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">Boxes on this dispatch</div>
              <div className="card-body">
                <TableWrap>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            aria-label="All boxes"
                            checked={allChosen}
                            onChange={(e) => pick(available.map((a) => a.id), e.target.checked)}
                          />
                        </th>
                        <th>Box No</th>
                        <th>Style</th>
                        <th>Color</th>
                        <th className="num">Packing</th>
                        <th className="num">Boxes</th>
                        <th className="num">Qty</th>
                        <th>Packed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {available.map((a) => (
                        <tr key={a.id} className="clickable" onClick={() => pick([a.id], !picked?.ids.has(a.id))}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Boxes ${a.boxNo}`}
                              checked={Boolean(picked?.ids.has(a.id))}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => pick([a.id], e.target.checked)}
                            />
                          </td>
                          <td className="code">{a.boxNo}</td>
                          <td className="code">{a.styleNo}</td>
                          <td>{a.colorCode}</td>
                          <td className="num">{n0(a.pcsPerBox)}</td>
                          <td className="num">{n0(a.boxesPacked)}</td>
                          <td className="num"><strong>{n0(a.pcsPacked)}</strong></td>
                          <td className="nowrap">{fmtDate(a.packDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5}><strong>{n0(chosen.length)} of {n0(available.length)} lines</strong></td>
                        <td className="num"><strong>{n0(totalBoxes)}</strong></td>
                        <td className="num"><strong>{n0(totalPcs)}</strong></td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </TableWrap>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ===========================================================================
//  DETAIL
// ===========================================================================

export function DispatchDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [row, setRow] = useState(null);
  const [banner, setBanner] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRow(await api.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!row) return banner ? <Alert kind="error">{banner.text}</Alert> : <Spinner label="Loading..." />;

  async function remove() {
    setBusy(true);
    try {
      await api.remove(row.id);
      navigate('/dispatches');
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`${row.dispatchNo} - ${row.order?.orderNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/dispatches')}>Back to list</button>
            {can('DISPATCH.DELETE') && <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>Delete</button>}
            {can('DISPATCH.EDIT') && <button type="button" className="btn" onClick={() => navigate(`/dispatches/${row.id}/edit`)}>Edit</button>}
          </>
        }
      />
      {banner && <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>{banner.text}</Alert>}

      {can('DISPATCH.EXPORT') && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Prints</div>
          <div className="card-body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {DISPATCH_PRINTS.map((p) => (
              <button key={p.kind} type="button" className="btn" onClick={() => navigate(`/print/${p.kind}/${row.id}`)}>{p.label}</button>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">The dispatch</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Dispatch No" value={row.dispatchNo} mono />
            <Detail label="Date" value={fmtDate(row.dispatchDate)} />
            <Detail label="Order No" value={<Link to={`/orders/${row.orderId}`}>{row.order?.orderNo}</Link>} />
            <Detail label="Order status" value={<StatusBadge status={row.order?.status} />} />
            <Detail label="Container No" value={row.containerNo} mono />
            <Detail label="Invoice No" value={row.invoiceNo} />
            <Detail label="Total boxes" value={n0(row.totalBoxes)} />
            <Detail label="Total qty" value={<strong>{n0(row.totalPcs)}</strong>} />
            <Detail label="Ship mode" value={row.shipMode} />
            <Detail label="Carrier / AWB-BL No" value={row.carrierRef} />
            <Detail label="ETA" value={row.eta ? fmtDate(row.eta) : null} />
            <Detail label="Status" value={<StatusBadge status={row.status} />} />
            <Detail label="Recorded by" value={row.recordedByName} sub={fmtDateTime(row.createdAt)} />
            {row.remarks && <Detail label="Remarks" value={row.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Buyer's shipment details and address</div>
        <div className="card-body"><ShipmentDetails d={row} /></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">What went, style by style</div>
        <div className="card-body">
          <TableWrap>
            <table className="data">
              <thead><tr><th>Style</th><th>Name</th><th className="num">Boxes</th><th className="num">Pcs</th></tr></thead>
              <tbody>
                {row.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="code">{l.style?.styleNo}</td>
                    <td>{l.style?.styleDescription}</td>
                    <td className="num">{n0(l.boxes)}</td>
                    <td className="num"><strong>{n0(l.pcs)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete this dispatch?"
          message="Its pieces go back to packed and waiting, and the order's status is worked out again from what is left. The audit trail keeps a record."
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
