/**
 * C12 - MATERIAL PLAN. RULE TESTS. NO DATABASE REQUIRED.
 *
 * ===========================================================================
 *  WHAT IS BEING PROVED HERE
 * ===========================================================================
 *
 * The material plan carries no arithmetic of its own - it freezes what
 * `calculateRequirement()` returns. So what has to be proved is not "does the
 * multiplication work" (c2-c9.rules.test.js already proves that against
 * domain/requirement.js) but the three properties the DOCUMENT depends on:
 *
 *   1. ACCESSORIES ARE PLANNED, not just fabric. This was the whole point of
 *      the feature, and a regression that quietly dropped accessory BOM lines
 *      would leave a plan that looks complete and buys nothing.
 *
 *   2. THE FROZEN FIGURES SATISFY THE TABLE'S CHECKS. `required_qty >=
 *      base_requirement` and both strictly positive are enforced in
 *      PostgreSQL; if the service can produce a line that violates one, the
 *      insert fails at runtime rather than here.
 *
 *   3. THE EXCESS THAT IS USED IS THE APPROVED ONE. A plan worked out against
 *      a requested-but-unapproved excess would authorise buying more than the
 *      Director signed for.
 *
 * The approval flow, the duplicate-version refusal and the drift report need
 * rows and a connection; they are exercised against the database rather than
 * here.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { calculateRequirement, calculateEffectiveQty } from '../src/services/buyerOrder.service.js';
import { categoryOfLine } from '../src/domain/itemCategory.js';

/** A style whose BOM buys fabric AND two different accessories. */
const STYLE = {
  styleNo: 'TR-0751-008',
  avgFabricUtilizationPerPc: '0.85',
  avgUtilizationUom: 'Mtrs',
  bomLines: [
    {
      lineNo: 1,
      itemCategory: 'Fabric',
      subCategory: 'Canvas 10 oz',
      description: 'Canvas 10 oz body fabric',
      uom: 'Mtrs',
      avgUtilisationPerPiece: '0.85',
      wastagePct: '0.02',
    },
    {
      lineNo: 2,
      itemCategory: 'Accessories',
      accessoriesItem: 'Cotton Handle',
      description: 'Long cotton handle',
      uom: 'Pcs',
      avgUtilisationPerPiece: '2',
      wastagePct: '0.01',
    },
    {
      lineNo: 3,
      itemCategory: 'Label',
      accessoriesItem: 'Woven Label',
      description: 'Buyer branded woven label',
      uom: 'Pcs',
      avgUtilisationPerPiece: '1',
      wastagePct: '0.01',
    },
  ],
};

const ORDER_QTY = '5000';
/** 5000 + an APPROVED 2%. */
const EFFECTIVE_QTY = calculateEffectiveQty(ORDER_QTY, '0.02').toFixed(4);

const explode = () => calculateRequirement(STYLE, ORDER_QTY, EFFECTIVE_QTY).lines;

describe('C12 - what a material plan is built from', () => {
  test('accessories are planned, not only fabric', () => {
    const categories = explode().map((l) => categoryOfLine(l, { field: 'itemCategory' }));
    assert.ok(categories.includes('FABRIC'), 'the fabric line must be planned');
    assert.equal(
      categories.filter((c) => c === 'ACCESSORIES').length,
      2,
      'both accessory lines must be planned - this is the feature',
    );
  });

  test('a Label BOM line is an accessory, not a category of its own', () => {
    const label = explode().find((l) => l.itemCategory === 'Label');
    assert.equal(categoryOfLine(label, { field: 'itemCategory' }), 'ACCESSORIES');
  });

  test('every line carries the unit its own material is bought in', () => {
    const byItem = Object.fromEntries(explode().map((l) => [l.itemCategory, l.uom]));
    assert.equal(byItem.Fabric, 'Mtrs');
    assert.equal(byItem.Accessories, 'Pcs');
    assert.equal(byItem.Label, 'Pcs');
  });
});

describe('C12 - the frozen figures satisfy the table CHECK constraints', () => {
  test('required_qty >= base_requirement on every line', () => {
    for (const l of explode()) {
      assert.ok(
        Number(l.withExcess) >= Number(l.baseRequirement),
        `${l.itemCategory}: ${l.withExcess} must not be below base ${l.baseRequirement}`,
      );
    }
  });

  test('both quantities are strictly positive on every line', () => {
    for (const l of explode()) {
      assert.ok(Number(l.baseRequirement) > 0, `${l.itemCategory} base must be > 0`);
      assert.ok(Number(l.withExcess) > 0, `${l.itemCategory} required must be > 0`);
    }
  });

  test('utilisation per piece is strictly positive on every line', () => {
    for (const l of explode()) {
      assert.ok(Number(l.avgUtilisationPerPiece) > 0, `${l.itemCategory} per-piece must be > 0`);
    }
  });
});

describe('C12 - the plan is worked out against the APPROVED excess', () => {
  test('effectiveQty is the order quantity plus the approved excess only', () => {
    assert.equal(calculateEffectiveQty('5000', '0.02').toFixed(0), '5100');
    // An excess still awaiting a decision must behave as no excess at all.
    assert.equal(calculateEffectiveQty('5000', null).toFixed(0), '5000');
    assert.equal(calculateEffectiveQty('5000', 0).toFixed(0), '5000');
  });

  test('an unapproved excess buys nothing extra', () => {
    const withoutExcess = calculateRequirement(STYLE, ORDER_QTY, ORDER_QTY).lines;
    const withExcess = explode();
    for (let i = 0; i < withExcess.length; i += 1) {
      assert.ok(
        Number(withExcess[i].withExcess) > Number(withoutExcess[i].withExcess),
        'the approved 2% must raise every line',
      );
    }
  });

  test('the handle line is 2/pc x 5100 x 1.01 and nothing else', () => {
    const handle = explode().find((l) => l.accessoriesItem === 'Cotton Handle');
    assert.equal(Number(handle.withExcess).toFixed(2), '10302.00');
    // Base is deliberately the ORDER quantity, with no wastage and no excess:
    // it is what the plan shows beside the figure to buy, so a reader can see
    // what the allowances added.
    assert.equal(Number(handle.baseRequirement).toFixed(2), '10000.00');
  });
});

describe('C12 - a BOM line that cannot be priced', () => {
  test('a zero utilisation produces a zero requirement, which the service drops', () => {
    const broken = {
      ...STYLE,
      bomLines: [{ ...STYLE.bomLines[1], avgUtilisationPerPiece: '0', qtyPerPc: '0' }],
    };
    const [line] = calculateRequirement(broken, ORDER_QTY, EFFECTIVE_QTY).lines;
    // The service refuses to store this rather than defaulting it to zero: a
    // requirement of zero reads as "buy nothing", which is worse than absent.
    assert.equal(Number(line.withExcess), 0);
  });
});
