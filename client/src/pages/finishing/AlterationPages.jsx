/**
 * The Alteration Unit - the separate in-house unit that repairs and cleans.
 *
 * ---------------------------------------------------------------------------
 *  THE FIELDS, AND WHO FILLS THEM
 *
 *      Date                    AUTO (today), may be moved back, never forward
 *      Order No / Style        DROPDOWN / AUTO - orders with bags still open
 *      Pending list            AUTO - the bags from External QC and from the
 *                              ironing table, each with its reason
 *      Pcs Altered / Cleaned   MANUAL, per bag
 *      Pcs Not Repairable      MANUAL, per bag, + the reason it cannot be
 *      Balance                 AUTO = received - altered - not repairable
 *      Alteration Staff        DROPDOWN - employees in Department Alteration
 *      Remarks
 *
 *  Altered pieces go back to Ironing (source From Alteration Unit) and then
 *  through External QC again. Pieces not repairable go into the Rejected
 *  Register with the bag's original reason. Nothing goes to a stitching unit.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { alteration as api } from '../../services/erp.js';
import {
  Alert,
  CollapsibleField,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
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
import { fmtDate, fmtDateTime, fmtNum, fmtOrder, fmtOrderStyle } from '../../utils/format.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { FlowCard } from './ExternalQcPages.jsx';
import DateRangeFilter from '../../components/DateRangeFilter.jsx';

const n0 = (v) => fmtNum(v, { decimals: 0 });
const num = (v) => Number(v || 0);
const optionLabel = (o) => `${fmtOrderStyle(o)} · ${n0(o.pcsPending)} pending`;
const reasonText = (b) => `${b.reason}${b.defectType ? ` - ${b.defectType}` : ''}`;

function useAlterationContext() {
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.context().then(setCtx).catch((e) => setError(e.message));
  }, []);
  return { ctx, error };
}

function Tabs({ active }) {
  const navigate = useNavigate();
  return (
    <div className="hourly-mode" role="tablist">
      {[
        ['pending', 'Pending bags', '/alteration'],
        ['entries', 'Entries', '/alteration/entries'],
      ].map(([k, label, to]) => (
        <button key={k} type="button" role="tab" aria-selected={active === k} className={`btn ${active === k ? 'btn-primary' : ''}`} onClick={() => navigate(to)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ===========================================================================
//  THE PENDING LIST
// ===========================================================================

export function AlterationPending() {
  const { can } = useAuth();
  const { ctx, error: ctxError } = useAlterationContext();
  const [options, setOptions] = useState([]);
  const [recording, setRecording] = useState(null);
  const list = useResourceList((params) => api.bags(params), {
    defaultSort: 'receivedDate',
    defaultDir: 'asc',
    initialFilters: { status: 'OPEN', orderId: '', source: '' },
  });
  const loadOptions = useCallback(() => {
    api.orders().then(setOptions).catch(() => setOptions([]));
  }, []);
  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const totals = list.meta?.totals;
  const canRecord = can('ALTERATION.CREATE') && ctx?.canWrite;

  return (
    <>
      <PageHeader
        title="Alteration Unit"
        actions={
          <>
            <ExportButton dataset="alteration-bags" params={list.query} rowCount={list.meta.total} />
            {canRecord && (
              <button type="button" className="btn btn-primary" disabled={!options.length} onClick={() => setRecording({})}>
                Record alteration
              </button>
            )}
          </>
        }
      />
      {ctxError && <Alert kind="error">{ctxError}</Alert>}
      <Tabs active="pending" />

      <div className="filter-row">
        <Field label="Show">
          <select value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
            <option value="OPEN">Pending</option>
            <option value="CLOSED">Done</option>
            <option value="ALL">Every bag</option>
          </select>
        </Field>
        <Field label="Order">
          <select value={list.filters.orderId} onChange={(e) => list.setFilter('orderId', e.target.value)}>
            <option value="">All orders</option>
            {[...new Map(options.map((o) => [o.orderId, o])).values()].map((o) => <option key={o.orderId} value={o.orderId}>{fmtOrder(o)}</option>)}
          </select>
        </Field>
        <Field label="From">
          <select value={list.filters.source} onChange={(e) => list.setFilter('source', e.target.value)}>
            <option value="">Everywhere</option>
            <option value="EXTERNAL_QC">External QC</option>
            <option value="IRONING">Ironing (internal)</option>
          </select>
        </Field>
        <div className="grow">
          <Field label="Search">
            <TextInput value={list.search} onChange={(e) => list.setSearch(e.target.value)} placeholder="Order, style, reason, unit" />
          </Field>
        </div>
        <ClearFilters list={list} />
      </div>

      {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
      {list.loading ? (
        <Spinner label="Loading the pending list" />
      ) : list.rows.length === 0 ? (
        <EmptyState title="No bags here" message="Bags arrive from External QC (every reason but Iron) and from the ironing table (pieces rejected there)." />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="receivedDate" label="Received" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th className="num">Days</th>
                <th>Order</th>
                <th>Style</th>
                <th>From</th>
                <SortableTh field="reason" label="Reason" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="qty" label="Received" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th className="num">Altered</th>
                <th className="num">Not repairable</th>
                <th className="num">Balance</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.rows.map((b) => (
                <tr key={b.id}>
                  <td className="nowrap">{fmtDate(b.receivedDate)}</td>
                  <td className={`num ${b.status === 'OPEN' && b.ageDays > 7 ? 'text-danger' : ''}`}>{b.status === 'OPEN' ? b.ageDays : '-'}</td>
                  <td>{b.order?.orderNo}</td>
                  <td className="code">{b.style?.styleNo}</td>
                  <td>
                    {b.externalQcEntry ? <Link to={`/external-qc/${b.externalQcEntry.id}`}>{b.origin}</Link> : b.ironingEntry ? <Link to={`/ironing/${b.ironingEntry.id}`}>{b.origin}</Link> : b.origin}
                    {b.unit && <div className="faint">{b.unit}</div>}
                  </td>
                  <td>{reasonText(b)}</td>
                  <td className="num">{n0(b.qty)}</td>
                  <td className="num">{n0(b.pcsAltered)}</td>
                  <td className="num">{n0(b.pcsNotRepairable)}</td>
                  <td className="num"><strong>{n0(b.balance)}</strong></td>
                  <td><StatusBadge status={b.status} /></td>
                  <td>
                    {canRecord && b.status === 'OPEN' && (
                      <button type="button" className="btn btn-sm" onClick={() => setRecording({ key: `${b.orderId}:${b.styleId}` })}>Work</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  <td colSpan={6}><strong>All matching bags</strong></td>
                  <td className="num"><strong>{n0(totals.qty)}</strong></td>
                  <td className="num"><strong>{n0(totals.pcsAltered)}</strong></td>
                  <td className="num"><strong>{n0(totals.pcsNotRepairable)}</strong></td>
                  <td className="num"><strong>{n0(totals.balance)}</strong></td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </TableWrap>
      )}

      <Pagination meta={list.meta} page={list.page} pageSize={list.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />

      {recording && ctx && (
        <AlterationModal
          ctx={ctx}
          options={options}
          initialKey={recording.key}
          onClose={() => setRecording(null)}
          onSaved={() => {
            setRecording(null);
            list.reload();
            loadOptions();
          }}
        />
      )}
    </>
  );
}

// ===========================================================================
//  THE ENTRIES
// ===========================================================================

export function AlterationEntries() {
  const navigate = useNavigate();
  const { ctx } = useAlterationContext();
  const list = useResourceList((params) => api.list(params), {
    defaultSort: 'entryDate',
    defaultDir: 'desc',
    initialFilters: { staffId: '', dateFrom: '', dateTo: '' },
  });
  const totals = list.meta?.totals;

  return (
    <>
      <PageHeader title="Alteration Unit" actions={<ExportButton dataset="alteration-entries" params={list.query} rowCount={list.meta.total} />} />
      <Tabs active="entries" />
      <div className="filter-row">
        <Field label="Staff">
          <select value={list.filters.staffId} onChange={(e) => list.setFilter('staffId', e.target.value)}>
            <option value="">Everyone</option>
            {(ctx?.staff ?? []).map((p) => <option key={p.id} value={p.id}>{p.empName}</option>)}
          </select>
        </Field>
        <DateRangeFilter filters={list.filters} setFilter={list.setFilter} fromLabel="From" toLabel="To" />
        <div className="grow">
          <Field label="Search">
            <TextInput value={list.search} onChange={(e) => list.setSearch(e.target.value)} placeholder="Order, style, staff, reason" />
          </Field>
        </div>
        <ClearFilters list={list} />
      </div>

      {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
      {list.loading ? (
        <Spinner label="Loading" />
      ) : list.rows.length === 0 ? (
        <EmptyState title="Nothing altered yet" />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="entryDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Order</th>
                <th>Style</th>
                <th>Bag</th>
                <th>Staff</th>
                <SortableTh field="pcsAltered" label="Altered / cleaned" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="pcsNotRepairable" label="Not repairable" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/alteration/entries/${r.id}`)}>
                  <td className="nowrap">{fmtDate(r.entryDate)}</td>
                  <td>{r.order?.orderNo}</td>
                  <td className="code">{r.style?.styleNo}</td>
                  <td>{r.receipt ? `${r.receipt.origin} · ${reasonText(r.receipt)}` : '-'}</td>
                  <td>{r.staff?.empName}</td>
                  <td className="num"><strong>{n0(r.pcsAltered)}</strong></td>
                  <td className="num">{n0(r.pcsNotRepairable)}</td>
                  <td>{r.notRepairableReason ?? ''}</td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  <td colSpan={5}><strong>All matching entries</strong></td>
                  <td className="num"><strong>{n0(totals.pcsAltered)}</strong></td>
                  <td className="num"><strong>{n0(totals.pcsNotRepairable)}</strong></td>
                  <td />
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

export function AlterationEntryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { ctx } = useAlterationContext();
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
      navigate('/alteration/entries');
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
      setBusy(false);
    }
  }

  const bag = row.receipt;

  return (
    <>
      <PageHeader
        title={`Alteration - ${row.order?.orderNo} / ${row.style?.styleNo}, ${fmtDate(row.entryDate)}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/alteration/entries')}>Back to list</button>
            {can('ALTERATION.DELETE') && <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>Delete</button>}
            {can('ALTERATION.EDIT') && <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>Edit</button>}
          </>
        }
      />
      {banner && <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>{banner.text}</Alert>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">What was done</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Date" value={fmtDate(row.entryDate)} />
            <Detail label="Order No" value={row.order ? <Link to={`/orders/${row.order.id}`}>{row.order.orderNo}</Link> : '-'} sub={row.order?.buyer?.buyerName} />
            <Detail label="Style" value={row.style?.styleNo} mono />
            <Detail label="Alteration staff" value={row.staff?.empName} sub={row.staff?.empId} />
            <Detail label="Pcs altered / cleaned" value={<strong>{n0(row.pcsAltered)}</strong>} sub="Back to Ironing, then External QC again" showEmpty />
            <Detail
              label="Pcs not repairable"
              value={n0(row.pcsNotRepairable)}
              sub={row.rejected ? <Link to="/rejected-register">In the Rejected Register - {row.rejected.reason}</Link> : null}
              showEmpty
            />
            {row.notRepairableReason && <Detail label="Why it cannot be repaired" value={row.notRepairableReason} />}
            <Detail label="Recorded by" value={row.recordedByName} sub={fmtDateTime(row.updatedAt)} />
            {row.remarks && <Detail label="Remarks" value={row.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      {bag && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">The bag</div>
          <div className="card-body">
            <DetailGrid>
              <Detail label="Received" value={fmtDate(bag.receivedDate)} />
              <Detail label="From" value={bag.origin} sub={bag.externalQcEntry?.agency?.vendorName ?? bag.unit} />
              <Detail label="Reason" value={reasonText(bag)} />
              <Detail label="Pcs in the bag" value={n0(bag.qty)} showEmpty />
              <Detail label="Altered" value={n0(bag.pcsAltered)} showEmpty />
              <Detail label="Not repairable" value={n0(bag.pcsNotRepairable)} showEmpty />
              <Detail label="Balance" value={<strong>{n0(bag.balance)}</strong>} showEmpty />
              <Detail label="Status" value={<StatusBadge status={bag.status} />} />
            </DetailGrid>
          </div>
        </div>
      )}

      <FlowCard flow={row.position?.flow} title={`${row.order?.orderNo} / ${row.style?.styleNo} - where the pieces are now`} />

      {editing && ctx && <EditEntryModal ctx={ctx} row={row} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); setBanner({ kind: 'success', text: 'Entry updated.' }); await load(); }} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this entry?"
          message="Its pieces go back into the bag, and its Rejected Register row is removed. Refused if its altered pieces have already been received at ironing. The audit trail keeps a record."
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
//  THE FORMS
// ===========================================================================

/** One save: the bags of one order and style, each with what was done to it. */
function AlterationModal({ ctx, options, initialKey, onClose, onSaved }) {
  const [form, setForm] = useState({ entryDate: ctx.today, key: initialKey ?? '', staffId: ctx.staff.length === 1 ? ctx.staff[0].id : '', remarks: '' });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const [bags, setBags] = useState([]);
  const [work, setWork] = useState({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choice = options.find((o) => o.key === form.key);
  useEffect(() => {
    if (!choice) {
      setBags([]);
      return;
    }
    setLoading(true);
    api
      .bags({ orderId: choice.orderId, styleId: choice.styleId, status: 'OPEN', pageSize: 200 })
      .then((r) => setBags(Array.isArray(r) ? r : r.rows ?? []))
      .catch(() => setBags([]))
      .finally(() => setLoading(false));
    setWork({});
  }, [choice]);

  const setLine = (id, patch) => setWork((w) => ({ ...w, [id]: { ...(w[id] ?? {}), ...patch } }));
  const lines = useMemo(
    () => bags.map((b) => ({ bag: b, ...(work[b.id] ?? {}) })).filter((l) => num(l.pcsAltered) + num(l.pcsNotRepairable) > 0),
    [bags, work],
  );
  const problems = [];
  for (const l of lines) {
    if (num(l.pcsAltered) + num(l.pcsNotRepairable) > num(l.bag.balance)) {
      problems.push(`${reasonText(l.bag)}: altered + not repairable cannot be more than the ${n0(l.bag.balance)} left in the bag.`);
    }
    if (num(l.pcsNotRepairable) > 0 && !String(l.notRepairableReason ?? '').trim()) {
      problems.push(`${reasonText(l.bag)}: say why the pieces cannot be repaired.`);
    }
  }
  const ready = choice && form.staffId && lines.length > 0 && problems.length === 0 && !busy;

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.create({
        entryDate: form.entryDate,
        staffId: form.staffId,
        remarks: form.remarks || null,
        lines: lines.map((l) => ({
          receiptId: l.bag.id,
          pcsAltered: l.pcsAltered || '0',
          pcsNotRepairable: l.pcsNotRepairable || '0',
          notRepairableReason: num(l.pcsNotRepairable) > 0 ? l.notRepairableReason : null,
        })),
      });
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Record alteration"
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
      {problems.length > 0 && <Alert kind="warning">{problems.join(' ')}</Alert>}
      <div className="form-grid">
        <Field label="Date" required>
          <TextInput type="date" value={form.entryDate} max={ctx.today} onChange={(e) => set({ entryDate: e.target.value })} />
        </Field>
        <Field label="Order No · Style" required>
          <RecordSelect value={form.key} onChange={(e) => set({ key: e.target.value })} options={options} getValue={(o) => o.key} getLabel={optionLabel} placeholder="Choose the order" />
        </Field>
        <Field label="Alteration staff" required>
          <RecordSelect value={form.staffId} onChange={(e) => set({ staffId: e.target.value })} options={ctx.staff} getLabel={(p) => `${p.empName} (${p.empId})`} placeholder={ctx.staff.length ? 'Choose' : `No active employees in the ${ctx.department} department`} />
        </Field>
      </div>

      {loading ? (
        <Spinner label="Loading the bags" />
      ) : choice && (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Received</th>
                <th>From</th>
                <th>Reason</th>
                <th className="num">Balance</th>
                <th className="num">Altered / cleaned</th>
                <th className="num">Not repairable</th>
                <th>Why not repairable</th>
                <th className="num">Left after</th>
              </tr>
            </thead>
            <tbody>
              {bags.map((b) => {
                const w = work[b.id] ?? {};
                const left = num(b.balance) - num(w.pcsAltered) - num(w.pcsNotRepairable);
                return (
                  <tr key={b.id}>
                    <td className="nowrap">{fmtDate(b.receivedDate)}</td>
                    <td>{b.origin}</td>
                    <td>{reasonText(b)}</td>
                    <td className="num">{n0(b.balance)}</td>
                    <td className="num"><TextInput type="number" inputMode="numeric" min="0" aria-label="Altered" value={w.pcsAltered ?? ''} onChange={(e) => setLine(b.id, { pcsAltered: e.target.value })} /></td>
                    <td className="num"><TextInput type="number" inputMode="numeric" min="0" aria-label="Not repairable" value={w.pcsNotRepairable ?? ''} onChange={(e) => setLine(b.id, { pcsNotRepairable: e.target.value })} /></td>
                    <td><TextInput maxLength={200} disabled={!num(w.pcsNotRepairable)} value={w.notRepairableReason ?? ''} onChange={(e) => setLine(b.id, { notRepairableReason: e.target.value })} /></td>
                    <td className={`num ${left < 0 ? 'text-danger' : ''}`}><strong>{n0(left)}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}

      <CollapsibleField className="span-2">
        <Field label="Remarks">
          <TextArea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
        </Field>
      </CollapsibleField>
    </Modal>
  );
}

function EditEntryModal({ ctx, row, onClose, onSaved }) {
  const [form, setForm] = useState({
    entryDate: String(row.entryDate).slice(0, 10),
    staffId: row.staffId,
    pcsAltered: String(num(row.pcsAltered) || ''),
    pcsNotRepairable: String(num(row.pcsNotRepairable) || ''),
    notRepairableReason: row.notRepairableReason ?? '',
    remarks: row.remarks ?? '',
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The bag's balance with this entry's own pieces put back.
  const room = num(row.receipt?.balance) + num(row.pcsAltered) + num(row.pcsNotRepairable);
  const worked = num(form.pcsAltered) + num(form.pcsNotRepairable);
  const problems = [];
  if (worked > room) problems.push(`The bag holds ${n0(room)} for this entry - altered + not repairable cannot be more.`);
  if (num(form.pcsNotRepairable) > 0 && !form.notRepairableReason.trim()) problems.push('Say why the pieces cannot be repaired.');
  const ready = worked > 0 && form.staffId && problems.length === 0 && !busy;

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.update(row.id, {
        ...form,
        pcsAltered: form.pcsAltered || '0',
        pcsNotRepairable: form.pcsNotRepairable || '0',
        notRepairableReason: num(form.pcsNotRepairable) > 0 ? form.notRepairableReason : null,
        remarks: form.remarks || null,
      });
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Edit alteration entry"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {problems.length > 0 && <Alert kind="warning">{problems.join(' ')}</Alert>}
      <div className="form-grid">
        <Field label="Date" required>
          <TextInput type="date" value={form.entryDate} max={ctx.today} onChange={(e) => set({ entryDate: e.target.value })} />
        </Field>
        <Field label="Alteration staff" required>
          <RecordSelect value={form.staffId} onChange={(e) => set({ staffId: e.target.value })} options={ctx.staff} getLabel={(p) => `${p.empName} (${p.empId})`} />
        </Field>
        <Field label="Pcs altered / cleaned">
          <TextInput type="number" inputMode="numeric" min="0" value={form.pcsAltered} onChange={(e) => set({ pcsAltered: e.target.value })} />
        </Field>
        <Field label="Pcs not repairable">
          <TextInput type="number" inputMode="numeric" min="0" value={form.pcsNotRepairable} onChange={(e) => set({ pcsNotRepairable: e.target.value })} />
        </Field>
        <Field label="Why not repairable" className="span-2">
          <TextInput maxLength={200} disabled={!num(form.pcsNotRepairable)} value={form.notRepairableReason} onChange={(e) => set({ notRepairableReason: e.target.value })} />
        </Field>
        <CollapsibleField className="span-2">
          <Field label="Remarks">
            <TextArea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          </Field>
        </CollapsibleField>
      </div>
    </Modal>
  );
}
