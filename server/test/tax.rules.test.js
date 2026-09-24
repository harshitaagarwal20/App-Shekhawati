/**
 * GST on a purchase invoice.
 *
 * ===========================================================================
 *  WHY THESE ARE WORTH ASSERTING
 * ===========================================================================
 *
 * A purchase invoice is paid against. If the figure the browser shows, the
 * figure the database stores and the figure a vendor expects ever disagree by a
 * paisa, it is found out by somebody holding a piece of paper - not by a stack
 * trace.
 *
 * So the arithmetic is tested at the boundaries where money usually goes wrong:
 * rounding a half, splitting an odd rate in two, and the difference between
 * "taxed at zero" and "not taxed at all".
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import {
  SUPPLY_TYPE,
  calculateGst,
  resolveSupplyType,
  stateCodeOf,
} from '../src/services/tax.service.js';

const D = (v) => new Prisma.Decimal(v);

// ===========================================================================
//  WHERE THE VENDOR IS
// ===========================================================================

describe('GST - the state code decides the split', () => {
  test('reads the state code out of a GSTIN', () => {
    assert.equal(stateCodeOf('08AAACR5055K1Z5'), '08');
    assert.equal(stateCodeOf('27AAACR5055K1Z5'), '27');
    // Case and padding are the caller's accident, not the vendor's.
    assert.equal(stateCodeOf('  08aaacr5055k1z5  '), '08');
  });

  test('refuses anything that is not a GSTIN', () => {
    for (const bad of ['', null, undefined, 'NOTAGSTIN', '8AAACR5055K1Z5', '08AAACR5055K1Z']) {
      assert.equal(stateCodeOf(bad), null, `${bad} should not yield a state code`);
    }
  });

  test('same state is CGST + SGST', () => {
    const r = resolveSupplyType('08AAACR5055K1Z5', '08');
    assert.equal(r.supplyType, SUPPLY_TYPE.INTRA_STATE);
    assert.equal(r.derived, true);
  });

  test('another state is IGST', () => {
    const r = resolveSupplyType('27AAACR5055K1Z5', '08');
    assert.equal(r.supplyType, SUPPLY_TYPE.INTER_STATE);
    assert.equal(r.derived, true);
  });

  test('an unregistered vendor is assumed local, and says so', () => {
    const r = resolveSupplyType(null, '08');
    assert.equal(r.supplyType, SUPPLY_TYPE.INTRA_STATE);
    // The flag is the point: a screen can say "assumed" instead of presenting a
    // guess as a fact.
    assert.equal(r.derived, false);
    assert.equal(r.vendorStateCode, null);
  });
});

// ===========================================================================
//  THE ARITHMETIC
// ===========================================================================

describe('GST - intra-state splits the rate in half', () => {
  const gst = calculateGst({
    taxableValue: '801000.00',
    gstRatePct: '0.05',
    supplyType: SUPPLY_TYPE.INTRA_STATE,
  });

  test('CGST and SGST are half the rate each', () => {
    assert.equal(gst.cgstAmount.toFixed(2), '20025.00');
    assert.equal(gst.sgstAmount.toFixed(2), '20025.00');
  });

  test('no IGST on a local purchase', () => {
    assert.equal(gst.igstAmount.toFixed(2), '0.00');
  });

  test('the total is the taxable value plus the tax', () => {
    assert.equal(gst.invoiceTotal.toFixed(2), '841050.00');
  });

  test('the two halves add back to the whole rate', () => {
    // Not a tautology: it is what stops 5% printing as two lines of 2.5% that
    // sum to 4.99%.
    assert.equal(gst.cgstRatePct.plus(gst.sgstRatePct).toString(), '0.05');
  });
});

describe('GST - inter-state charges the whole rate as IGST', () => {
  const gst = calculateGst({
    taxableValue: '801000.00',
    gstRatePct: '0.05',
    supplyType: SUPPLY_TYPE.INTER_STATE,
  });

  test('IGST carries all of it', () => {
    assert.equal(gst.igstAmount.toFixed(2), '40050.00');
    assert.equal(gst.cgstAmount.toFixed(2), '0.00');
    assert.equal(gst.sgstAmount.toFixed(2), '0.00');
  });

  test('and the total is the same as the local one', () => {
    // The split changes who gets the money, never how much is due.
    const local = calculateGst({
      taxableValue: '801000.00',
      gstRatePct: '0.05',
      supplyType: SUPPLY_TYPE.INTRA_STATE,
    });
    assert.equal(gst.invoiceTotal.toFixed(2), local.invoiceTotal.toFixed(2));
  });
});

describe('GST - rounding is where money goes wrong', () => {
  test('each component rounds on its own, then they are summed', () => {
    // 1000.01 x 18% = 180.0018. Half is 90.0009 -> 90.00 each.
    const gst = calculateGst({
      taxableValue: '1000.01',
      gstRatePct: '0.18',
      supplyType: SUPPLY_TYPE.INTRA_STATE,
    });
    assert.equal(gst.cgstAmount.toFixed(2), '90.00');
    assert.equal(gst.sgstAmount.toFixed(2), '90.00');
    assert.equal(gst.invoiceTotal.toFixed(2), '1180.01');
  });

  test('a half rounds up, matching the database ROUND()', () => {
    // 0.10 x 5% = 0.005, which must round to 0.01 - the same way PostgreSQL
    // ROUND() does, or the CHECK constraint would refuse the row.
    const gst = calculateGst({
      taxableValue: '0.10',
      gstRatePct: '0.05',
      supplyType: SUPPLY_TYPE.INTER_STATE,
    });
    assert.equal(gst.igstAmount.toFixed(2), '0.01');
  });

  test('the total is the sum of the ROUNDED parts, not a recomputed product', () => {
    const gst = calculateGst({
      taxableValue: '333.33',
      gstRatePct: '0.18',
      supplyType: SUPPLY_TYPE.INTRA_STATE,
    });
    const summed = D(gst.taxableValue)
      .plus(gst.cgstAmount)
      .plus(gst.sgstAmount)
      .plus(gst.igstAmount);
    assert.equal(gst.invoiceTotal.toFixed(2), summed.toFixed(2));
  });

  test('never a floating-point number', () => {
    const gst = calculateGst({
      taxableValue: '801000.00',
      gstRatePct: '0.05',
      supplyType: SUPPLY_TYPE.INTRA_STATE,
    });
    for (const [field, value] of Object.entries(gst)) {
      if (field === 'supplyType') continue;
      assert.ok(
        Prisma.Decimal.isDecimal(value),
        `${field} came back as a ${typeof value}, not a Decimal`,
      );
    }
  });
});

describe('GST - zero is not the same as absent', () => {
  test('a zero rate is a real rate and produces no tax', () => {
    const gst = calculateGst({
      taxableValue: '5000.00',
      gstRatePct: '0',
      supplyType: SUPPLY_TYPE.INTRA_STATE,
    });
    assert.equal(gst.totalTax.toFixed(2), '0.00');
    assert.equal(gst.invoiceTotal.toFixed(2), '5000.00');
  });

  test('a rate outside 0..1 is refused', () => {
    // The commonest mistake in the whole feature: writing 5 for five percent.
    for (const bad of ['5', '18', '1', '-0.05']) {
      assert.throws(
        () => calculateGst({ taxableValue: '100', gstRatePct: bad, supplyType: 'INTRA_STATE' }),
        /fraction between 0 and 1/,
        `${bad} should be refused`,
      );
    }
  });

  test('a negative taxable value is refused', () => {
    assert.throws(
      () => calculateGst({ taxableValue: '-1', gstRatePct: '0.05', supplyType: 'INTRA_STATE' }),
      /cannot be negative/,
    );
  });
});

describe('GST - the seeded workbook figures', () => {
  test('RF-001: 4500 Mtrs x 178.00 at 5%, local vendor', () => {
    // The first purchase order in the workbook, taxed as a Jaipur vendor would
    // tax it. The taxable value is the figure the GRN already stores.
    const gst = calculateGst({
      taxableValue: '801000.00',
      gstRatePct: '0.05',
      supplyType: resolveSupplyType('08AAACR5055K1Z5', '08').supplyType,
    });
    assert.equal(gst.taxableValue.toFixed(2), '801000.00');
    assert.equal(gst.cgstAmount.toFixed(2), '20025.00');
    assert.equal(gst.sgstAmount.toFixed(2), '20025.00');
    assert.equal(gst.igstAmount.toFixed(2), '0.00');
    assert.equal(gst.invoiceTotal.toFixed(2), '841050.00');
  });

  test('MA-001: 9000 Pcs x 12.00 at 18%, out-of-state vendor', () => {
    const gst = calculateGst({
      taxableValue: '108000.00',
      gstRatePct: '0.18',
      supplyType: resolveSupplyType('27AAACM1234K1Z9', '08').supplyType,
    });
    assert.equal(gst.igstAmount.toFixed(2), '19440.00');
    assert.equal(gst.invoiceTotal.toFixed(2), '127440.00');
  });
});
