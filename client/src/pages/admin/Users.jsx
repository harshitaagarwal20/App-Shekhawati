/**
 * User management: create, edit, assign roles, activate/deactivate, reset
 * password, delete. Every action here is authorised again on the server.
 */

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { employees as employeesApi, roles as rolesApi, users as usersApi } from '../../services/erp.js';
import { fmtDateTime } from '../../utils/format.js';
import {
  Alert,
  ConfirmDialog,
  EmptyState,
  EnumSelect,
  Field,
  Modal,
  MultiSelect,
  RowActions,
  PageHeader,
  Pagination,
  RecordSelect,
  SortableTh,
  Spinner,
  StatusBadge,
  TextInput,
} from '../../components/ui.jsx';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import { focusFirstError } from '../../components/form.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((v) => /[0-9]/.test(v), 'Password must contain a number');

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Username must be at least 3 characters')
    .regex(/^[a-z0-9._-]+$/, 'Only letters, numbers, dot, underscore and hyphen'),
  fullName: z.string().trim().min(1, 'Full name is required'),
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Must be a valid email address'),
  password: passwordRule,
  employeeId: z.string().optional().transform((v) => (v ? v : null)),
  // Roles are picked outside the form (selectedRoles) and checked there.
});

const editSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required'),
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Must be a valid email address'),
  employeeId: z.string().optional().transform((v) => (v ? v : null)),
});

export default function Users() {
  const { can, user: currentUser } = useAuth();
  const list = useResourceList((params) => usersApi.list(params), { defaultSort: 'username' });

  const [allRoles, setAllRoles] = useState([]);
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [editing, setEditing] = useState(null); // 'new' | record
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [managingRoles, setManagingRoles] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [resetValue, setResetValue] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [banner, setBanner] = useState(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const canCreate = can('USER.CREATE');
  const canEdit = can('USER.EDIT');
  const canDelete = can('USER.DELETE');

  const isNew = editing === 'new';
  const form = useForm({ resolver: zodResolver(isNew ? createSchema : editSchema) });
  const { register, handleSubmit, reset, setError, watch, formState } = form;

  useEffect(() => {
    rolesApi.list({ pageSize: 100 }).then((r) => setAllRoles(r.rows)).catch(loadFailed(setAllRoles, 'all roles'));
    employeesApi.options().then(setEmployeeOptions).catch(loadFailed(setEmployeeOptions, 'employees'));
  }, []);

  function openCreate() {
    setFormError('');
    setSelectedRoles([]);
    reset({ username: '', fullName: '', email: '', password: '', employeeId: '' });
    setEditing('new');
  }

  function openEdit(row) {
    setFormError('');
    reset({ fullName: row.fullName, email: row.email ?? '', employeeId: row.employee?.id ?? '' });
    setEditing(row);
  }

  async function onSubmit(values) {
    setFormError('');
    try {
      if (isNew) {
        await usersApi.create({ ...values, roleCodes: selectedRoles });
        setBanner({
          kind: 'success',
          text: `User "${values.username}" created. They must change this password at first sign-in.`,
        });
      } else {
        await usersApi.update(editing.id, values);
        setBanner({ kind: 'success', text: `User "${editing.username}" saved.` });
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

  async function saveRoles() {
    setBusy(true);
    try {
      await usersApi.setRoles(managingRoles.id, selectedRoles);
      setBanner({
        kind: 'success',
        text: `Roles updated for "${managingRoles.username}". Their sessions were ended so the change takes effect immediately.`,
      });
      setManagingRoles(null);
      list.reload();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(row) {
    setBusy(true);
    try {
      await usersApi.setActive(row.id, !row.isActive);
      setBanner({ kind: 'success', text: `"${row.username}" is now ${row.isActive ? 'disabled' : 'active'}.` });
      list.reload();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function doReset() {
    setBusy(true);
    try {
      await usersApi.resetPassword(resetting.id, resetValue);
      setBanner({
        kind: 'success',
        text: `Password reset for "${resetting.username}". They must change it at next sign-in, and all their sessions were ended.`,
      });
      setResetting(null);
      setResetValue('');
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    try {
      await usersApi.remove(deleting.id);
      setBanner({ kind: 'success', text: `"${deleting.username}" deleted.` });
      setDeleting(null);
      list.reload();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  /*
   * One control instead of nine rows. A user's roles are a set, so the menu
   * keeps its checkboxes - see MultiSelect - and the trigger reads back what
   * is held. The code (ADMIN, CUTTING_SUPERVISOR) stays beside each name: it
   * is what the permission tables and the audit trail actually say, and the
   * office reads it there.
   *
   * An element, NOT a component declared in here. `function RoleCheckboxes()`
   * rendered as <RoleCheckboxes /> was a new component type on every render,
   * so each tick remounted the MultiSelect and shut its menu - picking three
   * roles meant opening it three times.
   */
  const roleCheckboxes = (
    <MultiSelect
      id="user-roles"
      options={allRoles.map((r) => ({ value: r.code, label: r.name, hint: r.code }))}
      selected={selectedRoles}
      onChange={setSelectedRoles}
      placeholder="Select roles..."
      emptyLabel="No roles available."
    />
  );

  return (
    <>
      <PageHeader
        title="Users"
        actions={
          <>
            <ExportButton
              dataset="users"
              params={list.query}
              rowCount={list.meta.total}
            />
            {canCreate && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                New user
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
            <Field label="Search" htmlFor="u-search">
              <TextInput
                id="u-search"
                type="search"
                placeholder="Search username, name or email..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Role" htmlFor="u-role">
            <EnumSelect
              id="u-role"
              placeholder="All roles"
              options={allRoles.map((r) => ({ value: r.code, label: r.name }))}
              value={list.filters.roleCode ?? ''}
              onChange={(e) => list.setFilter('roleCode', e.target.value)}
            />
          </Field>
          <Field label="Status" htmlFor="u-status">
            <EnumSelect
              id="u-status"
              placeholder="All"
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Disabled' },
              ]}
              value={list.filters.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
            />
          </Field>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="username" label="Username" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="fullName" label="Full Name" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Roles</th>
                <th>Employee</th>
                <SortableTh field="lastLoginAt" label="Last Sign-in" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={7} className="loading-row">
                    <Spinner label="Loading users..." />
                  </td>
                </tr>
              )}
              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState title="No users found" />
                  </td>
                </tr>
              )}
              {!list.loading &&
                list.rows.map((u) => (
                  <tr key={u.id} className={u.isActive ? '' : 'inactive'}>
                    <td className="code">{u.username}</td>
                    <td>
                      {u.fullName}
                      {u.id === currentUser?.id && <span className="badge badge-info" style={{ marginLeft: 6 }}>you</span>}
                      {u.mustChangePassword && (
                        <span className="badge badge-pending" style={{ marginLeft: 6 }}>must reset</span>
                      )}
                    </td>
                    <td>
                      <div className="chip-list">
                        {u.roles.map((r) => (
                          <span className="chip" key={r.code}>{r.name}</span>
                        ))}
                        {u.roles.length === 0 && <span className="faint">none</span>}
                      </div>
                    </td>
                    <td className="muted">{u.employee ? `${u.employee.empId} · ${u.employee.empName}` : '-'}</td>
                    <td className="muted nowrap">
                      {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'never'}
                    </td>
                    <td>
                      <StatusBadge status={u.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    </td>
                    <td className="actions">
                      <RowActions
                        items={[
                          canEdit && { label: 'Edit', onClick: () => openEdit(u), disabled: busy },
                          canEdit && {
                            label: 'Roles',
                            onClick: () => {
                              setSelectedRoles(u.roleCodes ?? []);
                              setManagingRoles(u);
                            },
                            disabled: busy,
                          },
                          canEdit && {
                            label: 'Reset password',
                            onClick: () => { setResetting(u); setResetValue(''); },
                            disabled: busy,
                          },
                          canEdit && {
                            label: u.isActive ? 'Disable' : 'Enable',
                            onClick: () => toggleActive(u),
                            disabled: busy,
                          },
                          canDelete && {
                            label: 'Delete',
                            onClick: () => setDeleting(u),
                            disabled: busy,
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
        <Modal title={isNew ? 'New user' : `Edit user - ${editing.username}`} onClose={() => setEditing(null)}>
          <form onSubmit={handleSubmit(onSubmit, (errs) => focusFirstError(form, Object.keys(errs)))} noValidate>
            <div className="modal-body">
              <Alert kind="error">{formError}</Alert>

              <div className="form-grid">
                {isNew && (
                  <Field label="Username" required error={formState.errors.username?.message}>
                    <TextInput autoComplete="off" error={formState.errors.username} {...register('username')} />
                  </Field>
                )}
                <Field label="Full Name" required error={formState.errors.fullName?.message}>
                  <TextInput error={formState.errors.fullName} {...register('fullName')} />
                </Field>
                <Field label="Email" error={formState.errors.email?.message}>
                  <TextInput type="email" autoComplete="off" error={formState.errors.email} {...register('email')} />
                </Field>
                <Field
                  label="Linked employee"
                  hint="Links the account to an Employee Master record for checker and issuer columns."
                  error={formState.errors.employeeId?.message}
                >
                  <RecordSelect
                    options={employeeOptions}
                    getValue={(o) => o.id}
                    getLabel={(o) => `${o.empId} · ${o.empName} (${o.department})`}
                    placeholder="Not linked"
                    value={watch('employeeId') ?? ''}
                    {...register('employeeId')}
                  />
                </Field>
                {isNew && (
                  <Field
                    label="Initial password"
                    required
                    hint="At least 8 characters, including a number. The user must change it at first sign-in."
                    error={formState.errors.password?.message}
                    className="span-2"
                  >
                    <TextInput type="text" autoComplete="off" error={formState.errors.password} {...register('password')} />
                  </Field>
                )}
              </div>

              {isNew && (
                <>
                  <div className="fieldset-title">Roles</div>
                  {roleCheckboxes}
                  {selectedRoles.length === 0 && <span className="err">Assign at least one role</span>}
                </>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={formState.isSubmitting || (isNew && selectedRoles.length === 0)}
              >
                {formState.isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {managingRoles && (
        <Modal title={`Roles - ${managingRoles.username}`} size="narrow" onClose={() => setManagingRoles(null)}>
          <div className="modal-body">
            <p className="muted" style={{ marginTop: 0 }}>
              Changing roles ends this user&apos;s active sessions, so the new permissions apply
              straight away.
            </p>
            {roleCheckboxes}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={() => setManagingRoles(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={saveRoles} disabled={busy || selectedRoles.length === 0}>
              {busy ? 'Saving...' : 'Save roles'}
            </button>
          </div>
        </Modal>
      )}

      {resetting && (
        <Modal title={`Reset password - ${resetting.username}`} size="narrow" onClose={() => setResetting(null)}>
          <div className="modal-body">
            <Field
              label="New password"
              required
              hint="At least 8 characters, including a number. The user must change it at next sign-in."
            >
              <TextInput type="text" value={resetValue} onChange={(e) => setResetValue(e.target.value)} autoComplete="off" />
            </Field>
            <p className="faint" style={{ fontSize: 11.5, marginBottom: 0 }}>
              Hand this to the user directly. All their current sessions will end.
            </p>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={() => setResetting(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={doReset} disabled={busy || resetValue.length < 8}>
              {busy ? 'Resetting...' : 'Reset password'}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete user"
          danger
          busy={busy}
          confirmLabel="Delete"
          message={`Delete "${deleting.username}"? The account is hidden rather than erased, and the username is never reused.`}
          onConfirm={doDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}
