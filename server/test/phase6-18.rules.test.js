/**
 * Rule tests for Phases 6-18.
 *
 * These need NO database: they drive the exported pure functions directly, so
 * they run in CI and on a laptop with nothing installed but Node.
 *
 * What is covered here is every calculation and every state rule that the rest
 * of the system trusts without re-deriving:
 *
 *   Phase 6   PO amount, the accessory / material excess ceilings, and the
 *             style requirement that bounds an "order as per style".
 *   Phase 7   Gate pass variation, including the sheet's own sign convention.
 *   Phase 8   GRN amount, receipt variance, and the tolerance assessment that
 *             decides whether a receipt is over the line.
 *   Phase 13  Job work amount and shrinkage, and the four processes.
 *   Phase 17  The excess engine's arithmetic - every one of the nine figures
 *             the brief asks to be identified.
 *   Phase 18  The approval engine's transition table.
 *
 * The end-to-end HTTP behaviour of these rules needs a seeded database and is
 * covered by the API tests.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXCESS_CEILING,
  calculateAmount as poAmount,
  excessCeilingFor,
  isAccessoryLine,
  styleRequirementFor,
  amountInWords,
} from '../src/services/purchaseOrder.service.js';
import { calculateVariation as gateVariation } from '../src/services/gatePass.service.js';
import {
  RECEIPT_TOLERANCE,
  assessReceipt,
  calculateAmount as grnAmount,
  calculateVariation as grnVariation,
  toleranceFor,
} from '../src/services/grn.service.js';
import {
  PROCESS_META,
  calculateAmount as jobAmount,
  calculateShrinkage,
  processMeta,
} from '../src/services/jobWork.service.js';
import { VERDICT, measure } from '../src/services/excess.service.js';
import {
  ACTION_FOR,
  TERMINAL,
  TRANSITIONS,
  allowedFrom,
  canTransition,
  progressOf,
} from '../src/services/approvalEngine.js';

// ===========================================================================
//  PHASE 6 - PURCHASE ORDER
// ===========================================================================

describe('Phase 6 - PO amount is Order Qty x Rate', () => {
  test('multiplies and rounds to the stored scale', () => {
    assert.equal(poAmount('4500', '178').toFixed(2), '801000.00');
    assert.equal(poAmount('9000', '12').toFixed(2), '108000.00');
  });

  test('rounds half up at two decimals, matching the column', () => {
    // 3 x 1.005 = 3.015 -> 3.02 at the stored scale.
    assert.equal(poAmount('3', '1.005').toFixed(2), '3.02');
  });

  test('a zero quantity is a zero amount, not an error', () => {
    assert.equal(poAmount('0', '178').toFixed(2), '0.00');
  });
});

describe('Phase 6 - the excess ceiling depends on what is being bought', () => {
  test('accessories are held to 1%', () => {
    assert.equal(excessCeilingFor({ item: 'Accessories' }).toString(), EXCESS_CEILING.ACCESSORIES);
    assert.equal(
      excessCeilingFor({ item: 'Label', accessoriesItem: 'Woven Label' }).toString(),
      EXCESS_CEILING.ACCESSORIES,
    );
  });

  test('material takes the general 3%', () => {
    assert.equal(excessCeilingFor({ item: 'Fabric' }).toString(), EXCESS_CEILING.GENERAL);
  });

  test('an accessory is anything with an accessory item, whatever the category', () => {
    assert.equal(isAccessoryLine({ item: 'Accessories' }), true);
    assert.equal(isAccessoryLine({ item: 'Label', accessoriesItem: 'Hang Tag' }), true);
    assert.equal(isAccessoryLine({ item: 'Fabric' }), false);
  });
});

describe('Phase 6 - the style bounds an "order as per style"', () => {
  const style = {
    styleNo: 'TR-0751-008',
    avgFabricUtilizationPerPc: '0.45',
    avgUtilizationUom: 'Mtrs',
    bomLines: [
      {
        lineNo: 1,
        itemCategory: 'Accessories',
        accessoriesItem: 'Cotton Handle',
        subCategory: null,
        // C9 renamed qty_per_pc to avg_utilisation_per_piece. Same number,
        // same rule, same expected result below - only the column's name
        // changed, and this fixture follows it.
        avgUtilisationPerPiece: '2',
        wastagePct: '0.05',
        uom: 'Pcs',
        effectiveFrom: new Date('2026-01-01'),
      },
    ],
  };
  const order = { effectiveQty: '10000' };

  test('fabric is bounded by the header average, not by a BOM line', () => {
    const need = styleRequirementFor(style, order, { item: 'Fabric' });
    // 0.45 x 10,000
    assert.equal(need.requirement.toFixed(4), '4500.0000');
    assert.equal(need.uom, 'Mtrs');
    assert.match(need.basis, /average utilisation/);
  });

  test('an accessory is bounded by its BOM line, wastage included', () => {
    const need = styleRequirementFor(style, order, {
      item: 'Accessories',
      accessoriesItem: 'Cotton Handle',
    });
    // 2 x 10,000 x 1.05
    assert.equal(need.requirement.toFixed(4), '21000.0000');
    assert.equal(need.uom, 'Pcs');
  });

  test('an item the BOM says nothing about is UNBOUNDED, not bounded at zero', () => {
    assert.equal(styleRequirementFor(style, order, { item: 'Zipper' }), null);
  });

  test('a style with no average utilisation cannot bound fabric', () => {
    const vague = { ...style, avgFabricUtilizationPerPc: '0' };
    assert.equal(styleRequirementFor(vague, order, { item: 'Fabric' }), null);
  });
});

describe('Phase 6 - the amount in words, on the Indian numbering system', () => {
  test('spells crore, lakh and thousand', () => {
    assert.equal(amountInWords('801000'), 'Rupees Eight Lakh One Thousand Only');
    assert.equal(amountInWords('12345678'), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
  });

  test('includes paise when there are any', () => {
    assert.equal(amountInWords('1250.50'), 'Rupees One Thousand Two Hundred Fifty and Fifty Paise Only');
  });

  test('zero is spelled, not blank', () => {
    assert.equal(amountInWords('0'), 'Rupees Zero Only');
  });
});

// ===========================================================================
//  PHASE 7 - GATE PASS
// ===========================================================================

describe('Phase 7 - gate pass variation keeps the sheet sign convention', () => {
  test('short delivery is POSITIVE, as the workbook has it', () => {
    // (2000 - 1950) / 2000
    assert.equal(gateVariation('2000', '1950').toFixed(6), '0.025000');
  });

  test('over delivery is negative', () => {
    assert.equal(gateVariation('2000', '2050').toFixed(6), '-0.025000');
  });

  test('an exact delivery is zero', () => {
    assert.equal(gateVariation('2000', '2000').toFixed(6), '0.000000');
  });

  test('nothing counted yet is zero, not a division by nothing', () => {
    assert.equal(gateVariation('2000', null).toFixed(6), '0.000000');
    assert.equal(gateVariation('2000', undefined).toFixed(6), '0.000000');
  });

  test('a zero quantity does not divide by zero - Excel IFERROR, in code', () => {
    assert.equal(gateVariation('0', '10').toFixed(6), '0.000000');
  });
});

// ===========================================================================
//  PHASE 8 - GRN
// ===========================================================================

describe('Phase 8 - GRN amount is Receiving Qty x Inventory Rate', () => {
  test('multiplies and rounds', () => {
    assert.equal(grnAmount('4500', '178').toFixed(2), '801000.00');
    assert.equal(grnAmount('9090', '12').toFixed(2), '109080.00');
  });
});

describe('Phase 8 - receipt variance is measured against the PO quantity', () => {
  test('over-receipt is positive', () => {
    // (9090 - 9000) / 9000
    assert.equal(grnVariation('9090', '9000').toFixed(6), '0.010000');
  });

  test('short receipt is negative', () => {
    assert.equal(grnVariation('6180', '6200').toFixed(6), '-0.003226');
  });

  test('a zero order quantity does not divide by zero', () => {
    assert.equal(grnVariation('100', '0').toFixed(6), '0.000000');
  });
});

describe('Phase 8 - receipt tolerance differs by item category', () => {
  test('accessories may be received up to 3%', () => {
    assert.equal(toleranceFor({ item: 'Accessories' }).fraction.toString(), RECEIPT_TOLERANCE.ACCESSORIES);
  });

  test('material generally takes 2%', () => {
    assert.equal(toleranceFor({ item: 'Fabric' }).fraction.toString(), RECEIPT_TOLERANCE.GENERAL);
  });

  test('tolerance is measured on the CUMULATIVE receipt, not on one delivery', () => {
    // Three 1% receipts against a 2% tolerance: each is fine alone, together
    // they are not - which is exactly the case a per-delivery check misses.
    const first = assessReceipt({
      receivingQty: '1010',
      orderQty: '1000',
      inventoryRate: '10',
      item: 'Fabric',
      alreadyReceived: '0',
    });
    assert.equal(first.toleranceBreached, false);

    const third = assessReceipt({
      receivingQty: '10',
      orderQty: '1000',
      inventoryRate: '10',
      item: 'Fabric',
      alreadyReceived: '1020',
    });
    assert.equal(third.cumulativeReceived, '1030.0000');
    assert.equal(third.toleranceBreached, true);
  });

  test('the assessment reports the payable amount as the quantity RECEIVED', () => {
    // Process Doc s.5: payment is made on the quantity actually received.
    const a = assessReceipt({
      receivingQty: '990',
      orderQty: '1000',
      inventoryRate: '50',
      item: 'Fabric',
      alreadyReceived: '0',
    });
    assert.equal(a.payableAmount, '49500.00');
  });

  test('outstanding never goes negative on an over-receipt', () => {
    const a = assessReceipt({
      receivingQty: '1100',
      orderQty: '1000',
      inventoryRate: '1',
      item: 'Accessories',
      alreadyReceived: '0',
    });
    assert.equal(a.outstandingQty, '0.0000');
  });
});

// ===========================================================================
//  PHASE 13 - JOB WORK
// ===========================================================================

describe('Phase 13 - one register, four processes, four vocabularies', () => {
  test('every process has its own document name, vendor label and loss label', () => {
    for (const key of Object.keys(PROCESS_META)) {
      const meta = processMeta(key);
      assert.ok(meta.documentName, `${key} needs a document name`);
      assert.ok(meta.vendorLabel, `${key} needs a vendor label`);
      assert.ok(meta.lossLabel, `${key} needs a loss label`);
      assert.ok(meta.rollStage, `${key} needs a roll stage`);
    }
  });

  test('dyeing and printing are told apart', () => {
    assert.notEqual(processMeta('DYEING').documentName, processMeta('PRINTING').documentName);
    assert.equal(processMeta('DYEING').rollStage, 'ISSUED_FOR_DYEING');
    assert.equal(processMeta('PRINTING').rollStage, 'ISSUED_FOR_PRINTING');
  });

  test('an unknown process is refused rather than defaulted', () => {
    assert.throws(() => processMeta('EMBROIDERY'), /Unknown job work process/);
  });
});

describe('Phase 13 - shrinkage is (issued - received) / issued', () => {
  test('a normal dye lot', () => {
    // (2000 - 1950) / 2000
    assert.equal(calculateShrinkage('2000', '1950').toFixed(6), '0.025000');
  });

  test('nothing back yet is ZERO shrinkage, not 100%', () => {
    // A lot still at the vendor has not shrunk; it has not returned.
    assert.equal(calculateShrinkage('2000', '0').toFixed(6), '0.000000');
  });

  test('a full return is zero shrinkage', () => {
    assert.equal(calculateShrinkage('2000', '2000').toFixed(6), '0.000000');
  });

  test('job work amount is Qty x Rate', () => {
    assert.equal(jobAmount('2000', '42').toFixed(2), '84000.00');
  });
});

// ===========================================================================
//  PHASE 17 - THE EXCESS ENGINE
// ===========================================================================

describe('Phase 17 - the excess arithmetic, and all nine figures', () => {
  test('the brief\'s own worked example: 10,000 pcs at 2%', () => {
    const m = measure({
      baseQty: '10000',
      actualQty: '10200',
      permittedPct: '0.02',
      uom: 'Pcs',
    });

    assert.equal(m.baseQty, '10000.0000');
    assert.equal(m.permittedPct, '0.020000');
    assert.equal(m.permittedQty, '200.0000');
    assert.equal(m.maxPermittedQty, '10200.0000');
    assert.equal(m.actualQty, '10200.0000');
    assert.equal(m.actualExcessQty, '200.0000');
    assert.equal(m.actualExcessPct, '0.020000');
    assert.equal(m.overLimitQty, '0.0000');
    assert.equal(m.verdict, VERDICT.WITHIN);
  });

  test('one piece over the limit needs an approval', () => {
    const m = measure({ baseQty: '10000', actualQty: '10201', permittedPct: '0.02' });
    assert.equal(m.overLimitQty, '1.0000');
    assert.equal(m.verdict, VERDICT.NEEDS_APPROVAL);
    assert.equal(m.needsApproval, true);
  });

  test('past the hard ceiling, no approval can help', () => {
    const m = measure({
      baseQty: '10000',
      actualQty: '11000',
      permittedPct: '0.02',
      hardCeilingPct: '0.05',
    });
    assert.equal(m.actualExcessPct, '0.100000');
    assert.equal(m.verdict, VERDICT.REFUSED);
    assert.equal(m.refused, true);
  });

  test('an advisory threshold reports but does not block', () => {
    // Job work shrinkage works this way: the fabric is already back, so an
    // out-of-tolerance return goes to scrutiny rather than being refused.
    const m = measure({
      baseQty: '1000',
      actualQty: '1100',
      permittedPct: '0.02',
      requiresApproval: false,
    });
    assert.equal(m.overLimitQty, '80.0000');
    assert.equal(m.verdict, VERDICT.WITHIN);
  });

  test('under the base quantity is never an excess', () => {
    const m = measure({ baseQty: '10000', actualQty: '9000', permittedPct: '0.02' });
    assert.equal(m.actualExcessQty, '-1000.0000');
    assert.equal(m.overLimitQty, '0.0000');
    assert.equal(m.within, true);
  });

  test('a zero base does not divide by zero', () => {
    const m = measure({ baseQty: '0', actualQty: '50', permittedPct: '0.02' });
    assert.equal(m.actualExcessPct, '0.000000');
    assert.equal(m.permittedQty, '0.0000');
  });

  test('a 5% contracted tolerance permits what 2% would not', () => {
    // The whole point of making the threshold configurable.
    const strict = measure({ baseQty: '10000', actualQty: '10400', permittedPct: '0.02' });
    const relaxed = measure({ baseQty: '10000', actualQty: '10400', permittedPct: '0.05' });
    assert.equal(strict.verdict, VERDICT.NEEDS_APPROVAL);
    assert.equal(relaxed.verdict, VERDICT.WITHIN);
  });

  test('the explanation states the arithmetic in the office\'s own terms', () => {
    const m = measure({ baseQty: '10000', actualQty: '10350', permittedPct: '0.02', uom: 'Pcs' });
    assert.match(m.explanation, /10200\.00 Pcs permitted/);
    assert.match(m.explanation, /150\.00 over/);
  });
});

// ===========================================================================
//  PHASE 18 - THE APPROVAL ENGINE
// ===========================================================================

describe('Phase 18 - the transition table is the whole workflow', () => {
  test('the happy path runs draft to approved', () => {
    assert.equal(canTransition('DRAFT', 'SUBMITTED'), true);
    assert.equal(canTransition('SUBMITTED', 'PENDING_APPROVAL'), true);
    assert.equal(canTransition('PENDING_APPROVAL', 'APPROVED'), true);
  });

  test('the rejection loop returns to pending through rectification', () => {
    assert.equal(canTransition('PENDING_APPROVAL', 'REJECTED'), true);
    assert.equal(canTransition('REJECTED', 'RECTIFICATION'), true);
    assert.equal(canTransition('RECTIFICATION', 'RESUBMITTED'), true);
    assert.equal(canTransition('RESUBMITTED', 'PENDING_APPROVAL'), true);
  });

  // §38: APPROVED → DRAFT is the one transition the brief names as forbidden
  // unless an explicit amendment mechanism exists. There are three such
  // mechanisms - PO reopen(), scrutiny amend(), plan approval rectify() - and
  // every one of them raises a NEW document or an amendment record rather than
  // walking this table backwards. So the table itself never permits it.
  test('APPROVED never returns to DRAFT or to any earlier state', () => {
    assert.equal(canTransition('APPROVED', 'DRAFT'), false);
    assert.equal(canTransition('APPROVED', 'SUBMITTED'), false);
    assert.equal(canTransition('APPROVED', 'PENDING_APPROVAL'), false);
    assert.equal(canTransition('APPROVED', 'REJECTED'), false);
    assert.equal(canTransition('APPROVED', 'RECTIFICATION'), false);
  });

  test('APPROVED moves forward only - posted, completed or cancelled', () => {
    assert.deepEqual(TRANSITIONS.APPROVED, ['POSTED', 'COMPLETED', 'CANCELLED']);
  });

  test('POSTED may only finish, and COMPLETED is the end', () => {
    assert.deepEqual(TRANSITIONS.POSTED, ['COMPLETED']);
    assert.deepEqual(TRANSITIONS.COMPLETED, []);
    assert.equal(canTransition('POSTED', 'DRAFT'), false);
    assert.equal(canTransition('POSTED', 'APPROVED'), false);
    assert.equal(canTransition('POSTED', 'CANCELLED'), false);
  });

  // §38 names this one as allowed: a rejected document is reworked as a draft.
  test('REJECTED may go back to DRAFT', () => {
    assert.equal(canTransition('REJECTED', 'DRAFT'), true);
  });

  test('only COMPLETED and CANCELLED are terminal', () => {
    for (const [state, next] of Object.entries(TRANSITIONS)) {
      assert.equal(
        next.length === 0,
        TERMINAL.has(state),
        `${state} declares ${next.length} successor(s); TERMINAL says ${TERMINAL.has(state)}`,
      );
    }
  });

  test('CANCELLED is terminal too', () => {
    assert.deepEqual(TRANSITIONS.CANCELLED, []);
  });

  test('a draft cannot be approved without being submitted', () => {
    assert.equal(canTransition('DRAFT', 'APPROVED'), false);
  });

  test('a rejection cannot be approved without being rectified and resubmitted', () => {
    assert.equal(canTransition('REJECTED', 'APPROVED'), false);
    assert.equal(canTransition('RECTIFICATION', 'APPROVED'), false);
  });

  test('every state in the table has a defined set of successors', () => {
    for (const [state, next] of Object.entries(TRANSITIONS)) {
      assert.ok(Array.isArray(next), `${state} must declare its successors`);
      for (const to of next) {
        assert.ok(TRANSITIONS[to] !== undefined, `${state} -> ${to} names an unknown state`);
      }
    }
  });

  test('allowedFrom renders the buttons a screen may offer', () => {
    const allowed = allowedFrom('PENDING_APPROVAL').map((a) => a.to);
    assert.ok(allowed.includes('APPROVED'));
    assert.ok(allowed.includes('REJECTED'));
    // Nothing follows a completed document, so a screen offers no buttons.
    assert.deepEqual(allowedFrom('COMPLETED'), []);
    assert.deepEqual(allowedFrom('CANCELLED'), []);
  });

  test('every offered move carries a label and an action to record', () => {
    for (const state of Object.keys(TRANSITIONS)) {
      for (const move of allowedFrom(state)) {
        assert.ok(move.label, `${state} -> ${move.to} has no label`);
        assert.ok(move.action, `${state} -> ${move.to} has no action to record`);
      }
    }
  });

  // The action recorded in the trail must say what happened. Posting a GRN was
  // recorded as SUBMITTED until POSTED existed, which told the reader a receipt
  // was waiting on somebody's approval. It never was.
  test('posting and completing are recorded in their own words', () => {
    assert.equal(ACTION_FOR.POSTED, 'POSTED');
    assert.equal(ACTION_FOR.COMPLETED, 'COMPLETED');
  });
});

describe('Phase 18 - progress does not flatter a rejected document', () => {
  test('the happy path counts one to four', () => {
    assert.equal(progressOf('DRAFT').step, 1);
    assert.equal(progressOf('SUBMITTED').step, 2);
    assert.equal(progressOf('PENDING_APPROVAL').step, 3);
    assert.equal(progressOf('APPROVED').step, 4);
    assert.equal(progressOf('APPROVED').offPath, false);
  });

  test('a rejected document sits AT the approval step, flagged off-path', () => {
    const p = progressOf('REJECTED');
    assert.equal(p.step, 3);
    assert.equal(p.offPath, true);
    assert.equal(p.offPathState, 'REJECTED');
  });

  test('rectification and resubmission are also off-path at step three', () => {
    assert.equal(progressOf('RECTIFICATION').step, 3);
    assert.equal(progressOf('RESUBMITTED').step, 3);
  });

  test('a cancelled document has made no progress at all', () => {
    assert.equal(progressOf('CANCELLED').step, 0);
  });
});
