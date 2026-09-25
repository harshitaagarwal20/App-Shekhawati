/**
 * List Master - the "Master Lists" sheet.
 *
 * Every business dropdown in this application reads from here. Adding a colour,
 * a GSM or a stitching unit is done on this screen and takes effect
 * immediately, exactly as adding a row to the bottom of a column did in the
 * workbook. Nothing in the React code hardcodes these values.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { masterLists } from '../../services/erp.js';
import { invalidateMasterList } from '../../hooks/useMasterList.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { ImportButton } from '../../components/dataTransfer.jsx';
import {
  Alert,
  ConfirmDialog,
  EmptyState,
  Field,
  MasterSelect,
  Modal,
  RowActions,
  PageHeader,
  Pagination,
  SortableTh,
  Spinner,
  TextInput,
} from '../../components/ui.jsx';
import TableWrap from '../../components/TableWrap.jsx';

/**
 * Lists whose values each belong to a value of ANOTHER list. The dropdown that
 * reads them shows only the values of the parent chosen beside it - picking
 * Button offers button varieties and nothing else. The parent is stored on the
 * value as `attributes.item`.
 */
const PARENT_LIST = {
  AccessoryVariety: { listCode: 'AccessoriesItem', label: 'For item' },
};

export default function ListMaster() {
  const { can } = useAuth();
  const canEdit = can('MASTER_LIST.EDIT');
  const canCreate = can('MASTER_LIST.CREATE');
  const canDelete = can('MASTER_LIST.DELETE');

  const lists = useResourceList((params) => masterLists.list(params), { defaultSort: 'code' });

  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [banner, setBanner] = useState(null);
  const [newValue, setNewValue] = useState('');
  const [newParent, setNewParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [creatingList, setCreatingList] = useState(false);
  const [newList, setNewList] = useState({ code: '', name: '', description: '' });
  const [deletingValue, setDeletingValue] = useState(null);

  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true);
    try {
      setDetail(await masterLists.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) loadDetail(selected.id);
    else setDetail(null);
  }, [selected, loadDetail]);

  /** Any change to a list must drop the cached dropdown values. */
  function afterValueChange(code) {
    invalidateMasterList(code);
    loadDetail(selected.id);
    lists.reload();
  }

  const parent = detail ? PARENT_LIST[detail.code] : null;

  async function addValue(e) {
    e.preventDefault();
    const value = newValue.trim();
    if (!value || (parent && !newParent)) return;
    setBusy(true);
    try {
      await masterLists.addValue(selected.id, {
        value,
        ...(parent ? { attributes: { item: newParent } } : {}),
      });
      setNewValue('');
      setBanner({ kind: 'success', text: `"${value}" added to ${detail.code}.` });
      afterValueChange(detail.code);
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function toggleValue(v) {
    setBusy(true);
    try {
      await masterLists.setValueActive(v.id, !v.isActive);
      afterValueChange(detail.code);
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function removeValue() {
    setBusy(true);
    try {
      await masterLists.removeValue(deletingValue.id);
      setBanner({ kind: 'success', text: `"${deletingValue.value}" removed.` });
      setDeletingValue(null);
      afterValueChange(detail.code);
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
      setDeletingValue(null);
    } finally {
      setBusy(false);
    }
  }

  async function createList(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await masterLists.create(newList);
      setBanner({ kind: 'success', text: `List ${created.code} created.` });
      setCreatingList(false);
      setNewList({ code: '', name: '', description: '' });
      lists.reload();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Dropdown Lists"
        actions={
          /*
           * IMPORT WITHOUT EXPORT, WHICH IS NOT THE PATTERN ELSEWHERE.
           *
           * Every other master pairs the two, because the round trip is how a
           * bulk correction is made: export, edit in Excel, send it back. This
           * screen does not, by request - a dropdown list is added to and
           * renamed a value at a time, on this screen, and nobody was taking
           * the file. Import stays: seeding a new list's values from a file is
           * still worth having.
           *
           * The datasets themselves are untouched in the export registry, so
           * `GET /api/exports/master-list-values` still answers and the buttons
           * come back by putting them here again.
           */
          <>
            <ImportButton master="master-list-values" label="Import values" onImported={() => lists.reload()} />
            {canCreate && (
              <button type="button" className="btn btn-primary" onClick={() => setCreatingList(true)}>
                New list
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
      {lists.error && <Alert kind="error">{lists.error.message}</Alert>}

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search lists" htmlFor="ml-search">
              <TextInput
                id="ml-search"
                type="search"
                placeholder="Search code, name, description..."
                value={lists.search}
                onChange={(e) => lists.setSearch(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="code" label="List Code" sortBy={lists.sortBy} sortDir={lists.sortDir} onSort={lists.toggleSort} />
                <SortableTh field="name" label="Name" sortBy={lists.sortBy} sortDir={lists.sortDir} onSort={lists.toggleSort} />
                <th>Description</th>
                <th className="num">Values</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lists.loading && (
                <tr>
                  <td colSpan={6} className="loading-row">
                    <Spinner label="Loading lists..." />
                  </td>
                </tr>
              )}
              {!lists.loading && lists.rows.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState title="No lists found" />
                  </td>
                </tr>
              )}
              {!lists.loading &&
                lists.rows.map((l) => (
                  <tr key={l.id}>
                    <td className="code">{l.code}</td>
                    <td>{l.name}</td>
                    <td className="muted">{l.description ?? '-'}</td>
                    <td className="num">{l.valueCount ?? '-'}</td>
                    <td>
                      {l.isSystem ? <span className="badge badge-system">System</span> : <span className="badge badge-inactive">Custom</span>}
                    </td>
                    <td className="actions">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(l)}>
                        {canEdit ? 'Manage values' : 'View values'}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableWrap>

        <Pagination
          meta={lists.meta}
          page={lists.page}
          pageSize={lists.pageSize}
          onPage={lists.setPage}
          onPageSize={lists.setPageSize}
        />
      </div>

      {selected && (
        <Modal title={`${selected.code} - ${selected.name}`} onClose={() => setSelected(null)}>
          <div className="modal-body">
            {detailLoading && <Spinner label="Loading values..." />}

            {detail && (
              <>
                {detail.description && <p className="muted" style={{ marginTop: 0 }}>{detail.description}</p>}

                {canEdit && (
                  <form className="row" onSubmit={addValue} style={{ marginBottom: 14 }}>
                    {parent && (
                      <div style={{ minWidth: 170 }}>
                        <MasterSelect
                          listCode={parent.listCode}
                          value={newParent}
                          onChange={(e) => setNewParent(e.target.value)}
                          placeholder={`${parent.label}...`}
                          aria-label={parent.label}
                          disabled={busy}
                        />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <TextInput
                        placeholder="New value, exactly as it should read in dropdowns"
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        disabled={busy}
                      />
                    </div>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={busy || !newValue.trim() || (parent && !newParent)}
                    >
                      Add
                    </button>
                  </form>
                )}

                <TableWrap>
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: 50 }}>Order</th>
                        {parent && <th>{parent.label}</th>}
                        <th>Value</th>
                        <th style={{ width: 90 }}>Status</th>
                        {canEdit && <th style={{ textAlign: 'right' }}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.values ?? []).length === 0 && (
                        <tr>
                          <td colSpan={5}>
                            <EmptyState title="This list has no values yet" />
                          </td>
                        </tr>
                      )}
                      {(detail.values ?? []).map((v) => (
                        <tr key={v.id} className={v.isActive ? '' : 'inactive'}>
                          <td className="faint">{v.sortOrder}</td>
                          {parent && <td>{v.attributes?.item ?? <span className="faint">Any</span>}</td>}
                          <td>{v.value}</td>
                          <td>
                            <span className={`badge ${v.isActive ? 'badge-active' : 'badge-inactive'}`}>
                              {v.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          {canEdit && (
                            <td className="actions">
                              <RowActions
                                items={[
                                  {
                                    label: v.isActive ? 'Deactivate' : 'Activate',
                                    onClick: () => toggleValue(v),
                                    disabled: busy,
                                  },
                                  canDelete && {
                                    label: 'Remove',
                                    onClick: () => setDeletingValue(v),
                                    disabled: busy,
                                    danger: true,
                                  },
                                ]}
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>

                <p className="faint" style={{ fontSize: 11.5, marginBottom: 0 }}>
                  Deactivating a value hides it from new documents. Documents that already carry the
                  text keep it, and show it marked <em>(inactive)</em> when reopened.
                </p>
              </>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {creatingList && (
        <Modal title="New master list" size="narrow" onClose={() => setCreatingList(false)}>
          <form onSubmit={createList}>
            <div className="modal-body">
              <Field label="List Code" required hint="Used by forms to request this list, e.g. ColorCode.">
                <TextInput
                  value={newList.code}
                  onChange={(e) => setNewList((s) => ({ ...s, code: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Name" required>
                <TextInput
                  value={newList.name}
                  onChange={(e) => setNewList((s) => ({ ...s, name: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Description">
                <TextInput
                  value={newList.description}
                  onChange={(e) => setNewList((s) => ({ ...s, description: e.target.value }))}
                />
              </Field>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setCreatingList(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Create
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deletingValue && (
        <ConfirmDialog
          title="Remove value"
          danger
          busy={busy}
          confirmLabel="Remove"
          message={`Remove "${deletingValue.value}" from ${detail?.code}? Documents that already use this text keep it.`}
          onConfirm={removeValue}
          onCancel={() => setDeletingValue(null)}
        />
      )}
    </>
  );
}
