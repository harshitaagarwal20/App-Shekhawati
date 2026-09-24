/**
 * C2 / C3 - THE TOLERANCE MASTERS, AND THE ONE PLACE THEY ARE RESOLVED.
 *
 * ===========================================================================
 *  NOTHING HERE INVENTS A PERCENTAGE
 * ===========================================================================
 *
 * Three masters now carry the numbers this application used to compile in:
 *
 *   tolerance_rules   per item category, date-versioned - what may be ORDERED
 *                     over the requirement, and what may be RECEIVED over the
 *                     order (cumulatively)
 *   shrinkage_rules   per job-work process and optionally per vendor,
 *                     date-versioned - what may be lost on a job-work return
 *   excess_rules      the pre-existing master behind the excess-AUTHORISATION
 *                     workflow, untouched
 *
 * ---------------------------------------------------------------------------
 *  THE FALLBACK, AND WHY IT IS NOT A DEFAULT
 *
 *  The C2 brief specifies accessories at 1% order / 5% receipt and says, in
 *  terms, not to assume figures for FABRIC or PACKAGING that are absent from
 *  the approved master. So `tolerance_rules` holds one row.
 *
 *  A fabric purchase order still has to be judged by something. What it is
 *  judged by is the rule that has been in force all along and IS approved -
 *  the DOCUMENT_TYPE-scoped `excess_rules` entries (purchase order 3%, GRN
 *  2%), which the office has been running on since Phase 17.
 *
 *  That is a deliberate, visible fallback, not a default. The resolution names
 *  its source, `gaps()` lists every category still without an explicit rule,
 *  and `GET /api/tolerances/gaps` puts it on a screen. What does NOT happen is
 *  a number appearing from a constant in a service file, which is what this
 *  module exists to end.
 *
 *  If neither master answers, resolution THROWS. A missing tolerance is a
 *  configuration problem worth stopping for, not something to paper over.
 *
 *  ---------------------------------------------------------------------------
 *  RESOLVE ONCE, PERSIST, NEVER RE-RESOLVE
 *
 *  A purchase order is received against for weeks. If the GRN re-resolved the
 *  receipt tolerance on the day the lorry arrived, an edit to the master in
 *  between would change the rules mid-flight. So the PO freezes BOTH
 *  tolerances at creation and the GRN reads them off the order. This module is
 *  called at document creation and essentially never afterwards, which is the
 *  point.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { ITEM_CATEGORIES, CATEGORY_LABEL, mappingByCategory } from '../domain/itemCategory.js';
import * as excess from './excess.service.js';

const D = (v) => new Prisma.Decimal(v ?? 0);

export const TOLERANCE_SORTABLE = ['category', 'effectiveFrom', 'orderTolerancePct', 'createdAt'];
export const SHRINKAGE_SORTABLE = ['process', 'effectiveFrom', 'shrinkageTolerancePct', 'createdAt'];

/** Where a resolved tolerance came from. Reported alongside every number. */
export const TOLERANCE_SOURCE = {
  /** An explicit, date-versioned row in tolerance_rules. */
  CATEGORY_MASTER: 'CATEGORY_MASTER',
  /** The approved excess_rules entry that has been in force all along. */
  EXCESS_RULE_FALLBACK: 'EXCESS_RULE_FALLBACK',
};

const pct = (v) => ({
  fraction: D(v).toFixed(6),
  display: D(v).mul(100).toDecimalPlaces(4).toFixed(2),
});

// ===========================================================================
//  RESOLVING A CATEGORY TOLERANCE
// ===========================================================================

/**
 * The tolerance_rules version in force for a category on a given date.
 *
 * "In force" means the row with the latest `effectiveFrom` on or before the
 * date, still active, not closed before it, not deleted. Resolved by date
 * rather than by "the newest row" so that a historical document reproduces the
 * verdict it was actually given - which is the whole reason the table is
 * versioned.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 * @param {'FABRIC'|'ACCESSORIES'|'PACKAGING'} category
 * @param {Date|string} [on]
 */
export async function versionFor(tx, category, on) {
  const client = tx ?? prisma;
  const at = on ? new Date(on) : new Date();

  return client.toleranceRule.findFirst({
    where: {
      category,
      isActive: true,
      deletedAt: null,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
}

/**
 * THE resolver. Returns both tolerances for a category, and says where each
 * came from.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 * @param {object} args
 * @param {'FABRIC'|'ACCESSORIES'|'PACKAGING'} args.category
 * @param {Date|string} [args.on]        Document date the rule must be effective on
 * @param {string} [args.orderId]        For the excess_rules fallback's scope precedence
 * @param {string} [args.buyerId]
 * @param {string} [args.itemCategory]   The open L_ItemCategory value, for the fallback
 */
export async function resolveCategoryTolerance(
  tx,
  { category, on, orderId, buyerId, itemCategory } = {},
) {
  if (!ITEM_CATEGORIES.includes(category)) {
    throw ApiError.badRequest(
      `"${category}" is not a purchase category. Expected one of ${ITEM_CATEGORIES.join(' / ')}.`,
      { field: 'category', allowed: ITEM_CATEGORIES },
    );
  }

  const at = on ? new Date(on) : new Date();
  const version = await versionFor(tx, category, at);

  if (version) {
    return {
      category,
      categoryLabel: CATEGORY_LABEL[category],
      on: at,
      source: TOLERANCE_SOURCE.CATEGORY_MASTER,
      ruleId: version.id,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
      orderTolerance: D(version.orderTolerancePct),
      receiptTolerance: D(version.receiptTolerancePct),
      orderTolerancePct: pct(version.orderTolerancePct),
      receiptTolerancePct: pct(version.receiptTolerancePct),
      basis: version.basis,
      isFallback: false,
    };
  }

  // ---- The approved fallback --------------------------------------------
  //
  // Two separate resolutions, because the order tolerance and the receipt
  // tolerance live on different document types in excess_rules and the office
  // has always set them independently.
  const [order, receipt] = await Promise.all([
    excess.resolveRule({
      documentType: 'PURCHASE_ORDER',
      orderId,
      buyerId,
      itemCategory: itemCategory ?? null,
      on: at,
    }),
    excess.resolveRule({
      documentType: 'GRN',
      orderId,
      buyerId,
      itemCategory: itemCategory ?? null,
      on: at,
    }),
  ]);

  return {
    category,
    categoryLabel: CATEGORY_LABEL[category],
    on: at,
    source: TOLERANCE_SOURCE.EXCESS_RULE_FALLBACK,
    ruleId: null,
    effectiveFrom: null,
    effectiveTo: null,
    orderTolerance: D(order.rule.excessPct),
    receiptTolerance: D(receipt.rule.excessPct),
    orderTolerancePct: pct(order.rule.excessPct),
    receiptTolerancePct: pct(receipt.rule.excessPct),
    basis:
      `No ${CATEGORY_LABEL[category]} version exists in the tolerance master, so the ` +
      `approved excess rules in force were applied: order ` +
      `${pct(order.rule.excessPct).display}% (${order.resolution.appliedScope}` +
      `${order.resolution.appliedScopeKey ? `/${order.resolution.appliedScopeKey}` : ''}), ` +
      `receipt ${pct(receipt.rule.excessPct).display}% (${receipt.resolution.appliedScope}` +
      `${receipt.resolution.appliedScopeKey ? `/${receipt.resolution.appliedScopeKey}` : ''}).`,
    isFallback: true,
    fallbackDetail: { order: order.resolution, receipt: receipt.resolution },
  };
}

/**
 * Every category with no explicit version in the tolerance master.
 *
 * C2: "Report missing values instead of inventing them." This is the report.
 * Exposed on the API and rendered on the tolerance screen, so a gap is a thing
 * somebody can see and close rather than a silent fallback nobody knows about.
 */
export async function gaps({ on } = {}) {
  const at = on ? new Date(on) : new Date();
  const mapping = mappingByCategory();

  const rows = await Promise.all(
    ITEM_CATEGORIES.map(async (category) => {
      const version = await versionFor(null, category, at);
      return {
        category,
        label: CATEGORY_LABEL[category],
        /** The L_ItemCategory dropdown values this category governs. */
        coversDropdownValues: mapping[category] ?? [],
        hasExplicitRule: Boolean(version),
        effectiveFrom: version?.effectiveFrom ?? null,
        orderTolerancePct: version ? pct(version.orderTolerancePct) : null,
        receiptTolerancePct: version ? pct(version.receiptTolerancePct) : null,
        basis: version?.basis ?? null,
      };
    }),
  );

  const missing = rows.filter((r) => !r.hasExplicitRule);

  return {
    on: at,
    categories: rows,
    missing: missing.map((r) => r.category),
    complete: missing.length === 0,
    note: missing.length
      ? `${missing.map((r) => r.label).join(' and ')} ${missing.length === 1 ? 'has' : 'have'} no ` +
        'version in the tolerance master. Documents in these categories are being judged by the ' +
        'approved excess rules that were already in force; no figure has been assumed. Set an ' +
        'explicit version to close the gap.'
      : 'Every purchase category has an explicit, dated tolerance version.',
  };
}

// ===========================================================================
//  SHRINKAGE  (C3)
// ===========================================================================

/**
 * The shrinkage tolerance for a job-work lot: process-wide, or the job
 * worker's own where one has been agreed.
 *
 * Vendor beats process, and within either, the latest version effective on the
 * date wins. Same precedence idea as `excess.resolveRule()`, and deliberately
 * so - a user who has learned one has learned both.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 * @param {object} args
 * @param {string} args.process    A JobWorkProcess enum value
 * @param {string} [args.vendorId]
 * @param {Date|string} [args.on]
 */
export async function resolveShrinkage(tx, { process, vendorId, on } = {}) {
  const client = tx ?? prisma;
  const at = on ? new Date(on) : new Date();

  const candidates = await client.shrinkageRule.findMany({
    where: {
      process,
      isActive: true,
      deletedAt: null,
      effectiveFrom: { lte: at },
      // Still open, or closed on or after the date asked about.
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      // This job worker's own rule, or the process-wide one. Which of the two
      // wins is decided below, not here - the query fetches both so the
      // resolution can explain what it beat.
      AND: [{ OR: [{ vendorId: vendorId ?? null }, { vendorId: null }] }],
    },
    orderBy: { effectiveFrom: 'desc' },
    include: { vendor: { select: { id: true, vendorName: true } } },
  });

  // Vendor-specific first, then the process-wide standard. Within each, the
  // findMany above has already put the newest effective version first.
  const rule =
    candidates.find((r) => r.vendorId && r.vendorId === vendorId) ??
    candidates.find((r) => !r.vendorId) ??
    null;

  if (!rule) {
    throw ApiError.badRequest(
      `No shrinkage tolerance is configured for ${String(process).toLowerCase()}` +
        `${vendorId ? ' at this job worker' : ''} as at ${at.toISOString().slice(0, 10)}. ` +
        'A job work order cannot be raised without one - see the Shrinkage Rules screen. ' +
        'No figure is assumed.',
      { field: 'process', process, vendorId: vendorId ?? null },
    );
  }

  return {
    process,
    ruleId: rule.id,
    tolerance: D(rule.shrinkageTolerancePct),
    tolerancePct: pct(rule.shrinkageTolerancePct),
    scope: rule.vendorId ? 'VENDOR' : 'PROCESS',
    vendorId: rule.vendorId,
    vendorName: rule.vendor?.vendorName ?? null,
    effectiveFrom: rule.effectiveFrom,
    basis: rule.basis,
    /** So a screen can say "3% applied, because the process standard is 3%". */
    resolution: {
      appliedScope: rule.vendorId ? 'VENDOR' : 'PROCESS',
      appliedTo: rule.vendor?.vendorName ?? String(process),
      overriddenBy: candidates
        .filter((r) => r.id !== rule.id)
        .map((r) => ({
          scope: r.vendorId ? 'VENDOR' : 'PROCESS',
          vendorName: r.vendor?.vendorName ?? null,
          tolerancePct: pct(r.shrinkageTolerancePct).display,
          effectiveFrom: r.effectiveFrom,
        })),
    },
  };
}

/**
 * C3 - what a job worker is expected to send back.
 *
 *     expectedReturn = issued x (1 - tolerance)
 *
 * Pure, so the arithmetic can be asserted without a database, and used by both
 * the preview and the create path so a supervisor is never shown one figure
 * and judged by another.
 */
export function expectedReturnQty(issuedQty, shrinkageTolerancePct) {
  return D(issuedQty)
    .mul(D(1).minus(D(shrinkageTolerancePct)))
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * C3 - does a return pass?
 *
 *     passes when returnedQty >= issuedQty x (1 - tolerance)
 *
 * Pure. Returns the whole picture rather than a boolean, because a return that
 * fails has to tell the store keeper by how much and what happens next.
 */
export function assessReturn({ issuedQty, returnedQty, shrinkageTolerancePct }) {
  const issued = D(issuedQty);
  const returned = D(returnedQty);
  const tolerance = D(shrinkageTolerancePct);

  const expected = expectedReturnQty(issued, tolerance);
  const shortfall = issued.minus(returned);
  const variationPct = issued.isZero()
    ? D(0)
    : shortfall.div(issued).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);

  const within = returned.greaterThanOrEqualTo(expected);

  return {
    issuedQty: issued.toFixed(4),
    returnedQty: returned.toFixed(4),
    expectedReturnQty: expected.toFixed(4),
    shortfallQty: shortfall.toFixed(4),
    tolerance: tolerance.toFixed(6),
    tolerancePct: tolerance.mul(100).toDecimalPlaces(4).toFixed(2),
    variationPct: variationPct.toFixed(6),
    variationPctDisplay: variationPct.mul(100).toDecimalPlaces(2).toFixed(2),
    within,
    /** C4: this is the flag the cutting floor's completeness check reads. */
    requiresScrutiny: !within,
    /** How far past the tolerance it went - what an exception path is for. */
    beyondToleranceQty: within ? '0.0000' : expected.minus(returned).toFixed(4),
  };
}

// ===========================================================================
//  MAINTAINING THE MASTERS
// ===========================================================================

/**
 * Adds a new version of a category tolerance, closing the one it supersedes.
 *
 * Superseding and opening are ONE transaction. A version added without closing
 * its predecessor would leave two rows claiming the same period, and
 * `versionFor()` would silently pick one of them.
 */
export async function addToleranceVersion(input, actor = {}) {
  const category = input.category;
  const effectiveFrom = new Date(input.effectiveFrom);

  return prisma.$transaction(async (tx) => {
    const previous = await tx.toleranceRule.findFirst({
      where: {
        category,
        deletedAt: null,
        isActive: true,
        effectiveFrom: { lt: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (previous) {
      // Closed the day before the successor starts, so the two periods abut
      // exactly and no date falls in both or neither.
      const closeOn = new Date(effectiveFrom);
      closeOn.setUTCDate(closeOn.getUTCDate() - 1);
      await tx.toleranceRule.update({
        where: { id: previous.id },
        data: { effectiveTo: closeOn, updatedById: actor.userId ?? null },
      });
    }

    return tx.toleranceRule.create({
      data: {
        category,
        orderTolerancePct: D(input.orderTolerancePct),
        receiptTolerancePct: D(input.receiptTolerancePct),
        effectiveFrom,
        basis: input.basis,
        createdById: actor.userId ?? null,
        updatedById: actor.userId ?? null,
      },
    });
  });
}

/** The same, for a shrinkage rule. Same reasoning, same transaction. */
export async function addShrinkageVersion(input, actor = {}) {
  const effectiveFrom = new Date(input.effectiveFrom);
  const vendorId = input.vendorId ?? null;

  return prisma.$transaction(async (tx) => {
    const previous = await tx.shrinkageRule.findFirst({
      where: {
        process: input.process,
        vendorId,
        deletedAt: null,
        isActive: true,
        effectiveFrom: { lt: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (previous) {
      const closeOn = new Date(effectiveFrom);
      closeOn.setUTCDate(closeOn.getUTCDate() - 1);
      await tx.shrinkageRule.update({
        where: { id: previous.id },
        data: { effectiveTo: closeOn, updatedById: actor.userId ?? null },
      });
    }

    return tx.shrinkageRule.create({
      data: {
        process: input.process,
        vendorId,
        shrinkageTolerancePct: D(input.shrinkageTolerancePct),
        effectiveFrom,
        basis: input.basis,
        createdById: actor.userId ?? null,
        updatedById: actor.userId ?? null,
      },
    });
  });
}

/** Every version of every category tolerance, newest first. */
export async function listTolerances({ category } = {}) {
  const rows = await prisma.toleranceRule.findMany({
    where: { deletedAt: null, ...(category ? { category } : {}) },
    orderBy: [{ category: 'asc' }, { effectiveFrom: 'desc' }],
  });

  return rows.map((r) => ({
    ...r,
    orderTolerancePctDisplay: pct(r.orderTolerancePct).display,
    receiptTolerancePctDisplay: pct(r.receiptTolerancePct).display,
    isCurrent: !r.effectiveTo && r.isActive,
  }));
}

/** Every version of every shrinkage rule, newest first. */
export async function listShrinkage({ process } = {}) {
  const rows = await prisma.shrinkageRule.findMany({
    where: { deletedAt: null, ...(process ? { process } : {}) },
    orderBy: [{ process: 'asc' }, { effectiveFrom: 'desc' }],
    include: { vendor: { select: { id: true, vendorName: true } } },
  });

  return rows.map((r) => ({
    ...r,
    shrinkageTolerancePctDisplay: pct(r.shrinkageTolerancePct).display,
    scope: r.vendorId ? 'VENDOR' : 'PROCESS',
    isCurrent: !r.effectiveTo && r.isActive,
  }));
}
