/**
 * External QC - the secondary check by an external agency, after ironing.
 *
 * ---------------------------------------------------------------------------
 *  THE FIELDS, AND WHO FILLS THEM
 *
 *      Date                  AUTO (today), may be moved back, never forward
 *      Order No / Style      DROPDOWN / AUTO - orders ironing has pressed
 *      Agency                DROPDOWN - Vendor Master, category External QC
 *      Inspector             MANUAL
 *      Ironed qty available  AUTO - ironed, less what QC was offered already
 *      Pcs Offered           MANUAL
 *      Approved / Alteration / Rejected            MANUAL - must add up to offered
 *      Reasons per box: Alter, Iron, Defected, Spoiled, Other   MANUAL - must add up to the box
 *      Checker codes + pcs   MANUAL, optional - the number marked on the bag
 *      Inspection report     photo or PDF, optional
 *      Remarks
 *
 *  WHERE THE PIECES GO: Approved waits for Humidity Checking. "Iron" in
 *  either box goes back to Ironing (source Re-iron). Every other reason goes
 *  to the Alteration Unit - never back to a stitching unit.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { externalQc as api } from '../../services/erp.js';
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
  ViewTabs,
} from '../../components/ui.jsx';
import { Detail, DetailGrid } from '../shared/Detail.jsx';
import { fmtDate, fmtDateTime, fmtNum } from '../../utils/format.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

/**
 * The Rejected Register is a tab here rather than a sidebar link: it is where
 * the pieces this inspection rejects end up. See ViewTabs.
 */
export const QC_TABS = [
  { key: 'inspections', label: 'Inspections', to: '/external-qc', permission: 'EXTERNAL_QC.VIEW' },
  { key: 'rejected', label: 'Rejected Register', to: '/rejected-register', permission: 'REJECTED_REGISTER.VIEW' },
];

const n0 = (v) => fmtNum(v, { decimals: 0 });
const num = (v) => Number(v || 0);

const REASONS = [
  { key: 'Alter', suffix: 'Alter' },
  { key: 'Iron', suffix: 'Iron' },
  { key: 'Defected', suffix: 'Defected' },
  { key: 'Spoiled', suffix: 'Spoiled' },
  { key: 'Other', suffix: 'Other' },
];
const BOXES = [
  { box: 'ALTERATION', label: 'Alteration', total: 'pcsAlteration', prefix: 'alt' },
  { box: 'REJECTED', label: 'Rejected', total: 'pcsRejected', prefix: 'rej' },
];
const REASON_FIELDS = BOXES.flatMap((b) => REASONS.map((r) => `${b.prefix}${r.suffix}`));
const optionLabel = (o) => `${o.orderNo} · ${o.styleNo}${o.buyerName ? ` (${o.buyerName})` : ''}`;
const pct = (part, whole) => (num(whole) > 0 ? `${((num(part) / num(whole)) * 100).toFixed(1)}%` : '-');

function useQcContext() {
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.context().then(setCtx).catch((e) => setError(e.message));
  }, []);
  return { ctx, error };
}

// ===========================================================================
//  LIST
// ===========================================================================

export function ExternalQcList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { ctx, error: ctxError } = useQcContext();
  const [options, setOptions] = useState([]);
  const [recording, setRecording] = useState(false);
  const list = useResourceList((params) => api.list(params), {
    defaultSort: 'entryDate',
    defaultDir: 'desc',
    initialFilters: { orderId: '', agencyId: '', checkerCode: '', dateFrom: '', dateTo: '' },
  });
  const loadOptions = useCallback(() => {
    api.orders().then(setOptions).catch(() => setOptions([]));
  }, []);
  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const totals = list.meta?.totals;
  const waiting = options.filter((o) => num(o.pcsAvailable) > 0);
  const orders = [...new Map(options.map((o) => [o.orderId, o])).values()];

  return (
    <>
      <PageHeader
        title="External QC"
        actions={
          <>
            <ExportButton dataset="external-qc" params={list.query} rowCount={list.meta.total} />
            {can('EXTERNAL_QC.CREATE') && (
              <button type="button" className="btn btn-primary" onClick={() => setRecording(true)}>
                Record inspection
              </button>
            )}
          </>
        }
      />
      <ViewTabs active="inspections" tabs={QC_TABS} />
      {ctxError && <Alert kind="error">{ctxError}</Alert>}

      {waiting.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Ironed, waiting for External QC</div>
          <div className="card-body">
            <TableWrap>
              <table className="data">
                <thead>
                  <tr><th>Order · Style</th><th className="num">Ironed</th><th className="num">Offered so far</th><th className="num">Available</th></tr>
                </thead>
                <tbody>
                  {waiting.map((o) => (
                    <tr key={o.key}>
                      <td>{optionLabel(o)}</td>
                      <td className="num">{n0(o.pcsIroned)}</td>
                      <td className="num">{n0(o.pcsOffered)}</td>
                      <td className="num"><strong>{n0(o.pcsAvailable)}</strong></td>
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
            {orders.map((o) => <option key={o.orderId} value={o.orderId}>{o.orderNo}</option>)}
          </select>
        </Field>
        <Field label="Agency">
          <select value={list.filters.agencyId} onChange={(e) => list.setFilter('agencyId', e.target.value)}>
            <option value="">All agencies</option>
            {(ctx?.agencies ?? []).map((a) => <option key={a.id} value={a.id}>{a.vendorName}</option>)}
          </select>
        </Field>
        <Field label="Checker code">
          <TextInput value={list.filters.checkerCode} onChange={(e) => list.setFilter('checkerCode', e.target.value)} placeholder="Code on the bag" />
        </Field>
        <Field label="From">
          <TextInput type="date" value={list.filters.dateFrom} onChange={(e) => list.setFilter('dateFrom', e.target.value)} />
        </Field>
        <Field label="To">
          <TextInput type="date" value={list.filters.dateTo} onChange={(e) => list.setFilter('dateTo', e.target.value)} />
        </Field>
      </div>

      {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
      {list.loading ? (
        <Spinner label="Loading External QC" />
      ) : list.rows.length === 0 ? (
        <EmptyState title="No inspections recorded" message="Record what the agency found with “Record inspection”." />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="entryDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Order</th>
                <th>Style</th>
                <th>Agency</th>
                <SortableTh field="pcsOffered" label="Offered" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="pcsApproved" label="Approved" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="pcsAlteration" label="Alteration" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="pcsRejected" label="Rejected" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th className="num">Approved %</th>
                <th className="num">Back to ironing</th>
                <th className="num">To Alteration Unit</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/external-qc/${r.id}`)}>
                  <td className="nowrap">{fmtDate(r.entryDate)}</td>
                  <td>{r.order?.orderNo}</td>
                  <td className="code">{r.style?.styleNo}</td>
                  <td>{r.agency?.vendorName}</td>
                  <td className="num">{n0(r.pcsOffered)}</td>
                  <td className="num"><strong>{n0(r.pcsApproved)}</strong></td>
                  <td className="num">{n0(r.pcsAlteration)}</td>
                  <td className="num">{n0(r.pcsRejected)}</td>
                  <td className="num">{r.approvedPct}</td>
                  <td className="num">{n0(r.pcsIron)}</td>
                  <td className="num">{n0(r.pcsToAlterationUnit)}</td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  <td colSpan={4}><strong>All matching inspections</strong></td>
                  <td className="num"><strong>{n0(totals.pcsOffered)}</strong></td>
                  <td className="num"><strong>{n0(totals.pcsApproved)}</strong></td>
                  <td className="num"><strong>{n0(totals.pcsAlteration)}</strong></td>
                  <td className="num"><strong>{n0(totals.pcsRejected)}</strong></td>
                  <td className="num"><strong>{totals.approvedPct}</strong></td>
                  <td className="num"><strong>{n0(totals.pcsIron)}</strong></td>
                  <td className="num"><strong>{n0(num(totals.pcsAlteration) + num(totals.pcsRejected) - num(totals.pcsIron))}</strong></td>
                </tr>
              </tfoot>
            )}
          </table>
        </TableWrap>
      )}

      <Pagination meta={list.meta} page={list.page} pageSize={list.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />

      {recording && ctx && (
        <QcModal
          ctx={ctx}
          options={options}
          onClose={() => setRecording(false)}
          onSaved={(saved) => {
            setRecording(false);
            loadOptions();
            navigate(`/external-qc/${saved.id}`);
          }}
        />
      )}
    </>
  );
}

// ===========================================================================
//  DETAIL
// ===========================================================================

export function ExternalQcDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { ctx } = useQcContext();
  const [row, setRow] = useState(null);
  const [banner, setBanner] = useState(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

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
      navigate('/external-qc');
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
      setBusy(false);
    }
  }

  async function attach(file) {
    if (!file) return;
    try {
      await api.attachments.upload(row.id, file);
      setBanner({ kind: 'success', text: `${file.name} attached.` });
      await load();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    }
  }

  async function detach(a) {
    try {
      await api.attachments.remove(row.id, a.id);
      await load();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    }
  }

  const f = row.position?.flow ?? {};

  return (
    <>
      <PageHeader
        title={`External QC - ${row.order?.orderNo} / ${row.style?.styleNo}, ${fmtDate(row.entryDate)}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/external-qc')}>Back to list</button>
            {can('EXTERNAL_QC.DELETE') && <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>Delete</button>}
            {can('EXTERNAL_QC.EDIT') && <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>Edit</button>}
          </>
        }
      />
      {banner && <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>{banner.text}</Alert>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">The inspection</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Date" value={fmtDate(row.entryDate)} />
            <Detail label="Order No" value={row.order ? <Link to={`/orders/${row.order.id}`}>{row.order.orderNo}</Link> : '-'} sub={row.order?.buyer?.buyerName} />
            <Detail label="Style" value={row.style?.styleNo} mono sub={row.style?.styleDescription} />
            <Detail label="Agency" value={row.agency?.vendorName} sub={row.inspectorName ? `Inspector: ${row.inspectorName}` : null} />
            <Detail label="Pcs offered" value={<strong>{n0(row.pcsOffered)}</strong>} />
            <Detail label="Approved" value={n0(row.pcsApproved)} sub={`${row.approvedPct} - to Humidity Checking`} showEmpty />
            <Detail label="Alteration" value={n0(row.pcsAlteration)} sub={row.alterationPct} showEmpty />
            <Detail label="Rejected" value={n0(row.pcsRejected)} sub={row.rejectedPct} showEmpty />
            <Detail label="Recorded by" value={row.recordedByName} sub={fmtDateTime(row.updatedAt)} />
            {row.remarks && <Detail label="Remarks" value={row.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Faulty pieces, by reason - and where they went</div>
        <div className="card-body">
          <ReasonTable values={row} readOnly />
        </div>
      </div>

      {row.bags?.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">In the Alteration Unit</div>
          <div className="card-body">
            <TableWrap>
              <table className="data">
                <thead>
                  <tr><th>Box</th><th>Reason</th><th className="num">Sent</th><th className="num">Altered</th><th className="num">Not repairable</th><th className="num">Pending</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {row.bags.map((b) => (
                    <tr key={b.id}>
                      <td>{b.box === 'REJECTED' ? 'Rejected' : 'Alteration'}</td>
                      <td>{b.reason}</td>
                      <td className="num">{n0(b.qty)}</td>
                      <td className="num">{n0(b.pcsAltered)}</td>
                      <td className="num">{n0(b.pcsNotRepairable)}</td>
                      <td className="num"><strong>{n0(b.balance)}</strong></td>
                      <td><StatusBadge status={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Checker codes</div>
        <div className="card-body">
          {row.checkers?.length ? (
            <TableWrap>
              <table className="data">
                <thead><tr><th>Checker code</th><th>Checker</th><th className="num">Pcs traced</th></tr></thead>
                <tbody>
                  {row.checkers.map((c) => (
                    <tr key={c.id}>
                      <td className="code">{c.checkerCode}</td>
                      <td>{c.employee?.empName ?? <span className="faint">not on the Employee Master</span>}</td>
                      <td className="num">{n0(c.pcs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="faint" style={{ margin: 0 }}>No checker codes were noted.</p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Inspection report</div>
        <div className="card-body">
          {row.attachments?.length ? (
            <ul className="plain-list">
              {row.attachments.map((a) => (
                <li key={a.id}>
                  <button type="button" className="btn btn-link" onClick={() => api.attachments.open(row.id, a.id, a.fileName)}>{a.fileName}</button>
                  <span className="faint"> {Math.ceil(a.sizeBytes / 1024)} KB · {a.uploadedByName} · {fmtDateTime(a.createdAt)}</span>
                  {can('EXTERNAL_QC.EDIT') && <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => detach(a)}>Remove</button>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="faint" style={{ marginTop: 0 }}>No report attached.</p>
          )}
          {can('EXTERNAL_QC.EDIT') && (
            <>
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf" hidden onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Attach a photo or PDF</button>
            </>
          )}
        </div>
      </div>

      <FlowCard flow={f} title={`${row.order?.orderNo} / ${row.style?.styleNo} - where the pieces are now`} />

      {editing && ctx && (
        <QcModal
          ctx={ctx}
          existing={row}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            setBanner({ kind: 'success', text: 'Inspection updated.' });
            await load();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this inspection?"
          message="Its pieces go back to waiting for External QC and its bags leave the Alteration Unit. Refused once a bag has been worked or its Iron pieces received at ironing. The audit trail keeps a record."
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

/** Every stage of the order and style after the stitching units, net. */
export function FlowCard({ flow, title }) {
  if (!flow || flow.receivedFromUnits === undefined) return null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">{title}</div>
      <div className="card-body">
        <DetailGrid>
          <Detail label="Received at ironing from the units" value={n0(flow.receivedFromUnits)} showEmpty />
          <Detail label="At ironing" value={n0(num(flow.atIroning) + num(flow.damageUndecided))} showEmpty />
          <Detail label="Ironed, waiting for External QC" value={n0(flow.waitingForQc)} showEmpty />
          <Detail label="Approved (to Humidity)" value={n0(flow.approved)} showEmpty />
          <Detail label="Sent back to re-iron" value={n0(flow.reIronPending)} showEmpty />
          <Detail label="At the Alteration Unit" value={n0(flow.atAlteration)} showEmpty />
          <Detail label="Altered, waiting for ironing" value={n0(flow.alteredPending)} showEmpty />
          <Detail label="Rejected Register" value={n0(flow.rejected)} showEmpty />
        </DetailGrid>
      </div>
    </div>
  );
}

/**
 * The reasons grid: one row per reason, a column per faulty box. Editable in
 * the form, read-only on the detail. Each column must add up to its box.
 */
function ReasonTable({ values, onChange, readOnly = false }) {
  const colSum = (b) => REASONS.reduce((a, r) => a + num(values[`${b.prefix}${r.suffix}`]), 0);
  return (
    <TableWrap>
      <table className="data qc-reasons">
        <thead>
          <tr>
            <th>Reason</th>
            {BOXES.map((b) => <th key={b.box} className="num">{b.label} box</th>)}
            <th>Goes to</th>
          </tr>
        </thead>
        <tbody>
          {REASONS.map((r) => (
            <tr key={r.key}>
              <td>{r.key}</td>
              {BOXES.map((b) => {
                const field = `${b.prefix}${r.suffix}`;
                return (
                  <td key={field} className="num">
                    {readOnly ? (
                      n0(values[field])
                    ) : (
                      <TextInput
                        type="number"
                        inputMode="numeric"
                        min="0"
                        aria-label={`${b.label} - ${r.key}`}
                        value={values[field]}
                        onChange={(e) => onChange({ [field]: e.target.value })}
                      />
                    )}
                  </td>
                );
              })}
              <td className="faint">{r.key === 'Iron' ? 'Ironing (Re-iron)' : 'Alteration Unit'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td><strong>Reasons add up to</strong></td>
            {BOXES.map((b) => {
              const ok = colSum(b) === num(values[b.total]);
              return (
                <td key={b.box} className={`num ${ok ? '' : 'text-danger'}`}>
                  <strong>{n0(colSum(b))}</strong> <span className="faint">of {n0(values[b.total])}</span>
                </td>
              );
            })}
            <td />
          </tr>
        </tfoot>
      </table>
    </TableWrap>
  );
}

// ===========================================================================
//  THE FORM
// ===========================================================================

const blankCheckers = () => [{ checkerCode: '', pcs: '' }];

function QcModal({ ctx, options = [], existing, onClose, onSaved }) {
  const editing = Boolean(existing);
  const [form, setForm] = useState(() => ({
    entryDate: existing ? String(existing.entryDate).slice(0, 10) : ctx.today,
    key: '',
    agencyId: existing?.agencyId ?? (ctx.agencies.length === 1 ? ctx.agencies[0].id : ''),
    inspectorName: existing?.inspectorName ?? '',
    pcsOffered: existing ? String(num(existing.pcsOffered)) : '',
    pcsApproved: existing ? String(num(existing.pcsApproved)) : '',
    pcsAlteration: existing ? String(num(existing.pcsAlteration) || '') : '',
    pcsRejected: existing ? String(num(existing.pcsRejected) || '') : '',
    ...Object.fromEntries(REASON_FIELDS.map((k) => [k, existing ? String(num(existing[k]) || '') : ''])),
    remarks: existing?.remarks ?? '',
  }));
  const [checkers, setCheckers] = useState(() =>
    existing?.checkers?.length ? existing.checkers.map((c) => ({ checkerCode: c.checkerCode, pcs: String(num(c.pcs)) })) : blankCheckers());
  const [file, setFile] = useState(null);
  /*
   * APPROVED FOLLOWS THE OTHER TWO until somebody types in it: offered less
   * alteration less rejected, which is what it must equal anyway. Typing in
   * Approved takes it over, as does an edit, which starts from saved figures.
   */
  const [approvedTyped, setApprovedTyped] = useState(editing);
  const set = (patch) =>
    setForm((f) => {
      const next = { ...f, ...patch };
      if (approvedTyped || 'pcsApproved' in patch) return next;
      if (!('pcsOffered' in patch || 'pcsAlteration' in patch || 'pcsRejected' in patch)) return next;
      const rest = num(next.pcsOffered) - num(next.pcsAlteration) - num(next.pcsRejected);
      return { ...next, pcsApproved: next.pcsOffered === '' ? '' : String(Math.max(0, rest)) };
    });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choice = editing ? null : options.find((o) => o.key === form.key);
  // On an edit, this entry's own offered pieces are back in what is available.
  const available = editing
    ? num(existing.position?.flow?.waitingForQc) + num(existing.pcsOffered)
    : choice ? num(choice.pcsAvailable) : null;

  const offered = num(form.pcsOffered);
  const boxes = num(form.pcsApproved) + num(form.pcsAlteration) + num(form.pcsRejected);
  const sumOf = (b) => REASONS.reduce((a, r) => a + num(form[`${b.prefix}${r.suffix}`]), 0);
  const iron = num(form.altIron) + num(form.rejIron);
  const toAlteration = num(form.pcsAlteration) + num(form.pcsRejected) - iron;
  const traced = checkers.reduce((a, c) => a + num(c.pcs), 0);

  // These two are shown where they happen - under Pcs offered and in the
  // tally - so they block Save without being repeated in the warning.
  const overAvailable = available != null && offered > available;
  const boxesOff = offered > 0 && boxes !== offered;
  const problems = [];
  for (const b of BOXES) {
    if (sumOf(b) !== num(form[b.total])) problems.push(`The ${b.label} box holds ${n0(form[b.total])} but its reasons add up to ${n0(sumOf(b))}.`);
  }
  if (traced > num(form.pcsAlteration) + num(form.pcsRejected)) problems.push('More pieces are traced to checker codes than were faulty.');
  if (checkers.some((c) => num(c.pcs) > 0 && !c.checkerCode.trim())) problems.push('Give the checker code for every line with pieces.');
  const ready = (editing || choice) && form.agencyId && offered > 0 && !overAvailable && !boxesOff && problems.length === 0 && !busy;
  // A greyed-out Save says nothing on its own; this says what it is waiting for.
  const waitingFor = busy ? ''
    : !editing && !choice ? 'Choose the order to save.'
      : !form.agencyId ? 'Choose the agency to save.'
        : offered <= 0 ? 'Enter the pieces offered to save.'
          : overAvailable || boxesOff || problems.length ? 'Fix the figures above to save.' : '';

  async function save() {
    setBusy(true);
    setError('');
    const body = {
      entryDate: form.entryDate,
      agencyId: form.agencyId,
      inspectorName: form.inspectorName || null,
      pcsOffered: form.pcsOffered || '0',
      pcsApproved: form.pcsApproved || '0',
      pcsAlteration: form.pcsAlteration || '0',
      pcsRejected: form.pcsRejected || '0',
      ...Object.fromEntries(REASON_FIELDS.map((k) => [k, form[k] || '0'])),
      checkers: checkers.filter((c) => c.checkerCode.trim() || num(c.pcs)).map((c) => ({ checkerCode: c.checkerCode, pcs: c.pcs || '0' })),
      remarks: form.remarks || null,
    };
    try {
      const saved = editing
        ? await api.update(existing.id, body)
        : await api.create({ ...body, orderId: choice.orderId, styleId: choice.styleId });
      if (file) {
        try {
          await api.attachments.upload(saved.id, file);
        } catch (e) {
          // The inspection is saved; the file can be attached from its page.
          setError(`Saved, but the report was not attached: ${e.message}`);
          setBusy(false);
          onSaved(saved);
          return;
        }
      }
      onSaved(saved);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const qty = (name, label, extra = {}) => (
    <Field label={label} {...extra}>
      <TextInput
        type="number"
        inputMode="numeric"
        min="0"
        step="1"
        value={form[name]}
        onChange={(e) => {
          if (name === 'pcsApproved') setApprovedTyped(true);
          set({ [name]: e.target.value });
        }}
      />
    </Field>
  );

  return (
    <Modal
      title={editing ? 'Edit inspection' : 'Record an External QC inspection'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {waitingFor && <span className="modal-footer-note">{waitingFor}</span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {!editing && options.length === 0 && (
        <Alert kind="info">Nothing is waiting for External QC. An order appears here once Ironing has pressed it.</Alert>
      )}

      <div className="form-grid four">
        <div className="fieldset-title">What was inspected</div>
        <Field label="Date" required>
          <TextInput type="date" value={form.entryDate} max={ctx.today} onChange={(e) => set({ entryDate: e.target.value })} />
        </Field>
        {editing ? (
          <Field label="Order No · Style"><div className="unit-fact">{existing.order?.orderNo} · {existing.style?.styleNo}</div></Field>
        ) : (
          <Field label="Order No · Style" required hint="Orders ironing has pressed.">
            <RecordSelect
              value={form.key}
              onChange={(e) => {
                // Pre-filled: everything ironed and waiting is offered.
                const o = options.find((x) => x.key === e.target.value);
                const avail = num(o?.pcsAvailable);
                set({ key: e.target.value, pcsOffered: avail > 0 ? String(avail) : '' });
              }}
              options={options} getValue={(o) => o.key} getLabel={optionLabel} placeholder={options.length ? 'Choose the order' : 'Nothing ironed yet'} />
          </Field>
        )}
        <Field label="Agency" required>
          <RecordSelect value={form.agencyId} onChange={(e) => set({ agencyId: e.target.value })} options={ctx.agencies} getLabel={(a) => a.vendorName} placeholder={ctx.agencies.length ? 'Choose the agency' : 'No External QC vendors on the Vendor Master'} />
        </Field>
        <Field label="Inspector">
          <TextInput value={form.inspectorName} maxLength={120} placeholder="Agency inspector's name" onChange={(e) => set({ inspectorName: e.target.value })} />
        </Field>
      </div>

      <div className="fieldset-title">The result</div>
      <div className="qc-boxes">
        {qty('pcsOffered', 'Pcs offered', {
          required: true,
          hint: available == null ? 'Choose the order first.' : `${n0(available)} ironed and waiting.`,
          error: available != null && offered > available ? `Only ${n0(available)} available.` : undefined,
        })}
        {qty('pcsApproved', 'Approved', { hint: 'Goes on to Humidity Checking.' })}
        {qty('pcsAlteration', 'Alteration')}
        {qty('pcsRejected', 'Rejected')}
      </div>
      <QcTally offered={offered} approved={num(form.pcsApproved)} alteration={num(form.pcsAlteration)} rejected={num(form.pcsRejected)} />

      {num(form.pcsAlteration) + num(form.pcsRejected) > 0 && (
        <>
          <h4 className="form-section">A reason for every faulty piece</h4>
          <ReasonTable values={form} onChange={set} />
          <p className="hint">
            <strong>{n0(iron)}</strong> back to Ironing (Re-iron) · <strong>{n0(toAlteration)}</strong> to the Alteration Unit ·{' '}
            {pct(form.pcsApproved, offered)} approved. Nothing goes back to a stitching unit.
          </p>

          <h4 className="form-section">Checker codes (optional)</h4>
          <p className="hint" style={{ marginTop: 0 }}>The number marked on the bag, and how many faulty pieces it carried.</p>
          <datalist id="qc-checker-codes">
            {ctx.checkers.map((c) => <option key={c.id} value={c.empId}>{c.empName}</option>)}
          </datalist>
          {checkers.map((c, i) => (
            <div key={i} className="qc-checker-line">
              <TextInput list="qc-checker-codes" placeholder="Checker code" maxLength={30} value={c.checkerCode}
                onChange={(e) => setCheckers((all) => all.map((x, j) => (j === i ? { ...x, checkerCode: e.target.value } : x)))} />
              <TextInput type="number" inputMode="numeric" min="0" placeholder="Pcs" value={c.pcs}
                onChange={(e) => setCheckers((all) => all.map((x, j) => (j === i ? { ...x, pcs: e.target.value } : x)))} />
              <button type="button" className="btn btn-sm" onClick={() => setCheckers((all) => (all.length > 1 ? all.filter((_, j) => j !== i) : blankCheckers()))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => setCheckers((all) => [...all, { checkerCode: '', pcs: '' }])}>Add a checker code</button>
        </>
      )}

      {problems.length > 0 && (
        <Alert kind="warning">
          {problems.length === 1 ? problems[0] : <ul className="plain-list" style={{ margin: 0 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </Alert>
      )}

      <div className="form-grid">
        <div className="fieldset-title">{editing ? 'Remarks' : 'Report and remarks'}</div>
        {!editing && (
          <Field label="Inspection report" hint="A photo or a PDF, optional.">
            <div className="file-pick">
              <label className="btn btn-sm">
                {file ? 'Change…' : 'Choose a file…'}
                <input
                  type="file"
                  className="sr-only"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
                />
              </label>
              {file ? (
                <>
                  <span className="file-pick-name" title={file.name}>{file.name}</span>
                  <button type="button" className="link-button" onClick={() => setFile(null)}>Remove</button>
                </>
              ) : (
                <span className="faint">No file chosen</span>
              )}
            </div>
          </Field>
        )}
        <CollapsibleField className={editing ? 'span-2' : 'span-rest'}>
          <Field label="Remarks">
            <TextArea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          </Field>
        </CollapsibleField>
      </div>
    </Modal>
  );
}

/**
 * Where the offered pieces went, as one bar: the three boxes side by side,
 * and a line saying whether they account for every piece offered. Replaces a
 * bare "0 of 0" that said the same thing less plainly.
 */
function QcTally({ offered, approved, alteration, rejected }) {
  const placed = approved + alteration + rejected;
  const scale = Math.max(offered, placed, 1);
  const w = (v) => `${(v / scale) * 100}%`;
  const state = offered <= 0 ? 'idle' : placed === offered ? 'ok' : placed > offered ? 'over' : 'short';
  const text = {
    idle: 'Enter the pieces offered, then split them across the three boxes.',
    ok: `All ${n0(offered)} accounted for · ${pct(approved, offered)} approved.`,
    short: `${n0(placed)} of ${n0(offered)} placed · ${n0(offered - placed)} still to place.`,
    over: `${n0(placed)} placed · ${n0(placed - offered)} more than the ${n0(offered)} offered.`,
  }[state];
  return (
    <div className={`qc-tally is-${state}`}>
      <div className="qc-tally-bar" aria-hidden="true">
        <span className="is-approved" style={{ width: w(approved) }} />
        <span className="is-alteration" style={{ width: w(alteration) }} />
        <span className="is-rejected" style={{ width: w(rejected) }} />
      </div>
      <div className="qc-tally-text" role="status">{text}</div>
    </div>
  );
}
