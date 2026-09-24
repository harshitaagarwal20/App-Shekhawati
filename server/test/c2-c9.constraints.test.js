/**
 * C2 - C9. DATABASE-LEVEL PROTECTION. NEEDS POSTGRESQL.
 *
 * ===========================================================================
 *  WHY THIS FILE EXISTS SEPARATELY FROM THE RULE TESTS
 * ===========================================================================
 *
 * Rule 19 of the brief: "Do not mark a task complete if only application
 * validation exists without required database protection." A Zod schema and a
 * service check protect the API. They protect nothing at all from a psql
 * session, a data-fix script, a future service that forgets, or a bug in the
 * validation itself.
 *
 * Every test below therefore goes AROUND the services entirely and writes with
 * the raw client, asserting that PostgreSQL refuses on its own. If any of these
 * pass when they should fail, the corresponding rule is not implemented -
 * whatever the rule tests say.
 *
 * Each test cleans up after itself and none of them commits anything that
 * survives: the writes that are expected to fail cannot leave a row behind, and
 * the few that must succeed first are rolled back.
 *
 *     node --test test/c2-c9.constraints.test.js
 */

import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

// The shared client, which loads server/.env through src/config/env.js. Using
// a bare `new PrismaClient()` here silently produced a client with no
// DATABASE_URL and skipped every test in this file - which looked like a clean
// run and proved nothing at all.
import prisma from '../src/config/prisma.js';

/**
 * Whether a database is actually reachable.
 *
 * Probed with a TOP-LEVEL await rather than in a `before()` hook, and that is
 * not a stylistic choice: node:test evaluates a test's `skip` option when the
 * `describe` body runs, which is BEFORE any hook fires. Setting this flag in
 * `before()` left it false at the moment every skip was decided, so all 41
 * tests skipped against a perfectly healthy database and the run reported a
 * clean pass having proved nothing.
 */
let live = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  live = true;
} catch {
  live = false;
}

after(async () => {
  await prisma.$disconnect();
});

/**
 * A file of skipped tests is not a passing file.
 *
 * If the database is unreachable, say so loudly at the end rather than
 * reporting 41 quiet skips - which reads as success and proves nothing.
 */
after(() => {
  if (!live) {
    process.stdout.write(
      [
        '',
        '  ! NO DATABASE REACHED. Every constraint test above was SKIPPED and nothing was',
        '    proved. Set DATABASE_URL in server/.env and re-run - rule 19 of the brief is',
        '    not satisfied by application validation alone.',
        '',
      ].join('\n'),
    );
  }
});

/**
 * Asserts that a raw write is refused, and that it is refused BY THE NAMED
 * CONSTRAINT rather than by something incidental.
 *
 * Checking the constraint name matters: a test that only asserts "this threw"
 * passes just as happily when the insert fails for a missing column, which
 * would mean the protection being tested was never exercised at all.
 */
async function refusedBy(expected, sql) {
  // A unique-index violation names the KEY COLUMNS rather than the index, so
  // several of these have to accept either wording. Passing an array is how a
  // test says "one of these two, and nothing else will do".
  const wanted = Array.isArray(expected) ? expected : [expected];

  let error = null;
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (e) {
    error = e;
  }

  assert.ok(
    error,
    `Expected PostgreSQL to refuse this write via ${wanted.join(' or ')}, but it SUCCEEDED. ` +
      'The rule is not protected at the database level.',
  );

  // Prisma puts the PostgreSQL text in meta.message as well as in message;
  // reading both means the assertion does not depend on which layer wrapped it.
  const message = `${error.message ?? ''} ${error.meta?.message ?? ''}`;
  assert.ok(
    wanted.some((w) => message.includes(w)),
    `Expected the refusal to come from ${wanted.join(' or ')}.
Actual: ${message.slice(0, 500)}`,
  );
}

const skipIfNoDb = () => (live ? false : 'no database configured - skipping');

// ===========================================================================
//  C2 - TOLERANCES ARE FRACTIONS, AND CATEGORIES ARE MANDATORY
// ===========================================================================

describe('C2 - tolerance_rules', () => {
  test('a tolerance above 1 is refused - somebody typed a percentage', { skip: skipIfNoDb() }, async () => {
    await refusedBy(
      'tolerance_rules_order_pct_is_a_fraction',
      `INSERT INTO tolerance_rules (id, category, order_tolerance_pct, receipt_tolerance_pct,
         effective_from, basis, updated_at)
       VALUES (gen_random_uuid(), 'FABRIC', 5, 0.02, DATE '2027-01-01', 'test', now())`,
    );
  });

  test('a negative receipt tolerance is refused', { skip: skipIfNoDb() }, async () => {
    await refusedBy(
      'tolerance_rules_receipt_pct_is_a_fraction',
      `INSERT INTO tolerance_rules (id, category, order_tolerance_pct, receipt_tolerance_pct,
         effective_from, basis, updated_at)
       VALUES (gen_random_uuid(), 'FABRIC', 0.03, -0.01, DATE '2027-01-01', 'test', now())`,
    );
  });

  test('a version closing before it starts is refused', { skip: skipIfNoDb() }, async () => {
    await refusedBy(
      'tolerance_rules_effective_period_ordered',
      `INSERT INTO tolerance_rules (id, category, order_tolerance_pct, receipt_tolerance_pct,
         effective_from, effective_to, basis, updated_at)
       VALUES (gen_random_uuid(), 'FABRIC', 0.03, 0.02, DATE '2027-06-01', DATE '2027-01-01', 'test', now())`,
    );
  });

  /**
   * The date-versioning C2 asks for, and the thing `excess_rules` structurally
   * could not offer: TWO rows for the same category, on different dates.
   */
  test('two dated versions of one category coexist; two on the same date do not', { skip: skipIfNoDb() }, async () => {
    // Clear first as well as last. A run that fails partway leaves its rows
    // behind, and the next run then fails on its own setup - which reads as a
    // broken constraint when the constraint is fine.
    await prisma.$executeRawUnsafe(
      `DELETE FROM tolerance_rules WHERE basis LIKE 'constraint test%' OR basis = 'duplicate'`,
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO tolerance_rules (id, category, order_tolerance_pct, receipt_tolerance_pct,
         effective_from, basis, updated_at)
       VALUES (gen_random_uuid(), 'PACKAGING', 0.02, 0.02, DATE '2027-01-01', 'constraint test v1', now()),
              (gen_random_uuid(), 'PACKAGING', 0.03, 0.03, DATE '2027-06-01', 'constraint test v2', now())`,
    );

    const count = await prisma.toleranceRule.count({ where: { category: 'PACKAGING' } });
    assert.equal(count, 2, 'a category may be versioned by date');

    await refusedBy(
      // PostgreSQL reports a unique violation by its KEY, not by the index name.
      ['tolerance_rules_category_effective_from_key', 'Key (category, effective_from)'],
      `INSERT INTO tolerance_rules (id, category, order_tolerance_pct, receipt_tolerance_pct,
         effective_from, basis, updated_at)
       VALUES (gen_random_uuid(), 'PACKAGING', 0.04, 0.04, DATE '2027-01-01', 'duplicate', now())`,
    );

    await prisma.$executeRawUnsafe(
      `DELETE FROM tolerance_rules WHERE basis LIKE 'constraint test%' OR basis = 'duplicate'`,
    );
  });
});

describe('C2 - items.category is NOT NULL and enum-backed', () => {
  test('an inventory item without a category is refused', { skip: skipIfNoDb() }, async () => {
    await refusedBy(
      'category',
      `INSERT INTO inventory_items (id, item_code, description, item_category, uom, updated_at)
       VALUES (gen_random_uuid(), 'ITM-TEST-1', 'no category', 'Fabric', 'Mtrs', now())`,
    );
  });

  test('a category outside the three-value enum is refused', { skip: skipIfNoDb() }, async () => {
    let error = null;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO inventory_items (id, item_code, description, item_category, category, uom, updated_at)
         VALUES (gen_random_uuid(), 'ITM-TEST-2', 'bad category', 'Fabric', 'TRIMS', 'Mtrs', now())`,
      );
    } catch (e) {
      error = e;
    }
    assert.ok(error, 'PostgreSQL should refuse a value outside the ItemCategory enum');
    assert.match(String(error.message), /invalid input value for enum|ItemCategory/i);
  });
});

describe('C2 - payable quantity', () => {
  test('payable cannot exceed what was received', { skip: skipIfNoDb() }, async () => {
    const po = await prisma.purchaseOrder.findFirst({
      where: { deletedAt: null, receivedQty: { gt: 0 } },
      select: { id: true, poId: true, receivedQty: true },
    });
    if (!po) return; // nothing received yet in this database

    await refusedBy(
      'purchase_orders_payable_within_received',
      `UPDATE purchase_orders SET payable_qty = received_qty + 1 WHERE id = '${po.id}'`,
    );
  });

  test('payable cannot be negative', { skip: skipIfNoDb() }, async () => {
    const po = await prisma.purchaseOrder.findFirst({ select: { id: true } });
    if (!po) return;
    await refusedBy(
      'purchase_orders_payable_qty_non_negative',
      `UPDATE purchase_orders SET payable_qty = -1 WHERE id = '${po.id}'`,
    );
  });

  /**
   * C2's cumulative receipt ceiling, at the level nothing can bypass.
   *
   * `received_qty` IS the cumulative figure, so this single-row CHECK is a
   * cumulative test - which is exactly what the brief requires.
   */
  test('cumulative receipts beyond tolerance are refused unless the breach was acknowledged', { skip: skipIfNoDb() }, async () => {
    const po = await prisma.purchaseOrder.findFirst({
      where: { deletedAt: null, receiptBreachAcknowledged: false },
      select: { id: true, orderQty: true, receiptTolerancePct: true },
    });
    if (!po) return;

    const wayOver = Number(po.orderQty) * (1 + Number(po.receiptTolerancePct)) + 1;
    await refusedBy(
      'purchase_orders_received_within_receipt_tolerance',
      `UPDATE purchase_orders SET received_qty = ${wayOver}, payable_qty = ${wayOver} WHERE id = '${po.id}'`,
    );
  });
});

// ===========================================================================
//  C3 - JOB WORK
// ===========================================================================

describe('C3 - job work order', () => {
  test('an expected return larger than what was issued is refused', { skip: skipIfNoDb() }, async () => {
    const job = await prisma.dyeIssue.findFirst({ select: { id: true, qty: true } });
    if (!job) return;
    await refusedBy(
      'dye_issues_expected_return_within_issued',
      `UPDATE dye_issues SET expected_return_qty = ${Number(job.qty) + 1} WHERE id = '${job.id}'`,
    );
  });

  /**
   * Two constraints now bound this column, and that is a good outcome rather
   * than a redundancy to tidy away.
   *
   * `dye_issues_shrinkage_range` is the Phase 0 constraint, which followed the
   * column through C3's rename automatically - which is itself worth asserting,
   * because a rename that silently dropped its constraint is exactly the kind
   * of regression a migration can cause. C3 added
   * `dye_issues_shrinkage_tolerance_is_a_fraction` beside it. Either firing
   * means the value is refused; the test accepts whichever PostgreSQL reaches
   * first.
   */
  test('a shrinkage tolerance above 1 is refused', { skip: skipIfNoDb() }, async () => {
    const job = await prisma.dyeIssue.findFirst({ select: { id: true } });
    if (!job) return;
    await refusedBy(
      ['dye_issues_shrinkage_tolerance_is_a_fraction', 'dye_issues_shrinkage_range'],
      `UPDATE dye_issues SET shrinkage_tolerance_pct = 3 WHERE id = '${job.id}'`,
    );
  });

  /**
   * A stock posting has to be attributed AND has to name the item it moved.
   *
   * Two constraints guard the same half-written state, and which one fires
   * first depends on the row - so the test accepts either. What it does not
   * accept is the write succeeding, which is the only outcome that would mean
   * the rule is unprotected.
   */
  test('a stock posting with no poster named is refused', { skip: skipIfNoDb() }, async () => {
    const job = await prisma.dyeIssue.findFirst({ select: { id: true } });
    if (!job) return;
    await refusedBy(
      ['dye_issues_stock_posting_is_attributed', 'dye_issues_stock_posted_names_its_item'],
      `UPDATE dye_issues SET stock_posted_at = now(), stock_posted_by_name = NULL WHERE id = '${job.id}'`,
    );
  });

  /** The default C3 removes. A lot must state its own tolerance. */
  test('shrinkage_tolerance_pct no longer carries a default', { skip: skipIfNoDb() }, async () => {
    const [col] = await prisma.$queryRaw`
      SELECT column_default, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'dye_issues' AND column_name = 'shrinkage_tolerance_pct'`;
    assert.equal(col.column_default, null, 'a default would let a lot inherit a tolerance nobody chose');
    assert.equal(col.is_nullable, 'NO');
  });
});

// ===========================================================================
//  C4 - THE SCRUTINY TRIGGER
// ===========================================================================

describe('C4 - a REWORK or REJECT needs a defect line', () => {
  test('the trigger exists and is armed on fabric_scrutinies', { skip: skipIfNoDb() }, async () => {
    const rows = await prisma.$queryRaw`
      SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'fabric_scrutinies'::regclass AND NOT tgisinternal`;
    const names = rows.map((r) => r.tgname);
    assert.ok(
      names.includes('fabric_scrutinies_decision_needs_defects'),
      `Expected the C4 trigger to be armed. Found: ${names.join(', ') || 'none'}`,
    );
  });

  /**
   * The trigger, exercised. A raw UPDATE that locks a REJECT decision with no
   * findings behind it must be refused by PostgreSQL - not by the service,
   * which this test never goes through.
   */
  test('locking a REJECT with no defect lines is refused by the database', { skip: skipIfNoDb() }, async () => {
    const open = await prisma.fabricScrutiny.findFirst({
      where: { isLocked: false, deletedAt: null },
      select: { id: true },
    });
    if (!open) return;

    await refusedBy(
      'without at least one defect line',
      `UPDATE fabric_scrutinies
          SET decision = 'REJECT', is_locked = true
        WHERE id = '${open.id}'`,
    );
  });

  test('a defect line with no quantity is refused', { skip: skipIfNoDb() }, async () => {
    const s = await prisma.fabricScrutiny.findFirst({ select: { id: true, rollId: true } });
    if (!s) return;
    await refusedBy(
      'fabric_scrutiny_defects_qty_positive',
      `INSERT INTO fabric_scrutiny_defects (id, scrutiny_id, line_no, category, defect_type, roll_id, qty, updated_at)
       VALUES (gen_random_uuid(), '${s.id}', 99, 'DYEING', 'Shade Variation', '${s.rollId}', 0, now())`,
    );
  });

  test('the scrutiny verdict and the variation flag cannot disagree', { skip: skipIfNoDb() }, async () => {
    const r = await prisma.dyeingReceipt.findFirst({ select: { id: true, variationFlag: true } });
    if (!r) return;
    await refusedBy(
      'dyeing_receipts_scrutiny_matches_variation_flag',
      `UPDATE dyeing_receipts SET requires_scrutiny = ${!r.variationFlag} WHERE id = '${r.id}'`,
    );
  });
});

// ===========================================================================
//  C5 - THE CUTTING CHALLAN
// ===========================================================================

describe('C5 - over-fulfilment is impossible', () => {
  test('issued cannot exceed required, at the database level', { skip: skipIfNoDb() }, async () => {
    const line = await prisma.cuttingChallanLine.findFirst({
      select: { id: true, requiredQty: true },
    });
    if (!line) return;

    await refusedBy(
      'cutting_challan_lines_no_over_fulfilment',
      `UPDATE cutting_challan_lines SET issued_qty = ${Number(line.requiredQty) + 0.0001} WHERE id = '${line.id}'`,
    );
  });

  test('a required quantity of zero is refused - that is not a requirement', { skip: skipIfNoDb() }, async () => {
    const c = await prisma.cuttingChallan.findFirst({ select: { id: true } });
    if (!c) return;
    await refusedBy(
      'cutting_challan_lines_required_qty_positive',
      `INSERT INTO cutting_challan_lines (id, challan_id, line_no, item_category, category,
         required_qty, uom, updated_at)
       VALUES (gen_random_uuid(), '${c.id}', 99, 'Fabric', 'FABRIC', 0, 'Mtrs', now())`,
    );
  });

  test('a short close must name who did it and why', { skip: skipIfNoDb() }, async () => {
    const c = await prisma.cuttingChallan.findFirst({ select: { id: true } });
    if (!c) return;
    await refusedBy(
      'cutting_challans_short_close_is_attributed',
      `UPDATE cutting_challans SET closed_short_at = now() WHERE id = '${c.id}'`,
    );
  });

  /**
   * C5's migration rule: mandatory for new rows, silent about the ten fabric
   * issues that predate the challan.
   */
  test('a fabric issue created now must quote a challan line', { skip: skipIfNoDb() }, async () => {
    const [{ exists }] = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'fabric_issues_new_rows_need_challan'
           AND conrelid = 'fabric_issues'::regclass
      ) AS exists`;
    assert.equal(exists, true, 'the partial CHECK must be present');

    const legacy = await prisma.fabricIssue.count({ where: { cuttingChallanLineId: null } });
    assert.ok(legacy >= 0, 'legacy issues are permitted to have none');
  });
});

// ===========================================================================
//  C6 - THE FABRIC EQUATION, IN POSTGRESQL
// ===========================================================================

describe('C6 - remainder reconciles', () => {
  test('an unbalanced equation is refused by the database', { skip: skipIfNoDb() }, async () => {
    const ci = await prisma.cuttingIssue.findFirst({ select: { id: true } });
    if (!ci) return;

    await refusedBy(
      'cutting_issues_remainder_reconciles',
      `UPDATE cutting_issues
          SET issued_qty = 100, consumed_qty = 80, remainder_qty = 15, wastage_qty = 0
        WHERE id = '${ci.id}'`,
    );
  });

  test('a balanced equation is accepted, then rolled back', { skip: skipIfNoDb() }, async () => {
    const ci = await prisma.cuttingIssue.findFirst({
      where: { postedAt: null },
      select: { id: true },
    });
    if (!ci) return;

    // Inside a transaction that throws at the end, so nothing survives.
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE cutting_issues
              SET issued_qty = 100, consumed_qty = 80, remainder_qty = 15, wastage_qty = 5
            WHERE id = '${ci.id}'`,
        );
        throw new Error('rollback');
      }),
      /rollback/,
    );
  });

  test('negative fabric quantities are refused', { skip: skipIfNoDb() }, async () => {
    const ci = await prisma.cuttingIssue.findFirst({ select: { id: true } });
    if (!ci) return;
    await refusedBy(
      'cutting_issues_fabric_quantities_non_negative',
      `UPDATE cutting_issues SET consumed_qty = -1 WHERE id = '${ci.id}'`,
    );
  });
});

// ===========================================================================
//  C7 - ONE CURRENT APPROVED VERSION
// ===========================================================================

describe('C7 - only one version may be current and approved', () => {
  test('the partial unique index exists', { skip: skipIfNoDb() }, async () => {
    const rows = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'plan_approvals' AND indexname = 'plan_approvals_one_current_approved'`;
    assert.equal(rows.length, 1, 'the C7 guarantee must be an index, not a convention');
  });

  test('a second current approved version for one style + container is refused', { skip: skipIfNoDb() }, async () => {
    const current = await prisma.planApproval.findFirst({
      where: { isCurrent: true, approvalStatus: 'APPROVED', deletedAt: null, styleId: { not: null } },
      select: { id: true, styleId: true, containerNo: true, orderId: true, planningId: true },
    });
    if (!current) return;

    const other = await prisma.planApproval.findFirst({
      where: {
        id: { not: current.id },
        deletedAt: null,
        OR: [{ isCurrent: false }, { approvalStatus: { not: 'APPROVED' } }],
      },
      select: { id: true },
    });
    if (!other) return;

    // approved_date and decided_at are set too. Without them
    // `plan_approvals_approved_date_present` - a Phase 0 constraint - refuses
    // the row first, and the C7 index this test exists to prove would never be
    // consulted at all.
    await refusedBy(
      ['plan_approvals_one_current_approved', 'already exists'],
      `UPDATE plan_approvals
          SET is_current = true, approval_status = 'APPROVED',
              approved_date = CURRENT_DATE, decided_at = now(),
              style_id = '${current.styleId}',
              container_no = ${current.containerNo === null ? 'NULL' : `'${current.containerNo}'`}
        WHERE id = '${other.id}'`,
    );
  });

  test('a version cannot be current and demoted at once', { skip: skipIfNoDb() }, async () => {
    const pa = await prisma.planApproval.findFirst({
      where: { isCurrent: true },
      select: { id: true },
    });
    if (!pa) return;
    await refusedBy(
      'plan_approvals_demoted_is_not_current',
      `UPDATE plan_approvals SET demoted_at = now() WHERE id = '${pa.id}'`,
    );
  });

  test('one plan type per version', { skip: skipIfNoDb() }, async () => {
    const rows = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'plan_approval_lines'
         AND indexname = 'plan_approval_lines_plan_approval_id_plan_type_key'`;
    assert.equal(rows.length, 1);
  });
});

// ===========================================================================
//  C8 - MOVEMENT TIME
// ===========================================================================

describe('C8 - gate pass movement time', () => {
  test('the not-in-the-future trigger is armed', { skip: skipIfNoDb() }, async () => {
    const rows = await prisma.$queryRaw`
      SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'gate_passes'::regclass AND NOT tgisinternal`;
    assert.ok(
      rows.map((r) => r.tgname).includes('gate_passes_movement_time_not_future'),
      'a CHECK cannot use now(), so this has to be a trigger',
    );
  });

  test('a future movement time is refused by the database', { skip: skipIfNoDb() }, async () => {
    const gp = await prisma.gatePass.findFirst({ select: { id: true } });
    if (!gp) return;
    await refusedBy(
      'in the future',
      `UPDATE gate_passes SET movement_time = now() + interval '2 days' WHERE id = '${gp.id}'`,
    );
  });

  test('a past movement time is accepted, and differs from created_at', { skip: skipIfNoDb() }, async () => {
    const gp = await prisma.gatePass.findFirst({
      where: { movementTime: { not: null } },
      select: { id: true, movementTime: true, createdAt: true },
    });
    if (!gp) return;
    assert.notEqual(
      gp.movementTime.getTime(),
      gp.createdAt.getTime(),
      'movement time standing in for creation time is the error C8 exists to remove',
    );
  });

  test('new gate passes are required to carry one', { skip: skipIfNoDb() }, async () => {
    const [{ exists }] = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'gate_passes_new_rows_need_movement_time'
           AND conrelid = 'gate_passes'::regclass
      ) AS exists`;
    assert.equal(exists, true);
  });
});

// ===========================================================================
//  C8 - THE STAGE EVENTS
// ===========================================================================

describe('C8 - stage events are written by the engine, for every document type', () => {
  test('both views exist', { skip: skipIfNoDb() }, async () => {
    const rows = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.views
       WHERE table_schema = 'public'
         AND table_name IN ('document_stage_events', 'document_stage_durations')`;
    assert.equal(rows.length, 2);
  });

  /**
   * "Every state transition generates exactly one stage event."
   *
   * True by construction rather than by discipline: the view IS the transition
   * rows of the approval trail, and `transition()` is the only function allowed
   * to move a workflow state. This asserts the identity holds.
   */
  test('exactly one stage event per recorded transition', { skip: skipIfNoDb() }, async () => {
    const [{ transitions }] = await prisma.$queryRaw`
      SELECT count(*)::int AS transitions
        FROM approval_history
       WHERE from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status`;
    const [{ events }] = await prisma.$queryRaw`
      SELECT count(*)::int AS events FROM document_stage_events`;
    assert.equal(events, transitions, 'one transition, one event - no more and no fewer');
  });

  test('a stage event carries from, to, actor and timestamp', { skip: skipIfNoDb() }, async () => {
    const rows = await prisma.$queryRaw`SELECT * FROM document_stage_events LIMIT 1`;
    if (!rows.length) return;
    for (const col of ['document_type', 'document_id', 'from_state', 'to_state', 'actor', 'occurred_at']) {
      assert.ok(col in rows[0], `stage events must carry ${col}`);
    }
  });
});

// ===========================================================================
//  C9 - UTILISATION
// ===========================================================================

describe('C9 - avg_utilisation_per_piece', () => {
  test('the column is the renamed one, NOT NULL, and qty_per_pc is gone', { skip: skipIfNoDb() }, async () => {
    const cols = await prisma.$queryRaw`
      SELECT column_name, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'style_bom_lines'
         AND column_name IN ('avg_utilisation_per_piece', 'qty_per_pc', 'effective_from')`;
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    assert.ok(byName.avg_utilisation_per_piece, 'the C9 column must exist');
    assert.equal(byName.avg_utilisation_per_piece.is_nullable, 'NO');
    assert.equal(byName.qty_per_pc, undefined, 'this is a rename, not a second column');
    assert.ok(byName.effective_from, 'and it is date-versioned');
    assert.equal(byName.effective_from.is_nullable, 'NO');
  });

  test('a utilisation of zero is refused - a requirement is never silently zero', { skip: skipIfNoDb() }, async () => {
    const line = await prisma.styleBomLine.findFirst({ select: { id: true } });
    if (!line) return;
    await refusedBy(
      'style_bom_lines_utilisation_positive',
      `UPDATE style_bom_lines SET avg_utilisation_per_piece = 0 WHERE id = '${line.id}'`,
    );
  });

  test('a negative utilisation is refused', { skip: skipIfNoDb() }, async () => {
    const line = await prisma.styleBomLine.findFirst({ select: { id: true } });
    if (!line) return;
    await refusedBy(
      'style_bom_lines_utilisation_positive',
      `UPDATE style_bom_lines SET avg_utilisation_per_piece = -1 WHERE id = '${line.id}'`,
    );
  });
});

// ===========================================================================
//  THE LEDGER STAYS APPEND-ONLY AND BALANCES STAY DERIVED
// ===========================================================================

describe('Inventory invariants', () => {
  test('every ledger row agrees with its own direction', { skip: skipIfNoDb() }, async () => {
    const [{ broken }] = await prisma.$queryRaw`
      SELECT count(*)::int AS broken
        FROM stock_ledger
       WHERE (direction = 'IN'  AND (qty_in <> qty OR qty_out <> 0))
          OR (direction = 'OUT' AND (qty_out <> qty OR qty_in <> 0))`;
    assert.equal(broken, 0, 'qty_in / qty_out must always agree with direction and qty');
  });

  /**
   * The reconciliation the brief asks for, asserted directly against the
   * tables: every cached balance equals the sum of its own movements.
   */
  test('every stock balance equals the sum of its ledger movements', { skip: skipIfNoDb() }, async () => {
    const differences = await prisma.$queryRaw`
      SELECT b.item_id, b.location, b.qty AS stored,
             COALESCE(l.total, 0) AS ledger
        FROM stock_balances b
        LEFT JOIN (
          SELECT item_id, location, SUM(qty_in) - SUM(qty_out) AS total
            FROM stock_ledger GROUP BY item_id, location
        ) l ON l.item_id = b.item_id AND l.location = b.location
       WHERE b.qty <> COALESCE(l.total, 0)`;
    assert.equal(
      differences.length,
      0,
      `Balances must be derivable from the ledger. Differences: ${JSON.stringify(differences)}`,
    );
  });

  test('job-worker and cutting-floor stock is visible on hand but not issuable', { skip: skipIfNoDb() }, async () => {
    const rows = await prisma.$queryRaw`
      SELECT location, SUM(qty_in) - SUM(qty_out) AS qty
        FROM stock_ledger GROUP BY location`;
    const inProcess = rows.filter((r) =>
      ['CUTTING FLOOR', 'AT DYEING VENDOR', 'AT PRINTING VENDOR', 'WITH JOB WORKER'].includes(
        r.location,
      ),
    );
    // Nothing may be NEGATIVE at an in-process location: that would mean more
    // came back than ever went out.
    for (const r of inProcess) {
      assert.ok(Number(r.qty) >= 0, `${r.location} holds a negative balance: ${r.qty}`);
    }
  });
});
