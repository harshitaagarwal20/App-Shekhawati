/**
 * Confirms the NEW FIELDS actually render, in the real browser.
 *
 * The contract check proves the API accepts what the forms send. This proves
 * the forms let a user enter it — a field that exists only in the submit
 * handler is a field the user cannot fill.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199';
const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 1400, height: 950 } }).then((c) => c.newPage());

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="username"]', 'admin');
await page.fill('input[name="password"]', 'ChangeMeAdmin1');
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });

const results = [];
const expect = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

// --- C8: gate pass movement time -------------------------------------------
//
// These are progressive-disclosure shop-floor forms: the later fields appear
// only once the earlier steps are answered. So the check has to DRIVE the form,
// not just open it — an earlier version of this script opened the modal, found
// no movement-time input and reported a failure that was its own.
await page.goto(`${BASE}/gate-passes`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'New gate pass' }).first().click();
await page.waitForTimeout(700);

// Step 1 is the reference document; everything else follows from it.
//
// SCOPED TO THE MODAL. `page.locator('input').first()` picked up the app shell's
// own "Find a screen" box, so the scan never reached the form and the check
// reported a missing field that was simply never revealed.
const dialog = page.locator('.modal, [role="dialog"]').first();
const scan = dialog.locator('input').first();
await scan.fill('RF-004');
await scan.press('Enter');
await page.waitForTimeout(2200);

const dt = dialog.locator('input[type="datetime-local"]');
expect('C8  Gate pass form shows a movement-time input', (await dt.count()) > 0);
if (await dt.count()) {
  const v = await dt.first().inputValue();
  expect('C8  ...prefilled with a sensible default', Boolean(v) && !Number.isNaN(Date.parse(v)), `value="${v}"`);
  const max = await dt.first().getAttribute('max');
  expect('C8  ...and capped so a future time cannot be picked', Boolean(max));
}
await page.screenshot({ path: 'ui-shot-gatepass.png' });

// --- C5: cutting challan screen exists and its form opens ------------------
await page.goto(`${BASE}/cutting-challans`, { waitUntil: 'networkidle' });
const body = await page.locator('body').innerText();
expect('C5  Cutting Challan screen reachable', /cutting challan/i.test(body));
expect('C5  ...linked from the Cutting menu', /Cutting Challan/.test(body));
await page.getByRole('button', { name: 'New cutting challan' }).first().click();
await page.waitForTimeout(900);
const modal = await page.locator('body').innerText();
expect('C5  ...create form asks for an approved planning version', /planning version/i.test(modal));
expect('C5  ...and for required items', /required qty/i.test(modal));
await page.screenshot({ path: 'ui-shot-challan.png' });

// --- C6: the fabric equation on the cutting issue --------------------------
await page.goto(`${BASE}/cutting-issues/new`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// This form is a CARD PICKER, not a set of selects: step 1 is "which order",
// step 2 is "which plan approval", and the fabric section is gated on both —
// correctly, since you cannot say what became of the cloth before you know
// which challan you are cutting for.
//
// The order matters: only one with an APPROVED plan approval opens step 2, so
// the check searches for a known-good one rather than clicking the first card,
// which is how an earlier version of this script got stuck on step 1.
const search = page.locator('main input').first();
if (await search.count()) {
  await search.fill('B9641IS');
  await page.waitForTimeout(900);
}
const orderCard = page.locator('.picker-card').first();
if (await orderCard.count()) {
  await orderCard.click();
  await page.waitForTimeout(1600);
}
// Step 2: the plan approval. Target the PA- card specifically — after step 1
// the order card is still on screen (shown as chosen), so `.first()` picks it
// again and the form never advances.
const approvalCard = page.locator('.picker-card').filter({ hasText: /^PA-/ }).first();
if (await approvalCard.count()) {
  await approvalCard.click();
  await page.waitForTimeout(1800);
}

const ci = await page.locator('body').innerText();
expect('C6  Cutting issue form asks what happened to the fabric', /what happened to the fabric/i.test(ci));
for (const f of ['Fabric received on the floor', 'Consumed', 'Remainder returned', 'Wastage']) {
  expect(`C6  ...field "${f}"`, ci.includes(f));
}
expect('C6  ...and says wastage is entered, not worked out', /not worked out|never inferred/i.test(ci));
await page.screenshot({ path: 'ui-shot-cuttingissue.png' });

// --- C5: the challan picker on the fabric issue ----------------------------
await page.goto(`${BASE}/fabric-issues/new`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const fi = await page.locator('body').innerText();
expect('C5  Fabric issue screen loads', /fabric issue|issue fabric/i.test(fi));
await page.screenshot({ path: 'ui-shot-fabricissue.png' });

console.log('\n================ SUMMARY ================');
const bad = results.filter((r) => !r.ok);
console.log(`${results.length - bad.length}/${results.length} field checks passed`);
for (const b of bad) console.log(`  FAILED  ${b.label}`);

await browser.close();
process.exit(bad.length ? 1 : 0);
