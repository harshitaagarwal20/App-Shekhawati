/**
 * Plan Approval. Sheet: " Plan Approval"
 * (Role Acess - Planning GM; approved by Dinesh Sir).
 *
 * ===========================================================================
 *  VERSION-CONTROLLED, AND AN APPROVED VERSION IS IMMUTABLE
 * ===========================================================================
 *
 * The workbook already works in versions - it has a "Rectification Remarks"
 * column reading "Revised plan v2" - but it keeps them as loose rows sharing an
 * order number. Here the versions are a chain:
 *
 *      PA-003  v1  REJECTED   "Unit 3 overloaded"          locked
 *         │              rectify()
 *         ▼
 *      PA-004  v2  APPROVED                                locked, forever
 *
 * `round` IS the version number. Each version after the first points at the one
 * it replaces through `supersedesId`, so the chain can be walked in either
 * direction rather than inferred from a shared order number, and a unique index
 * on (order, container, round) means one order cannot have two v2s.
 *
 * ---------------------------------------------------------------------------
 *  THE LOCKING RULE, IN ONE PLACE
 *
 *    PENDING              open. Edit it, recall it, decide it.
 *    APPROVED             LOCKED, permanently. A cutting issue can be raised
 *                         against it the moment it is approved, so there is no
 *                         window in which an approved plan can be edited - not
 *                         by an admin, not with a flag.
 *    REJECTED             open until rectified. The GM can still correct the
 *                         record of what was rejected and why.
 *    REJECTED + rectified LOCKED. The successor is where the work went; the
 *                         rejected version becomes history.
 *
 *  There is no `unlock()` in this file. A plan that needs to change after
 *  approval is a NEW version, which is the whole point of versioning it.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError, ERROR_CODES } from '../utils/ApiError.js';
import { OPTIONS_LIMIT, searchFilter } from '../utils/http.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber, peekNumber } from './documentNumber.service.js';
import { assertNotSelfApproval } from '../domain/makerChecker.js';

export const SORTABLE = [
  'approvalNo',
  'submittedDate',
  'approvalStatus',
  'round',
  'approvedDate',
  'createdAt',
];

/*
 * `order.orderNo` is a relation path - see searchFilter(). The order number is
 * a column on this screen, so it has to be one the search can see; without it
 * a search for "SO-00466" emptied a register that had eight rows in it.
 */
const SEARCH = [
  'approvalNo',
  'containerNo',
  'preparedBy',
  'submittedTo',
  'rejectionReason',
  'rectificationRemarks',
  'order.orderNo',
];

const D = (v) => new Prisma.Decimal(v ?? 0);

const INCLUDE = {
  order: {
    select: {
      id: true,
      orderNo: true,
      orderQty: true,
      effectiveQty: true,
      status: true,
      buyerDeliveryDate: true,
      buyer: { select: { id: true, buyerName: true } },
      style: { select: { id: true, styleNo: true, styleDescription: true } },
    },
  },
  planning: {
    select: {
      id: true,
      planNo: true,
      planDepartment: true,
      plannedQty: true,
      plannedCuttingPcs: true,
      approvalStatus: true,
      containerNo: true,
    },
  },
  supersedes: {
    select: {
      id: true,
      approvalNo: true,
      round: true,
      approvalStatus: true,
      rejectionReason: true,
      submittedDate: true,
      decidedAt: true,
    },
  },
  supersededBy: {
    select: {
      id: true,
      approvalNo: true,
      round: true,
      approvalStatus: true,
      submittedDate: true,
    },
  },
  /** C7 - the style this version plans for. */
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  /** C7 - the three plan types this version presents for signature. */
  lines: { where: { deletedAt: null }, orderBy: { planType: 'asc' } },
};

const LIST_INCLUDE = {
  order: { select: { id: true, orderNo: true } },
  planning: { select: { id: true, planNo: true } },
  supersedes: { select: { id: true, approvalNo: true, round: true } },
  style: { select: { id: true, styleNo: true } },
  lines: { where: { deletedAt: null }, select: { id: true, planType: true, plannedQty: true, uom: true } },
};

/** C7 - the three plan types, named once. */
export const PLAN_TYPES = ['CUTTING', 'STITCHING', 'SHIPPING'];

/**
 * What each plan type is, in words, for a screen to render.
 *
 * Every entry says the same thing in a different way, and it is worth saying:
 * these are PLANNING RECORDS. There is no stitching execution in this system
 * and no dispatch. A plan is what the production office signs before the work
 * starts, and this application stops at cutting issue.
 */
export const PLAN_TYPE_META = {
  CUTTING: {
    label: 'Cutting plan',
    describes: 'How many pieces the cutting floor plans to cut, and by when.',
  },
  STITCHING: {
    label: 'Stitching plan',
    describes:
      'How many pieces are planned to be stitched, at which unit, and by when. A PLAN only - ' +
      'this system records no stitching work and has no table that could.',
  },
  SHIPPING: {
    label: 'Shipping plan',
    describes:
      'How many pieces are planned to ship, in which container, and by when. A PLAN only - ' +
      'this system has no dispatch module.',
  },
};

// ===========================================================================
//  THE LOCKING RULE
// ===========================================================================

/**
 * Whether a version is still open, and why not if it is not.
 *
 * One function, so every caller refuses for the same reason and the reason is
 * always the true one.
 */
export function lockState(approval) {
  if (approval.approvalStatus === 'APPROVED') {
    return {
      locked: true,
      reason:
        `Version ${approval.round} was approved on ` +
        `${approval.approvedDate ? new Date(approval.approvedDate).toISOString().slice(0, 10) : 'record'}. ` +
        'An approved plan is immutable - cutting can already have been issued against it. ' +
        'Raise a new version instead.',
    };
  }
  if (approval.approvalStatus === 'REJECTED' && approval.rectifiedAt) {
    return {
      locked: true,
      reason:
        `Version ${approval.round} was rejected and has already been rectified. ` +
        'The work moved on to the version that replaced it.',
    };
  }
  return { locked: false, reason: null };
}

function assertOpen(approval, what = 'changed') {
  const state = lockState(approval);
  if (!state.locked) return;
  throw new ApiError(409, `${approval.approvalNo} cannot be ${what}. ${state.reason}`, {
    code: ERROR_CODES.DOCUMENT_LOCKED,
    details: {
      isLocked: true,
      approvalStatus: approval.approvalStatus,
      version: approval.round,
    },
  });
}

// ===========================================================================
//  VALIDATION HELPERS
// ===========================================================================

// Container No is typed at Planning and carried here. See planning.service.js.
async function validateDropdowns(data) {
  if (data.submittedTo !== undefined) {
    await assertValueInList('AuthorisedBy', data.submittedTo, { field: 'submittedTo' });
  }
}

async function resolveOrder(orderId) {
  const order = await prisma.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, orderNo: true, status: true },
  });
  if (!order) throw ApiError.badRequest('Order does not exist', { field: 'orderId' });
  if (order.status === 'CANCELLED') {
    throw ApiError.badRequest(
      `Order ${order.orderNo} is cancelled - no plan can be approved against it`,
      { field: 'orderId' },
    );
  }
  return order;
}

async function resolvePlanning(planningId) {
  if (!planningId) return null;
  const plan = await prisma.planning.findFirst({
    where: { id: planningId, deletedAt: null },
    select: { id: true, planNo: true, orderId: true, plannedQty: true },
  });
  if (!plan) throw ApiError.badRequest('Plan does not exist', { field: 'planningId' });
  return plan;
}

/** Counts what has been raised on the strength of an approval. */
async function downstreamUsage(planApprovalId) {
  const cuttingIssues = await prisma.cuttingIssue.count({
    where: { planApprovalId, deletedAt: null },
  });
  return { cuttingIssues, total: cuttingIssues };
}

// ===========================================================================
//  PROJECTION
// ===========================================================================

function project(a) {
  if (!a) return a;
  const state = lockState(a);
  return {
    ...a,
    /** `round` is the version number. Named both ways so nobody has to guess. */
    version: a.round,
    isLocked: a.isLocked || state.locked,
    lockReason: state.reason,
    decided: a.approvalStatus !== 'PENDING',
    /** A rejected version that nobody has rectified yet is the one to act on. */
    awaitingRectification: a.approvalStatus === 'REJECTED' && !a.rectifiedAt,
    canRectify: a.approvalStatus === 'REJECTED' && !a.rectifiedAt,

    // --- C7 ---------------------------------------------------------------
    /**
     * Whether this is THE version in force for its style and container.
     *
     * An approved version that is not current has been superseded: it is
     * readable, it is locked, and it authorises nothing further. A screen has
     * to be able to say that plainly, because "approved" alone would read as
     * "in force" and version 1 of a twice-revised plan is not.
     */
    isCurrentVersion: Boolean(a.isCurrent),
    supersededByCurrent: a.approvalStatus === 'APPROVED' && !a.isCurrent,
    demotedAt: a.demotedAt ?? null,
    /** The three plan types on this version, labelled. */
    plans: (a.lines ?? []).map((l) => ({
      ...l,
      label: PLAN_TYPE_META[l.planType]?.label ?? l.planType,
      describes: PLAN_TYPE_META[l.planType]?.describes ?? null,
    })),
    planTypes: (a.lines ?? []).map((l) => l.planType),
  };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    approvalStatus, orderId, planningId, containerNo, isLocked,
    latestOnly, awaitingRectification, dateFrom, dateTo,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(approvalStatus ? { approvalStatus } : {}),
    ...(orderId ? { orderId } : {}),
    ...(planningId ? { planningId } : {}),
    ...(containerNo ? { containerNo } : {}),
    ...(isLocked !== undefined ? { isLocked } : {}),
    // A rejected version nobody has picked up yet.
    ...(awaitingRectification
      ? { approvalStatus: 'REJECTED', rectifiedAt: null }
      : {}),
    // The current version only: nothing has superseded it.
    ...(latestOnly ? { supersededBy: { none: { deletedAt: null } } } : {}),
    ...(dateFrom || dateTo
      ? {
          submittedDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total] = await Promise.all([
    prisma.planApproval.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.planApproval.count({ where }),
  ]);

  return { rows: rows.map(project), total, page, pageSize };
}

export async function getById(id) {
  const approval = await prisma.planApproval.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!approval) throw ApiError.notFound('Plan approval');

  const [usage, history, versions] = await Promise.all([
    downstreamUsage(id),
    prisma.approvalHistory.findMany({
      where: { documentType: 'PLAN_APPROVAL', documentId: id },
      orderBy: { actedAt: 'asc' },
    }),
    versionChain(approval),
  ]);

  const state = lockState(approval);

  return {
    ...project(approval),
    // F-10: read by withApprovability() in the controller, then removed.
    createdById: approval.createdById,
    versions,
    usage,
    history,
    editable: {
      canEdit: !state.locked,
      canDecide: approval.approvalStatus === 'PENDING',
      canRectify: approval.approvalStatus === 'REJECTED' && !approval.rectifiedAt,
      canRecall: approval.approvalStatus === 'PENDING' && usage.total === 0,
      canDelete: approval.approvalStatus === 'PENDING' && usage.total === 0 && approval.round === 1,
      lockReason: state.reason,
    },
  };
}

/**
 * Every version raised for the same order and container, oldest first.
 *
 * The chain is what makes a rejection legible: v1 rejected for this reason, v2
 * rectified in this way and approved. Assembled server-side because it spans
 * the whole history of one plan and no screen should have to reconstruct it.
 */
async function versionChain(approval) {
  const rows = await prisma.planApproval.findMany({
    where: {
      deletedAt: null,
      orderId: approval.orderId,
      containerNo: approval.containerNo,
    },
    orderBy: { round: 'asc' },
    include: LIST_INCLUDE,
  });

  const current = rows.reduce((a, r) => (r.round > a.round ? r : a), rows[0] ?? approval);

  return {
    count: rows.length,
    currentVersion: current.round,
    /** True when the latest version is the one being looked at. */
    isCurrent: current.id === approval.id,
    approvedVersion: rows.find((r) => r.approvalStatus === 'APPROVED')?.round ?? null,
    rows: rows.map((r) => ({
      ...project(r),
      isThisOne: r.id === approval.id,
    })),
  };
}

// ===========================================================================
//  COMMANDS
// ===========================================================================

/**
 * Submits version 1 of a plan for approval.
 *
 * A second version is never created here - `rectify()` is the only way to raise
 * one, because a version that does not say what it replaces is not a version,
 * it is a duplicate.
 */
export async function create(input, actorId) {
  await validateDropdowns(input);

  const order = await resolveOrder(input.orderId);
  const planning = await resolvePlanning(input.planningId);

  if (planning && planning.orderId !== order.id) {
    throw ApiError.badRequest(
      `Plan ${planning.planNo} belongs to a different order.`,
      { field: 'planningId' },
    );
  }

  // One order and container get one open version at a time. Two people
  // submitting the same plan is a race the unique index would catch anyway;
  // this is the message that explains it.
  const existing = await prisma.planApproval.findFirst({
    where: {
      orderId: order.id,
      containerNo: input.containerNo ?? null,
      deletedAt: null,
      supersededBy: { none: { deletedAt: null } },
    },
    select: { approvalNo: true, round: true, approvalStatus: true },
  });
  if (existing) {
    throw ApiError.conflict(
      `${existing.approvalNo} is already version ${existing.round} of the plan for ` +
        `${order.orderNo}${input.containerNo ? ` / ${input.containerNo}` : ''} and is ` +
        `${existing.approvalStatus.toLowerCase()}. ` +
        (existing.approvalStatus === 'REJECTED'
          ? 'Rectify it to raise the next version.'
          : 'Decide it before submitting another.'),
      { existingApprovalNo: existing.approvalNo, version: existing.round },
    );
  }

  const approval = await prisma.$transaction(async (tx) => {
    const approvalNo = input.approvalNo?.trim() || (await nextNumber('PLAN_APPROVAL', { tx }));
    const clash = await tx.planApproval.findUnique({
      where: { approvalNo },
      select: { id: true },
    });
    if (clash) {
      throw ApiError.conflict('This approval number already exists', { field: 'approvalNo' });
    }

    return tx.planApproval.create({
      data: {
        approvalNo,
        submittedDate: input.submittedDate ? new Date(input.submittedDate) : new Date(),
        orderId: order.id,
        /**
         * C7 - plans are style-number-wise as well as container-wise.
         *
         * Defaulted from the order, which names exactly one style, rather than
         * made a required input: every existing caller passes an order and
         * would otherwise break, and the order's style IS the answer in every
         * case the office has today.
         */
        styleId: input.styleId ?? order.styleId,
        containerNo: input.containerNo ?? null,
        /**
         * C7 - THE THREE PLAN TYPES, AS LINES OF ONE VERSIONED HEADER.
         *
         * Cutting, stitching and shipping are presented for one signature.
         * Approving the cutting plan and leaving the shipping plan unsigned is
         * not a state the production office recognises, so they are lines of
         * one document rather than three documents.
         *
         * PLANNING RECORDS ONLY. A STITCHING line says how many pieces are
         * planned and by when. Nothing in this system records work done, and
         * prisma/verify-scope.js carries an explicit allowlist saying so.
         */
        ...(input.plans?.length
          ? {
              lines: {
                create: input.plans.map((plan) => ({
                  planType: plan.planType,
                  plannedQty: D(plan.plannedQty),
                  uom: plan.uom ?? 'Pcs',
                  plannedStart: plan.plannedStart ? new Date(plan.plannedStart) : null,
                  plannedEnd: plan.plannedEnd ? new Date(plan.plannedEnd) : null,
                  plannedUnit: plan.plannedUnit ?? null,
                  remarks: plan.remarks ?? null,
                  createdById: actorId,
                  updatedById: actorId,
                })),
              },
            }
          : {}),
        preparedBy: input.preparedBy,
        submittedTo: input.submittedTo,
        planningId: planning?.id ?? null,
        // Version 1. It replaces nothing, which is what the CHECK on the table
        // insists on for round 1.
        round: 1,
        supersedesId: null,
        approvalStatus: 'PENDING',
        isLocked: false,
        rectificationRemarks: input.rectificationRemarks ?? null,
        preparedById: actorId,
        createdById: actorId,
        updatedById: actorId,
      },
      include: LIST_INCLUDE,
    });
  });

  await recordHistory(approval, 'SUBMITTED', {
    toStatus: 'PENDING',
    actorId,
    remarks:
      `Version 1 submitted to ${input.submittedTo} for ${order.orderNo}` +
      (input.containerNo ? ` / ${input.containerNo}` : ''),
  });

  return project(approval);
}

/** Edits an open version. Refused on an approved one, without exception. */
export async function update(id, input, actorId) {
  const existing = await prisma.planApproval.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw ApiError.notFound('Plan approval');
  assertOpen(existing, 'edited');

  await validateDropdowns(input);
  if (input.planningId !== undefined) await resolvePlanning(input.planningId);

  const approval = await prisma.planApproval.update({
    where: { id },
    data: {
      ...(input.submittedDate !== undefined
        ? { submittedDate: new Date(input.submittedDate) }
        : {}),
      ...(input.containerNo !== undefined ? { containerNo: input.containerNo } : {}),
      ...(input.preparedBy !== undefined ? { preparedBy: input.preparedBy } : {}),
      ...(input.submittedTo !== undefined ? { submittedTo: input.submittedTo } : {}),
      ...(input.planningId !== undefined ? { planningId: input.planningId } : {}),
      ...(input.rectificationRemarks !== undefined
        ? { rectificationRemarks: input.rectificationRemarks }
        : {}),
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  return project(approval);
}

/**
 * Approves the version - and locks it, in the same write.
 *
 * There is no window between "approved" and "locked" in which somebody could
 * edit it, because the two are one update and a CHECK constraint refuses an
 * approved row that is not locked.
 *
 * @param {{userId: string, fullName: string}} actor
 */
export async function approve(id, { remarks }, actor) {
  const approval = await prisma.planApproval.findFirst({
    where: { id, deletedAt: null },
    include: { order: { select: { orderNo: true } } },
  });
  if (!approval) throw ApiError.notFound('Plan approval');

  if (approval.approvalStatus !== 'PENDING') {
    throw ApiError.badRequest(
      `Version ${approval.round} is already ${approval.approvalStatus.toLowerCase()}.`,
    );
  }

  assertNotSelfApproval(approval, actor, 'plan approval');

  const decidedAt = new Date();

  /**
   * C7 - APPROVING VERSION 2 DEMOTES VERSION 1, IN ONE TRANSACTION.
   *
   * "Only one version can be APPROVED for a given style + container. When
   * version 2 is approved: version 1 becomes non-current, remains readable,
   * and must never be modified."
   *
   * The demotion is not a courtesy - `plan_approvals_one_current_approved`, a
   * partial unique index on (style_id, coalesce(container_no,'')) where the row
   * is current and approved, will REFUSE this write if the predecessor has not
   * been demoted. So the two happen together or neither does, and the database
   * is what guarantees it rather than this function remembering.
   *
   * The predecessor keeps `isLocked` and keeps its approval status. It is
   * history, not a mistake: a cutting issue may have been raised against it,
   * and rewriting what was approved would strand that.
   */
  const updated = await prisma.$transaction(async (tx) => {
    const superseded = await tx.planApproval.updateMany({
      where: {
        id: { not: id },
        deletedAt: null,
        isCurrent: true,
        approvalStatus: 'APPROVED',
        styleId: approval.styleId,
        containerNo: approval.containerNo,
      },
      data: {
        isCurrent: false,
        demotedAt: decidedAt,
        demotedById: actor.userId ?? null,
      },
    });

    /*
     * CONDITIONAL ON STILL BEING PENDING, AND `workflowState` MOVES WITH IT.
     *
     * Two things were wrong with the plain `update()` this replaces.
     *
     * The guard above - `approvalStatus !== 'PENDING'` - is read OUTSIDE this
     * transaction, so two approvers deciding the same version at the same
     * moment both passed it and both wrote. Naming the expected status in the
     * WHERE makes the write itself the guard: under READ COMMITTED the second
     * UPDATE waits on the first one's row lock and then re-checks against the
     * committed row, matches nothing, and reports the loss instead of
     * overwriting somebody else's decision.
     *
     * And `workflowState` was never written at all. The approval queue reads
     * that column, so an approved version went on being offered as outstanding
     * work - PA-050 sat in the queue for five days after it was approved. The
     * two columns move in one statement here for the same reason the approval
     * engine writes them together: nothing may set one without the other.
     */
    const claimed = await tx.planApproval.updateMany({
      where: { id, approvalStatus: 'PENDING' },
      data: {
        approvalStatus: 'APPROVED',
        workflowState: 'APPROVED',
        approvedDate: decidedAt,
        decidedAt,
        approvedById: actor.userId,
        approvedByName: actor.fullName,
        rejectionReason: null,
        // C7 - this is now the version in force for its style and container.
        isCurrent: true,
        demotedAt: null,
        demotedById: null,
        // Immutable from this moment. Approval and lock are one write.
        isLocked: true,
        lockedAt: decidedAt,
        updatedById: actor.userId,
      },
    });

    if (claimed.count === 0) {
      throw new ApiError(
        409,
        `Version ${approval.round} was decided by somebody else a moment ago. Your decision was `
        + 'not recorded. Reload it and check what was decided before acting again.',
        { code: ERROR_CODES.CONCURRENT_DECISION },
      );
    }

    const row = await tx.planApproval.findUnique({ where: { id }, include: LIST_INCLUDE });

    if (superseded.count > 0) {
      await recordHistory(row, 'AMENDED', {
        actorId: actor.userId,
        actorName: actor.fullName,
        remarks:
          `Version ${row.round} became current; ${superseded.count} earlier approved ` +
          'version(s) demoted. Demoted versions stay readable and stay locked.',
      });
    }

    return row;
  });

  await recordHistory(updated, 'APPROVED', {
    fromStatus: 'PENDING',
    toStatus: 'APPROVED',
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks: remarks ?? `Version ${approval.round} approved for ${approval.order.orderNo}`,
  });

  return project(updated);
}

/**
 * Rejects the version, with a reason.
 *
 * It is NOT locked yet: the GM may still correct the record of what was
 * rejected. It locks when `rectify()` raises its successor.
 */
export async function reject(id, { reason, rectificationRemarks }, actor) {
  const approval = await prisma.planApproval.findFirst({ where: { id, deletedAt: null } });
  if (!approval) throw ApiError.notFound('Plan approval');

  if (approval.approvalStatus !== 'PENDING') {
    throw ApiError.badRequest(
      `Version ${approval.round} is already ${approval.approvalStatus.toLowerCase()}.`,
    );
  }

  const decidedAt = new Date();

  // Conditional, and both status columns together - see the note in approve().
  const claimed = await prisma.planApproval.updateMany({
    where: { id, approvalStatus: 'PENDING' },
    data: {
      approvalStatus: 'REJECTED',
      workflowState: 'REJECTED',
      rejectionReason: reason,
      rectificationRemarks: rectificationRemarks ?? approval.rectificationRemarks,
      approvedDate: null,
      decidedAt,
      approvedById: actor.userId,
      approvedByName: actor.fullName,
      updatedById: actor.userId,
    },
  });

  if (claimed.count === 0) {
    throw new ApiError(
      409,
      `Version ${approval.round} was decided by somebody else a moment ago. Your decision was `
      + 'not recorded. Reload it and check what was decided before acting again.',
      { code: ERROR_CODES.CONCURRENT_DECISION },
    );
  }

  const updated = await prisma.planApproval.findUnique({ where: { id }, include: LIST_INCLUDE });

  await recordHistory(updated, 'REJECTED', {
    fromStatus: 'PENDING',
    toStatus: 'REJECTED',
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks: reason,
  });

  return project(updated);
}

/**
 * Rectifies a rejected version by raising the next one.
 *
 * ONE TRANSACTION, and the shape of it is the whole feature:
 *
 *   - the rejected version LOCKS and records when it was rectified;
 *   - a NEW row is created at round + 1, pointing back at it;
 *   - the new row starts PENDING, carrying the rectification remarks that say
 *     what was done about the rejection.
 *
 * Nothing about the rejected version is edited. It stays exactly as it was
 * decided, which is what makes the chain worth having.
 *
 * @param {{userId: string, fullName: string}} actor
 */
export async function rectify(id, input, actor) {
  const rejected = await prisma.planApproval.findFirst({
    where: { id, deletedAt: null },
    include: { order: { select: { id: true, orderNo: true, status: true } } },
  });
  if (!rejected) throw ApiError.notFound('Plan approval');

  if (rejected.approvalStatus !== 'REJECTED') {
    throw ApiError.badRequest(
      `Version ${rejected.round} is ${rejected.approvalStatus.toLowerCase()}, not rejected. ` +
        'Only a rejected version is rectified.',
    );
  }
  if (rejected.rectifiedAt) {
    const successor = await prisma.planApproval.findFirst({
      where: { supersedesId: id, deletedAt: null },
      select: { approvalNo: true, round: true, approvalStatus: true },
    });
    throw ApiError.conflict(
      `Version ${rejected.round} has already been rectified` +
        (successor
          ? ` - ${successor.approvalNo} is version ${successor.round} and is ` +
            `${successor.approvalStatus.toLowerCase()}.`
          : '.'),
      { successor },
    );
  }
  if (rejected.order.status === 'CANCELLED') {
    throw ApiError.badRequest(`Order ${rejected.order.orderNo} is cancelled.`);
  }

  await validateDropdowns(input);
  const planning = await resolvePlanning(input.planningId ?? rejected.planningId);

  // C7 - the three plans as the rejected version stated them, so the successor
  // can carry forward the two that were not the problem.
  const previousPlans = await prisma.planApprovalLine.findMany({
    where: { planApprovalId: id, deletedAt: null },
    orderBy: { planType: 'asc' },
  });

  const rectifiedAt = new Date();

  const successor = await prisma.$transaction(async (tx) => {
    const approvalNo = input.approvalNo?.trim() || (await nextNumber('PLAN_APPROVAL', { tx }));
    const clash = await tx.planApproval.findUnique({
      where: { approvalNo },
      select: { id: true },
    });
    if (clash) {
      throw ApiError.conflict('This approval number already exists', { field: 'approvalNo' });
    }

    // The rejected version closes. It is not edited - only stamped as the
    // version that was rectified, and locked so it stays as decided.
    await tx.planApproval.update({
      where: { id },
      data: {
        rectifiedAt,
        isLocked: true,
        lockedAt: rectifiedAt,
        updatedById: actor.userId,
      },
    });

    // The next version. The unique index on (order, container, round) is what
    // stops two people rectifying the same rejection into two version 2s.
    return tx.planApproval.create({
      data: {
        approvalNo,
        submittedDate: input.submittedDate ? new Date(input.submittedDate) : rectifiedAt,
        orderId: rejected.orderId,
        // C7 - the successor plans for the same style. Carried forward rather
        // than re-derived, so a version chain cannot drift onto another style.
        styleId: input.styleId ?? rejected.styleId,
        containerNo: input.containerNo ?? rejected.containerNo,
        preparedBy: input.preparedBy ?? rejected.preparedBy,
        submittedTo: input.submittedTo ?? rejected.submittedTo,
        planningId: planning?.id ?? null,
        round: rejected.round + 1,
        supersedesId: rejected.id,
        approvalStatus: 'PENDING',
        // C7 - a PENDING version is never current. It becomes current when it
        // is approved, and approving it demotes its predecessor in the same
        // transaction.
        isCurrent: false,
        isLocked: false,
        /**
         * C7 - the three plans, carried forward from the version being
         * rectified unless the office restates them.
         *
         * Copied rather than left empty because a rectification usually
         * changes one plan of the three, and forcing the office to retype the
         * other two is how the other two end up wrong.
         */
        ...(input.plans?.length
          ? {
              lines: {
                create: input.plans.map((plan) => ({
                  planType: plan.planType,
                  plannedQty: D(plan.plannedQty),
                  uom: plan.uom ?? 'Pcs',
                  plannedStart: plan.plannedStart ? new Date(plan.plannedStart) : null,
                  plannedEnd: plan.plannedEnd ? new Date(plan.plannedEnd) : null,
                  plannedUnit: plan.plannedUnit ?? null,
                  remarks: plan.remarks ?? null,
                  createdById: actor.userId,
                  updatedById: actor.userId,
                })),
              },
            }
          : previousPlans.length
            ? {
                lines: {
                  create: previousPlans.map((l) => ({
                    planType: l.planType,
                    plannedQty: l.plannedQty,
                    uom: l.uom,
                    plannedStart: l.plannedStart,
                    plannedEnd: l.plannedEnd,
                    plannedUnit: l.plannedUnit,
                    remarks: l.remarks,
                    createdById: actor.userId,
                    updatedById: actor.userId,
                  })),
                },
              }
            : {}),
        // What was actually done about the rejection. The sheet's own column,
        // and the reason this version exists at all.
        rectificationRemarks: input.rectificationRemarks,
        preparedById: actor.userId,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
      include: LIST_INCLUDE,
    });
  });

  await recordHistory(successor, 'SUBMITTED', {
    fromStatus: 'REJECTED',
    toStatus: 'PENDING',
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks:
      `Version ${successor.round} raised to rectify ${rejected.approvalNo} ` +
      `(rejected: ${rejected.rejectionReason}). ${input.rectificationRemarks}`,
  });

  return project(successor);
}

/**
 * Recalls a version before it is decided.
 *
 * A version 1 recall deletes it - nothing was ever built on it. A later version
 * cannot be recalled away, because doing so would leave the rejected version it
 * replaced marked as rectified with nothing to show for it.
 */
export async function recall(id, { reason }, actor) {
  const approval = await prisma.planApproval.findFirst({ where: { id, deletedAt: null } });
  if (!approval) throw ApiError.notFound('Plan approval');

  if (approval.approvalStatus !== 'PENDING') {
    throw ApiError.badRequest(
      `Version ${approval.round} is already ${approval.approvalStatus.toLowerCase()} and cannot ` +
        'be recalled.',
    );
  }
  const usage = await downstreamUsage(id);
  if (usage.cuttingIssues > 0) {
    throw ApiError.conflict(
      `${usage.cuttingIssues} cutting challan(s) reference ${approval.approvalNo}.`,
      { usage },
    );
  }
  if (approval.round > 1) {
    throw ApiError.conflict(
      `Version ${approval.round} was raised to rectify a rejection. Recalling it would leave ` +
        'that rejection marked as rectified with nothing in its place. Let it be decided.',
      { version: approval.round },
    );
  }

  await prisma.planApproval.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedById: actor.userId,
      rectificationRemarks: reason ?? approval.rectificationRemarks,
    },
  });

  await recordHistory(approval, 'CANCELLED', {
    fromStatus: 'PENDING',
    toStatus: 'CANCELLED',
    actorId: actor.userId,
    actorName: actor.fullName,
    remarks: reason ?? 'Recalled before decision',
  });

  return { recalled: true };
}

/** Deletes an undecided version 1. Anything decided stays. */
export async function remove(id, actorId) {
  const approval = await prisma.planApproval.findFirst({ where: { id, deletedAt: null } });
  if (!approval) throw ApiError.notFound('Plan approval');

  if (approval.approvalStatus !== 'PENDING') {
    throw ApiError.conflict(
      `Version ${approval.round} is ${approval.approvalStatus.toLowerCase()}. A decided version ` +
        'is the record of that decision and cannot be deleted.',
    );
  }
  const usage = await downstreamUsage(id);
  if (usage.cuttingIssues > 0) {
    throw ApiError.conflict(
      `${usage.cuttingIssues} cutting challan(s) reference ${approval.approvalNo}.`,
      { usage },
    );
  }
  if (approval.round > 1) {
    throw ApiError.conflict(
      `Version ${approval.round} replaces a rejected version and cannot be deleted.`,
      { version: approval.round },
    );
  }

  await prisma.planApproval.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId },
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
//  Helpers and views
// ---------------------------------------------------------------------------

async function recordHistory(a, action, { fromStatus, toStatus, actorId, actorName, remarks }) {
  const previous = await prisma.approvalHistory.count({
    where: { documentType: 'PLAN_APPROVAL', documentId: a.id },
  });
  await prisma.approvalHistory.create({
    data: {
      documentType: 'PLAN_APPROVAL',
      documentId: a.id,
      documentNo: a.approvalNo,
      sequenceNo: previous + 1,
      action,
      fromStatus: fromStatus ?? null,
      toStatus: toStatus ?? null,
      actedByName: actorName ?? null,
      actedById: actorId ?? null,
      remarks: remarks ?? null,
    },
  });
}

/**
 * The version history for one order, grouped by container.
 *
 * This is the screen a GM opens after a rejection: which containers are
 * approved, which are on their third attempt, and what each rejection said.
 */
export async function forOrder(orderId) {
  const order = await prisma.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      orderNo: true,
      orderQty: true,
      effectiveQty: true,
      status: true,
      buyer: { select: { buyerName: true } },
      style: { select: { styleNo: true } },
    },
  });
  if (!order) throw ApiError.notFound('Order');

  const rows = await prisma.planApproval.findMany({
    where: { orderId, deletedAt: null },
    orderBy: [{ containerNo: 'asc' }, { round: 'asc' }],
    include: LIST_INCLUDE,
  });

  const byContainer = new Map();
  for (const r of rows) {
    const key = r.containerNo ?? '(no container)';
    if (!byContainer.has(key)) byContainer.set(key, []);
    byContainer.get(key).push(project(r));
  }

  return {
    order,
    containers: [...byContainer.entries()].map(([containerNo, versions]) => {
      const current = versions[versions.length - 1];
      const approved = versions.find((v) => v.approvalStatus === 'APPROVED');
      return {
        containerNo,
        versionCount: versions.length,
        currentVersion: current.round,
        currentStatus: current.approvalStatus,
        approvedVersion: approved?.round ?? null,
        /** Cutting can only be issued once a version is approved. */
        cuttingPermitted: Boolean(approved),
        versions,
      };
    }),
  };
}

/** What the next version will be numbered, before it is raised. */
export async function nextVersionFor(id) {
  const rejected = await prisma.planApproval.findFirst({
    where: { id, deletedAt: null },
    include: { order: { select: { orderNo: true } } },
  });
  if (!rejected) throw ApiError.notFound('Plan approval');

  return {
    supersedes: {
      approvalNo: rejected.approvalNo,
      version: rejected.round,
      approvalStatus: rejected.approvalStatus,
      rejectionReason: rejected.rejectionReason,
      rectifiedAt: rejected.rectifiedAt,
    },
    canRectify: rejected.approvalStatus === 'REJECTED' && !rejected.rectifiedAt,
    nextVersion: rejected.round + 1,
    nextApprovalNo: await peekNumber('PLAN_APPROVAL'),
    carriedForward: {
      orderNo: rejected.order.orderNo,
      containerNo: rejected.containerNo,
      preparedBy: rejected.preparedBy,
      submittedTo: rejected.submittedTo,
      planningId: rejected.planningId,
    },
  };
}

/** Approved versions, for the Cutting Issue screen to pick from. */
export async function options({ orderId, approvedOnly } = {}) {
  const rows = await prisma.planApproval.findMany({
    where: {
      deletedAt: null,
      ...(orderId ? { orderId } : {}),
      ...(approvedOnly ? { approvalStatus: 'APPROVED' } : {}),
    },
    orderBy: [{ submittedDate: 'desc' }, { round: 'desc' }],
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      approvalNo: true,
      submittedDate: true,
      containerNo: true,
      round: true,
      approvalStatus: true,
      approvedDate: true,
      order: { select: { id: true, orderNo: true } },
      planning: { select: { id: true, planNo: true, plannedCuttingPcs: true } },
    },
  });
  return rows.map((r) => ({
    ...r,
    version: r.round,
    label: `${r.approvalNo} - ${r.order.orderNo}${r.containerNo ? ` / ${r.containerNo}` : ''} (v${r.round})`,
    plannedCuttingPcs: r.planning ? D(r.planning.plannedCuttingPcs).toFixed(4) : null,
  }));
}
