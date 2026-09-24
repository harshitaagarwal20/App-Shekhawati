/**
 * The approval engine.
 *
 * ===========================================================================
 *  ONE SET OF STATES, ONE TRANSITION TABLE, EVERY MODULE
 * ===========================================================================
 *
 *      DRAFT ──► SUBMITTED ──► PENDING_APPROVAL ──► APPROVED
 *                                      │
 *                                      ▼
 *                                  REJECTED ──► RECTIFICATION ──► RESUBMITTED
 *                                                                      │
 *                                                                      ▼
 *                                                             PENDING_APPROVAL
 *
 * Before this module, every approvable document in the system carried its own
 * status column and its own hand-written rules about which values could follow
 * which - eight modules, eight slightly different answers to the same question.
 * The states are now shared, the transition table is declared once below, and
 * `transition()` is the only function that writes a workflow state.
 *
 * ---------------------------------------------------------------------------
 *  WHY THE OLD COLUMNS ARE STILL THERE
 *
 *  `workflowState` is the authority. Each module's own column -
 *  `approvalStatus`, `authorisationStatus`, `excessApprovalStatus`, `decision`,
 *  `status` - is what the workbook prints and what the table CHECK constraints
 *  already refer to, so it stays, and `transition()` writes BOTH in one update
 *  through the module's `legacy` mapping. Nothing sets one without the other,
 *  which is why they cannot drift apart.
 *
 *  SUBMITTED AND PENDING_APPROVAL ARE NOT THE SAME THING
 *
 *  A document can be handed in before the person who has to decide it has it in
 *  front of them. The difference between "sent" and "on the approver's desk" is
 *  the difference between chasing the sender and chasing the approver, and a
 *  system that collapses the two cannot tell anybody which to do.
 *
 *  RECTIFICATION IS A STATE, NOT A GAP
 *
 *  A rejected document being corrected is not "pending again". Recording the
 *  correction as its own state is what lets a screen show that a plan is on its
 *  third attempt - and a plan on its third attempt is not the same risk as one
 *  on its first.
 * ---------------------------------------------------------------------------
 */

import prisma from '../config/prisma.js';
import { ApiError, ERROR_CODES } from '../utils/ApiError.js';
import { ageDays } from '../utils/figures.js';
import { assertNotSelfApproval } from '../domain/makerChecker.js';

/**
 * The transition table. Everything the engine permits, and nothing else.
 *
 * Declared as data rather than as a switch statement so it can be rendered -
 * `allowedFrom()` drives the buttons a screen offers, which means the UI cannot
 * offer an action the server would refuse.
 */
export const TRANSITIONS = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PENDING_APPROVAL', 'DRAFT', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'DRAFT', 'CANCELLED'],

  // APPROVED never goes back to DRAFT. Authorising something is the point at
  // which other people start acting on it, and quietly returning it to a
  // draft would leave those actions standing on nothing. What an approved
  // document CAN do is be acted on (POSTED) or run its course (COMPLETED).
  //
  // Where a module genuinely needs to undo an approval it does so through an
  // explicit amendment mechanism, never through this table:
  //   Purchase Order   reopen()   - refused once a gate pass or GRN exists
  //   Fabric Scrutiny  amend()    - keeps a before/after set
  //   Plan Approval    rectify()  - raises a new version; the old one locks
  APPROVED: ['POSTED', 'COMPLETED', 'CANCELLED'],

  // Written to the ledger and acted on. From here a document only finishes.
  POSTED: ['COMPLETED'],
  COMPLETED: [],

  // A rejection can go two ways. Straight back to DRAFT is the ordinary case:
  // the author fixes it and resubmits. RECTIFICATION is for the modules that
  // have to RECORD the correction - a plan approval raises a numbered new
  // version rather than editing the rejected one - and it is those modules'
  // own services that choose the longer road.
  REJECTED: ['DRAFT', 'RECTIFICATION', 'CANCELLED'],
  RECTIFICATION: ['RESUBMITTED', 'CANCELLED'],
  RESUBMITTED: ['PENDING_APPROVAL', 'CANCELLED'],

  CANCELLED: [],
};

/** The action that causes each transition, for the trail and for the buttons. */
export const ACTION_FOR = {
  SUBMITTED: 'SUBMITTED',
  PENDING_APPROVAL: 'SUBMITTED',
  APPROVED: 'APPROVED',
  POSTED: 'POSTED',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  RECTIFICATION: 'REWORK_REQUESTED',
  RESUBMITTED: 'SUBMITTED',
  CANCELLED: 'CANCELLED',
  DRAFT: 'REOPENED',
};

/** Plain-English labels, so eight screens do not invent eight wordings. */
export const STATE_LABEL = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  POSTED: 'Posted',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  RECTIFICATION: 'Under rectification',
  RESUBMITTED: 'Resubmitted',
  CANCELLED: 'Cancelled',
};

/**
 * States nothing can follow, for any document type.
 *
 * Distinct from a document being FINISHED: an approved quotation is finished,
 * but an approved purchase order still has goods to receive. What "finished"
 * means is per type, and each entry in REGISTRY declares it as `lifecycle`.
 */
export const TERMINAL = new Set(['COMPLETED', 'CANCELLED']);

/**
 * The states a document type actually walks through, in order.
 *
 * The transition table says what is structurally possible; this says what a
 * given document type does in practice, and it is what a progress bar is
 * drawn from. A quotation ends at APPROVED and is finished there; a GRN is
 * POSTED the moment it is created and never sees an approval step at all.
 */
const APPROVAL_LIFECYCLE = ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED'];

/**
 * Which Prisma model each document type lives in, and how its own status column
 * maps onto the shared state.
 *
 * `legacy` is the whole reason this table exists: it is the single place the
 * translation between "the workbook's column" and "the engine's state" is
 * written down. A module missing from here simply has no legacy column to keep
 * in step - not a licence to write one somewhere else.
 */
/**
 * ===========================================================================
 *  `separateChecker` - MAKER-CHECKER, DECLARED PER DOCUMENT
 * ===========================================================================
 *
 * Whether reaching APPROVED requires somebody other than the person who raised
 * the document.
 *
 * ---------------------------------------------------------------------------
 *  WHY IT IS A REGISTRY COLUMN AND NOT A LINE IN EACH SERVICE
 *
 *  It was a line in each service, and five of the nine forgot it. Purchase
 *  orders - the largest financial commitment this system makes - could be
 *  raised and approved by the same person, while a cutting challan could not,
 *  and nothing in the code said that difference was intended. It was not: the
 *  check was written with the later modules and never retrofitted.
 *
 *  Declared here, the question is answered once per document type, in the same
 *  table that already says what each one's lifecycle and legacy column are. A
 *  new module cannot omit it, because `registryFor()` refuses an entry that
 *  does not state it - see the assertion there. An exception now has to be
 *  written down and justified rather than achieved by silence.
 *
 *  WHY SOME DOCUMENTS ARE DELIBERATELY `false`
 *
 *  Not every APPROVED means "somebody authorised this". For a gate pass it
 *  means "the person who counted the goods signed the gate", and for a cutting
 *  issue it is one step of an automatic chain the supervisor's own posting
 *  runs through. Forcing a second person on those would not add a control; it
 *  would stop the gate and the cutting floor working. Each `false` below says
 *  which of those it is.
 * ---------------------------------------------------------------------------
 */
export const REGISTRY = {
  BUYER_ORDER: {
    model: 'buyerOrder',
    lifecycle: [...APPROVAL_LIFECYCLE, 'COMPLETED'],
    numberField: 'orderNo',
    label: 'Buyer order',
    /** The excess is a Director's decision on a merchandiser's order. */
    separateChecker: true,
    legacy: {
      field: 'excessApprovalStatus',
      map: { APPROVED: 'APPROVED', REJECTED: 'REJECTED', PENDING_APPROVAL: 'PENDING' },
    },
  },
  PLANNING: {
    model: 'planning',
    lifecycle: APPROVAL_LIFECYCLE,
    numberField: 'planNo',
    label: 'Plan',
    /** The plan is prepared by Merchandising and signed by the GM / Director. */
    separateChecker: true,
    legacy: {
      field: 'approvalStatus',
      map: {
        APPROVED: 'APPROVED',
        REJECTED: 'REJECTED',
        PENDING_APPROVAL: 'PENDING',
        RESUBMITTED: 'PENDING',
        DRAFT: 'PENDING',
      },
    },
  },
  VENDOR_QUOTATION: {
    model: 'vendorQuotation',
    lifecycle: APPROVAL_LIFECYCLE,
    numberField: 'quotationNo',
    label: 'Quotation',
    /** Procurement collects the quote; somebody else authorises buying on it. */
    separateChecker: true,
    legacy: {
      field: 'authorisationStatus',
      map: { APPROVED: 'APPROVED', REJECTED: 'REJECTED', PENDING_APPROVAL: 'PENDING' },
    },
  },
  PURCHASE_ORDER: {
    model: 'purchaseOrder',
    lifecycle: [...APPROVAL_LIFECYCLE, 'COMPLETED'],
    numberField: 'poId',
    label: 'Purchase order',
    /** The largest financial commitment in the system. THIS is the one that was missing. */
    separateChecker: true,
    legacy: {
      field: 'approvalStatus',
      map: { APPROVED: 'APPROVED', REJECTED: 'REJECTED', PENDING_APPROVAL: 'PENDING' },
    },
  },
  GATE_PASS: {
    model: 'gatePass',
    lifecycle: ['SUBMITTED', 'APPROVED'],
    numberField: 'gatePassNo',
    label: 'Gate pass',
    /** Clearing a gate pass IS its approval, taken by whoever counted the goods
     * at the gate. That is the same person who wrote the pass, by design. */
    separateChecker: false,
    // Clearing a gate pass IS its approval, taken by whoever counted the goods.
    legacy: { field: 'status', map: { APPROVED: 'CLEARED', SUBMITTED: 'PENDING' } },
  },
  GRN: {
    model: 'grn',
    lifecycle: ['DRAFT', 'POSTED'],
    numberField: 'grnNo',
    label: 'GRN',
    /** A GRN never reaches APPROVED - it goes DRAFT -> POSTED. Posting a receipt
     * is an act, not an authorisation, and nobody signs it. */
    separateChecker: false,
    legacy: { field: 'status', map: { APPROVED: 'COMPLETED', CANCELLED: 'CANCELLED' } },
  },
  /**
   * F-04 - GRN Reversal. The compensating document a posted receipt is
   * corrected by. [A][S]: it is approved, and it moves stock.
   *
   * -------------------------------------------------------------------------
   *  WHY IT IS APPROVED WHEN THE RECEIPT IT UNDOES IS NOT
   *
   *  A GRN is not signed by anybody, and that is right: the goods are in the
   *  yard, somebody counted them, and refusing to record a delivery until a
   *  second person is free would only move the problem off the books.
   *
   *  A reversal is the opposite act in every respect that matters. It takes
   *  stock the system says it has back OUT, and it reduces the quantity the
   *  purchase order says is payable. It is raised precisely BECAUSE somebody
   *  made a mistake, which makes the person raising it the last person who
   *  should be the only one to see it. And unlike the receipt there is no
   *  urgency: the wrong figure is already recorded, and half an hour waiting
   *  for a signature costs nothing.
   *
   *  So `separateChecker: true`. A storeman who can post a receipt and then
   *  quietly un-post it has, between those two acts, no maker-checker at all.
   *
   * -------------------------------------------------------------------------
   *  WHY POSTED IS ON THE LIFECYCLE AND NOT A SEPARATE DECISION
   *
   *  Approving a reversal posts it, in the same transaction - see
   *  grnReversal.service.js. POSTED is on the lifecycle so the progress bar
   *  and the queue know the document has five steps and not four, but nobody
   *  ever presses a "post" button: an approved-but-unposted reversal would be
   *  a state in which the ledger is still wrong and somebody has to remember
   *  to finish the job, which is exactly the failure this document exists to
   *  end, reintroduced one step later.
   * -------------------------------------------------------------------------
   */
  GRN_REVERSAL: {
    model: 'grnReversal',
    lifecycle: [...APPROVAL_LIFECYCLE, 'POSTED'],
    numberField: 'reversalNo',
    label: 'GRN reversal',
    /** The store raises the correction; somebody else signs it. See above. */
    separateChecker: true,
    legacy: {
      field: 'approvalStatus',
      map: {
        APPROVED: 'APPROVED',
        REJECTED: 'REJECTED',
        PENDING_APPROVAL: 'PENDING',
        RESUBMITTED: 'PENDING',
        DRAFT: 'PENDING',
        /**
         * POSTED keeps the column at APPROVED rather than moving it on.
         *
         * `approvalStatus` answers "was this authorised", and posting does not
         * change that answer - it is the act the authorisation permitted. The
         * StatusApproval enum has no POSTED member in any case, and inventing
         * a mapping onto one of its three values would make the column say
         * something about approval that approval did not decide.
         */
        POSTED: 'APPROVED',
      },
    },
  },
  /**
   * C3 - Job Work. [A][S]: it is approved, and it moves stock.
   *
   * The table is `dye_issues` because that is the workbook sheet's name; the
   * register has covered dyeing, printing, washing and finishing since Phase 0.
   * Registering it here is what gives a job work order the same approval trail,
   * the same queue entry and the same stage events as every other document -
   * and what makes `assertIssuable()` able to refuse fabric to a job worker
   * whose order nobody has approved.
   */
  DYE_ISSUE: {
    model: 'dyeIssue',
    lifecycle: [...APPROVAL_LIFECYCLE, 'POSTED', 'COMPLETED'],
    numberField: 'dyeIssueNo',
    label: 'Job work order',
    /** Fabric leaving the building for a job worker is authorised by somebody
     * other than the person sending it. */
    separateChecker: true,
    legacy: {
      field: 'status',
      map: {
        DRAFT: 'PENDING',
        // Approved is authority, not movement. The lot is still in the store
        // until it is POSTED, and the fulfilment column has to say so.
        APPROVED: 'PENDING',
        POSTED: 'IN_PROGRESS',
        COMPLETED: 'COMPLETED',
        CANCELLED: 'CANCELLED',
      },
    },
  },
  /**
   * C12 - the raw material plan. [A] only, and less than that: approving it
   * authorises nothing to happen, it records that the office agreed what has
   * to be bought before procurement went to the market. No stock moves, no PO
   * is raised, and no PO is gated on it.
   */
  MATERIAL_PLAN: {
    model: 'materialPlan',
    lifecycle: APPROVAL_LIFECYCLE,
    numberField: 'planNo',
    label: 'Material plan',
    /** Prepared at the merchandising desk, signed before procurement goes out. */
    separateChecker: true,
    legacy: {
      field: 'approvalStatus',
      map: {
        APPROVED: 'APPROVED',
        REJECTED: 'REJECTED',
        PENDING_APPROVAL: 'PENDING',
        RESUBMITTED: 'PENDING',
        DRAFT: 'PENDING',
      },
    },
  },
  /**
   * C5 - the cutting department's requirement. [A] only: approving a challan
   * authorises an issue, it does not make one. The fabric moves on the Fabric
   * Issue that fulfils the line.
   */
  CUTTING_CHALLAN: {
    model: 'cuttingChallan',
    lifecycle: [...APPROVAL_LIFECYCLE, 'COMPLETED'],
    numberField: 'challanNo',
    label: 'Cutting challan',
    /** The cutting floor raises the requirement; a supervisor approves it. */
    separateChecker: true,
    legacy: {
      field: 'status',
      map: {
        DRAFT: 'PENDING',
        // Still PENDING on approval: an approved challan has been authorised
        // and fulfilled by nothing. `recomputeFulfilment()` moves it to
        // IN_PROGRESS when the first issue lands.
        APPROVED: 'PENDING',
        COMPLETED: 'COMPLETED',
        CANCELLED: 'CANCELLED',
      },
    },
  },
  FABRIC_SCRUTINY: {
    model: 'fabricScrutiny',
    lifecycle: ['DRAFT', 'APPROVED'],
    numberField: 'scrutinyNo',
    label: 'Fabric scrutiny',
    /** The checker who inspects the cloth records the finding and finalises it -
     * one person, one inspection. `finalise()` does not use the engine at all;
     * this is declared so the table has no blanks, not because it is reached. */
    separateChecker: false,
    // The scrutiny's own column is the DECISION, which is not a status at all -
    // ACCEPT / REJECT / REWORK. It is set by finalise(), never by the engine.
    legacy: null,
  },
  PLAN_APPROVAL: {
    model: 'planApproval',
    lifecycle: APPROVAL_LIFECYCLE,
    numberField: 'approvalNo',
    label: 'Plan approval',
    /** The whole purpose of the document is a second signature. */
    separateChecker: true,
    legacy: {
      field: 'approvalStatus',
      map: {
        APPROVED: 'APPROVED',
        REJECTED: 'REJECTED',
        PENDING_APPROVAL: 'PENDING',
        RESUBMITTED: 'PENDING',
        RECTIFICATION: 'REJECTED',
      },
    },
  },
  CUTTING_ISSUE: {
    model: 'cuttingIssue',
    lifecycle: [...APPROVAL_LIFECYCLE, 'POSTED'],
    numberField: 'challanNo',
    label: 'Cutting issue',
    /** Posting walks DRAFT -> SUBMITTED -> PENDING_APPROVAL -> APPROVED -> POSTED
     * in ONE transaction driven by one actor: the cutting supervisor approves
     * and posts their own challan, and the trail records both facts. Requiring
     * a second person here would stop the cutting floor issuing anything. */
    separateChecker: false,
    legacy: {
      /**
       * POSTED -> COMPLETED is what closes a challan.
       *
       * Without it the status column stopped at IN_PROGRESS the moment the
       * cloth was cut and stayed there for good: posting runs
       * DRAFT -> SUBMITTED -> PENDING_APPROVAL -> APPROVED -> POSTED in one
       * transaction, and there is no /cutting-issues/:id/status route to move
       * the column on afterwards. Every posted challan therefore counted as
       * still open, forever, on the pipeline stage that reads this column.
       */
      field: 'status',
      map: {
        APPROVED: 'IN_PROGRESS',
        POSTED: 'COMPLETED',
        CANCELLED: 'CANCELLED',
        DRAFT: 'PENDING',
      },
    },
  },
};

// ===========================================================================
//  THE RULES
// ===========================================================================

/** Whether one state may follow another. */
export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * What a document in this state may do next, ready to be rendered as buttons.
 *
 * A screen that builds its actions from this cannot offer one the server would
 * refuse, which is the only way an eight-module workflow stays honest.
 */
export function allowedFrom(state) {
  return (TRANSITIONS[state] ?? []).map((to) => ({
    to,
    label: STATE_LABEL[to],
    action: ACTION_FOR[to],
    terminal: TERMINAL.has(to),
  }));
}

/** The whole state machine, for a screen to draw a progress trail from. */
export function describe() {
  return {
    states: Object.keys(TRANSITIONS).map((state) => ({
      state,
      label: STATE_LABEL[state],
      terminal: TERMINAL.has(state),
      next: TRANSITIONS[state],
    })),
    /** The happy path, in order, so a progress bar knows what to draw. */
    happyPath: APPROVAL_LIFECYCLE,
    /** And the loop a rejection takes. */
    rejectionPath: ['REJECTED', 'RECTIFICATION', 'RESUBMITTED', 'PENDING_APPROVAL'],
    /** The other status, and its rules. */
    fulfilment: {
      transitions: FULFILMENT_TRANSITIONS,
      note:
        'workflowState is about authority - who has agreed to this. status is about goods - has it happened yet. Both are controlled; neither is settable to an arbitrary value from a screen.',
    },
    documentTypes: Object.entries(REGISTRY).map(([documentType, cfg]) => ({
      documentType,
      label: cfg.label,
      lifecycle: cfg.lifecycle,
      keepsLegacyColumn: cfg.legacy?.field ?? null,
    })),
  };
}

function registryFor(documentType) {
  const cfg = REGISTRY[documentType];
  if (!cfg) {
    throw new Error(
      `${documentType} is not registered with the approval engine. Add it to REGISTRY.`,
    );
  }
  /*
   * A missing `separateChecker` is a programming error, not a default.
   *
   * Defaulting it either way is how this control was lost in the first place:
   * `true` would silently break the gate pass and the cutting floor, and
   * `false` would silently reopen self-approval on the next module somebody
   * adds. Refusing to run is the only answer that cannot be arrived at by not
   * thinking about it - the same reasoning C1 applied to `order_mode`.
   */
  if (typeof cfg.separateChecker !== 'boolean') {
    throw new Error(
      `${documentType} does not declare separateChecker. Say whether approving it requires ` +
        'somebody other than the person who raised it - true for anything a second person ' +
        'signs, false only where APPROVED is the raiser\'s own act (see GATE_PASS, ' +
        'CUTTING_ISSUE), with a comment saying which.',
    );
  }
  return cfg;
}

// ===========================================================================
//  THE TRANSITION
// ===========================================================================

/**
 * Moves a document from one workflow state to the next.
 *
 * THE ONLY function in this application that writes `workflowState`. It:
 *
 *   1. refuses a transition the table does not permit, naming what IS permitted;
 *   2. writes the new state and the module's own legacy column in ONE update,
 *      so the two cannot disagree;
 *   3. appends to the approval trail.
 *
 * Runs on the caller's transaction client when given one, so the state change
 * and whatever else the caller is doing commit together.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 * @param {object} args
 * @param {string} args.documentType
 * @param {string} args.documentId
 * @param {string} args.to             The state being moved to
 * @param {{userId?: string, fullName?: string}} [args.actor]
 * @param {string} [args.remarks]
 * @param {object} [args.data]         Extra columns to write in the same update
 */
export async function transition(
  tx,
  { documentType, documentId, to, actor = {}, remarks, data = {} },
) {
  const client = tx ?? prisma;
  const cfg = registryFor(documentType);

  const current = await client[cfg.model].findUnique({ where: { id: documentId } });
  if (!current) throw ApiError.notFound(cfg.label);

  const from = current.workflowState;

  if (from === to) {
    throw ApiError.badRequest(
      `${cfg.label} ${current[cfg.numberField]} is already ${STATE_LABEL[to].toLowerCase()}.`,
      { workflowState: from },
    );
  }
  if (!canTransition(from, to)) {
    const permitted = TRANSITIONS[from] ?? [];
    throw new ApiError(
      409,
      `${cfg.label} ${current[cfg.numberField]} is ${STATE_LABEL[from].toLowerCase()} and cannot ` +
        `move to ${STATE_LABEL[to].toLowerCase()}.` +
        (permitted.length
          ? ` From here it can only go to: ${permitted.map((p) => STATE_LABEL[p].toLowerCase()).join(', ')}.`
          : ' It is finished and moves no further.'),
      { code: ERROR_CODES.INVALID_TRANSITION, details: { from, to, permitted } },
    );
  }

  /*
   * MAKER-CHECKER.
   *
   * Checked HERE rather than in each service, because in each service it was
   * checked four times out of nine. Every document that reaches APPROVED
   * through this engine is now subject to it unless its registry entry says
   * otherwise, so the failure mode is a deliberate `separateChecker: false`
   * with a reason beside it, not an omission nobody notices.
   *
   * Placed after the transition check so that an already-approved document
   * still gets "this is already approved" rather than a maker-checker refusal,
   * which would be a confusing answer to the wrong question.
   *
   * NOTE: four services approve by writing their own columns and never call
   * this engine - planning, vendor quotation, buyer order excess and the
   * excess register. They carry their own `assertNotSelfApproval()` call. This
   * is not belt-and-braces; without those calls they are simply not covered.
   */
  if (to === 'APPROVED' && cfg.separateChecker) {
    assertNotSelfApproval(current, actor, cfg.label.toLowerCase());
  }

  // The state and the legacy column, in one update. This is the line that makes
  // the two incapable of drifting.
  const legacyPatch =
    cfg.legacy && cfg.legacy.map[to] !== undefined
      ? { [cfg.legacy.field]: cfg.legacy.map[to] }
      : {};

  /*
   * ---------------------------------------------------------------------------
   *  THE WRITE IS CONDITIONAL ON THE STATE THIS CALL READ.
   *
   *  Everything above - the `from === to` check, the transition table, the
   *  maker-checker gate - was decided from `current`, read at the top of this
   *  function. Under PostgreSQL's default READ COMMITTED, a second transaction
   *  asking the same question at the same moment gets its own snapshot and
   *  reaches exactly the same conclusions. Both then wrote, and one pending
   *  document was approved twice: two APPROVED rows on the trail for one act of
   *  approval, and - because `record()` numbers entries from an unlocked
   *  count() - both rows sometimes claiming the same sequence number.
   *
   *  `updateMany ... where workflowState = from` closes that. Under READ
   *  COMMITTED the second UPDATE blocks on the first one's row lock, and when
   *  the first commits the second RE-EVALUATES its WHERE against the new row
   *  version. The state has moved, nothing matches, and `count` comes back 0.
   *  The loser therefore never reaches `record()`, so the trail gets one entry.
   *
   *  Why not `SELECT ... FOR UPDATE`: it needs the physical table name, which
   *  the registry does not carry and which would be a second place to keep in
   *  step with the schema. This needs nothing the registry does not already
   *  declare.
   *
   *  Why `count === 0` is a 409 and not a retry: the other writer's decision is
   *  a real decision, taken by a real person. Re-running this one on top of it
   *  would silently overwrite it. The caller is told, and asks again.
   * ---------------------------------------------------------------------------
   */
  const { count } = await client[cfg.model].updateMany({
    where: { id: documentId, workflowState: from },
    data: {
      workflowState: to,
      ...legacyPatch,
      ...data,
      ...(actor.userId ? { updatedById: actor.userId } : {}),
    },
  });

  if (count === 0) {
    const now = await client[cfg.model].findUnique({ where: { id: documentId } });
    throw new ApiError(
      409,
      `${cfg.label} ${current[cfg.numberField]} was decided by somebody else a moment ago and is ` +
        `now ${(STATE_LABEL[now?.workflowState] ?? 'no longer available').toLowerCase()}. ` +
        'Your decision was not recorded. Reload the document and check what was decided ' +
        'before acting again.',
      {
        code: ERROR_CODES.CONCURRENT_DECISION,
        details: { expected: from, found: now?.workflowState ?? null, attempted: to },
      },
    );
  }

  const updated = await client[cfg.model].findUnique({ where: { id: documentId } });

  await record(client, {
    documentType,
    documentId,
    documentNo: updated[cfg.numberField],
    action: ACTION_FOR[to] ?? 'SUBMITTED',
    fromStatus: from,
    toStatus: to,
    actor,
    remarks,
  });

  return updated;
}

/**
 * Appends to the approval trail without moving a document.
 *
 * For the things that belong on the trail but are not transitions - an
 * amendment, a comment, a re-print of an approved document.
 */
export async function record(
  tx,
  { documentType, documentId, documentNo, action, fromStatus, toStatus, actor = {}, remarks },
) {
  const client = tx ?? prisma;
  const previous = await client.approvalHistory.count({ where: { documentType, documentId } });

  return client.approvalHistory.create({
    data: {
      documentType,
      documentId,
      documentNo,
      sequenceNo: previous + 1,
      action,
      fromStatus: fromStatus ?? null,
      toStatus: toStatus ?? null,
      actedByName: actor.fullName ?? null,
      actedById: actor.userId ?? null,
      remarks: remarks ?? null,
    },
  });
}

/**
 * The workflow position of one document, with its trail and what it may do next.
 *
 * Every detail screen renders this the same way, which is the visible payoff of
 * having one engine: a user who learns the workflow on purchase orders already
 * knows it on plans.
 */
export async function statusOf(documentType, documentId) {
  const cfg = registryFor(documentType);

  const [document, history] = await Promise.all([
    prisma[cfg.model].findUnique({ where: { id: documentId } }),
    prisma.approvalHistory.findMany({
      where: { documentType, documentId },
      orderBy: { actedAt: 'asc' },
    }),
  ]);
  if (!document) throw ApiError.notFound(cfg.label);

  const state = document.workflowState;

  return {
    documentType,
    documentId,
    documentNo: document[cfg.numberField],
    label: cfg.label,
    state,
    stateLabel: STATE_LABEL[state],
    terminal: TERMINAL.has(state),
    allowed: allowedFrom(state),
    /** Where on the happy path this document sits, for a progress bar. */
    progress: progressOf(state, documentType),
    legacyColumn: cfg.legacy
      ? { field: cfg.legacy.field, value: document[cfg.legacy.field] }
      : null,
    history,
  };
}

/**
 * Where a state sits on that document type's own path, and whether it has gone
 * off it.
 *
 * Returned rather than derived in the browser so every screen draws the same
 * progress bar - including for the states that are not on the happy path at
 * all, which is exactly where a hand-rolled progress bar goes wrong.
 *
 * The path is the DOCUMENT TYPE's, not a global one: a quotation is finished
 * at APPROVED, while a purchase order still has goods to receive, and a bar
 * that showed the quotation as four-of-five would be telling the user it was
 * unfinished when it was not.
 *
 * @param {string} state
 * @param {string} [documentType] Falls back to the plain approval path.
 */
export function progressOf(state, documentType) {
  const path = REGISTRY[documentType]?.lifecycle ?? APPROVAL_LIFECYCLE;
  const onPath = path.indexOf(state);

  if (onPath >= 0) {
    return {
      step: onPath + 1,
      of: path.length,
      path,
      offPath: false,
      offPathState: null,
      finished: onPath === path.length - 1,
    };
  }

  if (state === 'CANCELLED') {
    return { step: 0, of: path.length, path, offPath: true, offPathState: state, finished: true };
  }

  // Rejected, under rectification and resubmitted all sit at the APPROVAL step:
  // the document has been through it and come back. Anchoring them there - and
  // flagging them off-path - is what stops the bar reading as nearly-done.
  const approvalStep = path.indexOf('PENDING_APPROVAL');
  return {
    step: approvalStep >= 0 ? approvalStep + 1 : 1,
    of: path.length,
    path,
    offPath: true,
    offPathState: state,
    finished: false,
  };
}

// ===========================================================================
//  FULFILMENT STATUS
// ===========================================================================

/**
 * The OTHER status every document carries, and the rules for moving it.
 *
 * `workflowState` is about authority - who has agreed to this. `status`
 * (StatusGeneral) is about GOODS - has it happened yet. They are genuinely
 * different questions: an approved purchase order is authorised and not yet
 * delivered, and both facts matter to different people.
 *
 * Before this table existed, `status` was writable from the frontend to any
 * value the enum allowed - so a screen could move a cancelled PO back to
 * in-progress, or mark something completed that had never started. It is now
 * as controlled as the workflow state, and for the same reason.
 */
export const FULFILMENT_TRANSITIONS = {
  PENDING: ['IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'PENDING', 'CANCELLED'],
  // Both terminal. Something delivered is not un-delivered, and something
  // cancelled is re-raised as a new document rather than revived.
  COMPLETED: [],
  CANCELLED: [],
};

/** The gate pass has its own two-state lifecycle: raised, then counted. */
export const GATE_PASS_TRANSITIONS = {
  PENDING: ['CLEARED'],
  /**
   * CLEARED → PENDING is the gate pass's explicit amendment mechanism, and the
   * only reason this is not terminal.
   *
   * §38 forbids walking an authorisation backwards UNLESS such a mechanism
   * exists. `gatePass.reopen()` is one: it requires GATE_PASS.APPROVE, it takes
   * a reason, and it refuses outright once a GRN has been received on the pass -
   * because at that point the goods are in stock and the gate record is
   * evidence, not a draft.
   *
   * Nothing else may make this move. The table permits it; reopen() is where
   * the conditions live.
   */
  CLEARED: ['PENDING'],
};

/**
 * Refuses a fulfilment-status move the table does not permit.
 *
 * Names what the document CAN do from where it is, because a refusal that
 * only says no leaves the user guessing.
 *
 * @param {string} from
 * @param {string} to
 * @param {object} [opts]
 * @param {string} [opts.label]  What to call the document in the message
 * @param {object} [opts.table]  Defaults to FULFILMENT_TRANSITIONS
 */
export function assertStatusTransition(from, to, { label = 'This document', table = FULFILMENT_TRANSITIONS } = {}) {
  if (from === to) return;

  const permitted = table[from];
  if (permitted === undefined) {
    throw ApiError.badRequest(`"${from}" is not a status this document can be in.`, {
      field: 'status',
      from,
    });
  }
  if (!permitted.includes(to)) {
    throw new ApiError(
      409,
      `${label} is ${fmt(from)} and cannot be moved to ${fmt(to)}.` +
        (permitted.length
          ? ` From here it can only go to: ${permitted.map(fmt).join(', ')}.`
          : ' It is finished and moves no further.'),
      {
        code: ERROR_CODES.INVALID_TRANSITION,
        details: { field: 'status', from, to, permitted },
      },
    );
  }
}

/** SCREAMING_SNAKE to something a person can read, for the messages above. */
const fmt = (v) => String(v).replace(/_/g, ' ').toLowerCase();

/** What this document may move its fulfilment status to, for the UI. */
export function allowedStatusesFrom(from, table = FULFILMENT_TRANSITIONS) {
  return (table[from] ?? []).map((to) => ({ to, label: fmt(to) }));
}

// ===========================================================================
//  THE SHARED ACTIONS
// ===========================================================================

/**
 * Hands a document in. DRAFT → SUBMITTED, and straight on to PENDING_APPROVAL
 * when an approver is named.
 *
 * The two-step move is what makes the distinction useful: a document submitted
 * without an approver sits in SUBMITTED, which is a queue somebody has to work.
 */
export async function submit(tx, { documentType, documentId, submittedTo, actor, remarks, data }) {
  const submitted = await transition(tx, {
    documentType,
    documentId,
    to: 'SUBMITTED',
    actor,
    remarks: remarks ?? (submittedTo ? `Submitted to ${submittedTo}` : 'Submitted'),
    data,
  });

  if (!submittedTo) return submitted;

  return transition(tx, {
    documentType,
    documentId,
    to: 'PENDING_APPROVAL',
    actor,
    remarks: `Awaiting ${submittedTo}`,
  });
}

/**
 * Approves.
 *
 * Not terminal: an approved document may still be POSTED or COMPLETED. What it
 * may never do is return to DRAFT - see the note on the transition table.
 */
export async function approve(tx, { documentType, documentId, actor, remarks, data }) {
  return transition(tx, { documentType, documentId, to: 'APPROVED', actor, remarks, data });
}

/**
 * Posts. The document has been written to the ledger and acted on.
 *
 * Some documents reach this without ever being approved - a GRN has no
 * approval step, and posting it IS the act. Others are approved first and then
 * posted, which is two facts and two entries in the trail.
 */
export async function post(tx, { documentType, documentId, actor, remarks, data }) {
  return transition(tx, { documentType, documentId, to: 'POSTED', actor, remarks, data });
}

/** Completes. Terminal - the document has run its course. */
export async function complete(tx, { documentType, documentId, actor, remarks, data }) {
  return transition(tx, { documentType, documentId, to: 'COMPLETED', actor, remarks, data });
}

/** Rejects, with a reason. The reason is required by every caller. */
export async function reject(tx, { documentType, documentId, actor, reason, data }) {
  if (!reason || reason.trim().length < 3) {
    throw ApiError.badRequest('A rejection needs a reason', { field: 'reason' });
  }
  return transition(tx, {
    documentType,
    documentId,
    to: 'REJECTED',
    actor,
    remarks: reason,
    data,
  });
}

/**
 * Starts correcting a rejected document. REJECTED → RECTIFICATION.
 *
 * Recorded as its own state rather than jumping straight back to pending,
 * because "being fixed" and "waiting for a decision" are different situations
 * and different people are waiting on each.
 */
export async function rectify(tx, { documentType, documentId, actor, remarks, data }) {
  return transition(tx, {
    documentType,
    documentId,
    to: 'RECTIFICATION',
    actor,
    remarks: remarks ?? 'Rectification in progress',
    data,
  });
}

/** Sends a corrected document back. RECTIFICATION → RESUBMITTED → PENDING. */
export async function resubmit(tx, { documentType, documentId, submittedTo, actor, remarks, data }) {
  await transition(tx, {
    documentType,
    documentId,
    to: 'RESUBMITTED',
    actor,
    remarks: remarks ?? 'Resubmitted after rectification',
    data,
  });

  return transition(tx, {
    documentType,
    documentId,
    to: 'PENDING_APPROVAL',
    actor,
    remarks: submittedTo ? `Awaiting ${submittedTo}` : 'Awaiting approval',
  });
}

/** Cancels. Terminal from anywhere that is not already terminal. */
export async function cancel(tx, { documentType, documentId, actor, reason, data }) {
  return transition(tx, {
    documentType,
    documentId,
    to: 'CANCELLED',
    actor,
    remarks: reason ?? 'Cancelled',
    data,
  });
}

// ===========================================================================
//  THE APPROVER'S QUEUE
// ===========================================================================

/**
 * Everything waiting on a decision, across every module, in one list.
 *
 * The Director holds *.APPROVE and is the last gate on orders, quotations,
 * purchase orders, plans and scrutinies. Without this they would have to open
 * five screens to find out what is waiting; with it, the answer is one call.
 */
/** The states that mean "somebody has to decide this". */
const PENDING_STATES = ['SUBMITTED', 'PENDING_APPROVAL', 'RESUBMITTED'];

/**
 * How much is waiting, per document type - counted, not fetched.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS EXISTS BESIDE pendingQueue()
 *
 *  `pendingQueue()` returns the rows, because the approval queue screen lists
 *  them. The dashboard does not list them - it shows a count per module and
 *  how long the oldest has waited - and it was getting those by asking for up
 *  to 200 rows of every one of the nine document types and then measuring the
 *  array. That is up to 1,800 rows read, and every column of them, to render
 *  nine numbers.
 *
 *  `count()` and one `findFirst` answer the same question with two cheap
 *  queries per type and no row bodies at all.
 *
 *  Both read the same `PENDING_STATES`, so the dashboard's count and the
 *  queue's list can never disagree about what "waiting" means.
 * ---------------------------------------------------------------------------
 */
export async function pendingSummary({ documentTypes } = {}) {
  const wanted = documentTypes?.length ? documentTypes : Object.keys(REGISTRY);

  const groups = await Promise.all(
    wanted.map(async (documentType) => {
      const cfg = REGISTRY[documentType];
      if (!cfg) return null;

      const where = { workflowState: { in: PENDING_STATES }, deletedAt: null };

      const [count, oldest] = await Promise.all([
        prisma[cfg.model].count({ where }),
        prisma[cfg.model].findFirst({
          where,
          /**
           * By `updatedAt`, because that is what the age below is measured
           * from and what `pendingQueue` sorts its rows by.
           *
           * Ordering by `createdAt` here returned the document raised first
           * and then reported how long ago it was last TOUCHED - so a
           * quotation raised in January and edited this morning was named as
           * the oldest and reported as waiting no time at all, while the one
           * genuinely untouched for forty days went unmentioned. "Waiting"
           * means nobody has moved it, not that it was raised long ago.
           */
          orderBy: { updatedAt: 'asc' },
          select: { id: true, updatedAt: true, createdAt: true, [cfg.numberField]: true },
        }),
      ]);

      if (count === 0) return null;

      const waitingSince = oldest?.updatedAt ?? oldest?.createdAt ?? null;
      return {
        documentType,
        label: cfg.label,
        count,
        oldest: oldest
          ? {
              id: oldest.id,
              documentNo: oldest[cfg.numberField],
              waitingSince,
              ageDays: ageDays(waitingSince),
            }
          : null,
      };
    }),
  );

  const present = groups.filter(Boolean);

  return {
    total: present.reduce((a, g) => a + g.count, 0),
    groups: present,
    /** The oldest thing waiting anywhere, which is usually the real question. */
    oldest: present
      .map((g) => (g.oldest ? { ...g.oldest, documentType: g.documentType, label: g.label } : null))
      .filter(Boolean)
      .sort((a, b) => new Date(a.waitingSince) - new Date(b.waitingSince))[0] ?? null,
  };
}

export async function pendingQueue({ documentTypes, limit = 100 } = {}) {
  const wanted = documentTypes?.length ? documentTypes : Object.keys(REGISTRY);

  const groups = await Promise.all(
    wanted.map(async (documentType) => {
      const cfg = REGISTRY[documentType];
      if (!cfg) return null;

      const rows = await prisma[cfg.model].findMany({
        where: { workflowState: { in: PENDING_STATES }, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });

      return {
        documentType,
        label: cfg.label,
        count: rows.length,
        rows: rows.map((r) => ({
          id: r.id,
          documentNo: r[cfg.numberField],
          state: r.workflowState,
          stateLabel: STATE_LABEL[r.workflowState],
          waitingSince: r.updatedAt ?? r.createdAt,
          /** How long it has sat there, in whole days. */
          ageDays: ageDays(r.updatedAt ?? r.createdAt),
        })),
      };
    }),
  );

  const present = groups.filter((g) => g && g.count > 0);

  return {
    total: present.reduce((a, g) => a + g.count, 0),
    groups: present,
    /** The oldest thing waiting anywhere, which is usually the real question. */
    oldest: present
      .flatMap((g) => g.rows.map((r) => ({ ...r, documentType: g.documentType, label: g.label })))
      .sort((a, b) => new Date(a.waitingSince) - new Date(b.waitingSince))[0] ?? null,
  };
}

// ===========================================================================
//  C8 - STAGE TIMING
// ===========================================================================

/**
 * ---------------------------------------------------------------------------
 *  THE ENGINE ALREADY WRITES THE STAGE EVENTS.
 *
 *  C8 asks for a `document_stage_events` record carrying document type,
 *  document id, from state, to state, actor and timestamp, written by the
 *  approval engine itself "so that every approval-enabled document
 *  automatically receives stage events" and no individual document
 *  implementation has to remember to create one.
 *
 *  `record()` above already writes exactly that, from inside `transition()` -
 *  the only function in this application permitted to move a workflow state.
 *  There is no path by which a document can change state without one.
 *
 *  So `document_stage_events` is a VIEW over `approval_history`, created by
 *  the C8 migration, and the functions below read it. That is the stronger
 *  implementation rather than the cheaper one: a second table would need a
 *  second write on every transition, which is two things that can disagree,
 *  a backfill that can be incomplete, and an "exactly one event per
 *  transition" property that holds only while both writes keep working. A
 *  view cannot drift from its source.
 *
 *  The view is NARROWER than the table on purpose. `approval_history` also
 *  records things that are not transitions - an AMENDED entry, a re-print -
 *  and those carry no from/to pair to measure. Stage timing is about movement.
 * ---------------------------------------------------------------------------
 */

/**
 * Every state transition one document has been through, in order.
 *
 * @param {string} documentType
 * @param {string} documentId
 */
export async function stageEvents(documentType, documentId) {
  return prisma.$queryRaw`
    SELECT "document_type"  AS "documentType",
           "document_id"    AS "documentId",
           "document_no"    AS "documentNo",
           "sequence_no"    AS "sequenceNo",
           "action",
           "from_state"     AS "fromState",
           "to_state"       AS "toState",
           "actor",
           "actor_id"       AS "actorId",
           "occurred_at"    AS "occurredAt",
           "remarks"
      FROM "document_stage_events"
     WHERE "document_type" = ${documentType}::"DocumentType"
       AND "document_id"   = ${documentId}::uuid
     ORDER BY "occurred_at" ASC, "sequence_no" ASC`;
}

/**
 * How long one document spent in each stage it has left.
 *
 * The reportable half of C8. `durationHours` is null for the first transition,
 * because the state a document started in was entered when it was created and
 * the approval trail does not record creation as a transition - reporting that
 * gap as zero would understate every document's first stage.
 */
export async function stageDurations(documentType, documentId) {
  return prisma.$queryRaw`
    SELECT "document_type"    AS "documentType",
           "document_id"      AS "documentId",
           "document_no"      AS "documentNo",
           "sequence_no"      AS "sequenceNo",
           "from_state"       AS "fromState",
           "to_state"         AS "toState",
           "actor",
           "entered_at"       AS "enteredAt",
           "left_at"          AS "leftAt",
           "duration_seconds" AS "durationSeconds",
           "duration_hours"   AS "durationHours"
      FROM "document_stage_durations"
     WHERE "document_type" = ${documentType}::"DocumentType"
       AND "document_id"   = ${documentId}::uuid
     ORDER BY "sequence_no" ASC`;
}

/**
 * Average time spent in each stage, per document type - the report a manager
 * asks for when they want to know where the pipeline is slow.
 *
 * Aggregated in PostgreSQL rather than in Node: the alternative is reading
 * every transition of every document into memory to average nine numbers.
 *
 * @param {object} [filter]
 * @param {string} [filter.documentType]  One type, or every type
 * @param {Date|string} [filter.from]     Only transitions on or after this
 * @param {Date|string} [filter.to]
 */
export async function stageDurationSummary({ documentType, from, to } = {}) {
  const rows = await prisma.$queryRaw`
    SELECT "document_type" AS "documentType",
           "from_state"    AS "fromState",
           "to_state"      AS "toState",
           COUNT(*)::int   AS "transitions",
           ROUND(AVG("duration_hours"), 2) AS "avgHours",
           ROUND(MIN("duration_hours"), 2) AS "minHours",
           ROUND(MAX("duration_hours"), 2) AS "maxHours"
      FROM "document_stage_durations"
     WHERE "duration_hours" IS NOT NULL
       AND (${documentType ?? null}::text IS NULL
            OR "document_type"::text = ${documentType ?? null}::text)
       AND (${from ? new Date(from) : null}::timestamptz IS NULL
            OR "left_at" >= ${from ? new Date(from) : null}::timestamptz)
       AND (${to ? new Date(to) : null}::timestamptz IS NULL
            OR "left_at" <= ${to ? new Date(to) : null}::timestamptz)
     GROUP BY 1, 2, 3
     ORDER BY 1, 2, 3`;

  return {
    filter: { documentType: documentType ?? null, from: from ?? null, to: to ?? null },
    rows: rows.map((r) => ({
      ...r,
      label: `${STATE_LABEL[r.fromState] ?? r.fromState} → ${STATE_LABEL[r.toState] ?? r.toState}`,
      documentTypeLabel: REGISTRY[r.documentType]?.label ?? r.documentType,
    })),
    note:
      'Duration is the time a document sat in the state it then left. The first transition of ' +
      'each document is excluded: the state it started in was entered at creation, which the ' +
      'approval trail does not record as a transition.',
  };
}
