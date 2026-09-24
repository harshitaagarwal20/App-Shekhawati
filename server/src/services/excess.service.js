/**
 * Excess and wastage control.
 *
 * ===========================================================================
 *  2% IS A DEFAULT, NOT A LAW
 * ===========================================================================
 *
 * The number 2 appears all over the workbook - "2-3%" beside the PO sheet's
 * Excess Allowed column, a 2% receipt variation in the process document, 2-3%
 * shrinkage on a dye lot. Until this module those were constants in service
 * files, which meant a buyer contracted at 5%, or one order agreed at 1%, was a
 * code change and a deployment.
 *
 * There is now no percentage compiled into this application. Every threshold is
 * a row in `excess_rules`, resolved narrowest-scope-first:
 *
 *     ORDER  ►  BUYER  ►  ITEM_CATEGORY  ►  DOCUMENT_TYPE  ►  GLOBAL
 *
 * The seeded rows reproduce the workbook exactly, so nothing behaves
 * differently on day one - and any of them can be changed on a screen.
 *
 * ---------------------------------------------------------------------------
 *  WHAT AN ASSESSMENT SAYS
 *
 *  `assess()` returns every figure the brief asks for, computed once, on the
 *  server, and named the same way everywhere:
 *
 *      baseQty           10,000 pcs   what the excess is measured against
 *      permittedPct      0.02         the resolved threshold
 *      permittedQty      200 pcs      baseQty x permittedPct
 *      maxPermittedQty   10,200 pcs   baseQty + permittedQty
 *      actualQty         10,350 pcs   what is being attempted
 *      actualExcessQty   350 pcs      actualQty - baseQty
 *      actualExcessPct   0.035        actualExcessQty / baseQty
 *      overLimitQty      150 pcs      what an approver is being asked to allow
 *
 *  and one verdict: WITHIN, NEEDS_APPROVAL, or REFUSED.
 *
 *  NOTHING OVER THE LIMIT POSTS WITHOUT AUTHORISATION.
 *
 *  `assertPostable()` is the gate. A transaction over its permitted excess must
 *  carry an APPROVED, unconsumed ExcessApproval whose numbers still match what
 *  is being posted - so an authorisation for 350 pieces cannot be spent on 900,
 *  and cannot be spent twice.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError, ERROR_CODES } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { assertNotSelfApproval } from '../domain/makerChecker.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

export const RULE_SORTABLE = ['scope', 'scopeKey', 'excessPct', 'priority', 'createdAt'];
export const APPROVAL_SORTABLE = ['requestedAt', 'status', 'actualExcessPct', 'overLimitQty'];

/**
 * Scope precedence, narrowest first.
 *
 * An order-specific rule beats a buyer-wide one, which beats a category rule,
 * which beats a document-type rule, which beats the global fallback. Held as an
 * ordered list rather than a set of if-statements so the precedence is
 * inspectable - and so the API can show a user exactly why a given percentage
 * applied.
 */
export const SCOPE_PRECEDENCE = ['ORDER', 'BUYER', 'ITEM_CATEGORY', 'DOCUMENT_TYPE', 'GLOBAL'];

/** The three things an assessment can conclude. */
export const VERDICT = {
  WITHIN: 'WITHIN',
  NEEDS_APPROVAL: 'NEEDS_APPROVAL',
  REFUSED: 'REFUSED',
};

// ===========================================================================
//  RESOLVING THE THRESHOLD
// ===========================================================================

/**
 * Finds the excess rule that governs a transaction.
 *
 * Every candidate is loaded and then sorted by scope precedence, rather than
 * queried five times in sequence, because the answer has to explain itself: the
 * result carries the rule that won AND the ones it beat, so a screen can say
 * "1% applied, because accessories are held tighter than the 3% PO default".
 *
 * @param {object} ctx
 * @param {string} ctx.documentType   A DocumentType enum value
 * @param {string} [ctx.orderId]
 * @param {string} [ctx.buyerId]
 * @param {string} [ctx.itemCategory]
 * @param {Date}   [ctx.on]           Date the rule must be effective on
 */
export async function resolveRule({ documentType, orderId, buyerId, itemCategory, on } = {}) {
  const at = on ?? new Date();

  const candidates = await prisma.excessRule.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      // A rule either names this document type or applies to every type.
      OR: [{ documentType: documentType ?? undefined }, { documentType: null }],
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
      ],
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });

  const keyFor = {
    ORDER: orderId ?? null,
    BUYER: buyerId ?? null,
    ITEM_CATEGORY: itemCategory ?? null,
    DOCUMENT_TYPE: documentType ?? null,
    GLOBAL: '',
  };

  const matching = candidates.filter((r) => {
    const wanted = keyFor[r.scope];
    if (wanted === null || wanted === undefined) return false;
    return r.scopeKey === wanted;
  });

  // Precedence first, then the rule's own priority, then the more specific
  // (document-type-bound) rule over the catch-all one.
  matching.sort((a, b) => {
    const scopeDiff = SCOPE_PRECEDENCE.indexOf(a.scope) - SCOPE_PRECEDENCE.indexOf(b.scope);
    if (scopeDiff !== 0) return scopeDiff;
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (Boolean(a.documentType) !== Boolean(b.documentType)) return a.documentType ? -1 : 1;
    return 0;
  });

  const rule = matching[0] ?? null;
  if (!rule) {
    // Refusing here rather than falling back to a hardcoded number is the whole
    // point of this module: if no rule matches, the configuration is wrong and
    // that is worth saying out loud rather than papering over with a 2%.
    throw ApiError.badRequest(
      `No excess rule is configured for ${documentType ?? 'this transaction'}. ` +
        'At minimum a GLOBAL rule must exist. Check the Excess Rules screen.',
      { documentType, scopesTried: SCOPE_PRECEDENCE },
    );
  }

  return {
    rule,
    /** Why this one, and what it beat. Rendered next to the number on screen. */
    resolution: {
      appliedScope: rule.scope,
      appliedScopeKey: rule.scopeKey,
      appliedPct: D(rule.excessPct).toFixed(6),
      appliedPctDisplay: D(rule.excessPct).mul(100).toDecimalPlaces(2).toFixed(2),
      basis: rule.basis,
      precedence: SCOPE_PRECEDENCE,
      overriddenBy: matching.slice(1).map((r) => ({
        scope: r.scope,
        scopeKey: r.scopeKey,
        excessPct: D(r.excessPct).toFixed(6),
        excessPctDisplay: D(r.excessPct).mul(100).toDecimalPlaces(2).toFixed(2),
        basis: r.basis,
      })),
    },
  };
}

// ===========================================================================
//  THE ASSESSMENT
// ===========================================================================

/**
 * Measures a quantity against its permitted excess.
 *
 * Pure arithmetic once the rule is in hand, and exported separately so it can
 * be unit-tested without a database - which `test/rules.test.js` does.
 *
 * @param {object} args
 * @param {any} args.baseQty       What the excess is measured against
 * @param {any} args.actualQty     What is being attempted
 * @param {any} args.permittedPct  The resolved threshold, as a fraction
 * @param {any} [args.hardCeilingPct] Past this, no approval can help
 * @param {boolean} [args.requiresApproval]
 * @param {string} [args.uom]
 */
export function measure({
  baseQty,
  actualQty,
  permittedPct,
  hardCeilingPct,
  requiresApproval = true,
  uom = '',
}) {
  const base = D(baseQty);
  const actual = D(actualQty);
  const pct = D(permittedPct);

  // baseQty x permittedPct, rounded to the scale the column stores so the
  // CHECK constraint that recomputes it agrees rather than fights.
  const permittedQty = base.mul(pct).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  const maxPermittedQty = base.plus(permittedQty);

  const actualExcessQty = actual.minus(base);
  const actualExcessPct = base.isZero()
    ? ZERO
    : actualExcessQty.div(base).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);

  const overLimitQty = actual.greaterThan(maxPermittedQty)
    ? actual.minus(maxPermittedQty)
    : ZERO;

  const ceiling = hardCeilingPct === null || hardCeilingPct === undefined ? null : D(hardCeilingPct);
  const beyondCeiling = ceiling !== null && actualExcessPct.greaterThan(ceiling);

  let verdict;
  if (overLimitQty.isZero()) {
    verdict = VERDICT.WITHIN;
  } else if (beyondCeiling) {
    verdict = VERDICT.REFUSED;
  } else if (requiresApproval) {
    verdict = VERDICT.NEEDS_APPROVAL;
  } else {
    // The threshold is advisory: report it, do not block on it. Job-work
    // shrinkage works this way - an out-of-tolerance return goes to scrutiny
    // rather than being refused, because the fabric is already back.
    verdict = VERDICT.WITHIN;
  }

  return {
    baseQty: base.toFixed(4),
    permittedPct: pct.toFixed(6),
    permittedPctDisplay: pct.mul(100).toDecimalPlaces(2).toFixed(2),
    permittedQty: permittedQty.toFixed(4),
    maxPermittedQty: maxPermittedQty.toFixed(4),
    actualQty: actual.toFixed(4),
    actualExcessQty: actualExcessQty.toFixed(4),
    actualExcessPct: actualExcessPct.toFixed(6),
    actualExcessPctDisplay: actualExcessPct.mul(100).toDecimalPlaces(2).toFixed(2),
    overLimitQty: overLimitQty.toFixed(4),
    hardCeilingPct: ceiling === null ? null : ceiling.toFixed(6),
    hardCeilingPctDisplay:
      ceiling === null ? null : ceiling.mul(100).toDecimalPlaces(2).toFixed(2),
    beyondCeiling,
    requiresApproval,
    verdict,
    within: verdict === VERDICT.WITHIN,
    needsApproval: verdict === VERDICT.NEEDS_APPROVAL,
    refused: verdict === VERDICT.REFUSED,
    uom,
    /** The worked example, in the office's own words. */
    explanation:
      `${base.toFixed(2)} ${uom} + ${pct.mul(100).toDecimalPlaces(2)}% ` +
      `(${permittedQty.toFixed(2)}) = ${maxPermittedQty.toFixed(2)} ${uom} permitted; ` +
      `${actual.toFixed(2)} attempted` +
      (overLimitQty.isZero() ? '.' : ` - ${overLimitQty.toFixed(2)} over.`),
  };
}

/**
 * Resolves the rule and measures against it, in one call.
 *
 * This is what every module uses. The verdict it returns is the same verdict
 * `assertPostable()` will enforce, so a preview and a post can never differ.
 */
export async function assess({
  documentType,
  orderId,
  buyerId,
  itemCategory,
  baseQty,
  actualQty,
  uom,
  on,
}) {
  const { rule, resolution } = await resolveRule({
    documentType,
    orderId,
    buyerId,
    itemCategory,
    on,
  });

  const measurement = measure({
    baseQty,
    actualQty,
    permittedPct: rule.excessPct,
    hardCeilingPct: rule.hardCeilingPct,
    requiresApproval: rule.requiresApproval,
    uom,
  });

  return {
    ...measurement,
    documentType,
    rule: {
      id: rule.id,
      scope: rule.scope,
      scopeKey: rule.scopeKey,
      basis: rule.basis,
      requiresApproval: rule.requiresApproval,
    },
    resolution,
  };
}

// ===========================================================================
//  THE GATE
// ===========================================================================

/**
 * Refuses a transaction that exceeds its permitted excess without authority.
 *
 * Called inside the posting transaction of every module that can breach a
 * threshold. Pass the id of an approved ExcessApproval to spend it; the
 * approval is checked against the numbers actually being posted, so one raised
 * for 350 pieces cannot quietly authorise 900.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} assessment  The result of assess()
 * @param {object} opts
 * @param {string} [opts.excessApprovalId]
 * @param {string} [opts.label]  What the caller is posting, for the message
 * @returns {Promise<object|null>} The approval that was spent, if any
 */
export async function assertPostable(tx, assessment, { excessApprovalId, label = 'This transaction' } = {}) {
  if (assessment.within) return null;

  if (assessment.refused) {
    throw new ApiError(
      409,
      `${label} is ${assessment.actualExcessPctDisplay}% over the base quantity, past the ` +
        `${assessment.hardCeilingPctDisplay}% ceiling this rule allows. No authorisation can ` +
        'permit it - the quantity has to come down.',
      {
        code: ERROR_CODES.EXCESS_BEYOND_CEILING,
        details: { field: 'qty', excess: assessment, requiresAmendment: true },
      },
    );
  }

  if (!excessApprovalId) {
    throw new ApiError(
      409,
      `${label} exceeds the permitted quantity by ${assessment.overLimitQty} ${assessment.uom}. ` +
        `${assessment.baseQty} plus ${assessment.permittedPctDisplay}% permits ` +
        `${assessment.maxPermittedQty}; ${assessment.actualQty} is being posted. ` +
        'Raise an excess authorisation and have it approved first.',
      {
        code: ERROR_CODES.EXCESS_APPROVAL_REQUIRED,
        details: { field: 'qty', excess: assessment, requiresExcessApproval: true },
      },
    );
  }

  const approval = await tx.excessApproval.findUnique({ where: { id: excessApprovalId } });
  if (!approval) {
    throw ApiError.badRequest('Excess authorisation does not exist', {
      field: 'excessApprovalId',
    });
  }
  if (approval.status !== 'APPROVED') {
    throw ApiError.conflict(
      `Excess authorisation is ${approval.status.toLowerCase()}. Only an approved authorisation ` +
        'permits an over-limit transaction.',
      { field: 'excessApprovalId', status: approval.status },
    );
  }
  if (approval.consumedAt) {
    throw ApiError.conflict(
      'That excess authorisation has already been used on another transaction. ' +
        'One authorisation, one transaction.',
      { field: 'excessApprovalId', consumedAt: approval.consumedAt },
    );
  }
  if (approval.documentType !== assessment.documentType) {
    throw ApiError.conflict(
      `That excess authorisation was raised for a ${approval.documentType.replace(/_/g, ' ').toLowerCase()}.`,
      { field: 'excessApprovalId' },
    );
  }

  // The authorisation has to cover what is actually being posted. Approving 350
  // pieces of excess does not authorise 900, and a base quantity that has moved
  // since means the approver was looking at a different transaction.
  if (D(approval.actualQty).lessThan(D(assessment.actualQty))) {
    throw ApiError.conflict(
      `The excess authorisation covers ${D(approval.actualQty).toFixed(4)} ${approval.uom}, ` +
        `but ${assessment.actualQty} is being posted. Raise a fresh authorisation for the ` +
        'quantity you mean.',
      {
        field: 'excessApprovalId',
        authorisedQty: D(approval.actualQty).toFixed(4),
        postingQty: assessment.actualQty,
      },
    );
  }
  if (!D(approval.baseQty).equals(D(assessment.baseQty))) {
    throw ApiError.conflict(
      `The base quantity has changed since the excess was authorised ` +
        `(${D(approval.baseQty).toFixed(4)} then, ${assessment.baseQty} now). ` +
        'The approver decided on different numbers. Raise a fresh authorisation.',
      { field: 'excessApprovalId' },
    );
  }

  return approval;
}

/** Marks an authorisation as spent, inside the transaction that spent it. */
export async function consume(tx, approvalId, { documentId, documentNo }) {
  if (!approvalId) return null;
  return tx.excessApproval.update({
    where: { id: approvalId },
    data: { consumedAt: new Date(), documentId, documentNo },
  });
}

// ===========================================================================
//  THE AUTHORISATION REQUEST
// ===========================================================================

/**
 * Raises an excess authorisation request.
 *
 * The row is written when the excess is DETECTED, not when it is approved, so
 * an over-limit transaction that was refused still leaves a trace of having
 * been attempted - which is the difference between a control and a formality.
 *
 * @param {{userId: string, fullName: string}} actor
 */
export async function request(input, actor) {
  const assessment = await assess({
    documentType: input.documentType,
    orderId: input.orderId,
    buyerId: input.buyerId,
    itemCategory: input.itemCategory,
    baseQty: input.baseQty,
    actualQty: input.actualQty,
    uom: input.uom,
  });

  if (assessment.within) {
    throw ApiError.badRequest(
      `${assessment.actualQty} ${assessment.uom ?? ''} is within the permitted ` +
        `${assessment.maxPermittedQty}. No authorisation is needed.`,
      { excess: assessment },
    );
  }
  if (assessment.refused) {
    throw ApiError.conflict(
      `${assessment.actualExcessPctDisplay}% is past the ${assessment.hardCeilingPctDisplay}% ` +
        'ceiling this rule allows. No authorisation can permit it.',
      { excess: assessment },
    );
  }

  return prisma.excessApproval.create({
    data: {
      documentType: input.documentType,
      documentId: input.documentId ?? null,
      documentNo: input.documentNo ?? null,
      orderId: input.orderId ?? null,
      ruleId: assessment.rule.id,
      // Snapshotted: a rule can be edited later, and what was authorised must
      // keep saying what it was authorised against.
      ruleBasis: assessment.rule.basis,
      baseQty: D(assessment.baseQty),
      permittedPct: D(assessment.permittedPct),
      permittedQty: D(assessment.permittedQty),
      maxPermittedQty: D(assessment.maxPermittedQty),
      actualQty: D(assessment.actualQty),
      actualExcessQty: D(assessment.actualExcessQty),
      actualExcessPct: D(assessment.actualExcessPct),
      overLimitQty: D(assessment.overLimitQty),
      uom: input.uom ?? '',
      status: 'PENDING',
      reason: input.reason,
      requestedById: actor.userId,
      requestedByName: actor.fullName,
    },
  });
}

/** The Director's decision on an excess request. */
export async function approveRequest(id, { remarks }, actor) {
  const req = await prisma.excessApproval.findUnique({ where: { id } });
  if (!req) throw ApiError.notFound('Excess authorisation');
  if (req.status !== 'PENDING') {
    throw ApiError.badRequest(`This request is already ${req.status.toLowerCase()}.`);
  }

  /*
   * MAKER-CHECKER. Asking for permission to exceed a limit and granting it are
   * necessarily two people - an excess authorised by the person who wanted it
   * is not an authorisation at all, it is a note.
   *
   * `excess_approvals` records its author as `requestedById`, not
   * `createdById`, so the row is adapted rather than passed straight in.
   * Handing the helper a row whose author field it does not recognise would
   * read `undefined`, and `assertNotSelfApproval()` treats an unknown maker as
   * "we do not know" and stays silent - so the check would have passed always
   * while looking exactly like it was working.
   */
  assertNotSelfApproval({ createdById: req.requestedById }, actor, 'excess request');

  const decidedAt = new Date();
  return prisma.excessApproval.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approvedById: actor.userId,
      approvedByName: actor.fullName,
      approvedAt: decidedAt,
      decidedAt,
      decisionRemarks: remarks ?? null,
      rejectionReason: null,
    },
  });
}

export async function rejectRequest(id, { reason }, actor) {
  const req = await prisma.excessApproval.findUnique({ where: { id } });
  if (!req) throw ApiError.notFound('Excess authorisation');
  if (req.status !== 'PENDING') {
    throw ApiError.badRequest(`This request is already ${req.status.toLowerCase()}.`);
  }

  const decidedAt = new Date();
  return prisma.excessApproval.update({
    where: { id },
    data: {
      status: 'REJECTED',
      approvedById: actor.userId,
      approvedByName: actor.fullName,
      approvedAt: null,
      decidedAt,
      rejectionReason: reason,
    },
  });
}

// ===========================================================================
//  RULE ADMINISTRATION
// ===========================================================================

export async function listRules(query) {
  const { page, pageSize, skip, take, orderBy, search, scope, documentType, isActive } = query;

  const where = {
    deletedAt: null,
    ...(scope ? { scope } : {}),
    ...(documentType ? { documentType } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
    ...searchFilter(search, ['scopeKey', 'basis']),
  };

  const [rows, total] = await Promise.all([
    prisma.excessRule.findMany({ where, orderBy, skip, take }),
    prisma.excessRule.count({ where }),
  ]);

  return { rows: rows.map(projectRule), total, page, pageSize };
}

function projectRule(r) {
  return {
    ...r,
    excessPctDisplay: D(r.excessPct).mul(100).toDecimalPlaces(2).toFixed(2),
    hardCeilingPctDisplay:
      r.hardCeilingPct === null ? null : D(r.hardCeilingPct).mul(100).toDecimalPlaces(2).toFixed(2),
    precedenceRank: SCOPE_PRECEDENCE.indexOf(r.scope),
  };
}

export async function createRule(input, actorId) {
  assertRuleShape(input);

  const clash = await prisma.excessRule.findFirst({
    where: {
      scope: input.scope,
      scopeKey: input.scopeKey ?? '',
      documentType: input.documentType ?? null,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (clash) {
    throw ApiError.conflict(
      'A rule already exists for that scope, key and document type. Edit it instead.',
      { existingRuleId: clash.id },
    );
  }

  return projectRule(
    await prisma.excessRule.create({
      data: {
        scope: input.scope,
        scopeKey: input.scope === 'GLOBAL' ? '' : input.scopeKey,
        documentType: input.documentType ?? null,
        excessPct: D(input.excessPct),
        hardCeilingPct:
          input.hardCeilingPct === null || input.hardCeilingPct === undefined
            ? null
            : D(input.hardCeilingPct),
        requiresApproval: input.requiresApproval ?? true,
        basis: input.basis ?? null,
        priority: input.priority ?? 0,
        isActive: input.isActive ?? true,
        effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null,
        effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
        createdById: actorId,
        updatedById: actorId,
      },
    }),
  );
}

export async function updateRule(id, input, actorId) {
  const rule = await prisma.excessRule.findFirst({ where: { id, deletedAt: null } });
  if (!rule) throw ApiError.notFound('Excess rule');

  assertRuleShape({ ...rule, ...input });

  return projectRule(
    await prisma.excessRule.update({
      where: { id },
      data: {
        ...(input.excessPct !== undefined ? { excessPct: D(input.excessPct) } : {}),
        ...(input.hardCeilingPct !== undefined
          ? {
              hardCeilingPct:
                input.hardCeilingPct === null ? null : D(input.hardCeilingPct),
            }
          : {}),
        ...(input.requiresApproval !== undefined
          ? { requiresApproval: input.requiresApproval }
          : {}),
        ...(input.basis !== undefined ? { basis: input.basis } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.effectiveFrom !== undefined
          ? { effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null }
          : {}),
        ...(input.effectiveTo !== undefined
          ? { effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null }
          : {}),
        updatedById: actorId,
      },
    }),
  );
}

/**
 * The GLOBAL rule is the fallback everything else falls back to. Deleting it
 * would leave transactions with no threshold at all, which `resolveRule()`
 * refuses rather than papering over - so it is refused here, where the message
 * can be useful.
 */
export async function removeRule(id, actorId) {
  const rule = await prisma.excessRule.findFirst({ where: { id, deletedAt: null } });
  if (!rule) throw ApiError.notFound('Excess rule');

  if (rule.scope === 'GLOBAL') {
    throw ApiError.conflict(
      'The global rule is the fallback every other rule falls back to. It can be changed, but ' +
        'not removed - without it, transactions would have no threshold at all.',
    );
  }

  await prisma.excessRule.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId, isActive: false },
  });
  return { deleted: true };
}

function assertRuleShape(input) {
  const pct = D(input.excessPct);
  if (pct.isNegative() || pct.greaterThanOrEqualTo(1)) {
    throw ApiError.badRequest('Excess must be a fraction between 0 and 1 (0.02 = 2%)', {
      field: 'excessPct',
    });
  }
  if (input.hardCeilingPct !== null && input.hardCeilingPct !== undefined) {
    const ceiling = D(input.hardCeilingPct);
    if (ceiling.lessThan(pct)) {
      throw ApiError.badRequest(
        'A hard ceiling below the permitted excess would refuse transactions the same rule ' +
          'says are fine. It has to be the wider of the two.',
        { field: 'hardCeilingPct' },
      );
    }
  }
  if (input.scope !== 'GLOBAL' && !input.scopeKey) {
    throw ApiError.badRequest(`A ${input.scope} rule needs a scope key`, { field: 'scopeKey' });
  }
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function listApprovals(query) {
  const { page, pageSize, skip, take, orderBy, search, status, documentType, orderId, pendingOnly } = query;

  const where = {
    ...(status ? { status } : {}),
    ...(pendingOnly ? { status: 'PENDING' } : {}),
    ...(documentType ? { documentType } : {}),
    ...(orderId ? { orderId } : {}),
    ...searchFilter(search, ['documentNo', 'reason', 'requestedByName']),
  };

  const [rows, total] = await Promise.all([
    prisma.excessApproval.findMany({
      where,
      orderBy,
      skip,
      take,
      include: { order: { select: { id: true, orderNo: true } } },
    }),
    prisma.excessApproval.count({ where }),
  ]);

  return { rows: rows.map(projectApproval), total, page, pageSize };
}

function projectApproval(a) {
  return {
    ...a,
    permittedPctDisplay: D(a.permittedPct).mul(100).toDecimalPlaces(2).toFixed(2),
    actualExcessPctDisplay: D(a.actualExcessPct).mul(100).toDecimalPlaces(2).toFixed(2),
    consumed: Boolean(a.consumedAt),
    /** The worked example, restated so no screen recomputes it. */
    explanation:
      `${D(a.baseQty).toFixed(2)} ${a.uom} + ` +
      `${D(a.permittedPct).mul(100).toDecimalPlaces(2)}% (${D(a.permittedQty).toFixed(2)}) = ` +
      `${D(a.maxPermittedQty).toFixed(2)} permitted; ${D(a.actualQty).toFixed(2)} requested - ` +
      `${D(a.overLimitQty).toFixed(2)} over.`,
  };
}

export async function getApproval(id) {
  const approval = await prisma.excessApproval.findUnique({
    where: { id },
    include: { order: { select: { id: true, orderNo: true } } },
  });
  if (!approval) throw ApiError.notFound('Excess authorisation');
  return projectApproval(approval);
}

/** The scopes and the precedence, for the rules screen to render honestly. */
export function scopes() {
  return SCOPE_PRECEDENCE.map((scope, rank) => ({
    scope,
    rank,
    beats: SCOPE_PRECEDENCE.slice(rank + 1),
    keyMeaning: {
      ORDER: 'A buyer order id. The narrowest scope, and the one that always wins.',
      BUYER: 'A buyer id. Applies to every order that buyer places.',
      ITEM_CATEGORY: 'An L_ItemCategory value, e.g. "Accessories".',
      DOCUMENT_TYPE: 'A DocumentType name, e.g. "PURCHASE_ORDER".',
      GLOBAL: 'No key. The fallback that applies when nothing more specific matches.',
    }[scope],
  }));
}
