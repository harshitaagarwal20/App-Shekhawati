/**
 * Inline QC - checks taken on the stitching line, and the Action needed list.
 *
 * ---------------------------------------------------------------------------
 *  THE FIELDS, AND WHO FILLS THEM
 *
 *      Check Type        TOGGLE - Size / Workmanship (the workbook's QC Size
 *                        and QC Defects sheets, on one screen)
 *      Date              AUTO (today), may be moved back, never forward
 *      Tailor            DROPDOWN - active tailors on a stitching unit
 *      Unit              AUTO - the tailor's Unit / Line
 *      Order No / Style  DROPDOWN - orders and styles cut for that unit
 *      Operation         DROPDOWN (Operation list)   - Size checks only
 *      Size measurement  MANUAL                      - Size checks only
 *      Pcs Checked       MANUAL
 *      Pcs Rejected      MANUAL - never more than checked
 *      Defects Found     MULTI-SELECT (Defect Type list)
 *      Inform To         DROPDOWN - the supervisors; the unit's own is offered
 *
 *  Every defect lands on the Inform To person's Action needed list, and they
 *  mark it Resolved. Inline QC runs beside stitching and moves no pieces.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { useMasterList } from '../../hooks/useMasterList.js';
import { inlineQc as api } from '../../services/erp.js';
import {
  Alert,
  CollapsibleField,
  ConfirmDialog,
  EmptyState,
  Field,
  MasterSelect,
  Modal,
  MultiSelect,
  PageHeader,
  Pagination,
  RecordSelect,
  SortableTh,
  Spinner,
  StatusBadge,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import { Detail, DetailGrid } from '../shared/Detail.jsx';
import { fmtDate, fmtDateTime, fmtNum } from '../../utils/format.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const n0 = (v) => fmtNum(v, { decimals: 0 });
const num = (v) => Number(v || 0);
const TYPE_LABEL = { SIZE: 'Size', WORKMANSHIP: 'Workmanship' };
const personLabel = (p) => `${p.fullName}${p.unit ? ` · ${p.unit}` : p.designation ? ` · ${p.designation}` : ''}`;

function useInlineQcContext() {
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api.context().then(setCtx).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { ctx, error, reload: load };
}

/** The Check Type toggle. `allowAll` adds "All" for the register's filter. */
function CheckTypeToggle({ value, onChange, allowAll = false }) {
  const options = [...(allowAll ? [['', 'All checks']] : []), ['SIZE', 'Size'], ['WORKMANSHIP', 'Workmanship']];
  return (
    <div className="hourly-mode" role="tablist" aria-label="Check type">
      {options.map(([k, label]) => (
        <button key={k || 'all'} type="button" role="tab" aria-selected={value === k} className={`btn ${value === k ? 'btn-primary' : ''}`} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Register / Action needed, the two views of this module. */
function Views({ active, open }) {
  const navigate = useNavigate();
  return (
    <div className="hourly-mode" role="tablist">
      {[
        ['register', 'Checks', '/inline-qc'],
        ['actions', `Action needed${open ? ` (${open})` : ''}`, '/inline-qc/actions'],
      ].map(([k, label, to]) => (
        <button key={k} type="button" role="tab" aria-selected={active === k} className={`btn ${active === k ? 'btn-primary' : ''}`} onClick={() => navigate(to)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function DefectChips({ defects }) {
  if (!defects?.length) return <span className="faint">None</span>;
  return (
    <span className="chip-list">
      {defects.map((d) => (
        <span key={d.id} className={`chip ${d.status === 'RESOLVED' ? 'chip-done' : ''}`} title={d.status === 'RESOLVED' ? `Resolved by ${d.resolvedByName}` : 'Open'}>
          {d.status === 'RESOLVED' ? '✓ ' : ''}{d.defect}
        </span>
      ))}
    </span>
  );
}

// ===========================================================================
//  THE REGISTER
// ===========================================================================

export function InlineQcList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { ctx, error: ctxError } = useInlineQcContext();
  const [recording, setRecording] = useState(false);
  const list = useResourceList((params) => api.list(params), {
    defaultSort: 'entryDate',
    defaultDir: 'desc',
    initialFilters: { checkType: '', unit: '', tailorId: '', openOnly: '', dateFrom: '', dateTo: '' },
  });
  const canRecord = can('INLINE_QC.CREATE') && ctx?.canWrite;
  const totals = list.meta?.totals;
  const showSize = list.filters.checkType !== 'WORKMANSHIP';
  const tailors = (ctx?.tailors ?? []).filter((t) => !list.filters.unit || t.unitLine === list.filters.unit);

  return (
    <>
      <PageHeader
        title="Inline QC"
        actions={
          <>
            <ExportButton dataset="inline-qc" params={list.query} rowCount={list.meta.total} />
            {canRecord && (
              <button type="button" className="btn btn-primary" onClick={() => setRecording(true)}>
                Record check
              </button>
            )}
          </>
        }
      />
      {ctxError && <Alert kind="error">{ctxError}</Alert>}
      <Views active="register" open={ctx?.myOpen} />
      {ctx?.myOpen > 0 && (
        <Alert kind="warning">
          {ctx.myOpen === 1 ? 'One defect is' : `${ctx.myOpen} defects are`} waiting for you to act on.{' '}
          <Link to="/inline-qc/actions">Open Action needed</Link>
        </Alert>
      )}

      <CheckTypeToggle value={list.filters.checkType} onChange={(v) => list.setFilter('checkType', v)} allowAll />

      <div className="filter-row">
        {ctx?.fixedUnit ? (
          <Field label="Unit"><div className="unit-fact">{ctx.fixedUnit}</div></Field>
        ) : (
          <Field label="Unit">
            <select value={list.filters.unit} onChange={(e) => { list.setFilter('unit', e.target.value); list.setFilter('tailorId', ''); }}>
              <option value="">All units</option>
              {(ctx?.units ?? []).map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
        )}
        <Field label="Tailor">
          <select value={list.filters.tailorId} onChange={(e) => list.setFilter('tailorId', e.target.value)}>
            <option value="">All tailors</option>
            {tailors.map((t) => <option key={t.id} value={t.id}>{t.empName}</option>)}
          </select>
        </Field>
        <Field label="From">
          <TextInput type="date" value={list.filters.dateFrom} onChange={(e) => list.setFilter('dateFrom', e.target.value)} />
        </Field>
        <Field label="To">
          <TextInput type="date" value={list.filters.dateTo} onChange={(e) => list.setFilter('dateTo', e.target.value)} />
        </Field>
        <Field label="Defects">
          <select value={list.filters.openOnly} onChange={(e) => list.setFilter('openOnly', e.target.value)}>
            <option value="">All checks</option>
            <option value="true">With an open defect</option>
          </select>
        </Field>
      </div>

      {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
      {list.loading ? (
        <Spinner label="Loading Inline QC" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title="No checks recorded"
          message={canRecord ? 'Record a check on a tailor\'s work with "Record check".' : 'Nothing matches these filters.'}
        />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="entryDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                {!list.filters.checkType && <SortableTh field="checkType" label="Check" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />}
                <th>Order</th>
                <SortableTh field="unit" label="Unit" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Tailor</th>
                <th>Style</th>
                {showSize && <th>Operation</th>}
                {showSize && <th>Size</th>}
                <SortableTh field="pcsChecked" label="Checked" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="pcsRejected" label="Rejected" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th className="num">Rej %</th>
                <th>Defects found</th>
                <th>Inform to</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/inline-qc/${r.id}`)}>
                  <td className="nowrap">{fmtDate(r.entryDate)}</td>
                  {!list.filters.checkType && <td>{TYPE_LABEL[r.checkType]}</td>}
                  <td>{r.order?.orderNo}</td>
                  <td>{r.unit}</td>
                  <td>{r.tailor?.empName}</td>
                  <td className="code">{r.style?.styleNo}</td>
                  {showSize && <td>{r.operation ?? <span className="faint">-</span>}</td>}
                  {showSize && <td>{r.sizeMeasurement ?? <span className="faint">-</span>}</td>}
                  <td className="num">{n0(r.pcsChecked)}</td>
                  <td className="num"><strong>{n0(r.pcsRejected)}</strong></td>
                  <td className="num">{r.rejectionPct}</td>
                  <td><DefectChips defects={r.defects} /></td>
                  <td>{r.informToName ?? <span className="faint">-</span>}</td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  <td colSpan={(list.filters.checkType ? 5 : 6) + (showSize ? 2 : 0)}><strong>All matching checks</strong></td>
                  <td className="num"><strong>{n0(totals.pcsChecked)}</strong></td>
                  <td className="num"><strong>{n0(totals.pcsRejected)}</strong></td>
                  <td className="num"><strong>{totals.rejectionPct}</strong></td>
                  <td colSpan={2}><strong>{n0(totals.openDefects)}</strong> <span className="faint">open</span></td>
                </tr>
              </tfoot>
            )}
          </table>
        </TableWrap>
      )}

      <Pagination meta={list.meta} page={list.page} pageSize={list.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />

      {recording && ctx && (
        <InlineQcModal
          ctx={ctx}
          initialType={list.filters.checkType || 'SIZE'}
          onClose={() => setRecording(false)}
          onSaved={(saved, again) => {
            list.reload();
            if (again) return;
            setRecording(false);
            navigate(`/inline-qc/${saved.id}`);
          }}
        />
      )}
    </>
  );
}

// ===========================================================================
//  ONE CHECK
// ===========================================================================

export function InlineQcDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { ctx } = useInlineQcContext();
  const [row, setRow] = useState(null);
  const [banner, setBanner] = useState(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resolving, setResolving] = useState(null);
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
      navigate('/inline-qc');
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
      setBusy(false);
    }
  }

  async function reopen(d) {
    try {
      await api.reopen(d.id);
      await load();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    }
  }

  const isSize = row.checkType === 'SIZE';

  return (
    <>
      <PageHeader
        title={`Inline QC - ${row.tailor?.empName}, ${row.order?.orderNo} / ${row.style?.styleNo}, ${fmtDate(row.entryDate)}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/inline-qc')}>Back to list</button>
            {can('INLINE_QC.DELETE') && <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>Delete</button>}
            {can('INLINE_QC.EDIT') && ctx?.canWrite && <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>Edit</button>}
          </>
        }
      />
      {banner && <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>{banner.text}</Alert>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">{isSize ? 'Size check' : 'Workmanship check'}</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Date" value={fmtDate(row.entryDate)} />
            <Detail label="Order No" value={row.order ? <Link to={`/orders/${row.order.id}`}>{row.order.orderNo}</Link> : '-'} sub={row.order?.buyer?.buyerName} />
            <Detail label="Unit" value={row.unit} />
            <Detail label="Tailor" value={row.tailor?.empName} sub={row.tailor?.empId} />
            <Detail label="Style" value={row.style?.styleNo} mono sub={row.style?.styleDescription} />
            {isSize && <Detail label="Operation" value={row.operation} />}
            {isSize && <Detail label="Size measurement" value={row.sizeMeasurement} />}
            <Detail label="Pcs checked" value={<strong>{n0(row.pcsChecked)}</strong>} />
            <Detail label="Pcs rejected" value={n0(row.pcsRejected)} sub={row.rejectionPct} showEmpty />
            <Detail label="Inform to" value={row.informToName} showEmpty />
            <Detail label="Checked by" value={row.recordedByName} sub={fmtDateTime(row.updatedAt)} />
            {row.remarks && <Detail label="Remarks" value={row.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Defects found</div>
        <div className="card-body">
          {row.defects?.length ? (
            <TableWrap>
              <table className="data">
                <thead><tr><th>Defect</th><th>Status</th><th>Resolved by</th><th>What was done</th><th /></tr></thead>
                <tbody>
                  {row.defects.map((d) => (
                    <tr key={d.id}>
                      <td>{d.defect}</td>
                      <td><StatusBadge status={d.status} /></td>
                      <td>{d.resolvedByName ? <>{d.resolvedByName} <span className="faint">{fmtDateTime(d.resolvedAt)}</span></> : <span className="faint">-</span>}</td>
                      <td>{d.resolutionNote ?? <span className="faint">-</span>}</td>
                      <td className="actions">
                        {row.canResolve && (d.status === 'OPEN'
                          ? <button type="button" className="btn btn-sm btn-primary" onClick={() => setResolving(d)}>Mark resolved</button>
                          : <button type="button" className="btn btn-sm" onClick={() => reopen(d)}>Reopen</button>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="faint" style={{ margin: 0 }}>A clean check - no defects found.</p>
          )}
        </div>
      </div>

      {editing && ctx && (
        <InlineQcModal
          ctx={ctx}
          existing={row}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            setBanner({ kind: 'success', text: 'Check updated.' });
            await load();
          }}
        />
      )}
      {resolving && (
        <ResolveModal
          line={{ ...resolving, tailor: row.tailor?.empName, unit: row.unit, orderNo: row.order?.orderNo }}
          onClose={() => setResolving(null)}
          onDone={async () => {
            setResolving(null);
            await load();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this check?"
          message="Its defects leave the Action needed list. The audit trail keeps a record."
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
//  ACTION NEEDED
// ===========================================================================

export function InlineQcActions() {
  const navigate = useNavigate();
  const { ctx, reload: reloadCtx } = useInlineQcContext();
  const [resolving, setResolving] = useState(null);
  const [banner, setBanner] = useState(null);
  const list = useResourceList((params) => api.actions(params), {
    defaultSort: 'createdAt',
    defaultDir: 'asc',
    initialFilters: { scope: 'mine', status: 'OPEN', informToUserId: '' },
  });
  const everyone = list.filters.scope === 'all';

  async function reopen(line) {
    try {
      await api.reopen(line.id);
      list.reload();
      reloadCtx();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    }
  }

  return (
    <>
      <PageHeader
        title="Inline QC - action needed"
        actions={<ExportButton dataset="inline-qc-actions" params={list.query} rowCount={list.meta.total} />}
      />
      <Views active="actions" open={ctx?.myOpen} />
      {banner && <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>{banner.text}</Alert>}

      <div className="filter-row">
        <Field label="Show">
          <select value={list.filters.scope} onChange={(e) => list.setFilter('scope', e.target.value)}>
            <option value="mine">Sent to me</option>
            <option value="all">{ctx?.fixedUnit ? `Everyone in ${ctx.fixedUnit}` : 'Everyone'}</option>
          </select>
        </Field>
        <Field label="Status">
          <select value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ALL">All</option>
          </select>
        </Field>
        {everyone && (
          <Field label="Inform to">
            <select value={list.filters.informToUserId} onChange={(e) => list.setFilter('informToUserId', e.target.value)}>
              <option value="">Anyone</option>
              {(ctx?.informTo ?? []).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          </Field>
        )}
      </div>

      {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
      {list.loading ? (
        <Spinner label="Loading" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title={list.filters.status === 'OPEN' ? 'Nothing waiting' : 'Nothing here'}
          message={list.filters.status === 'OPEN' && !everyone ? 'No open defect has been sent to you.' : 'Nothing matches these filters.'}
        />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="createdAt" label="Found" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="defect" label="Defect" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Unit</th>
                <th>Tailor</th>
                <th>Order · Style</th>
                <th>Check</th>
                <th className="num">Rejected</th>
                <th>Found by</th>
                {everyone && <th>Inform to</th>}
                <SortableTh field="status" label="Status" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th />
              </tr>
            </thead>
            <tbody>
              {list.rows.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{fmtDate(a.entryDate)}</td>
                  <td><strong>{a.defect}</strong></td>
                  <td>{a.unit}</td>
                  <td>{a.tailor}</td>
                  <td><Link to={`/inline-qc/${a.entryId}`}>{a.orderNo} · {a.styleNo}</Link></td>
                  <td>{a.checkType}{a.operation ? <span className="faint"> · {a.operation}{a.sizeMeasurement ? `, ${a.sizeMeasurement}` : ''}</span> : null}</td>
                  <td className="num">{n0(a.pcsRejected)} <span className="faint">of {n0(a.pcsChecked)}</span></td>
                  <td>{a.foundBy}</td>
                  {everyone && <td>{a.informTo ?? <span className="faint">-</span>}</td>}
                  <td>
                    <StatusBadge status={a.status} />
                    {a.status === 'RESOLVED' && (
                      <div className="faint" style={{ fontSize: 12 }}>
                        {a.resolvedByName}, {fmtDateTime(a.resolvedAt)}{a.resolutionNote ? ` - ${a.resolutionNote}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="actions">
                    {a.canResolve && (a.status === 'OPEN'
                      ? <button type="button" className="btn btn-sm btn-primary" onClick={() => setResolving(a)}>Mark resolved</button>
                      : <button type="button" className="btn btn-sm" onClick={() => reopen(a)}>Reopen</button>)}
                    {!a.canResolve && <button type="button" className="btn btn-sm" onClick={() => navigate(`/inline-qc/${a.entryId}`)}>View</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <Pagination meta={list.meta} page={list.page} pageSize={list.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />

      {resolving && (
        <ResolveModal
          line={resolving}
          onClose={() => setResolving(null)}
          onDone={() => {
            setResolving(null);
            setBanner({ kind: 'success', text: `${resolving.defect} marked resolved.` });
            list.reload();
            reloadCtx();
          }}
        />
      )}
    </>
  );
}

function ResolveModal({ line, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.resolve(line.id, note);
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Mark "${line.defect}" resolved`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Mark resolved'}</button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <p style={{ marginTop: 0 }}>
        {line.tailor}, {line.unit} - {line.orderNo}
        {line.styleNo ? ` / ${line.styleNo}` : ''}.
      </p>
      <Field label="What was done" hint="Optional - e.g. tailor shown the correct hem, template replaced.">
        <TextArea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ===========================================================================
//  THE FORM
// ===========================================================================

function InlineQcModal({ ctx, existing, initialType = 'SIZE', onClose, onSaved }) {
  const editing = Boolean(existing);
  const blank = () => ({
    checkType: initialType,
    entryDate: ctx.today,
    tailorId: '',
    orderId: '',
    styleId: '',
    operation: '',
    sizeMeasurement: '',
    pcsChecked: '',
    pcsRejected: '',
    defects: [],
    informToUserId: '',
    remarks: '',
  });
  const [form, setForm] = useState(() => (existing
    ? {
      checkType: existing.checkType,
      entryDate: String(existing.entryDate).slice(0, 10),
      tailorId: existing.tailorId,
      orderId: existing.orderId,
      styleId: existing.styleId,
      operation: existing.operation ?? '',
      sizeMeasurement: existing.sizeMeasurement ?? '',
      pcsChecked: String(num(existing.pcsChecked)),
      pcsRejected: String(num(existing.pcsRejected)),
      defects: existing.defects.map((d) => d.defect),
      informToUserId: existing.informToUserId ?? '',
      remarks: existing.remarks ?? '',
    }
    : blank()));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const { values: defectValues } = useMasterList('DefectType');

  const tailor = ctx.tailors.find((t) => t.id === form.tailorId);
  const unit = editing ? existing.unit : tailor?.unitLine ?? '';

  // The orders cut for the tailor's unit.
  useEffect(() => {
    if (editing || !unit) {
      setOrders([]);
      return;
    }
    api.orders({ unit }).then(setOrders).catch(() => setOrders([]));
  }, [editing, unit]);

  const orderChoices = useMemo(() => [...new Map(orders.map((o) => [o.orderId, o])).values()], [orders]);
  const styleChoices = orders.filter((o) => o.orderId === form.orderId);
  const choice = styleChoices.find((o) => o.styleId === form.styleId);

  function chooseTailor(tailorId) {
    const t = ctx.tailors.find((x) => x.id === tailorId);
    // The unit's own supervisor is offered first; the checker may pick another.
    const supervisor = t ? ctx.informTo.find((p) => p.unit === t.unitLine) : null;
    set({
      tailorId,
      ...(t?.unitLine !== tailor?.unitLine ? { orderId: '', styleId: '' } : {}),
      ...(supervisor && (!form.informToUserId || ctx.informTo.find((p) => p.id === form.informToUserId)?.unit !== t.unitLine)
        ? { informToUserId: supervisor.id }
        : {}),
    });
  }

  function chooseOrder(orderId) {
    const styles = orders.filter((o) => o.orderId === orderId);
    set({ orderId, styleId: styles.length === 1 ? styles[0].styleId : '' });
  }

  const isSize = form.checkType === 'SIZE';
  const checked = num(form.pcsChecked);
  const rejected = num(form.pcsRejected);
  const problems = [];
  if (isSize && checked > 0 && !form.operation) problems.push('Choose the operation checked.');
  if (isSize && checked > 0 && !form.sizeMeasurement.trim()) problems.push('Enter the size measured.');
  if (rejected > checked && checked > 0) problems.push(`${n0(rejected)} rejected is more than the ${n0(checked)} checked.`);
  if (rejected > 0 && form.defects.length === 0) problems.push('Choose the defect(s) the rejected pieces had.');
  if (form.defects.length > 0 && !form.informToUserId) problems.push('Choose who to inform - the defects go to their Action needed list.');
  if (choice && checked > num(choice.pcsIssued)) problems.push(`Only ${n0(choice.pcsIssued)} pieces were cut for ${unit}.`);
  const ready = (editing || (form.tailorId && form.orderId && form.styleId)) && checked > 0 && problems.length === 0 && !busy;

  async function save(again = false) {
    setBusy(true);
    setError('');
    const body = {
      entryDate: form.entryDate,
      checkType: form.checkType,
      operation: isSize ? form.operation || null : null,
      sizeMeasurement: isSize ? form.sizeMeasurement || null : null,
      pcsChecked: form.pcsChecked,
      pcsRejected: form.pcsRejected || '0',
      defects: form.defects,
      informToUserId: form.informToUserId || null,
      remarks: form.remarks || null,
    };
    try {
      const row = editing
        ? await api.update(existing.id, body)
        : await api.create({ ...body, tailorId: form.tailorId, orderId: form.orderId, styleId: form.styleId });
      onSaved(row, again);
      if (again) {
        // The next check is usually the next tailor on the same order.
        setForm((f) => ({ ...blank(), checkType: f.checkType, entryDate: f.entryDate, orderId: f.orderId, styleId: f.styleId, tailorId: f.tailorId, informToUserId: f.informToUserId, operation: f.operation }));
        setSaved(`Saved - ${tailor?.empName}, ${row.defects.length ? `${row.defects.length} defect(s) sent to ${row.informToName}` : 'clean check'}.`);
        setBusy(false);
      }
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const defectOptions = defectValues.map((v) => ({ value: v.value, label: v.value }));
  // A defect the entry holds that the list has since dropped stays choosable.
  for (const d of form.defects) if (!defectOptions.some((o) => o.value === d)) defectOptions.push({ value: d, label: `${d} (inactive)` });

  return (
    <Modal
      title={editing ? 'Edit check' : 'Record an Inline QC check'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>{saved ? 'Done' : 'Cancel'}</button>
          {!editing && <button type="button" className="btn" disabled={!ready} onClick={() => save(true)}>Save and record another</button>}
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {saved && <Alert kind="success" onDismiss={() => setSaved('')}>{saved}</Alert>}
      {problems.length > 0 && <Alert kind="warning">{problems.join(' ')}</Alert>}

      <CheckTypeToggle value={form.checkType} onChange={(checkType) => set({ checkType })} />

      <div className="form-grid">
        <Field label="Date" required>
          <TextInput type="date" value={form.entryDate} max={ctx.today} onChange={(e) => set({ entryDate: e.target.value })} />
        </Field>
        {editing ? (
          <>
            <Field label="Tailor"><div className="unit-fact">{existing.tailor?.empName}</div></Field>
            <Field label="Unit"><div className="unit-fact">{existing.unit}</div></Field>
            <Field label="Order No · Style"><div className="unit-fact">{existing.order?.orderNo} · {existing.style?.styleNo}</div></Field>
          </>
        ) : (
          <>
            <Field label="Tailor" required hint={ctx.tailors.length ? null : 'No tailors on the Employee Master - Designation Tailor, Unit / Line a stitching unit.'}>
              <RecordSelect
                value={form.tailorId}
                onChange={(e) => chooseTailor(e.target.value)}
                options={ctx.tailors}
                getLabel={(t) => `${t.empName} · ${t.unitLine}`}
                placeholder="Choose the tailor"
              />
            </Field>
            <Field label="Unit">
              <div className="unit-fact">{unit || <span className="faint">From the tailor</span>}</div>
            </Field>
            <Field label="Order No" required hint={unit && !orders.length ? `No cutting posted to ${unit} yet.` : null}>
              <RecordSelect
                value={form.orderId}
                onChange={(e) => chooseOrder(e.target.value)}
                options={orderChoices}
                getValue={(o) => o.orderId}
                getLabel={(o) => `${o.orderNo}${o.buyerName ? ` (${o.buyerName})` : ''}`}
                placeholder={unit ? 'Choose the order' : 'Choose the tailor first'}
                disabled={!unit}
              />
            </Field>
            <Field label="Style" required>
              <RecordSelect
                value={form.styleId}
                onChange={(e) => set({ styleId: e.target.value })}
                options={styleChoices}
                getValue={(o) => o.styleId}
                getLabel={(o) => o.styleNo}
                placeholder={form.orderId ? 'Choose the style' : 'Choose the order first'}
                disabled={!form.orderId}
              />
            </Field>
          </>
        )}
        {isSize && (
          <>
            <Field label="Operation" required>
              <MasterSelect listCode="Operation" value={form.operation} currentValue={existing?.operation} onChange={(e) => set({ operation: e.target.value })} placeholder="Choose the operation" />
            </Field>
            <Field label="Size measurement" required hint="As measured - e.g. Free Size, 32 cm.">
              <TextInput value={form.sizeMeasurement} maxLength={60} onChange={(e) => set({ sizeMeasurement: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Pcs checked" required>
          <TextInput type="number" inputMode="numeric" min="1" step="1" value={form.pcsChecked} onChange={(e) => set({ pcsChecked: e.target.value })} />
        </Field>
        <Field label="Pcs rejected">
          <TextInput type="number" inputMode="numeric" min="0" step="1" value={form.pcsRejected} onChange={(e) => set({ pcsRejected: e.target.value })} />
        </Field>
        <Field label="Defects found" required={rejected > 0} className="span-2">
          <MultiSelect options={defectOptions} selected={form.defects} onChange={(defects) => set({ defects })} placeholder="None found" />
        </Field>
        <Field label="Inform to" required={form.defects.length > 0} hint="The defects go to this person's Action needed list.">
          <RecordSelect
            value={form.informToUserId}
            onChange={(e) => set({ informToUserId: e.target.value })}
            options={ctx.informTo}
            getLabel={personLabel}
            placeholder={ctx.informTo.length ? 'Choose the supervisor' : 'Nobody holds Inline QC Resolve'}
          />
        </Field>
        <CollapsibleField className="span-2">
          <Field label="Remarks">
            <TextArea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          </Field>
        </CollapsibleField>
      </div>
      {form.defects.length > 0 && (
        <p className="hint">
          {form.defects.length === 1 ? 'This defect goes' : `These ${form.defects.length} defects go`} to{' '}
          <strong>{ctx.informTo.find((p) => p.id === form.informToUserId)?.fullName ?? 'nobody yet'}</strong> to act on.
        </p>
      )}
    </Modal>
  );
}
