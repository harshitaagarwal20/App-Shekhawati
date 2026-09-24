/**
 * Role management: create, edit, and decide what each role may do.
 *
 * ===========================================================================
 *  THE PERMISSION GRID IS THE POINT OF THIS SCREEN
 * ===========================================================================
 *
 *  A role is only its permission set. Everything else on it - the code, the
 *  name, the description - is labelling. So the editor shows the whole
 *  catalogue grouped by module, with the ones this role holds ticked, rather
 *  than a list of codes to type: an administrator deciding whether Procurement
 *  should be able to approve a purchase order needs to see PURCHASE_ORDER's
 *  five actions together, not hunt for `PURCHASE_ORDER.APPROVE` in a
 *  hundred-and-forty-item flat list.
 *
 *  WHY THE MODULE ROW HAS ITS OWN TICKBOX
 *
 *  Permissions are granted in module-shaped groups far more often than one at
 *  a time - "the store manager can do GRNs" means all five GRN actions. The
 *  header tick sets or clears the module in one go and shows an indeterminate
 *  state when only some of it is held, so a partly-granted module is visible
 *  at a glance instead of needing five rows to be read.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THIS SCREEN REFUSES TO DO
 *
 *  System roles keep their code and cannot be deleted. That is enforced on the
 *  server - role.service.js refuses both - and mirrored here so the buttons are
 *  not offered in the first place. The server is the boundary; this is manners.
 *
 *  A role still held by somebody cannot be deleted either. The server says so
 *  with the count, and the count is on the row, so the answer is visible before
 *  the button is pressed.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { roles as rolesApi } from '../../services/erp.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import { focusFirstError } from '../../components/form.jsx';
import {
  Alert,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  RowActions,
  PageHeader,
  Pagination,
  SortableTh,
  Spinner,
  TextInput,
} from '../../components/ui.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Role code must be at least 2 characters')
    .max(60)
    .regex(/^[A-Z0-9_]+$/, 'Only capital letters, numbers and underscore'),
  name: z.string().trim().min(1, 'Role name is required').max(120),
  // 255, because that is the column - `Role.description` is VarChar(255) and
  // the server schema says 255 too. A looser rule here only buys a round trip
  // and a server error on a field the form had just accepted.
  description: z
    .string()
    .trim()
    .max(255, 'Description is too long')
    .optional()
    .transform((v) => (v ? v : null)),
});

/** A system role's code is fixed, so the edit form does not offer it. */
const editSchema = createSchema.omit({ code: true });

export default function Roles() {
  const { can } = useAuth();
  const list = useResourceList((params) => rolesApi.list(params), { defaultSort: 'code' });

  const [catalogue, setCatalogue] = useState([]);
  const [catalogueError, setCatalogueError] = useState('');
  const [editing, setEditing] = useState(null);
  const [managing, setManaging] = useState(null);
  const [selected, setSelected] = useState([]);
  const [deleting, setDeleting] = useState(null);
  const [banner, setBanner] = useState(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const isNew = editing === 'new';
  const form = useForm({ resolver: zodResolver(isNew ? createSchema : editSchema) });
  const { register, handleSubmit, reset, setError, formState } = form;

  const canCreate = can('ROLE.CREATE');
  const canEdit = can('ROLE.EDIT');
  const canDelete = can('ROLE.DELETE');

  useEffect(() => {
    rolesApi
      .permissionCatalogue()
      .then(setCatalogue)
      .catch((e) => setCatalogueError(e.message));
  }, []);

  const totalPermissions = useMemo(
    () => catalogue.reduce((n, m) => n + m.actions.length, 0),
    [catalogue],
  );

  function openCreate() {
    setFormError('');
    reset({ code: '', name: '', description: '' });
    setEditing('new');
  }

  function openEdit(row) {
    setFormError('');
    reset({ name: row.name, description: row.description ?? '' });
    setEditing(row);
  }

  function openPermissions(row) {
    setSelected(row.permissions ?? []);
    setManaging(row);
  }

  async function onSubmit(values) {
    setFormError('');
    try {
      if (isNew) {
        await rolesApi.create(values);
        setBanner({
          kind: 'success',
          text: `Role "${values.code}" created. It grants nothing until you give it permissions.`,
        });
      } else {
        await rolesApi.update(editing.id, values);
        setBanner({ kind: 'success', text: `Role "${editing.code}" saved.` });
      }
      setEditing(null);
      list.reload();
    } catch (e) {
      const fields = e.fieldErrors;
      if (fields) for (const [k, m] of Object.entries(fields)) setError(k, { type: 'server', message: m });
      setFormError(e.message);
      focusFirstError(form, Object.keys(fields ?? {}));
    }
  }

  async function savePermissions() {
    setBusy(true);
    try {
      await rolesApi.setPermissions(managing.id, selected);
      setBanner({
        kind: 'success',
        text:
          `Permissions saved for "${managing.code}". They are re-read on every request, so the `
          + `${managing.userCount} user(s) holding this role see the change on their next action.`,
      });
      setManaging(null);
      list.reload();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    try {
      await rolesApi.remove(deleting.id);
      setBanner({ kind: 'success', text: `Role "${deleting.code}" deleted.` });
      setDeleting(null);
      list.reload();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  // --- the permission grid -------------------------------------------------

  function toggleOne(code) {
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  function toggleModule(actions, allHeld) {
    const codes = actions.map((a) => a.code);
    setSelected((prev) =>
      allHeld ? prev.filter((c) => !codes.includes(c)) : [...new Set([...prev, ...codes])],
    );
  }

  function PermissionGrid() {
    if (catalogueError) return <Alert kind="error">{catalogueError}</Alert>;
    if (catalogue.length === 0) return <Spinner label="Loading permissions..." />;

    return (
      <div className="perm-grid">
        {catalogue.map(({ module, actions }) => {
          const held = actions.filter((a) => selected.includes(a.code)).length;
          const allHeld = held === actions.length;
          const someHeld = held > 0 && !allHeld;
          return (
            <div key={module} className="perm-module">
              <h4>
                <label className="perm-check">
                  <input
                    type="checkbox"
                    checked={allHeld}
                    /* Partly-granted modules read as indeterminate, which is a
                       DOM property and cannot be set from JSX attributes. */
                    ref={(el) => { if (el) el.indeterminate = someHeld; }}
                    onChange={() => toggleModule(actions, allHeld)}
                    aria-label={`All ${module.replace(/_/g, ' ').toLowerCase()} permissions`}
                  />
                  <span>{module.replace(/_/g, ' ')}</span>
                  <span className="faint">{held}/{actions.length}</span>
                </label>
              </h4>
              {actions.map((a) => (
                <label className="perm-check" key={a.code} title={a.description ?? a.code}>
                  <input
                    type="checkbox"
                    checked={selected.includes(a.code)}
                    onChange={() => toggleOne(a.code)}
                  />
                  <span>{a.action}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Roles"
        actions={
          <>
            <ExportButton
              dataset="roles"
              params={list.query}
              rowCount={list.meta.total}
            />
            {canCreate && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                New role
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
            <Field label="Search" htmlFor="r-search">
              <TextInput
                id="r-search"
                type="search"
                placeholder="Search code, name or description..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="code" label="Code" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="name" label="Name" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Permissions</th>
                <th style={{ textAlign: 'right' }}>Users</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={6} className="loading-row">
                    <Spinner label="Loading roles..." />
                  </td>
                </tr>
              )}
              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState title="No roles found" />
                  </td>
                </tr>
              )}
              {!list.loading
                && list.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="code">
                      {r.code}
                      {r.isSystem && <span className="badge badge-info" style={{ marginLeft: 6 }}>system</span>}
                    </td>
                    <td>{r.name}</td>
                    <td className="muted">{r.description || '-'}</td>
                    <td style={{ textAlign: 'right' }} className="nowrap">
                      {r.permissions.length}
                      {totalPermissions > 0 && <span className="faint"> / {totalPermissions}</span>}
                    </td>
                    <td style={{ textAlign: 'right' }} className="muted">{r.userCount}</td>
                    <td className="actions">
                      <RowActions
                        items={[
                          canEdit && { label: 'Edit', onClick: () => openEdit(r), disabled: busy },
                          canEdit && { label: 'Permissions', onClick: () => openPermissions(r), disabled: busy },
                          canDelete && !r.isSystem && {
                            label: 'Delete',
                            onClick: () => setDeleting(r),
                            disabled: busy || r.userCount > 0,
                            title: r.userCount > 0 ? `${r.userCount} user(s) still hold this role` : undefined,
                            danger: true,
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableWrap>

        <Pagination meta={list.meta} page={list.page} pageSize={list.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />
      </div>

      {editing && (
        <Modal title={isNew ? 'New role' : `Edit role - ${editing.code}`} size="narrow" onClose={() => setEditing(null)}>
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="modal-body">
              {formError && <Alert kind="error">{formError}</Alert>}
              {isNew && (
                <Field
                  label="Code"
                  required
                  hint="Capital letters, numbers and underscore. This is what the server checks against and it cannot be changed later."
                  error={formState.errors.code?.message}
                >
                  <TextInput {...register('code')} autoComplete="off" placeholder="STORE_MANAGER" />
                </Field>
              )}
              {!isNew && editing.isSystem && (
                <p className="muted" style={{ marginTop: 0 }}>
                  <strong>{editing.code}</strong> is a system role. Its code is fixed and it cannot
                  be deleted, but its name, description and permissions are yours to set.
                </p>
              )}
              <Field label="Name" required error={formState.errors.name?.message}>
                <TextInput {...register('name')} placeholder="Store &amp; Cutting Manager" />
              </Field>
              <Field
                label="Description"
                hint="What this role is for, in the language of the office."
                error={formState.errors.description?.message}
              >
                <TextInput {...register('description')} />
              </Field>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting}>
                {formState.isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {managing && (
        <Modal title={`Permissions - ${managing.code}`} onClose={() => setManaging(null)}>
          <div className="modal-body">
            <p className="muted" style={{ marginTop: 0 }}>
              {managing.userCount === 0
                ? 'Nobody holds this role yet.'
                : `${managing.userCount} user(s) hold this role. Permissions are re-read on every `
                  + 'request, so this takes effect on their next action - they do not need to sign in again.'}
            </p>
            <PermissionGrid />
          </div>
          <div className="modal-footer">
            <span className="faint grow">{selected.length} of {totalPermissions} selected</span>
            <button type="button" className="btn" onClick={() => setManaging(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={savePermissions} disabled={busy}>
              {busy ? 'Saving...' : 'Save permissions'}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete role"
          danger
          busy={busy}
          confirmLabel="Delete"
          message={`Delete "${deleting.code}"? Nobody holds it, so nothing loses access. The role is hidden rather than erased.`}
          onConfirm={doDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}
