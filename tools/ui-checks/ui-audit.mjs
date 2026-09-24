/**
 * UI audit — drives the real app in a browser and reports what breaks.
 *
 * Uses the app's OWN routes (read from client/src/routes/AppRoutes.jsx) and its
 * own way of opening create forms, which is a MODAL on the list page rather
 * than a /new route. An earlier version of this script invented /orders/new and
 * friends, which fell through to /orders/:id and produced 422s that were the
 * audit's fault rather than the app's — worth stating, because a false failure
 * costs more to chase than a real one.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199';

/** [label, path, buttonToClick?] — the button opens the create modal. */
const SCREENS = [
  ['Dashboard', '/', null],
  ['Styles & BOM (C9 rename)', '/masters/styles', null],
  ['Buyer orders', '/orders', 'New order'],
  ['Planning', '/planning', null],
  ['Plan approvals (C7)', '/plan-approvals', null],
  ['Quotations', '/quotations', null],
  ['Purchase orders (C2)', '/purchase-orders', 'New purchase order'],
  ['Gate passes (C8 movement time)', '/gate-passes', 'New gate pass'],
  ['GRNs (C2 cumulative/payable)', '/grns', null],
  ['Stock summary (C3 locations)', '/inventory/stock', null],
  ['Stock ledger', '/inventory/stock/ledger', null],
  ['Rolls', '/inventory/rolls', null],
  ['Fabric issues', '/fabric-issues', null],
  ['Fabric issue — new (C5 challan)', '/fabric-issues/new', null],
  ['Job work (C3)', '/job-works', 'New job work'],
  ['Scrutinies (C4 defects)', '/scrutinies', null],
  ['Cutting challans (C5 — new)', '/cutting-challans', 'New cutting challan'],
  ['Cutting issues', '/cutting-issues', null],
  ['Cutting issue — new (C6 equation)', '/cutting-issues/new', null],
  ['Excess rules', '/masters/excess-rules', null],
  ['Tolerances (C2/C3 — new)', '/masters/tolerances', null],
  ['Stage timing (C8 — new)', '/admin/stage-timing', null],
  ['Approval queue', '/approvals', null],
  ['Reports', '/reports', null],
  ['List masters', '/masters/list-master', null],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();

const problems = [];
let current = '(startup)';
const note = (kind, detail) => problems.push({ screen: current, kind, detail });

page.on('console', (m) => { if (m.type() === 'error') note('console', m.text().slice(0, 300)); });
page.on('pageerror', (e) => note('pageerror', String(e.message).slice(0, 300)));
page.on('response', async (r) => {
  if (r.status() >= 400 && r.url().includes('/api/')) {
    let body = '';
    try { body = (await r.text()).slice(0, 260); } catch { /* consumed */ }
    note(`HTTP ${r.status()}`, `${r.request().method()} ${r.url().replace(BASE, '')} :: ${body}`);
  }
});

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="username"]', 'admin');
await page.fill('input[name="password"]', 'ChangeMeAdmin1');
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 }).catch(() => {});
if (page.url().includes('/login')) {
  console.log('LOGIN FAILED:', (await page.locator('body').innerText()).slice(0, 300));
  await browser.close();
  process.exit(1);
}
console.log('logged in ->', page.url(), '\n');

for (const [label, path, button] of SCREENS) {
  current = label;
  const before = problems.length;

  try {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(600);
  } catch (e) {
    note('navigation', String(e.message).slice(0, 200));
  }

  // The create form is a modal on the list page. Open it — a list can look
  // perfectly healthy while the form behind it posts a body the API rejects.
  if (button) {
    try {
      const btn = page.getByRole('button', { name: button }).first();
      if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(900);
      } else {
        note('missing-button', `no "${button}" button on this screen`);
      }
    } catch (e) {
      note('modal', `opening "${button}": ${String(e.message).slice(0, 160)}`);
    }
  }

  const text = (await page.locator('body').innerText().catch(() => '')) || '';
  if (text.trim().length < 40) note('blank', `only ${text.trim().length} chars rendered`);
  // Match error text only in the MAIN region, so the nav's own words cannot
  // trigger a false positive.
  const main = (await page.locator('main').innerText().catch(() => text)) || text;
  if (/something went wrong|unexpected error|failed to load|could not load/i.test(main)) {
    note('error-text', main.slice(0, 200).replace(/\n+/g, ' | '));
  }

  const n = problems.length - before;
  console.log(`${n === 0 ? 'OK  ' : 'FAIL'} ${label.padEnd(38)} ${path}${n ? `  (${n})` : ''}`);
  if (n) await page.screenshot({ path: `ui-shot-${path.replace(/\W+/g, '_')}.png` }).catch(() => {});
}

console.log(`\n================ ${problems.length} PROBLEM(S) ================`);
const seen = new Set();
for (const p of problems) {
  const key = `${p.screen}|${p.kind}|${p.detail}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`\n[${p.screen}] ${p.kind}\n  ${p.detail}`);
}

await browser.close();
