/**
 * Cut Pieces Receipt — pieces counted in from the cutting department.
 *
 * ---------------------------------------------------------------------------
 *  WHERE IT SITS
 *
 *      Cutting Challan  ->  cut on the floor  ->  CUT PIECES RECEIPT  ->  Cutting Issue
 *
 *  The cutting master hands over good pieces, rejected pieces and handles;
 *  the store counts them in here. The figure the store keeper wants is
 *  "pieces in hand" — good pieces received for the order, less what Cutting
 *  Issues have already sent to stitching — so it is shown on the form while
 *  the receipt is being keyed, and on every receipt afterwards.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import {
  cutPiecesReceipts as cprApi,
  cuttingChallans as ccApi,
  employees as employeesApi,
  fabricIssues as fiApi,
  orders as ordersApi,
  styles as stylesApi,
} from '../../services/erp.js';
import {
  Alert,
  ConfirmDialog,
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
import { Detail, DetailGrid } from '../shared/Detail.jsx';
import { fmtDate, fmtDateTime, fmtNum, toDateInput, todayInput } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const rowsOf = (r) => (Array.isArray(r) ? r : (r?.rows ?? []));

/**
 * C6 - the fabric equation's six boxes, received first:
 *     received = consumed + returned + remnants + wastage + damaged
 */
const FABRIC_FIELDS = [
  ['issuedQty', 'Fabric received on the floor'],
  ['consumedQty', 'Consumed (cut into panels)'],
  ['remainderQty', 'Remainder returned to store', 'Goes back on the same roll it came off.'],
  ['remnantQty', 'Remnants kept', 'End-bits good for a pocket or a sample. Booked as a remnant roll.'],
  ['wastageQty', 'Wastage', 'Offcuts and rejects. Stated, never inferred.'],
  ['fabricDamageQty', 'Fabric damaged', 'Damage recorded separately from normal wastage.'],
];

// ===========================================================================
//  LIST
// ===========================================================================

export function CutPiecesReceiptList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const list = useResourceList((params) => cprApi.list(params), {
    defaultSort: 'receiptDate',
    defaultDir: 'desc',
    initialFilters: { orderId: '' },
  });

  const [orderOptions, setOrderOptions] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    ordersApi.options().then(setOrderOptions).catch(loadFailed(setOrderOptions, 'orders'));
  }, []);

  return (
    <>
      <PageHeader
        title="Cut pieces receipts"
        actions={
          <>
            <ExportButton dataset="cut-pieces-receipts" params={list.query} rowCount={list.meta.total} />
            {can('CUT_PIECES_RECEIPT.CREATE') && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                Receive cut pieces
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
              placeholder="Receipt no, order, style, cutting master, colour, lot"
            />
          </Field>
        </div>
        <Field label="Order">
          <RecordSelect
            value={list.filters.orderId}
            onChange={(e) => list.setFilter('orderId', e.target.value)}
            options={orderOptions}
            getValue={(o) => o.id}
            getLabel={(o) => o.orderNo}
            placeholder="All orders"
          />
        </Field>
      </div>

      {list.error && <Alert kind="error">{list.error.message ?? String(list.error)}</Alert>}
      {list.loading ? (
        <Spinner label="Loading receipts" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title="No cut pieces received yet"
          message="When the cutting department hands over cut pieces, count them in here."
        />
      ) : (
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="receiptNo" label="Receipt" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="receiptDate" label="Date" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Order</th>
                <th>Style</th>
                <th>Challan</th>
                <th>Cutting master</th>
                <th>Colour</th>
                <SortableTh field="pcsReceived" label="Good pcs" className="num" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th className="num">Rejected</th>
                <th className="num">Handles</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/cut-pieces-receipts/${r.id}`)}>
                  <td className="code">{r.receiptNo}</td>
                  <td className="nowrap">{fmtDate(r.receiptDate)}</td>
                  <td>{r.order?.orderNo ?? '-'}</td>
                  <td>{r.style?.styleNo ?? '-'}</td>
                  <td>{r.cuttingChallan?.challanNo ?? '-'}</td>
                  <td>{r.cuttingMasterName}</td>
                  <td>{r.colorCode ?? '-'}</td>
                  <td className="num"><strong>{fmtNum(r.pcsReceived)}</strong></td>
                  <td className="num">{fmtNum(r.pcsRejected)}</td>
                  <td className="num">{fmtNum(r.handlesReceived)}</td>
                  <td><CheckBadge row={r} /></td>
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
        <ReceiptModal
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            navigate(`/cut-pieces-receipts/${saved.id}`);
          }}
        />
      )}
    </>
  );
}

// ===========================================================================
//  DETAIL
// ===========================================================================

export function CutPiecesReceiptDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRow(await cprApi.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !row) return <Spinner label="Loading receipt..." />;
  if (!row) return <Alert kind="error">{banner?.text ?? 'Receipt not found'}</Alert>;

  async function remove() {
    setBusy(true);
    try {
      await cprApi.remove(row.id);
      navigate('/cut-pieces-receipts');
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
      setBusy(false);
    }
  }

  const s = row.summary ?? {};

  return (
    <>
      <PageHeader
        title={`Cut pieces receipt ${row.receiptNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/cut-pieces-receipts')}>
              Back to list
            </button>
            {/* Not once its fabric has come off the cutting floor: the ledger
                entries would be left with no document behind them. */}
            {can('CUT_PIECES_RECEIPT.DELETE') && !row.stockPostedAt && (
              <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>
                Delete
              </button>
            )}
            {can('CUT_PIECES_RECEIPT.EDIT') && (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {can('CUT_PIECES_RECEIPT.EDIT') && (
              <button type="button" className="btn btn-primary" onClick={() => setChecking(true)}>
                {row.checkStatus === 'PENDING' ? 'Record sample check' : 'Check again'}
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

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Received from cutting</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Receipt No" value={row.receiptNo} mono />
            <Detail label="Date" value={fmtDate(row.receiptDate)} />
            <Detail
              label="Order"
              value={row.order ? <Link to={`/orders/${row.order.id}`}>{row.order.orderNo}</Link> : '-'}
              sub={row.order?.buyer?.buyerName}
            />
            <Detail label="Style" value={row.style?.styleNo} mono />
            <Detail
              label="Cutting challan"
              value={
                row.cuttingChallan
                  ? <Link to={`/cutting-challans/${row.cuttingChallan.id}`}>{row.cuttingChallan.challanNo}</Link>
                  : '-'
              }
            />
            <Detail label="Cutting master" value={row.cuttingMasterName} sub={row.cuttingMaster?.empId} />
            <Detail label="Colour" value={row.colorCode} />
            <Detail label="Lot No" value={row.lotNo} />
            <Detail label="Good pieces" value={fmtNum(row.pcsReceived)} />
            <Detail label="Rejected pieces" value={fmtNum(row.pcsRejected)} />
            <Detail
              label="Handles"
              value={fmtNum(row.handlesReceived)}
              sub={row.handlesPerBag != null ? `${row.handlesPerBag} per bag, from the style` : 'Typed'}
            />
            {row.panelsReceived != null && (
              <Detail
                label="Panels"
                value={fmtNum(row.panelsReceived)}
                sub={`${row.panelsPerBag} per bag, from the style`}
              />
            )}
            <Detail label="Received by" value={row.receivedByName} sub={fmtDateTime(row.createdAt)} />
            {row.remarks && <Detail label="Remarks" value={row.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      <FabricCard row={row} />

      <CheckCard row={row} />

      {Array.isArray(row.panelBreakdown) && row.panelBreakdown.length > 0 && (
        <PanelBreakdown breakdown={row.panelBreakdown} />
      )}

      <InHandCard summary={s} title={`Cut pieces for ${row.order?.orderNo ?? 'this order'} / ${row.style?.styleNo ?? ''}`} />

      {editing && (
        <ReceiptModal
          existing={row}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            setBanner({ kind: 'success', text: `${row.receiptNo} updated.` });
            await load();
          }}
        />
      )}

      {checking && (
        <CheckModal
          row={row}
          onClose={() => setChecking(false)}
          onSaved={async (saved) => {
            setChecking(false);
            setBanner(
              saved.checkStatus === 'PASSED'
                ? {
                    kind: 'success',
                    text: `${row.receiptNo} passed - ${fmtNum(Number(saved.pcsReceived) - Number(saved.defectivePcs ?? 0))} pieces ready for stitching.`,
                  }
                : {
                    kind: 'error',
                    text: `${row.receiptNo} failed the sample check. Sort the lot and check it again before it goes to stitching.`,
                  },
            );
            await load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${row.receiptNo}?`}
          message="The receipt is removed from the register and from the pieces-in-hand total. The audit trail keeps a record of it."
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onCancel={() => setDeleting(false)}
        />
      )}
    </>
  );
}

/** Panel by panel, as multiplied and frozen on the receipt. */
export function PanelBreakdown({ breakdown, title = 'Panels counted in' }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">{title}</div>
      <div className="card-body">
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Panel</th>
                <th className="num">Per bag</th>
                <th className="num">Pieces</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((p, i) => (
                <tr key={`${p.name}-${i}`}>
                  <td>{p.name}</td>
                  <td className="num">{p.piecesPerBag}</td>
                  <td className="num">{fmtNum(p.pieces)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>
    </div>
  );
}

/** Received from cutting, issued to stitching, and what is left in hand. */
/**
 * The cloth these pieces were cut from, and where every metre of it went.
 * Posted figures are fixed: they are what the stock ledger already says.
 */
function FabricCard({ row }) {
  const uom = row.fabricUom ?? 'Mtrs';
  const q = (v) => `${fmtNum(v)} ${uom}`;
  const carries = Number(row.issuedQty) > 0;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <span>Fabric used</span>
        {row.stockPostedAt && (
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            taken off the cutting floor {fmtDateTime(row.stockPostedAt)}
          </span>
        )}
      </div>
      <div className="card-body">
        {!carries ? (
          <p className="muted" style={{ margin: 0 }}>
            No fabric recorded on this receipt - its cloth was accounted for on another receipt
            of the same cut, or it was received before fabric moved here.
            {!row.stockPostedAt && ' Edit the receipt to add it.'}
          </p>
        ) : (
          <DetailGrid>
            <Detail
              label="Fabric issue"
              value={row.fabricIssue?.issueNo}
              sub={row.fabricIssue?.roll ? `roll ${row.fabricIssue.roll.rollNo}` : undefined}
              mono
            />
            <Detail label="Received on the floor" value={q(row.issuedQty)} />
            <Detail label="Consumed (cut into panels)" value={q(row.consumedQty)} />
            <Detail label="Returned to store" value={q(row.remainderQty)} sub="on the same roll" />
            <Detail
              label="Remnants kept"
              value={q(row.remnantQty)}
              sub={row.remnantRollNo ? `booked as ${row.remnantRollNo}` : undefined}
            />
            <Detail label="Wastage" value={q(row.wastageQty)} />
            <Detail label="Fabric damaged" value={q(row.fabricDamageQty)} />
          </DetailGrid>
        )}
      </div>
    </div>
  );
}

function InHandCard({ summary, title }) {
  if (!summary) return null;
  const inHand = Number(summary.pcsInHand ?? 0);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">{title}</div>
      <div className="card-body">
        <DetailGrid>
          <Detail label="Receipts" value={fmtNum(summary.receipts)} />
          <Detail label="Good pieces received" value={fmtNum(summary.pcsReceived)} />
          <Detail label="Rejected pieces" value={fmtNum(summary.pcsRejected)} />
          <Detail label="Handles received" value={fmtNum(summary.handlesReceived)} />
          <Detail label="Issued to stitching" value={fmtNum(summary.pcsIssuedToStitching)} sub="On posted Cutting Issues" />
          <Detail
            label="Pieces in hand"
            value={<strong style={inHand < 0 ? { color: 'var(--danger, #b42318)' } : undefined}>{fmtNum(inHand)}</strong>}
            sub={inHand < 0 ? 'More issued than received - check the counts' : 'Received, not yet issued'}
          />
          <Detail
            label="Checked, ready for stitching"
            value={<strong>{fmtNum(Math.max(0, Number(summary.pcsReadyToIssue ?? 0)))}</strong>}
            sub="Passed the sample check, defective pieces pulled out"
          />
          <Detail
            label="Waiting for a check"
            value={fmtNum(summary.pcsPendingCheck)}
            sub={summary.lotsPendingCheck ? `${summary.lotsPendingCheck} lot(s)` : 'None'}
          />
          <Detail
            label="Failed - sort and re-check"
            value={fmtNum(summary.pcsFailedCheck)}
            sub={summary.lotsFailedCheck ? `${summary.lotsFailedCheck} lot(s)` : 'None'}
          />
          <Detail label="Defective pieces found" value={fmtNum(summary.pcsDefective)} sub="In sample checks" />
        </DetailGrid>
        <DefectSummary defects={summary.defects} />
      </div>
    </div>
  );
}

/**
 * Every defect the sample checks found, by panel and type, worst first -
 * which pieces will give trouble at stitching, before any are sewn.
 */
export function DefectSummary({ defects, title = 'Defects found before stitching' }) {
  if (!defects?.length) return null;
  return (
    <>
      <h4 style={{ margin: '16px 0 8px' }}>{title}</h4>
      <TableWrap>
        <table className="data">
          <thead>
            <tr>
              <th>Panel</th>
              <th>Defect</th>
              <th className="num">Pieces</th>
            </tr>
          </thead>
          <tbody>
            {defects.map((d, i) => (
              <tr key={`${d.panel}-${d.defectType}-${i}`}>
                <td>{d.panel ?? 'Whole piece'}</td>
                <td>{d.defectType}</td>
                <td className="num">{fmtNum(d.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}

// ===========================================================================
//  SAMPLE CHECK
// ===========================================================================

const CHECK_BADGE = {
  PENDING: ['badge-pending', 'To check'],
  PASSED: ['badge-approved', 'Passed'],
  FAILED: ['badge-rejected', 'Failed'],
};

function CheckBadge({ row }) {
  const [cls, label] = CHECK_BADGE[row.checkStatus] ?? CHECK_BADGE.PENDING;
  return (
    <span className={`badge ${cls}`}>
      {label}
      {row.checkStatus !== 'PENDING' && row.defectRatePct != null ? ` · ${fmtNum(row.defectRatePct)}%` : ''}
    </span>
  );
}

function CheckCard({ row }) {
  const ready = Number(row.pcsReceived) - Number(row.defectivePcs ?? 0);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        Sample check before stitching <CheckBadge row={row} />
      </div>
      <div className="card-body">
        {row.checkStatus === 'PENDING' ? (
          <Alert kind="warning">
            Not checked yet. None of these {fmtNum(row.pcsReceived)} pieces can go to stitching until a
            sample has been opened and the defects recorded.
          </Alert>
        ) : row.sampleQty == null ? (
          // Receipts from before checking began were marked PASSED with no sample.
          <p className="hint" style={{ margin: 0 }}>Received before sample checking began - counted as passed.</p>
        ) : (
          <>
            {row.checkStatus === 'FAILED' && (
              <Alert kind="error">
                {fmtNum(row.defectRatePct)}% of the sample was defective, over the {fmtNum(row.acceptLimitPct)}%
                limit. The whole lot is held: sort it, then check it again.
              </Alert>
            )}
            <DetailGrid>
              <Detail label="Pieces checked" value={fmtNum(row.sampleQty)} sub={`of ${fmtNum(row.pcsReceived)} received`} />
              <Detail label="Defective in sample" value={fmtNum(row.defectivePcs)} sub="Pulled out of the lot" />
              <Detail label="Defect rate" value={`${fmtNum(row.defectRatePct)}%`} sub={`Limit ${fmtNum(row.acceptLimitPct)}%`} />
              <Detail
                label="Ready for stitching"
                value={row.checkStatus === 'PASSED' ? fmtNum(ready) : '0'}
                sub={row.checkStatus === 'PASSED' ? 'From this lot' : 'Lot failed'}
              />
              <Detail label="Checked by" value={row.checkedByName} sub={fmtDateTime(row.checkedAt)} />
              {row.checkRemarks && <Detail label="Check remarks" value={row.checkRemarks} className="span-2" />}
            </DetailGrid>
            <DefectSummary title="Defects found in this lot" defects={row.defects} />
          </>
        )}
      </div>
    </div>
  );
}

/** Mirrors server/src/domain/cutCheck.js; the server judges again on save. */
const DEFAULT_SAMPLE_PCT = 10;
const DEFAULT_ACCEPT_LIMIT_PCT = 2.5;
function suggestedSample(pcs) {
  const n = Math.floor(Number(pcs) || 0);
  return n <= 0 ? 0 : Math.min(n, Math.max(1, Math.ceil((n * DEFAULT_SAMPLE_PCT) / 100)));
}

/**
 * Record what the checker found. There is no pass/fail box: the result is
 * shown as it will be worked out, and the server works it out again.
 */
function CheckModal({ row, onClose, onSaved }) {
  const panels = (row.style?.components ?? []).map((c) => ({ name: c.name }));
  const [sampleQty, setSampleQty] = useState(() =>
    String(row.sampleQty != null ? Number(row.sampleQty) : suggestedSample(row.pcsReceived)),
  );
  const [acceptLimitPct, setAcceptLimitPct] = useState(() =>
    String(row.acceptLimitPct != null ? Number(row.acceptLimitPct) : DEFAULT_ACCEPT_LIMIT_PCT),
  );
  const [defects, setDefects] = useState(() =>
    (row.defects ?? []).map((d) => ({ panel: d.panel ?? '', defectType: d.defectType, qty: String(Number(d.qty)) })),
  );
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setLine = (i, patch) => setDefects((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const lines = defects.filter((d) => Number(d.qty) > 0);
  const defective = lines.reduce((a, d) => a + Number(d.qty), 0);
  const sample = Number(sampleQty) || 0;
  const rate = sample > 0 ? (defective / sample) * 100 : 0;
  const passes = rate <= Number(acceptLimitPct || 0);
  const problem =
    sample <= 0
      ? 'Enter how many pieces were checked.'
      : sample > Number(row.pcsReceived)
        ? `Only ${fmtNum(row.pcsReceived)} pieces were received.`
        : defective > sample
          ? 'More defective pieces than pieces checked.'
          : lines.some((d) => !d.defectType)
            ? 'Choose the defect on every line.'
            : '';

  async function save() {
    setBusy(true);
    setError('');
    try {
      const saved = await cprApi.recordCheck(row.id, {
        sampleQty: String(sample),
        acceptLimitPct: String(acceptLimitPct || 0),
        defects: lines.map((d) => ({ panel: d.panel || null, defectType: d.defectType, qty: String(d.qty) })),
        remarks: remarks || null,
      });
      onSaved(saved);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Sample check - ${row.receiptNo}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={Boolean(problem) || busy} onClick={save}>
            {busy ? 'Saving…' : 'Save check'}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <p className="hint" style={{ marginTop: 0 }}>
        Open {fmtNum(suggestedSample(row.pcsReceived))} pieces ({DEFAULT_SAMPLE_PCT}%) at random from the{' '}
        {fmtNum(row.pcsReceived)} received. Check every panel and add a line for each defect you find.
      </p>

      <div className="form-grid">
        <Field label="Pieces checked" required>
          <TextInput type="number" min="1" step="1" value={sampleQty} onChange={(e) => setSampleQty(e.target.value)} />
        </Field>
        <Field label="Accept limit %" hint="Over this defect rate the whole lot fails.">
          <TextInput
            type="number"
            min="0"
            step="0.1"
            value={acceptLimitPct}
            onChange={(e) => setAcceptLimitPct(e.target.value)}
          />
        </Field>
      </div>

      <h4 style={{ margin: '16px 0 8px' }}>Defects found</h4>
      {defects.length === 0 && (
        <p className="hint">No defects? Leave this empty if every piece checked was fine.</p>
      )}
      {defects.map((d, i) => (
        <div key={i} className="form-grid" style={{ alignItems: 'end' }}>
          <Field label="Panel">
            {panels.length ? (
              <RecordSelect
                value={d.panel}
                onChange={(e) => setLine(i, { panel: e.target.value })}
                options={panels}
                getValue={(p) => p.name}
                getLabel={(p) => p.name}
                placeholder="Whole piece"
              />
            ) : (
              <TextInput
                value={d.panel}
                onChange={(e) => setLine(i, { panel: e.target.value })}
                placeholder="Front, back, handle..."
                maxLength={80}
              />
            )}
          </Field>
          <Field label="Defect" required>
            <MasterSelect
              listCode="CutPieceDefect"
              value={d.defectType}
              currentValue={d.defectType}
              onChange={(e) => setLine(i, { defectType: e.target.value })}
            />
          </Field>
          <Field label="Pieces">
            <TextInput type="number" min="1" step="1" value={d.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
          </Field>
          <div style={{ paddingBottom: 6 }}>
            <button type="button" className="btn" onClick={() => setDefects((ls) => ls.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => setDefects((ls) => [...ls, { panel: '', defectType: '', qty: '' }])}
      >
        Add defect
      </button>

      <Field label="Remarks">
        <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>

      {problem ? (
        <Alert kind="warning">{problem}</Alert>
      ) : (
        <Alert kind={passes ? 'success' : 'error'}>
          {fmtNum(defective)} defective in {fmtNum(sample)} checked = {rate.toFixed(1)}%.{' '}
          {passes
            ? `Passes. ${fmtNum(Number(row.pcsReceived) - defective)} pieces will be ready for stitching.`
            : `Over the ${acceptLimitPct}% limit - the whole lot will be held until it is sorted and checked again.`}
        </Alert>
      )}
    </Modal>
  );
}

// ===========================================================================
//  CREATE / EDIT
// ===========================================================================

function ReceiptModal({ existing, onClose, onSaved }) {
  const editing = Boolean(existing);

  const [orderOptions, setOrderOptions] = useState([]);
  const [challanOptions, setChallanOptions] = useState([]);
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [nextNo, setNextNo] = useState('');

  const [form, setForm] = useState(() => ({
    receiptDate: existing ? toDateInput(existing.receiptDate) : todayInput(),
    orderId: existing?.orderId ?? '',
    cuttingChallanId: existing?.cuttingChallanId ?? '',
    cuttingMasterId: existing?.cuttingMasterId ?? '',
    cuttingMasterName: existing?.cuttingMasterId ? '' : (existing?.cuttingMasterName ?? ''),
    colorCode: existing?.colorCode ?? '',
    lotNo: existing?.lotNo ?? '',
    pcsReceived: existing ? String(existing.pcsReceived) : '',
    pcsRejected: existing ? String(existing.pcsRejected) : '',
    handlesReceived: existing ? String(existing.handlesReceived) : '',
    remarks: existing?.remarks ?? '',
    // C6 - the fabric the pieces were cut from. Blank on a new receipt; a
    // zero on a saved one reads as blank, so a receipt with no fabric stays so.
    fabricIssueId: existing?.fabricIssueId ?? '',
    ...Object.fromEntries(
      FABRIC_FIELDS.map(([k]) => [k, existing && Number(existing[k]) > 0 ? String(existing[k]) : '']),
    ),
  }));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /** Once posted, the ledger already says where the cloth went: read-only. */
  const fabricPosted = Boolean(existing?.stockPostedAt);
  const [fabricIssues, setFabricIssues] = useState([]);

  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /*
   * The style the pieces belong to - the challan's if one is chosen, else the
   * order's - and its panel list. Where it has one, the handle count is worked
   * out from the good pieces and is not typed.
   */
  const chosenChallan = challanOptions.find((c) => c.id === form.cuttingChallanId);
  const chosenOrder = orderOptions.find((o) => o.id === form.orderId);
  const styleId = chosenChallan?.styleId ?? chosenChallan?.style?.id ?? chosenOrder?.styleId
    ?? chosenOrder?.style?.id ?? existing?.styleId ?? null;
  const [perBag, setPerBag] = useState(null);
  useEffect(() => {
    if (!styleId) {
      setPerBag(null);
      return;
    }
    stylesApi
      .get(styleId)
      .then((st) => setPerBag(st?.panelsPerBag ?? null))
      .catch(() => setPerBag(null));
  }, [styleId]);
  const derivedHandles = perBag ? Number(form.pcsReceived || 0) * perBag.handlesPerBag : null;

  useEffect(() => {
    ordersApi
      .options()
      .then((opts) => {
        // An order that has since completed still has to show on its own receipt.
        if (existing?.order && !opts.some((o) => o.id === existing.orderId)) {
          opts = [existing.order, ...opts];
        }
        setOrderOptions(opts);
      })
      .catch(loadFailed(setOrderOptions, 'orders'));
    employeesApi.options().then(setEmployeeOptions).catch(loadFailed(setEmployeeOptions, 'employees'));
    if (!editing) cprApi.nextNumber().then((r) => setNextNo(r?.receiptNo ?? '')).catch(() => {});
  }, [editing, existing]);

  // The challans of the chosen order, and its pieces-in-hand so far.
  useEffect(() => {
    if (!form.orderId) {
      setChallanOptions([]);
      setSummary(null);
      return;
    }
    ccApi
      .list({ orderId: form.orderId, pageSize: 100 })
      .then((r) => setChallanOptions(rowsOf(r).filter((c) => c.status !== 'CANCELLED')))
      .catch(loadFailed(setChallanOptions, 'cutting challans'));
    cprApi
      .summary({ orderId: form.orderId })
      .then(setSummary)
      .catch(() => setSummary(null));
    // The fabric issued to the cutting floor for this order - posted only,
    // since an unposted issue put no cloth there.
    fiApi
      .list({ orderId: form.orderId, purpose: 'CUTTING', pageSize: 100 })
      .then((r) => setFabricIssues(rowsOf(r).filter((i) => i.posted || i.postedAt)))
      .catch(() => setFabricIssues([]));
  }, [form.orderId]);

  /*
   * C6 - the equation, checked live so the cutting master sees it balance
   * before saving. The server checks it again, and a CHECK constraint under
   * that; this is the courtesy, not the control.
   */
  const fabric = (() => {
    const n = (k) => Number(form[k] || 0);
    const issued = n('issuedQty');
    const accounted = FABRIC_FIELDS.slice(1).reduce((a, [k]) => a + n(k), 0);
    const difference = Number((issued - accounted).toFixed(4));
    const entered = FABRIC_FIELDS.some(([k]) => form[k] !== '');
    return {
      entered,
      issued,
      difference,
      balances: issued > 0 && difference === 0,
      // Blank is fine; anything entered must balance and name its fabric issue.
      ok: !entered || (issued > 0 && difference === 0 && Boolean(form.fabricIssueId)),
    };
  })();

  const hasCount = [form.pcsReceived, form.pcsRejected, perBag ? derivedHandles : form.handlesReceived]
    .some((v) => Number(v) > 0);
  const hasMaster = Boolean(form.cuttingMasterId || form.cuttingMasterName.trim());
  const ready = form.orderId && hasMaster && hasCount && form.pcsReceived !== '' &&
    (fabricPosted || fabric.ok);

  async function save() {
    setBusy(true);
    setError('');
    const body = {
      receiptDate: form.receiptDate,
      orderId: form.orderId,
      cuttingChallanId: form.cuttingChallanId || null,
      cuttingMasterId: form.cuttingMasterId || null,
      cuttingMasterName: form.cuttingMasterId ? undefined : form.cuttingMasterName.trim(),
      colorCode: form.colorCode || null,
      lotNo: form.lotNo || null,
      pcsReceived: String(form.pcsReceived || 0),
      pcsRejected: String(form.pcsRejected || 0),
      handlesReceived: String(form.handlesReceived || 0),
      remarks: form.remarks || null,
      // Posted fabric is not sent at all - the server would refuse a change.
      ...(fabricPosted || !fabric.entered
        ? {}
        : {
            fabricIssueId: form.fabricIssueId || null,
            ...Object.fromEntries(FABRIC_FIELDS.map(([k]) => [k, String(form[k] || 0)])),
          }),
    };
    try {
      const saved = editing ? await cprApi.update(existing.id, body) : await cprApi.create(body);
      onSaved(saved);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? `Edit ${existing.receiptNo}` : 'Receive cut pieces from cutting'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={save}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Save receipt'}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {!editing && nextNo && <p className="hint" style={{ marginTop: 0 }}>This receipt will be numbered <strong>{nextNo}</strong>.</p>}

      <div className="form-grid">
        <Field label="Order" required>
          <RecordSelect
            value={form.orderId}
            onChange={(e) => {
              const o = orderOptions.find((x) => x.id === e.target.value);
              set({
                orderId: e.target.value,
                cuttingChallanId: '',
                colorCode: form.colorCode || o?.colorCode || '',
              });
            }}
            options={orderOptions}
            getValue={(o) => o.id}
            getLabel={(o) => `${o.orderNo}${o.buyer?.buyerName ? ` - ${o.buyer.buyerName}` : ''}`}
          />
        </Field>

        <Field
          label="Cutting challan"
          hint={
            !form.orderId
              ? 'Choose an order first.'
              : challanOptions.length === 0
                ? 'This order has no cutting challan - you can still save the receipt.'
                : 'The challan these pieces were cut against.'
          }
        >
          <RecordSelect
            value={form.cuttingChallanId}
            onChange={(e) => set({ cuttingChallanId: e.target.value })}
            options={challanOptions}
            disabled={!form.orderId}
            placeholder={form.orderId ? 'Select a challan (optional)' : 'Choose an order first'}
            emptyLabel={form.orderId ? 'No challan for this order' : 'Choose an order first'}
            getValue={(c) => c.id}
            getLabel={(c) => `${c.challanNo} - ${fmtDate(c.challanDate)}`}
          />
        </Field>

        <Field label="Receipt date" required>
          <TextInput type="date" value={form.receiptDate} onChange={(e) => set({ receiptDate: e.target.value })} />
        </Field>

        <Field label="Cutting master" required hint="Who handed the pieces over. Pick from Employees, or type a name below.">
          <RecordSelect
            value={form.cuttingMasterId}
            onChange={(e) => set({ cuttingMasterId: e.target.value, cuttingMasterName: '' })}
            options={employeeOptions}
            getValue={(emp) => emp.id}
            getLabel={(emp) => `${emp.empName}${emp.department ? ` (${emp.department})` : ''}`}
            placeholder="Select employee..."
          />
        </Field>

        {!form.cuttingMasterId && (
          <Field label="...or type the name">
            <TextInput
              value={form.cuttingMasterName}
              onChange={(e) => set({ cuttingMasterName: e.target.value })}
              placeholder="Cutting master's name"
              maxLength={120}
            />
          </Field>
        )}

        <Field label="Colour">
          <TextInput value={form.colorCode} onChange={(e) => set({ colorCode: e.target.value })} maxLength={60} />
        </Field>

        <Field label="Lot / bundle No">
          <TextInput value={form.lotNo} onChange={(e) => set({ lotNo: e.target.value })} maxLength={40} />
        </Field>

        <Field label="Good pieces received" required>
          <TextInput
            type="number"
            min="0"
            step="1"
            value={form.pcsReceived}
            onChange={(e) => set({ pcsReceived: e.target.value })}
            placeholder="0"
          />
        </Field>

        <Field label="Rejected pieces" hint="Cut badly or damaged - counted, not usable.">
          <TextInput
            type="number"
            min="0"
            step="1"
            value={form.pcsRejected}
            onChange={(e) => set({ pcsRejected: e.target.value })}
            placeholder="0"
          />
        </Field>

        {perBag ? (
          <Field
            label="Handles received"
            hint={`${perBag.handlesPerBag} per bag from the style's panel list, so ` +
              `${fmtNum(Number(form.pcsReceived || 0) * perBag.panelsPerBag)} panels in all.`}
          >
            <TextInput value={fmtNum(derivedHandles)} readOnly disabled />
          </Field>
        ) : (
          <Field label="Handles received" hint="The style has no panel list, so count the handles.">
            <TextInput
              type="number"
              min="0"
              step="1"
              value={form.handlesReceived}
              onChange={(e) => set({ handlesReceived: e.target.value })}
              placeholder="0"
            />
          </Field>
        )}

        <Field label="Remarks" className="span-2">
          <TextArea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
        </Field>
      </div>

      {/* --- C6: the fabric these pieces were cut from ----------------------
          Everything that came onto the cutting floor has to be accounted for:
          cut into panels, put back on the rack, kept as remnants, or thrown
          away. Saving takes it off the cutting floor in the stock ledger. */}
      <div className="fieldset-title">Fabric used for these pieces</div>
      {fabricPosted ? (
        <Alert kind="info">
          This receipt&apos;s fabric has already been taken off the cutting floor in the stock
          ledger, so it cannot be changed here. The piece counts above can still be corrected.
        </Alert>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            Leave blank if this lot&apos;s cloth is being accounted for on another receipt of the
            same cut.
          </p>
          <div className="form-grid">
            <Field
              label="Fabric issue"
              required={fabric.entered}
              hint={
                !form.orderId
                  ? 'Choose an order first.'
                  : fabricIssues.length === 0
                    ? 'No posted fabric issue to the cutting floor for this order.'
                    : 'The issue that put this cloth on the cutting floor.'
              }
            >
              <RecordSelect
                value={form.fabricIssueId}
                onChange={(e) => set({ fabricIssueId: e.target.value })}
                options={fabricIssues}
                disabled={!form.orderId}
                placeholder="Select the fabric issue..."
                getValue={(i) => i.id}
                getLabel={(i) =>
                  `${i.issueNo} - roll ${i.roll?.rollNo ?? '?'} - ${fmtNum(i.fabricQtyIssued)} ${i.uom ?? ''}`
                }
              />
            </Field>
            {FABRIC_FIELDS.map(([k, label, hint]) => (
              <Field key={k} label={label} hint={hint} required={k === 'issuedQty' && fabric.entered}>
                <TextInput
                  type="number"
                  min="0"
                  step="0.0001"
                  value={form[k]}
                  onChange={(e) => set({ [k]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          {fabric.entered && (
            <Alert kind={fabric.balances ? 'success' : 'error'}>
              {fabric.balances
                ? `Reconciles: ${fmtNum(fabric.issued)} received is fully accounted for.`
                : fabric.issued <= 0
                  ? 'Enter the fabric received on the floor - the other figures are parts of it.'
                  : `Does not reconcile: ${fmtNum(Math.abs(fabric.difference))} ` +
                    `${fabric.difference > 0 ? 'unaccounted for - enter the wastage' : 'more than was received'}.`}
              {fabric.balances && !form.fabricIssueId && ' Choose the fabric issue it came from.'}
            </Alert>
          )}
        </>
      )}

      {summary && (
        <p className="hint">
          So far for this order: <strong>{fmtNum(summary.pcsReceived)}</strong> good pieces received,{' '}
          <strong>{fmtNum(summary.pcsIssuedToStitching)}</strong> issued to stitching,{' '}
          <strong>{fmtNum(summary.pcsInHand)}</strong> in hand
          {editing ? ' (including this receipt as it was saved).' : '.'}{' '}
          {editing
            ? 'Changing the good pieces clears the sample check - the lot will need checking again.'
            : 'The pieces go to stitching only after a sample check on this receipt.'}
        </p>
      )}
    </Modal>
  );
}
