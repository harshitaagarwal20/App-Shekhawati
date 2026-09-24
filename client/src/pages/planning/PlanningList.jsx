/**
 * Planning list. Sheets: "Planning_" / "Planning"
 * (Role Acess - Planning Dept (Operator/GM)).
 *
 * Columns follow the workbook - Plan No, Department, Order, Style, Container,
 * Order Qty - with two the sheet cannot show: the planned total the server
 * derives from the allotment lines, and how that total sits against the
 * quantity the order actually permits.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { useOptionalColumns } from '../../hooks/useOptionalColumns.js';
import { orders as ordersApi, plannings as planningsApi } from '../../services/erp.js';
import {
  ColumnMenu,
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
  StatusBadge,
  TextInput,
} from '../../components/ui.jsx';
import PlanningForm from './PlanningForm.jsx';
import { STATE_BADGE, STATE_LABEL, fmtDate, fmtEnum, fmtQty } from './planningShared.jsx';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const DEPARTMENT_OPTIONS = [
  { value: 'CUTTING', label: 'Cutting' },
  { value: 'STITCHING', label: 'Stitching' },
  { value: 'IRON', label: 'Iron' },
  { value: 'SHIPPING', label: 'Shipping' },
  /**
   * C14 - a packing PLAN. This system records no packing work and has no table
   * that could; the department names who owns the plan, not who does the job.
   */
  { value: 'PACKING', label: 'Packing' },
];

const STATE_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Awaiting decision' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/**
 * What this register can show, and what it shows unasked.
 *
 * A plan is found by its number, its department, and the order and style it
 * covers. The quantities - ordered, planned, permitted - and the line count
 * are what you read INSIDE a plan; a plan over its permitted quantity already
 * says so on its own screen, and the Approval badge is one click away for
 * whoever is chasing sign-off.
 */
const COLUMNS = [
  { key: 'planNo', label: 'Plan No' },
  { key: 'date', label: 'Date' },
  { key: 'department', label: 'Department' },
  { key: 'orderNo', label: 'Order No' },
  { key: 'styleNo', label: 'Style No' },
  { key: 'container', label: 'Container', optional: true },
  { key: 'orderQty', label: 'Order Qty' },
  { key: 'planned', label: 'Planned' },
  { key: 'permitted', label: 'Permitted', optional: true },
  { key: 'lines', label: 'Lines', optional: true },
  { key: 'approval', label: 'Approval', optional: true },
  { key: 'status', label: 'Status' },
];

/**
 * `title` is supplied by PlanningHub, which owns the choice between production
 * and procurement planning. It defaults to what this screen said on its own,
 * so the component still stands up unwrapped.
 */
export default function PlanningList({ title = 'Planning' }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const cols = useOptionalColumns('planning', COLUMNS);

  const list = useResourceList((params) => planningsApi.list(params), {
    defaultSort: 'planDate',
    defaultDir: 'desc',
    initialFilters: {
      state: '',
      status: '',
      planDepartment: '',
      orderId: '',
    },
  });

  const [orderOptions, setOrderOptions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState(null);

  const canCreate = can('PLANNING.CREATE');

  useEffect(() => {
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <>
            <ExportButton
              dataset="plannings"
              params={list.query}
              rowCount={list.meta.total}
            />
            {canCreate && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                New plan
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

      {/* The "N documents on this page are awaiting a decision" banner that
          used to sit here has gone. It counted the rows of the CURRENT page
          and then told the reader to look at the rows of the current page -
          where every one of them already carries its own status badge, and
          where the Approvals queue lists the same documents across every
          module without the paging caveat. */}

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor="p-search">
              <TextInput
                id="p-search"
                type="search"
                placeholder="Search plan no, style, container, remarks..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Order" htmlFor="p-order">
            <RecordSelect
              id="p-order"
              options={orderOptions}
              getValue={(o) => o.id}
              getLabel={(o) => o.orderNo}
              placeholder="All orders"
              value={list.filters.orderId ?? ''}
              onChange={(e) => list.setFilter('orderId', e.target.value)}
            />
          </Field>

          <Field label="Department" htmlFor="p-dept">
            <EnumSelect
              id="p-dept"
              options={DEPARTMENT_OPTIONS}
              placeholder="All"
              value={list.filters.planDepartment ?? ''}
              onChange={(e) => list.setFilter('planDepartment', e.target.value)}
            />
          </Field>

          <Field label="Approval" htmlFor="p-state">
            <EnumSelect
              id="p-state"
              options={STATE_OPTIONS}
              placeholder="All"
              value={list.filters.state ?? ''}
              onChange={(e) => list.setFilter('state', e.target.value)}
            />
          </Field>

          <Field label="Status" htmlFor="p-status">
            <EnumSelect
              id="p-status"
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
                <SortableTh field="planNo" label="Plan No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="planDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="planDepartment" label="Department" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Order No</th>
                <th>Style No</th>
                {cols.show('container') && <SortableTh field="containerNo" label="Container" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />}
                <SortableTh field="orderQty" label="Order Qty" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <SortableTh field="plannedQty" label="Planned" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                {cols.show('permitted') && <th className="num">Permitted</th>}
                {cols.show('lines') && <th className="num">Lines</th>}
                {cols.show('approval') && <th>Approval</th>}
                <SortableTh field="status" label="Status" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <ColumnMenu {...cols} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={cols.colSpan} className="loading-row">
                    <Spinner label="Loading plans..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={cols.colSpan}>
                    <EmptyState
                      title="No plans found"
                      message={
                        list.search
                          ? 'Try clearing the search or filters.'
                          : canCreate
                            ? 'Create the first plan against an order to get started.'
                            : undefined
                      }
                    />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/planning/${p.id}`)}
                    className={`clickable ${p.status === 'CANCELLED' ? 'inactive' : ''}`}
                  >
                    <td className="code">
                      {p.planNo}
                      {p.version > 1 && <span className="faint"> v{p.version}</span>}
                    </td>
                    <td className="nowrap">{fmtDate(p.planDate)}</td>
                    <td>{fmtEnum(p.planDepartment)}</td>
                    <td className="code">{p.order?.orderNo ?? '-'}</td>
                    <td className="code">{p.styleNo}</td>
                    {cols.show('container') && <td>{p.containerNo ?? '-'}</td>}
                    <td className="num">{fmtQty(p.orderQty)}</td>
                    <td className="num">
                      <strong>{fmtQty(p.plannedQty)}</strong>
                      {p.allocation?.usesExcess && (
                        <div className="faint">+{fmtQty(p.allocation.excessUsedQty)} excess</div>
                      )}
                    </td>
                    {cols.show('permitted') && (
                      <td className="num">
                        {fmtQty(p.allocation?.permittedQty)}
                        {p.allocation && !p.allocation.withinPermitted && (
                          <div className="err">over by {fmtQty(p.allocation.overBy)}</div>
                        )}
                      </td>
                    )}
                    {cols.show('lines') && <td className="num">{p.lineCount ?? '-'}</td>}
                    {cols.show('approval') && (
                      <td>
                        <span className={`badge ${STATE_BADGE[p.state]}`}>{STATE_LABEL[p.state]}</span>
                      </td>
                    )}
                    <td>
                      <StatusBadge status={p.status} />
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

      {creating && (
        <Modal title="New plan" size="wide" onClose={() => setCreating(false)}>
          <PlanningForm
            onCancel={() => setCreating(false)}
            onSaved={(saved) => {
              setCreating(false);
              setBanner({
                kind: 'success',
                text: `Plan ${saved.planNo} created as a draft. Submit it when the grid is complete.`,
              });
              navigate(`/planning/${saved.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}
