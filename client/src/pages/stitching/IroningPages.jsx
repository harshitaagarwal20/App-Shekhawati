/**
 * Ironing - after stitching, before External QC.
 *
 * ---------------------------------------------------------------------------
 *  ONE ENTRY, ANY OF THREE THINGS
 *
 *  Pieces received, pieces ironed, pieces damaged - an entry may carry one,
 *  two or all three. The balance waiting at ironing is the running sum
 *  (received - ironed - damaged + re-ironed), per source, order and style.
 *
 *  THE SOURCE (Phase 4). A stitching unit, as before; or Re-iron - pieces
 *  External QC sent back with reason "Iron"; or From Alteration Unit - pieces
 *  altered or cleaned there. Only a stitching unit names a unit, and nothing
 *  from External QC or the Alteration Unit goes back to one.
 *
 *  Every damaged piece is decided: Re-iron puts it back in the balance,
 *  Rejected sends it to the Alteration Unit as a bag ("Ironing damage").
 *  Undecided damage is flagged on every screen until it is.
 *
 *  The form checks the two limits as the numbers are typed; the server checks
 *  them again, and rolls the whole entry back if either is broken.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { alteration as alterationApi, ironing as api } from '../../services/erp.js';
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
import DateRangeFilter from '../../components/DateRangeFilter.jsx';

const n0 = (v) => fmtNum(v, { decimals: 0 });
const num = (v) => Number(v || 0);
const optionLabel = (o) => `${fmtOrderStyle(o)} · ${o.unit ?? o.sourceLabel}`;

const SOURCE_LABEL = {
  STITCHING_UNIT: 'Stitching unit',
  RE_IRON: 'Re-iron (from External QC)',
  ALTERATION_UNIT: 'From Alteration Unit',
};

/** "Unit 2 - Mahipal" for a stitching unit, the source otherwise. */
const whereFrom = (row) => (row.source && row.source !== 'STITCHING_UNIT' ? SOURCE_LABEL[row.source] : row.fromUnit);

function useIroningContext() {
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

export function IroningList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { ctx, error: ctxError } = useIroningContext();
  const [tab, setTab] = useState('entries');
  const [recording, setRecording] = useState(false);
  const [options, setOptions] = useState([]);

  const list = useResourceList((params) => api.list(params), {
    defaultSort: 'entryDate',
    defaultDir: 'desc',
    initialFilters: { source: '', orderId: '', undecidedOnly: '', dateFrom: '', dateTo: '' },
  });

  const loadOptions = useCallback(() => {
    api.orders().then(setOptions).catch(() => setOptions([]));
  }, []);
  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const totals = list.meta?.totals;
  const undecided = options.reduce((a, o) => a + num(o.pcsUndecided), 0);
  const orders = [...new Map(options.map((o) => [o.orderId, o])).values()];

  return (
    <>
      <PageHeader
        title="Ironing"
        actions={
          <>
            <ExportButton dataset="ironing" params={list.query} rowCount={list.meta.total} />
            {can('IRONING.CREATE') && (
              <button type="button" className="btn btn-primary" onClick={() => setRecording(true)}>
                Record ironing
              </button>
            )}
          </>
        }
      />

      {ctxError && <Alert kind="error">{ctxError}</Alert>}
      {undecided > 0 && (
        <Alert kind="warning">
          {n0(undecided)} damaged {undecided === 1 ? 'piece needs' : 'pieces need'} a decision - re-iron or reject.{' '}
          <button
            type="button"
            className="btn btn-link"
            onClick={() => {
              setTab('entries');
              list.setFilter('undecidedOnly', 'true');
            }}
          >
            Show them
          </button>
        </Alert>
      )}

      <div className="hourly-mode" role="tablist">
        {[
          ['entries', 'Entries'],
          ['waiting', 'Waiting at ironing'],
          ['rejects', 'Sent to Alteration Unit'],
        ].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'waiting' && <WaitingTable options={options} />}
      {tab === 'rejects' && <SentToAlteration />}

      {tab === 'entries' && (
        <>
          <div className="filter-row">
            <Field label="Source">
              <select value={list.filters.source} onChange={(e) => list.setFilter('source', e.target.value)}>
                <option value="">Every source</option>
                {Object.entries(SOURCE_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </Field>
            <Field label="Order">
              <select value={list.filters.orderId} onChange={(e) => list.setFilter('orderId', e.target.value)}>
                <option value="">All orders</option>
                {orders.map((o) => <option key={o.orderId} value={o.orderId}>{fmtOrder(o)}</option>)}
              </select>
            </Field>
            <Field label="Show">
              <select value={list.filters.undecidedOnly} onChange={(e) => list.setFilter('undecidedOnly', e.target.value)}>
                <option value="">Everything</option>
                <option value="true">Damage still to decide</option>
              </select>
            </Field>
            <DateRangeFilter filters={list.filters} setFilter={list.setFilter} fromLabel="From" toLabel="To" />
            <ClearFilters list={list} />
          </div>

          {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
          {list.loading ? (
            <Spinner label="Loading ironing" />
          ) : list.rows.length === 0 ? (
            <EmptyState title="Nothing recorded at ironing" message="Record stitched pieces as they arrive from the units, and what each ironer presses." />
          ) : (
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <SortableTh field="entryDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                    <th>Order</th>
                    <th>Style</th>
                    <SortableTh field="fromUnit" label="From" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                    <th>Ironer</th>
                    <SortableTh field="pcsReceived" label="Received" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                    <SortableTh field="pcsIroned" label="Ironed" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                    <SortableTh field="pcsDamaged" label="Damaged" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                    <th>Decided</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => navigate(`/ironing/${r.id}`)}>
                      <td className="nowrap">{fmtDate(r.entryDate)}</td>
                      <td>{r.order?.orderNo}</td>
                      <td className="code">{r.style?.styleNo}</td>
                      <td>{whereFrom(r)}</td>
                      <td>{r.ironer?.empName ?? <span className="faint">-</span>}</td>
                      <td className="num">{num(r.pcsReceived) ? n0(r.pcsReceived) : ''}</td>
                      <td className="num">{num(r.pcsIroned) ? <strong>{n0(r.pcsIroned)}</strong> : ''}</td>
                      <td className="num">
                        {num(r.pcsDamaged) ? (
                          <>
                            {n0(r.pcsDamaged)}
                            <div className="faint">{r.damageType}</div>
                          </>
                        ) : ''}
                      </td>
                      <td><DecisionText row={r} /></td>
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot>
                    <tr>
                      <td colSpan={5}><strong>All matching entries</strong> <span className="faint">· damage {totals.damagePct}</span></td>
                      <td className="num"><strong>{n0(totals.pcsReceived)}</strong></td>
                      <td className="num"><strong>{n0(totals.pcsIroned)}</strong></td>
                      <td className="num"><strong>{n0(totals.pcsDamaged)}</strong></td>
                      <td>{num(totals.pcsUndecided) > 0 && <span className="text-danger">{n0(totals.pcsUndecided)} to decide</span>}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </TableWrap>
          )}

          <Pagination meta={list.meta} page={list.page} pageSize={list.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />
        </>
      )}

      {recording && ctx && (
        <EntryModal
          ctx={ctx}
          options={options}
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            list.reload();
            loadOptions();
          }}
        />
      )}
    </>
  );
}

function DecisionText({ row }) {
  if (!num(row.pcsDamaged)) return <span className="faint">-</span>;
  const parts = [];
  if (num(row.pcsReIroned)) parts.push(`${n0(row.pcsReIroned)} re-iron`);
  if (num(row.pcsRejected)) parts.push(`${n0(row.pcsRejected)} rejected`);
  return (
    <>
      {parts.join(', ') || null}
      {num(row.pcsUndecided) > 0 && <div className="text-danger">{n0(row.pcsUndecided)} to decide</div>}
    </>
  );
}

/** Balance waiting at ironing, and what is still to come: from each unit, back from External QC, from the Alteration Unit. */
function WaitingTable({ options }) {
  const rows = options.filter((o) => num(o.balance) || num(o.pcsAvailableToReceive) || num(o.pcsUndecided));
  if (!rows.length) return <EmptyState title="Nothing waiting" message="No stitched pieces are waiting at a unit or at ironing." />;
  return (
    <TableWrap>
      <table className="data">
        <thead>
          <tr>
            <th>Order · Style · Unit</th>
            <th className="num">Stitched</th>
            <th className="num">Out for printing</th>
            <th className="num">Still to receive</th>
            <th className="num">Received</th>
            <th className="num">Waiting to iron</th>
            <th className="num">Damage to decide</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.key}>
              <td>{optionLabel(o)}</td>
              <td className="num">{o.unit ? n0(o.pcsStitched) : <span className="faint">-</span>}</td>
              <td className="num">{o.unit ? n0(o.pcsOutForPrinting) : <span className="faint">-</span>}</td>
              <td className="num">{n0(o.pcsAvailableToReceive)}</td>
              <td className="num">{n0(o.pcsReceivedAtIroning)}</td>
              <td className="num"><strong>{n0(o.balance)}</strong></td>
              <td className={`num ${num(o.pcsUndecided) ? 'text-danger' : ''}`}>{n0(o.pcsUndecided)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

/**
 * Pieces rejected at ironing, and what the Alteration Unit has done with them.
 * Phase 3's pending rejects were converted into these bags; there is nothing
 * pending here any more.
 */
function SentToAlteration() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    alterationApi
      .bags({ source: 'IRONING', status: 'ALL', pageSize: 200, sortBy: 'receivedDate', sortDir: 'desc' })
      .then((r) => setRows(Array.isArray(r) ? r : r.rows ?? []))
      .catch(() => setRows([]));
  }, []);
  if (!rows) return <Spinner label="Loading" />;
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        Pieces rejected at ironing go to the Alteration Unit as a bag with the reason "Ironing damage". What it
        cannot repair goes into the Rejected Register.
      </p>
      {rows.length === 0 ? (
        <EmptyState title="Nothing sent to the Alteration Unit" />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Order</th>
                <th>Style</th>
                <th>Unit</th>
                <th>Damage</th>
                <th className="num">Pcs</th>
                <th className="num">Altered</th>
                <th className="num">Not repairable</th>
                <th className="num">Pending</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">
                    {r.ironingEntry ? <Link to={`/ironing/${r.ironingEntry.id}`}>{fmtDate(r.receivedDate)}</Link> : fmtDate(r.receivedDate)}
                  </td>
                  <td>{r.order?.orderNo}</td>
                  <td className="code">{r.style?.styleNo}</td>
                  <td>{r.unit ?? <span className="faint">-</span>}</td>
                  <td>{r.defectType}</td>
                  <td className="num"><strong>{n0(r.qty)}</strong></td>
                  <td className="num">{n0(r.pcsAltered)}</td>
                  <td className="num">{n0(r.pcsNotRepairable)}</td>
                  <td className="num">{n0(r.balance)}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}

// ===========================================================================
//  DETAIL
// ===========================================================================

export function IroningDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { ctx } = useIroningContext();
  const [row, setRow] = useState(null);
  const [banner, setBanner] = useState(null);
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState(false);
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
      navigate('/ironing');
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
      setBusy(false);
    }
  }

  const f = row.position?.flow ?? {};
  const undecided = num(row.pcsUndecided);

  return (
    <>
      <PageHeader
        title={`Ironing - ${row.order?.orderNo} / ${row.style?.styleNo}, ${fmtDate(row.entryDate)}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/ironing')}>Back to list</button>
            {can('IRONING.DELETE') && <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>Delete</button>}
            {can('IRONING.EDIT') && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>}
            {can('IRONING.EDIT') && num(row.pcsDamaged) > 0 && (
              <button type="button" className="btn btn-primary" onClick={() => setDeciding(true)}>
                {undecided > 0 ? 'Decide damage' : 'Change decision'}
              </button>
            )}
          </>
        }
      />
      {banner && <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>{banner.text}</Alert>}
      {undecided > 0 && <Alert kind="warning">{n0(undecided)} damaged pieces on this entry still need a decision - re-iron or reject.</Alert>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">The entry</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Date" value={fmtDate(row.entryDate)} />
            <Detail label="Order No" value={row.order ? <Link to={`/orders/${row.order.id}`}>{row.order.orderNo}</Link> : '-'} sub={row.order?.buyer?.buyerName} />
            <Detail label="Style" value={row.style?.styleNo} mono sub={row.style?.styleDescription} />
            <Detail label="Source" value={row.sourceLabel ?? SOURCE_LABEL[row.source]} />
            {row.fromUnit && <Detail label="From unit" value={row.fromUnit} />}
            <Detail label="Ironer" value={row.ironer?.empName} sub={row.ironer?.empId} showEmpty />
            <Detail label="Pcs received for ironing" value={n0(row.pcsReceived)} showEmpty />
            <Detail label="Pcs ironed" value={n0(row.pcsIroned)} showEmpty />
            <Detail label="Pcs damaged in ironing" value={n0(row.pcsDamaged)} sub={row.damageType} showEmpty />
            {num(row.pcsDamaged) > 0 && (
              <>
                <Detail label="Re-iron" value={n0(row.pcsReIroned)} sub="Back into the balance" showEmpty />
                <Detail
                  label="Rejected"
                  value={n0(row.pcsRejected)}
                  sub={row.alterationReceipt
                    ? `To the Alteration Unit - ${n0(row.alterationReceipt.pcsAltered)} altered, ${n0(row.alterationReceipt.pcsNotRepairable)} not repairable (${row.alterationReceipt.status.toLowerCase()})`
                    : null}
                  showEmpty
                />
              </>
            )}
            <Detail label="Recorded by" value={row.recordedByName} sub={fmtDateTime(row.updatedAt)} />
            {row.remarks && <Detail label="Remarks" value={row.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      {row.position && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">{whereFrom(row)} on {row.order?.orderNo} / {row.style?.styleNo}</div>
          <div className="card-body">
            <DetailGrid>
              {row.fromUnit && <Detail label="Stitched" value={n0(f.stitched)} showEmpty />}
              {row.fromUnit && <Detail label="Out for printing" value={n0(f.outForPrinting)} showEmpty />}
              <Detail label={row.fromUnit ? 'Still at the unit' : 'Still to receive'} value={n0(f.availableToReceive)} showEmpty />
              <Detail label="Received at ironing" value={n0(f.receivedAtIroning)} showEmpty />
              <Detail label="Balance at ironing" value={<strong>{n0(f.balance)}</strong>} sub="Received - ironed - damaged + re-iron" showEmpty />
              <Detail label="Damage to decide" value={n0(f.undecided)} showEmpty />
              <Detail label="Ironed, waiting for External QC" value={n0(row.position.finishing?.waitingForQc)} sub="The whole order and style" showEmpty />
            </DetailGrid>
            {row.position.challans.length > 0 && (
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Cutting challan</th>
                      <th>Date</th>
                      <th className="num">Pcs issued</th>
                      <th className="num">Back at ironing</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.position.challans.map((c) => (
                      <tr key={c.id}>
                        <td className="code"><Link to={`/cutting-issues/${c.id}`}>{c.challanNo}</Link></td>
                        <td className="nowrap">{fmtDate(c.issueDate)}</td>
                        <td className="num">{n0(c.cuttingPcsIssued)}</td>
                        <td className="num">{n0(c.pcsReceivedAtIroning)}</td>
                        <td><StatusBadge status={c.ironingReceiptStatus} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </div>
        </div>
      )}

      {editing && ctx && (
        <EntryModal
          ctx={ctx}
          existing={row}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            setBanner({ kind: 'success', text: 'Ironing entry updated.' });
            await load();
          }}
        />
      )}
      {deciding && (
        <DecideModal
          row={row}
          onClose={() => setDeciding(false)}
          onSaved={async () => {
            setDeciding(false);
            setBanner({ kind: 'success', text: 'Damage decided.' });
            await load();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this ironing entry?"
          message="Its pieces come off the ironing balance and its bag in the Alteration Unit is emptied. Refused if the pieces have moved on since. The audit trail keeps a record."
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

/** Each damaged piece: re-iron (back to the balance) or rejected. */
function DecideModal({ row, onClose, onSaved }) {
  const [reIron, setReIron] = useState(String(num(row.pcsReIroned)));
  const [reject, setReject] = useState(String(num(row.pcsRejected)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const damaged = num(row.pcsDamaged);
  const left = damaged - num(reIron) - num(reject);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.update(row.id, { pcsReIroned: reIron || '0', pcsRejected: reject || '0' });
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Decide ${n0(damaged)} damaged pieces`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || left < 0} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <p className="hint" style={{ marginTop: 0 }}>Damage: {row.damageType}. Re-iron puts a piece back to be ironed again; Rejected sends it to the Alteration Unit.</p>
      <div className="form-grid">
        <Field label="Re-iron">
          <TextInput type="number" inputMode="numeric" min="0" value={reIron} onChange={(e) => setReIron(e.target.value)} />
        </Field>
        <Field label="Rejected" hint='To the Alteration Unit, reason "Ironing damage"'>
          <TextInput type="number" inputMode="numeric" min="0" value={reject} onChange={(e) => setReject(e.target.value)} />
        </Field>
        <Field label="Still to decide" error={left < 0 ? 'More decided than were damaged' : undefined}>
          <div className={`unit-fact ${left !== 0 ? 'text-danger' : ''}`}>{n0(left)}</div>
        </Field>
      </div>
    </Modal>
  );
}

// ===========================================================================
//  THE FORM
// ===========================================================================

function EntryModal({ ctx, options = [], existing, onClose, onSaved }) {
  const editing = Boolean(existing);
  const [form, setForm] = useState(() => ({
    entryDate: existing ? String(existing.entryDate).slice(0, 10) : ctx.today,
    source: existing?.source ?? 'STITCHING_UNIT',
    key: '',
    ironerId: existing?.ironerId ?? '',
    pcsReceived: existing ? String(num(existing.pcsReceived) || '') : '',
    pcsIroned: existing ? String(num(existing.pcsIroned) || '') : '',
    pcsDamaged: existing ? String(num(existing.pcsDamaged) || '') : '',
    damageType: existing?.damageType ?? '',
    pcsReIroned: existing ? String(num(existing.pcsReIroned) || '') : '',
    pcsRejected: existing ? String(num(existing.pcsRejected) || '') : '',
    remarks: existing?.remarks ?? '',
  }));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The unit's figures, less this entry's own share when it is being edited.
  const choices = options.filter((o) => o.source === form.source);
  const choice = editing ? null : choices.find((o) => o.key === form.key);
  const fromAUnit = (editing ? existing.source ?? 'STITCHING_UNIT' : form.source) === 'STITCHING_UNIT';
  const [flow, setFlow] = useState(null);
  useEffect(() => {
    if (!editing) {
      setFlow(choice
        ? { atUnit: num(choice.pcsAvailableToReceive), balance: num(choice.balance) }
        : null);
      return;
    }
    const f = existing.position?.flow;
    if (!f) return;
    setFlow({
      atUnit: num(f.availableToReceive) + num(existing.pcsReceived),
      balance: num(f.balance) - num(existing.pcsReceived) + num(existing.pcsIroned) + num(existing.pcsDamaged) - num(existing.pcsReIroned),
    });
  }, [editing, choice, existing]);

  const received = num(form.pcsReceived);
  const worked = num(form.pcsIroned) + num(form.pcsDamaged) - num(form.pcsReIroned);
  const damaged = num(form.pcsDamaged);
  const decided = num(form.pcsReIroned) + num(form.pcsRejected);

  const problems = [];
  if (flow && received > flow.atUnit) {
    problems.push(fromAUnit
      ? `Only ${n0(flow.atUnit)} pieces are still at the unit (stitched, not out for printing, not already received).`
      : `Only ${n0(flow.atUnit)} pieces have been sent back and not yet received.`);
  }
  if (flow && worked > flow.balance + received) problems.push(`Only ${n0(flow.balance + received)} pieces are waiting at ironing - ironed + damaged cannot be more.`);
  if (damaged > 0 && !form.damageType) problems.push('Choose the damage type.');
  if (decided > damaged) problems.push('Re-iron and rejected cannot be more than were damaged.');
  if ((num(form.pcsIroned) + damaged) > 0 && !form.ironerId) problems.push('Choose the ironer.');
  const empty = received + num(form.pcsIroned) + damaged <= 0;
  const ready = (editing || choice) && !empty && problems.length === 0 && !busy;

  async function save() {
    setBusy(true);
    setError('');
    const body = {
      entryDate: form.entryDate,
      ironerId: form.ironerId || null,
      pcsReceived: form.pcsReceived || '0',
      pcsIroned: form.pcsIroned || '0',
      pcsDamaged: form.pcsDamaged || '0',
      damageType: damaged > 0 ? form.damageType : null,
      pcsReIroned: form.pcsReIroned || '0',
      pcsRejected: form.pcsRejected || '0',
      remarks: form.remarks || null,
    };
    try {
      if (editing) await api.update(existing.id, body);
      else {
        await api.create({
          ...body,
          source: form.source,
          orderId: choice.orderId,
          styleId: choice.styleId,
          ...(fromAUnit ? { fromUnit: choice.unit } : {}),
        });
      }
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const qtyBox = (name, label, extra = {}) => (
    <Field label={label} {...extra}>
      <TextInput type="number" inputMode="numeric" min="0" step="1" value={form[name]} onChange={(e) => set({ [name]: e.target.value })} />
    </Field>
  );

  return (
    <Modal
      title={editing ? 'Edit ironing entry' : 'Record ironing'}
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
        {editing ? (
          <Field label="Order · Style · From">
            <div className="unit-fact">{existing.order?.orderNo} · {existing.style?.styleNo} · {whereFrom(existing)}</div>
          </Field>
        ) : (
          <>
            <Field label="Source" required hint="Re-iron and altered pieces never come from, or go back to, a stitching unit.">
              <select value={form.source} onChange={(e) => set({ source: e.target.value, key: '' })}>
                {Object.entries(SOURCE_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </Field>
            <Field
              label={fromAUnit ? 'Order · Style · From unit' : 'Order · Style'}
              required
              hint={fromAUnit ? 'Units that have stitched the order.' : 'Orders with pieces sent back to ironing.'}
            >
              <RecordSelect
                value={form.key}
                onChange={(e) => {
                  /*
                   * PRE-FILLED from where the order stands: received = all still
                   * at the unit, ironed = everything that will then be waiting
                   * at ironing. The ironer only types the damaged pieces, and
                   * takes them off Ironed.
                   */
                  const o = choices.find((x) => x.key === e.target.value);
                  const atUnit = num(o?.pcsAvailableToReceive);
                  const waiting = atUnit + num(o?.balance);
                  set({
                    key: e.target.value,
                    pcsReceived: atUnit > 0 ? String(atUnit) : '',
                    pcsIroned: waiting > 0 ? String(waiting) : '',
                  });
                }}
                options={choices}
                getValue={(o) => o.key}
                getLabel={optionLabel}
                placeholder={choices.length ? 'Choose' : fromAUnit ? 'Nothing stitched yet' : 'Nothing sent back'}
              />
            </Field>
          </>
        )}
        <Field label="Ironer" hint="Needed when anything is ironed or damaged.">
          <RecordSelect value={form.ironerId} onChange={(e) => set({ ironerId: e.target.value })} options={ctx.ironers} getValue={(i) => i.id} getLabel={(i) => `${i.empName} (${i.empId})`} placeholder={ctx.ironers.length ? 'Choose the ironer' : 'No ironers in the Employee master'} />
        </Field>
      </div>

      {flow && (
        <p className="hint" style={{ margin: '0 0 10px' }}>
          {fromAUnit ? 'Still at the unit' : 'Still to receive'}: <strong>{n0(flow.atUnit)}</strong> · Waiting at ironing: <strong>{n0(flow.balance)}</strong>
        </p>
      )}

      <div className="form-grid">
        {qtyBox('pcsReceived', 'Pcs received for ironing')}
        {qtyBox('pcsIroned', 'Pcs ironed')}
        {qtyBox('pcsDamaged', 'Pcs damaged in ironing')}
        {damaged > 0 && (
          <>
            <Field label="Damage type" required>
              <RecordSelect value={form.damageType} onChange={(e) => set({ damageType: e.target.value })} options={ctx.damageTypes.map((d) => ({ id: d, name: d }))} placeholder="Choose" />
            </Field>
            {qtyBox('pcsReIroned', 'Re-iron', { hint: 'Back into the balance. May be decided later.' })}
            {qtyBox('pcsRejected', 'Rejected', { hint: 'To the Alteration Unit: "Ironing damage".' })}
          </>
        )}
        <CollapsibleField className="span-2">
          <Field label="Remarks">
            <TextArea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          </Field>
        </CollapsibleField>
      </div>
    </Modal>
  );
}
