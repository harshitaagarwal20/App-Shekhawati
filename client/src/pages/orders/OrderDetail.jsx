/**
 * Buyer Order detail: header, the server-calculated material requirement, the
 * excess decision, procurement raised so far, and the approval / amendment
 * trail.
 *
 * Every number rendered here arrives from the API already calculated.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { orders as ordersApi } from '../../services/erp.js';
import {
  Alert,
  ConfirmDialog,
  Field,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import OrderForm from './OrderForm.jsx';
import { fmtDate, fmtDateTime, fmtPctFromFraction } from '../../utils/format.js';
import TableWrap from '../../components/TableWrap.jsx';


const fmtQty = (v) => (v === null || v === undefined ? '-' : Number(v).toLocaleString());
const fmtMoney = (v, currency) =>
  v === null || v === undefined || v === ''
    ? null
    : `${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amending, setAmending] = useState(false);
  const [deciding, setDeciding] = useState(null); // 'approve' | 'reject'
  const [deleting, setDeleting] = useState(false);
  const [pricing, setPricing] = useState(false);

  const canEdit = can('BUYER_ORDER.EDIT');
  // F-10: the permission says what this ROLE may do; `canApprove` from the
  // server says whether THIS user may approve THIS document - it is false
  // when they raised it themselves. Both must hold, or the button would be
  // offered and then refused with a 403.
  const canApprove = can('BUYER_ORDER.APPROVE') && order?.canApprove !== false;
  const canDelete = can('BUYER_ORDER.DELETE');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrder(await ordersApi.get(id));
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function doDelete() {
    setBusy(true);
    try {
      await ordersApi.remove(id);
      navigate('/orders', { replace: true });
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(false);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !order) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Loading order..." />
        </div>
      </div>
    );
  }
  if (!order) return <Alert kind="error">{banner?.text ?? 'Order not found'}</Alert>;

  const { requirement, procurement, usage, editable, approvals, amendments } = order;
  const excessPending = order.excessApprovalStatus === 'PENDING';

  return (
    <>
      <PageHeader
        title={`Order ${order.orderNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/orders')}>
              Back to list
            </button>
            {canEdit && editable.canEditDetails && !editable.requiresAmendment && (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {canEdit && editable.requiresAmendment && order.status !== 'CANCELLED' && (
              <button type="button" className="btn" onClick={() => setAmending(true)}>
                Amend
              </button>
            )}
            {canDelete && usage.total === 0 && (
              <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>
                Delete
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

      {excessPending && (
        <Alert kind="warning">
          An excess of <strong>{fmtPctFromFraction(order.excessPct)}</strong> is awaiting the Director. Until it
          is approved this order may produce only its plain quantity of{' '}
          <strong>{fmtQty(order.orderQty)}</strong> pieces.
          {canApprove && (
            <span className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setDeciding('approve')}>
                Approve excess
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeciding('reject')}>
                Reject excess
              </button>
            </span>
          )}
          {/*
            WHY THE BUTTONS ARE MISSING, SAID OUT LOUD.

            An approver who is also the maker had the buttons silently removed
            and was left with a banner saying the excess "is awaiting the
            Director" - which they ARE. The screen looked broken, because
            nothing on it distinguished "you may not do this" from "this
            feature is missing".

            The server already sends the sentence (`approvalBlockedReason`,
            see utils/approvability.js); it was simply never rendered here.
            The permission check is repeated rather than reusing `canApprove`,
            because that flag folds two different situations into one: a
            merchandiser who may never approve needs no explanation, while an
            approver blocked by maker-checker does.
          */}
          {can('BUYER_ORDER.APPROVE') && order.canApprove === false && order.approvalBlockedReason && (
            <div className="muted" style={{ marginTop: 8 }}>{order.approvalBlockedReason}</div>
          )}
        </Alert>
      )}

      {order.excessApprovalStatus === 'REJECTED' && (
        <Alert kind="error">
          The excess request was rejected: {order.excessRejectionReason}
        </Alert>
      )}

      {/* --- Order details ------------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Order</div>
        <div className="card-body">
          <div className="form-grid">
            <Detail label="Order No" value={order.orderNo} mono />
            <Detail label="Order Date" value={fmtDate(order.orderDate)} />
            <Detail label="Buyer Delivery Date" value={fmtDate(order.buyerDeliveryDate)} />
            <Detail label="Buyer" value={`${order.buyer?.buyerName} (${order.buyer?.buyerCode})`} />
            <Detail label="Style No" value={order.style?.styleNo} mono />
            <Detail label="Item Description" value={order.itemDescription} />
            <Detail label="Color Code" value={order.colorCode} />
            <Detail label="Size Group" value={order.sizeGroup} />
            <Detail label="Currency" value={order.currency} />
            <Detail label="Ship Mode" value={order.shipMode} />
            <Detail label="Container No" value={order.containerNo} mono />
            <Detail label="Bill To" value={order.billTo} className="span-2" />
            <Detail label="Ship To" value={order.shipTo} className="span-2" />
            {order.excessJustification && (
              <Detail label="Excess Justification" value={order.excessJustification} className="span-2" />
            )}
            {order.remarks && <Detail label="Remarks" value={order.remarks} className="span-2" />}
          </div>

          {!editable.canEditStructural && usage.total > 0 && (
            <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>
              Quantity, style, buyer, colour, size group and excess are locked: this order already
              has {editable.lockedBy.join(', ')}. Use <strong>Amend</strong> to change them with a
              recorded reason.
            </p>
          )}
        </div>
      </div>

      {/* --- Commercial ---------------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Commercial</span>
          {canEdit && order.status !== 'CANCELLED' && (
            <button type="button" className="btn btn-sm" onClick={() => setPricing(true)}>
              Edit prices &amp; terms
            </button>
          )}
        </div>
        <div className="card-body">
          <div className="form-grid">
            <Detail label="Buyer PO No" value={order.buyerPoNo} mono />
            <Detail label="Buyer PO Date" value={fmtDate(order.buyerPoDate)} />
            <Detail label="Ex-Factory Date" value={fmtDate(order.exFactoryDate)} />
            <Detail label="Price Terms" value={order.priceTerms} />
            <Detail label="Payment Terms" value={order.paymentTerms} />
            <Detail
              label="Exchange Rate"
              value={order.exchangeRate ? `${Number(order.exchangeRate)} INR / ${order.currency ?? 'unit'}` : null}
            />
            <Detail
              label="Order Value"
              value={
                fmtMoney(order.orderValue, order.currency) ??
                (order.pricePending ? 'Not every line is priced yet' : null)
              }
            />
            <Detail label="Order Value (INR)" value={fmtMoney(order.orderValueInr, 'INR')} />
          </div>
        </div>
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Style</th>
                <th>Colour</th>
                <th className="num">Order qty</th>
                <th className="num">Unit price</th>
                <th className="num">Line value</th>
                <th className="num">Costed FOB</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {(order.lines ?? []).map((l) => (
                <tr key={l.id}>
                  <td>{l.lineNo}</td>
                  <td className="mono">{l.style?.styleNo}</td>
                  <td>{l.colorCode ?? '-'}</td>
                  <td className="num">{fmtQty(l.orderQty)}</td>
                  <td className="num">{l.unitPrice != null ? Number(l.unitPrice).toFixed(4) : <span className="faint">unpriced</span>}</td>
                  <td className="num">{fmtMoney(l.lineValue) ?? '-'}</td>
                  <LineCosting costing={(order.costing ?? []).find((c) => c.lineId === l.id)} />
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>

      {/* --- Requirement -------------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Material requirement</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            from the Style BOM · calculated by the server
          </span>
        </div>
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Material</th>
                <th>UOM</th>
                <th className="num">Qty / Pc</th>
                <th className="num">Wastage</th>
                <th className="num">For order qty</th>
                <th className="num">For effective qty</th>
                <th>HSN</th>
              </tr>
            </thead>
            <tbody>
              {requirement.lines.map((l) => (
                <tr key={l.lineNo}>
                  <td>
                    {[l.itemCategory, l.subCategory, l.accessoriesItem].filter(Boolean).join(' / ')}
                    {l.description && <div className="faint">{l.description}</div>}
                  </td>
                  <td>{l.uom}</td>
                  <td className="num">{Number(l.qtyPerPc)}</td>
                  <td className="num">{(Number(l.wastagePct) * 100).toFixed(1)}%</td>
                  <td className="num">{fmtQty(l.withWastage)}</td>
                  <td className="num">
                    <strong>{fmtQty(l.withExcess)}</strong>
                  </td>
                  <td className="code">{l.hsnCode ?? '-'}</td>
                </tr>
              ))}
              {requirement.lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ padding: 20 }}>
                    This style has no BOM lines yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableWrap>
        <div className="pagination">
          <span>
            Fabric average {requirement.fabric.avgUtilizationPerPc} {requirement.fabric.uom}/pc &rarr;{' '}
            <strong>{fmtQty(requirement.fabric.forEffectiveQty)} {requirement.fabric.uom}</strong> for
            the effective quantity
          </span>
        </div>
      </div>

      {/* --- Procurement --------------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>Procurement against this order</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {procurement.count} purchase order(s)
          </span>
        </div>
        {procurement.count === 0 ? (
          <div className="card-body muted">Nothing has been purchased against this order yet.</div>
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>PO ID</th>
                  <th>Vendor</th>
                  <th>Item</th>
                  <th>UOM</th>
                  <th className="num">Ordered</th>
                  <th className="num">Received</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {procurement.purchaseOrders.map((po) => (
                  <tr key={po.id}>
                    <td className="code">{po.poId}</td>
                    <td>{po.vendor?.vendorName}</td>
                    <td>{[po.item, po.subCategory, po.accessoriesItem].filter(Boolean).join(' / ')}</td>
                    <td>{po.uom}</td>
                    <td className="num">{fmtQty(po.orderQty)}</td>
                    <td className="num">{fmtQty(po.receivedQty)}</td>
                    <td className="num">{Number(po.amount).toLocaleString()}</td>
                    <td>
                      <StatusBadge status={po.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={4}>Total</th>
                  <th className="num">{fmtQty(procurement.totalOrderedQty)}</th>
                  <th className="num">{fmtQty(procurement.totalReceivedQty)}</th>
                  <th className="num">{Number(procurement.totalValue).toLocaleString()}</th>
                  <th />
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </div>

      {/* --- The buyer's measurement sheet ---------------------------------- */}
      <MeasurementSheets orderId={id} canEdit={can('BUYER_ORDER.EDIT')} />

      {/* --- Trail --------------------------------------------------------- */}
      <div className="card">
        <div className="card-header">Approval &amp; amendment trail</div>
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>When</th>
                <th>Action</th>
                <th>From &rarr; To</th>
                <th>By</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((a) => (
                <tr key={a.id}>
                  <td className="faint">{a.sequenceNo}</td>
                  <td className="nowrap">{fmtDateTime(a.actedAt)}</td>
                  <td>{a.action.replace(/_/g, ' ')}</td>
                  <td className="muted">
                    {a.fromStatus ?? '-'} &rarr; {a.toStatus ?? '-'}
                  </td>
                  <td>{a.actedByName ?? '-'}</td>
                  <td className="muted">{a.remarks ?? '-'}</td>
                </tr>
              ))}
              {approvals.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ padding: 20 }}>
                    Nothing recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableWrap>
        {amendments.length > 0 && (
          <div className="card-body">
            <div className="fieldset-title">Amendments</div>
            {amendments.map((am) => (
              <div key={am.id} style={{ marginBottom: 10 }}>
                <strong>#{am.amendmentNo}</strong> &mdash; {fmtDateTime(am.amendedAt)}
                <div className="muted">{am.reason}</div>
                <div className="chip-list" style={{ marginTop: 4 }}>
                  {Object.entries(am.changes).map(([field, v]) => (
                    <span className="chip" key={field}>
                      {field}: {v.before || '-'} &rarr; {v.after || '-'}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <Modal title={`Edit order ${order.orderNo}`} size="wide" onClose={() => setEditing(false)}>
          <OrderForm
            order={order}
            onCancel={() => setEditing(false)}
            onSaved={async () => {
              setEditing(false);
              setBanner({ kind: 'success', text: 'Order saved.' });
              await load();
            }}
          />
        </Modal>
      )}

      {amending && (
        <AmendDialog
          order={order}
          onCancel={() => setAmending(false)}
          onDone={async (message) => {
            setAmending(false);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}

      {pricing && (
        <PricingDialog
          order={order}
          onCancel={() => setPricing(false)}
          onDone={async () => {
            setPricing(false);
            setBanner({ kind: 'success', text: 'Prices and terms saved.' });
            await load();
          }}
        />
      )}

      {deciding && (
        <ExcessDecisionDialog
          order={order}
          mode={deciding}
          onCancel={() => setDeciding(null)}
          onDone={async (message) => {
            setDeciding(null);
            setBanner({ kind: 'success', text: message });
            await load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete order"
          danger
          busy={busy}
          confirmLabel="Delete"
          message={`Delete order ${order.orderNo}? It is hidden rather than erased, and the order number is never reused.`}
          onConfirm={doDelete}
          onCancel={() => setDeleting(false)}
        />
      )}
    </>
  );
}

/**
 * A line's margin at its agreed price, against the style's APPROVED cost
 * sheet. Red when the order is priced below cost - said when the price is
 * agreed, not discovered at the year end.
 */
function LineCosting({ costing }) {
  if (!costing?.costSheet) {
    return (
      <>
        <td className="num faint">no approved sheet</td>
        <td />
      </>
    );
  }
  const m = costing.margin;
  const pct = m ? Number(m.marginPct) * 100 : null;
  return (
    <>
      <td className="num">
        <Link to={`/cost-sheets/${costing.costSheet.id}`}>
          {Number(costing.costSheet.fobPrice ?? 0).toFixed(4)} {costing.costSheet.currency}
        </Link>
      </td>
      <td className="num" style={pct !== null && pct < 0 ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>
        {pct === null ? '-' : `${pct.toFixed(1)}%`}
      </td>
    </>
  );
}

function Detail({ label, value, mono, className = '' }) {
  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      <div className={mono ? 'mono' : ''} style={{ paddingTop: 2 }}>
        {value || <span className="faint">-</span>}
      </div>
    </div>
  );
}

/**
 * Prices each line and sets the commercial terms. Open after the order's
 * structure has locked, because a price does not change what is cut or bought.
 * The values are the server's: only prices and terms are sent.
 */
function PricingDialog({ order, onCancel, onDone }) {
  const [prices, setPrices] = useState(() =>
    Object.fromEntries((order.lines ?? []).map((l) => [l.id, l.unitPrice != null ? String(Number(l.unitPrice)) : ''])),
  );
  const asInput = (v) => (v ? String(v).slice(0, 10) : '');
  const [terms, setTerms] = useState({
    buyerPoNo: order.buyerPoNo ?? '',
    buyerPoDate: asInput(order.buyerPoDate),
    exFactoryDate: asInput(order.exFactoryDate),
    priceTerms: order.priceTerms ?? '',
    paymentTerms: order.paymentTerms ?? '',
    exchangeRate: order.exchangeRate != null ? String(Number(order.exchangeRate)) : '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setTerms((t) => ({ ...t, [k]: e.target.value }));
  const isInr = String(order.currency ?? '').toUpperCase() === 'INR';

  const total = (order.lines ?? []).reduce(
    (acc, l) => (acc === null || prices[l.id] === '' ? null : acc + Number(l.orderQty) * Number(prices[l.id])),
    0,
  );

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await ordersApi.setPricing(order.id, {
        buyerPoNo: terms.buyerPoNo,
        buyerPoDate: terms.buyerPoDate || null,
        exFactoryDate: terms.exFactoryDate || null,
        priceTerms: terms.priceTerms,
        paymentTerms: terms.paymentTerms,
        exchangeRate: isInr || !terms.exchangeRate ? null : terms.exchangeRate,
        lines: (order.lines ?? []).map((l) => ({ id: l.id, unitPrice: prices[l.id] === '' ? null : prices[l.id] })),
      });
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Prices & terms - ${order.orderNo}`}
      size="wide"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Field label="Buyer PO No">
            <TextInput value={terms.buyerPoNo} onChange={set('buyerPoNo')} />
          </Field>
          <Field label="Buyer PO Date">
            <TextInput type="date" value={terms.buyerPoDate} onChange={set('buyerPoDate')} />
          </Field>
          <Field label="Ex-Factory Date" hint="On or before the buyer delivery date.">
            <TextInput type="date" value={terms.exFactoryDate} onChange={set('exFactoryDate')} />
          </Field>
          <Field label="Exchange Rate" hint={isInr ? 'Not needed for an INR order.' : `Rupees per 1 ${order.currency ?? 'unit'}.`}>
            <TextInput type="number" min="0" step="0.0001" disabled={isInr} value={terms.exchangeRate} onChange={set('exchangeRate')} />
          </Field>
          <Field label="Price Terms">
            <TextInput value={terms.priceTerms} onChange={set('priceTerms')} />
          </Field>
          <Field label="Payment Terms">
            <TextInput value={terms.paymentTerms} onChange={set('paymentTerms')} />
          </Field>
        </div>
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Style</th>
                <th className="num">Order qty</th>
                <th className="num">Unit price ({order.currency ?? '-'})</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {(order.lines ?? []).map((l) => (
                <tr key={l.id}>
                  <td>{l.lineNo}</td>
                  <td className="mono">{l.style?.styleNo} {l.colorCode ? `· ${l.colorCode}` : ''}</td>
                  <td className="num">{fmtQty(l.orderQty)}</td>
                  <td className="num">
                    <TextInput
                      type="number"
                      min="0"
                      step="0.0001"
                      aria-label={`Unit price line ${l.lineNo}`}
                      value={prices[l.id]}
                      onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))}
                      style={{ maxWidth: 140, textAlign: 'right' }}
                    />
                  </td>
                  <td className="num">
                    {prices[l.id] === '' ? '-' : fmtMoney(Number(l.orderQty) * Number(prices[l.id]))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <p className="faint" style={{ fontSize: 12 }}>
          {total === null
            ? 'The order value is shown once every line has a price.'
            : `Order value ${fmtMoney(total, order.currency)} - the server stores its own calculation.`}
        </p>
      </div>
    </Modal>
  );
}

/** The Director's decision. The granted percentage may be less than requested. */
function ExcessDecisionDialog({ order, mode, onCancel, onDone }) {
  const approving = mode === 'approve';
  const [pct, setPct] = useState(String(Number(order.excessPct) * 100));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (approving) {
        const granted = await ordersApi.approveExcess(order.id, {
          approvedPct: String(Number(pct) / 100),
          remarks: text || undefined,
        });
        onDone(
          `Excess approved at ${(Number(granted.excessApprovedPct) * 100).toFixed(2)}%. Effective quantity is now ${Number(granted.effectiveQty).toLocaleString()} pieces.`,
        );
      } else {
        await ordersApi.rejectExcess(order.id, text);
        onDone('Excess rejected. The order keeps its plain quantity.');
      }
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={approving ? 'Approve excess' : 'Reject excess'}
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${approving ? 'btn-primary' : 'btn-danger'}`}
            onClick={submit}
            disabled={busy || (!approving && text.trim().length < 3)}
          >
            {busy ? 'Working...' : approving ? 'Approve' : 'Reject'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>
        <p style={{ marginTop: 0 }}>
          Order <strong>{order.orderNo}</strong> requests an excess of{' '}
          <strong>{fmtPctFromFraction(order.excessPct)}</strong> on {fmtQty(order.orderQty)} pieces.
        </p>
        {order.excessJustification && (
          <p className="muted">Justification: {order.excessJustification}</p>
        )}

        {approving ? (
          <>
            <Field
              label="Approve excess of (%)"
              required
              hint="You may grant less than was requested, but not more."
            >
              <TextInput
                type="number"
                min="0"
                max={String(Number(order.excessPct) * 100)}
                step="0.01"
                value={pct}
                onChange={(e) => setPct(e.target.value)}
              />
            </Field>
            <p className="faint" style={{ fontSize: 12 }}>
              The new effective quantity is calculated by the server when you approve.
            </p>
            <Field label="Remarks">
              <TextArea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Reason" required>
            <TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/** Changing a locked order: always reasoned, always recorded. */
function AmendDialog({ order, onCancel, onDone }) {
  const [form, setForm] = useState({
    reason: '',
    orderQty: String(order.orderQty),
    excessPctInput: String(Number(order.excessPct) * 100),
    buyerDeliveryDate: order.buyerDeliveryDate ? String(order.buyerDeliveryDate).slice(0, 10) : '',
    excessJustification: order.excessJustification ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await ordersApi.amend(order.id, {
        reason: form.reason,
        orderQty: form.orderQty,
        excessPct: String(Number(form.excessPctInput || 0) / 100),
        buyerDeliveryDate: form.buyerDeliveryDate || null,
        excessJustification: form.excessJustification || undefined,
      });
      onDone('Amendment recorded. Any approved excess has gone back to the Director.');
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Amend order ${order.orderNo}`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={busy || form.reason.trim().length < 5}
          >
            {busy ? 'Recording...' : 'Record amendment'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>
        <Alert kind="warning">
          This order is locked by downstream documents. An amendment records what changed and why,
          and returns any approved excess to the Director.
        </Alert>

        <Field label="Reason for the amendment" required hint="At least 5 characters.">
          <TextArea rows={2} value={form.reason} onChange={set('reason')} />
        </Field>

        <div className="form-grid">
          <Field label="Order Qty">
            <TextInput type="number" min="1" step="1" value={form.orderQty} onChange={set('orderQty')} />
          </Field>
          <Field label="Excess %">
            <TextInput type="number" min="0" max="99" step="0.01" value={form.excessPctInput} onChange={set('excessPctInput')} />
          </Field>
          <Field label="Buyer Delivery Date">
            <TextInput type="date" value={form.buyerDeliveryDate} onChange={set('buyerDeliveryDate')} />
          </Field>
          <Field label="Excess Justification" className="span-2">
            <TextArea rows={2} value={form.excessJustification} onChange={set('excessJustification')} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The buyer's measurement sheet, and anything else attached to the order.
 *
 * ===========================================================================
 *  WHY THIS IS A PANEL AND NOT A FIELD
 * ===========================================================================
 *
 *  `measurementSheetRef` has existed on the order since C9 and holds a
 *  filename. It was never put on a screen, and a filename is worth what the
 *  shared folder behind it is worth. This holds the file, so the order can
 *  still be traced back to the sheet its per-piece figures came from after
 *  somebody reorganises the drive.
 *
 *  Loaded on its own rather than with the order: an order screen must not wait
 *  on a list of files, and nothing else here depends on them.
 */
function MeasurementSheets({ orderId, canEdit }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [removing, setRemoving] = useState(null);

  const load = useCallback(() => {
    ordersApi.attachments
      .list(orderId)
      .then(setRows)
      .catch((e) => {
        setRows([]);
        setError(e.message);
      });
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  async function onPick(e) {
    const file = e.target.files?.[0];
    // Clear it immediately, so choosing the same file twice still fires.
    e.target.value = '';
    if (!file) return;

    setBusy(true);
    setError('');
    try {
      await ordersApi.attachments.upload(orderId, file, note.trim());
      setNote('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function open(row) {
    setError('');
    try {
      await ordersApi.attachments.open(orderId, row.id, row.fileName);
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmRemove() {
    setBusy(true);
    try {
      await ordersApi.attachments.remove(orderId, removing.id);
      setRemoving(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <span>Buyer measurement sheet</span>
        <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
          {rows === null ? '' : `${rows.length} attached`}
        </span>
      </div>

      <div className="card-body">
        {error && <Alert kind="error">{error}</Alert>}

        {rows === null && <Spinner label="Loading attachments..." />}

        {rows !== null && rows.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            Nothing attached. The sheet the order&rsquo;s per-piece figures came from
            belongs here, so it can be found again later.
          </p>
        )}

        {rows !== null && rows.length > 0 && (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Note</th>
                  <th className="num">Size</th>
                  <th>Attached by</th>
                  <th>When</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => open(r)}>
                        {r.fileName}
                      </button>
                    </td>
                    <td className="muted">{r.note ?? '-'}</td>
                    <td className="num">{(r.sizeBytes / 1024).toFixed(0)} KB</td>
                    <td>{r.uploadedByName ?? '-'}</td>
                    <td className="nowrap">{fmtDateTime(r.createdAt)}</td>
                    <td className="actions">
                      {canEdit && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => setRemoving(r)}
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
        )}

        {canEdit && (
          <div className="form-grid" style={{ marginTop: 14 }}>
            <Field label="Note" hint="Which revision of the sheet this is.">
              <TextInput
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Spring 2026, revision B"
                disabled={busy}
              />
            </Field>
            <Field label="Attach a file" hint="PDF, image or Excel, up to 10 MB.">
              {/* Extensions as well as MIME types. A Windows machine without
                  Excel installed does not know what an .xlsx is, so a
                  type-only filter greys the workbook out in the picker on the
                  very machines most likely to be attaching one - see ACCEPTED
                  in attachment.service.js. */}
              <input
                type="file"
                accept={
                  'application/pdf,image/jpeg,image/png,image/webp,'
                  + 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,'
                  + 'application/vnd.ms-excel,'
                  + '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls'
                }
                onChange={onPick}
                disabled={busy}
              />
            </Field>
          </div>
        )}
      </div>

      {removing && (
        <ConfirmDialog
          title="Remove this attachment?"
          confirmLabel="Remove"
          danger
          busy={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={confirmRemove}
          message={
            <>
              <strong>{removing.fileName}</strong> will no longer be listed against this
              order.
            </>
          }
        />
      )}
    </div>
  );
}
