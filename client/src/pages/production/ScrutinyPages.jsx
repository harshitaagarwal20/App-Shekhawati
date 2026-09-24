/**
 * Fabric Scrutiny — the list, the detail, the decision and the amendment.
 *
 * ---------------------------------------------------------------------------
 *  OPEN AND LOCKED LOOK DIFFERENT
 *
 *  A scrutiny has two lives: QC records what they found (open, editable), then
 *  the Director decides (locked, permanently). A roll gets released, reworked
 *  or written off on the strength of that decision, so the screen never lets
 *  the two states look alike - a locked record shows the padlock notice, has no
 *  Edit button, and offers Amend instead.
 *
 *  AN AMENDMENT IS NOT AN EDIT
 *
 *  It writes the before/after set to the amendment trail first, then applies
 *  the change - so what the record said on the day it was decided stays
 *  recoverable. The dialog shows the current value beside each field being
 *  changed, because that is what is being put on the record.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import {
  orders as ordersApi,
  scrutinies as scrutinyApi,
} from '../../services/erp.js';
import {
  Alert,
  EmptyState,
  EnumSelect,
  Field,
  MasterSelect,
  Modal,
  PageHeader,
  Pagination,
  RecordSelect,
  SortableTh,
  Spinner,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import {
  FieldGroup,
  FormShell,
  RHFInput,
  RHFMasterSelect,
  RHFQty,
  RHFRecordSelect,
  RHFTextArea,
  useSubmit,
  useZodForm,
} from '../../components/form.jsx';
import { StateBadge, WorkflowTrail } from '../../components/workflow.jsx';
import { Detail, DetailGrid, TraceChain } from '../shared/Detail.jsx';
import { fabricIssues as fiApi, employees as employeesApi } from '../../services/erp.js';
import { fmtDate, fmtDateTime, fmtEnum, fmtNum, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const DECISIONS = [
  { value: 'ACCEPT', label: 'Accept' },
  { value: 'REWORK', label: 'Rework' },
  { value: 'REJECT', label: 'Reject' },
];

/** The decision, as a badge. Accept, Rework and Reject must not look alike. */
function DecisionBadge({ decision, locked }) {
  const cls =
    decision === 'ACCEPT' ? 'state-approved' : decision === 'REJECT' ? 'state-rejected' : 'state-rectification';
  return (
    <span className={`state-badge ${cls}`} title={locked ? 'Finalised' : 'Proposed — not yet finalised'}>
      {fmtEnum(decision)}
      {!locked && ' (draft)'}
    </span>
  );
}

// ===========================================================================
//  LIST
// ===========================================================================

export function ScrutinyList() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const list = useResourceList((params) => scrutinyApi.list(params), {
    defaultSort: 'scrutinyDate',
    defaultDir: 'desc',
    initialFilters: { decision: '', orderId: '', defectType: '', isLocked: '' },
  });

  const [orderOptions, setOrderOptions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState(null);
  const totals = list.meta?.totals;

  useEffect(() => {
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  return (
    <>
      <PageHeader
        title="Fabric Scrutiny"
        actions={
          <>
            <ExportButton
              dataset="scrutinies"
              params={list.query}
              rowCount={list.meta.total}
            />
            {can('FABRIC_SCRUTINY.CREATE') && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                Record a finding
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
            <Field label="Search" htmlFor="fs-search">
              <TextInput
                id="fs-search"
                type="search"
                placeholder="Search scrutiny no, defect, checker..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Decision" htmlFor="fs-f-decision">
            <EnumSelect
              id="fs-f-decision"
              options={DECISIONS}
              placeholder="All"
              value={list.filters.decision ?? ''}
              onChange={(e) => list.setFilter('decision', e.target.value)}
            />
          </Field>

          <Field label="Defect" htmlFor="fs-f-defect">
            <MasterSelect
              id="fs-f-defect"
              listCode="DefectType"
              placeholder="All"
              value={list.filters.defectType ?? ''}
              onChange={(e) => list.setFilter('defectType', e.target.value)}
            />
          </Field>

          <Field label="Order" htmlFor="fs-f-order">
            <RecordSelect
              id="fs-f-order"
              options={orderOptions}
              getLabel={(o) => o.orderNo}
              placeholder="All orders"
              value={list.filters.orderId ?? ''}
              onChange={(e) => list.setFilter('orderId', e.target.value)}
            />
          </Field>

          <div className="field">
            <label htmlFor="fs-f-locked">State</label>
            <EnumSelect
              id="fs-f-locked"
              options={[
                { value: 'false', label: 'Open — awaiting decision' },
                { value: 'true', label: 'Finalised' },
              ]}
              placeholder="All"
              value={list.filters.isLocked ?? ''}
              onChange={(e) => list.setFilter('isLocked', e.target.value)}
            />
          </div>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="scrutinyNo" label="Scrutiny No" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="scrutinyDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Roll</th>
                <SortableTh field="defectType" label="Defect" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="qtyAffected" label="Qty affected" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <th className="num">% of roll</th>
                <th>Order</th>
                <th>Checked by</th>
                <SortableTh field="decision" label="Decision" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={10} className="loading-row">
                    <Spinner label="Loading scrutinies..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    <EmptyState title="No scrutiny reports found" />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => navigate(`/scrutinies/${s.id}`)}
                    className={`clickable ${s.decision === 'REJECT' ? 'row-bad' : s.decision === 'REWORK' ? 'row-warn' : ''}`}
                  >
                    <td className="code">{s.scrutinyNo}</td>
                    <td className="nowrap">{fmtDate(s.scrutinyDate)}</td>
                    <td className="code">{s.roll?.rollNo ?? '-'}</td>
                    <td>{s.defectType}</td>
                    <td className="num">
                      {fmtNum(s.qtyAffected)}
                      <div className="faint">{s.uom}</div>
                    </td>
                    <td className="num">{s.affectedPctOfRoll ? `${s.affectedPctOfRoll}%` : '-'}</td>
                    <td className="code">{s.order?.orderNo ?? '-'}</td>
                    <td>{s.checkedByName}</td>
                    <td>
                      <DecisionBadge decision={s.decision} locked={s.isLocked} />
                    </td>
                    <td>
                      {s.isLocked ? (
                        <span className="faint">
                          locked{s.amended ? ` · ${s.amendmentCount} amendment(s)` : ''}
                        </span>
                      ) : (
                        <StateBadge state="DRAFT" />
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>

            {totals && !list.loading && list.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4} className="faint">
                    Total affected in the filtered set
                  </td>
                  <td className="num">
                    <strong>{fmtNum(totals.qtyAffected)}</strong>
                  </td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            )}
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
        <Modal title="Record a scrutiny finding" size="wide" onClose={() => setCreating(false)}>
          <ScrutinyForm
            onCancel={() => setCreating(false)}
            onSaved={(saved) => {
              setCreating(false);
              setBanner({
                kind: 'success',
                text: `${saved.scrutinyNo} recorded. It is a finding until the Director finalises it.`,
              });
              navigate(`/scrutinies/${saved.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}

// ===========================================================================
//  FORM
// ===========================================================================

const schema = z.object({
  scrutinyDate: z.string().min(1, 'Date is required'),
  rollId: z.string().uuid('Choose a roll'),
  orderId: z.string().uuid('Choose an order'),
  defectType: z.string().min(1, 'Choose a defect type'),
  qtyAffected: z.coerce.number().positive('Quantity affected must be greater than zero'),
  uom: z.string().optional(),
  checkedByEmployeeId: z.string().optional(),
  checkedByName: z.string().trim().max(120).optional(),
  authorisedBy: z.string().optional(),
  remarks: z.string().trim().max(2000).optional(),
});

function ScrutinyForm({ onSaved, onCancel }) {
  const form = useZodForm(schema, {
    scrutinyDate: todayInput(),
    rollId: '',
    orderId: '',
    defectType: '',
    qtyAffected: '',
    uom: '',
    checkedByEmployeeId: '',
    checkedByName: '',
    authorisedBy: '',
    remarks: '',
  });

  const [rolls, setRolls] = useState([]);
  const [orders, setOrders] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [preview, setPreview] = useState(null);

  const rollId = form.watch('rollId');
  const qtyAffected = form.watch('qtyAffected');

  useEffect(() => {
    fiApi.rolls({ includeEmpty: 'true' }).then(setRolls).catch(loadFailed(setRolls, 'rolls'));
    ordersApi.options().then(setOrders).catch(loadFailed(setOrders, 'orders'));
    employeesApi.options().then(setEmployees).catch(loadFailed(setEmployees, 'employees'));
  }, []);

  useEffect(() => {
    if (!rollId) {
      setPreview(null);
      return undefined;
    }
    const id = setTimeout(async () => {
      try {
        setPreview(
          await scrutinyApi.preview({
            rollId,
            qtyAffected: qtyAffected === '' ? undefined : String(qtyAffected),
          }),
        );
      } catch {
        setPreview(null);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [rollId, qtyAffected]);

  const { submit, busy, banner, setBanner } = useSubmit(
    form,
    (values) =>
      scrutinyApi.create({
        scrutinyDate: values.scrutinyDate,
        rollId: values.rollId,
        orderId: values.orderId,
        defectType: values.defectType,
        qtyAffected: String(values.qtyAffected),
        uom: values.uom || null,
        checkedByEmployeeId: values.checkedByEmployeeId || null,
        checkedByName: values.checkedByName || null,
        authorisedBy: values.authorisedBy || null,
        remarks: values.remarks || null,
        // `decision` is deliberately absent. A finding is not a ruling; the
        // decision is taken on the finalise endpoint, by somebody who holds
        // FABRIC_SCRUTINY.APPROVE.
      }),
    { onDone: onSaved },
  );

  return (
    <FormShell
      onSubmit={submit}
      banner={banner}
      onDismissBanner={() => setBanner('')}
      busy={busy}
      submitLabel="Record the finding"
      busyLabel="Recording..."
      onCancel={onCancel}
      footerNote="This records what QC found. It does nothing to the roll until the Director finalises a decision."
    >
      <div className="form-grid">
        <FieldGroup title="Finding">
          <RHFInput form={form} name="scrutinyDate" label="Date" type="date" required />
          <RHFRecordSelect
            form={form}
            name="rollId"
            label="Roll"
            required
            options={rolls}
            getLabel={(r) => r.label}
            placeholder="Choose the roll inspected..."
          />
          <RHFRecordSelect
            form={form}
            name="orderId"
            label="Order"
            required
            options={orders}
            getLabel={(o) => `${o.orderNo} — ${o.style?.styleNo ?? ''}`}
            placeholder="Choose the order..."
          />
          <RHFMasterSelect form={form} name="defectType" label="Defect type" listCode="DefectType" required />
          <RHFQty form={form} name="qtyAffected" label="Qty affected" required uom={preview?.roll.uom} />
          <RHFMasterSelect form={form} name="uom" label="UOM" listCode="UOM" />
        </FieldGroup>

        <FieldGroup title="Who">
          <RHFRecordSelect
            form={form}
            name="checkedByEmployeeId"
            label="Checked by"
            options={employees}
            getLabel={(e) => `${e.empName} (${e.empId})`}
            placeholder="Choose the checker..."
          />
          <RHFInput
            form={form}
            name="checkedByName"
            label="Checker name"
            hint="Only if the checker has no Employee Master record."
          />
          <RHFMasterSelect
            form={form}
            name="authorisedBy"
            label="To be authorised by"
            listCode="AuthorisedBy"
          />
          <RHFTextArea form={form} name="remarks" label="Remarks" className="span-2" />
        </FieldGroup>
      </div>

      {preview && (
        <div style={{ marginTop: 18 }}>
          <div className="fieldset-title">
            The roll <span className="faint">&mdash; and what has already been reported on it</span>
          </div>

          {preview.exceedsRoll && (
            <Alert kind="warning">
              Together with what has already been reported, this exceeds the whole roll. Check
              nothing is being counted twice.
            </Alert>
          )}
          {preview.roll.isHeld && (
            <Alert kind="warning">This roll is already held. {preview.roll.stage}</Alert>
          )}
        </div>
      )}
    </FormShell>
  );
}

// ===========================================================================
//  DETAIL
// ===========================================================================

export function ScrutinyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [dialog, setDialog] = useState(null); // finalise | amend

  const canDecide = can('FABRIC_SCRUTINY.APPROVE');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setS(await scrutinyApi.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !s) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading scrutiny..." />
        </div>
      </div>
    );
  }
  if (!s) return <Alert kind="error">{banner?.text ?? 'Scrutiny not found'}</Alert>;

  const { editable, amendments, otherScrutinies, history, effect } = s;

  return (
    <>
      <PageHeader
        title={`Scrutiny ${s.scrutinyNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/scrutinies')}>
              Back to list
            </button>
            {canDecide && editable.canFinalise && (
              <button type="button" className="btn btn-primary" onClick={() => setDialog('finalise')}>
                Take the decision
              </button>
            )}
            {canDecide && editable.canAmend && (
              <button type="button" className="btn" onClick={() => setDialog('amend')}>
                Amend
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

      {!s.isLocked && (
        <Alert kind="warning">
          This is a <strong>finding</strong>, not a ruling. The roll is untouched until a decision
          is finalised.
          {canDecide && (
            <span className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog('finalise')}>
                Take the decision
              </button>
            </span>
          )}
        </Alert>
      )}

      {s.isLocked && effect && (
        <Alert kind={s.decision === 'ACCEPT' ? 'success' : s.decision === 'REJECT' ? 'error' : 'warning'}>
          <strong>{effect.label}.</strong> {effect.summary}
        </Alert>
      )}

      <TraceChain
        title="What was inspected"
        chain={[s.order?.orderNo, s.roll?.rollNo, s.scrutinyNo].filter(Boolean).join(' → ')}
        complete
        links={[
          s.order && {
            label: 'Buyer Order',
            value: s.order.orderNo,
            sub: s.order.buyer?.buyerName,
            to: `/orders/${s.order.id}`,
          },
          s.roll && {
            label: 'Roll',
            value: s.roll.rollNo,
            sub: `${fmtEnum(s.roll.stage)}${s.roll.isHeld ? ' · held' : ''}`,
            to: `/inventory/rolls/${s.roll.id}`,
          },
          { label: 'Scrutiny', value: s.scrutinyNo, sub: fmtEnum(s.decision), current: true },
        ].filter(Boolean)}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Scrutiny report</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Scrutiny No" value={s.scrutinyNo} mono />
            <Detail label="Date" value={fmtDate(s.scrutinyDate)} />
            <Detail label="Roll No" value={s.roll?.rollNo} mono />
            <Detail label="Fabric" value={s.roll?.fabricName} />
            <Detail label="Colour" value={s.roll?.colorCode} />
            <Detail label="Defect type" value={s.defectType} />
            <Detail label="Order No" value={s.order?.orderNo} mono />
            <Detail label="Style No" value={s.style?.styleNo} mono />
            <Detail
              label="Checked by"
              value={s.checkedByName}
              sub={s.checkedByEmployee?.designation}
            />
            <Detail label="Authorised by" value={s.authorisedBy} />
            <Detail label="Decided by" value={s.decidedByName} />
            <Detail label="Decided at" value={s.decidedAt ? fmtDateTime(s.decidedAt) : null} />
            {s.remarks && <Detail label="Remarks" value={s.remarks} className="span-2" />}
          </DetailGrid>

          {/* --- C4: the findings behind the decision ---------------------
              The header carries ONE defect type and ONE quantity, which is
              what the workbook prints. A real checking report is a list, and
              this is it - which roll, how much, and what. */}
          {(s.defects ?? []).length > 0 && (
            <>
              <h3>What was found</h3>
              <TableWrap>
                <table className="data compact">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Family</th>
                      <th>Defect</th>
                      <th>Roll</th>
                      <th className="num">Qty</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.defects.map((d) => (
                      <tr key={d.id}>
                        <td>{d.lineNo}</td>
                        <td>{fmtEnum(d.category)}</td>
                        <td>{d.defectType}</td>
                        <td>{d.roll?.rollNo ?? s.roll?.rollNo ?? '-'}</td>
                        <td className="num">
                          {fmtNum(d.qty)} {d.uom}
                        </td>
                        <td>{d.remarks ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </>
          )}

        </div>
      </div>

      {/* --- Amendments: what the record used to say --------------------- */}
      {amendments.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span>Amendments</span>
            <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
              what the record said before each change
            </span>
          </div>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>When</th>
                  <th>Reason</th>
                  <th>Changed</th>
                </tr>
              </thead>
              <tbody>
                {amendments.map((a) => (
                  <tr key={a.id}>
                    <td className="faint">{a.amendmentNo}</td>
                    <td className="nowrap">{fmtDateTime(a.amendedAt)}</td>
                    <td>{a.reason}</td>
                    <td>
                      {Object.keys(a.changes?.after ?? {}).map((field) => (
                        <div key={field}>
                          <strong>{field}</strong>: {String(a.changes.before[field] ?? '—')} →{' '}
                          {String(a.changes.after[field] ?? '—')}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      {otherScrutinies.count > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Other reports on this roll</div>
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Scrutiny No</th>
                  <th>Date</th>
                  <th>Defect</th>
                  <th className="num">Qty affected</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {otherScrutinies.rows.map((o) => (
                  <tr className="clickable" key={o.id} onClick={() => navigate(`/scrutinies/${o.id}`)}>
                    <td className="code">{o.scrutinyNo}</td>
                    <td className="nowrap">{fmtDate(o.scrutinyDate)}</td>
                    <td>{o.defectType}</td>
                    <td className="num">{fmtNum(o.qtyAffected)}</td>
                    <td>
                      <DecisionBadge decision={o.decision} locked={o.isLocked} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      <WorkflowTrail history={history} title="Decision trail" />

      {dialog === 'finalise' && (
        <FinaliseDialog
          scrutiny={s}
          onCancel={() => setDialog(null)}
          onDone={async (message) => {
            setDialog(null);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}

      {dialog === 'amend' && (
        <AmendDialog
          scrutiny={s}
          onCancel={() => setDialog(null)}
          onDone={async (message) => {
            setDialog(null);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}
    </>
  );
}

/** The decision. A one-way door, and the dialog says so. */
/** C4 - the two defect families the brief names, plus the escape hatch. */
const DEFECT_CATEGORIES = [
  { value: 'DYEING', label: 'Dyeing defect' },
  { value: 'WEAVING', label: 'Weaving defect' },
  { value: 'OTHER', label: 'Other' },
];

let nextDefectKey = 1;
const blankDefect = (scrutiny) => ({
  key: nextDefectKey++,
  category: 'DYEING',
  defectType: scrutiny?.defectType ?? '',
  qty: '',
  remarks: '',
});

function FinaliseDialog({ scrutiny, onCancel, onDone }) {
  const [decision, setDecision] = useState(scrutiny.decision ?? 'ACCEPT');
  const [authorisedBy, setAuthorisedBy] = useState(scrutiny.authorisedBy ?? '');
  const [remarks, setRemarks] = useState('');
  const [effects, setEffects] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /**
   * C4 - THE STRUCTURED FINDINGS.
   *
   * A REWORK or a REJECT cannot be posted without at least one, enforced by the
   * service AND by the `fabric_scrutinies_decision_needs_defects` trigger.
   * Before this the screen offered no way to enter one, so those two decisions
   * could not be taken from the UI at all - the rule was implemented and the
   * workflow was unreachable.
   *
   * Sending fabric back to a job worker, or writing it off, costs real money and
   * gets argued about later. A decision with no recorded finding cannot be
   * defended, and REWORK gives the job worker nothing to correct.
   */
  const [defects, setDefects] = useState(() => [blankDefect(scrutiny)]);
  const needsDefects = decision === 'REWORK' || decision === 'REJECT';
  const alreadyHas = (scrutiny.defects ?? []).length > 0;

  const usableDefects = defects.filter((d) => d.defectType?.trim() && Number(d.qty) > 0);
  const defectsOk = !needsDefects || alreadyHas || usableDefects.length > 0;

  const setDefect = (i, patch) =>
    setDefects((cur) => cur.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  useEffect(() => {
    scrutinyApi.decisions().then(setEffects).catch(loadFailed(setEffects, 'effects'));
  }, []);

  const effect = effects.find((e) => e.decision === decision);

  async function go() {
    setBusy(true);
    setError('');
    try {
      await scrutinyApi.finalise(scrutiny.id, {
        decision,
        authorisedBy: authorisedBy || undefined,
        remarks: remarks || undefined,
        // C4 - written before the decision is locked, so the trigger can see them.
        defects: usableDefects.length
          ? usableDefects.map((d, i) => ({
              lineNo: i + 1,
              category: d.category,
              defectType: d.defectType.trim(),
              qty: String(d.qty),
              uom: scrutiny.uom,
              remarks: d.remarks || null,
            }))
          : undefined,
      });
      onDone(`${scrutiny.scrutinyNo} finalised as ${fmtEnum(decision)}. The record is now locked.`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Finalise ${scrutiny.scrutinyNo}`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${decision === 'ACCEPT' ? 'btn-primary' : 'btn-danger'}`}
            onClick={go}
            disabled={busy || !defectsOk}
          >
            {busy ? 'Working...' : `Finalise as ${fmtEnum(decision)}`}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>

        <p style={{ marginTop: 0 }}>
          <strong>{scrutiny.defectType}</strong> on roll {scrutiny.roll?.rollNo} —{' '}
          {fmtNum(scrutiny.qtyAffected)} {scrutiny.uom} affected
          {scrutiny.affectedPctOfRoll && `, ${scrutiny.affectedPctOfRoll}% of the roll`}.
        </p>

        <Field label="Decision" required>
          <select value={decision} onChange={(e) => setDecision(e.target.value)}>
            {DECISIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>

        {effect && (
          <Alert kind={decision === 'ACCEPT' ? 'success' : decision === 'REJECT' ? 'error' : 'warning'}>
            {effect.summary}
          </Alert>
        )}

        {/* --- C4: the structured findings -------------------------------
            Required for REWORK and REJECT. Shown for ACCEPT too, because a
            checker who found something and accepted it anyway should be able
            to say so — it is just not compulsory there. */}
        {alreadyHas ? (
          <Alert kind="info">
            {scrutiny.defects.length} defect line(s) already recorded against this scrutiny.
          </Alert>
        ) : (
          <>
            <h4 style={{ marginBottom: 4 }}>
              What was found{needsDefects ? ' *' : ''}
            </h4>
            <p className="hint" style={{ marginTop: 0 }}>
              {needsDefects
                ? `A ${fmtEnum(decision).toLowerCase()} needs at least one finding — which roll, how much, and what the defect was.`
                : 'Optional for an accept, but worth recording if anything was found.'}
            </p>

            <TableWrap>
              <table className="data compact">
                <thead>
                  <tr>
                    <th>Family</th>
                    <th>Defect</th>
                    <th className="num">Qty ({scrutiny.uom})</th>
                    <th>Remarks</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {defects.map((d, i) => (
                    <tr key={d.key}>
                      <td>
                        <select
                          value={d.category}
                          onChange={(e) => setDefect(i, { category: e.target.value })}
                        >
                          {DEFECT_CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <MasterSelect
                          listCode="DefectType"
                          value={d.defectType}
                          currentValue={d.defectType}
                          onChange={(e) => setDefect(i, { defectType: e.target.value })}
                        />
                      </td>
                      <td className="num">
                        <TextInput
                          type="number"
                          step="0.0001"
                          min="0"
                          value={d.qty}
                          onChange={(e) => setDefect(i, { qty: e.target.value })}
                        />
                      </td>
                      <td>
                        <TextInput
                          value={d.remarks}
                          onChange={(e) => setDefect(i, { remarks: e.target.value })}
                          placeholder="Optional"
                        />
                      </td>
                      <td>
                        {defects.length > 1 && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setDefects((c) => c.filter((_, idx) => idx !== i))}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setDefects((c) => [...c, blankDefect(scrutiny)])}
            >
              Add a finding
            </button>

            {needsDefects && !defectsOk && (
              <Alert kind="warning">
                A {fmtEnum(decision).toLowerCase()} cannot be posted without at least one finding
                that names a defect and a quantity. The server refuses it, and so does a database
                trigger underneath.
              </Alert>
            )}
          </>
        )}

        <Field label="Authorised by">
          <MasterSelect
            listCode="AuthorisedBy"
            value={authorisedBy}
            currentValue={authorisedBy}
            onChange={(e) => setAuthorisedBy(e.target.value)}
            placeholder="Stamped with your name if left blank"
          />
        </Field>

        <Field label="Remarks">
          <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>

        <Alert kind="warning">
          <strong>This locks the record.</strong> After finalising, the only way to change anything
          is an amendment, which keeps a copy of what the record said before.
        </Alert>
      </div>
    </Modal>
  );
}

/** An amendment: the before/after set goes on the record, then the change. */
function AmendDialog({ scrutiny, onCancel, onDone }) {
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState('');
  const [qtyAffected, setQtyAffected] = useState('');
  const [defectType, setDefectType] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const changes = {
    ...(decision && decision !== scrutiny.decision ? { decision } : {}),
    ...(qtyAffected !== '' ? { qtyAffected: String(qtyAffected) } : {}),
    ...(defectType && defectType !== scrutiny.defectType ? { defectType } : {}),
    ...(remarks ? { remarks } : {}),
  };
  const nothingChanged = Object.keys(changes).length === 0;

  async function go() {
    setBusy(true);
    setError('');
    try {
      await scrutinyApi.amend(scrutiny.id, { reason, changes });
      onDone(`${scrutiny.scrutinyNo} amended. The previous values are on the amendment trail.`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Amend ${scrutiny.scrutinyNo}`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={go}
            disabled={busy || nothingChanged || reason.trim().length < 3}
          >
            {busy ? 'Working...' : 'Record the amendment'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>

        <p style={{ marginTop: 0 }}>
          This record is locked. An amendment writes what it says now onto the amendment trail, and
          then applies the change — so the original stays recoverable.
        </p>

        <Field label="Reason" required>
          <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        <div className="fieldset-title">What to change</div>

        <Field label="Decision" hint={`Currently ${fmtEnum(scrutiny.decision)}`}>
          <select value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option value="">Leave as it is</option>
            {DECISIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Qty affected" hint={`Currently ${fmtNum(scrutiny.qtyAffected)} ${scrutiny.uom}`}>
          <TextInput
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={qtyAffected}
            onChange={(e) => setQtyAffected(e.target.value)}
            placeholder="Leave blank to keep"
          />
        </Field>

        <Field label="Defect type" hint={`Currently ${scrutiny.defectType}`}>
          <MasterSelect
            listCode="DefectType"
            value={defectType}
            currentValue={defectType}
            onChange={(e) => setDefectType(e.target.value)}
            placeholder="Leave as it is"
          />
        </Field>

        <Field label="Remarks">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>

        {decision && decision !== scrutiny.decision && (
          <Alert kind="warning">
            Changing the decision also moves the roll — an amendment that said &ldquo;actually,
            reject&rdquo; and left the roll released would be worse than no amendment at all.
          </Alert>
        )}
      </div>
    </Modal>
  );
}

export default ScrutinyList;
