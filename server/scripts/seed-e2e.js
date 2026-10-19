/**
 * END-TO-END TEST ENTRIES, MADE THROUGH THE REAL API.
 *
 * ===========================================================================
 *  WHAT THIS IS FOR
 * ===========================================================================
 *
 * The seed (`npm run db:seed`) wipes the database before it loads anything.
 * This does the opposite: it ADDS a handful of buyer orders on top of whatever
 * is there, and walks each one through the pipeline by calling the same HTTP
 * endpoints the screens call - so every document is created, validated,
 * numbered, approved and posted by the application's own rules, and nothing
 * already in the database is touched.
 *
 *      BUYER ORDER -> PLANNING -> PURCHASE ORDER -> GATE PASS -> GRN
 *                  -> JOB WORK (dyeing) -> FABRIC ISSUE -> DYEING RECEIPT
 *                  -> FABRIC SCRUTINY -> PLAN APPROVAL -> CUTTING CHALLAN
 *                  -> FABRIC ISSUE (cutting) -> CUT PIECES RECEIPT
 *                  -> CUTTING ISSUE (posted)
 *
 * Each order stops at a different stage, so the registers, the approval queue
 * and the dashboard all have something in every state: finished, at the dye
 * house, waiting on a signature, just entered.
 *
 * TWO PEOPLE, because maker-checker is enforced: `admin` raises every
 * document and `dinesh` (Director) approves it. Override with E2E_MAKER /
 * E2E_CHECKER as "username:password".
 *
 * Run it while the API is up:
 *
 *      npm run seed:e2e                 (API at http://localhost:4000/api)
 *      E2E_API=http://host:4000/api npm run seed:e2e
 *
 * Every run adds a fresh set; roll numbers carry the run's timestamp so a
 * second run never collides with the first.
 */

import prisma from '../src/config/prisma.js';

const API = process.env.E2E_API ?? 'http://localhost:4000/api';
const [makerUser, makerPass] = (process.env.E2E_MAKER ?? 'admin:Admin@123').split(':');
const [checkerUser, checkerPass] = (process.env.E2E_CHECKER ?? 'dinesh:Shekhawati@123').split(':');

/** Short and unique per run, for the identifiers the API does not number itself. */
const RUN = Date.now().toString(36).toUpperCase().slice(-5);

// ---------------------------------------------------------------------------
//  HTTP
// ---------------------------------------------------------------------------

async function login(username, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`login as ${username} failed: ${body.error?.message ?? res.status}`);
  return { name: username, token: body.data.accessToken };
}

class ApiError extends Error {}

async function call(who, method, path, payload) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${who.token}` },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const e = body.error ?? {};
    const details = e.details ? ` ${JSON.stringify(e.details)}` : '';
    throw new ApiError(`${method} ${path} as ${who.name} -> ${res.status} ${e.code ?? ''}: ${e.message ?? ''}${details}`);
  }
  return body.data;
}

// ---------------------------------------------------------------------------
//  FIXTURES - read only
// ---------------------------------------------------------------------------

async function fixtures() {
  const vendor = await prisma.vendor.findFirst({ where: { deletedAt: null, category: 'Fabric', poInitials: { not: null } } });
  const dyer = await prisma.vendor.findFirst({ where: { deletedAt: null, category: 'Dyeing' } });
  // Styles whose BOM carries fabric: the requirement, the PO ceiling and the
  // cutting challan are all measured against it.
  const styles = await prisma.style.findMany({
    where: { deletedAt: null, bomLines: { some: { itemCategory: 'Fabric', deletedAt: null } } },
    include: { bomLines: { where: { itemCategory: 'Fabric', deletedAt: null }, orderBy: { lineNo: 'asc' } } },
    orderBy: { styleNo: 'asc' },
  });
  if (!vendor || !dyer || styles.length === 0) {
    throw new Error('Needs a fabric vendor, a dyeing vendor and a style with a fabric BOM line - run the seed once first.');
  }
  return { vendor, dyer, styles };
}

// ---------------------------------------------------------------------------
//  ONE ORDER, AS FAR AS IT IS TOLD TO GO
// ---------------------------------------------------------------------------

const STAGES = [
  'order', 'planSubmitted', 'planApproved', 'poRaised', 'poApproved', 'gatePass', 'grn',
  'jobWorkApproved', 'atDyer', 'dyed', 'scrutinised', 'planApproval', 'challan',
  'fabricToFloor', 'cutPieces', 'cuttingIssuePosted',
];
const upTo = (stop) => (stage) => STAGES.indexOf(stage) <= STAGES.indexOf(stop);

/** A date `days` after `base`, as YYYY-MM-DD. */
function day(base, days = 0) {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function walk(spec, ctx) {
  const { maker, checker, vendor, dyer } = ctx;
  const { style, qty, base, stop, color } = spec;
  const go = upTo(stop);
  const fabric = style.bomLines[0];
  const fabricQty = String(Math.ceil(Number(qty) * Number(fabric.avgUtilisationPerPiece)));
  const out = { style: style.styleNo, stop };
  const step = (label, value) => {
    out[label] = value;
    process.stdout.write(`    ${label.padEnd(16)} ${value}\n`);
  };

  // 1. Buyer order
  const order = await call(maker, 'POST', '/orders', {
    orderDate: day(base),
    buyerId: style.buyerId,
    buyerDeliveryDate: day(base, 75),
    currency: 'USD',
    lines: [{ styleId: style.id, orderQty: String(qty), colorCode: color }],
    remarks: `E2E test entry (run ${RUN})`,
  });
  step('order', order.orderNo);
  const orderLineId = order.lines?.[0]?.id;

  // 2. Production plan - raised by the maker, signed by the checker
  if (!go('planSubmitted')) return out;
  const plan = await call(maker, 'POST', '/plannings', {
    orderId: order.id,
    orderLineId,
    planDepartment: 'CUTTING',
    containerNo: 'CN-95',
    planDate: day(base, 1),
    lines: [{ lineDate: day(base, 20), unit: 'Unit 1 - Anil Kumar', deliverableSize: String(qty) }],
  });
  await call(maker, 'POST', `/plannings/${plan.id}/submit`, { submittedTo: 'Dinesh Sir' });
  step('plan', `${plan.planNo} submitted`);
  if (!go('planApproved')) return out;
  await call(checker, 'POST', `/plannings/${plan.id}/approve`, { remarks: 'E2E' });
  step('plan', `${plan.planNo} approved`);

  // 3. Purchase order for the fabric
  if (!go('poRaised')) return out;
  const po = await call(maker, 'POST', '/purchase-orders', {
    poDate: day(base, 2),
    item: 'Fabric',
    subCategory: fabric.subCategory ?? '10 oz',
    uom: fabric.uom ?? 'Mtrs',
    orderQty: fabricQty,
    rate: '100',
    vendorId: vendor.id,
    orderId: order.id,
    styleId: style.id,
    orderMode: 'AS_PER_STYLE',
    excessAllowed: '0',
    hsnCode: '52081290',
    gsm: '320 GSM',
    content: '100% Cotton',
    colorCode: color,
    count: '10x6',
    address: 'Rajasthan Fabrics, Jaipur',
  });
  step('purchase order', `${po.poId} for ${fabricQty} ${fabric.uom}`);
  if (!go('poApproved')) return out;
  await call(checker, 'POST', `/purchase-orders/${po.id}/approve`, { remarks: 'E2E' });
  step('purchase order', `${po.poId} approved`);

  // 4. The lorry at the gate
  if (!go('gatePass')) return out;
  const gp = await call(maker, 'POST', '/gate-passes', {
    gatePassDate: day(base, 8),
    movementTime: `${day(base, 8)}T05:30:00.000Z`,
    type: 'INWARD',
    linkedDocNo: po.poId,
    item: 'Fabric',
    vendorId: vendor.id,
    partyName: vendor.vendorName,
    qty: fabricQty,
    uom: fabric.uom ?? 'Mtrs',
    purpose: 'CUTTING',
  });
  step('gate pass', gp.gatePassNo);

  // 5. Goods received - posts the stock and creates the roll
  if (!go('grn')) return out;
  const rollNo = `E2E-${RUN}-${spec.key}`;
  const grn = await call(maker, 'POST', '/grns', {
    billNo: `BILL-${RUN}-${spec.key}`,
    grnDate: day(base, 8),
    purchaseOrderId: po.id,
    gatePassId: gp.id,
    purpose: 'RAW_MATERIAL',
    receivingQty: fabricQty,
    rolls: [{ rollNo, qty: fabricQty }],
  });
  step('goods receipt', `${grn.grnNo}, roll ${rollNo}`);
  const roll = await prisma.fabricRoll.findFirst({ where: { rollNo } });

  // 6. Dyeing job work: order approved, then the fabric goes out on a challan
  if (!go('jobWorkApproved')) return out;
  const dyeQty = String(Math.floor(Number(fabricQty) / 2));
  const job = await call(maker, 'POST', '/job-works', {
    issueDate: day(base, 10),
    process: 'DYEING',
    rollId: roll.id,
    vendorId: dyer.id,
    orderId: order.id,
    styleId: style.id,
    qty: dyeQty,
    uom: fabric.uom ?? 'Mtrs',
    rate: '40',
  });
  await call(maker, 'POST', `/job-works/${job.id}/submit`, { submittedTo: 'Dinesh Sir' });
  await call(checker, 'POST', `/job-works/${job.id}/approve`, { remarks: 'E2E' });
  step('job work', `${job.dyeIssueNo} approved for ${dyeQty}`);

  if (!go('atDyer')) return out;
  const toDyer = await call(maker, 'POST', '/fabric-issues', {
    issueDate: day(base, 11),
    rollId: roll.id,
    purpose: 'DYEING',
    orderId: order.id,
    styleId: style.id,
    vendorId: dyer.id,
    issuedByName: 'Ravi Prajapat',
    fabricQtyIssued: dyeQty,
  });
  step('fabric issue', `${toDyer.issueNo} to ${dyer.vendorName}`);

  // 7. Back from the dye house, inside the 3% shrinkage standard
  if (!go('dyed')) return out;
  const back = String(Math.round(Number(dyeQty) * 0.98 * 100) / 100);
  await call(maker, 'POST', `/job-works/${job.id}/receive`, {
    receiptDate: day(base, 18),
    qtyReceived: back,
  });
  step('dyeing receipt', `${back} of ${dyeQty} back`);

  // 8. Fabric scrutiny
  if (!go('scrutinised')) return out;
  const scr = await call(maker, 'POST', '/scrutinies', {
    scrutinyDate: day(base, 19),
    rollId: roll.id,
    orderId: order.id,
    styleId: style.id,
    defectType: 'Dyeing Shade Variation',
    qtyAffected: '5',
    uom: fabric.uom ?? 'Mtrs',
    checkedByName: 'Sunita Devi',
  });
  await call(checker, 'POST', `/scrutinies/${scr.id}/finalise`, {
    decision: 'ACCEPT',
    defects: [{ category: 'DYEING', defectType: 'Dyeing Shade Variation', qty: '5', remarks: 'Minor, accepted' }],
  });
  step('scrutiny', `${scr.scrutinyNo} accepted`);

  // 9. Plan approval - cutting, stitching and shipping on one signature.
  //    Approving the production plan already raised version 1 for this order
  //    and container; that one is used when it exists, rather than a second.
  if (!go('planApproval')) return out;
  const existingPa = await prisma.planApproval.findFirst({
    where: { orderId: order.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (existingPa) {
    if (existingPa.approvalStatus !== 'APPROVED') {
      await call(checker, 'POST', `/plan-approvals/${existingPa.id}/approve`, { remarks: 'E2E' });
    }
    step('plan approval', `${existingPa.approvalNo} approved`);
  }
  const pa = existingPa ?? await call(maker, 'POST', '/plan-approvals', {
    submittedDate: day(base, 20),
    orderId: order.id,
    styleId: style.id,
    containerNo: 'CN-95',
    preparedBy: 'Planning Desk',
    submittedTo: 'Dinesh Sir',
    planningId: plan.id,
    plans: [
      { planType: 'CUTTING', plannedQty: String(qty), uom: 'Pcs' },
      { planType: 'STITCHING', plannedQty: String(qty), uom: 'Pcs' },
      { planType: 'SHIPPING', plannedQty: String(qty), uom: 'Pcs' },
    ],
  });
  if (!existingPa) {
    await call(checker, 'POST', `/plan-approvals/${pa.id}/approve`, { remarks: 'E2E' });
    step('plan approval', `${pa.approvalNo} approved`);
  }

  // 10. Cutting challan - what has to be cut, approved before fabric moves
  if (!go('challan')) return out;
  // What is left on the roll after the dye house's shrinkage, not the full
  // purchase: the store cannot issue fabric the roll no longer holds.
  const cutFabric = String(Math.floor(Number(fabricQty) * 0.97));
  const cc = await call(maker, 'POST', '/cutting-challans', {
    challanDate: day(base, 21),
    orderId: order.id,
    styleId: style.id,
    planningId: plan.id,
    planApprovalId: pa.id,
    containerNo: 'CN-95',
    lines: [{ lineNo: 1, itemCategory: 'Fabric', subCategory: fabric.subCategory ?? '10 oz', requiredQty: cutFabric, uom: fabric.uom ?? 'Mtrs' }],
  });
  await call(maker, 'POST', `/cutting-challans/${cc.id}/submit`, { submittedTo: 'Dinesh Sir' });
  await call(checker, 'POST', `/cutting-challans/${cc.id}/approve`, { remarks: 'E2E' });
  step('cutting challan', `${cc.challanNo} approved for ${cutFabric}`);

  // 11. The fabric goes to the cutting floor against the challan line
  if (!go('fabricToFloor')) return out;
  const toFloor = await call(maker, 'POST', '/fabric-issues', {
    issueDate: day(base, 22),
    rollId: roll.id,
    purpose: 'CUTTING',
    orderId: order.id,
    styleId: style.id,
    issuedByName: 'Ravi Prajapat',
    fabricQtyIssued: cutFabric,
    cuttingChallanLineId: cc.lines[0].id,
  });
  step('fabric issue', `${toFloor.issueNo} to the cutting floor`);

  // 12. Cut pieces counted in and sample-checked
  if (!go('cutPieces')) return out;
  const cpr = await call(maker, 'POST', '/cut-pieces-receipts', {
    orderId: order.id,
    cuttingMasterName: 'Anil Kumar',
    pcsReceived: String(qty),
  });
  await call(maker, 'POST', `/cut-pieces-receipts/${cpr.id}/check`, { sampleQty: '20', defects: [] });
  step('cut pieces', `${cpr.receiptNo ?? cpr.id} - ${qty} pcs passed`);

  // 13. Cutting issue - the eleven checks, then posted
  if (!go('cuttingIssuePosted')) return out;
  const issued = Number(cutFabric);
  const consumed = Math.round(issued * 0.9);
  const wastage = Math.round(issued * 0.02);
  const ci = await call(maker, 'POST', '/cutting-issues', {
    issueDate: day(base, 24),
    orderId: order.id,
    styleId: style.id,
    firmName: 'Unit 1 - Anil Kumar',
    plannedCutting: String(qty),
    unitWiseCuttingPcsToBeIssued: String(qty),
    cuttingPcsIssued: String(qty),
    planningId: plan.id,
    planApprovalId: pa.id,
    fabricIssueId: toFloor.id,
    issuedQty: String(issued),
    consumedQty: String(consumed),
    remainderQty: String(issued - consumed - wastage),
    wastageQty: String(wastage),
    fabricUom: fabric.uom ?? 'Mtrs',
  });
  // No role but ADMIN holds CUTTING_ISSUE.APPROVE, and posting has no
  // maker-checker rule, so the maker posts it.
  await call(maker, 'POST', `/cutting-issues/${ci.id}/post`, {});
  step('cutting issue', `${ci.challanNo} posted`);
  return out;
}

// ---------------------------------------------------------------------------
//  THE SET
// ---------------------------------------------------------------------------

/**
 * Spread over the last seven weeks so the dashboard's trend has a shape, and
 * stopped at different stages so every register has something in it.
 *
 * Not further back: the shrinkage and tolerance rules a job work order and a
 * purchase order are judged by carry an effective-from date, and a document
 * dated before its rule existed is refused - correctly.
 */
function specs(styles) {
  const s = (i) => styles[i % styles.length];
  const today = new Date().toISOString().slice(0, 10);
  return [
    { key: 'A', style: s(0), qty: 1000, base: day(today, -50), stop: 'cuttingIssuePosted', color: 'Night Black' },
    { key: 'B', style: s(1), qty: 3000, base: day(today, -44), stop: 'cuttingIssuePosted', color: 'Navy Blue' },
    { key: 'C', style: s(2), qty: 2000, base: day(today, -38), stop: 'cutPieces', color: 'Olive Green' },
    { key: 'D', style: s(3), qty: 2500, base: day(today, -30), stop: 'atDyer', color: 'Burgundy' },
    { key: 'E', style: s(4), qty: 4000, base: day(today, -22), stop: 'grn', color: 'Khaki' },
    { key: 'F', style: s(5), qty: 1500, base: day(today, -14), stop: 'poRaised', color: 'Night Black' },
    { key: 'G', style: s(6), qty: 1200, base: day(today, -5), stop: 'planSubmitted', color: 'Navy Blue' },
    { key: 'H', style: s(0), qty: 800, base: day(today, -1), stop: 'order', color: 'Off White' },
  ];
}

async function main() {
  process.stdout.write(`\nE2E test entries - run ${RUN} against ${API}\n\n`);
  const [maker, checker] = await Promise.all([login(makerUser, makerPass), login(checkerUser, checkerPass)]);
  const fx = await fixtures();
  const ctx = { maker, checker, ...fx };

  const only = process.env.E2E_ONLY?.split(',');
  let failed = 0;
  for (const spec of specs(fx.styles)) {
    if (only && !only.includes(spec.key)) continue;
    process.stdout.write(`  ${spec.key}. ${spec.style.styleNo} x ${spec.qty}, up to ${spec.stop}\n`);
    try {
      await walk(spec, ctx);
    } catch (e) {
      failed += 1;
      process.stdout.write(`    FAILED: ${e instanceof ApiError ? e.message : e.stack}\n`);
    }
    process.stdout.write('\n');
  }
  process.stdout.write(failed ? `${failed} order(s) stopped early - see above.\n\n` : 'Done.\n\n');
  process.exitCode = failed ? 1 : 0;
}

main().finally(() => prisma.$disconnect());
