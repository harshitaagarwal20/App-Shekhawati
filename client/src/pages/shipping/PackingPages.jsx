/**
 * Packing - the "Packing Details" sheet, one line per run of boxes.
 *
 * ---------------------------------------------------------------------------
 *  THE FIELDS, AND WHO FILLS THEM
 *
 *      Box No                       MANUAL - e.g. 1-20
 *      OrderNo / Style No.          DROPDOWN
 *      Order size                   AUTO - the order qty of the style
 *      Name                         AUTO - the style's description
 *      Color                        DROPDOWN - the colours Needle Checking passed
 *      Packing                      MANUAL - pieces in each box; filled from
 *                                   the style's packets x bags (10 x 10 = 100)
 *      Boxes                        MANUAL
 *      Qty (In pcs)                 FORMULA - Packing x Boxes
 *      N.W per Box / G.W per Box    MANUAL - kg
 *      N.W (kg) / G.W (kg)          FORMULA - per box x Boxes
 *      Dim (in cms) L / W / H       MANUAL
 *      CBM                          FORMULA - L x W x H / 1,000,000 x Boxes
 *      Remarks                      TEXT
 *
 *  A colour is never packed past what Needle Checking passed of it.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { packing as api } from '../../services/erp.js';
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
  StatusBadge,
  TextArea,
  TextInput,
  ClearFilters,
} from '../../components/ui.jsx';
import { fmtDate, fmtNum, fmtOrder, fmtOrderStyle } from '../../utils/format.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { boxCount, cartonMakeUp, packetsLabel, packetsTotal } from '../../utils/packets.js';
import DateRangeFilter from '../../components/DateRangeFilter.jsx';

const n0 = (v) => fmtNum(v, { decimals: 0 });
const kg = (v) => (v == null || v === '' ? '' : fmtNum(v, { decimals: 2 }));
const cbm = (v) => (v == null || v === '' ? '' : fmtNum(v, { decimals: 3 }));
const num = (v) => Number(v || 0);
const optionLabel = fmtOrderStyle;
const has = (v) => v !== '' && v != null;

export function PackingList() {
  const { can } = useAuth();
  const [ctx, setCtx] = useState(null);
  const [options, setOptions] = useState([]);
  const [editing, setEditing] = useState(null);
  const list = useResourceList((params) => api.list(params), {
    defaultSort: 'packDate',
    defaultDir: 'desc',
    initialFilters: { orderId: '', dateFrom: '', dateTo: '' },
  });
  const loadOptions = useCallback(() => {
    api.orders().then(setOptions).catch(() => setOptions([]));
  }, []);
  useEffect(() => {
    api.context().then(setCtx).catch(() => setCtx({ today: new Date().toISOString().slice(0, 10) }));
    loadOptions();
  }, [loadOptions]);

  const orders = [...new Map(options.map((o) => [o.orderId, o])).values()];
  const totals = list.meta?.totals;
  const sortProps = { sortBy: list.sortBy, sortDir: list.sortDir, onSort: list.toggleSort };

  return (
    <>
      <PageHeader
        title="Packing"
        actions={
          <>
            <ExportButton dataset="packing" params={list.query} rowCount={list.meta.total} />
            {can('PACKING.CREATE') && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>Add boxes</button>}
          </>
        }
      />

      {options.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Needle-checked, and what is packed</div>
          <div className="card-body">
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>Order · Style</th>
                    <th className="num">Order qty</th>
                    <th className="num">Needle-checked</th>
                    <th className="num">Packed</th>
                    <th className="num">Boxes</th>
                    <th className="num">Still to pack</th>
                  </tr>
                </thead>
                <tbody>
                  {options.map((o) => (
                    <tr key={o.key}>
                      <td>{optionLabel(o)}</td>
                      <td className="num">{n0(o.orderQty)}</td>
                      <td className="num">{n0(o.pcsNeedleChecked)}</td>
                      <td className="num"><strong>{n0(o.pcsPacked)}</strong></td>
                      <td className="num">{n0(o.boxesPacked)}</td>
                      <td className="num">{n0(Math.max(0, num(o.pcsAvailable)))}</td>
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
        <DateRangeFilter filters={list.filters} setFilter={list.setFilter} fromLabel="From" toLabel="To" />
        <ClearFilters list={list} />
      </div>

      {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
      {list.loading ? (
        <Spinner label="Loading packing" />
      ) : list.rows.length === 0 ? (
        <EmptyState title="Nothing packed yet" message="Add each run of boxes with “Add boxes”." />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th colSpan={15} />
                <th colSpan={3} className="center">Dim (in cms)</th>
                <th colSpan={3} />
              </tr>
              <tr>
                <SortableTh field="packDate" label="Date" {...sortProps} />
                <SortableTh field="boxNo" label="Box No" {...sortProps} />
                <th>Order No</th>
                <th>Style No.</th>
                <th className="num">Order size</th>
                <th>Name</th>
                <th>Color</th>
                <th className="num">Packing</th>
                <th>Packets × bags</th>
                <SortableTh field="boxesPacked" label="Boxes" className="num" {...sortProps} />
                <SortableTh field="pcsPacked" label="Qty (in pcs)" className="num" {...sortProps} />
                <th className="num">N.W per box</th>
                <th className="num">G.W per box</th>
                <th className="num">N.W (kg)</th>
                <th className="num">G.W (kg)</th>
                <th className="num">L</th>
                <th className="num">W</th>
                <th className="num">H</th>
                <th className="num">CBM</th>
                <th>Remarks</th>
                <th>Dispatch</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className={can('PACKING.EDIT') ? 'clickable' : ''} onClick={() => can('PACKING.EDIT') && setEditing(r)}>
                  <td className="nowrap">{fmtDate(r.packDate)}</td>
                  <td className="nowrap"><strong>{r.boxNo}</strong></td>
                  <td>{r.order?.orderNo}</td>
                  <td className="code">{r.style?.styleNo}</td>
                  <td className="num">{n0(r.orderQty)}</td>
                  <td>{r.style?.styleDescription}</td>
                  <td>{r.colorCode}</td>
                  <td className="num">{n0(r.pcsPerBox)}</td>
                  <td className="nowrap">{r.packing}</td>
                  <td className="num">{n0(r.boxesPacked)}</td>
                  <td className="num"><strong>{n0(r.pcsPacked)}</strong></td>
                  <td className="num">{kg(r.nwPerBoxKg)}</td>
                  <td className="num">{kg(r.gwPerBoxKg)}</td>
                  <td className="num">{kg(r.nwKg)}</td>
                  <td className="num">{kg(r.gwKg)}</td>
                  <td className="num">{r.lengthCm == null ? '' : fmtNum(r.lengthCm, { decimals: 1 })}</td>
                  <td className="num">{r.widthCm == null ? '' : fmtNum(r.widthCm, { decimals: 1 })}</td>
                  <td className="num">{r.heightCm == null ? '' : fmtNum(r.heightCm, { decimals: 1 })}</td>
                  <td className="num">{cbm(r.cbm)}</td>
                  <td>{r.remarks}</td>
                  <td className="nowrap">
                    {r.dispatch ? <><span className="code">{r.dispatch.dispatchNo}</span> <StatusBadge status={r.dispatch.status} /></> : ''}
                  </td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  <td colSpan={8}><strong>All matching entries</strong></td>
                  <td className="nowrap"><strong>{packetsTotal(totals.packets, totals.looseBags)}</strong></td>
                  <td className="num"><strong>{n0(totals.boxesPacked)}</strong></td>
                  <td className="num"><strong>{n0(totals.pcsPacked)}</strong></td>
                  <td colSpan={2} />
                  <td className="num"><strong>{kg(totals.nwKg)}</strong></td>
                  <td className="num"><strong>{kg(totals.gwKg)}</strong></td>
                  <td colSpan={3} />
                  <td className="num"><strong>{cbm(totals.cbm)}</strong></td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </TableWrap>
      )}
      <Pagination meta={list.meta} page={list.page} pageSize={list.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />

      {editing && ctx && (
        <PackingModal
          ctx={ctx}
          options={options}
          existing={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={(keepOpen) => {
            if (!keepOpen) setEditing(null);
            loadOptions();
            list.reload();
          }}
        />
      )}
    </>
  );
}

function PackingModal({ ctx, options, existing, onClose, onSaved }) {
  const { can } = useAuth();
  const editing = Boolean(existing);
  const str = (v) => (v == null ? '' : String(v));
  const [form, setForm] = useState(() => ({
    packDate: existing?.packDate ? String(existing.packDate).slice(0, 10) : ctx.today,
    key: existing ? `${existing.orderId}:${existing.styleId}` : '',
    boxNo: existing?.boxNo ?? '',
    colorCode: existing?.colorCode ?? '',
    pcsPerBox: str(existing?.pcsPerBox),
    boxesPacked: str(existing?.boxesPacked ?? 1),
    nwPerBoxKg: str(existing?.nwPerBoxKg),
    gwPerBoxKg: str(existing?.gwPerBoxKg),
    lengthCm: str(existing?.lengthCm),
    widthCm: str(existing?.widthCm),
    heightCm: str(existing?.heightCm),
    remarks: existing?.remarks ?? '',
  }));
  const [position, setPosition] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const [orderId, styleId] = form.key ? form.key.split(':') : [];
  useEffect(() => {
    // The previous order's colours and figures are not this one's.
    setPosition(null);
    if (!orderId) return undefined;
    let current = true;
    api.position({ orderId, styleId })
      .then((p) => {
        if (!current) return;
        setPosition(p);
        // One colour passed: it is the only choice.
        if (!editing && p.colors.length === 1) set({ colorCode: p.colors[0].color });
        // A full carton: the style's packets x bags.
        if (!editing && p.pcsPerFullCarton) setForm((f) => (f.pcsPerBox ? f : { ...f, pcsPerBox: String(p.pcsPerFullCarton) }));
      })
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [orderId, styleId, editing]);

  const boxes = num(form.boxesPacked);
  const qty = num(form.pcsPerBox) * boxes;
  const color = position?.colors.find((c) => c.color === (form.colorCode || ''));
  const mine = editing && (existing.colorCode || '') === (form.colorCode || '') ? num(existing.pcsPacked) : 0;
  const available = color ? num(color.available) + mine : 0;
  const nw = has(form.nwPerBoxKg) ? num(form.nwPerBoxKg) * boxes : null;
  const gw = has(form.gwPerBoxKg) ? num(form.gwPerBoxKg) * boxes : null;
  const volume = has(form.lengthCm) && has(form.widthCm) && has(form.heightCm)
    ? (num(form.lengthCm) * num(form.widthCm) * num(form.heightCm) * boxes) / 1_000_000
    : null;
  const gwShort = has(form.nwPerBoxKg) && has(form.gwPerBoxKg) && num(form.gwPerBoxKg) < num(form.nwPerBoxKg);
  // What the server would refuse, said at the field rather than after Save.
  const wholeOr = (v, msg) => (has(v) && !(Number.isInteger(Number(v)) && Number(v) > 0) ? msg : undefined);
  const positiveOr = (v) => (has(v) && !(Number(v) > 0) ? 'More than 0, or leave it blank.' : undefined);
  const boxRun = boxCount(form.boxNo);
  const boxNoKept = editing && form.boxNo.trim() === String(existing.boxNo).trim();
  const bad = {
    boxNo: !form.boxNo.trim() || (boxRun == null && boxNoKept)
      ? undefined
      : boxRun == null
        ? 'Box numbers: 7, or 1-20.'
        : boxes > 0 && boxRun !== boxes ? `That is ${n0(boxRun)} box${boxRun === 1 ? '' : 'es'}; Boxes is ${n0(boxes)}.` : undefined,
    pcsPerBox: wholeOr(form.pcsPerBox, 'A whole number of pieces.'),
    boxesPacked: wholeOr(form.boxesPacked, 'A whole number of boxes.'),
    nwPerBoxKg: positiveOr(form.nwPerBoxKg),
    gwPerBoxKg: positiveOr(form.gwPerBoxKg) ?? (gwShort ? 'Less than the N.W.' : undefined),
    lengthCm: positiveOr(form.lengthCm),
    widthCm: positiveOr(form.widthCm),
    heightCm: positiveOr(form.heightCm),
  };
  // Boxes on a dispatch: those that have left are as their papers say;
  // those on a Pending one may be corrected, and the dispatch follows.
  const onDispatch = editing ? existing.dispatch : null;
  const left = onDispatch && onDispatch.status !== 'PENDING';
  const ready = form.key && !busy && !left && form.boxNo.trim() && color && qty > 0 && qty <= available
    && !Object.values(bad).some(Boolean);

  async function save(addNext = false) {
    setBusy(true);
    setError('');
    const blank = (v) => (v === '' ? null : v);
    const body = {
      packDate: form.packDate,
      boxNo: form.boxNo,
      colorCode: form.colorCode || null,
      pcsPerBox: Number(form.pcsPerBox),
      boxesPacked: Number(form.boxesPacked),
      nwPerBoxKg: blank(form.nwPerBoxKg),
      gwPerBoxKg: blank(form.gwPerBoxKg),
      lengthCm: blank(form.lengthCm),
      widthCm: blank(form.widthCm),
      heightCm: blank(form.heightCm),
      remarks: form.remarks || null,
    };
    try {
      const saved = editing
        ? await api.update(existing.id, body)
        : await api.create({ ...body, orderId, styleId });
      if (addNext && !editing) {
        const match = form.boxNo.trim().match(/^(\d+)$/);
        setForm((f) => ({ ...f, boxNo: match ? String(Number(match[1]) + 1) : '', boxesPacked: '1' }));
        setError('');
        setBusy(false);
        onSaved(true);
      } else {
        onSaved(saved);
      }
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.remove(existing.id);
      onSaved();
    } catch (e) {
      setError(e.message);
      setDeleting(false);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? `Boxes ${existing.boxNo} - ${existing.order?.orderNo} / ${existing.style?.styleNo}` : 'Add boxes'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {editing && !onDispatch && can('PACKING.DELETE') && <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>Delete</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {!left && !editing && <button type="button" className="btn" disabled={!ready} onClick={() => save(true)}>{busy ? 'Saving…' : 'Save & Add Next Box'}</button>}
          {!left && <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => save(false)}>{busy ? 'Saving…' : editing ? 'Save' : 'Save Box'}</button>}
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {left && (
        <Alert kind="info">
          These boxes left on {onDispatch.dispatchNo} and are as its papers say. Set {onDispatch.dispatchNo} back to Pending first if they were packed wrong.
        </Alert>
      )}
      {onDispatch && !left && (
        <Alert kind="info">These boxes are on pending dispatch {onDispatch.dispatchNo}. Its totals follow any correction made here.</Alert>
      )}

      <div className="form-grid four">
        <Field label="Date" required>
          <TextInput type="date" value={form.packDate} max={ctx.today} onChange={(e) => set({ packDate: e.target.value })} />
        </Field>
        <Field label="Box No" required hint="e.g. 1-20" error={bad.boxNo}>
          <TextInput value={form.boxNo} maxLength={40} onChange={(e) => set({ boxNo: e.target.value })} />
        </Field>
        {editing ? (
          <Field label="Order No · Style No." className="span-2"><div className="unit-fact">{existing.order?.orderNo} · {existing.style?.styleNo}</div></Field>
        ) : (
          <Field label="Order No · Style No." required className="span-2">
            <RecordSelect value={form.key} onChange={(e) => set({ key: e.target.value, colorCode: '', pcsPerBox: '' })} options={options} getValue={(o) => o.key} getLabel={optionLabel} placeholder="Choose the order" />
          </Field>
        )}
        <Field label="Order size"><div className="unit-fact">{n0(position?.orderQty)}</div></Field>
        <Field label="Name" className="span-2"><div className="unit-fact">{position?.styleDescription ?? '-'}</div></Field>
        <Field label="Color" required hint={color ? `${n0(available)} needle-checked pcs waiting.` : 'The colours Needle Checking passed.'}>
          <select value={form.colorCode} onChange={(e) => set({ colorCode: e.target.value })} disabled={!position}>
            <option value="">Choose</option>
            {(position?.colors ?? []).map((c) => <option key={c.color} value={c.color}>{c.color || '(no colour)'} - {n0(c.available)} waiting</option>)}
          </select>
        </Field>
        <Field label="Packing" required hint={position ? `Pieces in each box. A full carton: ${cartonMakeUp(position)}.` : 'Pieces in each box.'} error={bad.pcsPerBox}>
          <TextInput type="number" inputMode="numeric" min="1" step="1" value={form.pcsPerBox} onChange={(e) => set({ pcsPerBox: e.target.value })} />
        </Field>
        <Field label="Packets × bags" hint="One box.">
          <div className="unit-fact">{packetsLabel(form.pcsPerBox, position?.bagsPerPacket) || '-'}</div>
        </Field>
        <Field label="Boxes" required error={bad.boxesPacked}>
          <TextInput type="number" inputMode="numeric" min="1" step="1" value={form.boxesPacked} onChange={(e) => set({ boxesPacked: e.target.value })} />
        </Field>
        <Field label="Qty (in pcs)" hint="Packing × Boxes." error={color && qty > available ? `Only ${n0(available)} needle-checked.` : undefined}>
          <div className="unit-fact"><strong>{n0(qty)}</strong></div>
        </Field>
        <Field label="N.W per box (kg)" error={bad.nwPerBoxKg}>
          <TextInput type="number" inputMode="decimal" min="0" step="0.01" value={form.nwPerBoxKg} onChange={(e) => set({ nwPerBoxKg: e.target.value })} />
        </Field>
        <Field label="G.W per box (kg)" error={bad.gwPerBoxKg}>
          <TextInput type="number" inputMode="decimal" min="0" step="0.01" value={form.gwPerBoxKg} onChange={(e) => set({ gwPerBoxKg: e.target.value })} />
        </Field>
        <Field label="N.W (kg)" hint="Per box × Boxes."><div className="unit-fact">{nw == null ? '-' : kg(nw)}</div></Field>
        <Field label="G.W (kg)" hint="Per box × Boxes."><div className="unit-fact">{gw == null ? '-' : kg(gw)}</div></Field>
        <Field label="L (cm)" error={bad.lengthCm}>
          <TextInput type="number" inputMode="decimal" min="0" step="0.1" value={form.lengthCm} onChange={(e) => set({ lengthCm: e.target.value })} />
        </Field>
        <Field label="W (cm)" error={bad.widthCm}>
          <TextInput type="number" inputMode="decimal" min="0" step="0.1" value={form.widthCm} onChange={(e) => set({ widthCm: e.target.value })} />
        </Field>
        <Field label="H (cm)" error={bad.heightCm}>
          <TextInput type="number" inputMode="decimal" min="0" step="0.1" value={form.heightCm} onChange={(e) => set({ heightCm: e.target.value })} />
        </Field>
        <Field label="CBM" hint="L × W × H ÷ 1,000,000 × Boxes."><div className="unit-fact">{volume == null ? '-' : cbm(volume)}</div></Field>
      </div>
      <Field label="Remarks">
        <TextArea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
      </Field>

      {deleting && (
        <ConfirmDialog
          title="Delete these boxes?"
          message="Their pieces go back to needle-checked and waiting. Refused once they are on a dispatch."
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onCancel={() => setDeleting(false)}
        />
      )}
    </Modal>
  );
}
