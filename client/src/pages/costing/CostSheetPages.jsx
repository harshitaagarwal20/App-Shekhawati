/**
 * Style cost sheets - FOB costing.
 *
 * Nothing on these screens multiplies anything the server stores. Rates,
 * consumptions and percentages are typed here; every amount, total and the
 * FOB come back from the server (domain/costing.js), which is the only place
 * the formula lives. The one exception is a live "if you saved now" preview
 * of a line amount while it is being typed, which is labelled as such.
 *
 * Percentages are shown and typed as percentages (12) and sent as fractions
 * (0.12), the same convention the order excess uses.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { costSheets as api, orders as ordersApi, styles as stylesApi } from '../../services/erp.js';
import {
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
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { fmtDate, fmtDateTime } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Awaiting Director' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'SUPERSEDED', label: 'Superseded' },
];

const BADGE = {
  DRAFT: 'badge-inactive',
  PENDING_APPROVAL: 'badge-pending',
  APPROVED: 'badge-approved',
  REJECTED: 'badge-rejected',
  SUPERSEDED: 'badge-inactive',
};

export function CostStatus({ status }) {
  const label = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
  return <span className={`badge ${BADGE[status] ?? 'badge-inactive'}`}>{label}</span>;
}

const num = (v, d = 2) =>
  v === null || v === undefined || v === ''
    ? '-'
    : Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (fraction) => (fraction === null || fraction === undefined ? '' : String(+(Number(fraction) * 100).toFixed(4)));
const toFraction = (p) => (p === '' || p === null || p === undefined ? '0' : String(Number(p) / 100));

// ===========================================================================
//  LIST
// ===========================================================================

export function CostSheetList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useResourceList((params) => api.list(params), {
    defaultSort: 'costDate',
    defaultDir: 'desc',
    initialFilters: { status: '', styleId: '' },
  });
  const [styleOptions, setStyleOptions] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    stylesApi.options().then(setStyleOptions).catch(loadFailed(setStyleOptions, 'styles'));
  }, []);

  return (
    <>
      <PageHeader
        title="Cost Sheets"
        actions={
          can('COST_SHEET.CREATE') && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              New cost sheet
            </button>
          )
        }
      />
      {list.error && <Alert kind="error">{list.error.message}</Alert>}

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor="cs-search">
              <TextInput
                id="cs-search"
                type="search"
                placeholder="Search cost sheet no, remarks..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Style" htmlFor="cs-style">
            <RecordSelect
              id="cs-style"
              options={styleOptions}
              getValue={(s) => s.id}
              getLabel={(s) => s.styleNo}
              placeholder="All styles"
              value={list.filters.styleId ?? ''}
              onChange={(e) => list.setFilter('styleId', e.target.value)}
            />
          </Field>
          <Field label="Status" htmlFor="cs-status">
            <EnumSelect
              id="cs-status"
              options={STATUS_OPTIONS}
              placeholder="All"
              value={list.filters.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
            />
          </Field>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="costSheetNo" label="Cost Sheet" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="costDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Style</th>
                <th>Buyer</th>
                <SortableTh field="version" label="Ver." sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <th className="num">Cost / pc (INR)</th>
                <SortableTh field="fobPrice" label="FOB" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <th className="num">Margin</th>
                <SortableTh field="status" label="Status" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={9} className="loading-row">
                    <Spinner label="Loading cost sheets..." />
                  </td>
                </tr>
              )}
              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <EmptyState title="No cost sheets yet" message="Cost a style from its BOM to get its FOB price." />
                  </td>
                </tr>
              )}
              {!list.loading &&
                list.rows.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => navigate(`/cost-sheets/${s.id}`)}>
                    <td className="code">{s.costSheetNo}</td>
                    <td className="nowrap">{fmtDate(s.costDate)}</td>
                    <td className="code">{s.style?.styleNo}</td>
                    <td>{s.style?.buyer?.buyerName ?? '-'}</td>
                    <td className="num">v{s.version}</td>
                    <td className="num">{num(s.totalCost)}</td>
                    <td className="num">
                      <strong>{s.fobPrice ? `${num(s.fobPrice, 4)} ${s.currency}` : '-'}</strong>
                      {s.unpricedLines > 0 && <div className="faint">{s.unpricedLines} unpriced</div>}
                    </td>
                    <td className="num">{pct(s.marginPct)}%</td>
                    <td>
                      <CostStatus status={s.status} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableWrap>
        <Pagination meta={list.meta} page={list.page} pageSize={list.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />
      </div>

      {creating && (
        <NewCostSheetDialog
          styleOptions={styleOptions}
          onCancel={() => setCreating(false)}
          onDone={(saved) => navigate(`/cost-sheets/${saved.id}`)}
        />
      )}
    </>
  );
}

function NewCostSheetDialog({ styleOptions, onCancel, onDone }) {
  const [styleId, setStyleId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [orders, setOrders] = useState([]);
  const [currency, setCurrency] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    ordersApi.options().then(setOrders).catch(() => setOrders([]));
  }, []);

  async function go() {
    setBusy(true);
    setError('');
    try {
      onDone(
        await api.create({
          styleId,
          orderId: orderId || null,
          currency,
          ...(exchangeRate ? { exchangeRate } : {}),
        }),
      );
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New cost sheet"
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={go} disabled={busy || !styleId}>
            {busy ? 'Costing...' : 'Cost from BOM'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>
        <p style={{ marginTop: 0 }}>
          The style&apos;s BOM is copied in, and each material is priced from the last approved purchase
          order or quotation for it. Anything with no price yet is left for you to fill.
        </p>
        <Field label="Style" required>
          <RecordSelect
            options={styleOptions}
            getValue={(s) => s.id}
            getLabel={(s) => `${s.styleNo} - ${s.styleDescription ?? ''}`}
            placeholder="Select style..."
            value={styleId}
            onChange={(e) => setStyleId(e.target.value)}
          />
        </Field>
        <Field label="For order" hint="Optional - a costing done for one order.">
          <RecordSelect
            options={orders}
            getValue={(o) => o.id}
            getLabel={(o) => o.orderNo}
            placeholder="Style in general"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="Quote currency">
            <TextInput value={currency} maxLength={10} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Exchange rate" hint="INR per 1 unit.">
            <TextInput type="number" min="0" step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ===========================================================================
//  DETAIL / EDITOR
// ===========================================================================

const HEADER_KEYS = ['currency', 'exchangeRate', 'targetPrice', 'cmtCost', 'printCost', 'dyeWashCost', 'otherCost', 'otherCostLabel', 'remarks'];
const PCT_KEYS = ['overheadPct', 'rejectionPct', 'commissionPct', 'marginPct'];

function formFrom(sheet) {
  const f = {};
  for (const k of HEADER_KEYS) f[k] = sheet[k] === null || sheet[k] === undefined ? '' : String(sheet[k]);
  for (const k of ['exchangeRate', 'targetPrice', 'cmtCost', 'printCost', 'dyeWashCost', 'otherCost']) {
    if (f[k] !== '') f[k] = String(Number(f[k]));
  }
  for (const k of PCT_KEYS) f[k] = pct(sheet[k]);
  f.lines = (sheet.lines ?? []).map((l) => ({
    id: l.id,
    key: l.id,
    label: [l.itemCategory, l.subCategory, l.accessoriesItem].filter(Boolean).join(' · '),
    description: l.description ?? '',
    uom: l.uom,
    consumption: String(Number(l.consumption)),
    wastagePct: pct(l.wastagePct),
    rate: l.rate === null ? '' : String(Number(l.rate)),
    rateSource: l.rateSource,
    amount: l.amount,
  }));
  return f;
}

let newLineSeq = 0;

export function CostSheetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [sheet, setSheet] = useState(null);
  const [form, setForm] = useState(null);
  const [removed, setRemoved] = useState([]);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.get(id);
      setSheet(s);
      setForm(formFrom(s));
      setRemoved([]);
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!sheet || !form) {
    return banner ? <Alert kind="error">{banner.text}</Alert> : (
      <div className="card"><div className="loading-row"><Spinner label="Loading cost sheet..." /></div></div>
    );
  }

  const editable = sheet.editable && can('COST_SHEET.EDIT');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (key, k, v) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, [k]: v } : l)) }));

  async function act(fn, success) {
    setBusy(true);
    setBanner(null);
    try {
      const s = await fn();
      if (s?.id && s.id !== sheet.id) {
        navigate(`/cost-sheets/${s.id}`);
        return;
      }
      if (s) {
        setSheet(s);
        setForm(formFrom(s));
        setRemoved([]);
      }
      setBanner({ kind: 'success', text: success });
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const payload = () => ({
    currency: form.currency,
    exchangeRate: form.exchangeRate || '1',
    targetPrice: form.targetPrice === '' ? null : form.targetPrice,
    cmtCost: form.cmtCost || '0',
    printCost: form.printCost || '0',
    dyeWashCost: form.dyeWashCost || '0',
    otherCost: form.otherCost || '0',
    otherCostLabel: form.otherCostLabel,
    remarks: form.remarks,
    ...Object.fromEntries(PCT_KEYS.map((k) => [k, toFraction(form[k])])),
    removeLineIds: removed,
    lines: form.lines.map((l) => ({
      ...(l.id ? { id: l.id } : { itemCategory: l.itemCategory || 'Other', uom: l.uom || 'Pcs' }),
      description: l.description,
      consumption: l.consumption || '0',
      wastagePct: toFraction(l.wastagePct),
      rate: l.rate === '' ? null : l.rate,
    })),
  });

  const materialPreview = form.lines.reduce(
    (a, l) => (a === null || l.rate === '' ? null : a + Number(l.consumption || 0) * (1 + Number(l.wastagePct || 0) / 100) * Number(l.rate)),
    0,
  );

  return (
    <>
      <PageHeader
        title={`Cost sheet ${sheet.costSheetNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/cost-sheets')}>
              Back to list
            </button>
            {editable && (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => act(() => api.refreshRates(sheet.id), 'Rates refreshed from the latest approved POs and quotations.')}>
                  Refresh rates
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => act(() => api.update(sheet.id, payload()), 'Saved and recalculated.')}>
                  Save
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await api.update(sheet.id, payload());
                      return api.submit(sheet.id, {});
                    }, 'Submitted to the Director.')
                  }
                >
                  Submit for approval
                </button>
              </>
            )}
            {sheet.status === 'PENDING_APPROVAL' && can('COST_SHEET.APPROVE') && (
              <>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => api.approve(sheet.id, {}), 'Approved. This is now the style’s FOB.')}>
                  Approve
                </button>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setRejecting(true)}>
                  Reject
                </button>
              </>
            )}
            {can('COST_SHEET.CREATE') && !sheet.editable && (
              <button type="button" className="btn" disabled={busy} onClick={() => act(() => api.revise(sheet.id), 'New version created.')}>
                New version
              </button>
            )}
          </>
        }
      />

      {banner && (
        <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Alert>
      )}
      {sheet.status === 'REJECTED' && sheet.rejectionReason && (
        <Alert kind="error">Rejected: {sheet.rejectionReason}</Alert>
      )}

      {/* --- The answer first ------------------------------------------- */}
      <div className="cost-summary">
        <Tile label="Total cost / pc" value={sheet.totalCost ? `₹ ${num(sheet.totalCost)}` : 'Incomplete'} sub={sheet.unpricedLines ? `${sheet.unpricedLines} material(s) unpriced` : 'material + conversion + overhead + rejection'} />
        <Tile label="FOB" value={sheet.fobPrice ? `${num(sheet.fobPrice, 4)} ${sheet.currency}` : '-'} sub={sheet.fobInr ? `₹ ${num(sheet.fobInr)} at ${num(sheet.exchangeRate, 4)}` : ''} strong />
        <Tile label="Margin" value={sheet.marginAmount ? `₹ ${num(sheet.marginAmount)}` : '-'} sub={`${pct(sheet.marginPct)}% of price · agent ${pct(sheet.commissionPct)}%`} />
        <Tile
          label="At buyer target"
          value={sheet.marginAtTarget !== null && sheet.marginAtTarget !== undefined ? `${pct(sheet.marginAtTarget)}% margin` : '-'}
          sub={sheet.targetPrice ? `target ${num(sheet.targetPrice, 4)} ${sheet.currency}` : 'no target given'}
          bad={sheet.marginAtTarget !== null && Number(sheet.marginAtTarget) < 0}
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>
            {sheet.style?.styleNo} · v{sheet.version} <CostStatus status={sheet.status} />
          </span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {sheet.style?.buyer?.buyerName}
            {sheet.order ? ` · order ${sheet.order.orderNo}` : ''} · {fmtDate(sheet.costDate)}
          </span>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <Field label="Quote currency"><TextInput value={form.currency} disabled={!editable} onChange={set('currency')} /></Field>
            <Field label="Exchange rate" hint="INR per 1 unit"><TextInput type="number" step="0.0001" value={form.exchangeRate} disabled={!editable} onChange={set('exchangeRate')} /></Field>
            <Field label={`Buyer target (${form.currency || '-'})`}><TextInput type="number" step="0.0001" value={form.targetPrice} disabled={!editable} onChange={set('targetPrice')} /></Field>
            <div className="fieldset-title">Conversion per piece (INR)</div>
            <Field label="CMT" hint="Cut, make, trim labour"><TextInput type="number" step="0.01" value={form.cmtCost} disabled={!editable} onChange={set('cmtCost')} /></Field>
            <Field label="Printing"><TextInput type="number" step="0.01" value={form.printCost} disabled={!editable} onChange={set('printCost')} /></Field>
            <Field label="Dyeing / washing"><TextInput type="number" step="0.01" value={form.dyeWashCost} disabled={!editable} onChange={set('dyeWashCost')} /></Field>
            <Field label="Other"><TextInput type="number" step="0.01" value={form.otherCost} disabled={!editable} onChange={set('otherCost')} /></Field>
            <Field label="Other is for"><TextInput value={form.otherCostLabel} disabled={!editable} onChange={set('otherCostLabel')} /></Field>
            <div className="fieldset-title">Percentages</div>
            <Field label="Overhead %" hint="of material + conversion"><TextInput type="number" step="0.01" value={form.overheadPct} disabled={!editable} onChange={set('overheadPct')} /></Field>
            <Field label="Rejection %" hint="allowance on cost"><TextInput type="number" step="0.01" value={form.rejectionPct} disabled={!editable} onChange={set('rejectionPct')} /></Field>
            <Field label="Agent commission %" hint="of selling price"><TextInput type="number" step="0.01" value={form.commissionPct} disabled={!editable} onChange={set('commissionPct')} /></Field>
            <Field label="Margin %" hint="of selling price"><TextInput type="number" step="0.01" value={form.marginPct} disabled={!editable} onChange={set('marginPct')} /></Field>
            <Field label="Remarks" className="span-2"><TextArea rows={2} value={form.remarks} disabled={!editable} onChange={set('remarks')} /></Field>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Materials per piece</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {materialPreview === null ? 'price every line to see the material cost' : `material ₹ ${num(materialPreview)} (preview - saved figures above)`}
          </span>
        </div>
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Material</th>
                <th>UOM</th>
                <th className="num">Consumption</th>
                <th className="num">Wastage %</th>
                <th className="num">Rate (INR)</th>
                <th>Rate from</th>
                <th className="num">Amount</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {form.lines.map((l) => (
                <tr key={l.key} className={l.rate === '' ? 'row-bad' : ''}>
                  <td>
                    {l.id ? (
                      <>
                        {l.label}
                        {l.description && <div className="faint">{l.description}</div>}
                      </>
                    ) : (
                      <TextInput placeholder="What is it?" value={l.description} onChange={(e) => setLine(l.key, 'description', e.target.value)} />
                    )}
                  </td>
                  <td>
                    {l.id ? l.uom : <TextInput value={l.uom} style={{ maxWidth: 80 }} onChange={(e) => setLine(l.key, 'uom', e.target.value)} />}
                  </td>
                  <td className="num">
                    <TextInput type="number" step="0.0001" value={l.consumption} disabled={!editable} style={{ maxWidth: 110, textAlign: 'right' }} onChange={(e) => setLine(l.key, 'consumption', e.target.value)} />
                  </td>
                  <td className="num">
                    <TextInput type="number" step="0.01" value={l.wastagePct} disabled={!editable} style={{ maxWidth: 80, textAlign: 'right' }} onChange={(e) => setLine(l.key, 'wastagePct', e.target.value)} />
                  </td>
                  <td className="num">
                    <TextInput type="number" step="0.0001" value={l.rate} disabled={!editable} placeholder="price it" style={{ maxWidth: 110, textAlign: 'right' }} onChange={(e) => setLine(l.key, 'rate', e.target.value)} />
                  </td>
                  <td className="faint" style={{ fontSize: 12 }}>{l.rateSource ?? '-'}</td>
                  <td className="num">{num(l.amount, 4)}</td>
                  {editable && (
                    <td className="actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          if (l.id) setRemoved((r) => [...r, l.id]);
                          setForm((f) => ({ ...f, lines: f.lines.filter((x) => x.key !== l.key) }));
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {editable && (
          <div className="card-body">
            <button
              type="button"
              className="btn"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  lines: [...f.lines, { key: `new-${(newLineSeq += 1)}`, description: '', uom: 'Pcs', consumption: '1', wastagePct: '0', rate: '', itemCategory: 'Accessories' }],
                }))
              }
            >
              Add a material
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Versions of {sheet.style?.styleNo}</div>
        <TableWrap>
          <table className="data">
            <tbody>
              {sheet.versions.map((v) => (
                <tr key={v.id} className={`clickable ${v.id === sheet.id ? 'row-current' : ''}`} onClick={() => navigate(`/cost-sheets/${v.id}`)}>
                  <td className="code">{v.costSheetNo}</td>
                  <td>v{v.version}</td>
                  <td>{fmtDate(v.costDate)}</td>
                  <td className="num">{v.fobPrice ? `${num(v.fobPrice, 4)} ${v.currency}` : '-'}</td>
                  <td><CostStatus status={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>

      {sheet.approvals?.length > 0 && (
        <div className="card">
          <div className="card-header">Trail</div>
          <div className="card-body">
            {sheet.approvals.map((a) => (
              <div key={a.id} style={{ fontSize: 13, marginBottom: 6 }}>
                <strong>{a.action.toLowerCase()}</strong> by {a.actedByName ?? '-'} · {fmtDateTime(a.actedAt)}
                {a.remarks && <span className="muted"> - {a.remarks}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {rejecting && (
        <RejectDialog
          onCancel={() => setRejecting(false)}
          onReject={(reason) => {
            setRejecting(false);
            act(() => api.reject(sheet.id, { reason }), 'Rejected - merchandising has been told.');
          }}
        />
      )}
    </>
  );
}

function Tile({ label, value, sub, strong, bad }) {
  return (
    <div className={`cost-tile ${strong ? 'is-strong' : ''} ${bad ? 'is-bad' : ''}`}>
      <span className="cost-tile-label">{label}</span>
      <span className="cost-tile-value">{value}</span>
      {sub && <span className="cost-tile-sub">{sub}</span>}
    </div>
  );
}

function RejectDialog({ onCancel, onReject }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title="Reject cost sheet"
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={reason.trim().length < 3} onClick={() => onReject(reason.trim())}>
            Reject
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Field label="Reason" required>
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
