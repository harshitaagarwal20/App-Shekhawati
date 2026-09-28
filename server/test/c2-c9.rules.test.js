/**
 * C2 - C9. RULE TESTS. NO DATABASE REQUIRED.
 *
 * ===========================================================================
 *  WHAT THIS FILE IS FOR, AND WHAT IT IS NOT FOR
 * ===========================================================================
 *
 * Every case below drives a PURE function directly - the arithmetic and the
 * decisions, with no rows and no connection. That is deliberate: these are the
 * rules the whole system turns on, and being able to prove them on a bare Node
 * install means they can be checked by anyone, in seconds, without a database
 * to hand.
 *
 * It is NOT where the database-level guarantees are proved. A CHECK constraint
 * and a trigger cannot be exercised without PostgreSQL, and rule 19 of the
 * brief is explicit that application validation alone does not count as
 * implemented. Those live in `test/c2-c9.constraints.test.js`, which needs a
 * database, and the two files together are what make a rule "done".
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  categoryOf,
  isStationery,
  mappingByCategory,
  subCategoryListFor,
  tryCategoryOf,
} from '../src/domain/itemCategory.js';
import {
  computeRequirement,
  requirementFor,
  assertRequirement,
  NO_REQUIREMENT,
} from '../src/domain/requirement.js';
import { assertNotSelfApproval, canApprove } from '../src/domain/makerChecker.js';
import { assessReturn, expectedReturnQty } from '../src/services/tolerance.service.js';
import { assessReceipt, toleranceFor } from '../src/services/grn.service.js';
import { reconcileFabric } from '../src/services/cuttingIssue.service.js';
import { checkOrderCeiling } from '../src/services/purchaseOrder.service.js';
import { calculateRequirement } from '../src/services/buyerOrder.service.js';

// ===========================================================================
//  C2 - ITEM CATEGORY
// ===========================================================================

describe('C2 - the commercial categories', () => {
  test('fabric maps to FABRIC', () => {
    assert.equal(categoryOf('Fabric'), 'FABRIC');
  });

  test('every trim in the dropdown maps to ACCESSORIES', () => {
    for (const v of ['Accessories', 'Handle', 'Zipper', 'Label', 'Thread', 'Button']) {
      assert.equal(categoryOf(v), 'ACCESSORIES', `${v} should be an accessory`);
    }
  });

  test('packaging material maps to PACKAGING', () => {
    assert.equal(categoryOf('Packaging Material'), 'PACKAGING');
  });

  test('stationery maps to its own category, never to a material', () => {
    assert.equal(categoryOf('Stationery'), 'STATIONERY');
    assert.equal(categoryOf('stationary'), 'STATIONERY', 'the common misspelling resolves too');
    assert.ok(isStationery('Stationery'));
    assert.ok(!isStationery('Fabric'));
  });

  test('sub-category is a stationery article on stationery, a fabric weight elsewhere', () => {
    assert.equal(subCategoryListFor('Stationery'), 'StationeryItem');
    assert.equal(subCategoryListFor('Fabric'), 'FabricSubCat');
    assert.equal(subCategoryListFor(undefined), 'FabricSubCat');
  });

  test('the mapping is case- and whitespace-insensitive', () => {
    assert.equal(categoryOf('  fabric  '), 'FABRIC');
    assert.equal(categoryOf('PACKAGING MATERIAL'), 'PACKAGING');
  });

  /**
   * The important negative. The tempting default - "anything unrecognised is an
   * accessory" - would quietly apply the tightest order tolerance in the system
   * to a material nobody classified.
   */
  test('an unmapped value is REFUSED, not guessed', () => {
    assert.throws(() => categoryOf('Interlining'), /not mapped to one of the purchase categories/);
    assert.equal(tryCategoryOf('Interlining'), null, 'the survey form returns null instead');
  });

  test('every category has at least one dropdown value behind it', () => {
    const m = mappingByCategory();
    for (const c of ['FABRIC', 'ACCESSORIES', 'PACKAGING', 'STATIONERY']) {
      assert.ok(m[c].length > 0, `${c} governs no dropdown value`);
    }
  });
});

// ===========================================================================
//  C2 - ORDER TOLERANCE: the exact cases the brief names
// ===========================================================================

/** The accessories tolerance the C2 brief specifies: 1% order, 5% receipt. */
const ACCESSORIES = { ACCESSORIES: '0.01', GENERAL: '0.01' };

describe('C2 - accessories order tolerance at exactly +1%', () => {
  const line = (qty) => ({
    qty,
    computedRequirementQty: '10000',
    accessoriesItem: 'Cotton Handle',
    uom: 'Pcs',
  });

  test('EXACTLY +1% passes', () => {
    const v = checkOrderCeiling(line('10100'), 'AS_PER_STYLE', 'Accessories', ACCESSORIES);
    assert.equal(v.withinCeiling, true, '10,100 against a 10,000 requirement at 1% is the ceiling');
    assert.equal(v.ceiling, '10100.0000');
    assert.equal(v.exceedsBy, '0.0000');
  });

  /**
   * +1.01%. One piece over the ceiling, and the brief asks for it by name.
   *
   * A boundary test is worth more than a large one: a rule written with >= where
   * it needed > passes every generous case and fails only here.
   */
  test('+1.01% FAILS', () => {
    const v = checkOrderCeiling(line('10101'), 'AS_PER_STYLE', 'Accessories', ACCESSORIES);
    assert.equal(v.withinCeiling, false, '10,101 is one piece past the 1% ceiling');
    assert.equal(v.exceedsBy, '1.0000');
  });

  test('a hair under the ceiling passes', () => {
    const v = checkOrderCeiling(line('10099.9999'), 'AS_PER_STYLE', 'Accessories', ACCESSORIES);
    assert.equal(v.withinCeiling, true);
  });

  test('the ceiling counts what is ALREADY on order against the same requirement', () => {
    const v = checkOrderCeiling(
      { ...line('101'), alreadyOrderedQty: '10000' },
      'AS_PER_STYLE',
      'Accessories',
      ACCESSORIES,
    );
    assert.equal(v.withinCeiling, false, 'two POs share one requirement');
    assert.equal(v.remaining, '100.0000');
  });
});

// ===========================================================================
//  C2 - RECEIPT TOLERANCE IS CUMULATIVE
// ===========================================================================

describe('C2 - receipt tolerance is cumulative across every GRN', () => {
  const order = { orderQty: '1000', inventoryRate: '100', item: 'Fabric' };

  test('the frozen order tolerance is preferred over the category fallback', () => {
    const t = toleranceFor({ item: 'Fabric', receiptTolerancePct: '0.05' });
    assert.equal(t.fraction.toString(), '0.05');
    assert.equal(t.source, 'PURCHASE_ORDER');
  });

  test('a single receipt inside tolerance passes', () => {
    const a = assessReceipt({ ...order, receivingQty: '1020', alreadyReceived: '0', receiptTolerancePct: '0.02' });
    assert.equal(a.toleranceBreached, false);
    assert.equal(a.maxReceivableQty, '1020.0000');
  });

  /**
   * THE CASE THE BRIEF NAMES. Three receipts of 1% each are a 3% over-delivery.
   *
   * Applying the tolerance to each GRN in isolation would pass all three - none
   * of them is individually over 2% - and the store would end up with 30 metres
   * nobody ordered, on three documents that each looked correct.
   */
  test('three receipts of 1% each BREACH a 2% tolerance cumulatively', () => {
    const first = assessReceipt({ ...order, receivingQty: '1010', alreadyReceived: '0', receiptTolerancePct: '0.02' });
    assert.equal(first.toleranceBreached, false, 'the first is 1% over - inside tolerance');

    const second = assessReceipt({ ...order, receivingQty: '10', alreadyReceived: '1010', receiptTolerancePct: '0.02' });
    assert.equal(second.cumulativeReceived, '1020.0000');
    assert.equal(second.toleranceBreached, false, '2% exactly is the ceiling, not past it');

    const third = assessReceipt({ ...order, receivingQty: '10', alreadyReceived: '1020', receiptTolerancePct: '0.02' });
    assert.equal(third.cumulativeReceived, '1030.0000');
    assert.equal(
      third.toleranceBreached,
      true,
      'the third receipt is 1% on its own and 3% cumulatively - it must breach',
    );
  });

  test('exactly at the cumulative ceiling passes; one unit past it does not', () => {
    const at = assessReceipt({ ...order, receivingQty: '1050', alreadyReceived: '0', receiptTolerancePct: '0.05' });
    assert.equal(at.toleranceBreached, false, '5% exactly on a 5% tolerance');

    const past = assessReceipt({ ...order, receivingQty: '1050.0001', alreadyReceived: '0', receiptTolerancePct: '0.05' });
    assert.equal(past.toleranceBreached, true);
  });

  test('headroom says how much more may still be taken', () => {
    const a = assessReceipt({ ...order, receivingQty: '900', alreadyReceived: '0', receiptTolerancePct: '0.02' });
    assert.equal(a.headroomQty, '120.0000', '1020 receivable, 900 taken');
  });
});

describe('C2 - payable quantity is what was received, not what was ordered', () => {
  test('a partial receipt makes only what arrived payable', () => {
    const a = assessReceipt({
      orderQty: '1000',
      receivingQty: '400',
      inventoryRate: '100',
      item: 'Fabric',
      alreadyReceived: '0',
      receiptTolerancePct: '0.02',
    });
    assert.equal(a.payableQty, '400.0000', 'not 1000');
    assert.equal(a.outstandingQty, '600.0000');
  });

  test('a second receipt accumulates the payable quantity', () => {
    const a = assessReceipt({
      orderQty: '1000',
      receivingQty: '300',
      inventoryRate: '100',
      item: 'Fabric',
      alreadyReceived: '400',
      receiptTolerancePct: '0.02',
    });
    assert.equal(a.payableQty, '700.0000');
  });

  test('an over-receipt inside tolerance makes the FULL delivered quantity payable', () => {
    const a = assessReceipt({
      orderQty: '1000',
      receivingQty: '1020',
      inventoryRate: '100',
      item: 'Fabric',
      alreadyReceived: '0',
      receiptTolerancePct: '0.02',
    });
    assert.equal(a.payableQty, '1020.0000', 'payment follows the goods, not the order');
  });
});

// ===========================================================================
//  C3 - SHRINKAGE
// ===========================================================================

describe('C3 - job work shrinkage', () => {
  test('expected return is issued x (1 - tolerance)', () => {
    assert.equal(expectedReturnQty('1000', '0.03').toString(), '970');
    assert.equal(expectedReturnQty('1000', '0.025').toString(), '975');
  });

  /** The two cases the brief names by number. */
  test('2.5% shrinkage against a 3% tolerance PASSES', () => {
    const a = assessReturn({ issuedQty: '1000', returnedQty: '975', shrinkageTolerancePct: '0.03' });
    assert.equal(a.within, true);
    assert.equal(a.requiresScrutiny, false, 'within standard means no checking report');
    assert.equal(a.variationPctDisplay, '2.50');
  });

  test('6% shrinkage against a 3% tolerance is BLOCKED', () => {
    const a = assessReturn({ issuedQty: '1000', returnedQty: '940', shrinkageTolerancePct: '0.03' });
    assert.equal(a.within, false);
    assert.equal(a.requiresScrutiny, true, 'and it demands scrutiny');
    assert.equal(a.variationPctDisplay, '6.00');
    assert.equal(a.beyondToleranceQty, '30.0000', '970 expected, 940 returned');
  });

  test('EXACTLY at tolerance passes - the boundary belongs to the vendor', () => {
    const a = assessReturn({ issuedQty: '1000', returnedQty: '970', shrinkageTolerancePct: '0.03' });
    assert.equal(a.within, true);
  });

  test('one unit past tolerance does not', () => {
    const a = assessReturn({ issuedQty: '1000', returnedQty: '969.9999', shrinkageTolerancePct: '0.03' });
    assert.equal(a.within, false);
  });

  test('returning more than was sent is a gain, and is never a shortfall', () => {
    const a = assessReturn({ issuedQty: '1000', returnedQty: '1010', shrinkageTolerancePct: '0.03' });
    assert.equal(a.within, true);
    assert.equal(a.shortfallQty, '-10.0000');
  });
});

// ===========================================================================
//  C6 - THE FABRIC EQUATION
// ===========================================================================

describe('C6 - issued = consumed + remainder + wastage + fabric damage', () => {
  test('a balanced equation reconciles', () => {
    const r = reconcileFabric({ issuedQty: 100, consumedQty: 80, remainderQty: 15, wastageQty: 5 });
    assert.equal(r.balances, true);
    assert.equal(r.accounted, '100.0000');
  });

  test('fabric damage is separately accounted for', () => {
    const r = reconcileFabric({
      issuedQty: 100,
      consumedQty: 75,
      remainderQty: 15,
      wastageQty: 5,
      fabricDamageQty: 5,
    });
    assert.equal(r.balances, true);
    assert.equal(r.fabricDamage, '5.0000');
  });

  /**
   * The case the whole check exists for: wastage NOT entered.
   *
   * If wastage were derived as the leftover, this would balance by construction
   * and the check would be worthless - the arithmetic would absorb the mis-count
   * in silence. It has to fail.
   */
  test('an unentered wastage does NOT balance', () => {
    const r = reconcileFabric({ issuedQty: 100, consumedQty: 80, remainderQty: 15, wastageQty: 0 });
    assert.equal(r.balances, false);
    assert.equal(r.unaccountedQty, '5.0000');
  });

  test('accounting for more than was issued does not balance either', () => {
    const r = reconcileFabric({ issuedQty: 100, consumedQty: 80, remainderQty: 25, wastageQty: 5 });
    assert.equal(r.balances, false);
    assert.equal(r.overAccountedQty, '10.0000');
  });

  test('fractional quantities reconcile exactly - no floating-point drift', () => {
    const r = reconcileFabric({
      issuedQty: '100.0003',
      consumedQty: '33.3334',
      remainderQty: '33.3334',
      wastageQty: '33.3335',
    });
    assert.equal(r.balances, true, 'decimal arithmetic, not IEEE floats');
  });

  test('a challan with nothing entered trivially balances - and cannot post', () => {
    const r = reconcileFabric({});
    assert.equal(r.balances, true, '0 = 0 + 0 + 0');
    assert.equal(r.issued, '0.0000', 'and post() refuses on issuedQty being zero');
  });
});

// ===========================================================================
//  C9 - THE SHARED REQUIREMENT CALCULATION
// ===========================================================================

const STYLE = {
  id: 's1',
  styleNo: 'TR-0751-008',
  avgFabricUtilizationPerPc: '0.85',
  avgUtilizationUom: 'Mtrs',
  bomLines: [
    {
      lineNo: 2,
      itemCategory: 'Accessories',
      accessoriesItem: 'Cotton Handle',
      uom: 'Pcs',
      avgUtilisationPerPiece: '2',
      wastagePct: '0.01',
      effectiveFrom: new Date('2026-01-01'),
      isActive: true,
      deletedAt: null,
    },
  ],
};

const ORDER = { id: 'o1', orderNo: 'B9641IS', orderQty: '10000', effectiveQty: '10200' };

/**
 * The same style with a Fabric BOM line that declares wastage - the shape the
 * Style Master actually produces, since `syncFabricLine()` mirrors the header
 * utilisation onto a Fabric line but leaves that line's wastage alone.
 */
const STYLE_WITH_FABRIC_WASTAGE = {
  ...STYLE,
  avgFabricUtilizationPerPc: '0.5',
  bomLines: [
    {
      lineNo: 1,
      itemCategory: 'Fabric',
      uom: 'Mtrs',
      avgUtilisationPerPiece: '0.5',
      wastagePct: '0.02',
      effectiveFrom: new Date('2026-01-01'),
      isActive: true,
      deletedAt: null,
    },
    ...STYLE.bomLines,
  ],
};

const FLAT_ORDER = { id: 'o2', orderNo: 'B9642IS', orderQty: '10000', effectiveQty: '10000' };

describe('C9 - one requirement calculation, three callers', () => {
  test('the formula is utilisation x quantity', () => {
    assert.equal(computeRequirement('0.85', '10000').toString(), '8500');
  });

  test('wastage multiplies the result where the BOM declares one', () => {
    assert.equal(computeRequirement('2', '100', '0.01').toString(), '202');
  });

  test('fabric reads the style header, and uses the EFFECTIVE order quantity', () => {
    const r = requirementFor({ style: STYLE, order: ORDER, line: { item: 'Fabric' } });
    assert.equal(r.requirement.toString(), '8670', '0.85 x 10,200 including approved excess');
    assert.equal(r.source, 'STYLE_HEADER');
    assert.match(r.basis, /average utilisation 0\.8500/);
  });

  test('an accessory reads its BOM line, wastage included', () => {
    const r = requirementFor({
      style: STYLE,
      order: ORDER,
      line: { item: 'Accessories', accessoriesItem: 'Cotton Handle' },
    });
    assert.equal(r.requirement.toString(), '20604', '2 x 10,200 x 1.01');
    assert.equal(r.source, 'BOM_LINE');
  });

  /**
   * C9: "Requirement is never silently treated as zero."
   *
   * A style with no utilisation cannot bound a purchase order. Returning 0
   * would be worse than returning nothing: an AS_PER_STYLE order would be
   * capped at zero, or - depending which way the comparison ran - would pass a
   * ceiling of zero that nothing can exceed.
   */
  test('a style with no utilisation returns NULL and says why, never zero', () => {
    const bare = { ...STYLE, avgFabricUtilizationPerPc: '0' };
    const r = requirementFor({ style: bare, order: ORDER, line: { item: 'Fabric' } });
    assert.equal(r.requirement, null);
    assert.equal(r.reason, NO_REQUIREMENT.NO_UTILISATION);
    assert.match(r.basis, /no average fabric utilisation/i);
  });

  test('a material the BOM does not mention returns NULL, not zero', () => {
    const r = requirementFor({ style: STYLE, order: ORDER, line: { item: 'Packaging Material' } });
    assert.equal(r.requirement, null);
    assert.equal(r.reason, NO_REQUIREMENT.NOT_IN_BOM);
  });

  test('no style at all returns NULL', () => {
    const r = requirementFor({ style: null, order: ORDER, line: { item: 'Fabric' } });
    assert.equal(r.requirement, null);
    assert.equal(r.reason, NO_REQUIREMENT.NO_STYLE);
  });

  test('assertRequirement turns a refusal into a clear validation error', () => {
    assert.throws(
      () =>
        assertRequirement({
          style: null,
          order: ORDER,
          line: { item: 'Fabric' },
          forDocument: 'An "as per style" purchase order',
        }),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /as per style.*cannot be raised/i);
        assert.equal(err.details.reason, NO_REQUIREMENT.NO_STYLE);
        return true;
      },
    );
  });

  /*
   * The two gaps that are REPORTED rather than refused. Both still compute no
   * requirement - `requirementFor()` is unchanged and still returns null, as
   * the tests above assert. What changed is that `assertRequirement()` lets
   * the document through, and `checkOrderCeiling()` records it as unbounded.
   */
  test('a BOM line with no utilisation no longer refuses the document', () => {
    const blank = {
      ...STYLE,
      bomLines: [{ ...STYLE.bomLines[0], avgUtilisationPerPiece: '0' }],
    };
    const r = assertRequirement({
      style: blank,
      order: ORDER,
      line: { item: 'Accessories', accessoriesItem: 'Cotton Handle' },
      forDocument: 'An "as per style" purchase order',
    });
    assert.equal(r.requirement, null, 'still no requirement - just no refusal');
    assert.equal(r.reason, NO_REQUIREMENT.NO_UTILISATION);
  });

  test('a material the BOM does not mention no longer refuses the document', () => {
    const r = assertRequirement({
      style: STYLE,
      order: ORDER,
      line: { item: 'Accessories', accessoriesItem: 'Thread' },
      forDocument: 'An "as per style" purchase order',
    });
    assert.equal(r.requirement, null);
    assert.equal(r.reason, NO_REQUIREMENT.NOT_IN_BOM);
  });

  test('a fabric style with no utilisation no longer refuses the document', () => {
    const bare = { ...STYLE, avgFabricUtilizationPerPc: '0' };
    const r = assertRequirement({
      style: bare,
      order: ORDER,
      line: { item: 'Fabric' },
      forDocument: 'An "as per style" purchase order',
    });
    assert.equal(r.requirement, null);
    assert.equal(r.reason, NO_REQUIREMENT.NO_UTILISATION);
  });

  test('an unbounded line is recorded as unbounded, never capped at zero', () => {
    const verdict = checkOrderCeiling(
      { qty: '500', computedRequirementQty: null },
      'AS_PER_STYLE',
      'Accessories',
    );
    assert.equal(verdict.bounded, false);
    assert.equal(verdict.withinCeiling, true, 'it must not be blocked');
    assert.equal(verdict.ceiling, null, 'and must not be capped at zero');
  });

  /**
   * The date-versioning C9 adds. A BOM revision entered in advance must not
   * take over a document dated before it starts.
   */
  test('a BOM line that has not started applying yet does not bound an earlier document', () => {
    const future = {
      ...STYLE,
      bomLines: [{ ...STYLE.bomLines[0], effectiveFrom: new Date('2027-01-01') }],
    };
    const r = requirementFor({
      style: future,
      order: ORDER,
      line: { item: 'Accessories', accessoriesItem: 'Cotton Handle' },
      on: new Date('2026-08-27'),
    });
    assert.equal(r.requirement, null, 'the revision is not in force yet');
    assert.equal(r.reason, NO_REQUIREMENT.NOT_IN_BOM);
  });

  test('the latest version in force on the date wins', () => {
    const revised = {
      ...STYLE,
      bomLines: [
        { ...STYLE.bomLines[0], avgUtilisationPerPiece: '2', effectiveFrom: new Date('2026-01-01') },
        { ...STYLE.bomLines[0], lineNo: 3, avgUtilisationPerPiece: '3', effectiveFrom: new Date('2026-06-01') },
      ],
    };
    const r = requirementFor({
      style: revised,
      order: ORDER,
      line: { item: 'Accessories', accessoriesItem: 'Cotton Handle' },
      on: new Date('2026-08-27'),
    });
    assert.equal(r.perPiece.toString(), '3', 'the June revision, not the January one');
  });

  /**
   * THE POINT OF THE WHOLE CONTROL: planning, the PO ceiling and the cutting
   * challan must show the SAME number. They do, because there is one function.
   */
  test('the same inputs give the same requirement to every caller', () => {
    const args = { style: STYLE, order: ORDER, line: { item: 'Fabric' } };
    const planning = requirementFor(args);
    const poCeiling = requirementFor(args);
    const challan = requirementFor(args);
    assert.equal(planning.requirement.toString(), poCeiling.requirement.toString());
    assert.equal(poCeiling.requirement.toString(), challan.requirement.toString());
  });

  /**
   * FABRIC WASTAGE. The header carries the utilisation and nothing else - the
   * Style model has no wastage column - so the Fabric BOM line is the ONLY
   * declaration of fabric wastage there is. Reading the header and hardcoding
   * a wastage of zero made the PO ceiling and the Cutting Challan enforce a
   * figure below the one the order screen, the BOM explosion and Planning all
   * showed, capping procurement by exactly the wastage factor.
   */
  test('fabric applies the wastage its BOM line declares', () => {
    const r = requirementFor({
      style: STYLE_WITH_FABRIC_WASTAGE,
      order: FLAT_ORDER,
      line: { item: 'Fabric' },
    });
    assert.equal(r.requirement.toString(), '5100', '0.5 x 10,000 x 1.02, not 5,000');
    assert.equal(r.wastagePct.toString(), '0.02');
    assert.equal(r.source, 'STYLE_HEADER', 'the header is still the authority on utilisation');
    assert.equal(r.bomLineNo, 1, 'and it names the line the wastage came from');
    assert.match(r.basis, /2% wastage/);
  });

  test('fabric with no BOM line to declare wastage applies none', () => {
    const r = requirementFor({ style: STYLE, order: ORDER, line: { item: 'Fabric' } });
    assert.equal(r.requirement.toString(), '8670', '0.85 x 10,200, no wastage declared anywhere');
    assert.equal(r.wastagePct.toString(), '0');
    assert.equal(r.bomLineNo, null);
  });

  test('a fabric revision not yet in force does not lend its wastage either', () => {
    const future = {
      ...STYLE_WITH_FABRIC_WASTAGE,
      bomLines: [
        { ...STYLE_WITH_FABRIC_WASTAGE.bomLines[0], effectiveFrom: new Date('2027-01-01') },
      ],
    };
    const r = requirementFor({
      style: future,
      order: FLAT_ORDER,
      line: { item: 'Fabric' },
      on: new Date('2026-08-27'),
    });
    assert.equal(r.requirement.toString(), '5000', 'the 2% revision is not in force yet');
    assert.equal(r.wastagePct.toString(), '0');
  });

  /**
   * THE CLAIM THE FILE MAKES, ENFORCED. `domain/requirement.js` says the three
   * callers agree "by construction rather than by coincidence". That is only
   * true while the header path and the BOM path produce the same number for
   * the same fabric, so the equality is asserted rather than asserted-about.
   */
  test('the PO ceiling agrees with the order screen on fabric, wastage and all', () => {
    const ceiling = requirementFor({
      style: STYLE_WITH_FABRIC_WASTAGE,
      order: ORDER,
      line: { item: 'Fabric' },
    });

    // What buyerOrder.calculateRequirement() - and, through it, Planning -
    // shows the merchandiser for the same style and the same order.
    const orderScreen = calculateRequirement(
      STYLE_WITH_FABRIC_WASTAGE,
      ORDER.orderQty,
      ORDER.effectiveQty,
    );
    const fabricLine = orderScreen.lines.find((l) => l.itemCategory === 'Fabric');

    assert.equal(
      ceiling.requirement.toFixed(4),
      fabricLine.withExcess,
      'the ceiling must not cap procurement below what the business was shown',
    );
    assert.equal(ceiling.wastagePct.toFixed(6), fabricLine.wastagePct);
    assert.equal(ceiling.perPiece.toFixed(4), fabricLine.avgUtilisationPerPiece);
  });
});

// ===========================================================================
//  MAKER-CHECKER
// ===========================================================================

describe('Maker-checker is disabled', () => {
  /*
   * Switched off at the owner's instruction - see domain/makerChecker.js. The
   * author of a document may now approve it. Asserted rather than deleted, so
   * that turning the control back on is a visible test failure here.
   */
  test('the author is allowed', () => {
    assert.doesNotThrow(() =>
      assertNotSelfApproval({ createdById: 'u1' }, { userId: 'u1' }, 'cutting challan'),
    );
    assert.equal(canApprove({ createdById: 'u1' }, { userId: 'u1' }), true);
  });

  test('anybody else is allowed', () => {
    assert.doesNotThrow(() => assertNotSelfApproval({ createdById: 'u1' }, { userId: 'u2' }));
    assert.equal(canApprove({ createdById: 'u1' }, { userId: 'u2' }), true);
  });

  test('an unknown maker does not block approval', () => {
    assert.doesNotThrow(() => assertNotSelfApproval({ createdById: null }, { userId: 'u1' }));
    assert.doesNotThrow(() => assertNotSelfApproval({ createdById: 'u1' }, {}));
  });
});
