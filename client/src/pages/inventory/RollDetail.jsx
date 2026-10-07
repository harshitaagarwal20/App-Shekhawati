/**
 * Fabric roll detail — the traceability screen.
 *
 * ---------------------------------------------------------------------------
 *  A ROLL REMEMBERS WHERE IT CAME FROM
 *
 *      roll → GRN → vendor → PO → buyer order
 *           → fabric characteristics
 *           → current location and stage
 *           → every movement it has ever been part of
 *
 *  The chain spans six tables. It is assembled on the server, in one call, so
 *  this screen renders it rather than joining it - six round trips would be six
 *  chances to join it differently.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { inventory as invApi } from '../../services/erp.js';
import {
  Alert,
  Field,
  MasterSelect,
  Modal,
  PageHeader,
  Spinner,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import { Detail, DetailGrid, TraceChain } from '../shared/Detail.jsx';
import { fmtDate, fmtEnum, fmtNum } from '../../utils/format.js';
import TableWrap from '../../components/TableWrap.jsx';

export default function RollDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [relocating, setRelocating] = useState(false);
  const [grading, setGrading] = useState(false);
  const [reversing, setReversing] = useState(false);

  const canRelocate = can('FABRIC_ROLL.EDIT');
  const canReverseOpeningBalance = can('FABRIC_ROLL.CREATE');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await invApi.roll(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading roll..." />
        </div>
      </div>
    );
  }
  if (!data) return <Alert kind="error">{banner?.text ?? 'Roll not found'}</Alert>;

  const { roll, chain, movements } = data;

  /*
   * A reversible opening balance, worked out from what is already on the
   * page rather than a flag the server would otherwise have to add: exactly
   * one movement, and that movement is the OPENING_BALANCE receipt itself.
   * The service re-checks every one of these conditions itself under a lock
   * before it writes anything - this is only what decides whether the button
   * is worth offering.
   */
  const isUnreversedOpeningBalance =
    movements.length === 1 && movements[0].documentType === 'OPENING_BALANCE' && movements[0].direction === 'IN';

  return (
    <>
      <PageHeader
        title={`Roll ${roll.rollNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/inventory/rolls')}>
              Back to rolls
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => navigate(`/inventory/stock/ledger?rollId=${roll.id}`)}
            >
              Movements for this roll
            </button>
            {canRelocate && !roll.isHeld && (
              <button type="button" className="btn" onClick={() => setRelocating(true)}>
                Move location
              </button>
            )}
            {canRelocate && (
              <button type="button" className="btn" onClick={() => setGrading(true)}>
                Grade shade
              </button>
            )}
            {canReverseOpeningBalance && !roll.isHeld && isUnreversedOpeningBalance && (
              <button type="button" className="btn btn-danger" onClick={() => setReversing(true)}>
                Reverse opening balance
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

      {roll.isHeld && (
        <Alert kind="error">
          <strong>This roll is held.</strong> {roll.remarks ?? 'It cannot be issued until the hold is lifted.'}
        </Alert>
      )}

      {/* The chain the brief asks a roll to retain, link by link. */}
      <TraceChain
        title="Where this roll came from"
        chain={chain.breadcrumb.join(' ← ')}
        complete={chain.complete}
        incompleteNote={
          !chain.complete
            ? 'This roll is not linked all the way back to a buyer order. Rolls seeded from the workbook sometimes are not — the sheet did not record it.'
            : null
        }
        links={[
          chain.order && {
            label: 'Buyer Order',
            value: chain.order.orderNo,
            sub: `${chain.order.buyerName ?? ''} · ${chain.order.styleNo ?? ''}`,
            to: `/orders/${chain.order.id}`,
          },
          chain.quotation && { label: 'Quotation', value: chain.quotation.quotationNo },
          chain.purchaseOrder && {
            label: 'Purchase Order',
            value: chain.purchaseOrder.poId,
            sub: chain.purchaseOrder.approvalStatus?.toLowerCase(),
            to: `/purchase-orders/${chain.purchaseOrder.id}`,
          },
          chain.vendor && { label: 'Vendor', value: chain.vendor.vendorName, sub: chain.vendor.category },
          chain.grn && {
            label: 'GRN',
            value: chain.grn.grnNo,
            sub: `bill ${chain.grn.billNo}`,
            to: `/grns/${chain.grn.id}`,
          },
          { label: 'Roll', value: roll.rollNo, sub: fmtEnum(roll.stage), current: true },
        ].filter(Boolean)}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Roll</div>
        <div className="card-body">
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Fabric characteristics</div>
        <div className="card-body">
          <DetailGrid>
            <Detail label="Roll No" value={roll.rollNo} mono />
            <Detail label="Fabric name" value={chain.characteristics.fabricName} />
            <Detail label="Colour" value={chain.characteristics.colorCode} />
            <Detail label="Content" value={chain.characteristics.content} />
            <Detail label="Count" value={chain.characteristics.count} />
            <Detail label="Construction" value={chain.characteristics.construction} />
            <Detail
              label="Width"
              value={chain.characteristics.width ? fmtNum(chain.characteristics.width) : null}
            />
            <Detail label="GSM" value={chain.characteristics.gsm} />
            <Detail label="UOM" value={chain.characteristics.uom} />
            <Detail label="Rate" value={roll.rate ? fmtNum(roll.rate, { decimals: 4 }) : null} />
            <Detail
              label="Stock item"
              value={roll.inventoryItem?.itemCode}
              sub={roll.inventoryItem?.description}
              mono
            />
            <Detail label="Location" value={roll.location} />
            <Detail
              label="Shade"
              value={roll.shade}
              sub={roll.shadeMarkedByName ? `graded by ${roll.shadeMarkedByName} ${fmtDate(roll.shadeMarkedAt)}` : undefined}
              mono
            />
            <Detail label="Dye lot" value={roll.dyeLot} mono />
            {roll.remarks && <Detail label="Remarks" value={roll.remarks} className="span-2" />}
          </DetailGrid>
        </div>
      </div>

      {/* --- Issue history ------------------------------------------------ */}
      <div className="card">
        <div className="card-header">
          <span>Issue history</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            every movement this roll has been part of
          </span>
        </div>
        {movements.length === 0 ? (
          <div className="card-body muted">
            Nothing has moved against this roll since it was received.
          </div>
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Location</th>
                  <th className="num">In</th>
                  <th className="num">Out</th>
                  <th className="num">Balance after</th>
                  <th>User</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{fmtDate(m.entryDate)}</td>
                    <td>
                      <div>{fmtEnum(m.documentType)}</div>
                      <div className="code faint">{m.documentNo}</div>
                    </td>
                    <td>{m.location}</td>
                    <td className="num">{Number(m.qtyIn) > 0 ? fmtNum(m.qtyIn) : '-'}</td>
                    <td className="num">{Number(m.qtyOut) > 0 ? fmtNum(m.qtyOut) : '-'}</td>
                    <td className="num">{fmtNum(m.balanceQty)}</td>
                    <td>{m.createdByName ?? '-'}</td>
                    <td className="muted">{m.remarks ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>

      {grading && (
        <ShadeDialog
          roll={roll}
          onCancel={() => setGrading(false)}
          onDone={async (message) => {
            setGrading(false);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}

      {relocating && (
        <RelocateDialog
          roll={roll}
          onCancel={() => setRelocating(false)}
          onDone={async (message) => {
            setRelocating(false);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}

      {reversing && (
        <ReverseOpeningBalanceDialog
          roll={roll}
          onCancel={() => setReversing(false)}
          onDone={async (message) => {
            setReversing(false);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}
    </>
  );
}

/**
 * Grading a roll's shade band and dye lot. The server refuses once the roll has
 * been issued for cutting: it was cut as whatever it was graded then.
 */
function ShadeDialog({ roll, onCancel, onDone }) {
  const [shade, setShade] = useState(roll.shade ?? '');
  const [dyeLot, setDyeLot] = useState(roll.dyeLot ?? '');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      await invApi.markRollShade(roll.id, { shade, dyeLot, remarks: remarks || undefined });
      onDone(`${roll.rollNo} graded${shade ? ` shade ${shade.toUpperCase()}` : ''}${dyeLot ? `, lot ${dyeLot.toUpperCase()}` : ''}.`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Grade ${roll.rollNo}`}
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={go} disabled={busy}>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>
        <p style={{ marginTop: 0 }}>
          Panels of one bag must come from one shade and dye lot. A cutting line started on one
          shade refuses a roll of another unless a reason is given.
        </p>
        <Field label="Shade band" hint='e.g. "A", "B", "S1". Leave blank if not graded.'>
          <TextInput value={shade} maxLength={20} onChange={(e) => setShade(e.target.value)} />
        </Field>
        <Field label="Dye lot" hint="The dye house's batch number.">
          <TextInput value={dyeLot} maxLength={40} onChange={(e) => setDyeLot(e.target.value)} />
        </Field>
        <Field label="How it was judged">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** Moving a roll between store locations. The stock does not move, the shelf does. */
function RelocateDialog({ roll, onCancel, onDone }) {
  const [location, setLocation] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      await invApi.relocateRoll(roll.id, { location, remarks: remarks || undefined });
      onDone(`${roll.rollNo} moved to ${location}.`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Move ${roll.rollNo}`}
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={go} disabled={busy || !location}>
            {busy ? 'Moving...' : 'Move'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>
        <p style={{ marginTop: 0 }}>
          This records where the roll physically sits. It does not move stock between locations in
          the ledger — that only happens when a document moves it.
        </p>
        <Field label="New location" required>
          <MasterSelect
            listCode="StockLocation"
            value={location}
            currentValue={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={`Currently ${roll.location ?? 'unrecorded'}`}
          />
        </Field>
        <Field label="Remarks">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Takes one wrongly-loaded opening balance roll back out.
 *
 * A reason is required, not optional: this is the one write in the
 * application that undoes a roll rather than moving it, and the ledger entry
 * it posts carries that reason forward as the only explanation anyone
 * reading the stock register later will have for why the cloth that was "on
 * the rack at go-live" no longer is.
 */
function ReverseOpeningBalanceDialog({ roll, onCancel, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      await invApi.reverseOpeningBalance(roll.id, { reason });
      onDone(`${roll.rollNo} reversed - ${fmtNum(roll.balanceQty)} ${roll.uom} taken back out.`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Reverse opening balance ${roll.rollNo}?`}
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={go}
            disabled={busy || !reason.trim()}
          >
            {busy ? 'Reversing...' : 'Reverse'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>
        <p style={{ marginTop: 0 }}>
          This takes {fmtNum(roll.balanceQty)} {roll.uom} of {roll.rollNo} back out and writes the
          roll off. It only works while nothing has been issued against it yet, and it cannot be
          undone - the fabric type and colour will be free to load an opening balance for again
          afterwards.
        </p>
        <Field label="Reason" required hint="Why this roll should not have been loaded.">
          <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
