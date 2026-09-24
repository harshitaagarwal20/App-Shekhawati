/**
 * F-04 - GRN REVERSAL. The compensating document a posted receipt is
 * corrected by.
 *
 * ===========================================================================
 *  WHAT WAS MISSING
 * ===========================================================================
 *
 * A GRN posts to stock inside its own create transaction: `postedAt` is
 * stamped and `workflowState` set to POSTED the instant the receipt is saved,
 * and there is deliberately no separate post endpoint. That design is right -
 * see the note at the top of grn.service.js - and it left the receipt frozen.
 * `setStatus()` refused to cancel a posted receipt and `remove()` refused to
 * delete one, and both told the user:
 *
 *     "A posted receipt is corrected by a reversal, not by a status change."
 *
 * No reversal existed. A storeman who keyed 1,000 m instead of 100, or chose
 * the wrong purchase order, or mistyped the rate, had committed that to the
 * ledger before they could re-read the screen, and the only way back was SQL
 * against production. This file is the remedy those two messages named.
 *
 * ---------------------------------------------------------------------------
 *  THE SHAPE: A COUNTER-ENTRY, NOT AN ERASURE
 *
 *  Reversing does not edit the receipt, delete its ledger rows or move its
 *  workflow state. It posts an equal and opposite set of OUT movements through
 *  `postMovement()` - the same function every other issue in this application
 *  goes through, with the same lock and the same non-negative check - writes
 *  off the rolls the receipt created, decrements the purchase order's received
 *  and payable quantities, and stamps `grns.reversedAt`.
 *
 *  The receipt stands. `workflowState` is still POSTED and `status` is still
 *  COMPLETED, because both are still true: it WAS posted, and the goods DID
 *  arrive. A reader a year later sees the receipt, the reversal, the reason
 *  and who signed it, which is more than an erasure could ever tell them.
 *
 * ---------------------------------------------------------------------------
 *  IT IS APPROVED, AND APPROVING IT POSTS IT
 *
 *  `separateChecker: true` in the approval engine's registry. Reversing a
 *  receipt takes stock back out and reduces what a vendor is owed; it is
 *  raised precisely because somebody made a mistake, which makes the person
 *  raising it the last person who should also be the only one to see it.
 *
 *  `approve()` below posts in the same transaction. An approved-but-unposted
 *  reversal would be a state in which the ledger is still wrong and somebody
 *  has to remember to finish the job - the very failure this document exists
 *  to end, reintroduced one step later.
 *
 * ---------------------------------------------------------------------------
 *  WHAT IT REFUSES, AND WHY THE REFUSAL IS CHECKED TWICE
 *
 *  A receipt can only be reversed while the goods it brought in are still
 *  there. Once fabric has been issued to a dye house or a cutting floor,
 *  taking the receipt back out would either drive the balance negative or
 *  leave a roll that has been consumed claiming to hold cloth.
 *
 *  `assertReversible()` states those conditions once and is called twice: at
 *  create, so the storeman is told immediately rather than after an approval
 *  round trip; and again inside the posting transaction, because minutes or
 *  days pass between the two and the cloth can leave the store in between.
 *  The second call is the one that is load-bearing. The first is a courtesy.
 * ===========================================================================
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { nextNumber, peekNumber } from './documentNumber.service.js';
import * as engine from './approvalEngine.js';
import { availableQty, postMovement, recomputeBalance } from './inventory.service.js';

export const SORTABLE = ['reversalNo', 'reversalDate', 'reversedQty', 'workflowState', 'createdAt'];

const SEARCH = ['reversalNo', 'reason', 'remarks'];

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

const INCLUDE = {
  grn: {
    select: {
      id: true,
      grnNo: true,
      grnDate: true,
      billNo: true,
      item: true,
      uom: true,
      receivingQty: true,
      inventoryRate: true,
      amount: true,
      location: true,
      postedAt: true,
      reversedAt: true,
      purchaseOrder: { select: { id: true, poId: true, orderQty: true, receivedQty: true } },
      vendor: { select: { id: true, vendorName: true } },
    },
  },
  inventoryItem: { select: { id: true, itemCode: true, description: true, isRollTracked: true } },
};

const LIST_INCLUDE = {
  grn: {
    select: {
      id: true,
      grnNo: true,
      billNo: true,
      item: true,
      purchaseOrder: { select: { id: true, poId: true } },
      vendor: { select: { id: true, vendorName: true } },
    },
  },
};

function project(row) {
  if (!row) return row;
  return {
    ...row,
    posted: Boolean(row.postedAt),
    stateLabel: engine.STATE_LABEL[row.workflowState] ?? row.workflowState,
  };
}

// ===========================================================================
//  WHETHER A RECEIPT CAN STILL BE TAKEN BACK OUT
// ===========================================================================

/**
 * The rolls a receipt created, and what has become of them.
 *
 * Soft-deleted rolls are INCLUDED. A roll that has been deleted since the
 * receipt is not a roll that can be quietly reversed - somebody removed it,
 * and the reversal has to say so rather than silently posting a movement for
 * cloth that the roll register no longer describes.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} db
 */
async function rollsOf(db, grnId) {
  return db.fabricRoll.findMany({
    where: { grnId },
    select: {
      id: true,
      rollNo: true,
      receivedQty: true,
      balanceQty: true,
      stage: true,
      isHeld: true,
      location: true,
      deletedAt: true,
      inventoryItemId: true,
    },
    orderBy: { rollNo: 'asc' },
  });
}

/**
 * Everything that would stop this receipt being reversed, as sentences.
 *
 * Returns an array rather than throwing so that `eligibility()` can show the
 * storeman ALL of the reasons at once - "roll FAB-0007 has been issued and
 * roll FAB-0009 is held" is a useful answer; discovering them one refusal at
 * a time is not. `assertReversible()` below is the throwing wrapper.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} db
 * @param {object} grn      The receipt, with `rolls` already loaded or not
 * @param {object} [opts]
 * @param {string} [opts.ignoreReversalId]  A reversal already in flight that
 *        should not be treated as the "one live reversal" blocking itself.
 */
async function blockersFor(db, grn, { ignoreReversalId } = {}) {
  const blockers = [];

  if (!grn.postedAt) {
    // Nothing reached the ledger, so there is nothing to take back out. The
    // remedy for an unposted receipt is deletion, which remove() allows.
    blockers.push(
      `${grn.grnNo} never reached stock, so there is nothing to reverse. ` +
        'Delete it instead.',
    );
    return blockers;
  }

  if (grn.reversedAt) {
    blockers.push(
      `${grn.grnNo} was already reversed on ${grn.reversedAt.toISOString().slice(0, 10)}` +
        (grn.reversedByName ? ` by ${grn.reversedByName}` : '') +
        '. A receipt is reversed once.',
    );
    return blockers;
  }

  if (!grn.inventoryItemId) {
    // Refused by grns_posted_has_item at the database, so this is defensive.
    // It is here because the message a person gets should say what is wrong
    // rather than name a constraint.
    blockers.push(
      `${grn.grnNo} is posted but names no stock item, so there is no balance to take it out of.`,
    );
    return blockers;
  }

  /*
   * ONE LIVE REVERSAL AT A TIME.
   *
   * Also a partial unique index on the table - see the F-04 migration - so
   * two reversals racing cannot both be created. This check exists to turn
   * that constraint violation into a sentence naming the document already in
   * flight, which is what the storeman actually needs to know.
   */
  const inFlight = await db.grnReversal.findFirst({
    where: {
      grnId: grn.id,
      deletedAt: null,
      workflowState: { notIn: ['REJECTED', 'CANCELLED'] },
      ...(ignoreReversalId ? { id: { not: ignoreReversalId } } : {}),
    },
    select: { reversalNo: true, workflowState: true },
  });
  if (inFlight) {
    blockers.push(
      `${inFlight.reversalNo} is already open against ${grn.grnNo} ` +
        `(${engine.STATE_LABEL[inFlight.workflowState].toLowerCase()}). ` +
        'Finish or reject that one first.',
    );
  }

  /*
   * THE ROLLS.
   *
   * A roll-tracked receipt is reversible only while every roll it created is
   * exactly as it was received: full balance, still raw, not held, not
   * deleted. Anything else means the cloth has moved on, and the receipt that
   * brought it in can no longer be un-booked without lying about where it is.
   */
  const rolls = await rollsOf(db, grn.id);
  for (const roll of rolls) {
    if (roll.deletedAt) {
      blockers.push(`Roll ${roll.rollNo} has been deleted since this receipt.`);
      continue;
    }
    if (!D(roll.balanceQty).equals(D(roll.receivedQty))) {
      const used = D(roll.receivedQty).minus(D(roll.balanceQty));
      blockers.push(
        `Roll ${roll.rollNo} has been drawn on: ${used.toFixed(4)} of ` +
          `${D(roll.receivedQty).toFixed(4)} has already been issued.`,
      );
      continue;
    }
    if (roll.stage !== 'RAW') {
      blockers.push(
        `Roll ${roll.rollNo} has moved on to ${String(roll.stage).replace(/_/g, ' ').toLowerCase()} ` +
          'and is no longer the cloth this receipt booked in.',
      );
      continue;
    }
    if (roll.isHeld) {
      blockers.push(
        `Roll ${roll.rollNo} is held - release or resolve the hold before reversing the receipt.`,
      );
    }
  }

  /*
   * A roll whose balance is intact can still have been issued and returned.
   * The balance would be back where it started and the three checks above
   * would all pass, while the ledger carries movements that make the receipt
   * part of a longer story than "it arrived". Reversing under those
   * circumstances is not obviously wrong, but it is not obviously right
   * either, and this document does not have a way to record which - so it
   * refuses and says why.
   */
  const liveRollIds = rolls.filter((r) => !r.deletedAt).map((r) => r.id);
  if (liveRollIds.length) {
    const drawn = await db.stockLedger.count({
      where: { rollId: { in: liveRollIds }, direction: 'OUT' },
    });
    if (drawn > 0) {
      blockers.push(
        `${drawn} issue${drawn === 1 ? ' has' : 's have'} been posted against the roll(s) on this ` +
          'receipt. Even where the cloth came back, the receipt is no longer the only thing that ' +
          'moved it, and it cannot be reversed on its own.',
      );
    }
  }

  /*
   * THE BALANCE HAS TO COVER IT.
   *
   * For a lot receipt - anything not roll-tracked - this is the only test
   * there is: the stock is a pool, and what can be said about it is whether
   * the pool is still deep enough to take the receipt back out.
   *
   * `postMovement()` enforces exactly this again under its own lock, and that
   * is the enforcement. This is here so the storeman gets "there is only
   * 40 m left" before an approval round trip rather than after it.
   */
  const available = await availableQty(db, grn.inventoryItemId, grn.location);
  if (D(grn.receivingQty).greaterThan(available)) {
    blockers.push(
      `Only ${available.toFixed(4)} ${grn.uom} of this item is left at ${grn.location}, and the ` +
        `receipt booked in ${D(grn.receivingQty).toFixed(4)}. Some of it has already been issued.`,
    );
  }

  return blockers;
}

/** The throwing form. Every blocker, in one message, so nothing is discovered twice. */
async function assertReversible(db, grn, opts) {
  const blockers = await blockersFor(db, grn, opts);
  if (blockers.length) {
    throw ApiError.conflict(
      `${grn.grnNo} cannot be reversed. ` + blockers.join(' '),
      { grnNo: grn.grnNo, blockers },
    );
  }
}

/** The receipt, loaded with everything the checks and the posting need. */
async function loadGrn(db, grnId) {
  const grn = await db.grn.findFirst({
    where: { id: grnId, deletedAt: null },
    include: {
      purchaseOrder: {
        // `orderId` is the BUYER order the PO was raised against, and it is
        // what the ledger rows carry so a movement can be traced to the order
        // that caused it. The receipt's own movements carry it; the reversal's
        // must carry the same one or the two halves of the correction would
        // sit under different orders.
        select: { id: true, poId: true, orderId: true, orderQty: true, receivedQty: true },
      },
      vendor: { select: { id: true, vendorName: true } },
      inventoryItem: {
        select: {
          id: true,
          itemCode: true,
          description: true,
          isRollTracked: true,
          itemCategory: true,
        },
      },
    },
  });
  if (!grn) throw ApiError.notFound('GRN');
  return grn;
}

// ===========================================================================
//  READS
// ===========================================================================

/**
 * Whether this receipt can be reversed, and what it would undo.
 *
 * Read-only, and the screen's basis for offering the button at all. Returning
 * the blockers rather than a bare false is the difference between "you cannot
 * do this" and "roll FAB-0007 has already been issued to the dye house".
 */
export async function eligibility(grnId) {
  const grn = await loadGrn(prisma, grnId);
  const blockers = await blockersFor(prisma, grn);
  const rolls = await rollsOf(prisma, grn.id);
  const live = rolls.filter((r) => !r.deletedAt);

  return {
    grnId: grn.id,
    grnNo: grn.grnNo,
    reversible: blockers.length === 0,
    blockers,
    /** What a reversal raised now would undo, and what it would be numbered. */
    wouldReverse: {
      reversalNo: await peekNumber('GRN_REVERSAL'),
      qty: D(grn.receivingQty).toFixed(4),
      uom: grn.uom,
      amount: D(grn.amount).toFixed(2),
      location: grn.location,
      item: grn.item,
      itemCode: grn.inventoryItem?.itemCode ?? null,
      rollCount: live.length,
      rollNos: live.map((r) => r.rollNo),
      purchaseOrder: grn.purchaseOrder
        ? {
            poId: grn.purchaseOrder.poId,
            receivedQty: D(grn.purchaseOrder.receivedQty).toFixed(4),
            /** Where the order's received quantity would land. */
            receivedQtyAfter: D(grn.purchaseOrder.receivedQty)
              .minus(D(grn.receivingQty))
              .toFixed(4),
          }
        : null,
    },
    existing: await prisma.grnReversal.findFirst({
      where: { grnId: grn.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reversalNo: true,
        workflowState: true,
        reason: true,
        postedAt: true,
      },
    }),
  };
}

export async function list(query = {}) {
  const { skip, take, sortBy, sortDir, search, workflowState, grnId, purchaseOrderId } = query;

  const where = {
    deletedAt: null,
    ...(workflowState ? { workflowState } : {}),
    ...(grnId ? { grnId } : {}),
    ...(purchaseOrderId ? { grn: { purchaseOrderId } } : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total] = await Promise.all([
    prisma.grnReversal.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: { [sortBy ?? 'reversalDate']: sortDir ?? 'desc' },
      skip,
      take,
    }),
    prisma.grnReversal.count({ where }),
  ]);

  return { rows: rows.map(project), total };
}

export async function getById(id) {
  const row = await prisma.grnReversal.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!row) throw ApiError.notFound('GRN reversal');
  return project(row);
}

// ===========================================================================
//  WRITES
// ===========================================================================

/**
 * Raises a reversal against a posted receipt.
 *
 * Created as a DRAFT and, unless the caller says otherwise, submitted for
 * approval in the same call. Two round trips to say "this receipt is wrong"
 * would be two chances to leave the correction sitting in a drawer.
 *
 * The figures are FROZEN here, off the receipt, and re-checked against it at
 * posting. That is the same rule every other document in this system follows,
 * and it earns its keep in exactly one case: somebody edits the receipt's
 * descriptive fields between the reversal being raised and being signed, and
 * the reversal still says what it was signed for.
 */
export async function create(input, actor = {}) {
  const grn = await loadGrn(prisma, input.grnId);
  await assertReversible(prisma, grn);

  const rolls = (await rollsOf(prisma, grn.id)).filter((r) => !r.deletedAt);

  const created = await prisma.$transaction(async (tx) => {
    const reversalNo = await nextNumber('GRN_REVERSAL', { tx });

    return tx.grnReversal.create({
      data: {
        reversalNo,
        reversalDate: input.reversalDate ? new Date(input.reversalDate) : new Date(),
        grnId: grn.id,
        reason: input.reason.trim(),
        reversedQty: D(grn.receivingQty),
        reversedAmount: D(grn.amount),
        uom: grn.uom,
        location: grn.location,
        inventoryItemId: grn.inventoryItemId,
        rollCount: rolls.length,
        remarks: input.remarks ?? null,
        workflowState: 'DRAFT',
        approvalStatus: 'PENDING',
        createdById: actor.userId ?? null,
        updatedById: actor.userId ?? null,
      },
    });
  });

  /*
   * No trail entry for the creation itself.
   *
   * `ApprovalAction` has no CREATED member, deliberately: the trail records
   * DECISIONS, and raising a draft is not one. The reason travels on the
   * submission below, which is the first thing anybody else sees and the entry
   * an approver reads before signing.
   */
  if (input.submit === false) return getById(created.id);

  return submit(
    created.id,
    {
      submittedTo: input.submittedTo,
      remarks:
        `Reversal of ${grn.grnNo} (bill ${grn.billNo}): take ` +
        `${D(grn.receivingQty).toFixed(4)} ${grn.uom} back out of ${grn.location}` +
        (rolls.length ? `, writing off ${rolls.length} roll(s)` : '') +
        `. ${created.reason}`,
    },
    actor,
  );
}

/** Header only, and only while it is a draft. The figures are the receipt's. */
export async function update(id, input, actor = {}) {
  const existing = await prisma.grnReversal.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, reversalNo: true, workflowState: true },
  });
  if (!existing) throw ApiError.notFound('GRN reversal');

  if (existing.workflowState !== 'DRAFT') {
    throw ApiError.conflict(
      `${existing.reversalNo} is ${engine.STATE_LABEL[existing.workflowState].toLowerCase()} and ` +
        'can no longer be edited. Reject it and raise another, so the change is on the record.',
      { workflowState: existing.workflowState },
    );
  }

  await prisma.grnReversal.update({
    where: { id },
    data: {
      ...(input.reason !== undefined ? { reason: input.reason.trim() } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      ...(input.reversalDate !== undefined ? { reversalDate: new Date(input.reversalDate) } : {}),
      updatedById: actor.userId ?? null,
    },
  });

  return getById(id);
}

/**
 * Submits the reversal for a decision.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS DOES NOT STOP AT `SUBMITTED`
 *
 *  `engine.submit()` walks DRAFT -> SUBMITTED, and then on to
 *  PENDING_APPROVAL only if it was given a `submittedTo`. That is right for
 *  the modules it was written for: a plan is submitted TO somebody by name,
 *  and until it has been routed it is genuinely sitting in an outbox.
 *
 *  A reversal has no outbox. It is raised because the ledger is wrong right
 *  now, and the moment the store says so it is waiting on a signature -
 *  whoever holds GRN_REVERSAL.APPROVE - not on being addressed to somebody.
 *  Left at SUBMITTED it would be invisible to the approver's queue, which
 *  reads PENDING_STATES, and unapprovable by the transition table, which does
 *  not permit SUBMITTED -> APPROVED. A reversal raised without a `submittedTo`
 *  was stranded: it could only go back to draft or be cancelled.
 *
 *  So `submittedTo` stays optional metadata - a name to address it to, if the
 *  store has one - and the document always ends this call awaiting a decision.
 * ---------------------------------------------------------------------------
 */
export async function submit(id, { submittedTo, remarks } = {}, actor = {}) {
  const submitted = await engine.submit(null, {
    documentType: 'GRN_REVERSAL',
    documentId: id,
    submittedTo,
    actor,
    remarks,
    data: {
      submittedTo: submittedTo ?? null,
      submittedAt: new Date(),
      submittedById: actor.userId ?? null,
      submittedByName: actor.fullName ?? null,
    },
  });

  if (submitted.workflowState === 'SUBMITTED') {
    await engine.transition(null, {
      documentType: 'GRN_REVERSAL',
      documentId: id,
      to: 'PENDING_APPROVAL',
      actor,
      remarks: remarks ?? 'Awaiting approval',
    });
  }

  return getById(id);
}

/**
 * Approves the reversal AND posts it, in one transaction.
 *
 * ---------------------------------------------------------------------------
 *  WHY THE TWO ARE NOT SEPARATE BUTTONS
 *
 *  Every other posted document in this system separates authorising from
 *  acting, and for those it is right: approving a job work order and actually
 *  sending the cloth are different days' work.
 *
 *  Here they are the same act. The approval IS the decision to take the stock
 *  back out, nothing happens between the two, and a reversal left approved and
 *  unposted would be a document that says the ledger is wrong sitting next to
 *  a ledger that is still wrong - which is the situation this whole file
 *  exists to end. So APPROVED and POSTED are two entries in the trail and one
 *  transaction, and there is no state in between for anybody to forget about.
 *
 *  MAKER-CHECKER is enforced by `approvalEngine.transition()` on the APPROVED
 *  move, from the registry's `separateChecker: true`. It is not repeated here:
 *  a second copy of the rule is a second place for it to drift.
 * ---------------------------------------------------------------------------
 */
export async function approve(id, { remarks } = {}, actor = {}) {
  const reversal = await prisma.grnReversal.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      reversalNo: true,
      grnId: true,
      workflowState: true,
      reversedQty: true,
      reversedAmount: true,
      location: true,
      inventoryItemId: true,
      reason: true,
      uom: true,
    },
  });
  if (!reversal) throw ApiError.notFound('GRN reversal');

  await prisma.$transaction(
    async (tx) => {
      const now = new Date();

      /*
       * The approval first, so that maker-checker and the transition table
       * both get their say before any stock moves. A refusal here leaves the
       * ledger untouched, which is the correct order for an irreversible act.
       */
      await engine.approve(tx, {
        documentType: 'GRN_REVERSAL',
        documentId: id,
        actor,
        remarks,
        data: {
          approvedAt: now,
          approvedById: actor.userId ?? null,
          approvedByName: actor.fullName ?? null,
          decidedAt: now,
        },
      });

      const moved = await postReversal(tx, { reversal, actor, at: now });

      await engine.post(tx, {
        documentType: 'GRN_REVERSAL',
        documentId: id,
        actor,
        remarks:
          `Took ${moved.qty.toFixed(4)} ${reversal.uom} back out of ${reversal.location}` +
          (moved.rollCount ? `, writing off ${moved.rollCount} roll(s)` : '') +
          `. ${moved.poNote}`,
        data: {
          postedAt: now,
          postedById: actor.userId ?? null,
          postedByName: actor.fullName ?? null,
        },
      });
    },
    /*
     * The same explicit budget the GRN's own posting takes, and for the same
     * reason: a fifty-roll receipt is fifty write-offs and fifty movements,
     * and Prisma's five-second default is sized for a document that writes a
     * handful of rows. See the note on grn.service.js create().
     */
    { timeout: 30_000, maxWait: 10_000 },
  );

  return getById(id);
}

/**
 * The stock half. Runs inside the caller's transaction, never on its own.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function postReversal(tx, { reversal, actor, at }) {
  /*
   * LOCK THE ROLLS BEFORE READING THEM.
   *
   * F-03's lesson, applied to a second write path. Without this, a fabric
   * issue committing between this transaction's read and its write would be
   * invisible here: both would see a full roll, both would decide the cloth
   * was there, and the reversal would take out stock the issue had already
   * taken. The `FOR UPDATE` is taken BEFORE the read so the balance this
   * transaction acts on is the one no other transaction can be changing.
   *
   * Rolls first, then the (item, location) advisory lock that postMovement()
   * takes, then the purchase order - the same order grn.service.js create()
   * and fabricIssue.service.js take them in, so two of these can queue behind
   * each other but never deadlock.
   */
  await tx.$executeRaw`
    SELECT id FROM fabric_rolls WHERE grn_id = ${reversal.grnId}::uuid FOR UPDATE
  `;

  const grn = await loadGrn(tx, reversal.grnId);

  /*
   * EVERY CHECK AGAIN, UNDER THE LOCK.
   *
   * The create-time call was a courtesy. This one is the enforcement: minutes
   * or days have passed, and the cloth can have left the store in between.
   * `ignoreReversalId` because this reversal is itself the live one and must
   * not block itself.
   */
  await assertReversible(tx, grn, { ignoreReversalId: reversal.id });

  /*
   * THE FROZEN FIGURES MUST STILL MATCH THE RECEIPT.
   *
   * Nothing in the application edits a posted receipt's quantity - update()
   * permits descriptive fields only - so this should never fire. It is here
   * because the alternative to checking is posting a movement for a quantity
   * that no longer describes anything, and the approver signed a number, not
   * a row id.
   */
  if (!D(reversal.reversedQty).equals(D(grn.receivingQty))) {
    throw ApiError.conflict(
      `${reversal.reversalNo} was raised to reverse ${D(reversal.reversedQty).toFixed(4)} ` +
        `${reversal.uom}, but ${grn.grnNo} now records ${D(grn.receivingQty).toFixed(4)}. ` +
        'Reject this reversal and raise another against the current figures.',
      { frozen: D(reversal.reversedQty).toFixed(4), current: D(grn.receivingQty).toFixed(4) },
    );
  }

  const itemId = grn.inventoryItemId;
  const location = grn.location;

  /*
   * FIFO - A REVERSAL TAKES BACK ITS OWN RECEIPT'S COST.
   *
   * An ordinary issue consumes the oldest layers first. A reversal is not an
   * issue: it undoes one receipt, so it consumes the layers that receipt
   * opened, at the receipt's own rate, before anything else. Only if some of
   * that stock has already been issued (and the layers drawn down) does it
   * fall back to FIFO order for the balance.
   */
  const ownLayers = await tx.stockLedger.findMany({
    where: { documentType: 'GRN', documentId: grn.id, direction: 'IN' },
    select: { id: true },
  });
  const preferSourceLedgerIds = ownLayers.map((l) => l.id);

  const snapshot = {
    itemCategory: grn.inventoryItem?.itemCategory ?? grn.item,
    colorCode: null,
    gsm: null,
    content: null,
    uom: grn.uom,
  };

  const rolls = (await rollsOf(tx, grn.id)).filter((r) => !r.deletedAt);
  const remarks =
    `Reversal ${reversal.reversalNo} of receipt ${grn.grnNo} (bill ${grn.billNo}). ` +
    reversal.reason;

  if (rolls.length) {
    for (const roll of rolls) {
      await postMovement(tx, {
        itemId,
        rollId: roll.id,
        direction: 'OUT',
        // Same item, same location for every roll on the receipt, so the
        // balance cache is rebuilt once after the loop rather than per roll.
        deferBalance: true,
        qty: D(roll.balanceQty),
        rate: grn.inventoryRate,
        entryDate: at,
        location,
        preferSourceLedgerIds,
      documentType: 'GRN_REVERSAL',
        documentId: reversal.id,
        documentNo: reversal.reversalNo,
        orderId: grn.purchaseOrder?.orderId ?? null,
        grnId: grn.id,
        snapshot,
        remarks: `Roll ${roll.rollNo} written off. ${remarks}`,
        actor,
      });

      /*
       * The roll is written off, not merely emptied.
       *
       * `{ decrement }` rather than a computed zero, for F-03's reason: an
       * absolute write walks past the `balance_qty >= 0` CHECK, and a
       * decrement makes that constraint a real backstop. Soft-deleted because
       * a roll with no cloth on it is not a roll - it is a label for a receipt
       * that should never have been booked - and every live-roll query in this
       * application filters `deletedAt: null`.
       *
       * The ledger rows keep pointing at it, which is the point: the movements
       * stay explicable after the roll leaves the register.
       */
      await tx.fabricRoll.update({
        where: { id: roll.id },
        data: {
          balanceQty: { decrement: D(roll.balanceQty) },
          deletedAt: at,
          deletedById: actor.userId ?? null,
          /*
           * `writtenOffAt` as well as `deletedAt`, and they mean different
           * things. The soft delete takes the row out of every live-roll
           * query; this stamp puts the roll's NUMBER back into circulation,
           * because the physical roll and its printed label are still on the
           * rack and the re-keyed receipt has to be able to name them. It is
           * what the partial unique index on `roll_no` is conditioned on. See
           * the field's comment in schema.prisma.
           */
          writtenOffAt: at,
          updatedById: actor.userId ?? null,
          remarks: `Written off by ${reversal.reversalNo}. ${reversal.reason}`,
        },
      });
    }

    await recomputeBalance(tx, itemId, location);
  } else {
    await postMovement(tx, {
      itemId,
      direction: 'OUT',
      qty: D(grn.receivingQty),
      rate: grn.inventoryRate,
      preferSourceLedgerIds,
      entryDate: at,
      location,
      documentType: 'GRN_REVERSAL',
      documentId: reversal.id,
      documentNo: reversal.reversalNo,
      orderId: grn.purchaseOrder?.orderId ?? null,
      grnId: grn.id,
      snapshot,
      remarks,
      actor,
    });
  }

  /*
   * THE PURCHASE ORDER.
   *
   * `receivedQty` is what every tolerance assessment and every subsequent
   * receipt reads, and `payableQty` is what the vendor is owed for. Both were
   * incremented by the receipt and both come back out, or the order stays
   * claiming goods that are no longer on the books.
   *
   * Locked first for the same reason the rolls were: two receipts and a
   * reversal all move this row, and the status below is computed from the
   * value read here. Decremented atomically as well as locked, so the write
   * is right even if the lock above were ever removed.
   */
  await tx.$executeRaw`
    SELECT id FROM purchase_orders WHERE id = ${grn.purchaseOrderId}::uuid FOR UPDATE
  `;
  const po = await tx.purchaseOrder.findUnique({
    where: { id: grn.purchaseOrderId },
    select: { id: true, poId: true, orderQty: true, receivedQty: true, status: true },
  });

  const after = D(po.receivedQty).minus(D(grn.receivingQty));
  if (after.isNegative()) {
    // The order cannot have received less than nothing. Reaching this means
    // the receipt was counted out of the order twice, and refusing is the only
    // answer that does not make it worse.
    throw ApiError.conflict(
      `Reversing ${grn.grnNo} would take ${po.poId} to ${after.toFixed(4)} received, which is ` +
        'impossible. The order and its receipts disagree; this needs looking at before it can ' +
        'be reversed.',
      { poId: po.poId, receivedQty: D(po.receivedQty).toFixed(4) },
    );
  }

  /*
   * The fulfilment status is recomputed rather than transitioned.
   *
   * `FULFILMENT_TRANSITIONS` calls COMPLETED terminal, and for the /status
   * endpoint it is - a screen must not be able to un-complete an order. This
   * is the documented exception the engine's own comment points at: "where a
   * module genuinely needs to undo [a state] it does so through an explicit
   * amendment mechanism, never through this table". A reversal is that
   * mechanism, and an order whose only receipt has just been un-booked is not
   * completed however it got there.
   */
  const status = after.greaterThanOrEqualTo(D(po.orderQty))
    ? 'COMPLETED'
    : after.greaterThan(ZERO)
      ? 'IN_PROGRESS'
      : 'PENDING';

  await tx.purchaseOrder.update({
    where: { id: po.id },
    data: {
      receivedQty: { decrement: D(grn.receivingQty) },
      payableQty: { decrement: D(grn.receivingQty) },
      status,
      updatedById: actor.userId ?? null,
    },
  });

  /*
   * THE STAMP ON THE RECEIPT.
   *
   * `workflowState` and `status` are deliberately untouched. The receipt WAS
   * posted and the goods DID arrive; both columns are still true, and
   * rewriting them would destroy the history the reversal exists to preserve.
   * `reversedAt` is the one new fact, and it is what every "live receipts"
   * filter reads - including the partial unique index that frees the bill
   * number for re-entry.
   *
   * The gate pass the goods came in on is also left CLEARED. It records that
   * a delivery physically passed the gate, which it did. Reopening it would
   * be the system claiming the lorry never arrived.
   */
  await tx.grn.update({
    where: { id: grn.id },
    data: {
      reversedAt: at,
      reversedById: actor.userId ?? null,
      reversedByName: actor.fullName ?? null,
      updatedById: actor.userId ?? null,
    },
  });

  await engine.record(tx, {
    documentType: 'GRN',
    documentId: grn.id,
    documentNo: grn.grnNo,
    action: 'AMENDED',
    fromStatus: 'POSTED',
    toStatus: 'POSTED',
    actor,
    remarks:
      `Reversed by ${reversal.reversalNo}: ${D(grn.receivingQty).toFixed(4)} ${grn.uom} taken ` +
      `back out of ${location}. ${reversal.reason}`,
  });

  return {
    qty: D(grn.receivingQty),
    rollCount: rolls.length,
    poNote: `${po.poId} received quantity ${D(po.receivedQty).toFixed(4)} -> ${after.toFixed(4)}.`,
  };
}

/** Refuses the reversal, with a reason. The receipt stands as it was. */
export async function reject(id, { reason } = {}, actor = {}) {
  await engine.reject(null, {
    documentType: 'GRN_REVERSAL',
    documentId: id,
    actor,
    reason,
    data: { decidedAt: new Date(), rejectionReason: reason },
  });
  return getById(id);
}

/** Withdraws a reversal nobody has signed. Frees the receipt for another. */
export async function cancel(id, { reason } = {}, actor = {}) {
  await engine.cancel(null, {
    documentType: 'GRN_REVERSAL',
    documentId: id,
    actor,
    reason,
  });
  return getById(id);
}

/**
 * Soft-deletes a draft.
 *
 * Only a draft. Once a reversal has been submitted it is part of the record of
 * a disagreement about what the store received, and that record is worth more
 * than a tidy list - cancel it instead, which leaves it visible.
 */
export async function remove(id, actorId) {
  const existing = await prisma.grnReversal.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, reversalNo: true, workflowState: true, postedAt: true },
  });
  if (!existing) throw ApiError.notFound('GRN reversal');

  if (existing.postedAt) {
    throw ApiError.conflict(
      `${existing.reversalNo} has posted its movements to the stock ledger and cannot be ` +
        'deleted. The ledger is append-only; a reversal is as permanent as the receipt it undid.',
      { postedAt: existing.postedAt },
    );
  }

  if (existing.workflowState !== 'DRAFT') {
    throw ApiError.conflict(
      `${existing.reversalNo} is ${engine.STATE_LABEL[existing.workflowState].toLowerCase()} and ` +
        'cannot be deleted. Cancel it instead, which leaves the record.',
      { workflowState: existing.workflowState },
    );
  }

  await prisma.grnReversal.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId ?? null },
  });

  return { id, reversalNo: existing.reversalNo, deleted: true };
}
