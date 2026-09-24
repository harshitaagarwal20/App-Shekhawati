/**
 * Audit — who changed what, and when.
 *
 * ===========================================================================
 *  READ-ONLY, AND VISIBLY SO
 * ===========================================================================
 *
 * There is no edit button on this screen and no delete, because there is no
 * endpoint behind either. A trail that the application can rewrite is not
 * evidence of anything.
 *
 * Two questions get asked of an audit trail, and the screen answers them in
 * the order people ask them:
 *
 *   "who touched X?"                      the filtered list
 *   "how did this document get here?"     the merged trail for one record
 *
 * The last of those is the one that matters. It pulls together the row-level
 * edits, the workflow decisions and the amendments — three tables that record
 * three different kinds of event — so that reconstructing what happened to a
 * purchase order does not mean opening three screens and comparing timestamps.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useResourceList } from '../../hooks/useResourceList.js';
import { audit as auditApi } from '../../services/erp.js';
import {
  Alert,
  EmptyState,
  EnumSelect,
  Field,
  Modal,
  PageHeader,
  Pagination,
  SortableTh,
  Spinner,
  TextInput,
} from '../../components/ui.jsx';
import { fmtDateTime } from '../../utils/format.js';
import EntryDetail from './audit/EntryDetail.jsx';
import RecordTrail from './audit/RecordTrail.jsx';
import { humanField } from './audit/ChangeTable.jsx';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const ACTIONS = [
  { value: 'CREATE', label: 'Created' },
  { value: 'UPDATE', label: 'Edited' },
  { value: 'DELETE', label: 'Deleted' },
];

/** How each action reads in the list and the trail. */
const ACTION_LABEL = Object.fromEntries(ACTIONS.map((a) => [a.value, a.label]));

/** Master data tables (configuration, setup, reference data) */
const MASTER_TABLES = new Set([
  'buyers',
  'vendors',
  'employees',
  'styles',
  'excess_rules',
  'excess_approvals',
  'master_lists',
  'master_list_values',
  'users',
  'roles',
  'user_roles',
  'role_permissions',
]);

export default function Audit() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mastersOnly, setMastersOnly] = useState(false);

  const list = useResourceList((params) => auditApi.list(params), {
    defaultSort: 'createdAt',
    defaultDir: 'desc',
    initialFilters: {
      tableName: searchParams.get('tableName') ?? '',
      recordId: searchParams.get('recordId') ?? '',
      userId: '',
      action: '',
    },
  });

  const [tables, setTables] = useState([]);
  const [actors, setActors] = useState([]);
  const [openEntry, setOpenEntry] = useState(null);
  const [trailFor, setTrailFor] = useState(() => {
    const tableName = searchParams.get('tableName');
    const recordId = searchParams.get('recordId');
    return tableName && recordId ? { tableName, recordId } : null;
  });

  useEffect(() => {
    // Both are independent; a failure in one must not blank the screen, so
    // they are settled separately rather than with Promise.all.
    auditApi.tables().then(setTables).catch(loadFailed(setTables, 'tables'));
    auditApi.actors().then(setActors).catch(loadFailed(setActors, 'actors'));
  }, []);

  const showTrail = (tableName, recordId) => {
    setOpenEntry(null);
    setTrailFor({ tableName, recordId });
    setSearchParams({ tableName, recordId }, { replace: true });
  };

  const closeTrail = () => {
    setTrailFor(null);
    setSearchParams({}, { replace: true });
  };

  // Filter tables to show only masters when mastersOnly is enabled
  const visibleTables = mastersOnly ? tables.filter((t) => MASTER_TABLES.has(t.tableName)) : tables;

  // When toggling masters-only, clear the tableName filter if a non-master is selected
  const handleMastersToggle = (enabled) => {
    setMastersOnly(enabled);
    if (enabled && list.filters.tableName && !MASTER_TABLES.has(list.filters.tableName)) {
      list.setFilter('tableName', '');
    }
  };

  // Filter rows to show only masters when mastersOnly is enabled
  const filteredRows = mastersOnly 
    ? list.rows.filter((row) => MASTER_TABLES.has(row.tableName))
    : list.rows;

  return (
    <>
      <PageHeader
        title="Audit"
        actions={
          <ExportButton dataset="audit" params={list.query} rowCount={list.meta.total} />
        }
      />

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <TextInput
              type="search"
              placeholder="Search by person, table or action"
              value={list.search}
              onChange={(e) => list.setSearch(e.target.value)}
            />
          </div>

          <button
            type="button"
            className={`btn ${mastersOnly ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => handleMastersToggle(!mastersOnly)}
            title="Filter to show only master data changes"
          >
            {mastersOnly ? '✓ Masters Only' : 'All Records'}
          </button>

          <Field label="Record type" htmlFor="audit-table">
            <EnumSelect
              id="audit-table"
              value={list.filters.tableName}
              onChange={(e) => list.setFilter('tableName', e.target.value)}
              options={visibleTables.map((t) => ({ value: t.tableName, label: t.label }))}
              placeholder={mastersOnly ? 'All masters' : 'Everything'}
            />
          </Field>

          <Field label="Person" htmlFor="audit-user">
            <EnumSelect
              id="audit-user"
              value={list.filters.userId}
              onChange={(e) => list.setFilter('userId', e.target.value)}
              options={actors.map((a) => ({
                value: a.userId,
                label: `${a.userName ?? 'Unnamed'} (${a.writes})`,
              }))}
              placeholder="Anyone"
            />
          </Field>

          <Field label="Action" htmlFor="audit-action">
            <EnumSelect
              id="audit-action"
              value={list.filters.action}
              onChange={(e) => list.setFilter('action', e.target.value)}
              options={ACTIONS}
              placeholder="Any"
            />
          </Field>
        </div>

        {list.error && <Alert kind="error">{list.error.message}</Alert>}

        {list.loading ? (
          <Spinner label="Loading the trail" />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            title="Nothing recorded"
            message="Records loaded by the seeder carry no entry, because nobody made them."
          />
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <SortableTh field="createdAt" label="When" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                  <SortableTh field="userName" label="Who" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                  <SortableTh field="action" label="Did" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                  <SortableTh field="tableName" label="To" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                  <th>Fields changed</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td>{fmtDateTime(row.createdAt)}</td>
                    <td>{row.userName ?? <span className="muted">the system</span>}</td>
                    <td>{ACTION_LABEL[row.action] ?? row.action}</td>
                    <td>{row.label}</td>
                    <td>
                      {row.changeCount === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <span title={row.changedFields.map(humanField).join(', ')}>
                          {row.changedFields.slice(0, 3).map(humanField).join(', ')}
                          {row.changeCount > 3 ? ` +${row.changeCount - 3} more` : ''}
                        </span>
                      )}
                    </td>
                    <td className="actions">
                      <button type="button" className="btn btn-sm" onClick={() => setOpenEntry(row.id)}>
                        View
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => showTrail(row.tableName, row.recordId)}
                      >
                        Trail
                      </button>
                    </td>
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
      </div>

      {openEntry && (
        <EntryDetail id={openEntry} onClose={() => setOpenEntry(null)} onShowTrail={showTrail} />
      )}

      {trailFor && (
        <Modal
          title="Record trail"
          size="lg"
          onClose={closeTrail}
          footer={<button type="button" className="btn" onClick={closeTrail}>Close</button>}
        >
          <RecordTrail tableName={trailFor.tableName} recordId={trailFor.recordId} />
        </Modal>
      )}
    </>
  );
}
