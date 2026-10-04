/**
 * The printed document, for all eight things this system prints: Purchase
 * Order, Gate Pass, GRN, Purchase Invoice, Job Work Issue, Fabric Issue,
 * Cutting Issue and Cutting Challan.
 *
 * ---------------------------------------------------------------------------
 *  THE PAYLOAD IS ASSEMBLED ON THE SERVER
 *
 *  Every figure on the page - the amount, the amount in words, the variation,
 *  the excess, the chain of references - arrives from `/<module>/:id/print`
 *  already worked out. This file lays it out and nothing more.
 *
 *  That matters more for a printed document than for a screen: the paper leaves
 *  the building. A vendor acts on the purchase order, a guard acts on the gate
 *  pass, a stitching unit acts on the challan. If the browser rounded the
 *  amount differently from the database, the disagreement would be discovered
 *  by somebody holding a piece of paper, weeks later.
 *
 *  A DRAFT MUST NEVER PRINT AS AN INSTRUCTION
 *
 *  The server sends `printable` and `printWarning`. An unapproved PO or an
 *  unposted challan prints with a banner across it saying so, because the
 *  single worst outcome here is a draft that looks like the real thing.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Spinner } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime, fmtEnum, fmtMoney, fmtNum } from '../../utils/format.js';
import {
  cuttingChallans,
  cuttingIssues,
  fabricIssues,
  gatePasses,
  grns,
  jobWorks,
  purchaseOrders,
} from '../../services/erp.js';

/** Which API to ask, by document kind. */
const FETCHERS = {
  'purchase-order': (id) => purchaseOrders.print(id),
  'gate-pass': (id) => gatePasses.print(id),
  grn: (id) => grns.print(id),
  /* The invoice reads the same receipt, and renders what it cost rather than
     what arrived. Two documents from one row - see grn.service.invoiceView. */
  'purchase-invoice': (id) => grns.invoice(id),
  'job-work': (id) => jobWorks.print(id),
  'cutting-issue': (id) => cuttingIssues.print(id),
  'fabric-issue': (id) => fabricIssues.print(id),
  'cutting-challan': (id) => cuttingChallans.print(id),
};

/** Where "Back" goes. */
const BACK_TO = {
  'purchase-order': '/purchase-orders',
  'gate-pass': '/gate-passes',
  grn: '/grns',
  'purchase-invoice': '/grns',
  'job-work': '/job-works',
  'cutting-issue': '/cutting-issues',
  'fabric-issue': '/fabric-issues',
  'cutting-challan': '/cutting-challans',
};

/**
 * The letterhead.
 *
 * A fallback only. Documents that make a legal statement about the company -
 * the purchase invoice, which prints our GSTIN - send `doc.company` from the
 * server, where it comes from configuration rather than from a constant in a
 * React file that nobody would think to update.
 */
/**
 * The letterhead of last resort, used when the server sends no company block -
 * which is every document today, because no `printView` returns one.
 *
 * These are the real registered particulars, taken from the company's own site
 * (sekawati.com, which publishes them as schema.org PostalAddress). `line` used
 * to be the strapline "Bag and tote manufacturers", which was fine under the
 * name at the top of the page and quite wrong in the "Ship to" box, where a
 * vendor reads it as the address to deliver to.
 *
 * The GST number's 08 prefix is Rajasthan, which agrees with the address.
 */
const COMPANY = {
  name: 'Sekawati Impex',
  line: 'G-90, Garment Zone, Sitapura Industrial Area, Jaipur - 302022, Rajasthan, India',
  gstin: '08ADSPG8203G1ZG',
  phone: '+91 80438 26505',
};

/** The letterhead for this document: the server's, falling back to the above. */
function companyOf(doc) {
  if (!doc?.company) return { ...COMPANY };
  const { name, address, gstin, stateName, stateCode, phone } = doc.company;
  return {
    name: name ?? COMPANY.name,
    line:
      [address, stateName && stateCode ? `${stateName} (${stateCode})` : null]
        .filter(Boolean)
        .join(' · ') || COMPANY.line,
    gstin: gstin ?? COMPANY.gstin,
    phone: phone ?? COMPANY.phone,
  };
}

export default function DocumentPrint() {
  const { kind, id } = useParams();
  const navigate = useNavigate();

  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const fetcher = FETCHERS[kind];
    if (!fetcher) {
      setError(`There is nothing called "${kind}" to print.`);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setDoc(await fetcher(id));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [kind, id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="card">
        <div className="loading-row">
          <Spinner label="Preparing the document..." />
        </div>
      </div>
    );
  }
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!doc) return null;

  return (
    <>
      <div className="page-actions no-print" style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <button type="button" className="btn" onClick={() => navigate(BACK_TO[kind] ?? '/')}>
          Back
        </button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <article className="print-sheet">
        <Header doc={doc} />

        {/*
          The banner that stops a draft being mistaken for an instruction.
          Server-decided: `printable` is false until the document is approved
          (PO) or posted (challan).
        */}
        {doc.printable === false && doc.printWarning && (
          <div className="print-draft-watermark">DRAFT — {doc.printWarning}</div>
        )}

        {kind === 'purchase-order' && <PurchaseOrderBody doc={doc} />}
        {kind === 'gate-pass' && <GatePassBody doc={doc} />}
        {kind === 'grn' && <GrnBody doc={doc} />}
        {kind === 'purchase-invoice' && <PurchaseInvoiceBody doc={doc} />}
        {kind === 'job-work' && <JobWorkBody doc={doc} />}
        {kind === 'cutting-issue' && <CuttingIssueBody doc={doc} />}
        {kind === 'fabric-issue' && <FabricIssueChallanBody doc={doc} />}
        {kind === 'cutting-challan' && <CuttingChallanBody doc={doc} />}

        <Signatures names={doc.signatures ?? ['Prepared By', 'Checked By', 'Authorised By']} />

      </article>
    </>
  );
}

// ---------------------------------------------------------------------------
//  Shared pieces
// ---------------------------------------------------------------------------

function Header({ doc }) {
  const company = companyOf(doc);
  const number =
    doc.invoiceNo ?? doc.poId ?? doc.gatePassNo ?? doc.grnNo ?? doc.jobNo ?? doc.challanNo ?? '';
  const date =
    doc.invoiceDate ?? doc.poDate ?? doc.gatePassDate ?? doc.grnDate ?? doc.issueDate ?? doc.printedAt;

  return (
    <div className="print-header">
      <div className="print-brand">
        {/* Served from client/public. A letterhead without the mark is a memo. */}
        <img className="print-logo" src="/logo.jpg" alt="" />
        <div>
        <div className="print-company">{company.name}</div>
        <div className="print-company-sub">{company.line}</div>
        {company.gstin && <div className="print-company-sub">GSTIN: {company.gstin}</div>}
        </div>
      </div>
      <div>
        <div className="print-doc-title">{doc.documentTitle}</div>
        <div className="print-doc-no">{number}</div>
        <div className="print-doc-no">{fmtDate(date)}</div>
      </div>
    </div>
  );
}

function PrintField({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="print-field">
      <div className="print-field-label">{label}</div>
      <div className="print-field-value">{value}</div>
    </div>
  );
}

function PrintGrid({ children }) {
  return <div className="print-grid">{children}</div>;
}

function Party({ title, party }) {
  if (!party) return null;
  return (
    <PrintGrid>
      <PrintField label={title} value={party.name} />
      <PrintField label="Code" value={party.code ?? party.vendorCode} />
      <PrintField label="Address" value={party.address} />
      <PrintField label="Pin code" value={party.pinCode} />
      <PrintField label="GST No" value={party.gstNo} />
      <PrintField label="Contact" value={party.contactPerson} />
      <PrintField label="Phone" value={party.phone} />
    </PrintGrid>
  );
}

function Signatures({ names }) {
  return (
    <div className="print-signatures">
      {names.map((n) => (
        <div key={n} className="print-sign">
          {n}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Purchase Order
// ---------------------------------------------------------------------------

/**
 * A party in its own ruled box - the "To / Ship To" pair every purchase order
 * on paper opens with.
 */
function PoParty({ title, lines }) {
  const rows = lines.filter((l) => l && l.value);
  return (
    <div className="po-party">
      <div className="po-party-title">{title}</div>
      {rows.map(({ label, value, strong }) => (
        <div key={label} className={strong ? 'po-party-name' : 'po-party-line'}>
          {strong ? value : <><span className="po-party-label">{label}:</span> {value}</>}
        </div>
      ))}
    </div>
  );
}

/**
 * One cell of the strip that carries the PO's own particulars.
 *
 * A cell with nothing in it renders nothing at all. A row of dashes under
 * headings like BUYER and STYLE reads as though the document is incomplete;
 * a vendor should see the particulars that exist and not be invited to wonder
 * about the ones that do not.
 */
function PoMeta({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="po-meta-cell">
      <div className="po-meta-label">{label}</div>
      <div className="po-meta-value">{value}</div>
    </div>
  );
}

/**
 * THE PURCHASE ORDER, IN THE FORM A VENDOR EXPECTS TO RECEIVE IT.
 *
 * The gate pass and the GRN are internal - a guard or a store keeper reads
 * them - and the plain label-and-value grid suits them. The challans travel
 * with the goods, so they borrow this layout (see the Challans section below). A purchase order is different: it leaves the building, it is a
 * commercial instrument, and it is read by somebody who has never seen this
 * system. So it is laid out the way purchase orders have always been laid out
 * on paper - the parties boxed and side by side, the particulars in a ruled
 * strip, the goods in a bordered table with the total in the bottom corner,
 * the amount repeated in words, and the terms and the signature below.
 *
 * One line, not many: a purchase order in this system carries a single item
 * (see `purchase_orders`), so the table has one row. It is still a table,
 * because that is what the format is and what a second line would need.
 */
function PurchaseOrderBody({ doc }) {
  const { line, totals, approval } = doc;
  const company = companyOf(doc);
  const excess = Number(line.excessAllowedPct) > 0 ? line.excessAllowedPct : null;

  return (
    <>
      <div className="po-parties">
        <PoParty
          title="Vendor"
          lines={[
            { label: 'Name', value: doc.vendor?.name, strong: true },
            { label: 'Code', value: doc.vendor?.code },
            { label: 'Address', value: doc.vendor?.address },
            { label: 'Pin', value: doc.vendor?.pinCode },
            { label: 'GSTIN', value: doc.vendor?.gstNo },
            { label: 'Contact', value: doc.vendor?.contactPerson },
            { label: 'Phone', value: doc.vendor?.phone },
            { label: 'Email', value: doc.vendor?.email },
          ]}
        />
        {/* Where the goods are to be delivered: us, not the vendor. */}
        <PoParty
          title="Ship to"
          lines={[
            { label: 'Name', value: company.name, strong: true },
            { label: 'Address', value: company.line },
            { label: 'GSTIN', value: company.gstin },
            { label: 'Phone', value: company.phone },
          ]}
        />
      </div>

      <div className="po-meta">
        <PoMeta label="PO No" value={doc.poId} />
        <PoMeta label="PO Date" value={fmtDate(doc.poDate)} />
        <PoMeta label="Order mode" value={fmtEnum(doc.orderMode)} />
        {/*
          THE BUYER ORDER AND STYLE ARE ON THE VENDOR'S COPY, BY INSTRUCTION.

          They were deliberately left off: a supplier who learns whose order
          the cloth is for can go round us to the buyer. The office asked for
          them anyway, because the mill quotes the style back when it
          despatches and a PO that does not name it cannot be matched to a
          delivery. The buyer's NAME is still withheld - the style and our own
          order number identify the job without identifying the customer.
        */}
        <PoMeta label="Order No" value={doc.references?.orderNo} />
        <PoMeta label="Style No" value={doc.references?.styleNo} />
      </div>

      <table className="print-table po-items">
        <thead>
          <tr>
            <th className="po-sr">Sr.</th>
            <th>Description of goods</th>
            <th>HSN</th>
            <th>UOM</th>
            <th className="num">Qty</th>
            <th className="num">Rate</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="po-sr">1</td>
            <td>
              <strong>{line.description}</strong>
              {excess && (
                <div className="po-item-note">
                  Excess permitted on this order: {excess}%
                </div>
              )}
            </td>
            <td>{line.hsnCode ?? '-'}</td>
            <td>{line.uom}</td>
            <td className="num">{fmtNum(line.orderQty, { decimals: 4 })}</td>
            <td className="num">{fmtNum(line.rate, { decimals: 4 })}</td>
            <td className="num">{fmtMoney(line.amount)}</td>
          </tr>
        </tbody>
      </table>

      {/* Odoo sets the total as a small right-hand block rather than a row of
          the table, so the eye lands on it instead of reading across six empty
          cells to reach it. */}
      <div className="po-totals">
        <div className="po-total-line">
          <span>Total</span>
          <b>{fmtMoney(totals.amount)}</b>
        </div>
      </div>

      {/* Spelled out on the server, not by a client-side library. */}
      <div className="po-words">
        <span className="po-words-label">Amount in words</span>
        <span className="po-words-value">{totals.amountInWords}</span>
      </div>

      <div className="po-terms">
        <div className="po-terms-title">Terms &amp; conditions</div>
        <ol>
          <li>This purchase order number must be quoted on all invoices, delivery challans and correspondence.</li>
          <li>Goods must conform to the description, specification and quantity stated above.</li>
          {excess ? (
            <li>Quantity in excess of the order is accepted only up to {excess}%. Anything beyond that is liable to be refused at the gate.</li>
          ) : (
            <li>Quantity in excess of the order is liable to be refused at the gate.</li>
          )}
          <li>Delivery is to the Ship to address above, against a gate pass.</li>
          {doc.remarks && <li style={{ whiteSpace: 'pre-line' }}>{doc.remarks}</li>}
        </ol>
      </div>

      {approval.status !== 'APPROVED' ? null : (
        <div className="po-approval">
          Approved by {approval.approvedByName ?? 'the authorised signatory'}
          {approval.approvedAt ? ` on ${fmtDate(approval.approvedAt)}` : ''}.
        </div>
      )}
      {approval.rejectionReason && (
        <div className="po-approval">Rejected: {approval.rejectionReason}</div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
//  Gate Pass
// ---------------------------------------------------------------------------

function GatePassBody({ doc }) {
  const { line, authorisation, reference } = doc;

  return (
    <>
      <PrintGrid>
        <PrintField label="Type" value={fmtEnum(doc.type)} />
        <PrintField label="Status" value={fmtEnum(doc.status)} />
        <PrintField label="Reference document" value={reference.linkedDocNo} />
        <PrintField label="Reference type" value={fmtEnum(reference.kind)} />
      </PrintGrid>

      <Party title="Party" party={doc.party} />

      <table className="print-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Purpose</th>
            <th>UOM</th>
            <th className="num">Qty</th>
            <th className="num">Received Qty</th>
            <th className="num">Variation %</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{line.item}</td>
            <td>{fmtEnum(line.purpose)}</td>
            <td>{line.uom}</td>
            <td className="num">{fmtNum(line.qty, { decimals: 4 })}</td>
            <td className="num">
              {line.receivedQty === null ? '—' : fmtNum(line.receivedQty, { decimals: 4 })}
            </td>
            <td className="num">{line.variationPctDisplay}%</td>
          </tr>
        </tbody>
      </table>

      <PrintGrid>
        <PrintField label="Authorised by" value={authorisation.authorisedBy} />
        <PrintField
          label="Employee"
          value={
            authorisation.employee
              ? `${authorisation.employee.empName} (${authorisation.employee.empId}) — ${authorisation.employee.designation}`
              : null
          }
        />
        <PrintField label="Cleared by" value={authorisation.clearedByName} />
        <PrintField
          label="Cleared on"
          value={authorisation.clearedAt ? fmtDateTime(authorisation.clearedAt) : null}
        />
        <PrintField label="Remarks" value={doc.remarks} />
      </PrintGrid>
    </>
  );
}

// ---------------------------------------------------------------------------
//  GRN
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
//  Purchase invoice
// ---------------------------------------------------------------------------

/**
 * What the receipt cost, with the GST the vendor charged.
 *
 * ---------------------------------------------------------------------------
 *  EVERY FIGURE IS THE SERVER'S
 *
 *  Not one number on this page is computed here - not the tax, not the total,
 *  not the words. They are read back from the stored receipt, which the database
 *  itself constrains to be internally consistent. A purchase invoice is a
 *  document somebody pays against; a browser arriving at a different total from
 *  the ledger would be found out by a vendor, not by a test.
 *
 *  WHEN NO RATE WAS RECORDED, the page says so rather than printing a zero. A
 *  blank tax block reads as "no tax was charged", which is a different claim
 *  from "nobody recorded what was charged", and only one of them is true.
 * ---------------------------------------------------------------------------
 */
function PurchaseInvoiceBody({ doc }) {
  const { line, tax, references } = doc;
  const interState = tax.supplyType === 'INTER_STATE';

  return (
    <>
      <Party title="Vendor" party={doc.vendor} />

      <PrintGrid>
        <PrintField label="Invoice No (vendor bill)" value={doc.invoiceNo} />
        <PrintField label="Invoice date" value={fmtDate(doc.invoiceDate)} />
        <PrintField label="Received on GRN" value={doc.grnNo} />
        <PrintField label="PO ID" value={references.poId} />
        <PrintField label="Order No" value={references.orderNo} />
        <PrintField label="Gate pass" value={references.gatePassNo} />
        <PrintField label="Supply" value={tax.supplyTypeLabel} />
      </PrintGrid>

      <table className="print-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>HSN</th>
            <th>UOM</th>
            <th className="num">Qty</th>
            <th className="num">Rate</th>
            <th className="num">Taxable Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>{line.description}</strong></td>
            <td>{line.hsnCode ?? '-'}</td>
            <td>{line.uom}</td>
            <td className="num">{fmtNum(line.qty, { decimals: 4 })}</td>
            <td className="num">{fmtNum(line.rate, { decimals: 4 })}</td>
            <td className="num">{fmtMoney(line.amount)}</td>
          </tr>
        </tbody>
      </table>

      {!tax.recorded && (
        <p className="print-note">{tax.note}</p>
      )}

      <table className="print-table print-totals">
        <tbody>
          <tr>
            <td>Taxable value</td>
            <td className="num">{fmtMoney(tax.taxableValue)}</td>
          </tr>

          {tax.recorded && !interState && (
            <>
              <tr>
                <td>CGST @ {tax.halfRateDisplay}%</td>
                <td className="num">{fmtMoney(tax.cgstAmount)}</td>
              </tr>
              <tr>
                <td>SGST @ {tax.halfRateDisplay}%</td>
                <td className="num">{fmtMoney(tax.sgstAmount)}</td>
              </tr>
            </>
          )}

          {tax.recorded && interState && (
            <tr>
              <td>IGST @ {tax.gstRateDisplay}%</td>
              <td className="num">{fmtMoney(tax.igstAmount)}</td>
            </tr>
          )}

          <tr className="print-total-row">
            <td><strong>Invoice total</strong></td>
            <td className="num"><strong>{fmtMoney(doc.invoiceTotal)}</strong></td>
          </tr>
        </tbody>
      </table>

      <PrintGrid>
        <PrintField label="Amount in words" value={doc.invoiceTotalInWords} />
        <PrintField label="Remarks" value={doc.remarks} />
      </PrintGrid>
    </>
  );
}

function GrnBody({ doc }) {
  const { line, references, rolls } = doc;

  return (
    <>
      <Party title="Vendor" party={doc.vendor} />

      <PrintGrid>
        <PrintField label="Bill No" value={doc.billNo} />
        <PrintField label="Purpose" value={fmtEnum(doc.purpose)} />
        <PrintField label="PO ID" value={references.poId} />
        <PrintField label="PO date" value={references.poDate ? fmtDate(references.poDate) : null} />
        <PrintField label="Order No" value={references.orderNo} />
        <PrintField label="Style No" value={references.styleNo} />
        <PrintField label="Gate pass" value={references.gatePassNo} />
        <PrintField label="Location" value={fmtEnum(doc.location)} />
      </PrintGrid>

      <table className="print-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>HSN</th>
            <th>UOM</th>
            <th className="num">Order Qty</th>
            <th className="num">Receiving Qty</th>
            <th className="num">Rate</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>{line.description}</strong>
              {line.itemCode && <div style={{ fontSize: 11 }}>{line.itemCode}</div>}
            </td>
            <td>{line.hsnCode ?? '-'}</td>
            <td>{line.uom}</td>
            <td className="num">{fmtNum(line.orderQty, { decimals: 4 })}</td>
            <td className="num">{fmtNum(line.receivingQty, { decimals: 4 })}</td>
            <td className="num">{fmtNum(line.inventoryRate, { decimals: 4 })}</td>
            <td className="num">{fmtMoney(line.amount)}</td>
          </tr>
        </tbody>
      </table>

      <PrintGrid>
        <PrintField label="Variation" value={`${line.variationPctDisplay}%`} />
        {/*
          THE TOLERANCE IS A CEILING, SO SAY SO WHEN THE RECEIPT IS SHORT.

          `toleranceBreached` is `cumulative > ordered x (1 + tol)` - it asks
          whether TOO MUCH arrived, and nothing else. That is correct: an
          excess limit exists to stop the store filling with material nobody
          ordered, and under-delivery is a different problem with a different
          remedy.

          But printed flat as "Within tolerance" next to a variation of
          -98.89%, it reads as a verdict on the shortfall - the document
          appearing to certify that receiving 10 of 900 is fine. Nobody checked
          that. So a short receipt says which test was actually applied, and
          leaves the judgement to the person reading the note.
        */}
        <PrintField
          label="Tolerance"
          value={(() => {
            if (line.toleranceBreached) return 'BREACHED — over the permitted excess';
            return Number(line.variationPct) < 0
              ? 'Short receipt — the excess limit applies to over-delivery only'
              : 'Within the permitted excess';
          })()}
        />
        <PrintField label="Posted by" value={doc.postedByName} />
        <PrintField label="Posted on" value={doc.postedAt ? fmtDateTime(doc.postedAt) : null} />
      </PrintGrid>

      {rolls?.length > 0 && (
        <table className="print-table">
          <thead>
            <tr>
              <th>Roll No</th>
              <th className="num">Qty</th>
              <th>UOM</th>
              <th>Colour</th>
              <th>GSM</th>
              <th className="num">Width</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {rolls.map((r) => (
              <tr key={r.rollNo}>
                <td className="code">{r.rollNo}</td>
                <td className="num">{fmtNum(r.receivedQty, { decimals: 4 })}</td>
                <td>{r.uom}</td>
                <td>{r.colorCode ?? '-'}</td>
                <td>{r.gsm ?? '-'}</td>
                <td className="num">{r.width ? fmtNum(r.width) : '-'}</td>
                <td>{r.location ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {doc.remarks && (
        <PrintGrid>
          <PrintField label="Remarks" value={doc.remarks} />
        </PrintGrid>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
//  Challans - Job Work, Fabric Issue, Cutting Issue
// ---------------------------------------------------------------------------
//
//  THE THREE CHALLANS LEAVE THE BUILDING, SO THEY ARE SET LIKE THE PO.
//
//  A dyeing house, a printer and a stitching unit each receive one of these
//  with the goods, and read it the way a vendor reads a purchase order: who
//  sent it, who it is for, what is in the bundle, and what they are signing
//  for. So they share the PO's form - the parties side by side, the
//  particulars in a ruled strip, the goods in a numbered table with the total
//  under it - and add the one thing a challan has that an order does not: the
//  receiver's acknowledgement.

/** A fabric roll's particulars, on one line, the way a job worker reads them. */
function fabricSpec(f) {
  return [
    f.colourCode && `Colour ${f.colourCode}`,
    f.content,
    f.count && `Count ${f.count}`,
    f.construction,
    f.gsm && `${f.gsm} GSM`,
    f.width && `Width ${fmtNum(f.width)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Us, as the sender. */
function consignorLines(doc, extra = []) {
  const company = companyOf(doc);
  return [
    { label: 'Name', value: company.name, strong: true },
    { label: 'Address', value: company.line },
    { label: 'GSTIN', value: company.gstin },
    { label: 'Phone', value: company.phone },
    ...extra,
  ];
}

/** A vendor, as the receiver. */
function consigneeLines(party) {
  if (!party) return [];
  return [
    { label: 'Name', value: party.name, strong: true },
    { label: 'Code', value: party.code },
    { label: 'Address', value: party.address },
    { label: 'Pin', value: party.pinCode },
    { label: 'GSTIN', value: party.gstNo },
    { label: 'Phone', value: party.phone },
  ];
}

function ChallanTerms({ items, remarks }) {
  return (
    <div className="po-terms">
      <div className="po-terms-title">Terms &amp; conditions</div>
      <ol>
        {items.filter(Boolean).map((t) => (
          <li key={t}>{t}</li>
        ))}
        {remarks && <li>{remarks}</li>}
      </ol>
    </div>
  );
}

/** What the person taking delivery writes on, before the signature row. */
function ReceiverAcknowledgement() {
  return (
    <div className="challan-ack">
      <div className="po-terms-title">Receiver&rsquo;s acknowledgement</div>
      <p>Received the goods listed above in good order and condition.</p>
      <div className="challan-ack-fields">
        <span>Name: ______________________</span>
        <span>Date: ____________</span>
        <span>Qty received: ____________</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Job Work Issue
// ---------------------------------------------------------------------------

function JobWorkBody({ doc }) {
  const { line, fabric, references } = doc;
  const spec = fabricSpec(fabric);
  const returned = Number(line.receivedQty) > 0;

  return (
    <>
      <div className="po-parties">
        <PoParty title={doc.vendor.label ?? 'Job worker'} lines={consigneeLines(doc.vendor)} />
        <PoParty title="From" lines={consignorLines(doc)} />
      </div>

      <div className="po-meta">
        <PoMeta label="Job No" value={doc.jobNo} />
        <PoMeta label="Date" value={fmtDate(doc.issueDate)} />
        <PoMeta label="Process" value={doc.processLabel} />
        <PoMeta label="Fabric stage" value={fmtEnum(doc.fabricStage)} />
        <PoMeta label="Buyer order" value={references.orderNo} />
        <PoMeta label="Buyer" value={references.buyerName} />
        <PoMeta label="Style" value={references.styleNo} />
        <PoMeta label="Fabric issue" value={references.fabricIssueNo} />
      </div>

      <table className="print-table po-items">
        <thead>
          <tr>
            <th className="po-sr">Sr.</th>
            <th>Description of goods</th>
            <th>Roll No</th>
            <th>UOM</th>
            <th className="num">Qty</th>
            <th className="num">Rate</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="po-sr">1</td>
            <td>
              <strong>
                {doc.processLabel} of {fabric.fabricName ?? 'fabric'}
              </strong>
              {spec && <div className="po-item-note">{spec}</div>}
            </td>
            <td className="code">{fabric.rollNo}</td>
            <td>{line.uom}</td>
            <td className="num">{fmtNum(line.qty, { decimals: 4 })}</td>
            <td className="num">{fmtNum(line.rate, { decimals: 4 })}</td>
            <td className="num">{fmtMoney(line.amount)}</td>
          </tr>
        </tbody>
      </table>

      <div className="po-totals">
        <div className="po-total-line">
          <span>Total</span>
          <b>{fmtMoney(line.amount)}</b>
        </div>
      </div>

      {/* Returns so far - only once something has come back. */}
      {returned && (
        <div className="po-meta">
          <PoMeta label="Qty returned" value={`${fmtNum(line.receivedQty, { decimals: 4 })} ${line.uom}`} />
          <PoMeta label={`${line.lossLabel} %`} value={`${line.shrinkagePctDisplay}%`} />
          <PoMeta label="Allowed %" value={`${line.standardShrinkagePctDisplay}%`} />
          <PoMeta label="Status" value={fmtEnum(doc.status)} />
        </div>
      )}

      <ChallanTerms
        items={[
          `The fabric is sent for ${doc.processLabel.toLowerCase()} only and remains the property of ${companyOf(doc).name}. It is not for sale.`,
          `Quote Job No ${doc.jobNo} on the return challan and on the invoice.`,
          `${line.lossLabel} of up to ${line.standardShrinkagePctDisplay}% is allowed. A return short by more than that is sent for scrutiny.`,
          'Check the quantity on receipt and report any shortage or damage before processing.',
        ]}
        remarks={doc.remarks}
      />

      <ReceiverAcknowledgement />
    </>
  );
}

// ---------------------------------------------------------------------------
//  Fabric Issue - the challan to the job worker
// ---------------------------------------------------------------------------

function FabricIssueChallanBody({ doc }) {
  const { line, fabric, po, references } = doc;
  const spec = fabricSpec(fabric);
  const process = fmtEnum(doc.purpose);

  return (
    <>
      <div className="po-parties">
        <PoParty title={doc.vendor?.label ?? 'Consignee'} lines={consigneeLines(doc.vendor)} />
        <PoParty
          title="From"
          lines={consignorLines(doc, [{ label: 'Dispatched from', value: line.from }])}
        />
      </div>

      <div className="po-meta">
        <PoMeta label="Challan No" value={doc.challanNo} />
        <PoMeta label="Date" value={fmtDate(doc.issueDate)} />
        <PoMeta label="Purpose" value={process} />
        <PoMeta label="Job work PO" value={po ? `${po.jobWorkNo} (part ${po.challanSeq})` : null} />
        <PoMeta label="Buyer order" value={references.orderNo} />
        <PoMeta label="Buyer" value={references.buyerName} />
        <PoMeta label="Style" value={references.styleNo} />
        <PoMeta label="Issued by" value={doc.issuedBy} />
      </div>

      <table className="print-table po-items">
        <thead>
          <tr>
            <th className="po-sr">Sr.</th>
            <th>Description of goods</th>
            <th>Roll No</th>
            <th>UOM</th>
            <th className="num">Qty</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="po-sr">1</td>
            <td>
              <strong>{fabric.fabricName ?? 'Fabric'}</strong>
              {spec && <div className="po-item-note">{spec}</div>}
            </td>
            <td className="code">{fabric.rollNo}</td>
            <td>{line.uom}</td>
            <td className="num">{fmtNum(line.qty, { decimals: 4 })}</td>
          </tr>
        </tbody>
      </table>

      <div className="po-totals">
        <div className="po-total-line">
          <span>Total quantity</span>
          <b>
            {fmtNum(line.qty, { decimals: 4 })} {line.uom}
          </b>
        </div>
      </div>

      {/* Where this challan sits in its PO: a PO for 10,000 may go out as
          5,000 + 5,000, and the vendor should see which part this is. */}
      {po && (
        <>
          <div className="po-terms-title">Against job work PO {po.jobWorkNo}</div>
          <table className="print-table po-items">
            <thead>
              <tr>
                <th className="num">PO qty</th>
                <th className="num">Sent earlier</th>
                <th className="num">This challan</th>
                <th className="num">Sent to date</th>
                <th className="num">Balance to send</th>
                <th>UOM</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="num">{fmtNum(po.orderedQty, { decimals: 4 })}</td>
                <td className="num">{fmtNum(po.previouslySentQty, { decimals: 4 })}</td>
                <td className="num">
                  <strong>{fmtNum(po.thisChallanQty, { decimals: 4 })}</strong>
                </td>
                <td className="num">{fmtNum(po.sentToDateQty, { decimals: 4 })}</td>
                <td className="num">{fmtNum(po.balanceQty, { decimals: 4 })}</td>
                <td>{po.uom}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <ChallanTerms
        items={[
          `Sent for ${process.toLowerCase()} job work only. The fabric remains the property of ${companyOf(doc).name} and is not for sale.`,
          `Quote Challan No ${doc.challanNo}${po ? ` and Job work PO ${po.jobWorkNo}` : ''} on the return challan and on the invoice.`,
          'Check the quantity on receipt and report any shortage or damage before processing.',
        ]}
        remarks={doc.remarks}
      />

      <ReceiverAcknowledgement />
    </>
  );
}

// ---------------------------------------------------------------------------
//  Cutting Issue
// ---------------------------------------------------------------------------

function CuttingIssueBody({ doc }) {
  const { line, order, unit, references, excess } = doc;
  const handles = Number(line.handleIssued) > 0;
  const totalPcs = Number(line.cuttingPcsIssued) + Number(line.handleIssued);

  return (
    <>
      <div className="po-parties">
        <PoParty
          title="Stitching unit"
          lines={[
            { label: 'Name', value: unit.firmName, strong: true },
            { label: 'Container No', value: unit.containerNo },
          ]}
        />
        <PoParty title="From" lines={consignorLines(doc)} />
      </div>

      <div className="po-meta">
        <PoMeta label="Challan No" value={doc.challanNo} />
        <PoMeta label="Date" value={fmtDate(doc.issueDate)} />
        <PoMeta label="Buyer order" value={order.orderNo} />
        <PoMeta label="Buyer" value={order.buyerName} />
        <PoMeta label="Style" value={order.styleNo} />
        <PoMeta label="Delivery date" value={order.deliveryDate ? fmtDate(order.deliveryDate) : null} />
        <PoMeta label="Plan" value={references.planNo} />
        <PoMeta
          label="Plan approval"
          value={references.approvalNo ? `${references.approvalNo} (v${references.approvalVersion})` : null}
        />
      </div>

      <table className="print-table po-items">
        <thead>
          <tr>
            <th className="po-sr">Sr.</th>
            <th>Description of goods</th>
            <th>UOM</th>
            <th className="num">Qty</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="po-sr">1</td>
            <td>
              <strong>Cut pieces &mdash; {order.styleNo}</strong>
              <div className="po-item-note">
                {[
                  order.styleDescription,
                  `Planned cutting ${fmtNum(line.plannedCutting)}`,
                  `due to this unit ${fmtNum(line.unitWiseCuttingPcsToBeIssued)}`,
                  references.rollNo && `from roll ${references.rollNo}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </td>
            <td>{line.uom}</td>
            <td className="num">{fmtNum(line.cuttingPcsIssued)}</td>
          </tr>
          {handles && (
            <tr>
              <td className="po-sr">2</td>
              <td>
                <strong>Handles &mdash; {order.styleNo}</strong>
              </td>
              <td>{line.uom}</td>
              <td className="num">{fmtNum(line.handleIssued)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="po-totals">
        <div className="po-total-line">
          <span>Total pieces</span>
          <b>{fmtNum(totalPcs)}</b>
        </div>
      </div>

      {/* An authorised over-cut prints its authority. A challan that cut more
          than the plan permitted must carry the reason it was allowed to. */}
      {excess && (
        <div className="challan-note">
          <strong>Authorised excess:</strong> {fmtNum(excess.overLimitQty)} pcs over the permitted{' '}
          {fmtNum(excess.maxPermittedQty)} ({excess.permittedPctDisplay}% on {fmtNum(excess.baseQty)}),
          approved by {excess.approvedByName}
          {excess.approvedAt ? ` on ${fmtDate(excess.approvedAt)}` : ''}. Reason: {excess.reason}
        </div>
      )}

      <ChallanTerms
        items={[
          `Quote Challan No ${doc.challanNo} when returning stitched goods against it.`,
          'Count the pieces on receipt and note any shortage on this challan before signing.',
        ]}
        remarks={doc.remarks}
      />

      <ReceiverAcknowledgement />
    </>
  );
}

// ---------------------------------------------------------------------------
//  Cutting Challan
// ---------------------------------------------------------------------------

/**
 * The cutting department's requirement, as the store receives it.
 *
 * Deliberately NOT laid out like the issue challans above it. Those are
 * despatch notes - goods leaving, one consignee, an acknowledgement to sign.
 * This one never leaves the building and moves nothing: it asks the store for
 * materials, and the store's question is "what is still owed", not "what was
 * asked for months ago". So the quantity table leads with Outstanding, and
 * there is no consignee block and no receiver acknowledgement.
 */
function CuttingChallanBody({ doc }) {
  const { order, references, lines, totals } = doc;
  const partlyIssued = lines.some((l) => Number(l.issuedQty) > 0);

  return (
    <>
      <div className="po-meta">
        <PoMeta label="Challan No" value={doc.challanNo} />
        <PoMeta label="Date" value={fmtDate(doc.challanDate)} />
        <PoMeta label="Required by" value={doc.requiredBy ? fmtDate(doc.requiredBy) : null} />
        <PoMeta label="Buyer order" value={order.orderNo} />
        <PoMeta label="Buyer" value={order.buyerName} />
        <PoMeta label="Style" value={order.styleNo} />
        <PoMeta label="Container No" value={order.containerNo} />
        <PoMeta label="Plan" value={references.planNo} />
        <PoMeta
          label="Plan approval"
          value={
            references.approvalNo
              ? `${references.approvalNo}${references.approvalRound ? ` (v${references.approvalRound})` : ''}`
              : null
          }
        />
        <PoMeta
          label="Approved by"
          value={doc.approvedByName ? `${doc.approvedByName}${doc.approvedAt ? ` · ${fmtDate(doc.approvedAt)}` : ''}` : null}
        />
      </div>

      <table className="print-table po-items">
        <thead>
          <tr>
            <th className="po-sr">Sr.</th>
            <th>Material required</th>
            <th>UOM</th>
            <th className="num">Required</th>
            {/* Only once something has actually been issued. On a fresh
                challan these two columns would be a column of zeroes and a
                column repeating Required, which reads as noise. */}
            {partlyIssued && <th className="num">Issued</th>}
            {partlyIssued && <th className="num">Outstanding</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.lineNo}>
              <td className="po-sr">{l.lineNo}</td>
              <td>
                <strong>{l.description}</strong>
                {l.note && <div className="po-item-note">{l.note}</div>}
              </td>
              <td>{l.uom}</td>
              <td className="num">{fmtNum(l.requiredQty, { decimals: 4 })}</td>
              {partlyIssued && <td className="num">{fmtNum(l.issuedQty, { decimals: 4 })}</td>}
              {partlyIssued && (
                <td className="num">
                  <strong>{fmtNum(l.outstandingQty, { decimals: 4 })}</strong>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/*
        Totals only when every line is in one unit. Metres and pieces do not
        add up, and the server sends null rather than a mixed figure - so the
        line count is printed instead, which is always true.
      */}
      <div className="po-totals">
        {totals.uom ? (
          <>
            <div className="po-total-line">
              <span>Total required</span>
              <b>
                {fmtNum(totals.requiredQty, { decimals: 4 })} {totals.uom}
              </b>
            </div>
            {partlyIssued && (
              <div className="po-total-line">
                <span>Still outstanding</span>
                <b>
                  {fmtNum(totals.outstandingQty, { decimals: 4 })} {totals.uom}
                </b>
              </div>
            )}
          </>
        ) : (
          <div className="po-total-line">
            <span>Lines</span>
            <b>{totals.lineCount}</b>
          </div>
        )}
      </div>

      {/* A challan whose balance was written off says so on its face, or the
          store spends a week looking for materials nobody is going to issue. */}
      {doc.closedShort && (
        <div className="challan-note">
          <strong>Closed short.</strong> The outstanding quantity on this challan has been
          abandoned deliberately and will not be issued.
          {doc.closedShortReason ? ` Reason: ${doc.closedShortReason}` : ''}
        </div>
      )}

      <ChallanTerms
        items={[
          `Issue only against this challan and quote ${doc.challanNo} on the issue note.`,
          references.chain
            ? `Authority: ${references.chain}. Check the plan approval before issuing.`
            : 'Check the plan approval before issuing.',
          'Report any shortage against a line rather than issuing a substitute material.',
        ]}
        remarks={doc.remarks}
      />
    </>
  );
}
