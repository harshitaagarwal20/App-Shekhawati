/**
 * THE END-TO-END TEST. NEEDS POSTGRESQL.
 *
 * ===========================================================================
 *  ONE ORDER, ALL THE WAY THROUGH, WITH THE LEDGER CHECKED AT EVERY STAGE
 * ===========================================================================
 *
 *      BUYER ORDER -> PURCHASE ORDER -> GATE PASS -> GRN
 *                  -> JOB WORK ISSUE -> JOB WORK RETURN -> SCRUTINY
 *                  -> PLAN APPROVAL  -> CUTTING CHALLAN -> FABRIC ISSUE
 *                  -> CUTTING ISSUE  -> REMAINDER ROLLBACK
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS DRIVES THE SERVICES AND NOT THE HTTP API
 *
 *  Every rule this test exists to prove lives in a service, and every service
 *  runs its rules inside the transaction that writes the row. Driving HTTP
 *  would add authentication, RBAC and JSON round-trips to a test whose subject
 *  is none of those things - and `test/api.test.js` already covers that layer.
 *
 *  What it does NOT skip is any business rule: the services are the same ones
 *  the controllers call, with the same transaction boundaries.
 *
 *  ---------------------------------------------------------------------------
 *  IT CLEANS UP AFTER ITSELF
 *
 *  Everything it creates is prefixed C2C9- and removed in `after()`, in
 *  dependency order. The seeded data is untouched, so this can be run against
 *  a working database repeatedly without leaving anything behind.
 *
 *      node --test test/c2-c9.e2e.test.js
 */

import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../src/config/prisma.js';
import * as inventory from '../src/services/inventory.service.js';
import * as purchaseOrder from '../src/services/purchaseOrder.service.js';
import * as gatePass from '../src/services/gatePass.service.js';
import * as grnService from '../src/services/grn.service.js';
import * as jobWork from '../src/services/jobWork.service.js';
import * as scrutiny from '../src/services/fabricScrutiny.service.js';
import * as planApproval from '../src/services/planApproval.service.js';
import * as cuttingChallan from '../src/services/cuttingChallan.service.js';
import * as fabricIssue from '../src/services/fabricIssue.service.js';
import * as cuttingIssue from '../src/services/cuttingIssue.service.js';
import * as engine from '../src/services/approvalEngine.js';

let live = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  live = true;
} catch {
  live = false;
}
const skipIfNoDb = () => (live ? false : 'no database configured - skipping');

/**
 * TWO DIFFERENT PEOPLE.
 *
 * Maker-checker is one of the things this test proves, and it cannot be proved
 * with one actor. `maker` raises everything; `checker` approves it.
 */
const maker = { userId: null, fullName: 'E2E Maker' };
const checker = { userId: null, fullName: 'E2E Checker' };

/** Everything created here, for teardown in dependency order. */
const made = {};

/** On-hand for an item at a location, computed from the ledger. */
async function onHand(itemId, location) {
  const rows = await prisma.stockLedger.aggregate({
    where: { itemId, location },
    _sum: { qtyIn: true, qtyOut: true },
  });
  return Number(rows._sum.qtyIn ?? 0) - Number(rows._sum.qtyOut ?? 0);
}

// ===========================================================================

/**
 * Removes everything this file creates, in reverse dependency order.
 *
 * Called BEFORE the run as well as after it. A run that fails partway leaves
 * its rows behind, and the next run then fails on its own setup with a unique
 * violation - which reads as a broken feature when the feature is fine. Only a
 * teardown that also runs first is actually idempotent.
 *
 * Raw deletes, because several of these documents are deliberately immutable
 * through their services. That immutability is the point of them and not
 * something to weaken for a test's convenience.
 */
async function cleanUp() {
  if (!live) return;
  // SCOPED BY DOCUMENT NUMBER ONLY.
  //
  // An earlier version of this list also deleted ledger rows matching
  // `remarks LIKE '%...%'`, which is far too wide a net for an append-only
  // table: remarks are free text written by every posting path in the system,
  // and the delete took a SEEDED receipt with it. A cleanup that can reach
  // rows it did not create is not a cleanup.
  //
  // Document numbers are unique, prefixed, and issued by this file alone.
  const statements = [
    // FIFO: give back what this file's movements drew from each cost layer,
    // then drop the layers and consumptions it created, before the ledger rows
    // they point at.
    `UPDATE stock_cost_layers l SET qty_remaining = l.qty_remaining + c.qty
       FROM (SELECT layer_id, SUM(qty) AS qty FROM stock_layer_consumptions
              WHERE ledger_id IN (SELECT id FROM stock_ledger WHERE document_no LIKE 'C2C9%')
              GROUP BY layer_id) c
      WHERE l.id = c.layer_id`,
    `DELETE FROM stock_layer_consumptions WHERE ledger_id IN (SELECT id FROM stock_ledger WHERE document_no LIKE 'C2C9%')
        OR layer_id IN (SELECT id FROM stock_cost_layers WHERE source_document_no LIKE 'C2C9%')`,
    `DELETE FROM stock_cost_layers WHERE source_document_no LIKE 'C2C9%'`,
    `DELETE FROM stock_ledger WHERE document_no LIKE 'C2C9%'`,
    `DELETE FROM cutting_issues WHERE challan_no LIKE 'C2C9%'`,
    `DELETE FROM fabric_issues WHERE issue_no LIKE 'C2C9%'`,
    `DELETE FROM cutting_challan_lines WHERE challan_id IN (SELECT id FROM cutting_challans WHERE challan_no LIKE 'C2C9%')`,
    `DELETE FROM cutting_challans WHERE challan_no LIKE 'C2C9%'`,
    `DELETE FROM fabric_scrutiny_defects WHERE scrutiny_id IN (SELECT id FROM fabric_scrutinies WHERE scrutiny_no LIKE 'C2C9%')`,
    `DELETE FROM fabric_scrutinies WHERE scrutiny_no LIKE 'C2C9%'`,
    `DELETE FROM dyeing_receipts WHERE receipt_no LIKE 'C2C9%'`,
    `DELETE FROM dye_issues WHERE dye_issue_no LIKE 'C2C9%'`,
    `DELETE FROM plan_approval_lines WHERE plan_approval_id IN (SELECT id FROM plan_approvals WHERE approval_no LIKE 'C2C9%')`,
    `DELETE FROM plan_approvals WHERE approval_no LIKE 'C2C9%'`,
    `DELETE FROM grns WHERE grn_no LIKE 'C2C9%'`,
    `DELETE FROM gate_passes WHERE gate_pass_no LIKE 'C2C9%'`,
    // Orphaned cache rows: a stock_balances row with no movements behind it
    // is drift by definition, not data. Deleting the ledger rows above leaves
    // exactly that for the item this test stocked, and an orphan makes the
    // reconciliation assertion fail on a difference nothing caused.
    //
    // Scoped by "has no ledger rows at all", which cannot reach a balance that
    // still has movements - so it can only ever remove this test's leavings.
    `DELETE FROM stock_balances b
      WHERE NOT EXISTS (
        SELECT 1 FROM stock_ledger l
         WHERE l.item_id = b.item_id AND l.location = b.location
      )`,
    `DELETE FROM fabric_rolls WHERE roll_no LIKE 'C2C9%'`,
    `DELETE FROM purchase_orders WHERE po_id LIKE 'C2C9%'`,
    `DELETE FROM plannings WHERE plan_no LIKE 'C2C9%'`,
    `DELETE FROM excess_approvals WHERE document_no LIKE 'C2C9%'`,
    `DELETE FROM buyer_orders WHERE order_no LIKE 'C2C9%'`,
    `DELETE FROM style_bom_lines WHERE style_id IN (SELECT id FROM styles WHERE style_no LIKE 'C2C9%')`,
    `DELETE FROM styles WHERE style_no LIKE 'C2C9%'`,
    `DELETE FROM approval_history WHERE document_no LIKE 'C2C9%'`,
    `DELETE FROM inventory_items WHERE description LIKE '%C2C9%'`,
  ];
  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch {
      // A leftover row that something else still references is reported by the
      // setup it breaks, not swallowed here into a confusing half-clean state.
    }
  }
}

await cleanUp();

after(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

// ===========================================================================
//  0. THE FIXTURE
// ===========================================================================

describe('E2E - setup', () => {
  test('two distinct users, a buyer, a vendor, a style and an order', { skip: skipIfNoDb() }, async () => {
    const users = await prisma.user.findMany({ take: 2, orderBy: { username: 'asc' } });
    assert.ok(users.length >= 2, 'the test needs two distinct users to prove maker-checker');
    maker.userId = users[0].id;
    checker.userId = users[1].id;
    assert.notEqual(maker.userId, checker.userId);

    const buyer = await prisma.buyer.findFirst({ where: { deletedAt: null } });
    const vendor = await prisma.vendor.findFirst({
      where: { deletedAt: null, poInitials: { not: null } },
    });
    const dyer = await prisma.vendor.findFirst({ where: { deletedAt: null, category: 'Dyeing' } });
    assert.ok(buyer && vendor && dyer, 'seeded masters are required');
    made.buyerId = buyer.id;
    made.vendorId = vendor.id;
    made.dyerId = dyer.id;

    // C9: a style whose BOM carries an explicit, dated utilisation per piece.
    const style = await prisma.style.create({
      data: {
        styleNo: 'C2C9-STYLE-1',
        styleDescription: 'End-to-end tote',
        buyerId: buyer.id,
        category: 'Tote Bag',
        avgFabricUtilizationPerPc: '1.0000',
        avgUtilizationUom: 'Mtrs',
        createdById: maker.userId,
        updatedById: maker.userId,
        bomLines: {
          create: [
            {
              lineNo: 1,
              itemCategory: 'Fabric',
              subCategory: '10 oz',
              uom: 'Mtrs',
              avgUtilisationPerPiece: '1.0000',
              effectiveFrom: new Date('2026-01-01'),
              wastagePct: '0',
              createdById: maker.userId,
              updatedById: maker.userId,
            },
          ],
        },
      },
    });
    made.style = style.id;

    const order = await prisma.buyerOrder.create({
      data: {
        orderNo: 'C2C9-ORD-1',
        orderDate: new Date('2026-08-27'),
        buyerId: buyer.id,
        styleId: style.id,
        // NOT Natural. Two reasons, both real rules rather than test cosmetics:
        //   - a dyeing job may only be raised where the order calls for a
        //     colour, and the service refuses one for natural fabric;
        //   - the inventory item identity includes the colour, so a distinctive
        //     one keeps this test's stock separate from the seeded rolls. With
        //     'Natural' the ledger assertions were measuring seeded stock too.
        colorCode: 'Night Black',
        orderQty: '1000',
        excessPct: '0',
        effectiveQty: '1000',
        buyerDeliveryDate: new Date('2026-12-01'),
        createdById: maker.userId,
        updatedById: maker.userId,
        // C13 - the line IS the order's content, and C14 planning is done
        // against one. A header without lines is not an order the application
        // could produce, and a plan has to name the line it covers.
        lines: {
          create: [{
            lineNo: 1,
            styleId: style.id,
            colorCode: 'Night Black',
            orderQty: '1000',
            effectiveQty: '1000',
            createdById: maker.userId,
            updatedById: maker.userId,
          }],
        },
      },
      include: { lines: true },
    });
    made.order = order.id;
    const orderLine = order.lines[0];

    const plan = await prisma.planning.create({
      data: {
        planNo: 'C2C9-PLAN-1',
        planDate: new Date('2026-08-27'),
        orderId: order.id,
        // The plan is for ONE line of the order - one style.
        orderLineId: orderLine.id,
        styleId: style.id,
        // The Planning sheet keys on the style NUMBER, not the style id.
        styleNo: style.styleNo,
        orderQty: '1000',
        planDepartment: 'CUTTING',
        plannedQty: '1000',
        plannedCuttingPcs: '1000',
        // A real ContainerNo master value: the services validate it.
        containerNo: 'CN-95',
        approvalStatus: 'APPROVED',
        workflowState: 'APPROVED',
        // `plannings_approved_at_present` - a Phase 0 constraint - requires an
        // approved plan to carry its stamp. A fixture that skipped it would be
        // creating a row the application itself could never produce.
        // `plannings_decision_needs_submission` requires a decided plan to
        // have been submitted first. Both stamps together, in the order the
        // application itself would have written them.
        submittedAt: new Date('2026-08-27'),
        approvedAt: new Date('2026-08-27'),
        approvedByName: 'C2C9 Checker',
        approvedById: checker.userId,
        createdById: maker.userId,
        updatedById: maker.userId,
      },
    });
    made.plan = plan.id;
  });
});

// ===========================================================================
//  1. PURCHASE ORDER  (C2 category + frozen tolerances, C9 requirement)
// ===========================================================================

describe('E2E - purchase order', () => {
  test('C2: category and BOTH tolerances are resolved and frozen on the row', { skip: skipIfNoDb() }, async () => {
    const po = await purchaseOrder.create(
      {
        poId: 'C2C9-PO-1',
        poDate: '2026-08-27',
        item: 'Fabric',
        subCategory: '10 oz',
        uom: 'Mtrs',
        orderQty: '1000',
        rate: '100',
        vendorId: made.vendorId,
        orderId: made.order,
        styleId: made.style,
        orderMode: 'AS_PER_STYLE',
        excessAllowed: '0',
        hsnCode: '52081290',
        gsm: '320 GSM',
        content: '100% Cotton',
        // A PO cannot be approved without these: a vendor cannot act on an
        // order that does not say what colour the cloth is or where to send it.
        colorCode: 'Night Black',
        count: '10x6',
        address: 'C2C9 vendor address, Jaipur',
      },
      maker.userId,
    );
    made.po = po.id;

    assert.equal(po.category, 'FABRIC', 'C2: the commercial category is stored, not derived on read');
    assert.ok(po.orderTolerancePct !== null, 'C2: the order tolerance is frozen on the row');
    assert.ok(po.receiptTolerancePct !== null, 'C2: and so is the receipt tolerance');
    assert.ok(po.toleranceBasis, 'C2: with the basis it came from');

    // C9: the requirement the ceiling was applied against, frozen.
    assert.equal(
      Number(po.computedRequirementQty),
      1000,
      'C9: 1.0 Mtrs/pc x 1000 pcs, from the one shared calculation',
    );
  });

  test('C2: payable quantity starts at zero - nothing has arrived', { skip: skipIfNoDb() }, async () => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: made.po } });
    assert.equal(Number(po.payableQty), 0);
  });

  test('the PO is approved by somebody other than its maker', { skip: skipIfNoDb() }, async () => {
    await purchaseOrder.approve(made.po, { remarks: 'E2E approval' }, checker);
    const po = await prisma.purchaseOrder.findUnique({ where: { id: made.po } });
    assert.equal(po.approvalStatus, 'APPROVED');
  });
});

// ===========================================================================
//  2. GATE PASS  (C8 movement time)
// ===========================================================================

describe('E2E - gate pass', () => {
  test('C8: movement time is recorded and differs from record creation', { skip: skipIfNoDb() }, async () => {
    const movedAt = new Date(Date.now() - 6 * 60 * 60 * 1000); // six hours ago
    const gp = await gatePass.create(
      {
        gatePassNo: 'C2C9-GP-1',
        gatePassDate: '2026-08-27',
        movementTime: movedAt.toISOString(),
        type: 'INWARD',
        linkedDocNo: 'C2C9-PO-1',
        item: 'Fabric',
        vendorId: made.vendorId,
        partyName: 'E2E vendor',
        qty: '1000',
        uom: 'Mtrs',
        purpose: 'CUTTING',
      },
      maker.userId,
    );
    made.gatePass = gp.id;

    const row = await prisma.gatePass.findUnique({ where: { id: gp.id } });
    assert.ok(row.movementTime, 'C8: a gate pass must say when the goods crossed');
    assert.notEqual(
      row.movementTime.getTime(),
      row.createdAt.getTime(),
      'C8: movement time is not record-creation time',
    );
    assert.ok(row.movementTime < row.createdAt, 'the lorry crossed before the clerk typed it up');
  });

  test('C8: a future movement time is refused', { skip: skipIfNoDb() }, async () => {
    await assert.rejects(
      gatePass.create(
        {
          gatePassNo: 'C2C9-GP-FUTURE',
          gatePassDate: '2026-08-27',
          movementTime: new Date(Date.now() + 86400000).toISOString(),
          type: 'INWARD',
          linkedDocNo: 'C2C9-PO-1',
          item: 'Fabric',
          partyName: 'E2E vendor',
          qty: '1',
          uom: 'Mtrs',
          purpose: 'CUTTING',
        },
        maker.userId,
      ),
      /in the future/i,
    );
  });
});

// ===========================================================================
//  3. GRN  (C2 cumulative tolerance + payable quantity, ledger IN)
// ===========================================================================

describe('E2E - GRN and the ledger', () => {
  test('the receipt posts a ledger IN and creates the roll', { skip: skipIfNoDb() }, async () => {
    const grn = await grnService.create(
      {
        grnNo: 'C2C9-GRN-1',
        billNo: 'C2C9-BILL-1',
        grnDate: '2026-08-27',
        purchaseOrderId: made.po,
        gatePassId: made.gatePass,
        purpose: 'RAW_MATERIAL',
        receivingQty: '1000',
        rolls: [{ rollNo: 'C2C9-ROLL-1', qty: '1000' }],
      },
      maker,
    );
    made.grn = grn.id;

    const row = await prisma.grn.findUnique({ where: { id: grn.id } });
    made.item = row.inventoryItemId;
    assert.ok(made.item, 'the receipt resolves a stock item');

    const roll = await prisma.fabricRoll.findFirst({ where: { rollNo: 'C2C9-ROLL-1' } });
    made.roll = roll.id;

    assert.equal(await onHand(made.item, 'MAIN STORE'), 1000, 'LEDGER: 1000 in the main store');
  });

  test('C2: the receipt was judged by the tolerance frozen on the ORDER', { skip: skipIfNoDb() }, async () => {
    const [grn, po] = await Promise.all([
      prisma.grn.findUnique({ where: { id: made.grn } }),
      prisma.purchaseOrder.findUnique({ where: { id: made.po } }),
    ]);
    assert.equal(
      Number(grn.receiptTolerancePct),
      Number(po.receiptTolerancePct),
      'not re-resolved on the day the lorry arrived',
    );
    assert.equal(grn.category, po.category);
    assert.equal(Number(grn.cumulativeReceivedQty), 1000);
  });

  /** C2: "Payable quantity is based on received quantity, not ordered quantity." */
  test('C2: payable quantity follows the goods', { skip: skipIfNoDb() }, async () => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: made.po } });
    assert.equal(Number(po.payableQty), 1000);
    assert.equal(Number(po.receivedQty), 1000);
  });

  test('C2: a further receipt beyond the cumulative tolerance is refused', { skip: skipIfNoDb() }, async () => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: made.po } });
    const overBy = Number(po.orderQty) * Number(po.receiptTolerancePct) + 10;

    await assert.rejects(
      grnService.create(
        {
          grnNo: 'C2C9-GRN-OVER',
          billNo: 'C2C9-BILL-OVER',
          grnDate: '2026-08-27',
          purchaseOrderId: made.po,
          purpose: 'RAW_MATERIAL',
          receivingQty: String(overBy),
          rolls: [{ rollNo: 'C2C9-ROLL-OVER', qty: String(overBy) }],
        },
        maker,
      ),
      /over|tolerance/i,
      'the cumulative total, not this receipt alone, is what breaches',
    );
  });
});

// ===========================================================================
//  4. JOB WORK  (C3 - [A][S], approval gate, transfer legs, shrinkage)
// ===========================================================================

describe('E2E - job work', () => {
  test('C3: fabric CANNOT be issued to a job worker with no approved order', { skip: skipIfNoDb() }, async () => {
    await assert.rejects(
      fabricIssue.create(
        {
          issueNo: 'C2C9-FI-REFUSED',
          issueDate: '2026-08-27',
          rollId: made.roll,
          purpose: 'DYEING',
          orderId: made.order,
          styleId: made.style,
          vendorId: made.dyerId,
          issuedByName: 'E2E Store',
          fabricQtyIssued: '500',
        },
        maker,
      ),
      /no approved job work order/i,
      'C3: a bare stock movement to a job worker must be refused',
    );
  });

  test('C3: the job work order is raised as a DRAFT and states its own shrinkage tolerance', { skip: skipIfNoDb() }, async () => {
    const job = await jobWork.create(
      {
        dyeIssueNo: 'C2C9-JW-1',
        issueDate: '2026-08-27',
        process: 'DYEING',
        rollId: made.roll,
        vendorId: made.dyerId,
        orderId: made.order,
        styleId: made.style,
        qty: '500',
        uom: 'Mtrs',
        rate: '40',
      },
      maker.userId,
    );
    made.job = job.id;

    const row = await prisma.dyeIssue.findUnique({ where: { id: job.id } });
    assert.equal(row.workflowState, 'DRAFT', 'C3: nothing is authorised yet');
    assert.ok(row.shrinkageRuleId, 'C3: the tolerance came from the master, not a default');
    assert.equal(Number(row.shrinkageTolerancePct), 0.03, 'the seeded dyeing standard');
    assert.equal(Number(row.expectedReturnQty), 485, '500 x (1 - 0.03)');
    assert.equal(row.stockPostedAt, null, 'raising the order moves no stock');
  });

  test('C3: the maker cannot approve their own job work order', { skip: skipIfNoDb() }, async () => {
    await assert.rejects(
      jobWork.approveJob(made.job, {}, maker),
      /cannot also approve it/i,
      'maker-checker',
    );
  });

  test('C3: approved by the checker, the issue posts BOTH ledger legs', { skip: skipIfNoDb() }, async () => {
    await jobWork.submitJob(made.job, { submittedTo: 'Dinesh Sir' }, maker);
    await jobWork.approveJob(made.job, { remarks: 'E2E' }, checker);

    // One PO for 500, sent on two challans of 250 each.
    const challan = (issueNo, fabricQtyIssued) =>
      fabricIssue.create(
        {
          issueNo,
          issueDate: '2026-08-27',
          rollId: made.roll,
          purpose: 'DYEING',
          orderId: made.order,
          styleId: made.style,
          vendorId: made.dyerId,
          issuedByName: 'E2E Store',
          fabricQtyIssued,
        },
        maker,
      );

    await challan('C2C9-FI-1', '250');
    let row = await prisma.dyeIssue.findUnique({ where: { id: made.job } });
    assert.equal(row.workflowState, 'POSTED', 'the first challan puts the PO at the vendor');
    assert.equal(Number(row.issuedQty), 250, 'half the PO has gone');

    await challan('C2C9-FI-2', '250');
    row = await prisma.dyeIssue.findUnique({ where: { id: made.job } });
    assert.equal(Number(row.issuedQty), 500, 'the second challan draws on the same PO');

    await assert.rejects(
      challan('C2C9-FI-3', '1'),
      /no approved job work order/i,
      'the PO is fully sent - a third challan has nothing to draw on',
    );

    const printed = await fabricIssue.printView(
      (await prisma.fabricIssue.findFirst({ where: { issueNo: 'C2C9-FI-2' } })).id,
    );
    assert.equal(printed.documentTitle, 'DYEING CHALLAN');
    assert.equal(printed.po.challanSeq, 2);
    assert.equal(Number(printed.po.previouslySentQty), 250);
    assert.equal(Number(printed.po.balanceQty), 0);

    assert.equal(await onHand(made.item, 'MAIN STORE'), 500, 'LEDGER: 500 left the store');
    assert.equal(
      await onHand(made.item, 'AT DYEING VENDOR'),
      500,
      'LEDGER: and 500 arrived at the dye house - a transfer, not a disappearance',
    );

    const summary = await inventory.onHandSummary(null, made.item);
    assert.equal(Number(summary.totalOnHandQty), 1000, 'C3: still visible in TOTAL on hand');
    assert.equal(
      Number(summary.availableForIssueQty),
      500,
      'C3: but excluded from available-for-issue',
    );
    assert.equal(Number(summary.withJobWorkerQty), 500);
  });

  test('C3: the job work order moved to POSTED with the fabric', { skip: skipIfNoDb() }, async () => {
    const row = await prisma.dyeIssue.findUnique({ where: { id: made.job } });
    assert.equal(row.workflowState, 'POSTED');
    assert.ok(row.stockPostedAt, 'stamped in the same transaction as the movement');
  });

  test('C3: a return beyond tolerance is BLOCKED without the scrutiny path', { skip: skipIfNoDb() }, async () => {
    await assert.rejects(
      jobWork.receive(made.job, { receiptNo: 'C2C9-DR-BAD', qtyReceived: '450' }, maker),
      /needs scrutiny/i,
      'C3: 10% short against a 3% tolerance must not post quietly',
    );
  });

  test('C3: a return WITHIN tolerance posts, and returns the fabric to the store', { skip: skipIfNoDb() }, async () => {
    // 2.5% shrinkage against a 3% tolerance - the brief's own passing case.
    await jobWork.receive(
      made.job,
      { receiptNo: 'C2C9-DR-1', receiptDate: '2026-08-28', qtyReceived: '487.5' },
      maker,
    );

    assert.equal(
      await onHand(made.item, 'AT DYEING VENDOR'),
      0,
      'LEDGER: the dye house is emptied - the 12.5 shrinkage is a real loss',
    );
    assert.equal(await onHand(made.item, 'MAIN STORE'), 987.5, 'LEDGER: 500 + 487.5 back');

    const receipt = await prisma.dyeingReceipt.findFirst({ where: { receiptNo: 'C2C9-DR-1' } });
    made.receipt = receipt.id;
    assert.equal(receipt.requiresScrutiny, false, 'C4: within standard - NO SCRUTINY REQUIRED');
  });
});

// ===========================================================================
//  5. SCRUTINY  (C4 - defect lines, and the conditional gate)
// ===========================================================================

describe('E2E - fabric scrutiny', () => {
  test('C4: a REJECT with no defect lines cannot be posted', { skip: skipIfNoDb() }, async () => {
    const s = await scrutiny.create(
      {
        scrutinyNo: 'C2C9-FS-1',
        scrutinyDate: '2026-08-28',
        rollId: made.roll,
        orderId: made.order,
        styleId: made.style,
        defectType: 'Dyeing Shade Variation',
        qtyAffected: '10',
        uom: 'Mtrs',
        checkedByName: 'E2E QC',
      },
      maker.userId,
    );
    made.scrutiny = s.id;

    await assert.rejects(
      scrutiny.finalise(made.scrutiny, { decision: 'REJECT' }, checker),
      /without at least one defect line/i,
      'C4: a rejection has to say what was found',
    );
  });

  test('C4: with a structured defect line, the decision posts', { skip: skipIfNoDb() }, async () => {
    const done = await scrutiny.finalise(
      made.scrutiny,
      {
        decision: 'ACCEPT',
        defects: [
          {
            category: 'DYEING',
            defectType: 'Dyeing Shade Variation',
            qty: '10',
            remarks: 'Minor, accepted',
          },
        ],
      },
      checker,
    );
    assert.equal(done.decision, 'ACCEPT');

    const lines = await prisma.fabricScrutinyDefect.findMany({
      where: { scrutinyId: made.scrutiny },
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].category, 'DYEING', 'C4: dyeing and weaving defects are distinguishable');
  });
});

// ===========================================================================
//  6. PLAN APPROVAL  (C7 - plan types, versions, one current)
// ===========================================================================

describe('E2E - plan approval', () => {
  test('C7: one versioned header carries all three plan types', { skip: skipIfNoDb() }, async () => {
    const pa = await planApproval.create(
      {
        approvalNo: 'C2C9-PA-1',
        submittedDate: '2026-08-28',
        orderId: made.order,
        styleId: made.style,
        // A real ContainerNo master value: the services validate it.
        containerNo: 'CN-95',
        preparedBy: 'E2E Maker',
        submittedTo: 'Dinesh Sir',
        planningId: made.plan,
        plans: [
          { planType: 'CUTTING', plannedQty: '1000', uom: 'Pcs' },
          { planType: 'STITCHING', plannedQty: '1000', uom: 'Pcs' },
          { planType: 'SHIPPING', plannedQty: '1000', uom: 'Pcs' },
        ],
      },
      maker.userId,
    );
    made.planApproval = pa.id;

    const lines = await prisma.planApprovalLine.findMany({ where: { planApprovalId: pa.id } });
    assert.equal(lines.length, 3, 'C7: cutting, stitching and shipping on ONE signature');
    assert.deepEqual(
      lines.map((l) => l.planType).sort(),
      ['CUTTING', 'SHIPPING', 'STITCHING'],
    );
    assert.equal(pa.round, 1, 'version 1');
    assert.equal(pa.isCurrent, false, 'a pending version is never current');
  });

  test('C7: approving makes it the current version for its style and container', { skip: skipIfNoDb() }, async () => {
    await planApproval.approve(made.planApproval, { remarks: 'E2E' }, checker);
    const pa = await prisma.planApproval.findUnique({ where: { id: made.planApproval } });
    assert.equal(pa.approvalStatus, 'APPROVED');
    assert.equal(pa.isCurrent, true);
    assert.equal(pa.isLocked, true, 'an approved version is immutable');
  });
});

// ===========================================================================
//  7. CUTTING CHALLAN  (C5) and FABRIC ISSUE
// ===========================================================================

describe('E2E - cutting challan and fabric issue', () => {
  test('C5: a challan is raised against the approved plan and approved by a second person', { skip: skipIfNoDb() }, async () => {
    const cc = await cuttingChallan.create(
      {
        challanNo: 'C2C9-CC-1',
        challanDate: '2026-08-28',
        orderId: made.order,
        styleId: made.style,
        planningId: made.plan,
        planApprovalId: made.planApproval,
        // A real ContainerNo master value: the services validate it.
        containerNo: 'CN-95',
        lines: [
          {
            lineNo: 1,
            itemCategory: 'Fabric',
            subCategory: '10 oz',
            requiredQty: '100',
            uom: 'Mtrs',
          },
        ],
      },
      maker,
    );
    made.challan = cc.id;
    made.challanLine = cc.lines[0].id;

    await assert.rejects(
      cuttingChallan.approve(made.challan, {}, maker),
      /cannot also approve it/i,
      'maker-checker on the challan too',
    );

    await cuttingChallan.submit(made.challan, { submittedTo: 'Dinesh Sir' }, maker);
    await cuttingChallan.approve(made.challan, { remarks: 'E2E' }, checker);

    const row = await prisma.cuttingChallan.findUnique({ where: { id: made.challan } });
    assert.equal(row.workflowState, 'APPROVED');
  });

  test('C5: a fabric issue with no challan line is refused', { skip: skipIfNoDb() }, async () => {
    await assert.rejects(
      fabricIssue.create(
        {
          issueNo: 'C2C9-FI-NOCC',
          issueDate: '2026-08-28',
          rollId: made.roll,
          purpose: 'CUTTING',
          orderId: made.order,
          styleId: made.style,
          issuedByName: 'E2E Store',
          fabricQtyIssued: '40',
        },
        maker,
      ),
      /must quote the approved cutting challan line/i,
    );
  });

  /** C5's own worked example: 40 + 30 + 30 fills a line of 100, and a fourth fails. */
  test('C5: partial fulfilment 40 + 30 + 30 completes the line; a fourth issue is refused', { skip: skipIfNoDb() }, async () => {
    const before = await onHand(made.item, 'MAIN STORE');

    for (const [i, qty] of ['40', '30', '30'].entries()) {
      await fabricIssue.create(
        {
          issueNo: `C2C9-FI-C${i + 1}`,
          issueDate: '2026-08-28',
          rollId: made.roll,
          purpose: 'CUTTING',
          orderId: made.order,
          styleId: made.style,
          issuedByName: 'E2E Store',
          fabricQtyIssued: qty,
          cuttingChallanLineId: made.challanLine,
        },
        maker,
      );
    }

    const line = await prisma.cuttingChallanLine.findUnique({ where: { id: made.challanLine } });
    assert.equal(Number(line.issuedQty), 100, 'C5: the total is re-derived from the issues');
    assert.equal(line.status, 'COMPLETED');

    assert.equal(await onHand(made.item, 'MAIN STORE'), before - 100, 'LEDGER: 100 left the store');
    assert.equal(await onHand(made.item, 'CUTTING FLOOR'), 100, 'LEDGER: and reached the floor');

    await assert.rejects(
      fabricIssue.create(
        {
          issueNo: 'C2C9-FI-C4',
          issueDate: '2026-08-28',
          rollId: made.roll,
          purpose: 'CUTTING',
          orderId: made.order,
          styleId: made.style,
          issuedByName: 'E2E Store',
          fabricQtyIssued: '1',
          cuttingChallanLineId: made.challanLine,
        },
        maker,
      ),
      /fully issued|over-fulfilment/i,
      'C5: over-fulfilment is never allowed',
    );
  });
});

// ===========================================================================
//  8. CUTTING ISSUE AND THE REMAINDER ROLLBACK  (C6)
// ===========================================================================

describe('E2E - cutting issue and remainder rollback', () => {
  test('C6: an unbalanced fabric equation is refused', { skip: skipIfNoDb() }, async () => {
    const ci = await cuttingIssue.create(
      {
        challanNo: 'C2C9-CI-1',
        issueDate: '2026-08-28',
        orderId: made.order,
        styleId: made.style,
        // A real StitchingUnit master value: the service validates it.
        firmName: 'Unit 1 - Anil Kumar',
        plannedCutting: '1000',
        unitWiseCuttingPcsToBeIssued: '80',
        cuttingPcsIssued: '80',
        planningId: made.plan,
        planApprovalId: made.planApproval,
        fabricIssueId: (await prisma.fabricIssue.findFirst({ where: { issueNo: 'C2C9-FI-C1' } })).id,
        issuedQty: '100',
        consumedQty: '80',
        remainderQty: '15',
        wastageQty: '5',
        fabricUom: 'Mtrs',
      },
      maker.userId,
    );
    made.cuttingIssue = ci.id;

    const check = ci.verification.checks.find((c) => c.code === 'REMAINDER_RECONCILES');
    assert.ok(check, 'C6: the tenth check runs');
    assert.equal(check.passed, true, '100 = 80 + 15 + 5');

    // And the unbalanced version is refused at the database level.
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `UPDATE cutting_issues SET wastage_qty = 0 WHERE id = '${made.cuttingIssue}'`,
      ),
      /cutting_issues_remainder_reconciles/,
    );
  });

  test('C6: posting runs ALL TEN checks and appends the ledger entries', { skip: skipIfNoDb() }, async () => {
    const beforeStore = await onHand(made.item, 'MAIN STORE');

    const posted = await cuttingIssue.post(made.cuttingIssue, {}, checker);
    assert.ok(posted.postedAt, 'the challan is posted and locked');

    const row = await prisma.cuttingIssue.findUnique({ where: { id: made.cuttingIssue } });
    assert.ok(row.stockPostedAt, 'C6: and the ledger moved with it');

    assert.equal(
      await onHand(made.item, 'CUTTING FLOOR'),
      0,
      'LEDGER: the whole 100 left the floor - 85 became panels and offcuts, 15 went back',
    );
    assert.equal(
      await onHand(made.item, 'MAIN STORE'),
      beforeStore + 15,
      'LEDGER: the remainder rolled back into the store',
    );
  });

  test('C6: the remainder keeps its roll identity - no anonymous stock', { skip: skipIfNoDb() }, async () => {
    const entry = await prisma.stockLedger.findFirst({
      where: {
        documentType: 'CUTTING_ISSUE',
        documentId: made.cuttingIssue,
        direction: 'IN',
      },
    });
    assert.ok(entry, 'the remainder was written as a ledger IN');
    assert.equal(entry.rollId, made.roll, 'C6: on the SAME roll it came off');
    assert.equal(entry.location, 'MAIN STORE');
  });

  test('the ten checks all ran, and none short-circuited', { skip: skipIfNoDb() }, async () => {
    const checks = cuttingIssue.checklist();
    assert.equal(checks.length, 10, 'nine original plus C6');
    assert.ok(checks.some((c) => c.code === 'REMAINDER_RECONCILES'));
  });
});

// ===========================================================================
//  9. THE CLOSING ASSERTIONS THE BRIEF ASKS FOR
// ===========================================================================

describe('E2E - closing assertions', () => {
  /** POST /api/inventory/stock/reconcile?dryRun=true -> ZERO DIFFERENCES. */
  test('stock reconciliation dry-run reports ZERO differences', { skip: skipIfNoDb() }, async () => {
    const result = await inventory.rebuildBalances({ dryRun: true });
    assert.equal(
      result.differences.length,
      0,
      `Every cached balance must equal the sum of its movements. Differences: ${JSON.stringify(result.differences)}`,
    );
    assert.equal(result.inAgreement, true);
    assert.equal(result.rebuilt, false, 'a dry run writes nothing');
  });

  test('no direct balance mutation: every balance is derivable from the ledger', { skip: skipIfNoDb() }, async () => {
    const rows = await prisma.$queryRaw`
      SELECT b.item_id, b.location, b.qty AS stored, COALESCE(l.total, 0) AS ledger
        FROM stock_balances b
        LEFT JOIN (
          SELECT item_id, location, SUM(qty_in) - SUM(qty_out) AS total
            FROM stock_ledger GROUP BY item_id, location
        ) l ON l.item_id = b.item_id AND l.location = b.location
       WHERE b.qty <> COALESCE(l.total, 0)`;
    assert.equal(rows.length, 0);
  });

  test('the ledger is append-only: every movement still has its document', { skip: skipIfNoDb() }, async () => {
    const orphans = await prisma.$queryRaw`
      SELECT count(*)::int AS n FROM stock_ledger WHERE document_id IS NULL OR document_no = ''`;
    assert.equal(orphans[0].n, 0, 'no movement without a document behind it');
  });

  test('quantities reconcile for this order end to end', { skip: skipIfNoDb() }, async () => {
    const summary = await inventory.onHandSummary(null, made.item);
    // 1000 received
    //   - 12.5 lost as shrinkage at the dye house
    //   - 85 that became panels and offcuts on the cutting floor
    //   = 902.5 still owned, all of it back on the rack.
    assert.equal(Number(summary.totalOnHandQty), 902.5);
    assert.equal(
      Number(summary.availableForIssueQty),
      902.5,
      'the 15 remainder rolled back to the store and is issuable again',
    );
    assert.equal(Number(summary.onCuttingFloorQty), 0, 'the challan emptied the floor');
    assert.equal(Number(summary.withJobWorkerQty), 0, 'the dye house is settled');
  });

  test('every approval transition left exactly one stage event', { skip: skipIfNoDb() }, async () => {
    for (const [type, id] of [
      ['PURCHASE_ORDER', made.po],
      ['DYE_ISSUE', made.job],
      ['CUTTING_CHALLAN', made.challan],
      ['CUTTING_ISSUE', made.cuttingIssue],
    ]) {
      const events = await engine.stageEvents(type, id);
      assert.ok(events.length > 0, `${type} produced no stage events`);
      for (const e of events) {
        assert.ok(e.fromState && e.toState, 'C8: every event names both states');
        assert.ok(e.occurredAt, 'and when it happened');
      }
    }
  });

  test('approval transitions were valid, and makers did not approve their own work', { skip: skipIfNoDb() }, async () => {
    const events = await engine.stageEvents('CUTTING_CHALLAN', made.challan);
    const approved = events.find((e) => e.toState === 'APPROVED');
    assert.ok(approved, 'the challan reached APPROVED');
    assert.equal(approved.actorId, checker.userId, 'approved by the checker, not the maker');

    const challan = await prisma.cuttingChallan.findUnique({ where: { id: made.challan } });
    assert.equal(challan.createdById, maker.userId);
    assert.notEqual(challan.createdById, approved.actorId);
  });
});
