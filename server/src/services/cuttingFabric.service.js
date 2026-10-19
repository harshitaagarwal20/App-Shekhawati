/**
 * The fabric that came onto the cutting floor, and what became of it.
 *
 *     issued = consumed + remainder + remnants + wastage + fabric damage
 *
 * ---------------------------------------------------------------------------
 *  WHO CALLS THIS
 *
 *  The Cut Pieces Receipt. It is where the cutting floor reports its output -
 *  the pieces it cut, and the cloth it cut them from - so it is where the
 *  fabric is accounted for and taken off the cutting floor in the ledger.
 *
 *  The Cutting Issue used to do it, and still does for a draft that already
 *  carried the figures when the change was made. It now sends checked pieces
 *  to stitching and moves no cloth.
 *
 *  Both go through `postCuttingFabric()`, so the ledger legs are written one
 *  way whichever document carries them.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import { ApiError, ERROR_CODES } from '../utils/ApiError.js';
import {
  DEFAULT_LOCATION,
  LOCATION,
  assertRollNoAvailable,
  postMovement,
} from './inventory.service.js';
import { takeNewest } from '../domain/fifo.js';

const D = (v) => new Prisma.Decimal(v ?? 0);

/**
 * C6 - THE FABRIC EQUATION. Pure, so it can be proved without a database.
 *
 * WASTAGE IS STATED, NOT DERIVED. Computing it as "whatever is left over"
 * would make this identity hold by construction and therefore test nothing:
 * the arithmetic would absorb a mis-count in silence, which is the exact
 * failure the check exists to catch.
 */
export function reconcileFabric({
  issuedQty, consumedQty, remainderQty, remnantQty, wastageQty, fabricDamageQty,
}) {
  const issued = D(issuedQty ?? 0);
  const consumed = D(consumedQty ?? 0);
  const remainder = D(remainderQty ?? 0);
  // End-bits kept as remnants: neither back on the roll nor in the bin.
  const remnant = D(remnantQty ?? 0);
  const wastage = D(wastageQty ?? 0);
  const fabricDamage = D(fabricDamageQty ?? 0);
  const accounted = consumed.plus(remainder).plus(remnant).plus(wastage).plus(fabricDamage);
  const difference = issued.minus(accounted);

  return {
    issued: issued.toFixed(4),
    consumed: consumed.toFixed(4),
    remainder: remainder.toFixed(4),
    remnant: remnant.toFixed(4),
    wastage: wastage.toFixed(4),
    fabricDamage: fabricDamage.toFixed(4),
    accounted: accounted.toFixed(4),
    differenceQty: difference.toFixed(4),
    unaccountedQty: difference.greaterThan(0) ? difference.toFixed(4) : '0.0000',
    overAccountedQty: difference.lessThan(0) ? difference.abs().toFixed(4) : '0.0000',
    balances: difference.isZero(),
  };
}

/** The equation as a sentence, for a refusal or a confirmation. */
export function describeFabric(f) {
  return (
    `${f.issued} received = ${f.consumed} consumed + ${f.remainder} returned + ` +
    `${f.remnant} remnants + ${f.wastage} wastage + ${f.fabricDamage} damaged`
  );
}

/**
 * Refuses figures that do not balance, in a sentence that says by how much.
 */
export function assertFabricBalances(figures, label) {
  if (figures.balances) return;
  throw ApiError.badRequest(
    `${label}: ${figures.issued} came onto the cutting floor and ${figures.accounted} is ` +
      `accounted for (${describeFabric(figures)}). ` +
      (D(figures.differenceQty).greaterThan(0)
        ? `${figures.unaccountedQty} is unaccounted for - enter the wastage; it is never inferred.`
        : `${figures.overAccountedQty} more is accounted for than came onto the floor.`),
    { field: 'issuedQty', code: ERROR_CODES.VERIFICATION_FAILED, details: { figures } },
  );
}

/**
 * The fabric issue the cut cloth came from, checked: it exists, it posted, it
 * is for this order, and it put the cloth on the cutting floor.
 */
export async function resolveCuttingFabricIssue(tx, fabricIssueId, { orderId, label }) {
  const fabricIssue = await tx.fabricIssue.findFirst({
    where: { id: fabricIssueId, deletedAt: null },
    include: { roll: { select: { id: true, rollNo: true } } },
  });
  if (!fabricIssue) {
    throw ApiError.badRequest('That fabric issue does not exist', { field: 'fabricIssueId' });
  }
  if (!fabricIssue.postedAt) {
    throw ApiError.conflict(
      `${fabricIssue.issueNo} has not been posted, so its fabric never reached the cutting floor.`,
      { field: 'fabricIssueId' },
    );
  }
  if (orderId && fabricIssue.orderId !== orderId) {
    throw ApiError.badRequest(
      `${fabricIssue.issueNo} was issued for a different order than ${label}.`,
      { field: 'fabricIssueId' },
    );
  }
  return fabricIssue;
}

/**
 * C6 - THE LEDGER LEGS, written inside the caller's transaction.
 *
 *     OUT  cutting floor   everything that came onto the floor
 *     IN   main store      the remainder, on the SAME roll
 *     IN   remnant store   the end-bits, as a short roll of their own
 *
 * No balance is touched directly: every movement goes through
 * `postMovement()`, which appends to the ledger and re-derives the balance.
 *
 * @param {object} p
 * @param {object} p.doc  `{ documentType, id, no, date, orderId, uom, location }`
 *                        - the document the movements are written against.
 * @param {object} p.fabricIssue  from `resolveCuttingFabricIssue()`.
 * @param {object} p.figures  the six quantities, already reconciled.
 */
export async function postCuttingFabric(tx, { doc, fabricIssue, figures, actor }) {
  const roll = await tx.fabricRoll.findUnique({
    where: { id: fabricIssue.roll?.id ?? fabricIssue.rollId },
    include: { inventoryItem: { select: { id: true, itemCategory: true } } },
  });

  if (!roll?.inventoryItemId) {
    throw ApiError.conflict(
      `Roll ${roll?.rollNo ?? ''} is not linked to a stock item, so the cutting movements could ` +
        'not be written to the ledger.',
      { code: ERROR_CODES.VERIFICATION_FAILED },
    );
  }

  const from = doc.location ?? LOCATION.CUTTING_FLOOR;

  // A fabric issue raised before the in-process locations existed left nothing
  // at the cutting floor to draw down. Say so, rather than posting a document
  // with no ledger behind it.
  if (!fabricIssue.inProcessLocation) {
    throw new ApiError(
      409,
      `Fabric issue ${fabricIssue.issueNo} predates the cutting-floor stock location, so there ` +
        `is no balance at ${from} to take this fabric from. Raise a fresh fabric issue against ` +
        'an approved cutting challan and account for the fabric against that.',
      {
        code: ERROR_CODES.VERIFICATION_FAILED,
        details: { field: 'fabricIssueId', issueNo: fabricIssue.issueNo, legacyIssue: true },
      },
    );
  }

  const consumed = D(figures.consumedQty);
  const wastage = D(figures.wastageQty);
  const fabricDamage = D(figures.fabricDamageQty);
  const remainder = D(figures.remainderQty);
  const remnant = D(figures.remnantQty);
  const uom = doc.uom ?? roll.uom;

  const snapshot = {
    itemCategory: roll.inventoryItem?.itemCategory ?? 'Fabric',
    colorCode: roll.colorCode,
    gsm: roll.gsm,
    content: roll.content,
    uom: roll.uom,
  };
  const ref = {
    entryDate: doc.date,
    documentType: doc.documentType,
    documentId: doc.id,
    documentNo: doc.no,
    orderId: doc.orderId,
    snapshot,
    actor,
  };

  // ---- OUT: EVERYTHING that came onto the floor --------------------------
  //
  // The remainder is in BOTH legs on purpose: out of the floor, back into the
  // store. Taking out only consumption and wastage once left the remainder on
  // the floor AND added it to the store, so it existed twice.
  const leaving = consumed.plus(wastage).plus(fabricDamage).plus(remainder).plus(remnant);

  // PER ROLL, not just per item. `postMovement()` refuses an OUT larger than
  // the ITEM holds at the cutting floor, which another roll of the same
  // fabric could cover - and then this roll's ledger would go negative.
  const onFloor = await tx.stockLedger.aggregate({
    where: { rollId: roll.id, location: from },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const available = D(onFloor._sum.qtyIn).minus(D(onFloor._sum.qtyOut));
  if (leaving.greaterThan(available)) {
    throw ApiError.conflict(
      `Only ${available.toFixed(2)} ${uom} of roll ${roll.rollNo} is on the cutting floor, so ` +
        `${leaving.toFixed(2)} cannot be accounted for against it. Earlier receipts may already ` +
        'have taken the rest.',
      { field: 'issuedQty', code: ERROR_CODES.VERIFICATION_FAILED },
    );
  }

  // FIFO - the remainder and remnants go back carrying the NEWEST part of the
  // cost: the oldest cloth is the cloth that was cut.
  let backToStore = [];
  let toRemnants = [];
  if (leaving.greaterThan(0)) {
    const out = await postMovement(tx, {
      ...ref,
      itemId: roll.inventoryItemId,
      rollId: roll.id,
      direction: 'OUT',
      qty: leaving,
      rate: roll.rate ?? 0,
      location: from,
      remarks:
        `Cut on ${doc.no}: ${consumed.toFixed(4)} ${uom} consumed` +
        (wastage.greaterThan(0) ? `, ${wastage.toFixed(4)} wastage` : '') +
        (fabricDamage.greaterThan(0) ? `, ${fabricDamage.toFixed(4)} fabric damage` : '') +
        (remainder.greaterThan(0) ? `, ${remainder.toFixed(4)} returned to store` : '') +
        (remnant.greaterThan(0) ? `, ${remnant.toFixed(4)} kept as remnants` : ''),
    });
    [backToStore, toRemnants] = takeNewest(out.consumed, [remainder, remnant]);
  }

  // ---- IN: the remnants, as a short roll of their own ---------------------
  let remnantRoll = null;
  if (remnant.greaterThan(0)) {
    const siblings = await tx.fabricRoll.count({ where: { parentRollId: roll.id } });
    const remnantNo = `${roll.rollNo}-R${siblings + 1}`;
    await assertRollNoAvailable(tx, remnantNo);
    remnantRoll = await tx.fabricRoll.create({
      data: {
        rollNo: remnantNo,
        isRemnant: true,
        parentRollId: roll.id,
        grnId: roll.grnId,
        vendorId: roll.vendorId,
        inventoryItemId: roll.inventoryItemId,
        fabricName: roll.fabricName,
        colorCode: roll.colorCode,
        content: roll.content,
        count: roll.count,
        construction: roll.construction,
        width: roll.width,
        gsm: roll.gsm,
        uom: roll.uom,
        shade: roll.shade ?? null,
        dyeLot: roll.dyeLot ?? null,
        receivedQty: remnant,
        balanceQty: remnant,
        rate: roll.rate,
        stage: 'RAW',
        location: LOCATION.REMNANT_STORE,
        remarks: `End-bits from ${doc.no}, cut from roll ${roll.rollNo}`,
        createdById: actor.userId ?? null,
        updatedById: actor.userId ?? null,
      },
    });

    await postMovement(tx, {
      ...ref,
      itemId: roll.inventoryItemId,
      rollId: remnantRoll.id,
      direction: 'IN',
      qty: remnant,
      rate: roll.rate ?? 0,
      carryCost: toRemnants,
      location: LOCATION.REMNANT_STORE,
      remarks:
        `Remnants from ${doc.no}: ${remnant.toFixed(4)} ${uom} of roll ${roll.rollNo}, ` +
        `booked as ${remnantNo}`,
    });
  }

  // ---- IN: the remainder, back on the rack, on the SAME roll -------------
  if (remainder.greaterThan(0)) {
    await postMovement(tx, {
      ...ref,
      itemId: roll.inventoryItemId,
      // THE ROLL IDENTITY: the cloth going back is the cloth that came off
      // this roll, so it can still be traced to the GRN that received it.
      rollId: roll.id,
      direction: 'IN',
      qty: remainder,
      rate: roll.rate ?? 0,
      carryCost: backToStore,
      location: DEFAULT_LOCATION,
      remarks:
        `Remainder returned to store on ${doc.no}: ${remainder.toFixed(4)} ${uom} of roll ` +
        `${roll.rollNo}`,
    });
  }

  /*
   * The roll follows its cloth.
   *
   * `balanceQty` is what is physically on the roll in the store - the fabric
   * issue took the cut length OFF it. So the remainder is ADDED BACK, never
   * written over it: a 250-metre roll that sent 100 to cutting still has 150
   * on the rack, and setting the balance to a 15-metre remainder would lose
   * them. (The cutting issue used to write it that way.)
   *
   * Whether cloth from this roll is still on the cutting floor is read from
   * the ledger: several receipts can draw on one issue, and one accounting for
   * 40 of 100 metres must not call the roll finished while 60 are being cut.
   */
  const floor = await tx.stockLedger.aggregate({
    where: { rollId: roll.id, location: from },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const stillOnFloor = D(floor._sum.qtyIn).minus(D(floor._sum.qtyOut)).greaterThan(0);
  const onRoll = D(roll.balanceQty).plus(remainder);

  await tx.fabricRoll.update({
    where: { id: roll.id },
    data: {
      balanceQty: { increment: remainder },
      location: onRoll.greaterThan(0) ? DEFAULT_LOCATION : roll.location,
      stage: stillOnFloor ? 'ISSUED_TO_CUTTING' : onRoll.greaterThan(0) ? 'RAW' : 'CONSUMED',
      updatedById: actor.userId ?? null,
    },
  });

  return {
    moved: leaving.greaterThan(0) || remainder.greaterThan(0),
    itemId: roll.inventoryItemId,
    remnantRollNo: remnantRoll?.rollNo ?? null,
  };
}
