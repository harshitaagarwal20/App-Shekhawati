/**
 * Needle Checking - the "Size Allotment Sheet".
 *
 * ---------------------------------------------------------------------------
 *  THE FIELDS, AND WHO FILLS THEM
 *
 *      Order No / Style        DROPDOWN - once, at the top of the sheet
 *      Carton                  AUTO - the run of carton numbers, 1-5, 6-8 ...
 *      Carton Qty              MANUAL - cartons of this assortment
 *      Color                   DROPDOWN - the order's colours for the style
 *      Size 1 .. Size 10       MANUAL - pieces of each size in one carton
 *      Weight                  MANUAL - kg, one carton
 *      Pcs/Carton              FORMULA - Size 1 + ... + Size 10, shown as
 *                              packets and bags (one piece a bag; the style
 *                              says how many bags a packet, 10 by default)
 *      Sign.                   MANUAL
 *
 *  The cartons never hold more than External QC approved. What they hold is
 *  what Packing may pack, colour by colour.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { needleChecking as api } from '../../services/erp.js';
import { Alert, ConfirmDialog, EmptyState, Field, Modal, PageHeader, RecordSelect, Spinner, TextInput } from '../../components/ui.jsx';
import { fmtDate, fmtNum, fmtOrderStyle, todayInput } from '../../utils/format.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { cartonMakeUp, packetsLabel } from '../../utils/packets.js';
import DateRangeFilter from '../../components/DateRangeFilter.jsx';

const n0 = (v) => fmtNum(v, { decimals: 0 });
const num = (v) => Number(v || 0);
const SIZES = Array.from({ length: 10 }, (_, i) => `size${i + 1}`);
const optionLabel = fmtOrderStyle;
const pcsPerCarton = (row) => SIZES.reduce((a, k) => a + num(row[k]), 0);

export function NeedleList() {
  const { can } = useAuth();
  const [ctx, setCtx] = useState(null);
  const [options, setOptions] = useState([]);
  const [key, setKey] = useState('');
  const [sheet, setSheet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [dateFrom, setDateFrom] = useState(todayInput);
  const [dateTo, setDateTo] = useState(todayInput);

  const loadOptions = useCallback(() => {
    api.orders().then(setOptions).catch(() => setOptions([]));
  }, []);
  useEffect(() => {
    api.context().then(setCtx).catch(() => setCtx({ today: new Date().toISOString().slice(0, 10) }));
    loadOptions();
  }, [loadOptions]);

  const [orderId, styleId] = key ? key.split(':') : [];
  // Only the latest request may fill the sheet: an answer for the order chosen
  // before must not land under the one chosen now.
  const latest = useRef(0);
  const loadSheet = useCallback(() => {
    const mine = ++latest.current;
    if (!orderId) {
      setSheet(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    api.position({ orderId, styleId, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined })
      .then((s) => mine === latest.current && setSheet(s))
      .catch((e) => mine === latest.current && setError(e.message))
      .finally(() => mine === latest.current && setLoading(false));
  }, [orderId, styleId, dateFrom, dateTo]);
  /** Another order: its sheet is not this one's until it has loaded. */
  const choose = (next) => {
    if (next === key) return;
    setSheet(null);
    setKey(next);
  };
  useEffect(loadSheet, [loadSheet]);

  const chosen = options.find((o) => o.key === key);
  const canEdit = can('NEEDLE_DETECTION.EDIT');

  return (
    <>
      <PageHeader
        title="Needle Checking"
        actions={
          <>
            <ExportButton
              dataset="needle-checking"
              params={orderId ? { orderId, styleId, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined } : {}}
            />
            {can('NEEDLE_DETECTION.CREATE') && sheet && (
              <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>Add cartons</button>
            )}
          </>
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Size Allotment Sheet</div>
        <div className="card-body">
          {!options.length && (
            <Alert kind="info">
              No orders are ready for Needle Checking. Record approved pieces in <Link to="/external-qc">External QC</Link> first.
            </Alert>
          )}
          <div className="form-grid four">
            <Field label="Order No · Style" required className="span-2">
              <RecordSelect value={key} onChange={(e) => choose(e.target.value)} options={options} getValue={(o) => o.key} getLabel={optionLabel} placeholder={options.length ? 'Choose the order' : 'No External QC approved orders'} />
            </Field>
            <Field label="Order qty"><div className="unit-fact">{n0(sheet?.orderQty ?? chosen?.orderQty)}</div></Field>
            <Field label="Size group"><div className="unit-fact">{sheet?.sizeGroup || '-'}</div></Field>
            <Field label="External QC approved"><div className="unit-fact">{sheet ? n0(sheet.flow.approved) : '-'}</div></Field>
            <Field label="Needle-checked"><div className="unit-fact"><strong>{sheet ? n0(sheet.flow.needleChecked) : '-'}</strong></div></Field>
            <Field label="Waiting to be checked"><div className="unit-fact">{sheet ? n0(sheet.flow.awaitingNeedle) : '-'}</div></Field>
            <Field label="Packed"><div className="unit-fact">{sheet ? n0(sheet.flow.packed) : '-'}</div></Field>
            <Field label="A full carton" className="span-2" hint="One piece to a bag. Set on the Style master.">
              <div className="unit-fact">{cartonMakeUp(sheet)}</div>
            </Field>
          </div>
        </div>
      </div>

      {key && (
        <div className="filter-row" style={{ marginBottom: 16 }}>
          <DateRangeFilter
            filters={{ dateFrom, dateTo }}
            setFilter={(name, value) => (name === 'dateFrom' ? setDateFrom(value) : setDateTo(value))}
          />
        </div>
      )}

      {error && <Alert kind="error">{error}</Alert>}
      {!key ? (
        <EmptyState
          title="Choose an order"
          message={options.length ? 'Pick the order and style at the top to see its sheet.' : 'Nothing has been approved at External QC yet.'}
        />
      ) : loading && !sheet ? (
        <Spinner label="Loading the sheet" />
      ) : sheet && sheet.rows.length === 0 ? (
        <EmptyState title="No cartons yet" message="Add the cartons as they pass the needle detector with “Add cartons”." />
      ) : sheet && (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Carton</th>
                <th className="num">Carton Qty.</th>
                <th>Color</th>
                {SIZES.map((k, i) => <th key={k} className="num">Size {i + 1}</th>)}
                <th className="num">Weight</th>
                <th className="num">Pcs/Carton</th>
                <th>Sign.</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((r) => (
                <tr key={r.id} className={canEdit ? 'clickable' : ''} onClick={() => canEdit && setEditing(r)}>
                  <td className="nowrap">{fmtDate(r.checkDate)}</td>
                  <td className="nowrap"><strong>{r.seq}</strong></td>
                  <td className="num">{n0(r.cartonQty)}</td>
                  <td>{r.colorCode}</td>
                  {SIZES.map((k) => <td key={k} className="num">{r[k] ? n0(r[k]) : ''}</td>)}
                  <td className="num">{r.weightKg == null ? '' : fmtNum(r.weightKg, { decimals: 2 })}</td>
                  <td className="num"><strong>{n0(r.pcsPerCarton)}</strong></td>
                  <td>{r.signedBy}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Total</strong></td>
                <td className="num"><strong>{n0(sheet.totals.cartons)}</strong></td>
                <td />
                {SIZES.map((k) => <td key={k} className="num"><strong>{sheet.totals[k] ? n0(sheet.totals[k]) : ''}</strong></td>)}
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      )}

      {editing && ctx && sheet && (
        <CartonModal
          ctx={ctx}
          sheet={sheet}
          orderId={orderId}
          styleId={styleId}
          label={chosen ? optionLabel(chosen) : ''}
          existing={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadOptions();
            loadSheet();
          }}
        />
      )}
    </>
  );
}

function CartonModal({ ctx, sheet, orderId, styleId, label, existing, onClose, onSaved }) {
  const { can, user } = useAuth();
  const editing = Boolean(existing);
  const [form, setForm] = useState(() => ({
    checkDate: existing?.checkDate ? String(existing.checkDate).slice(0, 10) : ctx.today,
    cartonQty: existing ? String(existing.cartonQty) : '',
    colorCode: existing?.colorCode ?? (sheet.colors.length === 1 ? sheet.colors[0] : ''),
    ...Object.fromEntries(SIZES.map((k) => [k, existing?.[k] ? String(existing[k]) : ''])),
    weightKg: existing?.weightKg ?? '',
    signedBy: existing?.signedBy ?? user?.fullName ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const per = pcsPerCarton(form);
  const total = per * num(form.cartonQty);
  const mine = editing ? num(existing.totalPcs) : 0;
  const available = num(sheet.flow.awaitingNeedle) + mine;
  // What the server would refuse, said at the field rather than after Save.
  const whole = (v, min) => v === '' || (Number.isInteger(Number(v)) && Number(v) >= min);
  const bad = {
    cartonQty: whole(form.cartonQty, 1) ? undefined : 'A whole number of cartons.',
    weightKg: form.weightKg === '' || Number(form.weightKg) > 0 ? undefined : 'More than 0, or leave it blank.',
    ...Object.fromEntries(SIZES.map((k) => [k, whole(form[k], 0) ? undefined : 'Whole pieces.'])),
  };
  const ready = !busy && num(form.cartonQty) > 0 && per > 0 && total <= available && form.signedBy.trim()
    && (!sheet.colors.length || form.colorCode) && !Object.values(bad).some(Boolean);

  async function save() {
    setBusy(true);
    setError('');
    const body = {
      checkDate: form.checkDate,
      cartonQty: Number(form.cartonQty),
      colorCode: form.colorCode || null,
      ...Object.fromEntries(SIZES.map((k) => [k, form[k] === '' ? 0 : Number(form[k])])),
      weightKg: form.weightKg === '' ? null : form.weightKg,
      signedBy: form.signedBy,
    };
    try {
      onSaved(editing ? await api.update(existing.id, body) : await api.create({ ...body, orderId, styleId }));
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
      title={editing ? `Carton ${existing.seq} - ${label}` : `Add cartons - ${label}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {editing && can('NEEDLE_DETECTION.DELETE') && <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>Delete</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <div className="form-grid four">
        <Field label="Date" required>
          <TextInput type="date" value={form.checkDate} max={ctx.today} onChange={(e) => set({ checkDate: e.target.value })} />
        </Field>
        <Field label="Carton qty" required hint="Cartons packed to this assortment." error={bad.cartonQty}>
          <TextInput type="number" inputMode="numeric" min="1" step="1" value={form.cartonQty} onChange={(e) => set({ cartonQty: e.target.value })} />
        </Field>
        <Field label="Color" required={sheet.colors.length > 0}>
          {sheet.colors.length ? (
            <select value={form.colorCode} onChange={(e) => set({ colorCode: e.target.value })}>
              <option value="">Choose</option>
              {sheet.colors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <TextInput value={form.colorCode} maxLength={60} onChange={(e) => set({ colorCode: e.target.value })} />
          )}
        </Field>
        <Field label="Weight (kg)" hint="One carton." error={bad.weightKg}>
          <TextInput type="number" inputMode="decimal" min="0" step="0.01" value={form.weightKg} onChange={(e) => set({ weightKg: e.target.value })} />
        </Field>
        <Field label="Sign." required>
          <TextInput value={form.signedBy} maxLength={120} onChange={(e) => set({ signedBy: e.target.value })} />
        </Field>
      </div>

      <h4 style={{ margin: '12px 0 4px' }}>Pieces of each size in one carton{sheet.sizeGroup ? ` (${sheet.sizeGroup})` : ''}</h4>
      <div className="form-grid five">
        {SIZES.map((k, i) => (
          <Field key={k} label={`Size ${i + 1}`} error={bad[k]}>
            <TextInput type="number" inputMode="numeric" min="0" step="1" value={form[k]} onChange={(e) => set({ [k]: e.target.value })} />
          </Field>
        ))}
      </div>

      <div className="form-grid four">
        <Field
          label="Pcs/Carton"
          hint={sheet.pcsPerFullCarton && per && per !== num(sheet.pcsPerFullCarton) ? `A full carton of this style is ${n0(sheet.pcsPerFullCarton)}.` : 'Size 1 + … + Size 10.'}
        >
          <div className="unit-fact"><strong>{n0(per)}</strong> {per > 0 && <span className="faint">{packetsLabel(per, sheet.bagsPerPacket)}</span>}</div>
        </Field>
        <Field label="Total pcs" hint="Pcs/Carton × Carton qty." error={total > available ? `Only ${n0(available)} approved pcs are waiting.` : undefined}>
          <div className="unit-fact"><strong>{n0(total)}</strong></div>
        </Field>
        <Field label="Waiting to be checked"><div className="unit-fact">{n0(available)}</div></Field>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete these cartons?"
          message="The cartons after them are numbered on from the row above. Refused once their pieces have been packed."
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
