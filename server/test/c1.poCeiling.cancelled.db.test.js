/**
 * C1 - THE ORDERING CEILING AND THE TWO STATUS AXES. REQUIRES A DATABASE.
 *
 *     npm run db:setup          # migrate + seed
 *     npm test --workspace server
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS FILE EXISTS
 *
 *  `alreadyOrderedQty_()` decides how much of a style requirement is already
 *  spoken for, and therefore how much may still be bought. It is a DATABASE
 *  QUESTION - a `where` clause, not arithmetic - so it cannot be proved in the
 *  rules file next door. What can go wrong with it is not a wrong sum but a
 *  wrong filter, and a wrong filter fails silently: the number it returns is
 *  perfectly well-formed, it just counts orders that no longer exist in any
 *  sense that matters.
 *
 *  A purchase order carries TWO independent status axes:
 *
 *    workflowState / approvalStatus   was this order allowed?
 *    status                           are the goods coming?
 *
 *  Cancelling a PO moves the second and (via setStatus) the first, but
 *  deliberately leaves `approvalStatus` at APPROVED, because the approval
 *  genuinely happened and the record of it stands. A filter that reads only
 *  the approval axis therefore keeps charging the ceiling for an order nobody
 *  will ever fulfil - and blocks the re-order that the cancellation exists to
 *  permit. That is the case below, end to end.
 *
 *  Everything here builds its own buyer order rather than borrowing the seed's,
 *  so the arithmetic is exact and no seed PO is silently consuming headroom.
 * ---------------------------------------------------------------------------
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import prisma from '../src/config/prisma.js';
import { quantityCeiling } from '../src/services/purchaseOrder.service.js';

const D = (v) => new Prisma.Decimal(v ?? 0);

/** 3% - the order tolerance C1 permits on fabric. */
const EXCESS = '0.03';

let style;
let vendor;
let order;
let requirement;
let fabricSubCategory;

const stamp = Date.now();
const createdPoIds = [];

before(async () => {
  style = await prisma.style.findFirst({
    where: { deletedAt: null, avgFabricUtilizationPerPc: { gt: 0 } },
    include: { bomLines: true },
  });
  vendor = await prisma.vendor.findFirst({
    where: { deletedAt: null, status: 'ACTIVE', poInitials: { not: null } },
  });
  assert.ok(style, 'seed must provide a style with an average utilisation');
  assert.ok(vendor, 'seed must provide an active vendor');

  const source = await prisma.buyerOrder.findFirst({
    where: { deletedAt: null, styleId: style.id },
  });
  assert.ok(source, 'seed must provide a buyer order for that style');

  // A buyer order of this test's own, so nothing else is on it. No approved
  // excess: effectiveQty === orderQty keeps the expected figures readable.
  order = await prisma.buyerOrder.create({
    data: {
      orderNo: `C1-CANCEL-${stamp}`,
      styleId: style.id,
      buyerId: source.buyerId,
      orderDate: new Date(),
      orderQty: '10000',
      effectiveQty: '10000',
    },
  });

  const fabricLine = style.bomLines.find(
    (b) => b.itemCategory === 'Fabric' && b.deletedAt == null && b.isActive !== false,
  );
  fabricSubCategory = fabricLine?.subCategory ?? null;

  // What the server will compute: header utilisation x qty x (1 + the Fabric
  // BOM line's wastage). Derived rather than hardcoded so the test follows the
  // seed instead of pinning it.
  requirement = D(style.avgFabricUtilizationPerPc)
    .mul(D(order.orderQty))
    .mul(D(1).plus(D(fabricLine?.wastagePct)))
    .toDecimalPlaces(4);
});

after(async () => {
  if (createdPoIds.length) {
    await prisma.approvalHistory.deleteMany({ where: { documentId: { in: createdPoIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: createdPoIds } } });
  }
  if (order) await prisma.buyerOrder.delete({ where: { id: order.id } });
  await prisma.$disconnect();
});

/**
 * Writes a PO row directly, in whatever status the case needs.
 *
 * Deliberately NOT through the service: the point is to set up a board
 * position - an approved order, a cancelled one, a rejected one - and then ask
 * the ceiling what it makes of it. Driving the API would mean satisfying
 * maker-checker to reach APPROVED, which is a different control's test.
 */
async function givenPo({ orderQty, status, approvalStatus, workflowState }) {
  // The table's CHECK constraints insist a decided PO carries its decision:
  // a name and a decidedAt for anything past PENDING, an approvedAt for an
  // approval, a reason for a rejection - and NONE of them while it is pending.
  // Honouring that here is what makes these rows the real thing rather than a
  // shape the ceiling happens to accept.
  const decided = approvalStatus !== 'PENDING';
  const decidedAt = decided ? new Date() : null;

  const row = await prisma.purchaseOrder.create({
    data: {
      approvedByName: decided ? 'C1 ceiling test' : null,
      decidedAt,
      approvedAt: approvalStatus === 'APPROVED' ? decidedAt : null,
      rejectionReason: approvalStatus === 'REJECTED' ? 'Vendor withdrew' : null,
      poId: `C1-CX-${stamp}-${createdPoIds.length + 1}`,
      poDate: new Date(),
      item: 'Fabric',
      category: 'FABRIC',
      subCategory: fabricSubCategory,
      uom: 'Mtrs',
      orderQty,
      rate: '100',
      amount: D(orderQty).mul(100).toFixed(2),
      excessAllowed: EXCESS,
      orderTolerancePct: EXCESS,
      receiptTolerancePct: '0.02',
      vendorId: vendor.id,
      orderId: order.id,
      styleId: style.id,
      orderMode: 'AS_PER_STYLE',
      computedRequirementQty: requirement,
      status,
      approvalStatus,
      workflowState,
    },
  });
  createdPoIds.push(row.id);
  return row;
}

/** What the ceiling says about ordering `qty` more of the same fabric. */
function ceilingFor(qty) {
  return quantityCeiling({
    order,
    style,
    orderMode: 'AS_PER_STYLE',
    item: 'Fabric',
    subCategory: fabricSubCategory,
    accessoriesItem: null,
    uom: 'Mtrs',
    orderQty: qty,
    excessAllowed: EXCESS,
  });
}

describe('C1 - a cancelled purchase order releases the ceiling it was holding', () => {
  test('an APPROVED order consumes the ceiling, and blocks a second one', async () => {
    const before_ = await ceilingFor(requirement.toString());
    assert.equal(before_.alreadyOrdered, '0.0000', 'this order starts with nothing on it');
    assert.equal(before_.withinCeiling, true, 'the requirement itself must be orderable');

    await givenPo({
      orderQty: requirement.toString(),
      status: 'IN_PROGRESS',
      approvalStatus: 'APPROVED',
      workflowState: 'APPROVED',
    });

    const blocked = await ceilingFor(requirement.toString());
    assert.equal(blocked.alreadyOrdered, requirement.toFixed(4));
    assert.equal(blocked.withinCeiling, false, 'the requirement is spoken for');
  });

  /**
   * THE CASE. The vendor fell through, no goods were received, the PO was
   * cancelled. Its quantity must stop counting - or procurement is blocked on
   * an order nobody will ever fulfil.
   */
  test('cancelling it hands the quantity back, and the re-order is permitted', async () => {
    const po = await prisma.purchaseOrder.findFirst({
      where: { orderId: order.id, status: 'IN_PROGRESS' },
    });
    assert.ok(po, 'the approved PO from the previous case');

    // Exactly what setStatus() writes: both the fulfilment axis and the
    // workflow axis move, and approvalStatus is deliberately left APPROVED.
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'CANCELLED', workflowState: 'CANCELLED' },
    });

    const cancelled = await prisma.purchaseOrder.findUnique({ where: { id: po.id } });
    assert.equal(
      cancelled.approvalStatus,
      'APPROVED',
      'the approval stands as a record - which is exactly why it cannot be the filter',
    );

    const after_ = await ceilingFor(requirement.toString());
    assert.equal(
      after_.alreadyOrdered,
      '0.0000',
      'a cancelled order holds none of the requirement',
    );
    assert.equal(after_.withinCeiling, true, 'so the same fabric may be bought again');
  });

  test('a REJECTED order never counted, and still does not', async () => {
    await givenPo({
      orderQty: requirement.toString(),
      status: 'PENDING',
      approvalStatus: 'REJECTED',
      workflowState: 'REJECTED',
    });

    const verdict = await ceilingFor(requirement.toString());
    assert.equal(verdict.alreadyOrdered, '0.0000');
    assert.equal(verdict.withinCeiling, true);
  });

  test('a live order is still counted - the filter did not simply stop working', async () => {
    const half = requirement.div(2).toDecimalPlaces(4);
    await givenPo({
      orderQty: half.toString(),
      status: 'PENDING',
      approvalStatus: 'PENDING',
      workflowState: 'PENDING_APPROVAL',
    });

    const verdict = await ceilingFor(half.toString());
    assert.equal(
      verdict.alreadyOrdered,
      half.toFixed(4),
      'an order still awaiting approval is still a claim on the requirement',
    );
    assert.equal(verdict.withinCeiling, true, 'and half the requirement leaves room for half more');
  });
});
