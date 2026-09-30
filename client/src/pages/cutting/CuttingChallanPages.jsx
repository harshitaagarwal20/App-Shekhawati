/**
 * Cutting Challan — the requirement the cutting floor raises before any fabric
 * moves.
 *
 * ---------------------------------------------------------------------------
 *  THE OUTSTANDING QUANTITY IS THE SCREEN
 *
 *      CC-0001   Fabric / 10 oz      100 Mtrs required
 *                  issued  40 + 30 + 30  ───────────▶  COMPLETED
 *                  issued  40           ───────────▶   60 outstanding
 *
 *  A store keeper looking at this screen is answering one question: how much
 *  may I still issue against this line? So `outstanding` leads, and `required`
 *  and `issued` are the supporting figures rather than the other way round.
 *
 *  Partial fulfilment is normal. Over-fulfilment is impossible — the server
 *  refuses it and a CHECK constraint refuses it under that — so the form does
 *  not offer it either.
 *
 *  CLOSING SHORT IS A DECISION, NOT A TIDY-UP. It abandons the outstanding
 *  quantity deliberately, so it asks for a reason and records who did it. It
 *  sits behind the approve permission for that reason, not behind edit.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import {
  cuttingChallans as ccApi,
  orders as ordersApi,
  plannings as planningsApi,
  styles as stylesApi,
} from '../../services/erp.js';
import {
  Alert,
  EmptyState,
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
import { StateBadge } from '../../components/workflow.jsx';
import { fmtDate, fmtEnum, fmtNum, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

/** A stable key per row: keying on the array index makes React re-use the
 *  wrong input when a row is removed, which loses what the user was typing. */
let nextLineKey = 1;
const blankLine = () => ({ key: nextLineKey++, ...BLANK_LINE });

/**
 * Has the floor typed anything into the requirement grid yet?
 *
 * The plan's own explosion below only ever replaces an untouched grid - one
 * line, still holding the blank defaults. Anything else is somebody's work,
 * and a helpful default that overwrites it is not helpful.
 */
const isUntouched = (rows) =>
  rows.length === 1
  && !String(rows[0].requiredQty).trim()
  && !rows[0].subCategory
  && !rows[0].accessoriesItem
  && !rows[0].colorCode;

const BLANK_LINE = {
  itemCategory: 'Fabric',
  subCategory: '',
  accessoriesItem: '',
  colorCode: '',
  description: '',
  requiredQty: '',
  uom: 'Mtrs',
};

// ===========================================================================
//  LIST
// ===========================================================================

export function CuttingChallanList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const list = useResourceList((params) => ccApi.list(params), {
    defaultSort: 'challanDate',
    defaultDir: 'desc',
    initialFilters: { status: '', orderId: '', openOnly: '' },
  });

  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Cutting challans"
        actions={
          <>
            <ExportButton
              dataset="cutting-challans"
              params={list.query}
              rowCount={list.meta.total}
            />
            {can('CUTTING_CHALLAN.CREATE') && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                New cutting challan
              </button>
            )}
          </>
        }
      />

      <div className="filter-row">
        <div className="grow">
          <Field label="Search">
            <TextInput
              value={list.search}
              onChange={(e) => list.setSearch(e.target.value)}
              placeholder="Challan no, container, remarks"
            />
          </Field>
        </div>
        <Field label="Status">
          <select
            value={list.filters.status}
            onChange={(e) => list.setFilter('status', e.target.value)}
          >
            <option value="">All</option>
            {['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>
                {fmtEnum(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Only open">
          <select
            value={list.filters.openOnly}
            onChange={(e) => list.setFilter('openOnly', e.target.value)}
          >
            <option value="">All</option>
            <option value="true">Still outstanding</option>
          </select>
        </Field>
      </div>

      {list.error && <Alert kind="error">{list.error}</Alert>}
      {list.loading ? (
        <Spinner label="Loading challans" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title="No cutting challans"
          message="A challan is raised against an approved plan, before fabric is issued."
        />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="challanNo" label="Challan" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="challanDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Order</th>
                <th>Style</th>
                <th>Container</th>
                <th className="num">Required</th>
                <th className="num">Issued</th>
                <th className="num">Outstanding</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/cutting-challans/${r.id}`)}>
                  <td>{r.challanNo}</td>
                  <td>{fmtDate(r.challanDate)}</td>
                  <td>{r.order?.orderNo ?? '-'}</td>
                  <td>{r.style?.styleNo ?? '-'}</td>
                  <td>{r.containerNo ?? '-'}</td>
                  <td className="num">{fmtNum(r.totals?.requiredQty)}</td>
                  <td className="num">{fmtNum(r.totals?.issuedQty)}</td>
                  <td className="num">{fmtNum(r.totals?.outstandingQty)}</td>
                  <td>
                    <StateBadge state={r.workflowState} />
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

      {creating && (
        <CreateChallanModal
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            navigate(`/cutting-challans/${saved.id}`);
          }}
        />
      )}
    </>
  );
}

// ===========================================================================
//  CREATE
// ===========================================================================

function CreateChallanModal({ onClose, onSaved }) {
  const [orderOptions, setOrderOptions] = useState([]);
  const [planOptions, setPlanOptions] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [styleId, setStyleId] = useState('');
  const [planningId, setPlanningId] = useState('');
  const [containerNo, setContainerNo] = useState('');
  const [challanDate, setChallanDate] = useState(todayInput());
  const [requiredBy, setRequiredBy] = useState('');
  const [remarks, setRemarks] = useState('');

  const [lines, setLines] = useState([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    ordersApi
      .list({ pageSize: 100 })
      .then((r) => setOrderOptions(Array.isArray(r) ? r : (r?.rows ?? [])))
      .catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  // Only APPROVED plans may be drawn against — the server refuses anything
  // else, so the picker must not offer it.
  useEffect(() => {
    if (!orderId) {
      setPlanOptions([]);
      return;
    }
    planningsApi
      .list({ orderId, approvalStatus: 'APPROVED', pageSize: 50 })
      .then((r) => setPlanOptions(Array.isArray(r) ? r : (r?.rows ?? [])))
      .catch(loadFailed(setPlanOptions, 'plans'));
  }, [orderId]);

  /*
   * ===========================================================================
   *  THE CHALLAN STARTS FROM THE PLAN IT IS RAISED AGAINST
   * ===========================================================================
   *
   *  Choosing the planning version fills "What cutting needs" in: the plan says
   *  how many pieces are to be cut, and the style's BOM says what those pieces
   *  consume - fabric, handles, zips, labels and the rest, each with its own
   *  unit and the wastage the BOM declares.
   *
   *  THE SAME EXPLOSION AS EVERYWHERE ELSE. `styles.requirement` is the shared
   *  calculation the order screen, the PO ceiling, the material plan and the
   *  planning grid all use, so the quantities offered here are the ones those
   *  documents already show for the same pieces.
   *
   *  STILL EDITABLE, because the floor knows things the BOM does not - a
   *  part-issue, cloth already on the floor, a lot being cut in two goes. This
   *  is a starting point, not a decision, and the server takes the lines it is
   *  given.
   *
   *  IT NEVER OVERWRITES WORK - see `isUntouched`.
   */
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const [prefillNote, setPrefillNote] = useState('');

  useEffect(() => {
    if (!planningId) return undefined;

    let cancelled = false;
    setPrefillNote('');

    planningsApi
      .get(planningId)
      .then(async (plan) => {
        if (cancelled) return;
        const style = plan.style?.id ?? plan.styleId;
        const pieces = Number(plan.plannedQty ?? 0);
        if (!style || !(pieces > 0)) return;

        // The plan names the style; the order's first style is not necessarily
        // the one being cut when an order carries several.
        setStyleId(style);

        const req = await stylesApi.requirement(style, pieces);
        if (cancelled || !isUntouched(linesRef.current)) return;

        const rows = (req.lines ?? []).map((l) => ({
          ...blankLine(),
          itemCategory: l.itemCategory ?? 'Fabric',
          subCategory: l.subCategory ?? '',
          accessoriesItem: l.accessoriesItem ?? '',
          colorCode: l.colorCode ?? '',
          description: l.description ?? '',
          // With wastage: what has to be issued, not what ends up in the bag.
          requiredQty: String(l.withWastage ?? l.baseRequirement ?? ''),
          uom: l.uom ?? 'Mtrs',
        }));

        if (rows.length) {
          setLines(rows);
          setPrefillNote(
            `${rows.length} line${rows.length === 1 ? '' : 's'} from the BOM for `
            + `${fmtNum(pieces)} pieces on ${plan.planNo}. Change anything that is wrong.`,
          );
          return;
        }

        /*
         * NOTHING TO EXPLODE, AND THE REASON SAID OUT LOUD.
         *
         * This was a silent no-op: a style with no bill of materials left the
         * grid blank with nothing to explain it, which reads as the screen
         * being broken rather than as the Style Master being incomplete. The
         * server says why in its own words; they name the screen to fix it on.
         */
        setPrefillNote(
          req.noRequirementReason
          ?? `${plan.planNo} is for style ${req.styleNo}, which has no materials to work `
             + 'from. Add its bill of materials on the Style Master, or type the lines here.',
        );
      })
      .catch((e) => {
        // A failed lookup is not the same as an empty one, and the planner
        // should be able to tell them apart.
        setPrefillNote(`Could not read the plan's materials: ${e.message}`);
      });

    return () => { cancelled = true; };
  }, [planningId]);

  const setLine = (i, patch) =>
    setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function save() {
    setBusy(true);
    setError('');
    try {
      const saved = await ccApi.create({
        challanDate,
        orderId,
        styleId: styleId || undefined,
        planningId,
        containerNo: containerNo || null,
        requiredBy: requiredBy || null,
        remarks: remarks || null,
        lines: lines
          .filter((l) => l.itemCategory && l.uom && Number(l.requiredQty) > 0)
          .map((l, i) => ({
            lineNo: i + 1,
            itemCategory: l.itemCategory,
            subCategory: l.subCategory || null,
            accessoriesItem: l.accessoriesItem || null,
            colorCode: l.colorCode || null,
            description: l.description || null,
            requiredQty: String(l.requiredQty),
            uom: l.uom,
          })),
      });
      onSaved(saved);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const usable = lines.filter((l) => Number(l.requiredQty) > 0).length;
  const ready = orderId && planningId && usable > 0;

  return (
    <Modal
      title="New cutting challan"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={save}>
            {busy ? 'Saving…' : 'Raise challan'}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}

      <div className="form-grid">
        <Field label="Order" required>
          <RecordSelect
            value={orderId}
            onChange={(e) => {
              setOrderId(e.target.value);
              const o = orderOptions.find((x) => x.id === e.target.value);
              setStyleId(o?.style?.id ?? o?.styleId ?? '');
              setPlanningId('');
            }}
            // RecordSelect keys on getValue(o) — default o.id. Passing
            // {value,label} objects gave every option an undefined key.
            options={orderOptions}
            getValue={(o) => o.id}
            getLabel={(o) => o.orderNo}
          />
        </Field>

        {/*
          AN EMPTY PICKER HAS TO SAY WHY IT IS EMPTY.

          Plans are fetched per order, so before an order is chosen this list
          is empty by construction - and it said "No match", which reads as a
          fault in the system rather than as "you have not told me the order
          yet". Once an order IS chosen it can still be legitimately empty,
          because only APPROVED plans may be drawn against, and that is a
          different thing again and worth saying differently.

          The Order form already does this for its Style field ("Pick a buyer
          first - styles belong to a buyer"); this is the same courtesy.
        */}
        <Field
          label="Planning version"
          required
          hint={
            !orderId
              ? 'Choose an order first - plans belong to an order.'
              : planOptions.length === 0
                ? 'This order has no approved plan yet. A plan must be approved before cutting can be raised against it.'
                : 'Only approved plans can be drawn against.'
          }
        >
          <RecordSelect
            value={planningId}
            onChange={(e) => setPlanningId(e.target.value)}
            options={planOptions}
            disabled={!orderId}
            placeholder={orderId ? 'Select an approved plan...' : 'Choose an order first'}
            emptyLabel={orderId ? 'No approved plan for this order' : 'Choose an order first'}
            getValue={(p) => p.id}
            getLabel={(p) => `${p.planNo}${p.containerNo ? ` / ${p.containerNo}` : ''}`}
          />
        </Field>

        {/* Typed, not chosen - and normally not typed here at all: left blank
            the challan inherits the container from the plan it is raised
            against. See planning.service.js for why it is not a master list. */}
        <Field label="Container" hint="Leave blank to take it from the plan.">
          <TextInput
            value={containerNo}
            onChange={(e) => setContainerNo(e.target.value)}
            placeholder="As printed on the container"
          />
        </Field>

        <Field label="Challan date" required>
          <TextInput type="date" value={challanDate} onChange={(e) => setChallanDate(e.target.value)} />
        </Field>

        <Field label="Required by">
          <TextInput type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
        </Field>

        <Field label="Remarks" className="span-2">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>

      <h4>What cutting needs</h4>
      {prefillNote && <p className="hint" style={{ marginTop: -8 }}>{prefillNote}</p>}
      <TableWrap>
        <table className="data compact">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Sub-category</th>
              <th>Colour</th>
              <th className="num">Required qty</th>
              <th>UOM</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key}>
                <td>{i + 1}</td>
                <td>
                  <MasterSelect
                    listCode="ItemCategory"
                    value={l.itemCategory}
                    onChange={(e) => setLine(i, { itemCategory: e.target.value })}
                  />
                </td>
                <td>
                  <MasterSelect
                    listCode="FabricSubCat"
                    value={l.subCategory}
                    onChange={(e) => setLine(i, { subCategory: e.target.value })}
                  />
                </td>
                <td>
                  <MasterSelect
                    listCode="ColorCode"
                    value={l.colorCode}
                    onChange={(e) => setLine(i, { colorCode: e.target.value })}
                  />
                </td>
                <td className="num">
                  <TextInput
                    type="number"
                    step="0.0001"
                    min="0"
                    value={l.requiredQty}
                    onChange={(e) => setLine(i, { requiredQty: e.target.value })}
                  />
                </td>
                <td>
                  <MasterSelect
                    listCode="UOM"
                    value={l.uom}
                    onChange={(e) => setLine(i, { uom: e.target.value })}
                  />
                </td>
                <td>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setLines((c) => c.filter((_, idx) => idx !== i))}
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
      <button type="button" className="btn btn-sm" onClick={() => setLines((c) => [...c, blankLine()])}>
        Add item
      </button>
    </Modal>
  );
}

// ===========================================================================
//  DETAIL
// ===========================================================================

export function CuttingChallanDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [closing, setClosing] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRow(await ccApi.get(id));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(label, fn) {
    setBusy(label);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  if (loading) return <Spinner label="Loading challan" />;
  if (!row) return <Alert kind="error">{error || 'Not found'}</Alert>;

  const state = row.workflowState;
  // F-10: the permission says what this ROLE may do; `canApprove` from the
  // server says whether THIS user may approve THIS document - it is false
  // when they raised it themselves. Both must hold, or the button would be
  // offered and then refused with a 403.
  const canApprove = can('CUTTING_CHALLAN.APPROVE') && row.canApprove !== false;

  return (
    <>
      <PageHeader
        title={`${row.challanNo} — cutting challan`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/cutting-challans')}>
              Back
            </button>
            {state === 'DRAFT' && can('CUTTING_CHALLAN.EDIT') && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => act('submit', () => ccApi.submit(row.id, { submittedTo: 'Approver' }))}
              >
                {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
              </button>
            )}
            {['SUBMITTED', 'PENDING_APPROVAL', 'RESUBMITTED'].includes(state) && canApprove && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => act('approve', () => ccApi.approve(row.id, {}))}
                >
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
                </button>
                <button type="button" className="btn btn-danger" onClick={() => setRejecting(true)}>
                  Reject
                </button>
              </>
            )}
            {state === 'APPROVED' && canApprove && (
              <button type="button" className="btn" onClick={() => setClosing({ lineId: null })}>
                Close short
              </button>
            )}
          </>
        }
      />

      {error && <Alert kind="error" onDismiss={() => setError('')}>{error}</Alert>}

      <div className="detail-head">
        <StateBadge state={state} />
      </div>

      {row.closedShort && (
        <Alert kind="warning">
          <strong>Closed short.</strong> {row.closedShortByName ?? 'unknown'}: {row.closedShortReason ?? ''}
        </Alert>
      )}

      <h3>Requirement, and what has been issued against it</h3>
      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th className="num">Required</th>
              <th className="num">Issued</th>
              <th className="num">Outstanding</th>
              <th className="num">Filled</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(row.lines ?? []).map((l) => (
              <tr key={l.id}>
                <td>{l.lineNo}</td>
                <td>
                  {[l.itemCategory, l.subCategory, l.accessoriesItem, l.colorCode]
                    .filter(Boolean)
                    .join(' / ')}
                </td>
                <td className="num">{fmtNum(l.requiredQty)} {l.uom}</td>
                <td className="num">{fmtNum(l.issuedQty)}</td>
                <td className="num"><strong>{fmtNum(l.outstandingQty)}</strong></td>
                <td className="num">{l.fulfilledPct}%</td>
                <td>{fmtEnum(l.status)}</td>
                <td>
                  {state === 'APPROVED' && l.open && canApprove && (
                    <button type="button" className="btn btn-sm" onClick={() => setClosing({ lineId: l.id })}>
                      Close short
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      {(row.lines ?? []).some((l) => (l.fabricIssues ?? []).length > 0) && (
        <>
          <h3>Fabric issued against this challan</h3>
          <TableWrap>
            <table className="data compact">
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Date</th>
                  <th>Roll</th>
                  <th className="num">Qty</th>
                </tr>
              </thead>
              <tbody>
                {(row.lines ?? []).flatMap((l) =>
                  (l.fabricIssues ?? []).map((fi) => (
                    <tr key={fi.id}>
                      <td>{fi.issueNo}</td>
                      <td>{fmtDate(fi.issueDate)}</td>
                      <td>{fi.roll?.rollNo ?? '-'}</td>
                      <td className="num">{fmtNum(fi.fabricQtyIssued)} {fi.uom}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}

      {closing && (
        <Modal
          title={closing.lineId ? 'Close this line short' : 'Close the challan short'}
          onClose={() => setClosing(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setClosing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={reason.trim().length < 3 || busy}
                onClick={() =>
                  act('close', async () => {
                    await ccApi.closeShort(row.id, { lineId: closing.lineId ?? undefined, reason });
                    setClosing(null);
                    setReason('');
                  })
                }
              >
                Close short
              </button>
            </>
          }
        >
          <p className="hint">
            The outstanding quantity is abandoned deliberately and no further fabric can be issued
            against it. This is a decision on the record — say why.
          </p>
          <Field label="Reason" required>
            <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      )}

      {rejecting && (
        <Modal
          title="Reject this challan"
          onClose={() => setRejecting(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRejecting(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={reason.trim().length < 3 || busy}
                onClick={() =>
                  act('reject', async () => {
                    await ccApi.reject(row.id, reason);
                    setRejecting(false);
                    setReason('');
                  })
                }
              >
                Reject
              </button>
            </>
          }
        >
          <Field label="Reason" required>
            <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      )}
    </>
  );
}
