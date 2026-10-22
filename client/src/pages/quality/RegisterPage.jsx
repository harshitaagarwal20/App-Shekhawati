/**
 * One screen for every Phase 5 register.
 *
 * The descriptor (config/registers.jsx) names the columns, the filters and the
 * form; this page does the rest the same way each time: search, order and
 * date filters, sorting, paging, export, and a form that fills itself from the
 * order once one is chosen.
 *
 * Nothing worked out here is saved. The previews repeat the sheet's formulas
 * while the form is keyed; the server calculates the stored figure.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { useOptionalColumns } from '../../hooks/useOptionalColumns.js';
import { productionLookups, productionRegister } from '../../services/erp.js';
import {
  Alert,
  ColumnMenu,
  ConfirmDialog,
  EmptyState,
  Field,
  MasterSelect,
  Modal,
  PageHeader,
  Pagination,
  RecordSelect,
  RowActions,
  SortableTh,
  Spinner,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { loadFailed } from '../../services/loadFailures.js';
import { fmtDate, fmtNum, toDateInput, todayInput } from '../../utils/format.js';

const fieldsOf = (d) => d.fields;
const SENT = new Set(['date', 'order', 'style', 'employee', 'master', 'int', 'text', 'textarea']);

/** Server row -> form values. Every input starts as a string, never undefined. */
function initialForm(d, row) {
  const out = {};
  for (const f of fieldsOf(d)) {
    if (!SENT.has(f.type)) continue;
    const v = row?.[f.name];
    if (f.type === 'date') out[f.name] = v ? toDateInput(v) : f.defaultToday ? todayInput() : '';
    else out[f.name] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

/** Form values -> request body. Blanks are null, counts are numbers. */
function toBody(d, form) {
  const body = {};
  for (const f of fieldsOf(d)) {
    if (!SENT.has(f.type)) continue;
    const v = form[f.name];
    if (f.type === 'int') {
      if (v !== '' && v !== undefined) body[f.name] = Number(v);
      continue;
    }
    if (f.type === 'date') {
      if (v) body[f.name] = v;
      continue;
    }
    body[f.name] = v === '' ? null : v;
  }
  // A style is Auto: sent only once one has been resolved.
  if (body.styleId === null) delete body.styleId;
  return body;
}

// ===========================================================================
//  THE REGISTER
// ===========================================================================

export default function RegisterPage({ descriptor: d }) {
  const { can } = useAuth();
  const api = useMemo(() => productionRegister(d.path), [d.path]);

  const canCreate = can(`${d.module}.CREATE`);
  const canEdit = can(`${d.module}.EDIT`);
  const canDelete = can(`${d.module}.DELETE`);
  const dated = d.key !== 'reconciliation';

  const columns = useMemo(
    () => d.columns.map((c) => ({ key: c.key, label: c.label, optional: c.optional })),
    [d.columns],
  );
  const cols = useOptionalColumns(`register-${d.key}`, columns);
  const shown = d.columns.filter((c) => cols.show(c.key));

  const list = useResourceList((params) => api.list(params), {
    defaultSort: dated ? 'recordDate' : 'updatedAt',
    defaultDir: 'desc',
    initialFilters: {
      orderId: '',
      ...(dated ? { dateFrom: '', dateTo: '' } : {}),
      ...Object.fromEntries((d.filters ?? []).map((f) => [f.name, ''])),
    },
  });

  const [orders, setOrders] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | row
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    productionLookups.orders().then(setOrders).catch(loadFailed(setOrders, 'orders'));
  }, []);

  const open = useCallback(
    async (row) => {
      setBusy(true);
      try {
        setEditing(await api.get(row.id));
      } catch (e) {
        setBanner({ kind: 'error', text: e.message });
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  async function confirmDelete() {
    setBusy(true);
    try {
      await api.remove(deleting.id);
      setBanner({ kind: 'success', text: `The ${d.singular} was deleted.` });
      setDeleting(null);
      list.reload();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  const span = cols.colSpan + 1;

  return (
    <>
      <PageHeader
        title={d.title}
        actions={
          <>
            <ExportButton dataset={d.path} params={list.query} rowCount={list.meta.total} />
            {canCreate && (
              <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
                New {d.singular}
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
      {list.error && <Alert kind="error">{list.error.message}</Alert>}

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor={`${d.key}-search`}>
              <TextInput
                id={`${d.key}-search`}
                type="search"
                placeholder="Order no, style no, name, remarks..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Order No">
            <RecordSelect
              value={list.filters.orderId}
              onChange={(e) => list.setFilter('orderId', e.target.value)}
              options={orders}
              getValue={(o) => o.id}
              getLabel={(o) => o.orderNo}
              placeholder="All orders"
            />
          </Field>
          {(d.filters ?? []).map((f) => (
            <Field key={f.name} label={f.label}>
              <MasterSelect
                listCode={f.listCode}
                placeholder="All"
                value={list.filters[f.name] ?? ''}
                onChange={(e) => list.setFilter(f.name, e.target.value)}
              />
            </Field>
          ))}
          {dated && (
            <>
              <Field label="From">
                <TextInput type="date" value={list.filters.dateFrom} onChange={(e) => list.setFilter('dateFrom', e.target.value)} />
              </Field>
              <Field label="To">
                <TextInput type="date" value={list.filters.dateTo} onChange={(e) => list.setFilter('dateTo', e.target.value)} />
              </Field>
            </>
          )}
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                {shown.map((c) =>
                  c.sort ? (
                    <SortableTh
                      key={c.key}
                      field={c.sort}
                      label={c.label}
                      sortBy={list.sortBy}
                      sortDir={list.sortDir}
                      onSort={list.toggleSort}
                      className={c.className === 'num' ? 'num' : ''}
                    />
                  ) : (
                    <th key={c.key} className={c.className === 'num' ? 'num' : ''}>{c.label}</th>
                  ),
                )}
                <th className="actions-head">Actions</th>
                <ColumnMenu {...cols} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={span} className="loading-row">
                    <Spinner label="Loading..." />
                  </td>
                </tr>
              )}
              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={span}>
                    <EmptyState
                      title={`No ${d.singular} yet`}
                      message={canCreate ? `Use "New ${d.singular}" to record the first one.` : undefined}
                    />
                  </td>
                </tr>
              )}
              {!list.loading &&
                list.rows.map((row) => (
                  <tr key={row.id} className="clickable" onClick={() => open(row)}>
                    {shown.map((c) => (
                      <td key={c.key} className={c.className ?? ''}>
                        {c.render(row)}
                      </td>
                    ))}
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        items={[
                          { label: canEdit ? 'Open / edit' : 'Open', onClick: () => open(row), disabled: busy },
                          canDelete && { label: 'Delete', onClick: () => setDeleting(row), disabled: busy, danger: true },
                        ]}
                      />
                    </td>
                    <td />
                  </tr>
                ))}
            </tbody>
          </table>
        </TableWrap>

        <Pagination
          meta={list.meta}
          page={list.page}
          pageSize={list.pageSize}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      </div>

      {editing && (
        <RegisterForm
          key={editing === 'new' ? 'new' : editing.id}
          d={d}
          api={api}
          orders={orders}
          existing={editing === 'new' ? null : editing}
          readOnly={editing !== 'new' && !canEdit}
          onClose={() => setEditing(null)}
          onOpen={(id) => open({ id })}
          onSaved={(_saved, isNew) => {
            setEditing(null);
            setBanner({ kind: 'success', text: `The ${d.singular} was ${isNew ? 'saved' : 'updated'}.` });
            list.reload();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete this ${d.singular}?`}
          danger
          busy={busy}
          confirmLabel="Delete"
          message="It is removed from the register and from every total that reads it. The audit trail keeps a record of it."
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

// ===========================================================================
//  THE FORM
// ===========================================================================

function RegisterForm({ d, api, orders, existing, readOnly, onClose, onSaved, onOpen }) {
  const fields = fieldsOf(d);
  const needsEmployees = fields.some((f) => f.type === 'employee');

  const [form, setForm] = useState(() => initialForm(d, existing));
  const [ctx, setCtx] = useState(null);
  const [employees, setEmployees] = useState(null);
  const [styles, setStyles] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  /** The last value the order filled into each field - so a typed value is never replaced. */
  const autoFilled = useRef({});
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // The order options, plus the record's own order when it has since dropped off the list.
  const orderOptions = useMemo(() => {
    if (existing?.order && !orders.some((o) => o.id === existing.orderId)) return [existing.order, ...orders];
    return orders;
  }, [orders, existing]);

  useEffect(() => {
    if (needsEmployees) productionLookups.employees().then(setEmployees).catch(loadFailed(setEmployees, 'employees'));
    if (d.orderOptional) productionLookups.styles().then(setStyles).catch(loadFailed(setStyles, 'styles'));
  }, [needsEmployees, d.orderOptional]);

  /** Fills what the order and style decide, where nobody has typed over it. */
  const applyContext = useCallback(
    (f, c) => {
      let next = { ...f };
      if (c && (!next.styleId || !c.styles.some((s) => s.id === next.styleId))) {
        next.styleId = c.styles[0]?.id ?? '';
      }
      const patch = (c && d.onContext?.({ ctx: c, form: next })) ?? {};
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null) continue;
        if (next[k] === '' || next[k] === autoFilled.current[k]) {
          next = { ...next, [k]: v };
          autoFilled.current[k] = v;
        }
      }
      return next;
    },
    [d],
  );

  // The order's context: its styles and the reconciliation figures.
  useEffect(() => {
    if (!form.orderId) {
      setCtx(null);
      return;
    }
    let cancelled = false;
    productionLookups
      .orderContext(form.orderId)
      .then((c) => {
        if (cancelled) return;
        setCtx(c);
        // An existing record keeps what it holds; only a new one is filled.
        if (!existing) setForm((f) => applyContext(f, c));
      })
      .catch(() => !cancelled && setCtx(null));
    return () => {
      cancelled = true;
    };
  }, [form.orderId, existing, applyContext]);

  function changeStyle(styleId) {
    setForm((f) => (existing ? { ...f, styleId } : applyContext({ ...f, styleId }, ctx)));
  }

  const missing = fields.some((f) => {
    if (!SENT.has(f.type)) return false;
    const required = f.required || f.requiredIf?.(form);
    if (!required) return false;
    if (f.type === 'style') return !form.styleId && !(d.orderOptional && form.orderId);
    return form[f.name] === '' || form[f.name] === undefined;
  });

  async function save() {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const body = toBody(d, form);
      const saved = existing ? await api.update(existing.id, body) : await api.create(body);
      onSaved(saved, !existing);
    } catch (e) {
      setErrors(e.fieldErrors ?? {});
      setError({ message: e.message, openId: e.code === 'CONFLICT' ? e.details?.id : null });
      setBusy(false);
    }
  }

  function renderField(f) {
    const err = errors[f.name];
    const required = f.required || f.requiredIf?.(form);
    const disabled = readOnly;
    const value = form[f.name] ?? '';
    const onValue = (e) => set({ [f.name]: e.target.value });
    let control;

    switch (f.type) {
      case 'date':
        control = <TextInput type="date" value={value} onChange={onValue} disabled={disabled} error={err} />;
        break;
      case 'int':
        control = (
          <TextInput type="number" min="0" step="1" inputMode="numeric" value={value} onChange={onValue}
            disabled={disabled} error={err} placeholder="0" />
        );
        break;
      case 'text':
        control = <TextInput value={value} onChange={onValue} disabled={disabled} error={err} maxLength={150} />;
        break;
      case 'textarea':
        control = <TextArea rows={2} value={value} onChange={onValue} disabled={disabled} error={err} />;
        break;
      case 'master':
        control = (
          <MasterSelect listCode={f.listCode} value={value} currentValue={value} onChange={onValue}
            disabled={disabled} error={err} />
        );
        break;
      case 'order':
        control = (
          <RecordSelect
            value={value}
            onChange={(e) => {
              autoFilled.current = {};
              set({ orderId: e.target.value, styleId: '' });
            }}
            options={orderOptions}
            getValue={(o) => o.id}
            getLabel={(o) => `${o.orderNo}${o.buyer?.buyerName ? ` - ${o.buyer.buyerName}` : ''}`}
            placeholder={f.required ? 'Select order...' : 'No order'}
            disabled={disabled || (existing && f.required)}
            error={err}
          />
        );
        break;
      case 'style': {
        const opts = form.orderId ? (ctx?.styles ?? []) : (d.orderOptional ? (styles ?? []) : []);
        control = (
          <RecordSelect
            value={value}
            onChange={(e) => changeStyle(e.target.value)}
            options={opts}
            getValue={(s) => s.id}
            getLabel={(s) => `${s.styleNo}${s.styleDescription ? ` - ${s.styleDescription}` : ''}`}
            placeholder={form.orderId || d.orderOptional ? 'Select style...' : 'Choose an order first'}
            disabled={disabled || (!form.orderId && !d.orderOptional)}
            error={err}
          />
        );
        break;
      }
      case 'employee':
        control = (
          <RecordSelect
            value={value}
            onChange={onValue}
            options={employees ?? []}
            loading={!employees}
            getValue={(emp) => emp.id}
            getLabel={(emp) => `${emp.empId} - ${emp.empName}${emp.unitLine ? ` (${emp.unitLine})` : ''}`}
            placeholder="Select employee..."
            disabled={disabled}
            error={err}
          />
        );
        break;
      case 'preview':
        control = <TextInput value={f.compute(form, ctx) ?? '-'} readOnly disabled />;
        break;
      case 'figures':
        return <FiguresCard key={f.name} figures={(ctx?.styles?.find((s) => s.id === form.styleId) ?? ctx?.styles?.[0])?.figures} />;
      default:
        control = null;
    }

    return (
      <Field
        key={f.name}
        label={f.label}
        required={required}
        error={err}
        hint={f.hint}
        className={f.span === 2 ? 'span-2' : ''}
      >
        {control}
      </Field>
    );
  }

  const title = existing
    ? `${d.title} - ${existing.order?.orderNo ?? existing.style?.styleNo ?? ''}${existing.recordDate ? ` / ${fmtDate(existing.recordDate)}` : ''}`
    : `New ${d.singular}`;

  return (
    <Modal
      title={title}
      size={d.modalSize ?? 'wide'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button type="button" className="btn btn-primary" disabled={busy || missing} onClick={save}>
              {busy ? 'Saving...' : existing ? 'Save changes' : 'Save'}
            </button>
          )}
        </>
      }
    >
      {error && (
        <Alert kind="error">
          {error.message}
          {error.openId && (
            <>
              {' '}
              <button type="button" className="btn btn-sm" onClick={() => onOpen(error.openId)}>
                Open it
              </button>
            </>
          )}
        </Alert>
      )}
      {readOnly && <p className="hint" style={{ marginTop: 0 }}>You may read this register but not change it.</p>}

      <div className="form-grid">{fields.map(renderField)}</div>
    </Modal>
  );
}

// ===========================================================================
//  THE RECONCILIATION FIGURES
// ===========================================================================

function FiguresCard({ figures }) {
  if (!figures) {
    return <p className="hint span-2">Choose an order to see what the registers say about it.</p>;
  }
  const rows = [
    ['Cutting Pcs Issued', figures.cuttingIssued, 'from Cutting Issue (posted)'],
    ['Stitched Pcs Received', figures.stitched, 'from Stitching Record'],
    ['Alter Pcs', figures.alter, 'sent to the Alteration Unit'],
    ['Scrap Pcs', figures.scrap, 'from Spot Rectification & Scrap'],
    ['Rejected Pcs', figures.rejected, 'from the Rejected Register'],
    ['Passed External QC', figures.passedExternalQc, 'External QC Approved - Packing is not built yet'],
  ];
  return (
    <div className="span-2">
      <TableWrap>
        <table className="data">
          <tbody>
            {rows.map(([label, value, source]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="num">{fmtNum(value)}</td>
                <td className="muted">{source}</td>
              </tr>
            ))}
            <tr>
              <td><strong>Variance</strong></td>
              <td className="num"><strong>{fmtNum(figures.variance)}</strong></td>
              <td className="muted">Cutting Issued - Stitched - Scrap - Rejected (balance = WIP)</td>
            </tr>
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}
