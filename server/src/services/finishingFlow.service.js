/**
 * Where one order and style's pieces are after the stitching units, and the
 * check every write that moves them has to pass.
 *
 * Ironing, External QC and the Alteration Unit each move the same pieces, so
 * they share one lock and one check, the way stitching, printing and ironing
 * share unitFlow.service.js:
 *
 *      ironed - offered to External QC                          >= 0
 *      QC "Iron" - received at ironing as Re-iron               >= 0
 *      altered - received at ironing from the Alteration Unit   >= 0
 *      each ironing lane (Re-iron, From Alteration Unit):
 *        received - ironed - damaged + re-ironed                >= 0
 *      each bag: altered + not repairable <= its qty             (a CHECK)
 *
 * Each caller writes, then calls assertFinishingFlow() inside the same
 * transaction, holding lockFinishingFlow(). A write that breaks a line throws
 * and rolls back - so ironing cannot be cut below what External QC was
 * offered, and External QC cannot be cut below what ironing took back.
 *
 * LOCK ORDER. A stitching-unit ironing entry takes the unit lock first and
 * this one second; everything else takes only this one. Nothing takes them
 * the other way round, so two writers can never wait on each other.
 *
 * The figures and their sum are in domain/finishing.js (pipeline()).
 */

import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError.js';
import { pipeline } from '../domain/finishing.js';

const D = (v) => new Prisma.Decimal(v ?? 0);

export async function lockFinishingFlow(tx, orderId, styleId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`finish::${orderId}::${styleId}`}, 0))`;
}

const ZERO_LANE = { received: D(0), ironed: D(0), damaged: D(0), reIroned: D(0), rejected: D(0) };

/**
 * The raw sums, grouped by order and style. `where` narrows every table the
 * same way ({} for all, { orderId } or { orderId, styleId }).
 *
 * @returns Map<"orderId:styleId", { orderId, styleId, lanes, qc, bags }>
 */
export async function finishingSums(client, where = {}) {
  const live = { ...where, deletedAt: null };
  const [ironing, qc, bags] = await Promise.all([
    client.ironingEntry.groupBy({
      by: ['orderId', 'styleId', 'source'],
      where: live,
      _sum: { pcsReceived: true, pcsIroned: true, pcsDamaged: true, pcsReIroned: true, pcsRejected: true },
    }),
    client.externalQcEntry.groupBy({
      by: ['orderId', 'styleId'],
      where: live,
      _sum: { pcsOffered: true, pcsApproved: true, pcsAlteration: true, pcsRejected: true, altIron: true, rejIron: true },
    }),
    client.alterationReceipt.groupBy({
      by: ['orderId', 'styleId'],
      where,
      _sum: { qty: true, pcsAltered: true, pcsNotRepairable: true },
    }),
  ]);

  const out = new Map();
  const at = (orderId, styleId) => {
    const key = `${orderId}:${styleId}`;
    if (!out.has(key)) {
      out.set(key, {
        orderId,
        styleId,
        lanes: { STITCHING_UNIT: { ...ZERO_LANE }, RE_IRON: { ...ZERO_LANE }, ALTERATION_UNIT: { ...ZERO_LANE } },
        qc: { offered: D(0), approved: D(0), alteration: D(0), rejected: D(0), iron: D(0) },
        bags: { qty: D(0), altered: D(0), notRepairable: D(0) },
      });
    }
    return out.get(key);
  };

  for (const g of ironing) {
    at(g.orderId, g.styleId).lanes[g.source] = {
      received: D(g._sum.pcsReceived),
      ironed: D(g._sum.pcsIroned),
      damaged: D(g._sum.pcsDamaged),
      reIroned: D(g._sum.pcsReIroned),
      rejected: D(g._sum.pcsRejected),
    };
  }
  for (const g of qc) {
    const s = g._sum;
    at(g.orderId, g.styleId).qc = {
      offered: D(s.pcsOffered),
      approved: D(s.pcsApproved),
      alteration: D(s.pcsAlteration),
      rejected: D(s.pcsRejected),
      iron: D(s.altIron).plus(D(s.rejIron)),
    };
  }
  for (const g of bags) {
    at(g.orderId, g.styleId).bags = {
      qty: D(g._sum.qty),
      altered: D(g._sum.pcsAltered),
      notRepairable: D(g._sum.pcsNotRepairable),
    };
  }
  return out;
}

const laneBalance = (l) => l.received.minus(l.ironed).minus(l.damaged).plus(l.reIroned);
const sumLanes = (lanes, k) => Object.values(lanes).reduce((a, l) => a.plus(l[k]), D(0));

/** Every figure for one order and style, from its sums. */
export function flowOf(sums) {
  const { lanes, qc, bags } = sums;
  const p = pipeline({
    receivedFromUnits: lanes.STITCHING_UNIT.received,
    receivedReIron: lanes.RE_IRON.received,
    receivedFromAlteration: lanes.ALTERATION_UNIT.received,
    ironed: sumLanes(lanes, 'ironed'),
    damaged: sumLanes(lanes, 'damaged'),
    reIroned: sumLanes(lanes, 'reIroned'),
    rejectedAtIroning: sumLanes(lanes, 'rejected'),
    offered: qc.offered,
    approved: qc.approved,
    qcIron: qc.iron,
    qcToAlteration: qc.alteration.plus(qc.rejected).minus(qc.iron),
    bagged: bags.qty,
    altered: bags.altered,
    notRepairable: bags.notRepairable,
  });
  return {
    ...p,
    ironed: sumLanes(lanes, 'ironed'),
    offered: qc.offered,
    qcAlteration: qc.alteration,
    qcRejected: qc.rejected,
    qcIron: qc.iron,
    bagged: bags.qty,
    altered: bags.altered,
    receivedReIron: lanes.RE_IRON.received,
    receivedFromAlteration: lanes.ALTERATION_UNIT.received,
    reIronLaneBalance: laneBalance(lanes.RE_IRON),
    alterationLaneBalance: laneBalance(lanes.ALTERATION_UNIT),
  };
}

const EMPTY = (orderId, styleId) => ({
  orderId,
  styleId,
  lanes: { STITCHING_UNIT: { ...ZERO_LANE }, RE_IRON: { ...ZERO_LANE }, ALTERATION_UNIT: { ...ZERO_LANE } },
  qc: { offered: D(0), approved: D(0), alteration: D(0), rejected: D(0), iron: D(0) },
  bags: { qty: D(0), altered: D(0), notRepairable: D(0) },
});

/** The flow of one order and style. */
export async function finishingFlow(client, { orderId, styleId }) {
  const sums = await finishingSums(client, { orderId, styleId });
  return flowOf(sums.get(`${orderId}:${styleId}`) ?? EMPTY(orderId, styleId));
}

/** Plain figures for an API response. */
export function finishingJson(f) {
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, D(v).toString()]));
}

/**
 * Throws if the write just made breaks the flow. Call it inside the write's
 * transaction, after the write, holding lockFinishingFlow().
 *
 * @param label  "B9641IS / TR-0751-008" - for the message
 */
export async function assertFinishingFlow(tx, { orderId, styleId }, label) {
  const f = await finishingFlow(tx, { orderId, styleId });
  const details = { flow: finishingJson(f) };

  if (f.waitingForQc.lessThan(0)) {
    throw ApiError.conflict(
      `External QC has been offered ${f.offered} pieces of ${label}, but only ${f.ironed} have been ironed - `
        + `${f.waitingForQc.negated()} more than ironing has done. Pieces offered cannot exceed the order's net ironed qty.`,
      details,
    );
  }
  if (f.reIronPending.lessThan(0)) {
    throw ApiError.conflict(
      `Ironing has received ${f.receivedReIron} pieces of ${label} to re-iron, but External QC sent back only `
        + `${f.qcIron} with reason Iron.`,
      details,
    );
  }
  if (f.alteredPending.lessThan(0)) {
    throw ApiError.conflict(
      `Ironing has received ${f.receivedFromAlteration} pieces of ${label} from the Alteration Unit, but only `
        + `${f.altered} have been altered there.`,
      details,
    );
  }
  if (f.reIronLaneBalance.lessThan(0)) {
    throw ApiError.conflict(
      `Ironed and damaged would be ${f.reIronLaneBalance.negated()} more than the re-iron pieces of ${label} `
        + 'received at ironing.',
      details,
    );
  }
  if (f.alterationLaneBalance.lessThan(0)) {
    throw ApiError.conflict(
      `Ironed and damaged would be ${f.alterationLaneBalance.negated()} more than the pieces of ${label} `
        + 'received at ironing from the Alteration Unit.',
      details,
    );
  }
  // Phase 6 - the approved pieces already needle-checked have moved on.
  const checked = await tx.needleCheckCarton.aggregate({ where: { orderId, styleId, deletedAt: null }, _sum: { totalPcs: true } });
  if (D(checked._sum.totalPcs).greaterThan(f.approved)) {
    throw ApiError.conflict(
      `${D(checked._sum.totalPcs)} approved pieces of ${label} are already in needle-checked cartons, but External QC `
        + `would approve only ${f.approved}. Correct the cartons at Needle Checking first.`,
      details,
    );
  }
  // Every piece sent to alteration is in a bag. Not a user's mistake if it
  // fails - a bag the services forgot to keep - so it is not a 409.
  if (!f.unbagged.isZero()) {
    throw new Error(`Finishing flow of ${label}: ${f.unbagged} pieces sent to alteration are in no bag`);
  }
  return f;
}
