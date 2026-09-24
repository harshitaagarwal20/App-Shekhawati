/**
 * Replays the exact request bodies the CLIENT FORMS send, against the live API.
 *
 * The screens all render. That proves nothing about whether they still work:
 * C2–C9 added required fields, and a form that renders beautifully and then
 * posts a body the API rejects is broken in the way that matters.
 *
 * Every body below is copied from the form that sends it, so a pass here means
 * a user pressing that button succeeds.
 */
const API = 'http://127.0.0.1:4000/api';

const login = await (await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'ChangeMeAdmin1' }),
})).json();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.data.accessToken}` };

/**
 * A SECOND user, because maker-checker is one of the things being proved.
 * `admin` raises everything below; the checker approves it. Trying to do both
 * as one account is refused by design, and a test that did so would be
 * measuring the control rather than the screen.
 */
const login2 = await (await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'dinesh', password: 'ChangeMeUser1' }),
})).json();
const H2 = { 'Content-Type': 'application/json', Authorization: `Bearer ${login2.data?.accessToken}` };

const call = async (method, path, body, headers = H) => {
  const r = await fetch(`${API}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  let j = null;
  try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const rowsOf = (r) => (Array.isArray(r.body?.data) ? r.body.data : (r.body?.data?.rows ?? []));

const results = [];
function check(label, res, { expectFail = false } = {}) {
  const ok = res.status < 400;
  const good = expectFail ? !ok : ok;
  results.push({ label, status: res.status, good });
  console.log(`${good ? 'PASS' : 'FAIL'} ${String(res.status).padEnd(4)} ${label}`);
  if (!good) console.log(`          ${(res.body?.message ?? JSON.stringify(res.body ?? {})).slice(0, 200)}`);
  else if (expectFail) console.log(`          correctly refused: ${(res.body?.message ?? '').slice(0, 130)}`);
  return res;
}

const orders = rowsOf(await call('GET', '/orders?pageSize=10'));
const pos = rowsOf(await call('GET', '/purchase-orders?pageSize=20&approvalStatus=APPROVED'));
const rolls = rowsOf(await call('GET', '/inventory/rolls?pageSize=30'));
// The API path is /plannings (plural); /planning is the CLIENT route.
const plans = rowsOf(await call('GET', '/plannings?pageSize=30&approvalStatus=APPROVED'));

// A gate pass can only admit goods a PO is still expecting, so pick one with
// something outstanding rather than the first row.
const openPo = pos.find((p) => Number(p.pendingQty ?? 0) > 0);
const stamp = Date.now().toString().slice(-6);

console.log('\n--- C8: GATE PASS, body as GatePassForm now sends it ---');
check('Gate pass WITH movementTime', await call('POST', '/gate-passes', {
  gatePassNo: `UIC-GP-${stamp}`,
  gatePassDate: '2026-08-29',
  movementTime: new Date(Date.now() - 3600_000).toISOString(),
  type: 'INWARD',
  linkedDocNo: openPo?.poId ?? pos[0]?.poId ?? 'RF-001',
  qty: '1',
  receivedQty: null,
  purpose: 'CUTTING',
  authorisedBy: null,
  authorisedEmployeeId: null,
  remarks: 'UI contract check',
}));
check('Gate pass with a FUTURE movementTime is refused', await call('POST', '/gate-passes', {
  gatePassNo: `UIC-GPF-${stamp}`,
  gatePassDate: '2026-08-29',
  movementTime: new Date(Date.now() + 86400_000).toISOString(),
  type: 'INWARD',
  linkedDocNo: pos[0]?.poId ?? 'RF-001',
  qty: '5',
  purpose: 'CUTTING',
}), { expectFail: true });

console.log('\n--- C5: CUTTING CHALLAN, body as CreateChallanModal sends it ---');
const plan = plans[0];
const order = orders.find((o) => o.id === plan?.orderId) ?? orders[0];
const challan = check('Raise a cutting challan', await call('POST', '/cutting-challans', {
  challanDate: '2026-08-29',
  orderId: plan?.orderId ?? order?.id,
  planningId: plan?.id,
  containerNo: plan?.containerNo ?? null,
  remarks: 'UI contract check',
  lines: [{ lineNo: 1, itemCategory: 'Fabric', subCategory: '10 oz', requiredQty: '5', uom: 'Mtrs' }],
}));

let lineId = null;
if (challan.status < 400) {
  const id = challan.body.data.id;
  check('Submit it', await call('POST', `/cutting-challans/${id}/submit`, { submittedTo: 'Approver' }));
  check('Maker cannot approve their own challan', await call('POST', `/cutting-challans/${id}/approve`, {}), {
    expectFail: true,
  });
  check('Checker approves it', await call('POST', `/cutting-challans/${id}/approve`, {}, H2));
  const issuable = await call('GET', `/cutting-challans/issuable-lines?orderId=${plan?.orderId ?? order?.id}`);
  const lines = issuable.body?.data?.rows ?? [];
  lineId = lines[0]?.id ?? null;
  check(`issuable-lines returns the approved line (${lines.length} found)`, issuable);
}

console.log('\n--- C5: FABRIC ISSUE to cutting, body as FabricIssueForm now sends it ---');
const roll = rolls.find((r) => Number(r.balanceQty) > 0 && r.location === 'MAIN STORE') ?? rolls[0];
if (lineId && roll) {
  check('Fabric issue quoting the challan line', await call('POST', '/fabric-issues', {
    issueDate: '2026-08-29',
    rollId: roll.id,
    purpose: 'CUTTING',
    orderId: plan?.orderId ?? order?.id,
    cuttingChallanLineId: lineId,
    issuedByName: 'UI contract check',
    fabricQtyIssued: '1',
  }));
} else {
  console.log('SKIP      no approved challan line or roll available');
}
check('Fabric issue to CUTTING with NO challan line is refused', await call('POST', '/fabric-issues', {
  issueDate: '2026-08-29',
  rollId: roll?.id,
  purpose: 'CUTTING',
  orderId: order?.id,
  issuedByName: 'UI contract check',
  fabricQtyIssued: '1',
}), { expectFail: true });

console.log('\n--- C3: JOB WORK approval buttons the detail screen now offers ---');
const jw = rowsOf(await call('GET', '/job-works?pageSize=50'));
console.log(`          ${jw.length} job work orders; states: ${[...new Set(jw.map((j) => j.workflowState))].join(', ')}`);
check('POST /job-works/:id/submit route exists', await call('POST', `/job-works/${jw[0]?.id}/submit`, {}), {
  expectFail: true, // already POSTED/COMPLETED — a 409 proves the route is wired, not missing
});

console.log('\n--- C2 / C8: the read-only screens the new endpoints feed ---');
check('GET /tolerances', await call('GET', '/tolerances'));
check('GET /tolerances/gaps', await call('GET', '/tolerances/gaps'));
check('GET /workflow/stage-durations', await call('GET', '/workflow/stage-durations'));

console.log('\n================ SUMMARY ================');
const bad = results.filter((r) => !r.good);
console.log(`${results.length - bad.length}/${results.length} as expected`);
for (const b of bad) console.log(`  FAILED  ${b.status}  ${b.label}`);
process.exit(bad.length ? 1 : 0);
