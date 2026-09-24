/**
 * GST on a purchase.
 *
 * ===========================================================================
 *  WHAT DECIDES THE TAX
 * ===========================================================================
 *
 *  Two things, and neither is a constant in this file.
 *
 *  1. THE RATE comes from the document. It is chosen from the `GST Rate`
 *     master list, which holds the statutory slabs (0, 5, 12, 18, 28). It is
 *     not derived here and not defaulted here: an invoice that quietly assumed
 *     5% would be a tax figure nobody chose, printed on paper that leaves the
 *     building.
 *
 *  2. THE SPLIT comes from where the vendor is. A GSTIN's first two digits are
 *     the state code, so comparing the vendor's against the company's answers
 *     it without anybody typing anything:
 *
 *         same state      CGST + SGST, half the rate each   (intra-state)
 *         different state IGST, the whole rate              (inter-state)
 *
 *     This is the one rule in the file, and it is the actual rule.
 *
 * ---------------------------------------------------------------------------
 *  ROUNDING
 *
 *  Each component is rounded to two decimals on its own, then the total is the
 *  sum of the rounded parts. That is the order a tax authority expects and it
 *  is what the CHECK constraints assert, so the printed invoice, the stored
 *  row and the database all agree to the paisa.
 *
 *  Never a JavaScript number. `Prisma.Decimal` throughout.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError.js';
import prisma from '../config/prisma.js';

const D = (v) => new Prisma.Decimal(v ?? 0);

/** The stored scale for money. */
const MONEY_DP = 2;

/** The master list the rate is chosen from. */
export const GST_RATE_LIST = 'GST Rate';

export const SUPPLY_TYPE = {
  INTRA_STATE: 'INTRA_STATE',
  INTER_STATE: 'INTER_STATE',
};

// ---------------------------------------------------------------------------
//  Where the parties are
// ---------------------------------------------------------------------------

/**
 * The state code embedded in a GSTIN.
 *
 * A GSTIN is 15 characters and opens with a two-digit state code:
 *
 *     08 AAACR 5055 K 1 Z 5
 *     ^^ Rajasthan
 *
 * Returns null for anything that is not a plausible GSTIN, because an
 * unregistered vendor has none and that is a legitimate state to be in - it is
 * not an error, it just means the split cannot be derived from the number.
 */
export function stateCodeOf(gstin) {
  const cleaned = String(gstin ?? '').trim().toUpperCase();
  if (!/^\d{2}[A-Z0-9]{13}$/.test(cleaned)) return null;
  return cleaned.slice(0, 2);
}

/**
 * Intra-state or inter-state.
 *
 * @param {string} vendorGstin
 * @param {string} companyStateCode  Two digits, from config.
 * @returns {{supplyType: string, vendorStateCode: string|null, derived: boolean}}
 *
 * `derived` says whether the answer came from the vendor's GSTIN or from the
 * fallback. The fallback is INTRA_STATE, because an unregistered vendor is
 * almost always a local one - but the flag travels with the answer so the
 * screen can say "assumed" rather than presenting a guess as a fact.
 */
export function resolveSupplyType(vendorGstin, companyStateCode) {
  const vendorStateCode = stateCodeOf(vendorGstin);
  if (!vendorStateCode) {
    return { supplyType: SUPPLY_TYPE.INTRA_STATE, vendorStateCode: null, derived: false };
  }
  return {
    supplyType:
      vendorStateCode === String(companyStateCode)
        ? SUPPLY_TYPE.INTRA_STATE
        : SUPPLY_TYPE.INTER_STATE,
    vendorStateCode,
    derived: true,
  };
}

// ---------------------------------------------------------------------------
//  The arithmetic
// ---------------------------------------------------------------------------

/**
 * Splits a taxable value at a rate.
 *
 * @param {object} input
 * @param {string|Decimal} input.taxableValue  The amount before tax.
 * @param {string|Decimal} input.gstRatePct    A FRACTION: 0.05 is five percent.
 * @param {string} input.supplyType
 * @returns {{taxableValue, cgstAmount, sgstAmount, igstAmount, totalTax, invoiceTotal, cgstRatePct, sgstRatePct, igstRatePct}}
 *          every figure a Decimal.
 */
export function calculateGst({ taxableValue, gstRatePct, supplyType }) {
  const taxable = D(taxableValue).toDecimalPlaces(MONEY_DP);
  const rate = D(gstRatePct);

  if (rate.isNegative() || rate.greaterThanOrEqualTo(1)) {
    throw ApiError.badRequest(
      'A GST rate is a fraction between 0 and 1 - 0.05 for five percent.',
      { field: 'gstRatePct', received: rate.toString() },
    );
  }
  if (taxable.isNegative()) {
    throw ApiError.badRequest('A taxable value cannot be negative', { field: 'taxableValue' });
  }

  const interState = supplyType === SUPPLY_TYPE.INTER_STATE;

  // Half each for CGST and SGST. Dividing a decimal by two is exact, so the two
  // halves always sum back to the whole rate - no split-rounding drift.
  const halfRate = rate.dividedBy(2);

  const cgstAmount = interState
    ? D(0)
    : taxable.times(halfRate).toDecimalPlaces(MONEY_DP);
  const sgstAmount = interState
    ? D(0)
    : taxable.times(halfRate).toDecimalPlaces(MONEY_DP);
  const igstAmount = interState
    ? taxable.times(rate).toDecimalPlaces(MONEY_DP)
    : D(0);

  const totalTax = cgstAmount.plus(sgstAmount).plus(igstAmount);

  return {
    taxableValue: taxable,
    gstRatePct: rate,
    supplyType: interState ? SUPPLY_TYPE.INTER_STATE : SUPPLY_TYPE.INTRA_STATE,
    cgstRatePct: interState ? D(0) : halfRate,
    sgstRatePct: interState ? D(0) : halfRate,
    igstRatePct: interState ? rate : D(0),
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalTax,
    // The sum of the ROUNDED parts, which is what the constraint asserts and
    // what the printed invoice shows. Not taxable x (1 + rate), which can
    // differ by a paisa.
    invoiceTotal: taxable.plus(totalTax),
  };
}

// ---------------------------------------------------------------------------
//  The rate, from the master list
// ---------------------------------------------------------------------------

/**
 * The GST slabs, as fractions, from the `GST Rate` master list.
 *
 * The list holds the statutory slabs as text ("5%", "12%") with the fraction in
 * `attributes.rate`. Reading the fraction from the row rather than parsing the
 * label means a rate change is a data edit by Head Office, exactly like the
 * excess rules - and there is no percentage written anywhere in this file.
 */
export async function rateOptions() {
  const list = await prisma.masterList.findFirst({
    where: { code: GST_RATE_LIST, deletedAt: null },
    include: {
      values: {
        where: { isActive: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!list) return [];

  return list.values.map((v) => ({
    value: v.value,
    /** The fraction to store on the document. */
    rate: D(v.attributes?.rate ?? 0).toString(),
    label: v.value,
  }));
}

/**
 * Turns a chosen slab into the fraction to store.
 *
 * Accepts either the label from the list ("5%") or the fraction itself
 * ("0.05"), because the API is used by both a dropdown and a script.
 */
export async function resolveRate(chosen) {
  if (chosen === null || chosen === undefined || chosen === '') return null;

  const options = await rateOptions();
  const byLabel = options.find((o) => o.value === String(chosen));
  if (byLabel) return D(byLabel.rate);

  const asFraction = D(chosen);
  const permitted = options.some((o) => D(o.rate).equals(asFraction));
  if (!permitted) {
    throw ApiError.badRequest(
      `${chosen} is not one of the GST rates on the "${GST_RATE_LIST}" list.`,
      { field: 'gstRatePct', permitted: options.map((o) => o.value) },
    );
  }
  return asFraction;
}

// ---------------------------------------------------------------------------
//  Amount in words
// ---------------------------------------------------------------------------

/**
 * Re-exported so an invoice and a purchase order say the total the same way.
 *
 * The implementation lives with the purchase order because that is where it was
 * first needed; there is deliberately not a second copy here.
 */
export { amountInWords } from './purchaseOrder.service.js';
