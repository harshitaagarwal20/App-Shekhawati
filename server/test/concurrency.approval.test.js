/**
 * F-01 / F-02 - CONCURRENCY AND STATE DRIFT ON THE APPROVAL PATH. NEEDS POSTGRESQL.
 *
 * ===========================================================================
 *  WHY THIS FILE EXISTS
 * ===========================================================================
 *
 * Two defects found by driving the running application, both invisible to a
 * sequential suite:
 *
 *   F-01  `transition()` read a document's workflow state and then wrote the
 *         new one, with nothing holding the row in between. Under READ
 *         COMMITTED two approvers pressing Approve at the same moment both
 *         read PENDING_APPROVAL, both passed the transition table, and both
 *         committed. One pending purchase order came back APPROVED with TWO
 *         approvals on its trail; a quotation came back with two trail rows
 *         both claiming sequence number 1, because `record()` numbers entries
 *         from an unlocked count().
 *
 *   F-02  `vendorQuotation` approved by writing `authorisationStatus` and
 *         nothing else. `workflowState` never moved, so a quotation approved
 *         days ago was still being offered to approvers by the queue - which
 *         reads the workflow column - while the pending-quotations report,
 *         which reads the other column, correctly showed none.
 *
 * ---------------------------------------------------------------------------
 *  READ THIS BEFORE "FIXING" A FAILURE HERE BY RETRYING
 *
 *  Nothing here asserts timing. The race test asserts the FINAL STATE - one
 *  approval on the trail - not which caller won, so a pass means the invariant
 *  held and a failure means one document was approved twice by two people.
 *
 *  The barrier test is the strict one: it holds both transactions at a
 *  rendezvous until each has READ the pending row, so both are guaranteed to
 *  be working from the same pre-decision snapshot. That is the interleaving
 *  the conditional update in `transition()` exists for, and the only one that
 *  reliably exercises it - fire five HTTP requests instead and the losers
 *  usually read the winner's committed row and get "already approved", which
 *  is a correct refusal down a different path.
 * ---------------------------------------------------------------------------
 *
 *     node --test test/concurrency.approval.test.js
 */

import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../src/config/prisma.js';
import * as engine from '../src/services/approvalEngine.js';
import * as quotations from '../src/services/vendorQuotation.service.js';

/**
 * Whether a database is actually reachable. Probed with a TOP-LEVEL await -
 * node:test evaluates `skip` when the `describe` body runs, before any hook.
 */
let live = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  live = true;
} catch {
  live = false;
}
const skipIfNoDb = () => (live ? false : 'no database reachable');

// Warm the pool, for the reason spelled out in concurrency.stock.test.js: two
// transactions that spend their overlap window authenticating are not racing.
// Two connections, because two is the widest this file ever holds at once.
if (live) {
  await Promise.all([1, 2].map(() => prisma.$queryRaw`SELECT 1`));
}

const TAG = `APPRV-${Date.now()}`;
const made = { quotations: [], headers: [] };
let vendorId = null;

if (live) {
  const vendor = await prisma.vendor.findFirst({ where: { deletedAt: null }, select: { id: true } });
  vendorId = vendor?.id ?? null;
}

after(async () => {
  if (live && made.quotations.length) {
    await prisma.approvalHistory.deleteMany({
      where: { documentType: 'VENDOR_QUOTATION', documentId: { in: made.quotations } },
    });
    await prisma.vendorQuotation.deleteMany({ where: { id: { in: made.quotations } } });
    await prisma.vendorQuotationHeader.deleteMany({ where: { id: { in: made.headers } } });
  }
  await prisma.$disconnect();
});

/**
 * A quotation sitting at PENDING_APPROVAL, raised by nobody in particular so
 * that maker-checker does not refuse the approval before the race is reached.
 */
/** Multi-line: every quotation line belongs to a quote document. */
async function quoteHeader(quotationNo) {
  const h = await prisma.vendorQuotationHeader.create({
    data: { quotationNo, quotationDate: new Date(), vendorId },
  });
  made.headers.push(h.id);
  return h.id;
}

async function pendingQuotation(suffix) {
  const q = await prisma.vendorQuotation.create({
    data: {
      headerId: await quoteHeader(`${TAG}-${suffix}`),
      quotationNo: `${TAG}-${suffix}`,
      quotationDate: new Date(),
      item: 'Fabric',
      vendorId,
      rateQuoted: '100',
      uom: 'Mtrs',
      qty: '10',
      amount: '1000',
      authorisationStatus: 'PENDING',
      workflowState: 'PENDING_APPROVAL',
      createdById: null,
    },
    select: { id: true, quotationNo: true },
  });
  made.quotations.push(q.id);
  return q;
}

const actor = (name) => ({ userId: null, fullName: name });

async function approvedTrailRows(documentId) {
  return prisma.approvalHistory.count({
    where: { documentType: 'VENDOR_QUOTATION', documentId, action: 'APPROVED' },
  });
}

// ===========================================================================
//  F-01 - ONE DOCUMENT, ONE APPROVAL
// ===========================================================================

describe('F-01 - concurrent approvals of one document', () => {
  test(
    'two approvers that both read the pending row: only one approval commits',
    { skip: skipIfNoDb() },
    async () => {
      const q = await pendingQuotation('BARRIER');

      /*
       * The rendezvous. Each transaction reads the row, announces that it has
       * read it, and waits for the other to do the same. Only then does either
       * attempt the write - so both are provably deciding from the same
       * pre-approval snapshot, which is the situation that produced two
       * approvals before `transition()` made its write conditional.
       */
      let announceA;
      let announceB;
      const aHasRead = new Promise((resolve) => { announceA = resolve; });
      const bHasRead = new Promise((resolve) => { announceB = resolve; });

      const approveOnce = (label, announce, otherHasRead) =>
        prisma.$transaction(
          async (tx) => {
            const seen = await tx.vendorQuotation.findUnique({
              where: { id: q.id },
              select: { workflowState: true },
            });
            assert.equal(seen.workflowState, 'PENDING_APPROVAL', `${label} should see a pending row`);
            announce();
            await otherHasRead;

            return engine.approve(tx, {
              documentType: 'VENDOR_QUOTATION',
              documentId: q.id,
              actor: actor(`approver ${label}`),
              remarks: `barrier ${label}`,
              data: { approvedByName: `approver ${label}`, approvedAt: new Date() },
            });
          },
          { timeout: 20_000 },
        );

      const results = await Promise.allSettled([
        approveOnce('A', announceA, bHasRead),
        approveOnce('B', announceB, aHasRead),
      ]);

      const committed = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter((r) => r.status === 'rejected');

      assert.equal(
        committed.length,
        1,
        `Exactly one of two simultaneous approvals may commit; ${committed.length} did. ` +
          'Both transactions read PENDING_APPROVAL and both wrote, so one document ' +
          'was approved twice by two different people.',
      );
      assert.equal(refused.length, 1, 'the approval that lost the race must be refused');
      assert.equal(
        refused[0].reason?.code,
        'CONCURRENT_DECISION',
        'the loser must be told its decision was not recorded, not handed a generic error',
      );

      assert.equal(
        await approvedTrailRows(q.id),
        1,
        'the approval trail must carry exactly one APPROVED entry for one act of approval',
      );

      const rows = await prisma.approvalHistory.findMany({
        where: { documentType: 'VENDOR_QUOTATION', documentId: q.id },
        select: { sequenceNo: true },
      });
      const sequences = rows.map((r) => r.sequenceNo);
      assert.equal(
        sequences.length,
        new Set(sequences).size,
        `two trail entries claimed the same sequence number (${sequences.join(', ')}) - ` +
          'record() numbers from an unlocked count()',
      );
    },
  );

  /*
   * Three, not five - the count is chosen for the same reason
   * concurrency.stock.test.js chooses it. Prisma's pool is num_cpus * 2 + 1 and
   * these files run alongside each other, so a bigger fan-out does not race
   * harder, it queues: the extra callers wait on a connection, arrive after the
   * winner has committed, and take the ordinary "already approved" path without
   * ever contending. Three overlap genuinely, and starve nothing else.
   */
  test(
    'three simultaneous approvals leave one approval and one trail entry',
    { skip: skipIfNoDb() },
    async () => {
      const q = await pendingQuotation('THREE');

      const results = await Promise.allSettled(
        [1, 2, 3].map((n) =>
          quotations.approve(q.id, { remarks: `racer ${n}` }, actor(`approver ${n}`)),
        ),
      );

      const committed = results.filter((r) => r.status === 'fulfilled').length;
      assert.equal(committed, 1, `exactly one of three approvals may succeed; ${committed} did`);
      assert.equal(await approvedTrailRows(q.id), 1, 'one approval, one trail entry');

      // Whichever refusal path fired, none of them may be a 500.
      for (const r of results.filter((x) => x.status === 'rejected')) {
        assert.ok(
          r.reason?.status >= 400 && r.reason?.status < 500,
          `a losing approver must get a 4xx, got ${r.reason?.status}: ${r.reason?.message}`,
        );
      }
    },
  );
});

// ===========================================================================
//  F-02 - THE DECISION REACHES BOTH COLUMNS
// ===========================================================================

describe('F-02 - a quotation decision moves the workflow state too', () => {
  test('approving sets authorisationStatus AND workflowState', { skip: skipIfNoDb() }, async () => {
    const q = await pendingQuotation('APPROVE');
    await quotations.approve(q.id, { remarks: 'audit' }, actor('a checker'));

    const after_ = await prisma.vendorQuotation.findUnique({
      where: { id: q.id },
      select: { workflowState: true, authorisationStatus: true, approvedAt: true, amount: true },
    });

    assert.equal(after_.authorisationStatus, 'APPROVED');
    assert.equal(
      after_.workflowState,
      'APPROVED',
      'workflowState stayed behind - the approval queue reads this column and would go on ' +
        'offering a quotation that has already been decided',
    );
    assert.ok(after_.approvedAt, 'the approval stamp must still be written');
    assert.equal(String(after_.amount), '1000', 'the amount is restamped as qty x rate');
  });

  test('rejecting moves both columns', { skip: skipIfNoDb() }, async () => {
    const q = await pendingQuotation('REJECT');
    await quotations.reject(q.id, { reason: 'rate too high this season' }, actor('a checker'));

    const after_ = await prisma.vendorQuotation.findUnique({
      where: { id: q.id },
      select: { workflowState: true, authorisationStatus: true, rejectionReason: true },
    });
    assert.equal(after_.authorisationStatus, 'REJECTED');
    assert.equal(after_.workflowState, 'REJECTED');
    assert.equal(after_.rejectionReason, 'rate too high this season');
  });

  test('reopening winds both columns back', { skip: skipIfNoDb() }, async () => {
    const q = await pendingQuotation('REOPEN');
    await quotations.approve(q.id, { remarks: 'audit' }, actor('a checker'));
    await quotations.reopen(q.id, { reason: 'the vendor revised the rate' }, actor('a checker'));

    const after_ = await prisma.vendorQuotation.findUnique({
      where: { id: q.id },
      select: { workflowState: true, authorisationStatus: true, approvedAt: true },
    });
    assert.equal(after_.authorisationStatus, 'PENDING');
    assert.equal(
      after_.workflowState,
      'PENDING_APPROVAL',
      'a reopened quotation has to return to the approval queue, not merely look undecided ' +
        'on the report',
    );
    assert.equal(after_.approvedAt, null, 'the old approval stamp must be cleared');
  });

  /*
   * Scoped to this file's OWN rows, not the whole table.
   *
   * The first draft asserted that NO quotation anywhere was decided-but-queued.
   * That reads the same table quotations.test.js is concurrently writing to, so
   * it failed on that file's in-flight rows and took a large part of the suite
   * down with it. A test that asserts on rows it did not create cannot be run
   * in parallel with the tests that do create them.
   *
   * The whole-table sweep is still worth having - as an operational check, not
   * as a unit test. It lives in the audit tooling instead.
   */
  test('no quotation this file decided is left sitting in the approval queue', { skip: skipIfNoDb() }, async () => {
    const stranded = await prisma.vendorQuotation.findMany({
      where: {
        id: { in: made.quotations },
        workflowState: 'PENDING_APPROVAL',
        NOT: { authorisationStatus: 'PENDING' },
      },
      select: { quotationNo: true, authorisationStatus: true },
    });

    assert.deepEqual(
      stranded,
      [],
      'these quotations have been decided but still read PENDING_APPROVAL, so the approval ' +
        'queue is still offering them as work: ' +
        stranded.map((s) => `${s.quotationNo} (${s.authorisationStatus})`).join(', '),
    );
  });

  test('the maker still cannot approve their own quotation', { skip: skipIfNoDb() }, async () => {
    const user = await prisma.user.findFirst({ where: { username: 'admin' }, select: { id: true, fullName: true } });
    const q = await prisma.vendorQuotation.create({
      data: {
        headerId: await quoteHeader(`${TAG}-SELF`),
        quotationNo: `${TAG}-SELF`,
        quotationDate: new Date(),
        item: 'Fabric',
        vendorId,
        rateQuoted: '100',
        uom: 'Mtrs',
        qty: '10',
        amount: '1000',
        authorisationStatus: 'PENDING',
        workflowState: 'PENDING_APPROVAL',
        createdById: user.id,
      },
      select: { id: true },
    });
    made.quotations.push(q.id);

    await assert.rejects(
      () => quotations.approve(q.id, { remarks: 'self' }, { userId: user.id, fullName: user.fullName }),
      (err) => err.status === 403,
      'routing the decision through the engine must not lose the maker-checker rule',
    );
  });
});
