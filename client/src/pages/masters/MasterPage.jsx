/**
 * Generic master screen: list with search / filter / sort / paging, a create
 * and edit form, an active-inactive toggle and a guarded delete.
 *
 * Every field marked `type: 'master'` renders a MasterSelect, which reads its
 * options from the List Master at runtime.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { useOptionalColumns } from '../../hooks/useOptionalColumns.js';
import { buyers as buyersApi } from '../../services/erp.js';
import {
  Alert,
  ColumnMenu,
  ConfirmDialog,
  EmptyState,
  EnumSelect,
  Field,
  MasterSelect,
  Modal,
  RowActions,
  PageHeader,
  Pagination,
  RecordSelect,
  SortableTh,
  Spinner,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import { ExportButton, ImportButton } from '../../components/dataTransfer.jsx';
import { reportLoadFailure } from '../../services/loadFailures.js';
import { focusFirstError } from '../../components/form.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

/** Blank form values derived from the descriptor, so nothing starts undefined. */
function emptyValues(descriptor) {
  const out = {};
  for (const section of descriptor.sections) {
    for (const f of section.fields) {
      out[f.name] = f.type === 'status' ? 'ACTIVE' : '';
    }
  }
  return out;
}

/** Server record -> form values (nulls become '' so inputs stay controlled). */
function toFormValues(descriptor, record) {
  const out = emptyValues(descriptor);
  for (const key of Object.keys(out)) {
    const v = record[key];
    out[key] = v === null || v === undefined ? (key === 'status' ? 'ACTIVE' : '') : String(v);
  }
  return out;
}

export default function MasterPage({ descriptor, renderExtraForm, buildSubmitPayload, formWidth }) {
  const { can } = useAuth();
  const api = descriptor.api;

  /*
   * The column menu, for every master at once.
   *
   * This table is built FROM the descriptor, so a master opts a column out by
   * writing `optional: true` beside it in masters.jsx - there is nothing to
   * wire per screen. `cols.colSpan` counts only the columns that are showing;
   * the Actions column is added to it separately because it is not a
   * descriptor column and can never be turned off.
   */
  const cols = useOptionalColumns(
    descriptor.key,
    descriptor.columns.map((c) => ({ key: c.field, label: c.label, optional: c.optional })),
  );
  const shownColumns = descriptor.columns.filter((c) => cols.show(c.field));

  const list = useResourceList((params) => api.list(params), {
    defaultSort: descriptor.defaultSort,
    initialFilters: Object.fromEntries((descriptor.filters ?? []).map((f) => [f.name, ''])),
  });

  const [editing, setEditing] = useState(null); // null | 'new' | record
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null); // { kind, text }
  const [formError, setFormError] = useState('');
  const [recordOptions, setRecordOptions] = useState({});

  const canCreate = can(`${descriptor.module}.CREATE`);
  const canEdit = can(`${descriptor.module}.EDIT`);
  const canDelete = can(`${descriptor.module}.DELETE`);

  const form = useForm({
    resolver: zodResolver(descriptor.schema),
    defaultValues: emptyValues(descriptor),
  });
  const { register, handleSubmit, reset, watch, setError, formState } = form;

  // Load the record-backed dropdowns this form needs (currently Buyer).
  const needsBuyers = useMemo(
    () =>
      descriptor.sections.some((s) => s.fields.some((f) => f.type === 'record' && f.resource === 'buyers')),
    [descriptor],
  );

  useEffect(() => {
    if (!needsBuyers || recordOptions.buyers) return;
    buyersApi
      .options()
      .then((rows) => setRecordOptions((o) => ({ ...o, buyers: rows })))
      .catch((err) => {
        reportLoadFailure('buyers', err);
        setRecordOptions((o) => ({ ...o, buyers: [] }));
      });
  }, [needsBuyers, recordOptions.buyers]);

  const openCreate = useCallback(() => {
    setFormError('');
    reset(emptyValues(descriptor));
    setEditing('new');
  }, [descriptor, reset]);

  const openEdit = useCallback(
    async (row) => {
      setFormError('');
      setBusy(true);
      try {
        // Re-read the full record: the list projection may omit fields.
        const full = await api.get(row[descriptor.idField]);
        reset(toFormValues(descriptor, full));
        setEditing(full);
      } catch (e) {
        setBanner({ kind: 'error', text: e.message });
      } finally {
        setBusy(false);
      }
    },
    [api, descriptor, reset],
  );

  async function onSubmit(values) {
    setFormError('');
    const payload = buildSubmitPayload ? buildSubmitPayload(values, form) : values;
    if (payload === null) return; // the extra form rejected it

    try {
      if (editing === 'new') {
        const created = await api.create(payload);
        setBanner({ kind: 'success', text: `${descriptor.singular} "${created[descriptor.titleField]}" created.` });
      } else {
        const updated = await api.update(editing[descriptor.idField], payload);
        setBanner({ kind: 'success', text: `${descriptor.singular} "${updated[descriptor.titleField]}" saved.` });
      }
      setEditing(null);
      list.reload();
    } catch (e) {
      const fields = e.fieldErrors;
      if (fields) {
        for (const [name, message] of Object.entries(fields)) {
          setError(name, { type: 'server', message });
        }
      }
      setFormError(e.message);
      focusFirstError(form, Object.keys(fields ?? {}));
    }
  }

  async function toggleStatus(row) {
    const next = row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setBusy(true);
    try {
      await api.setStatus(row[descriptor.idField], next);
      setBanner({
        kind: 'success',
        text: `${row[descriptor.titleField]} is now ${next === 'ACTIVE' ? 'active' : 'inactive'}.`,
      });
      list.reload();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await api.remove(deleting[descriptor.idField]);
      setBanner({ kind: 'success', text: `${deleting[descriptor.titleField]} deleted.` });
      setDeleting(null);
      list.reload();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  function renderField(f) {
    const error = formState.errors[f.name]?.message;
    const common = { id: f.name, error: formState.errors[f.name], ...register(f.name) };

    let control;
    switch (f.type) {
      case 'textarea':
        control = <TextArea rows={2} {...common} />;
        break;
      case 'master':
        control = <MasterSelect listCode={f.listCode} currentValue={watch(f.name)} {...common} />;
        break;
      case 'record':
        control = (
          <RecordSelect
            options={recordOptions[f.resource] ?? []}
            loading={!recordOptions[f.resource]}
            getValue={(o) => o.id}
            getLabel={(o) => `${o.buyerName}${o.buyerCode ? ` (${o.buyerCode})` : ''}`}
            placeholder="Select buyer..."
            {...common}
          />
        );
        break;
      case 'status':
        control = <EnumSelect options={STATUS_OPTIONS} includeBlank={false} {...common} />;
        break;
      case 'select':
        control = <EnumSelect options={f.options} includeBlank={f.includeBlank ?? false} {...common} />;
        break;
      case 'number':
        control = <TextInput type="number" step={f.step ?? 'any'} min={f.min} {...common} />;
        break;
      case 'email':
        control = <TextInput type="email" autoComplete="off" {...common} />;
        break;
      default:
        control = <TextInput type="text" autoComplete="off" {...common} />;
    }

    return (
      <Field
        key={f.name}
        label={f.label}
        required={f.required}
        error={error}
        hint={f.hint}
        htmlFor={f.name}
        className={f.span === 2 ? 'span-2' : ''}
      >
        {control}
      </Field>
    );
  }

  const activeFilters = (descriptor.filters ?? []).filter((f) => list.filters[f.name]);

  return (
    <>
      <PageHeader
        title={descriptor.title}
        actions={
          /*
           * The descriptor key IS the export and import key - `buyers`,
           * `vendors`, `employees`, `styles` - so neither button needs a prop
           * naming a permission or a route. Both hide themselves when this user
           * may not use them; see components/dataTransfer.jsx.
           */
          <>
            <ExportButton
              dataset={descriptor.key}
              params={list.query}
              rowCount={list.meta.total}
            />
            <ImportButton master={descriptor.key} onImported={list.reload} />
            {canCreate && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                New {descriptor.singular}
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
            <Field label="Search" htmlFor="search">
              <TextInput
                id="search"
                type="search"
                placeholder={descriptor.searchPlaceholder}
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          {(descriptor.filters ?? []).map((f) => (
            <Field key={f.name} label={f.label} htmlFor={`filter-${f.name}`}>
              <MasterSelect
                id={`filter-${f.name}`}
                listCode={f.listCode}
                placeholder="All"
                value={list.filters[f.name] ?? ''}
                onChange={(e) => list.setFilter(f.name, e.target.value)}
              />
            </Field>
          ))}

          <Field label="Status" htmlFor="filter-status">
            <EnumSelect
              id="filter-status"
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
                {shownColumns.map((col) =>
                  col.sortable ? (
                    <SortableTh
                      key={col.field}
                      field={col.field}
                      label={col.label}
                      sortBy={list.sortBy}
                      sortDir={list.sortDir}
                      onSort={list.toggleSort}
                      className={col.className === 'num' ? 'num' : ''}
                    />
                  ) : (
                    <th key={col.field}>{col.label}</th>
                  ),
                )}
                {(canEdit || canDelete) && <th className="actions-head">Actions</th>}
                <ColumnMenu {...cols} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={cols.colSpan + (canEdit || canDelete ? 1 : 0)} className="loading-row">
                    <Spinner label="Loading..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={cols.colSpan + (canEdit || canDelete ? 1 : 0)}>
                    <EmptyState
                      title={`No ${descriptor.title} found`}
                      message={
                        list.search || activeFilters.length
                          ? 'Try clearing the search or filters.'
                          : canCreate
                            ? `Create the first ${descriptor.singular.toLowerCase()} to get started.`
                            : undefined
                      }
                    />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((row) => (
                  <tr key={row[descriptor.idField]} className={row.status === 'INACTIVE' ? 'inactive' : ''}>
                    {shownColumns.map((col) => (
                      <td key={col.field} className={col.className ?? ''}>
                        {col.render ? col.render(row) : (row[col.field] ?? '-')}
                      </td>
                    ))}
                    {(canEdit || canDelete) && (
                      <td className="actions">
                        <RowActions
                          items={[
                            canEdit && { label: 'Edit', onClick: () => openEdit(row), disabled: busy },
                            canEdit && {
                              label: row.status === 'ACTIVE' ? 'Deactivate' : 'Activate',
                              onClick: () => toggleStatus(row),
                              disabled: busy,
                            },
                            canDelete && {
                              label: 'Delete',
                              onClick: () => setDeleting(row),
                              disabled: busy,
                              danger: true,
                            },
                          ]}
                        />
                      </td>
                    )}
                    {/* The column menu's own cell. The header carries a
                        <th> for it, so every row needs its match or the
                        table is one cell short and drifts out of line. */}
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
        <Modal
          title={
            editing === 'new'
              ? `New ${descriptor.singular}`
              : `Edit ${descriptor.singular} - ${editing[descriptor.titleField]}`
          }
          size={formWidth ?? descriptor.modalSize ?? ''}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="modal-body">
              <Alert kind="error">{formError}</Alert>

              {descriptor.sections.map((section) => (
                <div key={section.title}>
                  <div className="form-grid">
                    <div className="fieldset-title">{section.title}</div>
                    {section.fields.map(renderField)}
                  </div>
                </div>
              ))}

              {renderExtraForm?.({ form, editing, isNew: editing === 'new' })}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting}>
                {formState.isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${descriptor.singular}`}
          danger
          busy={busy}
          confirmLabel="Delete"
          message={
            <>
              <p style={{ marginTop: 0 }}>
                Delete <strong>{deleting[descriptor.titleField]}</strong>?
              </p>
              <p className="muted" style={{ marginBottom: 0 }}>
                The record is hidden rather than erased, and the delete is refused if any document
                still references it. To take it out of dropdowns without deleting, use Deactivate.
              </p>
            </>
          }
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}
