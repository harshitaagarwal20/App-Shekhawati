/**
 * MULTI-LINE PURCHASE DOCUMENTS - one vendor, many items.
 *
 * A tote needs webbing, zipper, puller, D-rings, buckles, lining, thread,
 * labels and cartons, usually from one vendor on one PO and one bill. These
 * screens raise and show that document as one thing:
 *
 *   /purchase-orders/new-document     PoDocumentForm
 *   /purchase-orders/documents/:id    PoDocumentDetail  (approve all, print)
 *   /quotations/new-document          QuotationDocumentForm
 *   /quotations/documents/:id         QuotationDocumentDetail
 *   /grns/new-document                GrnDocumentForm
 *   /grns/documents/:id               GrnDocumentDetail
 *
 * Every line is still the per-item record it always was - its own ceilings,
 * tolerances, approval and receipts - and each line keeps its own detail
 * screen, linked from here. Nothing on these screens multiplies anything the
 * server stores; line values shown while typing are labelled previews.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  grns as grnApi,
  orders as ordersApi,
  purchaseOrders as poApi,
  quotations as quotationsApi,
  vendors as vendorsApi,
} from '../../services/erp.js';
import {
  Alert,
  EnumSelect,
  Field,
  MasterSelect,
  Modal,
  PageHeader,
  RecordSelect,
  Spinner,
  StatusBadge,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { fmtDate, fmtDateTime } from '../../utils/format.js';
import { loadFailed } from '../../services/loadFailures.js';

const today = () => new Date().toISOString().slice(0, 10);
const money = (v) =>
  v === null || v === undefined || v === '' || Number.isNaN(Number(v))
    ? '-'
    : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 4 }));
const isAccessory = (l) => l.item === 'Accessories' || Boolean(l.accessoriesItem);
const describe = (l) =>
  [l.item, l.subCategory, l.accessoriesItem, l.accessoryType, l.colorCode].filter(Boolean).join(' · ');

const DOC_BADGE = {
  PENDING: 'badge-pending',
  PARTLY_APPROVED: 'badge-info',
  APPROVED: 'badge-approved',
  REJECTED: 'badge-rejected',
  CANCELLED: 'badge-inactive',
};
function DocStatus({ status }) {
  return <span className={`badge ${DOC_BADGE[status] ?? 'badge-inactive'}`}>{String(status ?? '').replace(/_/g, ' ')}</span>;
}

let seq = 0;
const key = () => `l${(seq += 1)}`;

function useVendorsAndOrders() {
  const [vendors, setVendors] = useState(null);
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    vendorsApi.options().then(setVendors).catch(loadFailed(setVendors, 'vendors'));
    ordersApi.options().then(setOrders).catch(loadFailed(setOrders, 'orders'));
  }, []);
  return { vendors, orders };
}

/** A server refusal that names a line ("lines.2.qty") lands on that line. */
function lineOfError(e) {
  const field = e?.details?.field ?? Object.keys(e?.fieldErrors ?? {})[0] ?? '';
  const m = /^lines\.(\d+)/.exec(field);
  return m ? Number(m[1]) : null;
}

/** The fields of one material, shared by the PO and quotation line grids. */
function MaterialCells({ line, set }) {
  const acc = isAccessory(line);
  return (
    <>
      <td style={{ minWidth: 150 }}>
        <MasterSelect listCode="ItemCategory" value={line.item} currentValue={line.item} aria-label="Item"
          onChange={(e) => set({ item: e.target.value, subCategory: '', accessoriesItem: '', accessoryType: '' })} />
      </td>
      <td style={{ minWidth: 160 }}>
        {acc ? (
          <>
            <MasterSelect listCode="AccessoriesItem" value={line.accessoriesItem} currentValue={line.accessoriesItem}
              aria-label="Accessories item" onChange={(e) => set({ accessoriesItem: e.target.value })} />
            <TextInput placeholder="type, e.g. #5 nylon" value={line.accessoryType} maxLength={120}
              style={{ marginTop: 4 }} onChange={(e) => set({ accessoryType: e.target.value })} />
          </>
        ) : (
          <MasterSelect listCode="FabricSubCat" value={line.subCategory} currentValue={line.subCategory}
            aria-label="Sub category" onChange={(e) => set({ subCategory: e.target.value })} />
        )}
      </td>
      <td style={{ minWidth: 120 }}>
        <MasterSelect listCode="ColorCode" value={line.colorCode} currentValue={line.colorCode} aria-label="Colour"
          onChange={(e) => set({ colorCode: e.target.value })} />
      </td>
      <td style={{ minWidth: 90 }}>
        <MasterSelect listCode="UOM" value={line.uom} currentValue={line.uom} aria-label="UOM"
          onChange={(e) => set({ uom: e.target.value })} />
      </td>
    </>
  );
}

function NumCell({ value, onChange, label, width = 100 }) {
  return (
    <td className="num">
      <TextInput type="number" inputMode="decimal" min="0" step="any" aria-label={label} value={value}
        style={{ maxWidth: width, textAlign: 'right' }} onChange={(e) => onChange(e.target.value)} />
    </td>
  );
}

const blankPoLine = () => ({
  key: key(), item: '', subCategory: '', accessoriesItem: '', accessoryType: '', colorCode: '', uom: '',
  orderQty: '', rate: '', hsnCode: '', orderMode: 'AS_PER_STYLE', orderId: '', remarks: '',
});

const ORDER_MODES = [
  { value: 'AS_PER_STYLE', label: 'As per style' },
  { value: 'BULK', label: 'Bulk' },
];

// ===========================================================================
//  PURCHASE ORDER - new document
// ===========================================================================

export function PoDocumentForm() {
  const navigate = useNavigate();
  const { vendors, orders } = useVendorsAndOrders();
  const [head, setHead] = useState({ vendorId: '', poDate: today(), orderId: '', deliveryDate: '', paymentTerms: '', headerRemarks: '' });
  const [lines, setLines] = useState([blankPoLine()]);
  const [error, setError] = useState('');
  const [badLine, setBadLine] = useState(null);
  const [busy, setBusy] = useState(false);

  const setH = (k) => (e) => setHead((h) => ({ ...h, [k]: e.target.value }));
  const setLine = (k, patch) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + (Number(l.orderQty) || 0) * (Number(l.rate) || 0), 0);
  const ready = head.vendorId && lines.every((l) => l.item && l.uom && Number(l.orderQty) > 0 && l.rate !== '');

  async function save() {
    setBusy(true);
    setError('');
    setBadLine(null);
    try {
      const doc = await poApi.createDocument({
        vendorId: head.vendorId,
        poDate: head.poDate || undefined,
        orderId: head.orderId || null,
        deliveryDate: head.deliveryDate || null,
        paymentTerms: head.paymentTerms || undefined,
        headerRemarks: head.headerRemarks || undefined,
        lines: lines.map((l) => ({
          item: l.item,
          subCategory: isAccessory(l) ? undefined : l.subCategory || undefined,
          accessoriesItem: isAccessory(l) ? l.accessoriesItem || undefined : undefined,
          accessoryType: isAccessory(l) ? l.accessoryType || undefined : undefined,
          colorCode: l.colorCode || undefined,
          uom: l.uom,
          orderQty: String(l.orderQty),
          rate: String(l.rate),
          hsnCode: l.hsnCode || undefined,
          orderMode: l.orderMode,
          orderId: l.orderId || undefined,
          remarks: l.remarks || undefined,
        })),
      });
      navigate(`/purchase-orders/documents/${doc.id}`);
    } catch (e) {
      setError(e.message);
      setBadLine(lineOfError(e));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New purchase order"
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/purchase-orders')}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={save}>
              {busy ? 'Raising...' : `Raise PO (${lines.length} line${lines.length === 1 ? '' : 's'})`}
            </button>
          </>
        }
      />
      <Alert kind="error">{error}</Alert>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Document</div>
        <div className="card-body">
          <div className="form-grid">
            <Field label="Vendor" required>
              <RecordSelect options={vendors ?? []} loading={vendors === null} getValue={(v) => v.id}
                getLabel={(v) => `${v.vendorName}${v.vendorCode ? ` (${v.vendorCode})` : ''}`}
                placeholder="Select vendor..." value={head.vendorId} onChange={setH('vendorId')} />
            </Field>
            <Field label="PO date"><TextInput type="date" value={head.poDate} onChange={setH('poDate')} /></Field>
            <Field label="For buyer order" hint="Default for every line; a line may name another.">
              <RecordSelect options={orders} getValue={(o) => o.id} getLabel={(o) => o.orderNo}
                placeholder="None (bulk)" value={head.orderId} onChange={setH('orderId')} />
            </Field>
            <Field label="Deliver by"><TextInput type="date" value={head.deliveryDate} onChange={setH('deliveryDate')} /></Field>
            <Field label="Payment terms"><TextInput value={head.paymentTerms} maxLength={150} onChange={setH('paymentTerms')} /></Field>
            <Field label="Remarks" className="span-2"><TextArea rows={2} value={head.headerRemarks} onChange={setH('headerRemarks')} /></Field>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span>Items</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            preview total ₹ {money(total)} - each line is checked against its requirement ceiling when you raise the PO
          </span>
        </div>
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>#</th><th>Item</th><th>Detail</th><th>Colour</th><th>UOM</th>
                <th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th>
                <th>Mode</th><th>Order</th><th>HSN</th><th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className={badLine === i ? 'row-bad' : ''}>
                  <td>{i + 1}</td>
                  <MaterialCells line={l} set={(p) => setLine(l.key, p)} />
                  <NumCell label="Quantity" value={l.orderQty} onChange={(v) => setLine(l.key, { orderQty: v })} />
                  <NumCell label="Rate" value={l.rate} onChange={(v) => setLine(l.key, { rate: v })} />
                  <td className="num">{money((Number(l.orderQty) || 0) * (Number(l.rate) || 0))}</td>
                  <td style={{ minWidth: 120 }}>
                    <EnumSelect options={ORDER_MODES} includeBlank={false} value={l.orderMode} aria-label="Order mode"
                      onChange={(e) => setLine(l.key, { orderMode: e.target.value })} />
                  </td>
                  <td style={{ minWidth: 120 }}>
                    <RecordSelect options={orders} getValue={(o) => o.id} getLabel={(o) => o.orderNo} aria-label="Order"
                      placeholder={head.orderId ? 'as document' : 'none'} value={l.orderId}
                      onChange={(e) => setLine(l.key, { orderId: e.target.value })} />
                  </td>
                  <td><TextInput value={l.hsnCode} maxLength={8} style={{ maxWidth: 90 }} aria-label="HSN"
                    onChange={(e) => setLine(l.key, { hsnCode: e.target.value })} /></td>
                  <td className="actions">
                    {lines.length > 1 && (
                      <button type="button" className="btn btn-sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <div className="card-body">
          <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, { ...blankPoLine(), orderMode: ls[ls.length - 1]?.orderMode ?? 'AS_PER_STYLE' }])}>
            Add an item
          </button>
        </div>
      </div>
    </>
  );
}

// ===========================================================================
//  PURCHASE ORDER - the document
// ===========================================================================

function useDoc(loader, id) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setDoc(await loader(id));
    } catch (e) {
      setError(e.message);
    }
  }, [loader, id]);
  useEffect(() => { load(); }, [load]);
  return { doc, setDoc, error, load };
}

function Trail({ history }) {
  if (!history?.length) return null;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header">Trail</div>
      <div className="card-body">
        {history.map((h) => (
          <div key={h.id} style={{ fontSize: 13, marginBottom: 6 }}>
            <span className="code">{h.documentNo}</span> · <strong>{String(h.action).toLowerCase()}</strong>
            {h.actedByName ? ` by ${h.actedByName}` : ''} · {fmtDateTime(h.actedAt)}
            {h.remarks && <span className="muted"> - {h.remarks}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function RejectAll({ onCancel, onReject, what }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={`Reject ${what}`} size="narrow" onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={reason.trim().length < 3} onClick={() => onReject(reason.trim())}>
            Reject every pending line
          </button>
        </>
      }>
      <div className="modal-body">
        <Field label="Reason" required><TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function PoDocumentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { doc, setDoc, error, load } = useDoc(poApi.getDocument, id);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  async function act(fn, text) {
    setBusy(true);
    setBanner(null);
    try {
      setDoc(await fn());
      setBanner({ kind: 'success', text });
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!doc) return <div className="card"><div className="loading-row"><Spinner label="Loading purchase order..." /></div></div>;

  const canDecide = can('PURCHASE_ORDER.APPROVE') && doc.pendingLines > 0;

  return (
    <>
      <PageHeader
        title={`Purchase order ${doc.poNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/purchase-orders')}>Back to list</button>
            {can('PURCHASE_ORDER.EXPORT') && (
              <button type="button" className="btn" onClick={() => navigate(`/print/po-document/${doc.id}`)}>Print</button>
            )}
            {canDecide && (
              <>
                <button type="button" className="btn btn-primary" disabled={busy}
                  onClick={() => act(() => poApi.approveDocument(doc.id, {}), 'Every pending line approved.')}>
                  Approve all ({doc.pendingLines})
                </button>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setRejecting(true)}>Reject all</button>
              </>
            )}
          </>
        }
      />
      {banner && <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>{banner.text}</Alert>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>{doc.vendor?.vendorName} <DocStatus status={doc.status} /></span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>{doc.lineCount} line(s) · total ₹ {money(doc.totalAmount)}</span>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <Info label="PO date" value={fmtDate(doc.poDate)} />
            <Info label="Deliver by" value={fmtDate(doc.deliveryDate)} />
            <Info label="Payment terms" value={doc.paymentTerms} />
            <Info label="Buyer order" value={doc.order?.orderNo} />
            <Info label="Address" value={doc.address} className="span-2" />
            {doc.remarks && <Info label="Remarks" value={doc.remarks} className="span-2" />}
          </div>
        </div>
      </div>

      <div className="card">
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Line</th><th>Material</th><th>UOM</th><th className="num">Ordered</th><th className="num">Received</th>
                <th className="num">Rate</th><th className="num">Amount</th><th>Order</th><th>Approval</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => navigate(`/purchase-orders/${l.id}`)}>
                  <td className="code">{l.poId}</td>
                  <td>{describe(l)}</td>
                  <td>{l.uom}</td>
                  <td className="num">{qty(l.orderQty)}</td>
                  <td className="num">{qty(l.receivedQty)}</td>
                  <td className="num">{money(l.rate)}</td>
                  <td className="num">{money(l.amount)}</td>
                  <td className="code">{l.order?.orderNo ?? '-'}</td>
                  <td><StatusBadge status={l.approvalStatus} /></td>
                  <td><StatusBadge status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>
      <Trail history={doc.history} />

      {rejecting && (
        <RejectAll what={`PO ${doc.poNo}`} onCancel={() => setRejecting(false)}
          onReject={(reason) => {
            setRejecting(false);
            act(() => poApi.rejectDocument(doc.id, reason), 'Every pending line rejected.');
          }} />
      )}
    </>
  );
}

function Info({ label, value, className = '' }) {
  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      <div style={{ paddingTop: 2 }}>{value || <span className="faint">-</span>}</div>
    </div>
  );
}

/** The vendor's copy - every live line on one sheet. */
export function PoDocumentPrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { doc: p, error } = useDoc(poApi.printDocument, id);
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!p) return <Spinner label="Preparing..." />;
  return (
    <div className="doc-print">
      <div className="no-print row" style={{ marginBottom: 12, gap: 8 }}>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Back</button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print</button>
        {!p.fullyApproved && <Alert kind="warning">Not every line is approved yet - this is a draft, not the vendor&apos;s copy.</Alert>}
      </div>
      <div className="doc-sheet">
        <div className="doc-head">
          <div>
            <h2 style={{ margin: 0 }}>{p.company.name}</h2>
            <div className="muted">{p.company.address}</div>
            {p.company.gstin && <div className="muted">GSTIN {p.company.gstin}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0 }}>PURCHASE ORDER{p.fullyApproved ? '' : ' (DRAFT)'}</h2>
            <div className="code">{p.header.poNo}</div>
            <div>Date {fmtDate(p.header.poDate)}</div>
            {p.header.deliveryDate && <div>Deliver by {fmtDate(p.header.deliveryDate)}</div>}
          </div>
        </div>
        <div className="doc-parties">
          <div>
            <strong>To</strong>
            <div>{p.vendor?.vendorName}</div>
            <div className="muted" style={{ whiteSpace: 'pre-line' }}>{p.header.address ?? p.vendor?.address}</div>
            {p.vendor?.gstNo && <div className="muted">GSTIN {p.vendor.gstNo}</div>}
          </div>
          <div>
            {p.header.orderNo && <div>Buyer order: <span className="code">{p.header.orderNo}</span></div>}
            {p.header.paymentTerms && <div>Payment: {p.header.paymentTerms}</div>}
          </div>
        </div>
        <table className="data doc-lines">
          <thead>
            <tr><th>#</th><th>Description</th><th>HSN</th><th className="num">Qty</th><th>UOM</th><th className="num">Rate</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.poId}>
                <td>{l.lineNo}</td>
                <td>{describe(l)}{l.gsm ? ` · ${l.gsm}` : ''}{l.orderNo ? <div className="faint">for {l.orderNo}</div> : null}</td>
                <td>{l.hsnCode ?? ''}</td>
                <td className="num">{qty(l.orderQty)}</td>
                <td>{l.uom}</td>
                <td className="num">{money(l.rate)}</td>
                <td className="num">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={6} className="num"><strong>Total</strong></td><td className="num"><strong>{money(p.totalAmount)}</strong></td></tr>
          </tfoot>
        </table>
        <p><strong>Amount in words:</strong> {p.amountInWords}</p>
        {p.header.remarks && <p className="muted">{p.header.remarks}</p>}
        <div className="doc-sign"><div>Prepared by</div><div>Authorised signatory</div></div>
      </div>
    </div>
  );
}

// ===========================================================================
//  QUOTATION - one vendor's quote, several items
// ===========================================================================

const blankQuoteLine = () => ({
  key: key(), item: '', subCategory: '', accessoriesItem: '', accessoryType: '', colorCode: '', uom: '', qty: '', rateQuoted: '', remarks: '',
});

export function QuotationDocumentForm() {
  const navigate = useNavigate();
  const { vendors, orders } = useVendorsAndOrders();
  const [head, setHead] = useState({ vendorId: '', quotationDate: today(), orderId: '', vendorRefNo: '', validUntil: '', remarks: '' });
  const [lines, setLines] = useState([blankQuoteLine()]);
  const [error, setError] = useState('');
  const [badLine, setBadLine] = useState(null);
  const [busy, setBusy] = useState(false);
  const setH = (k) => (e) => setHead((h) => ({ ...h, [k]: e.target.value }));
  const setLine = (k, patch) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const ready = head.vendorId && lines.every((l) => l.item && l.uom && Number(l.qty) > 0 && l.rateQuoted !== '');

  async function save() {
    setBusy(true);
    setError('');
    setBadLine(null);
    try {
      const doc = await quotationsApi.createDocument({
        vendorId: head.vendorId,
        quotationDate: head.quotationDate || undefined,
        orderId: head.orderId || null,
        vendorRefNo: head.vendorRefNo || undefined,
        validUntil: head.validUntil || null,
        remarks: head.remarks || undefined,
        lines: lines.map((l) => ({
          item: l.item,
          subCategory: isAccessory(l) ? undefined : l.subCategory || undefined,
          accessoriesItem: isAccessory(l) ? l.accessoriesItem || undefined : undefined,
          accessoryType: isAccessory(l) ? l.accessoryType || undefined : undefined,
          uom: l.uom,
          qty: String(l.qty),
          rateQuoted: String(l.rateQuoted),
          remarks: [l.colorCode && `Colour ${l.colorCode}`, l.remarks].filter(Boolean).join('; ') || undefined,
        })),
      });
      navigate(`/quotations/documents/${doc.id}`);
    } catch (e) {
      setError(e.message);
      setBadLine(lineOfError(e));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New vendor quotation"
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/quotations')}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={save}>
              {busy ? 'Saving...' : `Record quote (${lines.length} item${lines.length === 1 ? '' : 's'})`}
            </button>
          </>
        }
      />
      <Alert kind="error">{error}</Alert>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Quote</div>
        <div className="card-body">
          <div className="form-grid">
            <Field label="Vendor" required>
              <RecordSelect options={vendors ?? []} loading={vendors === null} getValue={(v) => v.id} getLabel={(v) => v.vendorName}
                placeholder="Select vendor..." value={head.vendorId} onChange={setH('vendorId')} />
            </Field>
            <Field label="Date"><TextInput type="date" value={head.quotationDate} onChange={setH('quotationDate')} /></Field>
            <Field label="For buyer order">
              <RecordSelect options={orders} getValue={(o) => o.id} getLabel={(o) => o.orderNo} placeholder="None"
                value={head.orderId} onChange={setH('orderId')} />
            </Field>
            <Field label="Vendor's ref no"><TextInput value={head.vendorRefNo} maxLength={60} onChange={setH('vendorRefNo')} /></Field>
            <Field label="Valid until"><TextInput type="date" value={head.validUntil} onChange={setH('validUntil')} /></Field>
            <Field label="Remarks" className="span-2"><TextArea rows={2} value={head.remarks} onChange={setH('remarks')} /></Field>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-header">Items quoted</div>
        <TableWrap>
          <table className="data">
            <thead>
              <tr><th>#</th><th>Item</th><th>Detail</th><th>Colour</th><th>UOM</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th><th /></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className={badLine === i ? 'row-bad' : ''}>
                  <td>{i + 1}</td>
                  <MaterialCells line={l} set={(p) => setLine(l.key, p)} />
                  <NumCell label="Quantity" value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} />
                  <NumCell label="Rate" value={l.rateQuoted} onChange={(v) => setLine(l.key, { rateQuoted: v })} />
                  <td className="num">{money((Number(l.qty) || 0) * (Number(l.rateQuoted) || 0))}</td>
                  <td className="actions">
                    {lines.length > 1 && (
                      <button type="button" className="btn btn-sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <div className="card-body">
          <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, blankQuoteLine()])}>Add an item</button>
        </div>
      </div>
    </>
  );
}

export function QuotationDocumentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { doc, setDoc, error, load } = useDoc(quotationsApi.getDocument, id);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  async function act(fn, text) {
    setBusy(true);
    try {
      setDoc(await fn());
      setBanner({ kind: 'success', text });
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!doc) return <div className="card"><div className="loading-row"><Spinner label="Loading quotation..." /></div></div>;
  const canDecide = can('VENDOR_QUOTATION.APPROVE') && doc.pendingLines > 0;

  return (
    <>
      <PageHeader
        title={`Quotation ${doc.quotationNo}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/quotations')}>Back to list</button>
            {canDecide && (
              <>
                <button type="button" className="btn btn-primary" disabled={busy}
                  onClick={() => act(() => quotationsApi.approveDocument(doc.id, {}), 'Every pending item approved.')}>
                  Approve all ({doc.pendingLines})
                </button>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setRejecting(true)}>Reject all</button>
              </>
            )}
          </>
        }
      />
      {banner && <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>{banner.text}</Alert>}
      <p className="muted" style={{ marginTop: 0 }}>
        Items are decided one by one from each line&apos;s own screen - approve the zipper, refuse the webbing -
        or all at once here.
      </p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>{doc.vendor?.vendorName} <DocStatus status={doc.status} /></span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>{doc.lineCount} item(s) · ₹ {money(doc.totalAmount)}</span>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <Info label="Date" value={fmtDate(doc.quotationDate)} />
            <Info label="Vendor's ref" value={doc.vendorRefNo} />
            <Info label="Valid until" value={fmtDate(doc.validUntil)} />
            <Info label="Buyer order" value={doc.order?.orderNo} />
            {doc.remarks && <Info label="Remarks" value={doc.remarks} className="span-2" />}
          </div>
        </div>
      </div>
      <div className="card">
        <TableWrap>
          <table className="data">
            <thead>
              <tr><th>Line</th><th>Item</th><th>UOM</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th><th>Status</th></tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => navigate(`/quotations/${l.id}`)}>
                  <td className="code">{l.quotationNo}</td>
                  <td>{describe(l)}</td>
                  <td>{l.uom}</td>
                  <td className="num">{qty(l.qty)}</td>
                  <td className="num">{money(l.rateQuoted)}</td>
                  <td className="num">{money(l.amount)}</td>
                  <td><StatusBadge status={l.authorisationStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>
      <Trail history={doc.history} />
      {rejecting && (
        <RejectAll what={`quotation ${doc.quotationNo}`} onCancel={() => setRejecting(false)}
          onReject={(reason) => {
            setRejecting(false);
            act(() => quotationsApi.rejectDocument(doc.id, reason), 'Every pending item rejected.');
          }} />
      )}
    </>
  );
}

// ===========================================================================
//  GRN - one delivery, one bill, several PO lines
// ===========================================================================

const GRN_PURPOSES = [
  { value: 'RAW_MATERIAL', label: 'Raw material' },
  { value: 'ACCESSORIES', label: 'Accessories' },
  { value: 'DYEING', label: 'Dyeing' },
  { value: 'PRINTING', label: 'Printing' },
  { value: 'JOB_WORK_RETURN', label: 'Job work return' },
];

const blankGrnLine = () => ({ key: key(), purchaseOrderId: '', receivingQty: '', inventoryRate: '', rolls: [] });
const blankRoll = () => ({ key: key(), rollNo: '', qty: '', shade: '', dyeLot: '' });

export function GrnDocumentForm() {
  const navigate = useNavigate();
  const [vendors, setVendors] = useState(null);
  const [gstRates, setGstRates] = useState([]);
  const [pos, setPos] = useState([]);
  const [head, setHead] = useState({ vendorId: '', billNo: '', billDate: '', grnDate: today(), purpose: 'RAW_MATERIAL', gstRatePct: '', location: '', headerRemarks: '' });
  const [lines, setLines] = useState([blankGrnLine()]);
  const [acknowledge, setAcknowledge] = useState(false);
  const [needsAck, setNeedsAck] = useState(false);
  const [error, setError] = useState('');
  const [badLine, setBadLine] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    vendorsApi.options().then(setVendors).catch(loadFailed(setVendors, 'vendors'));
    grnApi.gstRates().then(setGstRates).catch(loadFailed(setGstRates, 'GST rates'));
  }, []);
  // Only this vendor's approved PO lines that are still expecting goods.
  useEffect(() => {
    if (!head.vendorId) {
      setPos([]);
      return;
    }
    poApi.options({ vendorId: head.vendorId, approvedOnly: 'true', openOnly: 'true' }).then(setPos).catch(() => setPos([]));
  }, [head.vendorId]);

  const poById = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);
  const setH = (k) => (e) => setHead((h) => ({ ...h, [k]: e.target.value }));
  const setLine = (k, patch) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const rollTotal = (l) => l.rolls.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const rollsOk = (l) => l.rolls.length === 0 || Math.abs(rollTotal(l) - Number(l.receivingQty || 0)) < 0.00005;
  const ready = head.vendorId && head.billNo.trim() && lines.every((l) => l.purchaseOrderId && Number(l.receivingQty) > 0 && rollsOk(l));

  async function save() {
    setBusy(true);
    setError('');
    setBadLine(null);
    try {
      const doc = await grnApi.createDocument({
        billNo: head.billNo,
        billDate: head.billDate || null,
        grnDate: head.grnDate || undefined,
        purpose: head.purpose,
        gstRatePct: head.gstRatePct || undefined,
        location: head.location || undefined,
        headerRemarks: head.headerRemarks || undefined,
        acknowledgeToleranceBreach: acknowledge || undefined,
        lines: lines.map((l) => ({
          purchaseOrderId: l.purchaseOrderId,
          receivingQty: String(l.receivingQty),
          inventoryRate: l.inventoryRate === '' ? null : String(l.inventoryRate),
          rolls: l.rolls.length
            ? l.rolls.map((r) => ({ rollNo: r.rollNo || null, qty: String(r.qty), shade: r.shade || undefined, dyeLot: r.dyeLot || undefined }))
            : undefined,
        })),
      });
      navigate(`/grns/documents/${doc.id}`);
    } catch (e) {
      setError(e.message);
      setBadLine(lineOfError(e));
      if (e?.details?.requiresAcknowledgement || e?.details?.details?.requiresAcknowledgement || /Confirm the over-receipt/i.test(e.message)) setNeedsAck(true);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Receive goods (multi-line GRN)"
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/grns')}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={save}>
              {busy ? 'Posting...' : `Post receipt (${lines.length} line${lines.length === 1 ? '' : 's'})`}
            </button>
          </>
        }
      />
      <Alert kind="error">{error}</Alert>
      {needsAck && (
        <Alert kind="warning">
          <label className="checkbox-row">
            <input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} /> I confirm the
            over-receipt shown above and want it recorded.
          </label>
        </Alert>
      )}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Delivery</div>
        <div className="card-body">
          <div className="form-grid">
            <Field label="Vendor" required>
              <RecordSelect options={vendors ?? []} loading={vendors === null} getValue={(v) => v.id} getLabel={(v) => v.vendorName}
                placeholder="Select vendor..." value={head.vendorId}
                onChange={(e) => { setHead((h) => ({ ...h, vendorId: e.target.value })); setLines([blankGrnLine()]); }} />
            </Field>
            <Field label="Bill / challan no" required><TextInput value={head.billNo} maxLength={60} onChange={setH('billNo')} /></Field>
            <Field label="Bill date"><TextInput type="date" value={head.billDate} onChange={setH('billDate')} /></Field>
            <Field label="GRN date"><TextInput type="date" value={head.grnDate} max={today()} onChange={setH('grnDate')} /></Field>
            <Field label="Purpose">
              <EnumSelect options={GRN_PURPOSES} includeBlank={false} value={head.purpose} onChange={setH('purpose')} />
            </Field>
            <Field label="GST rate" hint="As charged on the bill.">
              <EnumSelect options={gstRates.map((r) => ({ value: r.value, label: r.label }))} placeholder="No GST / unregistered"
                value={head.gstRatePct} onChange={setH('gstRatePct')} />
            </Field>
            <Field label="Into location" hint="Defaults to the main store.">
              <MasterSelect listCode="StockLocation" value={head.location} currentValue={head.location} onChange={setH('location')} />
            </Field>
            <Field label="Remarks" className="span-2"><TextArea rows={2} value={head.headerRemarks} onChange={setH('headerRemarks')} /></Field>
          </div>
        </div>
      </div>

      {lines.map((l, i) => {
        const po = poById.get(l.purchaseOrderId);
        return (
          <div className={`card ${badLine === i ? 'card-bad' : ''}`} key={l.key} style={{ marginBottom: 12 }}>
            <div className="card-header">
              <span>Line {i + 1}</span>
              {lines.length > 1 && (
                <button type="button" className="btn btn-sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button>
              )}
            </div>
            <div className="card-body">
              <div className="form-grid">
                <Field label="PO line" required className="span-2"
                  hint={head.vendorId ? (pos.length ? undefined : 'This vendor has no approved PO still expecting goods.') : 'Pick the vendor first.'}>
                  <RecordSelect options={pos} getValue={(p) => p.id}
                    getLabel={(p) => `${p.poId} - ${describe(p)} - ${qty(Number(p.orderQty) - Number(p.receivedQty))} ${p.uom} pending`}
                    placeholder="Select the PO line..." disabled={!head.vendorId} value={l.purchaseOrderId}
                    onChange={(e) => setLine(l.key, { purchaseOrderId: e.target.value })} />
                </Field>
                <Field label={`Receiving qty${po ? ` (${po.uom})` : ''}`} required>
                  <TextInput type="number" min="0" step="any" value={l.receivingQty} onChange={(e) => setLine(l.key, { receivingQty: e.target.value })} />
                </Field>
                <Field label="Inventory rate" hint={po ? `PO rate ${money(po.rate)} if left blank` : undefined}>
                  <TextInput type="number" min="0" step="any" value={l.inventoryRate} onChange={(e) => setLine(l.key, { inventoryRate: e.target.value })} />
                </Field>
              </div>
              {po && !isAccessory(po) && (
                <div style={{ marginTop: 8 }}>
                  {l.rolls.length > 0 && (
                    <TableWrap>
                      <table className="data">
                        <thead><tr><th>Roll no</th><th className="num">Qty</th><th>Shade</th><th>Dye lot</th><th /></tr></thead>
                        <tbody>
                          {l.rolls.map((r) => {
                            const setR = (patch) => setLine(l.key, { rolls: l.rolls.map((x) => (x.key === r.key ? { ...x, ...patch } : x)) });
                            return (
                              <tr key={r.key}>
                                <td><TextInput placeholder="auto" value={r.rollNo} onChange={(e) => setR({ rollNo: e.target.value })} /></td>
                                <td><TextInput type="number" min="0" step="any" value={r.qty} onChange={(e) => setR({ qty: e.target.value })} /></td>
                                <td><TextInput value={r.shade} maxLength={20} onChange={(e) => setR({ shade: e.target.value })} /></td>
                                <td><TextInput value={r.dyeLot} maxLength={40} onChange={(e) => setR({ dyeLot: e.target.value })} /></td>
                                <td className="actions">
                                  <button type="button" className="btn btn-sm" onClick={() => setLine(l.key, { rolls: l.rolls.filter((x) => x.key !== r.key) })}>Remove</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </TableWrap>
                  )}
                  {!rollsOk(l) && (
                    <Alert kind="error">The rolls add up to {qty(rollTotal(l))}, but this line receives {qty(l.receivingQty || 0)}.</Alert>
                  )}
                  <button type="button" className="btn btn-sm" onClick={() => setLine(l.key, { rolls: [...l.rolls, blankRoll()] })}>
                    {l.rolls.length ? 'Add a roll' : 'Enter rolls (otherwise one roll is created)'}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <button type="button" className="btn" disabled={!head.vendorId} onClick={() => setLines((ls) => [...ls, blankGrnLine()])}>
        Add another PO line
      </button>
    </>
  );
}

export function GrnDocumentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { doc, error } = useDoc(grnApi.getDocument, id);
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!doc) return <div className="card"><div className="loading-row"><Spinner label="Loading receipt..." /></div></div>;
  return (
    <>
      <PageHeader
        title={`GRN ${doc.grnNo}`}
        actions={<button type="button" className="btn" onClick={() => navigate('/grns')}>Back to list</button>}
      />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>{doc.vendor?.vendorName} · bill {doc.billNo}</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {doc.lineCount} line(s) · {doc.rollCount} roll(s) · ₹ {money(doc.totalAmount)}
            {doc.invoiceTotal ? ` · invoice ₹ ${money(doc.invoiceTotal)}` : ''}
          </span>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <Info label="GRN date" value={fmtDate(doc.grnDate)} />
            <Info label="Bill date" value={fmtDate(doc.billDate)} />
            <Info label="Location" value={doc.location} />
            <Info label="CGST / SGST / IGST" value={`${money(doc.totalCgst)} / ${money(doc.totalSgst)} / ${money(doc.totalIgst)}`} />
            {doc.remarks && <Info label="Remarks" value={doc.remarks} className="span-2" />}
          </div>
        </div>
      </div>
      <div className="card">
        <TableWrap>
          <table className="data">
            <thead>
              <tr><th>Line</th><th>PO line</th><th>Item</th><th className="num">Received</th><th className="num">Rate</th><th className="num">Amount</th><th>Tolerance</th><th /></tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.id} className={`clickable ${l.reversed ? 'inactive' : ''}`} onClick={() => navigate(`/grns/${l.id}`)}>
                  <td className="code">{l.grnNo}</td>
                  <td className="code">
                    <Link to={`/purchase-orders/${l.purchaseOrder?.id}`} onClick={(e) => e.stopPropagation()}>{l.purchaseOrder?.poId}</Link>
                  </td>
                  <td>{[l.item, l.purchaseOrder?.subCategory, l.purchaseOrder?.accessoriesItem, l.purchaseOrder?.colorCode].filter(Boolean).join(' · ')}</td>
                  <td className="num">{qty(l.receivingQty)} {l.uom}</td>
                  <td className="num">{money(l.inventoryRate)}</td>
                  <td className="num">{money(l.amount)}</td>
                  <td>{l.toleranceBreached ? <span className="badge badge-rejected">over</span> : <span className="badge badge-approved">ok</span>}</td>
                  <td>{l.reversed ? <span className="badge badge-inactive">reversed</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>
    </>
  );
}

/**
 * The one-line banner a LINE's own detail screen shows when it belongs to a
 * document with other lines, pointing back at the whole document.
 */
export function PartOfDocument({ header, to, label }) {
  const count = header?._count?.lines ?? 1;
  if (!header || count <= 1) return null;
  return (
    <Alert kind="info">
      This is one line of {label} <Link to={to}><strong>{header.poNo ?? header.quotationNo ?? header.grnNo}</strong></Link>{' '}
      ({count} lines). <Link to={to}>Open the whole document</Link>.
    </Alert>
  );
}
