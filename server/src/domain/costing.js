/**
 * FOB COSTING - what one bag costs, and what it must be sold for.
 *
 * ===========================================================================
 *  THE SHEET, TOP TO BOTTOM (per piece, rupees)
 * ===========================================================================
 *
 *    material    = SUM(consumption x (1 + wastage) x rate)
 *    conversion  = cmt + print + dye/wash + other
 *    base        = material + conversion
 *    overhead    = base x overhead%
 *    rejection   = (base + overhead) x rejection%
 *    totalCost   = base + overhead + rejection
 *
 *    fobInr      = totalCost / (1 - margin% - commission%)
 *    fobPrice    = fobInr / exchangeRate
 *
 * MARGIN AND COMMISSION ARE SHARES OF THE SELLING PRICE. That is how an
 * export house says it - "12% margin, 3% agent" - and it is not the same as
 * adding 15% to cost: a cost of 100 at 15% on cost sells for 115, earning
 * 13% of the price; at 15% of price it sells for 117.65. Getting this wrong
 * quietly gives away two points on every order.
 *
 * AN UNPRICED MATERIAL LINE MAKES THE SHEET INCOMPLETE, NOT CHEAPER. Every
 * figure that depends on material is null until every line has a rate - a
 * cost sheet that silently counts a missing zip as free is how an order is
 * quoted below cost.
 *
 * Pure. Takes plain values, returns Decimals, touches no database.
 * ===========================================================================
 */

import { Prisma } from '@prisma/client';

const D = (v) => new Prisma.Decimal(v ?? 0);
const blank = (v) => v === undefined || v === null || v === '';
const round = (d, places = 4) => d.toDecimalPlaces(places, Prisma.Decimal.ROUND_HALF_UP);

/** One material line: gross consumption and amount. Amount is null while unpriced. */
export function costLine({ consumption, wastagePct, rate }) {
  const gross = D(consumption).mul(D(1).plus(D(wastagePct)));
  return {
    grossConsumption: round(gross, 6),
    amount: blank(rate) ? null : round(gross.mul(D(rate))),
  };
}

/**
 * The whole sheet.
 *
 * @param {object} sheet header figures (conversion costs, percentages, rate, target)
 * @param {Array<{consumption, wastagePct, rate}>} lines
 */
export function costSheet(sheet, lines) {
  const priced = lines.map(costLine);
  const unpriced = priced.filter((l) => l.amount === null).length;

  const conversion = round(
    D(sheet.cmtCost).plus(D(sheet.printCost)).plus(D(sheet.dyeWashCost)).plus(D(sheet.otherCost)),
  );

  const share = D(sheet.marginPct).plus(D(sheet.commissionPct));
  if (share.greaterThanOrEqualTo(1)) {
    throw new RangeError('Margin and commission together must be less than 100% of the price');
  }

  const empty = {
    lines: priced,
    unpricedLines: unpriced,
    complete: false,
    materialCost: null,
    conversionCost: conversion,
    overheadAmount: null,
    rejectionAmount: null,
    totalCost: null,
    commissionAmount: null,
    marginAmount: null,
    fobInr: null,
    fobPrice: null,
    marginAtTarget: null,
  };
  if (unpriced > 0) return empty;

  const material = round(priced.reduce((a, l) => a.plus(l.amount), D(0)));
  const base = material.plus(conversion);
  const overhead = round(base.mul(D(sheet.overheadPct)));
  const rejection = round(base.plus(overhead).mul(D(sheet.rejectionPct)));
  const total = round(base.plus(overhead).plus(rejection));

  const fobInr = round(total.div(D(1).minus(share)));
  const rate = D(sheet.exchangeRate || 1);
  if (rate.lessThanOrEqualTo(0)) throw new RangeError('The exchange rate must be greater than zero');

  /*
   * The margin the buyer's target would actually earn, after the agent's
   * commission, as a share of that price. Negative means the target is below
   * cost - said as a number rather than hidden.
   */
  let marginAtTarget = null;
  if (!blank(sheet.targetPrice) && D(sheet.targetPrice).greaterThan(0)) {
    const targetInr = D(sheet.targetPrice).mul(rate);
    marginAtTarget = round(
      targetInr.minus(total).minus(targetInr.mul(D(sheet.commissionPct))).div(targetInr),
      6,
    );
  }

  return {
    lines: priced,
    unpricedLines: 0,
    complete: true,
    materialCost: material,
    conversionCost: conversion,
    overheadAmount: overhead,
    rejectionAmount: rejection,
    totalCost: total,
    commissionAmount: round(fobInr.mul(D(sheet.commissionPct))),
    marginAmount: round(fobInr.mul(D(sheet.marginPct))),
    fobInr,
    fobPrice: round(fobInr.div(rate)),
    marginAtTarget,
  };
}

/**
 * The margin an ORDER actually earns at its agreed price against an approved
 * sheet - shown on the order so a price below cost is visible when agreed,
 * not at the year-end.
 *
 * @returns {object|null} null when either side is missing
 */
export function marginAtPrice({ unitPrice, exchangeRate, totalCost, commissionPct }) {
  if (blank(unitPrice) || blank(totalCost) || blank(exchangeRate)) return null;
  const priceInr = D(unitPrice).mul(D(exchangeRate));
  if (priceInr.lessThanOrEqualTo(0)) return null;
  const earned = priceInr.minus(D(totalCost)).minus(priceInr.mul(D(commissionPct)));
  return {
    priceInr: round(priceInr),
    marginInr: round(earned),
    marginPct: round(earned.div(priceInr), 6),
  };
}
