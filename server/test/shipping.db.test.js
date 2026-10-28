/**
 * NEEDLE CHECKING, PACKING AND DISPATCH, OVER HTTP. NEEDS A SEEDED
 * POSTGRESQL. Never run against production.
 *
 * The three sheets, driven through the real API:
 *
 *   - Needle Checking's cartons never hold more than External QC approved,
 *     take the order's colours, and number themselves 1-5, 6-8 ... for good
 *   - Packing works out Qty, N.W, G.W and CBM, never packs more of a colour
 *     than Needle Checking passed of it, and numbers each box once
 *   - a Dispatch takes its buyer, container, shipment details and totals
 *     from the order, its plan and the boxes chosen for it; the order
 *     becomes Partially Shipped, then Shipped, and goes back as it was
 *   - the prints, the Excel exports, the audit trail and the roles
 *
 * Works on an order it creates for the purpose, with External QC approved
 * pieces and a plan written straight to the tables, and removes everything
 * it wrote.
 *
 *      node --test test/shipping.db.test.js
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

import { createApp } from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { istIsoDate } from '../src/utils/dates.js';

const USER_PASSWORD = process.env.SEED_DEFAULT_USER_PASSWORD || 'Shekhawati@123';

let live = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  live = (await prisma.user.count({ where: { username: { in: ['sunita', 'merch', 'dinesh'] } } })) === 3
    && (await prisma.permission.count({ where: { code: 'DISPATCH.CREATE' } })) === 1;
} catch {
  live = false;
}
const skip = live ? false : 'no migrated, seeded database with the QC and Merchandising users - skipping';

let server;
let base;
const tokens = {};

async function call(method, path, { as, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* CSV */
  }
  return { status: res.status, body: parsed };
}

async function signIn(username, password = USER_PASSWORD) {
  await prisma.user.updateMany({
    where: { username },
    data: { mustChangePassword: false, passwordHash: await bcrypt.hash(password, 10) },
  });
  const res = await call('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(res.status, 200, `login for ${username} failed`);
  tokens[username] = res.body.data.accessToken;
}

const RUN = Date.now().toString(36).toUpperCase();
const CONTAINER = `TCN-${RUN}`;
const today = istIsoDate();

let order;
let style;
const created = { cartons: [], packing: [] };

const OS = () => ({ orderId: order.id, styleId: style.id });
const pos = async (path, as = 'sunita') =>
  (await call('GET', `/api/${path}/position?orderId=${order.id}&styleId=${style.id}`, { as })).body.data;

before(async () => {
  if (!live) return;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const u of ['sunita', 'merch', 'dinesh']) await signIn(u);
  await signIn('admin', process.env.SEED_ADMIN_PASSWORD || 'Admin@123');

  style = await prisma.style.findFirst({ where: { deletedAt: null, status: 'ACTIVE' }, include: { buyer: true }, orderBy: { styleNo: 'asc' } });

  order = await prisma.buyerOrder.create({
    data: {
      orderNo: `T-SHIP-${RUN}`,
      orderDate: new Date(`${today}T00:00:00Z`),
      buyerId: style.buyerId,
      styleId: style.id,
      colorCode: 'Navy',
      orderQty: '100',
      effectiveQty: '102',
      // Pending, so the last test shows the order goes back to it - not to In Progress.
      status: 'PENDING',
      shipMode: 'Sea',
      shipTo: 'Test DC, New Jersey',
      buyerPoNo: `PO-${RUN}`,
      workflowState: 'APPROVED',
    },
  });
  const agency = await prisma.vendor.findFirst({ where: { category: 'External QC', deletedAt: null } });
  await prisma.externalQcEntry.create({
    data: { entryDate: new Date(`${today}T00:00:00Z`), ...OS(), agencyId: agency.id, pcsOffered: '100', pcsApproved: '100' },
  });

  await prisma.planApproval.create({
    data: {
      approvalNo: `PA-T${RUN}`,
      submittedDate: new Date(`${today}T00:00:00Z`),
      ...OS(),
      containerNo: CONTAINER,
      preparedBy: 'Test',
      submittedTo: 'Director',
      approvalStatus: 'APPROVED',
      approvedDate: new Date(`${today}T00:00:00Z`),
      decidedAt: new Date(),
      isLocked: true,
      lockedAt: new Date(),
      workflowState: 'APPROVED',
      isCurrent: true,
    },
  });
});

after(async () => {
  if (live && order) {
    const where = OS();
    const dispatchIds = (await prisma.dispatch.findMany({ where: { orderId: order.id }, select: { id: true } })).map((d) => d.id);
    await prisma.dispatchLine.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.dispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.packingEntry.deleteMany({ where });
    await prisma.needleCheckCarton.deleteMany({ where });
    await prisma.externalQcEntry.deleteMany({ where });
    const plans = (await prisma.planApproval.findMany({ where: { orderId: order.id }, select: { id: true } })).map((x) => x.id);
    await prisma.planApprovalLine.deleteMany({ where: { planApprovalId: { in: plans } } });
    await prisma.planApproval.deleteMany({ where: { id: { in: plans } } });
    await prisma.approvalHistory.deleteMany({ where: { documentId: order.id } });
    await prisma.buyerOrder.delete({ where: { id: order.id } });
  }
  server?.close();
  await prisma.$disconnect();
});

const carton = (cartonQty, sizes, extra = {}) => ({
  ...OS(),
  cartonQty,
  colorCode: 'Navy',
  ...Object.fromEntries(sizes.map((v, i) => [`size${i + 1}`, v])),
  weightKg: '7.5',
  signedBy: 'Sunita',
  ...extra,
});

const box = (boxNo, pcsPerBox, boxesPacked, extra = {}) => ({
  ...OS(),
  boxNo,
  colorCode: 'Navy',
  pcsPerBox,
  boxesPacked,
  ...extra,
});

describe('Phase 6 - needle checking, packing, dispatch', { skip }, () => {
  test('Needle Checking: cartons never hold more than External QC approved', async () => {
    const res = await call('POST', '/api/needle-checking', { as: 'sunita', body: carton(9, [2, 4, 4, 2]) });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Only 100 External QC approved pcs/);
  });

  test("Needle Checking: the colour is one of the order's", async () => {
    const res = await call('POST', '/api/needle-checking', { as: 'sunita', body: carton(1, [12], { colorCode: 'Black' }) });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Navy/);
    const none = await call('POST', '/api/needle-checking', { as: 'sunita', body: carton(1, [0, 0]) });
    assert.equal(none.status, 400, 'a carton holds something');
  });

  test('Needle Checking: Pcs/Carton is the sizes, Carton runs on from the row above', async () => {
    const a = await call('POST', '/api/needle-checking', { as: 'sunita', body: carton(5, [2, 4, 4, 2]) });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.data.pcsPerCarton, 12);
    assert.equal(Number(a.body.data.totalPcs), 60);
    assert.equal(a.body.data.carton, '1-5');
    assert.equal(a.body.data.packing, '1 pkt × 10 + 2 bags', 'one carton of 12 at 10 bags a packet');
    assert.equal(a.body.data.packets, 5);
    assert.equal(a.body.data.looseBags, 10);
    const b = await call('POST', '/api/needle-checking', { as: 'sunita', body: carton(3, [4, 4, 4]) });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    assert.equal(b.body.data.carton, '6-8');
    created.cartons.push(a.body.data.id, b.body.data.id);

    const p = await pos('needle-checking');
    assert.deepEqual(p.colors, ['Navy']);
    assert.equal(p.pcsPerFullCarton, 100, 'a style starts at 10 packets of 10 bags');
    assert.equal(p.totals.cartons, 8);
    assert.equal(Number(p.totals.pcs), 96);
    assert.equal(p.totals.size1, 2 * 5 + 4 * 3);
    assert.equal(Number(p.flow.awaitingNeedle), 4);
  });

  test('Needle Checking: a partial edit keeps the sizes not sent', async () => {
    const res = await call('PATCH', `/api/needle-checking/${created.cartons[1]}`, { as: 'sunita', body: { weightKg: '8' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.pcsPerCarton, 12);
    assert.equal(res.body.data.size1, 4);
  });

  test('Needle Checking: carton numbers stay as given - a deleted row leaves a gap', async () => {
    const grow = await call('PATCH', `/api/needle-checking/${created.cartons[0]}`, { as: 'sunita', body: { cartonQty: 6, size1: 1, size2: 1, size3: 1, size4: 1 } });
    assert.equal(grow.status, 400, 'row 1-5 cannot run into 6-8');
    assert.match(grow.body.message, /Carton 6-8 is already numbered/);

    const d = (await call('POST', '/api/needle-checking', { as: 'sunita', body: carton(1, [1]) })).body.data;
    const e = (await call('POST', '/api/needle-checking', { as: 'sunita', body: carton(1, [1]) })).body.data;
    assert.deepEqual([d.carton, e.carton], ['9', '10']);
    assert.equal((await call('DELETE', `/api/needle-checking/${d.id}`, { as: 'admin' })).status, 200);
    assert.equal((await call('GET', `/api/needle-checking/${e.id}`, { as: 'sunita' })).body.data.carton, '10', 'not renumbered');
    const f = (await call('POST', '/api/needle-checking', { as: 'sunita', body: carton(1, [1]) })).body.data;
    assert.equal(f.carton, '11');
    for (const id of [e.id, f.id]) assert.equal((await call('DELETE', `/api/needle-checking/${id}`, { as: 'admin' })).status, 200);
  });

  test('Packing: only colours Needle Checking passed, never more than it passed', async () => {
    const black = await call('POST', '/api/packing', { as: 'sunita', body: box('1-9', 12, 9, { colorCode: 'Black' }) });
    assert.equal(black.status, 400);
    const over = await call('POST', '/api/packing', { as: 'sunita', body: box('1-9', 12, 9) });
    assert.equal(over.status, 400);
    assert.match(over.body.message, /Only 96 needle-checked pcs/);
    const gw = await call('POST', '/api/packing', { as: 'sunita', body: box('1-5', 12, 5, { nwPerBoxKg: '7', gwPerBoxKg: '6' }) });
    assert.equal(gw.status, 400, 'G.W cannot be under N.W');
  });

  test('Packing: Qty, N.W, G.W and CBM are worked out', async () => {
    const res = await call('POST', '/api/packing', {
      as: 'sunita',
      body: box('1-5', 12, 5, { nwPerBoxKg: '6.5', gwPerBoxKg: '7.2', lengthCm: '60', widthCm: '40', heightCm: '30' }),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const e = res.body.data;
    assert.equal(Number(e.pcsPacked), 60);
    assert.equal(Number(e.nwKg), 32.5);
    assert.equal(Number(e.gwKg), 36);
    assert.equal(Number(e.cbm), 0.36);
    assert.equal(Number(e.orderQty), 100, 'Order size is the order qty');
    assert.equal(e.packing, '1 pkt × 10 + 2 bags');
    assert.equal(e.packets, 5);
    assert.equal(e.bags, 60);
    assert.equal(e.style.styleDescription, style.styleDescription);
    const b = await call('POST', '/api/packing', { as: 'sunita', body: box('6-8', 12, 3) });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    created.packing.push(e.id, b.body.data.id);
    const p = await pos('packing');
    assert.equal(Number(p.flow.packed), 96);
    assert.equal(Number(p.flow.boxesPacked), 8);
  });

  test('Needle Checking: a packed carton row cannot be removed', async () => {
    const res = await call('DELETE', `/api/needle-checking/${created.cartons[1]}`, { as: 'admin' });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /needle-checked/);
  });

  let first;

  test('Dispatch: buyer, container, shipment details and totals come from the order', async () => {
    const orders = (await call('GET', '/api/dispatches/orders', { as: 'merch' })).body.data;
    assert.equal(Number(orders.find((o) => o.orderId === order.id).pcsReady), 96);
    const p = (await call('GET', `/api/dispatches/preview?orderId=${order.id}`, { as: 'merch' })).body.data;
    assert.equal(p.buyerName, style.buyer.buyerName);
    assert.equal(p.containerNo, CONTAINER, 'from the approved plan');
    assert.equal(p.shipTo, 'Test DC, New Jersey');
    assert.equal(p.shipMode, 'Sea');
    assert.equal(p.buyerPoNo, `PO-${RUN}`);
    assert.equal(Number(p.totalPcs), 96);
    assert.equal(p.totalBoxes, 8);

    const res = await call('POST', '/api/dispatches', {
      as: 'merch',
      body: { orderId: order.id, invoiceNo: `INV-${RUN}`, carrierRef: 'MSKU-BL-1', eta: today },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    first = res.body.data;
    assert.match(first.dispatchNo, /^DSP-\d{4}$/);
    assert.equal(first.status, 'PENDING');
    assert.equal(first.containerNo, CONTAINER);
    assert.equal(Number(first.totalPcs), 96);
    assert.equal(first.consigneeName, style.buyer.consigneeName);
    assert.equal((await prisma.buyerOrder.findUnique({ where: { id: order.id } })).status, 'PENDING', 'Pending has not left');

    const again = await call('POST', '/api/dispatches', { as: 'merch', body: { orderId: order.id } });
    assert.equal(again.status, 409, 'nothing is left to go');
    const unpack = await call('DELETE', `/api/packing/${created.packing[1]}`, { as: 'admin' });
    assert.equal(unpack.status, 409, 'pieces on a dispatch cannot be unpacked');
  });

  test('Dispatch: Dispatched makes the order Partially Shipped and freezes the totals', async () => {
    const res = await call('PATCH', `/api/dispatches/${first.id}`, { as: 'merch', body: { status: 'DISPATCHED' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await prisma.buyerOrder.findUnique({ where: { id: order.id } })).status, 'PARTIALLY_SHIPPED');
    const early = await call('PATCH', `/api/dispatches/${first.id}`, { as: 'merch', body: { eta: '2000-01-01' } });
    assert.equal(early.status, 400, 'ETA cannot be before the dispatch date');
    const rechoose = await call('PATCH', `/api/dispatches/${first.id}`, { as: 'merch', body: { packingEntryIds: [created.packing[0]] } });
    assert.equal(rechoose.status, 409, 'the boxes of a dispatch that has left are fixed');
    assert.match(rechoose.body.message, /has left/);
  });

  let second;

  test('Dispatch: the boxes are chosen - a box packed later is not taken unasked', async () => {
    await call('POST', '/api/needle-checking', { as: 'sunita', body: carton(1, [1, 1, 1, 1]) });
    const clash = await call('POST', '/api/packing', { as: 'sunita', body: box('8', 2, 1) });
    assert.equal(clash.status, 400, 'box 8 is on the 6-8 line');
    assert.match(clash.body.message, /overlaps boxes 6-8/);
    const short = await call('POST', '/api/packing', { as: 'sunita', body: box('9-10', 2, 1) });
    assert.equal(short.status, 400, 'Box No 9-10 is two boxes');

    const p1 = await call('POST', '/api/packing', { as: 'sunita', body: box('9', 2, 1) });
    assert.equal(p1.status, 201, JSON.stringify(p1.body));
    const taken = await call('POST', '/api/dispatches', { as: 'merch', body: { orderId: order.id, packingEntryIds: [p1.body.data.id, created.packing[0]] } });
    assert.equal(taken.status, 409);
    assert.match(taken.body.message, new RegExp(`already on ${first.dispatchNo}`));
    second = (await call('POST', '/api/dispatches', { as: 'merch', body: { orderId: order.id, packingEntryIds: [p1.body.data.id] } })).body.data;
    assert.equal(Number(second.totalPcs), 2);

    const p2 = await call('POST', '/api/packing', { as: 'sunita', body: box('10', 2, 1) });
    assert.equal(p2.status, 201, JSON.stringify(p2.body));
    created.packing.push(p1.body.data.id, p2.body.data.id);
    const quiet = await call('PATCH', `/api/dispatches/${second.id}`, { as: 'merch', body: { remarks: 'Loading' } });
    assert.equal(Number(quiet.body.data.totalPcs), 2, 'a save that chooses nothing leaves the boxes as they are');
    const waiting = (await call('GET', '/api/dispatches/orders', { as: 'merch' })).body.data.find((o) => o.orderId === order.id);
    assert.equal(Number(waiting.pcsReady), 2, 'box 10 waits for a dispatch of its own, or to be chosen');

    const res = await call('PATCH', `/api/dispatches/${second.id}`, {
      as: 'merch',
      body: { status: 'DELIVERED', packingEntryIds: [p1.body.data.id, p2.body.data.id] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(Number(res.body.data.totalPcs), 4, 'box 10 chosen as it goes');
    assert.equal(res.body.data.totalBoxes, 2);
    assert.equal(Number((await call('GET', `/api/dispatches/${first.id}`, { as: 'merch' })).body.data.totalPcs), 96, 'the first stays as it left');
    assert.equal((await prisma.buyerOrder.findUnique({ where: { id: order.id } })).status, 'SHIPPED');
  });

  test('The prints', async () => {
    const dn = (await call('GET', `/api/dispatches/${first.id}/print/dispatch-note`, { as: 'merch' })).body.data;
    assert.equal(dn.documentTitle, 'Dispatch Note');
    assert.equal(dn.containerNo, CONTAINER);
    assert.equal(dn.shipTo, 'Test DC, New Jersey');
    assert.equal(dn.carrierRef, 'MSKU-BL-1');
    assert.deepEqual(dn.lines.map((l) => [l.styleNo, l.boxes, Number(l.pcs)]), [[style.styleNo, 8, 96]]);

    const pl = (await call('GET', `/api/dispatches/${first.id}/print/packing-list`, { as: 'merch' })).body.data;
    assert.equal(pl.documentTitle, 'Packing List');
    assert.deepEqual(pl.lines.map((l) => l.boxNo), ['1-5', '6-8'], "only this dispatch's boxes");
    assert.equal(Number(pl.totals.qty), 96, 'agrees with the dispatch note');
    assert.equal(pl.totals.boxes, 8);
    assert.equal(Number(pl.totals.cbm), 0.36);
    assert.equal(pl.totals.packets, 5 + 3);
    assert.equal(pl.lines[0].packing, '1 pkt × 10 + 2 bags');

    const pl2 = (await call('GET', `/api/dispatches/${second.id}/print/packing-list`, { as: 'merch' })).body.data;
    assert.deepEqual(pl2.lines.map((l) => l.boxNo), ['9', '10'], 'the second carries none of the first');
    assert.equal(Number(pl2.totals.qty), Number(pl2.totalPcs));
    assert.equal(pl2.totals.boxes, pl2.totalBoxes);
  });

  test('Boxes that have left stay as they left; a Pending dispatch follows its boxes', async () => {
    const recut = await call('PATCH', `/api/packing/${created.packing[1]}`, { as: 'sunita', body: { pcsPerBox: 18, boxesPacked: 2 } });
    assert.equal(recut.status, 409, 'the boxes of a dispatch that has left cannot be re-cut');
    assert.match(recut.body.message, new RegExp(`${first.dispatchNo}, which is dispatched`));
    const weigh = await call('PATCH', `/api/packing/${created.packing[1]}`, { as: 'sunita', body: { nwPerBoxKg: '9' } });
    assert.equal(weigh.status, 409, 'nor re-weighed');
    assert.equal((await call('DELETE', `/api/packing/${created.packing[1]}`, { as: 'admin' })).status, 409);

    // Back to Pending, a box corrected: the dispatch's totals follow it.
    assert.equal((await call('PATCH', `/api/dispatches/${second.id}`, { as: 'merch', body: { status: 'PENDING' } })).status, 200);
    const fix = await call('PATCH', `/api/packing/${created.packing[3]}`, { as: 'sunita', body: { pcsPerBox: 1 } });
    assert.equal(fix.status, 200, JSON.stringify(fix.body));
    const d = (await call('GET', `/api/dispatches/${second.id}`, { as: 'merch' })).body.data;
    assert.equal(Number(d.totalPcs), 3);
    assert.equal(d.totalBoxes, 2);
    assert.deepEqual(d.lines.map((l) => [Number(l.pcs), l.boxes]), [[3, 2]]);
    const off = await call('DELETE', `/api/packing/${created.packing[3]}`, { as: 'admin' });
    assert.equal(off.status, 409, 'boxes on a pending dispatch stay on it');
    assert.match(off.body.message, /pending dispatch/);

    const back = await call('PATCH', `/api/dispatches/${second.id}`, { as: 'merch', body: { status: 'DELIVERED' } });
    assert.equal(back.status, 200, JSON.stringify(back.body));
    const ready = (await call('GET', '/api/dispatches/orders', { as: 'merch' })).body.data.find((o) => o.orderId === order.id);
    assert.equal(Number(ready.pcsReady), 0);
    assert.equal(Number(ready.boxesReady), 0, 'never negative');
  });

  test('Excel exports and the audit trail', async () => {
    for (const key of ['needle-checking', 'packing', 'dispatches']) {
      const res = await call('GET', `/api/exports/${key}/csv?orderId=${order.id}`, { as: 'admin' });
      assert.equal(res.status, 200, `${key}: ${JSON.stringify(res.body).slice(0, 200)}`);
    }
    const trail = await prisma.auditLog.count({
      where: { tableName: { in: ['needle_check_cartons', 'packing_entries', 'dispatches'] }, recordId: { in: [created.cartons[0], created.packing[0], first.id] } },
    });
    assert.ok(trail >= 3);
  });

  test('Roles: QC cannot dispatch, Merchandising cannot pack, the Director reads', async () => {
    assert.equal((await call('POST', '/api/dispatches', { as: 'sunita', body: { orderId: order.id } })).status, 403);
    assert.equal((await call('POST', '/api/packing', { as: 'merch', body: box('11', 1, 1) })).status, 403);
    assert.equal((await call('GET', '/api/needle-checking', { as: 'dinesh' })).status, 200);
    assert.equal((await call('POST', '/api/needle-checking', { as: 'dinesh', body: carton(1, [1]) })).status, 403);
    assert.equal((await call('GET', '/api/humidity', { as: 'admin' })).status, 404, 'Humidity Checking is gone');
  });

  test('Deleting the dispatches puts the order back to the status it had before it shipped', async () => {
    const ids = (await prisma.dispatch.findMany({ where: { orderId: order.id, deletedAt: null }, select: { id: true } })).map((d) => d.id);
    for (const id of ids) assert.equal((await call('DELETE', `/api/dispatches/${id}`, { as: 'admin' })).status, 200);
    assert.equal((await prisma.buyerOrder.findUnique({ where: { id: order.id } })).status, 'PENDING');
    const ready = (await call('GET', '/api/dispatches/orders', { as: 'merch' })).body.data.find((o) => o.orderId === order.id);
    assert.equal(Number(ready.pcsReady), 99, 'their boxes are packed and waiting again');
    assert.equal(Number(ready.boxesReady), 10);
  });
});
