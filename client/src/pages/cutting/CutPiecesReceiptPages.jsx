/**
 * Cut Pieces Receipt — pieces counted in from the cutting department.
 *
 * ---------------------------------------------------------------------------
 *  WHERE IT SITS
 *
 *      Cutting Challan  ->  cut on the floor  ->  CUT PIECES RECEIPT  ->  Cutting Issue
 *
 *  The cutting master hands over good pieces, rejected pieces and handles;
 *  the store counts them in here. The figure the store keeper wants is
 *  "pieces in hand" — good pieces received for the order, less what Cutting
 *  Issues have already sent to stitching — so it is shown on the form while
 *  the receipt is being keyed, and on every receipt afterwards.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import {
  cutPiecesReceipts as cprApi,
  cuttingChallans as ccApi,
  employees as employeesApi,
  orders as ordersApi,
  styles as stylesApi,
} from '../../services/erp.js';
import {
  Alert,
  ConfirmDialog,
  EmptyState,
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
import { Detail, DetailGrid } from '../shared/Detail.jsx';
import { fmtDate, fmtDateTime, fmtNum, toDateInput, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const rowsOf = (r) => (Array.isArray(r) ? r : (r?.rows ?? []));

// ===========================================================================
//  LIST
// ===========================================================================

export function CutPiecesReceiptList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const list = useResourceList((params) => cprApi.list(params), {
    defaultSort: 'receiptDate',
    defaultDir: 'desc',
    initialFilters: { orderId: '' },
  });

  const [orderOptions, setOrderOptions] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  return (
    <>
      <PageHeader
        title="Cut pieces receipts"
        actions={
          <>
            <ExportButton dataset="cut-pieces-receipts" params={list.query} rowCount={list.meta.total} />
            {can('CUT_PIECES_RECEIPT.CREATE') && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                Receive cut pieces
              </button>
            )}
          </>
        }
      />

      <div className="filter-row">
        <div className="grow">
          <Field label="Search">
            <TextInput
              value={list.search}
              onChange={(e) => list.setSearch(e.target.value)}
              placeholder="Receipt no, order, style, cutting master, colour, lot"
            />
          </Field>
        </div>
        <Field label="Order">
          <RecordSelect
            value={list.filters.orderId}
            onChange={(e) => list.setFilter('orderId', e.target.value)}
            options={orderOptions}
            getValue={(o) => o.id}
            getLabel={(o) => o.orderNo}
            placeholder="All orders"
          />
        </Field>
      </div>

      {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
      {list.loading ? (
        <Spinner label="Loading receipts" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title="No cut pieces received yet"
          message="When the cutting department hands over cut pieces, count them in here."
        />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="receiptNo" label="Receipt" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="receiptDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Order</th>
                <th>Style</th>
                <th>Challan</th>
                <th>Cutting master</th>
                <th>Colour</th>
                <SortableTh field="pcsReceived" label="Good pcs" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th className="num">Rejected</th>
                <th className="num">Handles</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/cut-pieces-receipts/${r.id}`)}>
                  <td className="code">{r.receiptNo}</td>
                  <td className="nowrap">{fmtDate(r.receiptDate)}</td>
                  <td>{r.order?.orderNo ?? '-'}</td>
                  <td>{r.style?.styleNo ?? '-'}</td>
                  <td>{r.cuttingChallan?.challanNo ?? '-'}</td>
                  <td>{r.cuttingMasterName}</td>
                  <td>{r.colorCode ?? '-'}</td>
                  <td className="num"><strong>{fmtNum(r.pcsReceived)}</strong></td>
                  <td className="num">{fmtNum(r.pcsRejected)}</td>
                  <td className="num">{fmtNum(r.handlesReceived)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <Pagination
        meta={list.meta}
        page={list.page}
        pageSize={list.pageSize}
        onPage={list.setPage}
        onPageSize={list.setPageSize}
      />

      {creating && (
        <ReceiptModal
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            navigate(`/cut-pieces-receipts/${saved.id}`);
          }}
        />
      )}
    </>
  );
}

// ===========================================================================
//  DETAIL
// ===========================================================================

export function CutPiecesReceiptDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRow(await cprApi.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !row) return <Spinner label="Loading receipt..." />;
  if (!row) return <Alert kind="error">{banner?.text ?? 'Receipt not found'}</Alert>;

  async function remove() {
    setBusy(true);
    try {
      await cprApi.remove(row.id);
      navigate('/cut-pieces-receipts');
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
      setBusy(false);
    }
  }

  const s = row.summary ?? {};

  return (
    <>
      <PageHeader
        title={`Cut pieces receipt ${row.receiptNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/cut-pieces-receipts')}>
              Back to list
            </button>
            {can('CUT_PIECES_RECEIPT.DELETE') && (
              <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>
                Delete
              </button>
            )}
            {can('CUT_PIECES_RECEIPT.EDIT') && (
              <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
                Edit
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

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Received from cutting</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Receipt No" value={row.receiptNo} mono />
            <Detail label="Date" value={fmtDate(row.receiptDate)} />
            <Detail
              label="Order"
              value={row.order ? <Link to={`/orders/${row.order.id}`}>{row.order.orderNo}</Link> : '-'}
              sub={row.order?.buyer?.buyerName}
            />
            <Detail label="Style" value={row.style?.styleNo} mono />
            <Detail
              label="Cutting challan"
              value={
                row.cuttingChallan
                  ? <Link to={`/cutting-challans/${row.cuttingChallan.id}`}>{row.cuttingChallan.challanNo}</Link>
                  : '-'
              }
            />
            <Detail label="Cutting master" value={row.cuttingMasterName} sub={row.cuttingMaster?.empId} />
            <Detail label="Colour" value={row.colorCode} />
            <Detail label="Lot No" value={row.lotNo} />
            <Detail label="Good pieces" value={fmtNum(row.pcsReceived)} />
            <Detail label="Rejected pieces" value={fmtNum(row.pcsRejected)} />
            <Detail
              label="Handles"
              value={fmtNum(row.handlesReceived)}
              sub={row.handlesPerBag != null ? `${row.handlesPerBag} per bag, from the style` : 'Typed'}
            />
            {row.panelsReceived != null && (
              <Detail
                label="Panels"
                value={fmtNum(row.panelsReceived)}
                sub={`${row.panelsPerBag} per bag, from the style`}
              />
            )}
            <Detail label="Received by" value={row.receivedByName} sub={fmtDateTime(row.createdAt)} />
            {row.remarks && <Detail label="Remarks" value={row.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      {Array.isArray(row.panelBreakdown) && row.panelBreakdown.length > 0 && (
        <PanelBreakdown breakdown={row.panelBreakdown} />
      )}

      <InHandCard summary={s} title={`Cut pieces for ${row.order?.orderNo ?? 'this order'} / ${row.style?.styleNo ?? ''}`} />

      {editing && (
        <ReceiptModal
          existing={row}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            setBanner({ kind: 'success', text: `${row.receiptNo} updated.` });
            await load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${row.receiptNo}?`}
          message="The receipt is removed from the register and from the pieces-in-hand total. The audit trail keeps a record of it."
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

/** Panel by panel, as multiplied and frozen on the receipt. */
export function PanelBreakdown({ breakdown, title = 'Panels counted in' }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">{title}</div>
      <div className="card-body">
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Panel</th>
                <th className="num">Per bag</th>
                <th className="num">Pieces</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((p, i) => (
                <tr key={`${p.name}-${i}`}>
                  <td>{p.name}</td>
                  <td className="num">{p.piecesPerBag}</td>
                  <td className="num">{fmtNum(p.pieces)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>
    </div>
  );
}

/** Received from cutting, issued to stitching, and what is left in hand. */
function InHandCard({ summary, title }) {
  if (!summary) return null;
  const inHand = Number(summary.pcsInHand ?? 0);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">{title}</div>
      <div className="card-body">
        <DetailGrid>
          <Detail label="Receipts" value={fmtNum(summary.receipts)} />
          <Detail label="Good pieces received" value={fmtNum(summary.pcsReceived)} />
          <Detail label="Rejected pieces" value={fmtNum(summary.pcsRejected)} />
          <Detail label="Handles received" value={fmtNum(summary.handlesReceived)} />
          <Detail label="Issued to stitching" value={fmtNum(summary.pcsIssuedToStitching)} sub="On Cutting Issues" />
          <Detail
            label="Pieces in hand"
            value={<strong style={inHand < 0 ? { color: 'var(--danger, #b42318)' } : undefined}>{fmtNum(inHand)}</strong>}
            sub={inHand < 0 ? 'More issued than received - check the counts' : 'Received, not yet issued'}
          />
        </DetailGrid>
      </div>
    </div>
  );
}

// ===========================================================================
//  CREATE / EDIT
// ===========================================================================

function ReceiptModal({ existing, onClose, onSaved }) {
  const editing = Boolean(existing);

  const [orderOptions, setOrderOptions] = useState([]);
  const [challanOptions, setChallanOptions] = useState([]);
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [nextNo, setNextNo] = useState('');

  const [form, setForm] = useState(() => ({
    receiptDate: existing ? toDateInput(existing.receiptDate) : todayInput(),
    orderId: existing?.orderId ?? '',
    cuttingChallanId: existing?.cuttingChallanId ?? '',
    cuttingMasterId: existing?.cuttingMasterId ?? '',
    cuttingMasterName: existing?.cuttingMasterId ? '' : (existing?.cuttingMasterName ?? ''),
    colorCode: existing?.colorCode ?? '',
    lotNo: existing?.lotNo ?? '',
    pcsReceived: existing ? String(existing.pcsReceived) : '',
    pcsRejected: existing ? String(existing.pcsRejected) : '',
    handlesReceived: existing ? String(existing.handlesReceived) : '',
    remarks: existing?.remarks ?? '',
  }));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /*
   * The style the pieces belong to - the challan's if one is chosen, else the
   * order's - and its panel list. Where it has one, the handle count is worked
   * out from the good pieces and is not typed.
   */
  const chosenChallan = challanOptions.find((c) => c.id === form.cuttingChallanId);
  const chosenOrder = orderOptions.find((o) => o.id === form.orderId);
  const styleId = chosenChallan?.styleId ?? chosenChallan?.style?.id ?? chosenOrder?.styleId
    ?? chosenOrder?.style?.id ?? existing?.styleId ?? null;
  const [perBag, setPerBag] = useState(null);
  useEffect(() => {
    if (!styleId) {
      setPerBag(null);
      return;
    }
    stylesApi
      .get(styleId)
      .then((st) => setPerBag(st?.panelsPerBag ?? null))
      .catch(() => setPerBag(null));
  }, [styleId]);
  const derivedHandles = perBag ? Number(form.pcsReceived || 0) * perBag.handlesPerBag : null;

  useEffect(() => {
    ordersApi
      .options()
      .then((opts) => {
        // An order that has since completed still has to show on its own receipt.
        if (existing?.order && !opts.some((o) => o.id === existing.orderId)) {
          opts = [existing.order, ...opts];
        }
        setOrderOptions(opts);
      })
      .catch(loadFailed(setOrderOptions, 'orders'));
    employeesApi.options().then(setEmployeeOptions).catch(loadFailed(setEmployeeOptions, 'employees'));
    if (!editing) cprApi.nextNumber().then((r) => setNextNo(r?.receiptNo ?? '')).catch(() => {});
  }, [editing, existing]);

  // The challans of the chosen order, and its pieces-in-hand so far.
  useEffect(() => {
    if (!form.orderId) {
      setChallanOptions([]);
      setSummary(null);
      return;
    }
    ccApi
      .list({ orderId: form.orderId, pageSize: 100 })
      .then((r) => setChallanOptions(rowsOf(r).filter((c) => c.status !== 'CANCELLED')))
      .catch(loadFailed(setChallanOptions, 'cutting challans'));
    cprApi
      .summary({ orderId: form.orderId })
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [form.orderId]);

  const hasCount = [form.pcsReceived, form.pcsRejected, perBag ? derivedHandles : form.handlesReceived]
    .some((v) => Number(v) > 0);
  const hasMaster = Boolean(form.cuttingMasterId || form.cuttingMasterName.trim());
  const ready = form.orderId && hasMaster && hasCount && form.pcsReceived !== '';

  async function save() {
    setBusy(true);
    setError('');
    const body = {
      receiptDate: form.receiptDate,
      orderId: form.orderId,
      cuttingChallanId: form.cuttingChallanId || null,
      cuttingMasterId: form.cuttingMasterId || null,
      cuttingMasterName: form.cuttingMasterId ? undefined : form.cuttingMasterName.trim(),
      colorCode: form.colorCode || null,
      lotNo: form.lotNo || null,
      pcsReceived: String(form.pcsReceived || 0),
      pcsRejected: String(form.pcsRejected || 0),
      handlesReceived: String(form.handlesReceived || 0),
      remarks: form.remarks || null,
    };
    try {
      const saved = editing ? await cprApi.update(existing.id, body) : await cprApi.create(body);
      onSaved(saved);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? `Edit ${existing.receiptNo}` : 'Receive cut pieces from cutting'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={save}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Save receipt'}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {!editing && nextNo && <p className="hint" style={{ marginTop: 0 }}>This receipt will be numbered <strong>{nextNo}</strong>.</p>}

      <div className="form-grid">
        <Field label="Order" required>
          <RecordSelect
            value={form.orderId}
            onChange={(e) => {
              const o = orderOptions.find((x) => x.id === e.target.value);
              set({
                orderId: e.target.value,
                cuttingChallanId: '',
                colorCode: form.colorCode || o?.colorCode || '',
              });
            }}
            options={orderOptions}
            getValue={(o) => o.id}
            getLabel={(o) => `${o.orderNo}${o.buyer?.buyerName ? ` - ${o.buyer.buyerName}` : ''}`}
          />
        </Field>

        <Field
          label="Cutting challan"
          hint={
            !form.orderId
              ? 'Choose an order first.'
              : challanOptions.length === 0
                ? 'This order has no cutting challan - you can still save the receipt.'
                : 'The challan these pieces were cut against.'
          }
        >
          <RecordSelect
            value={form.cuttingChallanId}
            onChange={(e) => set({ cuttingChallanId: e.target.value })}
            options={challanOptions}
            disabled={!form.orderId}
            placeholder={form.orderId ? 'Select a challan (optional)' : 'Choose an order first'}
            emptyLabel={form.orderId ? 'No challan for this order' : 'Choose an order first'}
            getValue={(c) => c.id}
            getLabel={(c) => `${c.challanNo} - ${fmtDate(c.challanDate)}`}
          />
        </Field>

        <Field label="Receipt date" required>
          <TextInput type="date" value={form.receiptDate} onChange={(e) => set({ receiptDate: e.target.value })} />
        </Field>

        <Field label="Cutting master" required hint="Who handed the pieces over. Pick from Employees, or type a name below.">
          <RecordSelect
            value={form.cuttingMasterId}
            onChange={(e) => set({ cuttingMasterId: e.target.value, cuttingMasterName: '' })}
            options={employeeOptions}
            getValue={(emp) => emp.id}
            getLabel={(emp) => `${emp.empName}${emp.department ? ` (${emp.department})` : ''}`}
            placeholder="Select employee..."
          />
        </Field>

        {!form.cuttingMasterId && (
          <Field label="...or type the name">
            <TextInput
              value={form.cuttingMasterName}
              onChange={(e) => set({ cuttingMasterName: e.target.value })}
              placeholder="Cutting master's name"
              maxLength={120}
            />
          </Field>
        )}

        <Field label="Colour">
          <TextInput value={form.colorCode} onChange={(e) => set({ colorCode: e.target.value })} maxLength={60} />
        </Field>

        <Field label="Lot / bundle No">
          <TextInput value={form.lotNo} onChange={(e) => set({ lotNo: e.target.value })} maxLength={40} />
        </Field>

        <Field label="Good pieces received" required>
          <TextInput
            type="number"
            min="0"
            step="1"
            value={form.pcsReceived}
            onChange={(e) => set({ pcsReceived: e.target.value })}
            placeholder="0"
          />
        </Field>

        <Field label="Rejected pieces" hint="Cut badly or damaged - counted, not usable.">
          <TextInput
            type="number"
            min="0"
            step="1"
            value={form.pcsRejected}
            onChange={(e) => set({ pcsRejected: e.target.value })}
            placeholder="0"
          />
        </Field>

        {perBag ? (
          <Field
            label="Handles received"
            hint={`${perBag.handlesPerBag} per bag from the style's panel list, so ` +
              `${fmtNum(Number(form.pcsReceived || 0) * perBag.panelsPerBag)} panels in all.`}
          >
            <TextInput value={fmtNum(derivedHandles)} readOnly disabled />
          </Field>
        ) : (
          <Field label="Handles received" hint="The style has no panel list, so count the handles.">
            <TextInput
              type="number"
              min="0"
              step="1"
              value={form.handlesReceived}
              onChange={(e) => set({ handlesReceived: e.target.value })}
              placeholder="0"
            />
          </Field>
        )}

        <Field label="Remarks" className="span-2">
          <TextArea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
        </Field>
      </div>

      {summary && (
        <p className="hint">
          So far for this order: <strong>{fmtNum(summary.pcsReceived)}</strong> good pieces received,{' '}
          <strong>{fmtNum(summary.pcsIssuedToStitching)}</strong> issued to stitching,{' '}
          <strong>{fmtNum(summary.pcsInHand)}</strong> in hand
          {editing ? ' (including this receipt as it was saved).' : '.'}
        </p>
      )}
    </Modal>
  );
}
