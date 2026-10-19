/**
 * Inventory analysis - the store looked at supplier by supplier.
 *
 * Three reports, registered into `REPORTS` beside the others so the catalogue,
 * the permission check, the paging and the CSV export treat them the same:
 *
 *   supplier-stock      what each supplier's fabric is doing NOW: how much is
 *                       on hand, where it sits, what it is worth, how old it
 *                       is, and how much of it is held or uninspected.
 *
 *   supplier-yield      how each supplier's fabric has PERFORMED: short length
 *                       and faults found at inward inspection, faults found at
 *                       scrutiny, shrinkage at the dyer, and how much of what
 *                       went to the cutting table became pieces.
 *
 *   inward-inspection   every roll a GRN has received, with what inspection
 *                       found - and the ones still waiting for it.
 *
 * ---------------------------------------------------------------------------
 *  WHOSE FABRIC A ROLL IS
 *
 *  `FabricRoll.vendorId` - the supplier on the purchase order the GRN
 *  received against. It stays on the roll through dyeing, printing and
 *  cutting, and a remnant inherits it, so everything that later happens to the
 *  cloth can be put down to the mill that wove it. The dyer is a different
 *  party and is not who these reports are about.
 *
 *  Opening stock has no supplier and is grouped as such, never dropped: a
 *  supplier-wise view whose total does not reach the store's total would
 *  leave somebody reconciling the two.
 *
 *  YIELD IS A COHORT
 *
 *  `supplier-yield` takes the fabric RECEIVED in the date range and follows it
 *  wherever it went, however much later. Filtering the cuts by their own date
 *  instead would compare January's cloth from one supplier with March's from
 *  another. Every ratio is a ratio of sums, so a 2,000-metre lot counts for
 *  more than a 20-metre one.
 * ---------------------------------------------------------------------------
 */

import prisma, { notDeleted } from '../config/prisma.js';
import { D, ageDays } from '../utils/figures.js';
import { LOCATION, isWithJobWorker, itemShortName } from './inventory.service.js';

const ZERO = D(0);
const col = (key, label, format = 'text') => ({ key, label, format });
const NO_SUPPLIER = '— No supplier (opening stock)';
const AGED_DAYS = 90;

function between(field, from, to) {
  if (!from && !to) return {};
  return {
    [field]: {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    },
  };
}

/** A ratio as "12.3%", or null when there is nothing to divide by. */
const pct = (part, whole) =>
  whole && D(whole).greaterThan(0)
    ? `${D(part).div(D(whole)).mul(100).toDecimalPlaces(1).toFixed(1)}%`
    : null;

const q4 = (v) => D(v).toFixed(4);

/**
 * The rolls a supplier-wise report reads, as one `where`.
 *
 * Reused as a RELATION filter by the queries that follow the cloth - cutting
 * issues, scrutinies, dyeing receipts - so each asks "of these rolls" in the
 * database rather than shipping a list of ids back to it.
 */
function rollScope(q) {
  return {
    ...notDeleted,
    ...(q.vendorId ? { vendorId: q.vendorId } : {}),
    ...(q.itemId ? { inventoryItemId: q.itemId } : {}),
    ...(q.colorCode ? { colorCode: q.colorCode } : {}),
    ...(q.dateFrom || q.dateTo ? { grn: between('grnDate', q.dateFrom, q.dateTo) } : {}),
  };
}

/** When a roll came into the company: its GRN date, or when it was loaded. */
const receivedOn = (roll) => roll.grn?.grnDate ?? roll.createdAt;

/*
 * ONE ROW PER SUPPLIER AND ITEM.
 *
 * "Who has the better yield" is only a fair question between suppliers of the
 * same fabric - canvas and drill do not cut alike - so both supplier reports
 * group by the pair. The item is the stock item the GRN booked the roll to; a
 * roll seeded without one is grouped by its fabric name instead.
 */
const ROLL_ITEM = {
  vendorId: true,
  inventoryItemId: true,
  fabricName: true,
};

function supplierKey(roll) {
  return `${roll.vendorId ?? 'none'}|${roll.inventoryItemId ?? `name:${roll.fabricName ?? ''}`}`;
}

function itemOf(roll) {
  return {
    itemId: roll.inventoryItemId ?? null,
    itemCode: roll.inventoryItem?.itemCode ?? null,
    itemName: itemShortName(roll.inventoryItem) ?? roll.fabricName ?? '— Unnamed fabric',
    colorCode: roll.inventoryItem?.colorCode || null,
  };
}

/** Where a row opens: that supplier's rolls of that item. */
function rollsRoute(s, extra = '') {
  const p = new URLSearchParams();
  if (s.vendorId) p.set('vendorId', s.vendorId);
  if (s.itemId) p.set('itemId', s.itemId);
  const qs = p.toString();
  return `/inventory/rolls${qs || extra ? '?' : ''}${qs}${qs && extra ? '&' : ''}${extra}`;
}

// ===========================================================================
//  SUPPLIER-WISE STOCK
// ===========================================================================

async function supplierStockReport(q) {
  const rolls = await prisma.fabricRoll.findMany({
    where: rollScope(q),
    select: {
      id: true,
      ...ROLL_ITEM,
      vendor: { select: { vendorName: true, vendorCode: true } },
      inventoryItem: { select: { itemCode: true, description: true, itemCategory: true, subCategory: true, accessoriesItem: true, accessoryType: true, colorCode: true } },
      receivedQty: true,
      balanceQty: true,
      rate: true,
      uom: true,
      location: true,
      stage: true,
      isHeld: true,
      isRemnant: true,
      inspectionStatus: true,
      createdAt: true,
      grn: { select: { grnDate: true } },
    },
  });

  /*
   * HOW MUCH, AND WHERE, comes from the ledger - for EVERY roll.
   *
   * `roll.balanceQty` is only what is on the roll IN THE STORE: a fabric issue
   * takes the issued length off it. A roll sent whole to a dyer or to the
   * cutting floor reads zero there, yet the company still owns every metre.
   * The ledger records those transfers as movements between locations, so
   * summing it per roll and location gives both the total held and where.
   */
  const byLocation = new Map();
  if (rolls.length) {
    const groups = await prisma.stockLedger.groupBy({
      by: ['rollId', 'location'],
      where: { rollId: { in: rolls.map((r) => r.id) } },
      _sum: { qtyIn: true, qtyOut: true },
    });
    for (const g of groups) {
      const net = D(g._sum.qtyIn).minus(D(g._sum.qtyOut));
      if (net.isZero()) continue;
      const m = byLocation.get(g.rollId) ?? new Map();
      m.set(g.location, net);
      byLocation.set(g.rollId, m);
    }
  }

  const suppliers = new Map();
  for (const r of rolls) {
    const key = supplierKey(r);
    const s = suppliers.get(key) ?? {
      key,
      vendorId: r.vendorId,
      vendorName: r.vendor?.vendorName ?? NO_SUPPLIER,
      vendorCode: r.vendor?.vendorCode ?? null,
      ...itemOf(r),
      uoms: new Set(),
      rollsReceived: 0,
      received: ZERO,
      rollsInStock: 0,
      onHand: ZERO,
      inStore: ZERO,
      withJobWorker: ZERO,
      onCuttingFloor: ZERO,
      held: ZERO,
      value: ZERO,
      unvalued: 0,
      aged: ZERO,
      oldest: null,
      lastReceived: null,
      inspectionPending: 0,
      inspectionFailed: 0,
    };

    const came = receivedOn(r);
    // A remnant is the same cloth booked again; counting it as received
    // would buy the supplier's metres twice.
    if (!r.isRemnant) {
      s.rollsReceived += 1;
      s.received = s.received.plus(D(r.receivedQty));
      if (!s.lastReceived || came > s.lastReceived) s.lastReceived = came;
    }
    s.uoms.add(r.uom);

    // A roll with no ledger behind it (seeded from the workbook) holds its
    // balance wherever its label says.
    const split =
      byLocation.get(r.id) ??
      (D(r.balanceQty).greaterThan(0) ? new Map([[r.location, D(r.balanceQty)]]) : new Map());
    const balance = [...split.values()].reduce((a, q) => a.plus(q), ZERO);
    if (balance.greaterThan(0)) {
      s.rollsInStock += 1;
      s.onHand = s.onHand.plus(balance);

      for (const [location, qty] of split) {
        if (isWithJobWorker(location)) s.withJobWorker = s.withJobWorker.plus(qty);
        else if (location === LOCATION.CUTTING_FLOOR) s.onCuttingFloor = s.onCuttingFloor.plus(qty);
        else s.inStore = s.inStore.plus(qty);
      }

      if (r.isHeld || r.stage === 'REJECTED' || r.stage === 'SCRUTINY_HOLD') {
        s.held = s.held.plus(balance);
      }
      if (r.rate == null) s.unvalued += 1;
      else s.value = s.value.plus(balance.mul(D(r.rate)));

      const age = ageDays(came);
      if (age > AGED_DAYS) s.aged = s.aged.plus(balance);
      if (!s.oldest || came < s.oldest) s.oldest = came;

      if (r.inspectionStatus === 'PENDING') s.inspectionPending += 1;
      if (r.inspectionStatus === 'FAILED') s.inspectionFailed += 1;
    }

    suppliers.set(key, s);
  }

  const rows = [...suppliers.values()]
    .map((s) => ({
      id: s.key,
      route: rollsRoute(s, 'inStockOnly=true'),
      vendorName: s.vendorName,
      vendorCode: s.vendorCode,
      itemName: s.itemName,
      itemCode: s.itemCode,
      colorCode: s.colorCode,
      /** Which item this is, for counting - the short name alone can repeat. */
      itemKey: s.itemId ?? s.itemName,
      lastReceived: s.lastReceived,
      rollsReceived: s.rollsReceived,
      receivedQty: q4(s.received),
      rollsInStock: s.rollsInStock,
      onHandQty: q4(s.onHand),
      inStoreQty: q4(s.inStore),
      withJobWorkerQty: q4(s.withJobWorker),
      onCuttingFloorQty: q4(s.onCuttingFloor),
      heldQty: q4(s.held),
      value: s.value.toDecimalPlaces(2).toFixed(2),
      unvaluedRolls: s.unvalued,
      oldestDays: ageDays(s.oldest),
      agedQty: q4(s.aged),
      inspectionPending: s.inspectionPending,
      inspectionFailed: s.inspectionFailed,
      // Fabric is bought in metres and kilos; a supplier selling in both
      // has a quantity column that adds the two, and says so here.
      uom: [...s.uoms].sort().join(' + '),
    }))
    // Supplier by supplier, then each supplier's largest holding first.
    .sort(
      (a, b) =>
        a.vendorName.localeCompare(b.vendorName) || D(b.onHandQty).comparedTo(D(a.onHandQty)),
    )
    .slice(0, q.limit);

  const sum = (k) => rows.reduce((a, r) => a.plus(D(r[k])), ZERO);
  return {
    rows,
    totals: {
      suppliers: new Set(rows.map((r) => r.vendorName)).size,
      items: new Set(rows.map((r) => r.itemKey)).size,
      onHandQty: q4(sum('onHandQty')),
      value: sum('value').toFixed(2),
      withJobWorkerQty: q4(sum('withJobWorkerQty')),
      heldQty: q4(sum('heldQty')),
      agedQty: q4(sum('agedQty')),
      inspectionPending: rows.reduce((a, r) => a + r.inspectionPending, 0),
    },
  };
}

// ===========================================================================
//  SUPPLIER YIELD
// ===========================================================================

async function supplierYieldReport(q) {
  const scope = rollScope(q);

  /*
   * TWO SOURCES OF CUTTING FIGURES.
   *
   * The fabric is accounted for on the Cut Pieces Receipt now. Before that it
   * was on the Cutting Issue, and the challans posted then still carry it. A
   * new challan carries no fabric (issuedQty 0) and is left out, or its pieces
   * would be counted a second time beside the receipt they were counted on.
   */
  const [rolls, cuts, receipts, scrutinies, dyeing] = await Promise.all([
    prisma.fabricRoll.findMany({
      where: scope,
      select: {
        ...ROLL_ITEM,
        vendor: { select: { vendorName: true, vendorCode: true } },
        inventoryItem: { select: { itemCode: true, description: true, itemCategory: true, subCategory: true, accessoriesItem: true, accessoryType: true, colorCode: true } },
        receivedQty: true,
        isRemnant: true,
        uom: true,
        inspectionStatus: true,
        inspectedQty: true,
        inspectionDefectQty: true,
        createdAt: true,
        grn: { select: { grnDate: true } },
      },
    }),
    prisma.cuttingIssue.findMany({
      where: {
        ...notDeleted,
        postedAt: { not: null },
        issuedQty: { gt: 0 },
        fabricIssue: { roll: scope },
      },
      select: {
        issuedQty: true,
        consumedQty: true,
        remainderQty: true,
        wastageQty: true,
        fabricDamageQty: true,
        remnantQty: true,
        cuttingPcsIssued: true,
        cuttingPcsDamaged: true,
        plannedConsumptionQty: true,
        actualConsumptionQty: true,
        fabricIssue: { select: { roll: { select: ROLL_ITEM } } },
      },
    }),
    prisma.cutPiecesReceipt.findMany({
      where: { ...notDeleted, stockPostedAt: { not: null }, fabricIssue: { roll: scope } },
      select: {
        issuedQty: true,
        consumedQty: true,
        wastageQty: true,
        fabricDamageQty: true,
        remnantQty: true,
        pcsReceived: true,
        pcsRejected: true,
        style: { select: { avgFabricUtilizationPerPc: true } },
        fabricIssue: { select: { roll: { select: ROLL_ITEM } } },
      },
    }),
    prisma.fabricScrutiny.findMany({
      where: { ...notDeleted, roll: scope },
      select: {
        qtyAffected: true,
        decision: true,
        isLocked: true,
        roll: { select: ROLL_ITEM },
      },
    }),
    prisma.dyeingReceipt.findMany({
      where: { ...notDeleted, roll: scope },
      select: { qtyIssued: true, qtyReceived: true, roll: { select: ROLL_ITEM } },
    }),
  ]);

  const suppliers = new Map();
  const get = (roll) => {
    const key = supplierKey(roll);
    if (!suppliers.has(key)) {
      suppliers.set(key, {
        key,
        vendorId: roll.vendorId,
        vendorName: roll.vendor?.vendorName ?? NO_SUPPLIER,
        vendorCode: roll.vendor?.vendorCode ?? null,
        ...itemOf(roll),
        uoms: new Set(),
        firstReceived: null,
        lastReceived: null,
        rolls: 0,
        received: ZERO,
        inspected: 0,
        failed: 0,
        measuredBilled: ZERO,
        measured: ZERO,
        inspectedBilled: ZERO,
        faulty: ZERO,
        scrutinyQty: ZERO,
        rejectedQty: ZERO,
        dyeOut: ZERO,
        dyeBack: ZERO,
        cutIssued: ZERO,
        consumed: ZERO,
        wasted: ZERO,
        remnant: ZERO,
        pcs: ZERO,
        damagedPcs: ZERO,
        planned: ZERO,
        actual: ZERO,
      });
    }
    return suppliers.get(key);
  };

  for (const r of rolls) {
    if (r.isRemnant) continue;
    const s = get(r);
    const billed = D(r.receivedQty);
    const came = receivedOn(r);
    s.uoms.add(r.uom);
    s.rolls += 1;
    s.received = s.received.plus(billed);
    if (!s.firstReceived || came < s.firstReceived) s.firstReceived = came;
    if (!s.lastReceived || came > s.lastReceived) s.lastReceived = came;

    if (r.inspectionStatus === 'PASSED' || r.inspectionStatus === 'FAILED') {
      s.inspected += 1;
      if (r.inspectionStatus === 'FAILED') s.failed += 1;
      s.inspectedBilled = s.inspectedBilled.plus(billed);
      s.faulty = s.faulty.plus(D(r.inspectionDefectQty));
      // Short length is judged only on rolls that were actually measured;
      // an unmeasured roll is not a roll that measured exactly right.
      if (r.inspectedQty != null) {
        s.measuredBilled = s.measuredBilled.plus(billed);
        s.measured = s.measured.plus(D(r.inspectedQty));
      }
    }
  }

  for (const c of cuts) {
    const roll = c.fabricIssue?.roll;
    const s = roll && suppliers.get(supplierKey(roll));
    if (!s) continue; // a cut of a remnant whose own receipt is outside the range
    s.cutIssued = s.cutIssued.plus(D(c.issuedQty));
    s.consumed = s.consumed.plus(D(c.consumedQty));
    s.wasted = s.wasted.plus(D(c.wastageQty)).plus(D(c.fabricDamageQty));
    s.remnant = s.remnant.plus(D(c.remnantQty));
    s.pcs = s.pcs.plus(D(c.cuttingPcsIssued));
    s.damagedPcs = s.damagedPcs.plus(D(c.cuttingPcsDamaged));
    if (c.plannedConsumptionQty != null) {
      s.planned = s.planned.plus(D(c.plannedConsumptionQty));
      s.actual = s.actual.plus(
        D(c.actualConsumptionQty ?? D(c.consumedQty).plus(D(c.wastageQty)).plus(D(c.fabricDamageQty))),
      );
    }
  }

  for (const r of receipts) {
    const roll = r.fabricIssue?.roll;
    const s = roll && suppliers.get(supplierKey(roll));
    if (!s) continue;
    const used = D(r.consumedQty).plus(D(r.wastageQty)).plus(D(r.fabricDamageQty));
    s.cutIssued = s.cutIssued.plus(D(r.issuedQty));
    s.consumed = s.consumed.plus(D(r.consumedQty));
    s.wasted = s.wasted.plus(D(r.wastageQty)).plus(D(r.fabricDamageQty));
    s.remnant = s.remnant.plus(D(r.remnantQty));
    s.pcs = s.pcs.plus(D(r.pcsReceived));
    s.damagedPcs = s.damagedPcs.plus(D(r.pcsRejected));
    // A receipt freezes no standard, so the style's fabric per piece as it
    // stands is used. Cloth was cut for the rejected pieces too.
    const std = D(r.style?.avgFabricUtilizationPerPc);
    if (std.greaterThan(0) && used.greaterThan(0)) {
      s.planned = s.planned.plus(std.mul(D(r.pcsReceived).plus(D(r.pcsRejected))));
      s.actual = s.actual.plus(used);
    }
  }

  for (const sc of scrutinies) {
    const s = sc.roll && suppliers.get(supplierKey(sc.roll));
    if (!s) continue;
    s.scrutinyQty = s.scrutinyQty.plus(D(sc.qtyAffected));
    if (sc.isLocked && sc.decision === 'REJECT') s.rejectedQty = s.rejectedQty.plus(D(sc.qtyAffected));
  }

  for (const d of dyeing) {
    const s = d.roll && suppliers.get(supplierKey(d.roll));
    if (!s) continue;
    s.dyeOut = s.dyeOut.plus(D(d.qtyIssued));
    s.dyeBack = s.dyeBack.plus(D(d.qtyReceived));
  }

  const ranked = [...suppliers.values()].map((s) => {
    const used = s.consumed.plus(s.wasted);
    return {
      s,
      yieldRatio: used.greaterThan(0) ? s.consumed.div(used) : null,
      used,
    };
  });

  // Item by item, and within an item the best yield first - the rank is the
  // supplier's place AMONG THOSE SUPPLYING THAT ITEM, because comparing a
  // canvas mill's yield with a drill mill's says nothing about either. A
  // supplier none of whose fabric has been cut yet has no yield to rank and
  // follows those that do.
  ranked.sort((a, b) => {
    // The short name is shared by every colour of a fabric, so the item itself
    // breaks the tie and each item's suppliers stay together.
    const byItem =
      a.s.itemName.localeCompare(b.s.itemName) ||
      String(a.s.colorCode ?? '').localeCompare(String(b.s.colorCode ?? '')) ||
      String(a.s.itemId ?? '').localeCompare(String(b.s.itemId ?? ''));
    if (byItem) return byItem;
    if (a.yieldRatio == null && b.yieldRatio == null) return D(b.s.received).comparedTo(D(a.s.received));
    if (a.yieldRatio == null) return 1;
    if (b.yieldRatio == null) return -1;
    return b.yieldRatio.comparedTo(a.yieldRatio);
  });

  const rankInItem = new Map();
  const rows = ranked
    .map(({ s, yieldRatio, used }) => {
      let rank = null;
      if (yieldRatio != null) {
        rank = (rankInItem.get(s.itemId ?? s.itemName) ?? 0) + 1;
        rankInItem.set(s.itemId ?? s.itemName, rank);
      }
      return {
        id: s.key,
        route: rollsRoute(s),
        rank,
        vendorName: s.vendorName,
        vendorCode: s.vendorCode,
        itemName: s.itemName,
        itemCode: s.itemCode,
        colorCode: s.colorCode,
        /** Which item this is, for counting - the short name alone can repeat. */
        itemKey: s.itemId ?? s.itemName,
        firstReceived: s.firstReceived,
        lastReceived: s.lastReceived,
        rolls: s.rolls,
        receivedQty: q4(s.received),
        inspectedRolls: s.inspected,
        failedRolls: s.failed,
        shortLengthQty: q4(s.measuredBilled.minus(s.measured)),
        shortLengthPct: pct(s.measuredBilled.minus(s.measured), s.measuredBilled),
        faultyQty: q4(s.faulty),
        faultyPct: pct(s.faulty, s.inspectedBilled),
        scrutinyQty: q4(s.scrutinyQty),
        rejectedQty: q4(s.rejectedQty),
        dyeShrinkagePct: pct(s.dyeOut.minus(s.dyeBack), s.dyeOut),
        cutIssuedQty: q4(s.cutIssued),
        consumedQty: q4(s.consumed),
        wastedQty: q4(s.wasted),
        wastagePct: pct(s.wasted, used),
        remnantQty: q4(s.remnant),
        pcsCut: q4(s.pcs),
        damagedPcs: q4(s.damagedPcs),
        yieldPct: yieldRatio == null ? null : pct(s.consumed, used),
        efficiencyPct: pct(s.planned, s.actual),
        uom: [...s.uoms].sort().join(' + '),
      };
    })
    .slice(0, q.limit);

  const consumed = ranked.reduce((a, r) => a.plus(r.s.consumed), ZERO);
  const used = ranked.reduce((a, r) => a.plus(r.used), ZERO);
  // The single best row anywhere - a headline, not a ranking.
  const best = ranked
    .filter((r) => r.yieldRatio != null)
    .reduce((top, r) => (!top || r.yieldRatio.greaterThan(top.yieldRatio) ? r : top), null);
  return {
    rows,
    totals: {
      suppliers: new Set(rows.map((r) => r.vendorName)).size,
      items: new Set(rows.map((r) => r.itemKey)).size,
      receivedQty: q4(ranked.reduce((a, r) => a.plus(r.s.received), ZERO)),
      cutIssuedQty: q4(ranked.reduce((a, r) => a.plus(r.s.cutIssued), ZERO)),
      yieldPct: pct(consumed, used),
      bestSupplier: best
        ? `${best.s.vendorName} — ${best.s.itemName} (${pct(best.s.consumed, best.used)})`
        : null,
    },
  };
}

// ===========================================================================
//  INWARD INSPECTION
// ===========================================================================

async function inwardInspectionReport(q) {
  const rolls = await prisma.fabricRoll.findMany({
    where: {
      ...rollScope(q),
      ...(q.inspectionStatus ? { inspectionStatus: q.inspectionStatus } : { inspectionStatus: { not: null } }),
    },
    take: q.limit,
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      rollNo: true,
      fabricName: true,
      colorCode: true,
      uom: true,
      width: true,
      gsm: true,
      receivedQty: true,
      balanceQty: true,
      stage: true,
      inspectionStatus: true,
      inspectedQty: true,
      inspectedWidth: true,
      inspectedGsm: true,
      inspectionDefectQty: true,
      inspectionRemarks: true,
      inspectedAt: true,
      inspectedByName: true,
      createdAt: true,
      inventoryItemId: true,
      inventoryItem: { select: { itemCode: true, description: true, itemCategory: true, subCategory: true, accessoriesItem: true, accessoryType: true, colorCode: true } },
      vendor: { select: { vendorName: true } },
      grn: { select: { grnNo: true, grnDate: true } },
    },
  });

  const rows = rolls.map((r) => {
    const billed = D(r.receivedQty);
    const short = r.inspectedQty != null ? billed.minus(D(r.inspectedQty)) : null;
    const pending = r.inspectionStatus === 'PENDING';
    return {
      id: r.id,
      route: `/inventory/rolls/${r.id}`,
      grnNo: r.grn?.grnNo ?? null,
      grnDate: r.grn?.grnDate ?? null,
      vendorName: r.vendor?.vendorName ?? null,
      itemName: itemOf(r).itemName,
      itemCode: itemOf(r).itemCode,
      rollNo: r.rollNo,
      fabricName: r.fabricName,
      colorCode: r.colorCode,
      inspectionStatus: r.inspectionStatus,
      daysWaiting: pending ? ageDays(receivedOn(r)) : null,
      billedQty: q4(billed),
      measuredQty: r.inspectedQty == null ? null : q4(r.inspectedQty),
      shortQty: short == null ? null : q4(short),
      orderedWidth: r.width == null ? null : D(r.width).toFixed(2),
      measuredWidth: r.inspectedWidth == null ? null : D(r.inspectedWidth).toFixed(2),
      orderedGsm: r.gsm,
      measuredGsm: r.inspectedGsm == null ? null : D(r.inspectedGsm).toFixed(2),
      defectQty: r.inspectionDefectQty == null ? null : q4(r.inspectionDefectQty),
      defectPct: r.inspectionDefectQty == null ? null : pct(r.inspectionDefectQty, r.inspectedQty ?? billed),
      inspectedByName: r.inspectedByName,
      inspectedAt: r.inspectedAt,
      remarks: r.inspectionRemarks,
      stage: r.stage,
      balanceQty: q4(r.balanceQty),
      uom: r.uom,
    };
  });

  // The queue first, longest-waiting at the top; then what has been done,
  // most recent first.
  rows.sort((a, b) => {
    const ap = a.inspectionStatus === 'PENDING';
    const bp = b.inspectionStatus === 'PENDING';
    if (ap !== bp) return ap ? -1 : 1;
    if (ap) return (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0);
    return new Date(b.inspectedAt ?? 0) - new Date(a.inspectedAt ?? 0);
  });

  const count = (status) => rows.filter((r) => r.inspectionStatus === status).length;
  return {
    rows,
    totals: {
      rolls: rows.length,
      pending: count('PENDING'),
      passed: count('PASSED'),
      failed: count('FAILED'),
      pendingQty: q4(
        rows.filter((r) => r.inspectionStatus === 'PENDING').reduce((a, r) => a.plus(D(r.billedQty)), ZERO),
      ),
      defectQty: q4(rows.reduce((a, r) => a.plus(D(r.defectQty)), ZERO)),
      shortQty: q4(rows.reduce((a, r) => a.plus(D(r.shortQty)), ZERO)),
    },
  };
}

// ===========================================================================
//  THE REGISTRY ENTRIES
// ===========================================================================

export const INVENTORY_ANALYSIS_REPORTS = {
  'supplier-stock': {
    title: 'Supplier-wise stock',
    description:
      'Fabric on hand grouped by the supplier it was bought from: where it sits (store, job ' +
      'worker, cutting floor), what it is worth, how old it is, and how much is held or still ' +
      'waiting for inspection.',
    permission: 'INVENTORY.VIEW',
    excelRef: '— derived from fabric rolls and the stock ledger',
    category: 'INVENTORY',
    filters: ['vendorId', 'itemId', 'colorCode', 'dateFrom', 'dateTo'],
    columns: [
      col('vendorName', 'Supplier'),
      col('itemName', 'Item'),
      col('colorCode', 'Colour'),
      col('lastReceived', 'Last received', 'date'),
      col('rollsReceived', 'Rolls received', 'qty'),
      col('receivedQty', 'Received', 'qty'),
      col('rollsInStock', 'Rolls in stock', 'qty'),
      col('onHandQty', 'On hand', 'qty'),
      col('inStoreQty', 'In store', 'qty'),
      col('withJobWorkerQty', 'With job worker', 'qty'),
      col('onCuttingFloorQty', 'Cutting floor', 'qty'),
      col('heldQty', 'Held / rejected', 'qty'),
      col('value', 'Value', 'money'),
      col('unvaluedRolls', 'Rolls with no rate', 'qty'),
      col('oldestDays', 'Oldest (days)', 'qty'),
      col('agedQty', `Older than ${AGED_DAYS} days`, 'qty'),
      col('inspectionPending', 'Awaiting inspection', 'qty'),
      col('inspectionFailed', 'Failed inspection', 'qty'),
      col('uom', 'UOM'),
    ],
    run: supplierStockReport,
  },

  'supplier-yield': {
    title: 'Supplier fabric yield',
    description:
      'Fabric received from each supplier in the period, followed to the cutting table: short ' +
      'length and faults at inward inspection, faults at scrutiny, shrinkage at the dyer, and ' +
      'how much of what was cut became pieces. Ranked best yield first.',
    permission: 'INVENTORY.VIEW',
    excelRef: '— derived from rolls, inspections, scrutinies, dyeing receipts and cutting issues',
    category: 'INVENTORY',
    filters: ['vendorId', 'itemId', 'colorCode', 'dateFrom', 'dateTo'],
    columns: [
      col('itemName', 'Item'),
      col('colorCode', 'Colour'),
      col('rank', 'Rank in item', 'qty'),
      col('vendorName', 'Supplier'),
      col('firstReceived', 'First received', 'date'),
      col('lastReceived', 'Last received', 'date'),
      col('rolls', 'Rolls', 'qty'),
      col('receivedQty', 'Received', 'qty'),
      col('inspectedRolls', 'Inspected', 'qty'),
      col('failedRolls', 'Failed', 'qty'),
      col('shortLengthQty', 'Short length', 'qty'),
      col('shortLengthPct', 'Short %'),
      col('faultyQty', 'Faulty at inspection', 'qty'),
      col('faultyPct', 'Faulty %'),
      col('scrutinyQty', 'Scrutiny affected', 'qty'),
      col('rejectedQty', 'Rejected', 'qty'),
      col('dyeShrinkagePct', 'Dyeing shrinkage'),
      col('cutIssuedQty', 'Issued to cutting', 'qty'),
      col('consumedQty', 'Became pieces', 'qty'),
      col('wastedQty', 'Wastage + damage', 'qty'),
      col('wastagePct', 'Wastage %'),
      col('remnantQty', 'Remnants', 'qty'),
      col('pcsCut', 'Pcs cut', 'qty'),
      col('damagedPcs', 'Damaged pcs', 'qty'),
      col('yieldPct', 'Cutting yield'),
      col('efficiencyPct', 'vs style standard'),
      col('uom', 'UOM'),
    ],
    run: supplierYieldReport,
  },

  'inward-inspection': {
    title: 'Inward inspection',
    description:
      'Every roll received on a GRN and what inspection found: measured length against the ' +
      'bill, width and GSM against the order, and faulty length. Rolls still waiting are ' +
      'listed first, longest-waiting at the top.',
    permission: 'FABRIC_ROLL.VIEW',
    excelRef: '— recorded on the roll after the GRN',
    category: 'INVENTORY',
    filters: ['vendorId', 'itemId', 'inspectionStatus', 'colorCode', 'dateFrom', 'dateTo'],
    columns: [
      col('grnNo', 'GRN'),
      col('grnDate', 'GRN date', 'date'),
      col('vendorName', 'Supplier'),
      col('itemName', 'Item'),
      col('rollNo', 'Roll'),
      col('colorCode', 'Colour'),
      col('inspectionStatus', 'Inspection'),
      col('daysWaiting', 'Waiting (days)', 'qty'),
      col('billedQty', 'Billed', 'qty'),
      col('measuredQty', 'Measured', 'qty'),
      col('shortQty', 'Short', 'qty'),
      col('orderedWidth', 'Width ordered', 'qty'),
      col('measuredWidth', 'Width found', 'qty'),
      col('orderedGsm', 'GSM ordered'),
      col('measuredGsm', 'GSM found', 'qty'),
      col('defectQty', 'Faulty', 'qty'),
      col('defectPct', 'Faulty %'),
      col('inspectedByName', 'Inspected by'),
      col('inspectedAt', 'Inspected on', 'date'),
      col('remarks', 'Remarks'),
      col('stage', 'Stage'),
      col('balanceQty', 'Balance', 'qty'),
      col('uom', 'UOM'),
    ],
    run: inwardInspectionReport,
  },
};
