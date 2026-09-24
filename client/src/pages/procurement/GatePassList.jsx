/**
 * Gate Pass list. Sheet: "Gate Pass (Inward / Outward)".
 *
 * Server-side paginated and filtered. The one filter worth calling out is
 * "variation only": a checker's actual daily job is the deliveries that did not
 * match, not the ones that did.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { useOptionalColumns } from '../../hooks/useOptionalColumns.js';
import { gatePasses as gpApi, vendors as vendorsApi } from '../../services/erp.js';
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
import { fmtDate, fmtEnum, fmtNum } from '../../utils/format.js';
import GatePassForm from './GatePassForm.jsx';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const TYPE_OPTIONS = [
  { value: 'INWARD', label: 'Inward' },
  { value: 'OUTWARD', label: 'Outward' },
];
const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'CLEARED', label: 'Cleared' },
];
/*
 * The seven values of the IssuePurpose enum, worded for a reader.
 *
 * EXPORTED because the pass's own screen offers the same choice when a pass is
 * allocated to a document, and it was reaching for a Master List called
 * "Purpose" that has never existed - so that dropdown came up empty on a field
 * the form marked required. Purpose is an enum in the schema, not a list
 * somebody maintains, so there is nothing to look up: these are the values,
 * and they match `gatePass.validator.js`.
 */
export const PURPOSE_OPTIONS = [
  'CUTTING', 'DYEING', 'PRINTING', 'STITCHING', 'RETURN', 'SAMPLING', 'OTHER',
].map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }));

/**
 * What this register can show, and what it shows unasked.
 *
 * Security and stores read this to answer: which pass, in or out, whose, what
 * was on it, and is it closed. The reconciliation - unit, quantity sent,
 * quantity received, the variation between them - belongs to the pass itself,
 * and a short receipt still paints its whole row whether or not the Variation
 * column is showing.
 */
const COLUMNS = [
  { key: 'gatePassNo', label: 'Gate Pass No' },
  { key: 'date', label: 'Date' },
  { key: 'type', label: 'Type' },
  { key: 'reference', label: 'Reference', optional: true },
  { key: 'item', label: 'Item' },
  { key: 'party', label: 'Party' },
  { key: 'uom', label: 'UOM', optional: true },
  { key: 'qty', label: 'Qty' },
  { key: 'received', label: 'Received', optional: true },
  { key: 'variation', label: 'Variation', optional: true },
  { key: 'purpose', label: 'Purpose', optional: true },
  { key: 'status', label: 'Status' },
];

export default function GatePassList() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const cols = useOptionalColumns('gate-passes', COLUMNS);

  const list = useResourceList((params) => gpApi.list(params), {
    defaultSort: 'gatePassDate',
    defaultDir: 'desc',
    initialFilters: {
      type: '',
      status: '',
      purpose: '',
      vendorId: '',
      withVariation: '',
    },
  });

  const [vendorOptions, setVendorOptions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState(null);

  const canCreate = can('GATE_PASS.CREATE');

  useEffect(() => {
    vendorsApi.options().then(setVendorOptions).catch(loadFailed(setVendorOptions, 'vendors'));
  }, []);

  return (
    <>
      <PageHeader
        title="Gate Passes"
        actions={
          <>
            <ExportButton
              dataset="gate-passes"
              params={list.query}
              rowCount={list.meta.total}
            />
            {canCreate && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                New gate pass
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
            <Field label="Search" htmlFor="gp-search">
              <TextInput
                id="gp-search"
                type="search"
                placeholder="Search gate pass no, reference, party, item..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Type" htmlFor="gp-f-type">
            <EnumSelect
              id="gp-f-type"
              options={TYPE_OPTIONS}
              placeholder="All"
              value={list.filters.type ?? ''}
              onChange={(e) => list.setFilter('type', e.target.value)}
            />
          </Field>

          <Field label="Status" htmlFor="gp-f-status">
            <EnumSelect
              id="gp-f-status"
              options={STATUS_OPTIONS}
              placeholder="All"
              value={list.filters.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
            />
          </Field>

          <Field label="Purpose" htmlFor="gp-f-purpose">
            <EnumSelect
              id="gp-f-purpose"
              options={PURPOSE_OPTIONS}
              placeholder="All"
              value={list.filters.purpose ?? ''}
              onChange={(e) => list.setFilter('purpose', e.target.value)}
            />
          </Field>

          <Field label="Vendor" htmlFor="gp-f-vendor">
            <RecordSelect
              id="gp-f-vendor"
              options={vendorOptions}
              getLabel={(v) => v.vendorName}
              placeholder="All vendors"
              value={list.filters.vendorId ?? ''}
              onChange={(e) => list.setFilter('vendorId', e.target.value)}
            />
          </Field>

          <div className="field">
            <label htmlFor="gp-f-var">Deliveries</label>
            <EnumSelect
              id="gp-f-var"
              options={[{ value: 'true', label: 'That did not match' }]}
              placeholder="All"
              value={list.filters.withVariation ?? ''}
              onChange={(e) => list.setFilter('withVariation', e.target.value)}
            />
          </div>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="gatePassNo" label="Gate Pass No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="gatePassDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="type" label="Type" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                {cols.show('reference') && <SortableTh field="linkedDocNo" label="Reference" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />}
                <th>Item</th>
                <th>Party</th>
                {cols.show('uom') && <th>UOM</th>}
                <SortableTh field="qty" label="Qty" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                {cols.show('received') && <SortableTh field="receivedQty" label="Received" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />}
                {cols.show('variation') && <SortableTh field="variationPct" label="Variation" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />}
                {cols.show('purpose') && <th>Purpose</th>}
                <SortableTh field="status" label="Status" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <ColumnMenu {...cols} />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={cols.colSpan} className="loading-row">
                    <Spinner label="Loading gate passes..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={cols.colSpan}>
                    <EmptyState
                      title="No gate passes found"
                      message={list.search ? 'Try clearing the search or filters.' : undefined}
                    />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((gp) => (
                  <tr
                    key={gp.id}
                    onClick={() => navigate(`/gate-passes/${gp.id}`)}
                    className={`clickable ${gp.variationDirection === 'SHORT' ? 'row-warn' : ''}`}
                  >
                    <td className="code">{gp.gatePassNo}</td>
                    <td className="nowrap">{fmtDate(gp.gatePassDate)}</td>
                    <td>{gp.type === 'INWARD' ? 'Inward' : 'Outward'}</td>
                    {cols.show('reference') && (
                      <td className="code">
                        {gp.linkedDocNo ?? <span className="badge badge-pending">not allocated</span>}
                      </td>
                    )}
                    <td>{gp.item}</td>
                    <td>{gp.vendor?.vendorName ?? gp.partyName}</td>
                    {cols.show('uom') && <td>{gp.uom}</td>}
                    <td className="num">{fmtNum(gp.qty)}</td>
                    {cols.show('received') && (
                      <td className="num">{gp.receivedQty === null ? '-' : fmtNum(gp.receivedQty)}</td>
                    )}
                    {cols.show('variation') && (
                      <td className="num">
                        {gp.variationPctDisplay}%
                        {gp.variationDirection && gp.variationDirection !== 'EXACT' && (
                          <div className="faint">{gp.variationDirection.toLowerCase()}</div>
                        )}
                      </td>
                    )}
                    {/* Null until the pass is allocated - the same hand-rolled
                        charAt that threw on the detail screen. */}
                    {cols.show('purpose') && <td>{fmtEnum(gp.purpose, '-')}</td>}
                    <td>
                      <StatusBadge status={gp.status} />
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
        <Modal title="New gate pass" size="wide" onClose={() => setCreating(false)}>
          <div className="modal-body">
            <GatePassForm
              onCancel={() => setCreating(false)}
              onSaved={(saved) => {
                setCreating(false);
                setBanner({ kind: 'success', text: `${saved.gatePassNo} raised.` });
                navigate(`/gate-passes/${saved.id}`);
              }}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
