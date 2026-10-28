/**
 * Printing after stitching - stitched pieces out to a printer and back.
 *
 * Used only for a style printed AFTER it is stitched. It is the workbook's
 * Printing sheet at Fabric Stage "After Stitching", with Pcs Received Back
 * beside Pcs Sent. Pieces sent and not yet back are out of the factory, held
 * against the unit they left: ironing cannot receive them from that unit until
 * they are back.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { stitching, vendors as vendorsApi } from '../../services/erp.js';
import {
  Alert,
  CollapsibleField,
  ConfirmDialog,
  EmptyState,
  Field,
  MasterSelect,
  Modal,
  PageHeader,
  Pagination,
  RecordSelect,
  SortableTh,
  Spinner,
  StatusBadge,
  TextArea,
  TextInput,
  ViewTabs,
  ClearFilters,
} from '../../components/ui.jsx';
import { Detail, DetailGrid } from '../shared/Detail.jsx';
import { fmtDate, fmtNum, fmtVendor, toDateInput, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { STITCHING_TABS, orderLabel } from './stitchingShared.jsx';
import DateRangeFilter from '../../components/DateRangeFilter.jsx';

const api = stitching.printings;
const n0 = (v) => fmtNum(v, { decimals: 0 });

export function PrintingList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const list = useResourceList((params) => api.list(params), {
    defaultSort: 'printingDate',
    defaultDir: 'desc',
    initialFilters: { openOnly: '', dateFrom: '', dateTo: '' },
  });
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Printing after stitching"
        actions={
          <>
            <ExportButton dataset="printing-after-stitching" params={list.query} rowCount={list.meta.total} />
            {can('PRINTING.CREATE') && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                Send for printing
              </button>
            )}
          </>
        }
      />
      <ViewTabs active="printing" tabs={STITCHING_TABS} />

      <div className="filter-row">
        <div className="grow">
          <Field label="Search">
            <TextInput value={list.search} onChange={(e) => list.setSearch(e.target.value)} placeholder="Number, order, style, vendor" />
          </Field>
        </div>
        <Field label="Show">
          <select value={list.filters.openOnly} onChange={(e) => list.setFilter('openOnly', e.target.value)}>
            <option value="">Everything</option>
            <option value="true">Still out (not all back)</option>
          </select>
        </Field>
        <DateRangeFilter filters={list.filters} setFilter={list.setFilter} />
        <ClearFilters list={list} />
      </div>

      <p className="hint" style={{ marginTop: 0 }}>
        Optional. Use this only when a style is printed after it is stitched.
      </p>

      {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
      {list.loading ? (
        <Spinner label="Loading" />
      ) : list.rows.length === 0 ? (
        <EmptyState title="Nothing sent for printing after stitching" message="Only styles printed after stitching are recorded here." />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="printingNo" label="No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="printingDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Order</th>
                <th>Style</th>
                <th>From unit</th>
                <th>Vendor</th>
                <SortableTh field="qty" label="Pcs sent" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="qtyReceived" label="Received back" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th className="num">Still out</th>
                <th>UOM</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/stitching/printing/${r.id}`)}>
                  <td className="code">{r.printingNo}</td>
                  <td className="nowrap">{fmtDate(r.printingDate)}</td>
                  <td>{r.order?.orderNo}</td>
                  <td className="code">{r.style?.styleNo}</td>
                  <td>{r.fromUnit ?? <span className="faint">not given</span>}</td>
                  <td>{r.vendor?.vendorName}</td>
                  <td className="num">{n0(r.qty)}</td>
                  <td className="num">{n0(r.qtyReceived)}</td>
                  <td className="num"><strong>{n0(r.qtyOut)}</strong></td>
                  <td>{r.uom}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <Pagination meta={list.meta} page={list.page} pageSize={list.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />

      {creating && (
        <PrintingModal
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            navigate(`/stitching/printing/${saved.id}`);
          }}
        />
      )}
    </>
  );
}

export function PrintingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [row, setRow] = useState(null);
  const [banner, setBanner] = useState(null);
  const [editing, setEditing] = useState(false);
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
      navigate('/stitching/printing');
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`Printing after stitching ${row.printingNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/stitching/printing')}>Back to list</button>
            {can('PRINTING.DELETE') && <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>Delete</button>}
            {can('PRINTING.EDIT') && (
              <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
                {Number(row.qtyOut) > 0 ? 'Record pieces back' : 'Edit'}
              </button>
            )}
          </>
        }
      />
      {banner && <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>{banner.text}</Alert>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Sent for printing</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="No" value={row.printingNo} mono />
            <Detail label="Date" value={fmtDate(row.printingDate)} />
            <Detail label="Order" value={row.order ? <Link to={`/orders/${row.order.id}`}>{row.order.orderNo}</Link> : '-'} sub={row.order?.buyer?.buyerName} />
            <Detail label="Style" value={row.style?.styleNo} mono />
            <Detail label="From unit" value={row.fromUnit ?? 'Not given - an older entry'} />
            <Detail label="Vendor" value={row.vendor?.vendorName} />
            <Detail label="UOM" value={row.uom} />
            <Detail label="Pcs sent" value={n0(row.qty)} />
            <Detail label="Pcs received back" value={n0(row.qtyReceived)} sub={row.receivedDate ? `last on ${fmtDate(row.receivedDate)}` : null} />
            <Detail label="Still out" value={<strong>{n0(row.qtyOut)}</strong>} />
            <Detail label="Status" value={<StatusBadge status={row.status} />} />
            {row.remarks && <Detail label="Remarks" value={row.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      {row.summary && <SummaryCard summary={row.summary} title={`${row.fromUnit} on ${row.order?.orderNo} / ${row.style?.styleNo}`} />}

      {editing && (
        <PrintingModal
          existing={row}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            setBanner({ kind: 'success', text: `${row.printingNo} updated.` });
            await load();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${row.printingNo}?`}
          message="The pieces stop counting as out for printing. The audit trail keeps a record of it."
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

function SummaryCard({ summary, title }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">{title}</div>
      <div className="card-body">
        <DetailGrid>
          <Detail label="Stitched" value={n0(summary.pcsStitched)} showEmpty />
          <Detail label="Out for printing" value={n0(summary.pcsOutForPrinting)} sub={`${n0(summary.pcsSentForPrinting)} sent, ${n0(summary.pcsReceivedBack)} back`} showEmpty />
          <Detail label="Gone to ironing" value={n0(summary.pcsReceivedAtIroning)} showEmpty />
          <Detail label="Still at the unit" value={<strong>{n0(Math.max(0, Number(summary.pcsAvailable)))}</strong>} showEmpty />
          <Detail label="Can still be sent" value={n0(summary.pcsPrintableNow)} showEmpty />
        </DetailGrid>
      </div>
    </div>
  );
}

function PrintingModal({ existing, onClose, onSaved }) {
  const editing = Boolean(existing);
  const [orders, setOrders] = useState([]);
  const [units, setUnits] = useState([]);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [form, setForm] = useState(() => ({
    printingDate: existing ? toDateInput(existing.printingDate) : todayInput(),
    key: existing ? `${existing.orderId}:${existing.styleId}` : '',
    vendorId: existing?.vendorId ?? '',
    qty: existing ? String(Number(existing.qty)) : '',
    qtyReceived: existing ? String(Number(existing.qtyReceived)) : '',
    uom: existing?.uom ?? 'Pcs',
    remarks: existing?.remarks ?? '',
    // Only asked for on an older entry that never named its unit.
    fromUnit: '',
  }));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const [summary, setSummary] = useState(existing?.summary ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const needsUnit = editing && !existing.fromUnit;
  useEffect(() => {
    if (!editing) api.orders().then(setOrders).catch(loadFailed(setOrders, 'orders'));
    if (needsUnit) stitching.context().then((c) => setUnits(c.units)).catch(() => setUnits([]));
    vendorsApi.options({ category: 'Printing' }).then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
  }, [editing, needsUnit]);

  const choice = orders.find((o) => o.key === form.key);
  const legacyUnit = editing && !existing.fromUnit ? form.fromUnit : null;
  useEffect(() => {
    const q = !editing && choice
      ? { orderId: choice.orderId, styleId: choice.styleId, unit: choice.unit }
      : legacyUnit
        ? { orderId: existing.orderId, styleId: existing.styleId, unit: legacyUnit }
        : null;
    if (!q) return;
    api.summary(q).then(setSummary).catch(() => setSummary(null));
  }, [editing, choice, legacyUnit, existing]);

  // What may go out: on an edit, this row's own pieces are back in the pool -
  // unless it is an older row only now being given its unit.
  const ownOut = editing && existing.fromUnit ? Number(existing.qty) - Number(existing.qtyReceived) : 0;
  const room = summary ? Number(summary.pcsPrintableNow) + ownOut : null;
  // Out is sent less already back; it is the out part that needs room.
  const tooMany = room != null && form.qty !== '' && Number(form.qty) - Number(form.qtyReceived || 0) > room;
  const backTooMany = form.qtyReceived !== '' && Number(form.qtyReceived) > Number(form.qty || 0);
  const ready = (editing || choice) && form.vendorId && Number(form.qty) > 0 && !tooMany && !backTooMany && !busy;

  async function save() {
    setBusy(true);
    setError('');
    const body = {
      printingDate: form.printingDate,
      vendorId: form.vendorId,
      qty: form.qty,
      qtyReceived: form.qtyReceived === '' ? '0' : form.qtyReceived,
      uom: form.uom || 'Pcs',
      remarks: form.remarks || null,
      ...(legacyUnit ? { fromUnit: legacyUnit } : {}),
    };
    try {
      const saved = editing
        ? await api.update(existing.id, body)
        : await api.create({ ...body, orderId: choice.orderId, styleId: choice.styleId, fromUnit: choice.unit });
      onSaved(saved);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? `Edit ${existing.printingNo}` : 'Send stitched pieces for printing'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <div className="form-grid">
        <Field label="Date" required>
          <TextInput type="date" value={form.printingDate} max={todayInput()} onChange={(e) => set({ printingDate: e.target.value })} />
        </Field>
        {editing ? (
          <>
            <Field label="Order / Style"><div className="unit-fact">{existing.order?.orderNo} · {existing.style?.styleNo}</div></Field>
            {existing.fromUnit ? (
              <Field label="From unit"><div className="unit-fact">{existing.fromUnit}</div></Field>
            ) : (
              <Field label="From unit" hint="This older entry never said which unit the pieces left. Give it one to hold them there.">
                <RecordSelect value={form.fromUnit} onChange={(e) => set({ fromUnit: e.target.value })} options={units.map((u) => ({ id: u, name: u }))} placeholder="Not given" />
              </Field>
            )}
          </>
        ) : (
          <Field label="Order / Style / From unit" required hint="Stitched pieces, unit by unit.">
            <RecordSelect value={form.key} onChange={(e) => set({ key: e.target.value })} options={orders} getValue={(o) => o.key} getLabel={(o) => `${orderLabel(o)} · ${o.unit}`} />
          </Field>
        )}
        <Field label="Vendor" required>
          <RecordSelect value={form.vendorId} onChange={(e) => set({ vendorId: e.target.value })} options={vendorOptions} getValue={(v) => v.id} getLabel={fmtVendor} />
        </Field>
        <Field label="Pcs sent" required error={tooMany ? `At most ${n0(room)} can go out` : undefined}>
          <TextInput type="number" inputMode="numeric" min="1" value={form.qty} error={tooMany} onChange={(e) => set({ qty: e.target.value })} />
        </Field>
        <Field label="Pcs received back" error={backTooMany ? 'More than were sent' : undefined}>
          <TextInput type="number" inputMode="numeric" min="0" value={form.qtyReceived} error={backTooMany} onChange={(e) => set({ qtyReceived: e.target.value })} />
        </Field>
        <Field label="UOM">
          <MasterSelect listCode="UOM" value={form.uom} currentValue={form.uom} onChange={(e) => set({ uom: e.target.value })} />
        </Field>
        <CollapsibleField className="span-2">
          <Field label="Remarks">
            <TextArea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          </Field>
        </CollapsibleField>
      </div>
      {summary && <SummaryCard summary={summary} title={`${summary.unit} on this order and style`} />}
    </Modal>
  );
}
