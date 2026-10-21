/**
 * Where one stitching unit's pieces of one order and style are, and the
 * check every write that moves them has to pass.
 *
 * Stitching, printing after stitching and ironing each move the same pieces,
 * so they share one lock and one check rather than three that could drift:
 *
 *      stitched - out for printing - received at ironing   >= 0   (at the unit)
 *      received - ironed - damaged + re-ironed             >= 0   (at ironing)
 *
 * Each caller writes, then calls assertFlow() inside the same transaction. A
 * write that breaks either line throws, and the transaction rolls it back -
 * so the rule holds whichever screen the change came from: stitching cut
 * below what has left the unit, printing sent from pieces already at ironing,
 * or ironing received from pieces still at the printer.
 *
 * Printing rows written before printing named its unit (the workbook's own
 * sample rows among them) are not counted: they predate stitching records and
 * cannot be tied to any stitched piece. Giving one a unit on the printing
 * screen brings it into the check from then on.
 */

import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError.js';
import { availableToReceive, balanceAtIroning, undecidedOf } from '../domain/ironing.js';

const D = (v) => new Prisma.Decimal(v ?? 0);

/**
 * The one lock. Stitching already took it under this key; printing and
 * ironing take the same one, so the three serialise on a unit's order.
 */
export async function lockUnitFlow(tx, unit, orderId, styleId) {
  // $executeRaw: pg_advisory_xact_lock returns void (see inventory.service.js).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stitch::${unit}::${orderId}::${styleId}`}, 0))`;
}

const AFTER_STITCHING = { fabricStage: 'AFTER_STITCHING', deletedAt: null, status: { not: 'CANCELLED' } };

/** Every figure for one unit, order and style. */
export async function unitFlow(client, { unit, orderId, styleId }) {
  const [stitched, printed, ironing] = await Promise.all([
    client.stitchingRecord.aggregate({
      where: { unit, orderId, styleId, deletedAt: null },
      _sum: { actualStitched: true },
    }),
    client.printing.aggregate({
      where: { ...AFTER_STITCHING, fromUnit: unit, orderId, styleId },
      _sum: { qty: true, qtyReceived: true },
    }),
    client.ironingEntry.aggregate({
      where: { fromUnit: unit, orderId, styleId, deletedAt: null },
      _sum: { pcsReceived: true, pcsIroned: true, pcsDamaged: true, pcsReIroned: true, pcsRejected: true },
    }),
  ]);
  const s = ironing._sum;
  const f = {
    stitched: D(stitched._sum.actualStitched),
    sentForPrinting: D(printed._sum.qty),
    receivedFromPrinting: D(printed._sum.qtyReceived),
    receivedAtIroning: D(s.pcsReceived),
    ironed: D(s.pcsIroned),
    damaged: D(s.pcsDamaged),
    reIroned: D(s.pcsReIroned),
    rejected: D(s.pcsRejected),
  };
  f.outForPrinting = f.sentForPrinting.minus(f.receivedFromPrinting);
  f.availableToReceive = availableToReceive(f);
  f.balance = balanceAtIroning({ received: f.receivedAtIroning, ironed: f.ironed, damaged: f.damaged, reIroned: f.reIroned });
  f.undecided = undecidedOf(f);
  return f;
}

/** Plain figures for an API response. */
export function flowJson(f) {
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, D(v).toString()]));
}

/**
 * Throws if the write just made breaks the flow. Call it inside the write's
 * transaction, after the write, holding lockUnitFlow().
 *
 * @param label  "B9641IS / TR-0751-008" - for the message
 */
export async function assertFlow(tx, { unit, orderId, styleId }, label) {
  const f = await unitFlow(tx, { unit, orderId, styleId });

  if (f.availableToReceive.lessThan(0)) {
    throw ApiError.conflict(
      `${unit} has stitched ${f.stitched} pieces of ${label}. ${f.outForPrinting} are out for printing and `
        + `${f.receivedAtIroning} have gone to ironing - ${f.availableToReceive.negated()} more than the unit stitched. `
        + 'Pieces cannot leave a unit before they are stitched, and cannot be in two places at once.',
      { flow: flowJson(f) },
    );
  }

  if (f.balance.lessThan(0)) {
    throw ApiError.conflict(
      `Ironing has received ${f.receivedAtIroning} pieces of ${label} from ${unit}, ironed ${f.ironed} and damaged `
        + `${f.damaged} (${f.reIroned} sent back to re-iron). Ironed and damaged would be ${f.balance.negated()} more `
        + 'than were received.',
      { flow: flowJson(f) },
    );
  }

  return f;
}
