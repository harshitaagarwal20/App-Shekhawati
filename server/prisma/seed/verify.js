/**
 * Offline seed-data verification.
 *
 * Checks that every cross-reference in the seed data resolves BEFORE the seed
 * touches a database, and recomputes each workbook formula so the stored value
 * can be compared against it. Runs with no DATABASE_URL:
 *
 *     node prisma/seed/verify.js
 */

import { masterLists } from './data/masterLists.js';
import { roles, buildPermissions } from './data/rbac.js';
import { buyers, vendors, employees, styles } from './data/masters.js';
import {
  buyerOrders,
  plannings,
  vendorQuotations,
  purchaseOrders,
  gatePasses,
  grns,
  fabricRolls,
  fabricIssues,
  dyeIssues,
  dyeingReceipts,
  printings,
  fabricScrutinies,
  planApprovals,
  cuttingIssues,
  documentSequences,
} from './data/transactions.js';

const errors = [];
const warnings = [];

const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const set = (arr, key) => new Set(arr.map((x) => x[key]));
const listValues = (code) => {
  const l = masterLists.find((m) => m.code === code);
  return l ? new Set(l.values) : null;
};

const buyerNames = set(buyers, 'buyerName');
const vendorNames = set(vendors, 'vendorName');
const employeeNames = set(employees, 'empName');
const styleNos = set(styles, 'styleNo');
const orderNos = set(buyerOrders, 'orderNo');
const quotationNos = set(vendorQuotations, 'quotationNo');
const poIds = set(purchaseOrders, 'poId');
const grnNos = set(grns, 'grnNo');
const rollNos = set(fabricRolls, 'rollNo');
const issueNos = set(fabricIssues, 'issueNo');
const dyeIssueNos = set(dyeIssues, 'dyeIssueNo');
const gatePassNos = set(gatePasses, 'gatePassNo');
const approvalNos = set(planApprovals, 'approvalNo');

// --- 1. uniqueness of every document number --------------------------------
function checkUnique(label, arr, key) {
  const seen = new Set();
  for (const row of arr) {
    if (seen.has(row[key])) fail(`${label}: duplicate ${key} "${row[key]}"`);
    seen.add(row[key]);
  }
}
checkUnique('buyers', buyers, 'buyerCode');
checkUnique('vendors', vendors, 'vendorCode');
checkUnique('employees', employees, 'empId');
checkUnique('styles', styles, 'styleNo');
checkUnique('buyerOrders', buyerOrders, 'orderNo');
checkUnique('vendorQuotations', vendorQuotations, 'quotationNo');
checkUnique('purchaseOrders', purchaseOrders, 'poId');
checkUnique('gatePasses', gatePasses, 'gatePassNo');
checkUnique('grns', grns, 'grnNo');
checkUnique('fabricRolls', fabricRolls, 'rollNo');
checkUnique('fabricIssues', fabricIssues, 'issueNo');
checkUnique('dyeIssues', dyeIssues, 'dyeIssueNo');
checkUnique('dyeingReceipts', dyeingReceipts, 'receiptNo');
checkUnique('printings', printings, 'printingNo');
checkUnique('fabricScrutinies', fabricScrutinies, 'scrutinyNo');
checkUnique('planApprovals', planApprovals, 'approvalNo');
checkUnique('cuttingIssues', cuttingIssues, 'challanNo');

// --- 2. master-list membership ---------------------------------------------
function checkList(label, value, listCode) {
  if (value === null || value === undefined || value === '') return;
  const values = listValues(listCode);
  if (!values) return fail(`${label}: master list "${listCode}" is not seeded`);
  if (!values.has(value)) fail(`${label}: "${value}" is not a value of list ${listCode}`);
}

for (const b of buyers) {
  checkList(`buyer ${b.buyerCode}.country`, b.country, 'Country');
  checkList(`buyer ${b.buyerCode}.currency`, b.currency, 'Currency');
  checkList(`buyer ${b.buyerCode}.shipMode`, b.shipMode, 'ShipMode');
  checkList(`buyer ${b.buyerCode}.paymentTerms`, b.paymentTerms, 'PaymentTerms');
  checkList(`buyer ${b.buyerCode}.freightTerms`, b.freightTerms, 'FreightTerms');
  checkList(`buyer ${b.buyerCode}.priceTerms`, b.priceTerms, 'PriceTerms');
}
for (const v of vendors) checkList(`vendor ${v.vendorCode}.category`, v.category, 'VendorCategory');
for (const e of employees) {
  checkList(`employee ${e.empId}.department`, e.department, 'Department');
  checkList(`employee ${e.empId}.designation`, e.designation, 'Designation');
}
for (const s of styles) {
  checkList(`style ${s.styleNo}.category`, s.category, 'StyleCategory');
  checkList(`style ${s.styleNo}.fabricContent`, s.fabricContent, 'FabricContent');
  checkList(`style ${s.styleNo}.sizeGroup`, s.sizeGroup, 'SizeGroup');
  if (!buyerNames.has(s.buyerName)) fail(`style ${s.styleNo}: unknown buyer "${s.buyerName}"`);
  for (const l of s.bom) {
    checkList(`style ${s.styleNo} bom.itemCategory`, l.itemCategory, 'ItemCategory');
    checkList(`style ${s.styleNo} bom.subCategory`, l.subCategory, 'FabricSubCat');
    checkList(`style ${s.styleNo} bom.accessoriesItem`, l.accessoriesItem, 'AccessoriesItem');
    checkList(`style ${s.styleNo} bom.uom`, l.uom, 'UOM');
  }
}

// --- 3. transaction cross-references ---------------------------------------
for (const o of buyerOrders) {
  if (!buyerNames.has(o.buyerName)) fail(`order ${o.orderNo}: unknown buyer "${o.buyerName}"`);
  if (!styleNos.has(o.styleNo)) fail(`order ${o.orderNo}: unknown style "${o.styleNo}"`);
  checkList(`order ${o.orderNo}.colorCode`, o.colorCode, 'ColorCode');
  checkList(`order ${o.orderNo}.currency`, o.currency, 'Currency');
  checkList(`order ${o.orderNo}.shipMode`, o.shipMode, 'ShipMode');
  checkList(`order ${o.orderNo}.sizeGroup`, o.sizeGroup, 'SizeGroup');
  const style = styles.find((s) => s.styleNo === o.styleNo);
  if (style && style.buyerName !== o.buyerName) {
    warn(`order ${o.orderNo}: style ${o.styleNo} belongs to buyer "${style.buyerName}" but the order is for "${o.buyerName}"`);
  }
}

for (const p of plannings) {
  if (!orderNos.has(p.orderNo)) fail(`planning for ${p.orderNo}: unknown order`);
  checkList(`planning ${p.orderNo}.containerNo`, p.containerNo, 'ContainerNo');
  for (const l of p.lines) checkList(`planning ${p.orderNo} line.unit`, l.unit, 'StitchingUnit');

  // Business rule (Current Process -> Planning sheet): the day-wise
  // deliverable sizes must add up to the order quantity.
  const order = buyerOrders.find((o) => o.orderNo === p.orderNo);
  const sum = p.lines.reduce((a, l) => a + Number(l.deliverableSize), 0);
  if (order && sum !== Number(order.orderQty)) {
    warn(`planning ${p.orderNo}: deliverable sizes total ${sum} but order qty is ${order.orderQty}`);
  }

  // Phase 4 ceiling rule, checked here so the seed can never ship a plan the
  // API would refuse: planned qty must not exceed the order's effective qty -
  // order qty plus the excess the Director actually granted, and no more.
  if (order) {
    const permitted = Number(order.orderQty) * (1 + Number(order.excessPct));
    if (sum > permitted) {
      fail(
        `planning ${p.orderNo}: deliverable sizes total ${sum}, over the ${permitted} the order permits ` +
          `(${order.orderQty} + ${Number(order.excessPct) * 100}% excess)`,
      );
    }
  }

  // No day may have more pieces allotted to cutting than it is due to deliver.
  for (const l of p.lines) {
    if (l.cuttingPcsAllotted !== null && l.cuttingPcsAllotted !== undefined) {
      if (Number(l.cuttingPcsAllotted) > Number(l.deliverableSize)) {
        fail(
          `planning ${p.orderNo} line ${l.lineDate}: ${l.cuttingPcsAllotted} cutting pcs allotted to a ` +
            `day delivering only ${l.deliverableSize}`,
        );
      }
    }
  }
}

for (const q of vendorQuotations) {
  if (!vendorNames.has(q.vendorName)) fail(`quotation ${q.quotationNo}: unknown vendor "${q.vendorName}"`);
  if (q.orderNo && !orderNos.has(q.orderNo)) fail(`quotation ${q.quotationNo}: unknown order "${q.orderNo}"`);
  checkList(`quotation ${q.quotationNo}.item`, q.item, 'ItemCategory');
  checkList(`quotation ${q.quotationNo}.uom`, q.uom, 'UOM');
  checkList(`quotation ${q.quotationNo}.authorisedBy`, q.authorisedBy, 'AuthorisedBy');
  if (q.subCategory) checkList(`quotation ${q.quotationNo}.subCategory`, q.subCategory, 'FabricSubCat');
  if (q.accessoriesItem) {
    checkList(`quotation ${q.quotationNo}.accessoriesItem`, q.accessoriesItem, 'AccessoriesItem');
  }

  // Phase 5: a rejected quotation must carry a reason. The seed takes it from
  // the Remarks column, which is where the workbook records one.
  if (q.authorisationStatus === 'REJECTED' && !q.remarks) {
    fail(`quotation ${q.quotationNo}: rejected with no reason in Remarks to carry over`);
  }
}

for (const po of purchaseOrders) {
  if (!vendorNames.has(po.vendorName)) fail(`PO ${po.poId}: unknown vendor "${po.vendorName}"`);
  if (po.orderNo && !orderNos.has(po.orderNo)) fail(`PO ${po.poId}: unknown order "${po.orderNo}"`);
  if (po.styleNo && !styleNos.has(po.styleNo)) fail(`PO ${po.poId}: unknown style "${po.styleNo}"`);
  if (po.quotationNo && !quotationNos.has(po.quotationNo)) fail(`PO ${po.poId}: unknown quotation "${po.quotationNo}"`);
  checkList(`PO ${po.poId}.item`, po.item, 'ItemCategory');
  checkList(`PO ${po.poId}.subCategory`, po.subCategory, 'FabricSubCat');
  checkList(`PO ${po.poId}.accessoriesItem`, po.accessoriesItem, 'AccessoriesItem');
  checkList(`PO ${po.poId}.uom`, po.uom, 'UOM');
  checkList(`PO ${po.poId}.gsm`, po.gsm, 'GSM');
  checkList(`PO ${po.poId}.content`, po.content, 'FabricContent');
  checkList(`PO ${po.poId}.colorCode`, po.colorCode, 'ColorCode');
  checkList(`PO ${po.poId}.count`, po.count, 'Count');

  // PO sheet row 3: "Vendor initial + no".
  const vendor = vendors.find((v) => v.vendorName === po.vendorName);
  if (vendor && !po.poId.startsWith(`${vendor.poInitials}-`)) {
    fail(`PO ${po.poId}: does not follow "vendor initial + no" for ${po.vendorName} (${vendor.poInitials})`);
  }
  if (po.approvalStatus === 'APPROVED' && !po.approvedAt) {
    fail(`PO ${po.poId}: approved but has no approvedAt (violates CHECK purchase_orders_approved_at_present)`);
  }
}

for (const gp of gatePasses) {
  checkList(`gate pass ${gp.gatePassNo}.uom`, gp.uom, 'UOM');
  const known = poIds.has(gp.linkedDocNo) || dyeIssueNos.has(gp.linkedDocNo) ||
    cuttingIssues.some((c) => c.challanNo === gp.linkedDocNo) ||
    printings.some((p) => p.printingNo === gp.linkedDocNo);
  if (!known) warn(`gate pass ${gp.gatePassNo}: linked doc "${gp.linkedDocNo}" resolves to no seeded document`);
}

for (const g of grns) {
  if (!poIds.has(g.poId)) fail(`GRN ${g.grnNo}: unknown PO "${g.poId}"`);
  if (g.gatePassNo && !gatePassNos.has(g.gatePassNo)) fail(`GRN ${g.grnNo}: unknown gate pass "${g.gatePassNo}"`);
  checkList(`GRN ${g.grnNo}.uom`, g.uom, 'UOM');
  const po = purchaseOrders.find((p) => p.poId === g.poId);
  if (po && Number(g.orderQty) !== Number(po.orderQty)) {
    fail(`GRN ${g.grnNo}: order qty ${g.orderQty} does not match PO ${g.poId} qty ${po.orderQty}`);
  }
}

for (const r of fabricRolls) {
  if (r.grnNo && !grnNos.has(r.grnNo)) fail(`roll ${r.rollNo}: unknown GRN "${r.grnNo}"`);
  if (!vendorNames.has(r.vendorName)) fail(`roll ${r.rollNo}: unknown vendor "${r.vendorName}"`);
  checkList(`roll ${r.rollNo}.colorCode`, r.colorCode, 'ColorCode');
  checkList(`roll ${r.rollNo}.content`, r.content, 'FabricContent');
  checkList(`roll ${r.rollNo}.gsm`, r.gsm, 'GSM');
  checkList(`roll ${r.rollNo}.count`, r.count, 'Count');
  checkList(`roll ${r.rollNo}.construction`, r.construction, 'Construction');
  checkList(`roll ${r.rollNo}.uom`, r.uom, 'UOM');

  // The seed computes balance = received - issued + returned; it must not go
  // negative or the CHECK fabric_rolls_balance_non_negative will reject it.
  const issued = fabricIssues.filter((f) => f.rollNo === r.rollNo)
    .reduce((a, f) => a + Number(f.fabricQtyIssued), 0);
  const returned = dyeingReceipts.filter((d) => d.rollNo === r.rollNo)
    .reduce((a, d) => a + Number(d.qtyReceived), 0);
  const balance = Number(r.receivedQty) - issued + returned;
  if (balance < 0) fail(`roll ${r.rollNo}: computed balance ${balance} is negative`);
}

for (const f of fabricIssues) {
  if (!rollNos.has(f.rollNo)) fail(`fabric issue ${f.issueNo}: unknown roll "${f.rollNo}"`);
  if (!orderNos.has(f.orderNo)) fail(`fabric issue ${f.issueNo}: unknown order "${f.orderNo}"`);
  if (!styleNos.has(f.styleNo)) fail(`fabric issue ${f.issueNo}: unknown style "${f.styleNo}"`);
  if (!employeeNames.has(f.issuedByName)) fail(`fabric issue ${f.issueNo}: unknown employee "${f.issuedByName}"`);
  if (f.vendorName && !vendorNames.has(f.vendorName)) fail(`fabric issue ${f.issueNo}: unknown vendor "${f.vendorName}"`);
  checkList(`fabric issue ${f.issueNo}.colorCode`, f.colorCode, 'ColorCode');
}

for (const d of dyeIssues) {
  if (!rollNos.has(d.rollNo)) fail(`dye issue ${d.dyeIssueNo}: unknown roll "${d.rollNo}"`);
  if (!vendorNames.has(d.vendorName)) fail(`dye issue ${d.dyeIssueNo}: unknown vendor "${d.vendorName}"`);
  if (d.issueNo && !issueNos.has(d.issueNo)) fail(`dye issue ${d.dyeIssueNo}: unknown fabric issue "${d.issueNo}"`);
  if (d.orderNo && !orderNos.has(d.orderNo)) fail(`dye issue ${d.dyeIssueNo}: unknown order "${d.orderNo}"`);
  checkList(`dye issue ${d.dyeIssueNo}.uom`, d.uom, 'UOM');
  checkList(`dye issue ${d.dyeIssueNo}.colourCode`, d.colourCode, 'ColorCode');
}

for (const r of dyeingReceipts) {
  if (!dyeIssueNos.has(r.dyeIssueNo)) fail(`dyeing receipt ${r.receiptNo}: unknown dye issue "${r.dyeIssueNo}"`);
  if (!rollNos.has(r.rollNo)) fail(`dyeing receipt ${r.receiptNo}: unknown roll "${r.rollNo}"`);
  const di = dyeIssues.find((d) => d.dyeIssueNo === r.dyeIssueNo);
  if (di && di.rollNo !== r.rollNo) {
    fail(`dyeing receipt ${r.receiptNo}: roll ${r.rollNo} does not match dye issue ${r.dyeIssueNo} roll ${di.rollNo}`);
  }
  if (di && Number(di.qty) !== Number(r.qtyIssued)) {
    fail(`dyeing receipt ${r.receiptNo}: qtyIssued ${r.qtyIssued} does not match dye issue qty ${di.qty}`);
  }
  const shrink = (Number(r.qtyIssued) - Number(r.qtyReceived)) / Number(r.qtyIssued);
  const flagged = shrink > Number(r.standardShrinkageAllowed);
  const expected = flagged ? 'SENT_TO_SCRUTINY' : 'OK';
  if (r.status !== expected) {
    warn(`dyeing receipt ${r.receiptNo}: shrinkage ${(shrink * 100).toFixed(2)}% vs allowed ${(Number(r.standardShrinkageAllowed) * 100).toFixed(0)}% suggests status ${expected}, workbook says ${r.status}`);
  }
}

for (const p of printings) {
  if (!orderNos.has(p.orderNo)) fail(`printing ${p.printingNo}: unknown order "${p.orderNo}"`);
  if (!styleNos.has(p.styleNo)) fail(`printing ${p.printingNo}: unknown style "${p.styleNo}"`);
  if (!vendorNames.has(p.vendorName)) fail(`printing ${p.printingNo}: unknown vendor "${p.vendorName}"`);
  checkList(`printing ${p.printingNo}.uom`, p.uom, 'UOM');
}

for (const s of fabricScrutinies) {
  if (!rollNos.has(s.rollNo)) fail(`scrutiny ${s.scrutinyNo}: unknown roll "${s.rollNo}"`);
  if (!orderNos.has(s.orderNo)) fail(`scrutiny ${s.scrutinyNo}: unknown order "${s.orderNo}"`);
  if (!styleNos.has(s.styleNo)) fail(`scrutiny ${s.scrutinyNo}: unknown style "${s.styleNo}"`);
  if (!employeeNames.has(s.checkedByName)) fail(`scrutiny ${s.scrutinyNo}: unknown checker "${s.checkedByName}"`);
  checkList(`scrutiny ${s.scrutinyNo}.defectType`, s.defectType, 'DefectType');
  checkList(`scrutiny ${s.scrutinyNo}.authorisedBy`, s.authorisedBy, 'AuthorisedBy');
}

for (const a of planApprovals) {
  if (!orderNos.has(a.orderNo)) fail(`plan approval ${a.approvalNo}: unknown order "${a.orderNo}"`);
  checkList(`plan approval ${a.approvalNo}.containerNo`, a.containerNo, 'ContainerNo');
  if (a.approvalStatus === 'APPROVED' && !a.approvedDate) {
    fail(`plan approval ${a.approvalNo}: approved but no approvedDate (violates CHECK plan_approvals_approved_date_present)`);
  }
  if (a.approvalStatus === 'REJECTED' && !a.rejectionReason) {
    fail(`plan approval ${a.approvalNo}: rejected but no rejectionReason (violates CHECK plan_approvals_rejection_reason_present)`);
  }
}

for (const c of cuttingIssues) {
  if (!orderNos.has(c.orderNo)) fail(`cutting issue ${c.challanNo}: unknown order "${c.orderNo}"`);
  if (!styleNos.has(c.styleNo)) fail(`cutting issue ${c.challanNo}: unknown style "${c.styleNo}"`);
  if (c.approvalNo && !approvalNos.has(c.approvalNo)) fail(`cutting issue ${c.challanNo}: unknown plan approval "${c.approvalNo}"`);
  if (c.issueNo && !issueNos.has(c.issueNo)) fail(`cutting issue ${c.challanNo}: unknown fabric issue "${c.issueNo}"`);
  checkList(`cutting issue ${c.challanNo}.firmName`, c.firmName, 'StitchingUnit');
  checkList(`cutting issue ${c.challanNo}.containerNo`, c.containerNo, 'ContainerNo');

  const order = buyerOrders.find((o) => o.orderNo === c.orderNo);
  if (order && Number(c.plannedCutting) !== Number(order.orderQty)) {
    warn(`cutting issue ${c.challanNo}: plannedCutting ${c.plannedCutting} differs from order qty ${order.orderQty}`);
  }
  // Cutting Issue sheet: Container No is a formula pulling from Planning via Order No.
  const plan = plannings.find((p) => p.orderNo === c.orderNo);
  if (plan && plan.containerNo !== c.containerNo) {
    fail(`cutting issue ${c.challanNo}: container ${c.containerNo} != planning container ${plan.containerNo}`);
  }
}

// --- 4. document sequences --------------------------------------------------
const poSeqScopes = new Set(
  documentSequences.filter((d) => d.documentType === 'PURCHASE_ORDER').map((d) => d.scopeKey),
);
for (const v of vendors) {
  if (!poSeqScopes.has(v.poInitials)) fail(`no PURCHASE_ORDER sequence for vendor initials "${v.poInitials}"`);
}
const seqSeen = new Set();
for (const d of documentSequences) {
  const k = `${d.documentType}|${d.scopeKey}`;
  if (seqSeen.has(k)) fail(`duplicate document sequence ${k}`);
  seqSeen.add(k);
  if (d.nextNumber < 1) fail(`document sequence ${k}: nextNumber must be >= 1`);
}

// --- 5. RBAC ----------------------------------------------------------------
const permCodes = new Set(buildPermissions().map((p) => p.code));
for (const r of roles) {
  if (r.permissions === '*') continue;
  for (const pat of r.permissions) {
    if (pat.includes('*')) continue;
    if (!permCodes.has(pat)) fail(`role ${r.code}: permission "${pat}" does not exist`);
  }
}

// --- 6. out-of-scope guard --------------------------------------------------
const OUT_OF_SCOPE = [
  'stitching_record', 'hourly_monitoring', 'qc_size', 'qc_defect',
  'internal_quality', 'checker_report', 'finished_checker', 'external_secondary',
  'alter_report', 'spot_rectification', 'rejected', 'packing', 'needle_checking',
  'dispatch', 'reconciliation',
];

// --- report ----------------------------------------------------------------
const counts = {
  masterLists: masterLists.length,
  masterListValues: masterLists.reduce((a, l) => a + l.values.length, 0),
  permissions: permCodes.size,
  roles: roles.length,
  buyers: buyers.length,
  vendors: vendors.length,
  employees: employees.length,
  styles: styles.length,
  styleBomLines: styles.reduce((a, s) => a + s.bom.length, 0),
  buyerOrders: buyerOrders.length,
  plannings: plannings.length,
  planningLines: plannings.reduce((a, p) => a + p.lines.length, 0),
  vendorQuotations: vendorQuotations.length,
  purchaseOrders: purchaseOrders.length,
  gatePasses: gatePasses.length,
  grns: grns.length,
  fabricRolls: fabricRolls.length,
  fabricIssues: fabricIssues.length,
  dyeIssues: dyeIssues.length,
  dyeingReceipts: dyeingReceipts.length,
  printings: printings.length,
  fabricScrutinies: fabricScrutinies.length,
  planApprovals: planApprovals.length,
  cuttingIssues: cuttingIssues.length,
  documentSequences: documentSequences.length,
};

process.stdout.write('\n=== SEED DATA VERIFICATION (offline, no database) ===\n\n');
const w = Math.max(...Object.keys(counts).map((k) => k.length));
for (const [k, v] of Object.entries(counts)) {
  process.stdout.write(`  ${k.padEnd(w)}  ${String(v).padStart(5)}\n`);
}
process.stdout.write(`\n  out-of-scope module guard: ${OUT_OF_SCOPE.length} names checked against the schema by npm run verify:scope\n`);

if (warnings.length) {
  process.stdout.write(`\n--- ${warnings.length} WARNING(S) (workbook sample data, not blocking) ---\n`);
  warnings.forEach((m) => process.stdout.write(`  ! ${m}\n`));
}
if (errors.length) {
  process.stdout.write(`\n--- ${errors.length} ERROR(S) ---\n`);
  errors.forEach((m) => process.stdout.write(`  x ${m}\n`));
  process.stdout.write('\nVERIFICATION FAILED\n\n');
  process.exit(1);
}
process.stdout.write('\nAll cross-references resolve. VERIFICATION PASSED\n\n');
