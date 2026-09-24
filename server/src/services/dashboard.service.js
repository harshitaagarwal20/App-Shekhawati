/**
 * The dashboard.
 *
 * ===========================================================================
 *  ONE CALL, AND EVERY FIGURE IS THE SERVER'S
 * ===========================================================================
 *
 * The screen this feeds is the first thing every user sees, and before this
 * module existed it showed six record counts - how many buyers, how many
 * styles - which is the one question nobody starts the day with. What a
 * Director, a store manager or a planner actually opens the application to
 * find out is:
 *
 *      What is waiting on ME?
 *      What has gone wrong, or is about to?
 *      Where is the work sitting right now?
 *
 * Those are the three sections below, in that order, and they are answered in
 * one request rather than the six or seven the screen would otherwise make.
 *
 * ---------------------------------------------------------------------------
 *  THREE RULES THIS MODULE HOLDS TO, THE SAME AS EVERY OTHER SERVICE
 *
 *  1. RBAC IS DECLARED ONCE, HERE.  Every section names the permission it
 *     needs. A section the caller may not see is not computed and not sent -
 *     not sent-and-hidden, which would put the figures in the response body of
 *     someone who may not have them. The route itself needs no permission
 *     beyond a valid session, because a user holding nothing gets a dashboard
 *     with nothing on it, which is the correct answer rather than a 403.
 *
 *  2. NOTHING IS COMPUTED IN THE BROWSER.  Ages in days, stock values, counts,
 *     the "below reorder" verdict - all worked out here, in Decimal where it is
 *     money or quantity, and sent as strings. The client formats; it never
 *     derives. Same rule as everywhere else in this application.
 *
 *  3. NO RULE IS RESTATED.  "Waiting on a decision" comes from the approval
 *     engine's own queue, "below reorder level" from the inventory service's
 *     own predicate, and the record labels from the audit configuration. This
 *     module asks those questions; it does not answer them a second time.
 * ---------------------------------------------------------------------------
 *
 *  SCOPE.  The pipeline ends at Cutting Issue, so the dashboard ends there
 *  too. There is no tile, no stage and no counter for stitching, hourly
 *  monitoring, QC records, packing or dispatch.
 */

import prisma, { notDeleted } from '../config/prisma.js';
import { REGISTRY, pendingSummary } from './approvalEngine.js';
import { isBelowReorder } from './inventory.service.js';
import { AUDITED, labelFor, routeFor } from '../config/auditedTables.js';
import { D, ageDays } from '../utils/figures.js';

/** The soft-delete filter every count below shares. */
const LIVE = notDeleted;

/** Asia/Kolkata is UTC+05:30, and this application only ever runs in it. */
const IST_OFFSET_MIN = 330;

/**
 * Midnight, `offsetDays` ago, in the display timezone - as a UTC instant.
 *
 * "Received this week" has to mean working days in Jaipur, not in UTC.
 * Otherwise a receipt booked at 3pm local falls out of the window for anybody
 * reading the screen after 5:30am the following morning, which is most of the
 * factory.
 */
function startOfLocalDay(offsetDays = 0) {
  const ist = new Date(Date.now() + IST_OFFSET_MIN * 60000);
  ist.setUTCHours(0, 0, 0, 0);
  ist.setUTCDate(ist.getUTCDate() - offsetDays);
  return new Date(ist.getTime() - IST_OFFSET_MIN * 60000);
}

// ===========================================================================
//  THE SHARED-FIGURE CACHE
// ===========================================================================

/**
 * Nothing on this screen is per-user except which parts of it are sent.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS IS HERE
 *
 *  The dashboard is the first screen every user opens, and it fans out a lot
 *  of queries: two per pipeline stage, two per attention probe, two per
 *  approval type, four for stock and one per master count. For an ADMIN that
 *  is roughly forty round trips in a single request.
 *
 *  One user is fine. Fifteen people signing in at nine o'clock is forty
 *  queries each against a pool of `num_cpus * 2 + 1` connections, and requests
 *  that queue past Prisma's ten-second pool timeout do not come back slow -
 *  they come back 500, on the first screen of the morning.
 *
 *  So the figures are memoised for a few seconds. They are safe to share
 *  because not one of them depends on WHO is asking: `sectionsFor()` decides
 *  which cached figures a caller is sent, never what is inside them. The
 *  access decision is exactly where it was.
 *
 *  In-flight calls share the promise as well as the result, which is the half
 *  that matters at nine o'clock - fifteen simultaneous requests issue one
 *  query rather than fifteen and then a cached fourteen.
 *
 *  The staleness is bounded by TTL_MS and is the honest cost. A count eight
 *  seconds old, on a screen about work in progress, is not a figure anybody
 *  acts on differently.
 * ---------------------------------------------------------------------------
 */
const TTL_MS = 8000;

const cache = new Map();

function memo(key, fn) {
  const hit = cache.get(key);
  // An entry is either settled (`at` is a number) or still in flight (`at` is
  // null, so the arithmetic is NaN and never reads as inside the window).
  if (hit && (hit.at === null || Date.now() - hit.at < TTL_MS)) return hit.value;

  const value = Promise.resolve()
    .then(fn)
    .then(
      (v) => {
        cache.set(key, { at: Date.now(), value: Promise.resolve(v) });
        return v;
      },
      (err) => {
        // A failed query must not be served for the next eight seconds.
        cache.delete(key);
        throw err;
      },
    );

  cache.set(key, { at: null, value });
  return value;
}

/** Test seam - the suite builds more than one dashboard in a process. */
export function clearDashboardCache() {
  cache.clear();
}

/**
 * A count, and how long the oldest of them has been sitting there.
 *
 * The count says how big the pile is; the age says whether it is a pile
 * anybody is working. Both are taken from the same filter, so they cannot
 * disagree about what they are describing.
 */
async function countAndOldest(model, where) {
  const [count, oldest] = await Promise.all([
    prisma[model].count({ where }),
    prisma[model].findFirst({
      where,
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);
  return { count, oldestAgeDays: oldest ? ageDays(oldest.createdAt) : null };
}

// ===========================================================================
//  ATTENTION  -  what is wrong, or about to be
// ===========================================================================

/**
 * Each probe is a question somebody has to answer today, not a statistic.
 *
 * `severity` is what orders them on screen: `high` is a decision that is
 * blocking the pipeline behind it, `medium` is work in flight that has been
 * out too long. A probe returning zero is dropped entirely - an empty
 * attention list means there is genuinely nothing wrong, and that is worth
 * being able to see at a glance rather than reading five zeroes to infer.
 *
 * Each probe declares `model` and `where` rather than carrying a closure that
 * runs the query. The filter is then a value a test can read and check against
 * the Prisma schema with no database attached - which is the whole point of
 * the descriptor tables in this file, and was the one thing about them that
 * could not be checked while the filter was hidden inside a function body.
 * The soft-delete filter is added by the builder, so no probe can forget it.
 */
export const ATTENTION_PROBES = [
  {
    key: 'excess-pending',
    permission: 'BUYER_ORDER.VIEW',
    severity: 'high',
    title: 'Buyer orders awaiting an excess decision',
    detail: 'A plan may not allot against an excess until the Director has approved it.',
    to: '/orders',
    model: 'buyerOrder',
    where: { excessApprovalStatus: 'PENDING' },
  },
  {
    key: 'gatepass-uncleared',
    permission: 'GATE_PASS.VIEW',
    severity: 'high',
    title: 'Gate passes not yet cleared',
    detail: 'Goods have moved through the gate but nobody has recorded what was counted.',
    to: '/gate-passes',
    model: 'gatePass',
    where: { status: 'PENDING' },
  },
  {
    key: 'scrutiny-undecided',
    permission: 'FABRIC_SCRUTINY.VIEW',
    severity: 'high',
    title: 'Fabric scrutinies awaiting a decision',
    detail: 'Accept, reject or rework. Until it is decided the fabric cannot be cut.',
    to: '/scrutinies',
    model: 'fabricScrutiny',
    where: { isLocked: false },
  },
  {
    key: 'jobwork-outstanding',
    permission: 'DYE_ISSUE.VIEW',
    severity: 'medium',
    title: 'Job work lots still out',
    detail: 'Fabric is with a dyer, printer or finisher and has not fully come back.',
    to: '/job-works',
    model: 'dyeIssue',
    // A field reference rather than two queries and a subtraction in Node:
    // "returned less than issued" is one comparison, and the database is the
    // right place to make it.
    where: {
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      receivedQty: { lt: prisma.dyeIssue.fields.qty },
    },
  },
  {
    key: 'po-part-received',
    permission: 'PURCHASE_ORDER.VIEW',
    severity: 'medium',
    title: 'Approved purchase orders not fully received',
    detail: 'Approved and with the vendor, but the goods have not all arrived.',
    to: '/purchase-orders',
    model: 'purchaseOrder',
    where: {
      approvalStatus: 'APPROVED',
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      receivedQty: { lt: prisma.purchaseOrder.fields.orderQty },
    },
  },
];

/** Biggest problem first: severity, then how long it has been ignored. */
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

async function buildAttention(allowedKeys) {
  /**
   * `null`, not `[]`.
   *
   * An empty array means "every probe you are entitled to ran and found
   * nothing", and the screen says exactly that - "nothing is waiting on
   * anybody", naming the four things it checked. Saying that to somebody who
   * holds none of those permissions is simply false: gate passes may well be
   * piling up, they are just not this user's to see.
   *
   * `null` means "not yours", the section is not rendered at all, and the
   * response keeps the promise the module header makes about null versus
   * empty.
   */
  if (allowedKeys.length === 0) return null;

  const allowed = ATTENTION_PROBES.filter((p) => allowedKeys.includes(p.key));

  const results = await Promise.all(
    allowed.map(async (probe) => {
      const { count, oldestAgeDays } = await memo(`attention:${probe.key}`, () =>
        countAndOldest(probe.model, { ...LIVE, ...probe.where }),
      );
      if (count === 0) return null;
      return {
        key: probe.key,
        severity: probe.severity,
        title: probe.title,
        detail: probe.detail,
        to: probe.to,
        count,
        oldestAgeDays,
      };
    }),
  );

  return results
    .filter(Boolean)
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        (b.oldestAgeDays ?? 0) - (a.oldestAgeDays ?? 0),
    );
}

// ===========================================================================
//  APPROVALS  -  what is waiting, and how much of it is waiting on YOU
// ===========================================================================

/**
 * The approval engine already answers "what is waiting on a decision" for
 * every module at once. This narrows it to the modules the caller may see, and
 * marks the groups the caller can actually decide.
 *
 * That distinction is the point of the section. A planner and the Director
 * both see that six quotations are pending; only one of them is the reason
 * they are still pending, and only that one should be reading it as a to-do
 * list.
 */
async function buildApprovals(visible, decidable, queueTo) {
  if (visible.length === 0) return null;

  // `pendingSummary`, not `pendingQueue`: this section shows a count per module
  // and the age of the oldest, and nothing here lists the documents. The queue
  // form would read up to 200 full rows per document type to produce the same
  // nine numbers. See the note above pendingSummary().
  const queue = await pendingSummary({ documentTypes: visible });

  const groups = queue.groups.map((g) => ({
    documentType: g.documentType,
    label: g.label,
    count: g.count,
    oldestAgeDays: g.oldest?.ageDays ?? 0,
    /**
     * Whether this user is one of the people holding it up.
     *
     * Cutting Issue reaches this through CUTTING_ISSUE.APPROVE, which is the
     * permission that posts a challan. In practice the group is never here to
     * mark: posting walks DRAFT -> SUBMITTED -> PENDING_APPROVAL -> APPROVED
     * -> POSTED inside one transaction, so a challan is never left sitting in
     * a pending state for anybody to find.
     */
    mine: decidable.includes(g.documentType),
  }));

  return {
    total: queue.total,
    /** The part of that total this user can personally clear. */
    mineTotal: groups.filter((g) => g.mine).reduce((a, g) => a + g.count, 0),
    groups,
    /**
     * The oldest thing waiting AMONG THE TYPES THIS CALLER MAY SEE.
     *
     * `pendingSummary` was handed only `visible`, so this is not the oldest
     * document in the system and the screen must not call it that. A QC user
     * holding only FABRIC_SCRUTINY.VIEW gets the oldest scrutiny while a
     * purchase order may have been waiting four times as long.
     */
    oldest: queue.oldest,
    /**
     * Where "open the queue" goes, or `null` when it goes nowhere for them.
     *
     * The approval queue screen is guarded by REPORT.VIEW, which is not the
     * `<TYPE>.VIEW` that puts a group in this section. A role holding
     * GATE_PASS.VIEW and no REPORT.VIEW would otherwise be shown a link that
     * lands on Forbidden, so the server decides it here rather than leaving
     * the screen to guess.
     */
    queueTo,
  };
}

// ===========================================================================
//  PIPELINE  -  where the work is sitting
// ===========================================================================

/**
 * One stage per module, in pipeline order.
 *
 * `open` counts documents still in flight at that stage - the figure a
 * supervisor is actually managing. `recent` counts the last seven days, which
 * is what tells a quiet stage apart from a stuck one: eleven open and none of
 * them touched this week is a different problem from eleven open and nine
 * booked yesterday.
 */
export const STAGES = [
  {
    key: 'orders',
    label: 'Buyer orders',
    permission: 'BUYER_ORDER.VIEW',
    to: '/orders',
    model: 'buyerOrder',
    open: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
    dateField: 'orderDate',
  },
  {
    key: 'planning',
    label: 'Planning',
    permission: 'PLANNING.VIEW',
    to: '/planning',
    model: 'planning',
    open: { approvalStatus: 'PENDING' },
    dateField: 'planDate',
  },
  {
    key: 'quotations',
    label: 'Quotations',
    permission: 'VENDOR_QUOTATION.VIEW',
    to: '/quotations',
    model: 'vendorQuotation',
    open: { authorisationStatus: 'PENDING' },
    dateField: 'quotationDate',
  },
  {
    key: 'purchaseOrders',
    label: 'Purchase orders',
    permission: 'PURCHASE_ORDER.VIEW',
    to: '/purchase-orders',
    model: 'purchaseOrder',
    open: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
    dateField: 'poDate',
  },
  {
    key: 'gatePasses',
    label: 'Gate passes',
    permission: 'GATE_PASS.VIEW',
    to: '/gate-passes',
    model: 'gatePass',
    open: { status: 'PENDING' },
    dateField: 'gatePassDate',
  },
  {
    key: 'grns',
    label: 'Goods receipts',
    permission: 'GRN.VIEW',
    to: '/grns',
    model: 'grn',
    /**
     * A receipt is born posted, so there is no such thing as an open one.
     *
     * grn.service.js writes `status: 'COMPLETED'` and `workflowState:
     * 'POSTED'` in the same transaction that creates the rows and the stock -
     * "there is no draft GRN sitting between the goods arriving and the stock
     * existing". COMPLETED is terminal in FULFILMENT_TRANSITIONS, so a GRN
     * cannot reach PENDING or IN_PROGRESS afterwards either.
     *
     * This used to filter on those two states, which no GRN has ever held. The
     * stage read a confident `0` with the all-clear styling whether the system
     * held five receipts or five thousand. `null` says the true thing - this
     * stage has no in-flight state - and the screen shows the week's intake
     * instead of a number that was never a count of anything.
     */
    open: null,
    dateField: 'grnDate',
  },
  {
    key: 'fabricIssues',
    label: 'Fabric issues',
    permission: 'FABRIC_ISSUE.VIEW',
    to: '/fabric-issues',
    model: 'fabricIssue',
    open: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
    dateField: 'issueDate',
  },
  {
    key: 'jobWorks',
    label: 'Job work',
    permission: 'DYE_ISSUE.VIEW',
    to: '/job-works',
    model: 'dyeIssue',
    open: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
    dateField: 'issueDate',
  },
  {
    key: 'scrutinies',
    label: 'Fabric scrutiny',
    permission: 'FABRIC_SCRUTINY.VIEW',
    to: '/scrutinies',
    model: 'fabricScrutiny',
    open: { isLocked: false },
    dateField: 'scrutinyDate',
  },
  {
    key: 'planApprovals',
    label: 'Plan approval',
    permission: 'PLAN_APPROVAL.VIEW',
    to: '/plan-approvals',
    model: 'planApproval',
    open: { approvalStatus: 'PENDING' },
    dateField: 'submittedDate',
  },
  {
    /** The last stage. Nothing follows it. */
    key: 'cuttingIssues',
    label: 'Cutting issue',
    permission: 'CUTTING_ISSUE.VIEW',
    to: '/cutting-issues',
    model: 'cuttingIssue',
    /**
     * Reaches zero now that POSTED maps to COMPLETED in the engine's registry.
     * Before that fix a posted challan stayed IN_PROGRESS for good and this
     * counter only ever climbed.
     */
    open: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
    dateField: 'issueDate',
  },
];

async function buildPipeline(allowedKeys) {
  if (allowedKeys.length === 0) return null;

  const weekAgo = startOfLocalDay(6);
  const allowed = STAGES.filter((s) => allowedKeys.includes(s.key));

  return Promise.all(
    allowed.map(async (stage) => {
      /**
       * Two counts, not three.
       *
       * There was a third - an unfiltered `count()` per stage for a `total`
       * the screen never read. Eleven extra full-table counts per dashboard
       * load, on the screen every user opens first, discarded before the
       * response was even serialised.
       */
      const [open, recent] = await Promise.all([
        stage.open === null
          ? Promise.resolve(null)
          : memo(`stage:${stage.key}:open`, () =>
              prisma[stage.model].count({ where: { ...LIVE, ...stage.open } }),
            ),
        memo(`stage:${stage.key}:recent`, () =>
          prisma[stage.model].count({
            where: { ...LIVE, [stage.dateField]: { gte: weekAgo } },
          }),
        ),
      ]);
      return { key: stage.key, label: stage.label, to: stage.to, open, recent };
    }),
  );
}

// ===========================================================================
//  STOCK
// ===========================================================================

/**
 * What is on the racks, what it is worth, and what is running out.
 *
 * The balances are read and walked rather than summed in SQL because "below
 * reorder level" is a per-item comparison against a per-item threshold, and
 * the rule that decides it lives in the inventory service. Asking that
 * function keeps one definition of the verdict; a GROUP BY here that inlined
 * the comparison would quietly become a second one.
 */
async function buildStock() {
  const [totals, candidates, rollsOnHand, heldRolls] = await Promise.all([
    // Value is a database aggregate - no row bodies cross the wire to be added
    // up in Node.
    prisma.stockBalance.aggregate({
      where: { item: { deletedAt: null } },
      _sum: { value: true },
    }),
    // Only rows that could possibly be below a level. An item with no reorder
    // level set is untracked rather than permanently short - see
    // isBelowReorder() - so reading the rest to reject them is wasted work,
    // and in practice most items have never had one set.
    prisma.stockBalance.findMany({
      where: { item: { deletedAt: null, reorderLevel: { gt: 0 } } },
      select: {
        qty: true,
        item: {
          select: { id: true, itemCode: true, description: true, uom: true, reorderLevel: true },
        },
      },
    }),
    prisma.fabricRoll.count({ where: { ...LIVE, balanceQty: { gt: 0 } } }),
    prisma.fabricRoll.count({ where: { ...LIVE, isHeld: true } }),
  ]);

  /**
   * Totalled per ITEM before the comparison, because the reorder level is one.
   *
   * `stockBalance` is unique on (itemId, location), so an item held in two
   * places is two rows. Comparing each row against the item-wide reorder level
   * counted the same item twice and called it short twice: 60 in the main
   * store and 60 in the second store, against a level of 100, reported two
   * items below reorder and listed the item twice as short by 40 - when 120
   * are on hand and nothing is short at all.
   *
   * The stock ledger screen keys by `itemId::location` because it shows a
   * location column and the question there is per-shelf. This panel names
   * items, so the question here is per item.
   */
  const byItem = new Map();

  for (const b of candidates) {
    const existing = byItem.get(b.item.id);
    if (existing) existing.qty = existing.qty.plus(D(b.qty));
    else byItem.set(b.item.id, { item: b.item, qty: D(b.qty) });
  }

  const low = [];

  for (const { item, qty } of byItem.values()) {
    // Still the inventory service's predicate, and still the only definition
    // of the verdict - it is the operand that was wrong, not the rule.
    if (!isBelowReorder(qty, item.reorderLevel)) continue;
    low.push({
      itemId: item.id,
      itemCode: item.itemCode,
      description: item.description,
      uom: item.uom,
      qty: qty.toFixed(4),
      reorderLevel: D(item.reorderLevel).toFixed(4),
      /** How far under, so the screen can rank them without subtracting. */
      shortfall: D(item.reorderLevel).minus(qty).toFixed(4),
    });
  }

  low.sort((a, b) => Number(b.shortfall) - Number(a.shortfall));

  return {
    stockValue: D(totals._sum.value).toFixed(2),
    rollsOnHand,
    heldRolls,
    belowReorder: low.length,
    /** The worst five, so the panel can name them rather than only count them. */
    lowest: low.slice(0, 5),
  };
}

// ===========================================================================
//  ACTIVITY
// ===========================================================================

/**
 * The last few things anybody changed, each with a link to the record.
 *
 * Behind AUDIT.VIEW rather than shown to everyone, for the same reason the
 * Audit screen is: the trail carries the before-and-after of every rate, price
 * and approval in the system, and seeing it is a broader grant than being
 * allowed to use the screens it describes.
 */
async function buildActivity() {
  const rows = await prisma.auditLog.findMany({
    where: { tableName: { in: Object.keys(AUDITED) } },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      id: true,
      tableName: true,
      recordId: true,
      action: true,
      userName: true,
      createdAt: true,
    },
  });

  // `labelFor` and `routeFor` rather than reaching into AUDITED and repeating
  // what they do - which is what audit.service.js calls, and the third copy of
  // the null-route handling is one too many.
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    label: labelFor(r.tableName),
    to: routeFor(r.tableName, r.recordId),
    userName: r.userName ?? 'System',
    at: r.createdAt,
  }));
}

// ===========================================================================
//  MASTERS
// ===========================================================================

/**
 * The record counts the old dashboard showed.
 *
 * Kept, because "how many buyers are on the system" is a real question - but
 * demoted to a strip at the bottom, because it is not the question anybody
 * opens the application with, and it was the whole of the screen before.
 */
export const MASTER_COUNTS = [
  { key: 'buyers', label: 'Buyers', permission: 'BUYER.VIEW', to: '/masters/buyers', model: 'buyer' },
  { key: 'vendors', label: 'Vendors', permission: 'VENDOR.VIEW', to: '/masters/vendors', model: 'vendor' },
  { key: 'employees', label: 'Employees', permission: 'EMPLOYEE.VIEW', to: '/masters/employees', model: 'employee' },
  { key: 'styles', label: 'Styles', permission: 'STYLE.VIEW', to: '/masters/styles', model: 'style' },
  { key: 'lists', label: 'Master lists', permission: 'MASTER_LIST.VIEW', to: '/masters/list-master', model: 'masterList' },
];

async function buildMasters(allowedKeys) {
  if (allowedKeys.length === 0) return null;

  const allowed = MASTER_COUNTS.filter((m) => allowedKeys.includes(m.key));
  return Promise.all(
    allowed.map(async (m) => ({
      key: m.key,
      label: m.label,
      to: m.to,
      count: await memo(`master:${m.key}`, () => prisma[m.model].count({ where: LIVE })),
    })),
  );
}

// ===========================================================================
//  THE WHOLE THING
// ===========================================================================

/**
 * What one permission set is allowed to see, decided in one place.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS IS ITS OWN FUNCTION
 *
 *  This IS the access-control decision for the dashboard, and it is the only
 *  one - `build()` below computes exactly the sections this returns and no
 *  others. Pulling it out of `build()` costs one indirection and buys two
 *  things worth more than that:
 *
 *    It is testable with no database. Every other guarantee on this screen can
 *    be checked by looking at it; "a QC user is not sent the stock valuation"
 *    cannot, because the absence of a figure looks exactly like a figure that
 *    happened to be zero. See test/dashboard.rules.test.js.
 *
 *    It cannot drift from what is rendered. A second copy of these filters -
 *    one deciding what to query, one deciding what to send - is how a section
 *    ends up computed for somebody who may not have it, and then merely hidden.
 *
 *  `has` is passed in rather than the whole `req.auth` so the tests can drive
 *  it with a bare permission set. In production it is always `auth.has`, which
 *  carries the ADMIN short-circuit every other route authorises with.
 * ---------------------------------------------------------------------------
 *
 * @param {(code: string) => boolean} has
 */
export function sectionsFor(has) {
  return {
    attention: ATTENTION_PROBES.filter((p) => has(p.permission)).map((p) => p.key),
    /** Document types this caller may SEE waiting. */
    approvals: Object.keys(REGISTRY).filter((type) => has(`${type}.VIEW`)),
    /** Of those, the ones they may actually DECIDE. Always a subset in practice. */
    decidable: Object.keys(REGISTRY).filter((type) => has(`${type}.APPROVE`)),
    /**
     * Whether the shared approval queue screen is reachable at all.
     *
     * AppRoutes guards `/approvals` with REPORT.VIEW. Deciding it here keeps
     * every access question about this screen in this one function, which is
     * the whole argument for the function existing.
     */
    approvalQueue: has('REPORT.VIEW'),
    pipeline: STAGES.filter((s) => has(s.permission)).map((s) => s.key),
    stock: has('INVENTORY.VIEW'),
    activity: has('AUDIT.VIEW'),
    masters: MASTER_COUNTS.filter((m) => has(m.permission)).map((m) => m.key),
  };
}

/**
 * Builds the dashboard for one caller.
 *
 * Every section runs in parallel, and every one is optional. A QC user gets
 * scrutinies and nothing else; the response carries `null` where a section was
 * not theirs to see, and an empty array where it was theirs and empty - which
 * are different facts and the screen renders them differently.
 *
 * The client draws whatever it is handed, so granting a role a new permission
 * changes the dashboard without a client change.
 */
export async function build(auth) {
  const allowed = sectionsFor((code) => auth.has(code));

  const [attention, approvals, pipeline, stock, activity, masters] = await Promise.all([
    buildAttention(allowed.attention),
    buildApprovals(
      allowed.approvals,
      allowed.decidable,
      allowed.approvalQueue ? '/approvals' : null,
    ),
    buildPipeline(allowed.pipeline),
    allowed.stock ? memo('stock', buildStock) : Promise.resolve(null),
    allowed.activity ? memo('activity', buildActivity) : Promise.resolve(null),
    buildMasters(allowed.masters),
  ]);

  return {
    attention,
    approvals,
    pipeline,
    stock,
    activity,
    masters,
  };
}

export default { build, sectionsFor, clearDashboardCache };
