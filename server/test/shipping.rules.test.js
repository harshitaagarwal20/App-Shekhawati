/**
 * Needle Checking, Packing and Dispatch - the arithmetic, no database.
 *
 *      node --test test/shipping.rules.test.js
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import {
  SIZE_KEYS,
  cartonLabel,
  cartonProblems,
  cartonTotalOf,
  cbmOf,
  dispatchTotalsOf,
  nextCartons,
  packingFigures,
  packetsOf,
  packetsOfMany,
  packingProblems,
  parseBoxNo,
  pcsPerCartonOf,
  pcsPerFullCartonOf,
  rangesOverlap,
  shipStatusOf,
  shippingFlow,
} from '../src/domain/shipping.js';

const D = (v) => new Prisma.Decimal(v);
const n = (v) => (v == null ? v : Number(v));

describe('Packets and bags - one piece a bag', () => {
  test('a full carton is packets x bags: 10 x 10 = 100', () => {
    assert.equal(pcsPerFullCartonOf({ bagsPerPacket: 10, packetsPerCarton: 10 }), 100);
    assert.equal(pcsPerFullCartonOf({ bagsPerPacket: 12, packetsPerCarton: 5 }), 60);
  });

  test('pieces as packets and bags', () => {
    assert.deepEqual(packetsOf(100, 10), { bags: 100, packets: 10, looseBags: 0, label: '10 pkts × 10' });
    assert.deepEqual(packetsOf(95, 10), { bags: 95, packets: 9, looseBags: 5, label: '9 pkts × 10 + 5 bags' });
    assert.equal(packetsOf(1, 10).label, '0 pkts × 10 + 1 bag');
    assert.equal(packetsOf(50, 0).label, null, 'no bags a packet, no packets');
  });

  test('several cartons: packets and loose bags add up carton by carton', () => {
    const p = packetsOfMany(95, 3, 10);
    assert.equal(p.perCarton.label, '9 pkts × 10 + 5 bags');
    assert.equal(p.packets, 27);
    assert.equal(p.looseBags, 15);
    assert.equal(p.bags, 285);
  });
});

describe('Needle Checking - the size assortment carton', () => {
  test('there are ten size columns', () => {
    assert.equal(SIZE_KEYS.length, 10);
    assert.equal(SIZE_KEYS[9], 'size10');
  });

  test('Pcs/Carton is the sum of the sizes; the row passes on Pcs/Carton x Carton Qty', () => {
    const row = { cartonQty: 5, size1: 2, size2: 4, size3: 4, size4: 2 };
    assert.equal(pcsPerCartonOf(row), 12);
    assert.equal(n(cartonTotalOf(row)), 60);
  });

  test('Carton numbers run on from the highest number given', () => {
    assert.deepEqual(nextCartons(null, 5), { cartonFrom: 1, cartonTo: 5 });
    assert.deepEqual(nextCartons(5, 1), { cartonFrom: 6, cartonTo: 6 });
    assert.deepEqual(nextCartons(6, 3), { cartonFrom: 7, cartonTo: 9 });
    assert.deepEqual([cartonLabel(1, 5), cartonLabel(6, 6), cartonLabel(7, 9)], ['1-5', '6', '7-9']);
  });

  test('runs of numbers overlap when they share one', () => {
    assert.equal(rangesOverlap({ from: 1, to: 5 }, { from: 5, to: 8 }), true);
    assert.equal(rangesOverlap({ from: 1, to: 5 }, { from: 6, to: 8 }), false);
  });

  test('a row needs cartons, a size and a signature', () => {
    assert.deepEqual(cartonProblems({ cartonQty: 2, size1: 6, signedBy: 'Sunita' }), []);
    const fields = cartonProblems({ cartonQty: 0, size3: -1, signedBy: ' ' }).map((p) => p.field);
    assert.deepEqual(fields, ['cartonQty', 'size3', 'size1', 'signedBy']);
  });
});

describe('Packing - the packing details', () => {
  test('Qty = Packing x Boxes; N.W and G.W are per box x Boxes', () => {
    const f = packingFigures({ pcsPerBox: 12, boxesPacked: 5, nwPerBoxKg: '6.5', gwPerBoxKg: '7.2' });
    assert.equal(n(f.qty), 60);
    assert.equal(n(f.nwKg), 32.5);
    assert.equal(n(f.gwKg), 36);
    assert.equal(f.cbm, null, 'no dimensions, no CBM');
  });

  test('CBM = L x W x H / 1,000,000 x Boxes', () => {
    assert.equal(n(cbmOf({ lengthCm: 60, widthCm: 40, heightCm: 30, boxesPacked: 5 })), 0.36);
    assert.equal(cbmOf({ lengthCm: 60, widthCm: 40, boxesPacked: 5 }), null);
  });

  test('blank per-box weights leave N.W and G.W blank', () => {
    const f = packingFigures({ pcsPerBox: 10, boxesPacked: 2 });
    assert.equal(f.nwKg, null);
    assert.equal(f.gwKg, null);
  });

  test('a line needs a box no, pieces per box and boxes; G.W is never under N.W', () => {
    assert.deepEqual(packingProblems({ boxNo: '1-5', pcsPerBox: 12, boxesPacked: 5 }), []);
    assert.deepEqual(packingProblems({ boxNo: '', pcsPerBox: 0, boxesPacked: 1.5 }).map((p) => p.field), ['boxNo', 'pcsPerBox', 'boxesPacked']);
    assert.deepEqual(packingProblems({ boxNo: '1', pcsPerBox: 1, boxesPacked: 1, nwPerBoxKg: '7', gwPerBoxKg: '6' }).map((p) => p.field), ['gwPerBoxKg']);
  });

  test('Box No is box numbers, as many as Boxes', () => {
    assert.deepEqual(parseBoxNo('1-20'), { prefix: '', from: 1, to: 20, count: 20 });
    assert.deepEqual(parseBoxNo(' 7 '), { prefix: '', from: 7, to: 7, count: 1 });
    assert.deepEqual(parseBoxNo('c-1 – 20'), { prefix: 'C-', from: 1, to: 20, count: 20 });
    assert.deepEqual(parseBoxNo('DEMO-001-015'), { prefix: 'DEMO-', from: 1, to: 15, count: 15 });
    assert.equal(parseBoxNo('20-1'), null);
    assert.equal(parseBoxNo('0'), null);
    assert.equal(parseBoxNo('first lot'), null);

    const line = { pcsPerBox: 12, boxesPacked: 5 };
    assert.match(packingProblems({ ...line, boxNo: '1-4' })[0].message, /1-4 is 4 boxes, but Boxes is 5/);
    assert.deepEqual(packingProblems({ ...line, boxNo: 'first lot' }).map((p) => p.field), ['boxNo']);
    assert.deepEqual(packingProblems({ ...line, boxNo: 'first lot' }, { boxNoKept: true }), [], 'an old Box No may stay');
  });
});

describe('The flow of one order and style', () => {
  const flow = shippingFlow({
    approved: D(100),
    checked: D(96),
    cartons: D(8),
    packed: D(60),
    boxesPacked: D(5),
    dispatched: D(36),
    boxesDispatched: D(3),
    shipped: D(0),
    colors: new Map([['Navy', { checked: D(60), packed: D(60) }], ['Black', { checked: D(36), packed: D(0) }]]),
  });

  test('what waits at each stage', () => {
    assert.equal(n(flow.awaitingNeedle), 4);
    assert.equal(n(flow.awaitingPacking), 36);
    assert.equal(n(flow.packedNotDispatched), 24);
    assert.equal(n(flow.boxesNotDispatched), 2);
  });

  test('colour by colour, sorted', () => {
    assert.deepEqual(flow.colors.map((c) => [c.color, n(c.awaitingPacking)]), [['Black', 36], ['Navy', 0]]);
  });
});

describe('Dispatch', () => {
  test('Total Qty and Total Boxes are the packing lines the dispatch takes, style by style', () => {
    const t = dispatchTotalsOf([
      { styleId: 's1', pcsPacked: D(60), boxesPacked: 5 },
      { styleId: 's3', pcsPacked: D(4), boxesPacked: 1 },
      { styleId: 's1', pcsPacked: D(36), boxesPacked: 3 },
    ]);
    assert.deepEqual(t.lines.map((l) => [l.styleId, n(l.pcs), l.boxes]), [['s1', 96, 8], ['s3', 4, 1]]);
    assert.equal(n(t.totalPcs), 100);
    assert.equal(t.totalBoxes, 9);
    assert.deepEqual(dispatchTotalsOf([]).lines, [], 'no packing lines, nothing to dispatch');
  });

  test('the order is Partially Shipped, then Shipped, from what has left', () => {
    assert.equal(shipStatusOf(0, 100), null);
    assert.equal(shipStatusOf(96, 100), 'PARTIALLY_SHIPPED');
    assert.equal(shipStatusOf(100, 100), 'SHIPPED');
  });
});
