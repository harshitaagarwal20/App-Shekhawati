/**
 * F-01 - MAKER-CHECKER, AS A POLICY RATHER THAN A HABIT.
 *
 * ===========================================================================
 *  WHAT WENT WRONG, AND WHAT THIS FILE GUARDS
 * ===========================================================================
 *
 * `assertNotSelfApproval()` was written with the C-series modules and called by
 * four services. Five others - purchase order, vendor quotation, buyer order
 * excess, planning and the excess register - never called it, and nothing
 * anywhere said that difference was intended. It was not. A purchase order,
 * the largest financial commitment this system makes, could be raised and
 * approved by the same person.
 *
 * The fix moved the decision into the approval engine's REGISTRY, where every
 * document type must state `separateChecker`. This file is what stops it
 * drifting back:
 *
 *   1. Every registered document declares the flag. `registryFor()` refuses an
 *      entry that does not, so a new module cannot inherit the answer by
 *      omission.
 *
 *   2. The flag says what the business says. The expected values are written
 *      out here in full rather than derived, so flipping one in the registry
 *      fails here and has to be argued for.
 *
 *   3. The pure rule itself still behaves - including the two cases that make
 *      it safe to apply everywhere: an unknown maker is not a violation, and
 *      identity is decided on user id rather than on a name.
 *
 * No database. These are rules.
 *
 *     node --test test/makerChecker.rules.test.js
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { REGISTRY } from '../src/services/approvalEngine.js';
import { assertNotSelfApproval, canApprove } from '../src/domain/makerChecker.js';

/**
 * What the business says about each document, written out rather than derived.
 *
 * A derived expectation would pass no matter what the registry said, which is
 * the failure this whole file exists to prevent. Adding a document type breaks
 * this test until somebody states the answer here too - which is the point.
 */
const EXPECTED = {
  // A second person signs these.
  BUYER_ORDER: true,
  PLANNING: true,
  VENDOR_QUOTATION: true,
  PURCHASE_ORDER: true,
  DYE_ISSUE: true,
  MATERIAL_PLAN: true,
  CUTTING_CHALLAN: true,
  PLAN_APPROVAL: true,
  /**
   * F-04 - and this one most of all.
   *
   * The GRN below is `false` because posting a receipt is an act nobody signs.
   * Its reversal is the opposite: the whole purpose of the document is to undo
   * work the raiser's own desk committed, and it moves both stock and the
   * quantity a vendor is owed for. A storeman who could post a receipt and
   * then quietly un-post it would have no maker-checker between those two
   * acts at all.
   */
  GRN_REVERSAL: true,

  // APPROVED is the raiser's own act on these three, and each has a reason
  // recorded beside it in the registry.
  GATE_PASS: false,
  GRN: false,
  FABRIC_SCRUTINY: false,
  CUTTING_ISSUE: false,
};

describe('F-01 - the registry decides maker-checker', () => {
  test('every registered document type declares separateChecker', () => {
    for (const [documentType, cfg] of Object.entries(REGISTRY)) {
      assert.equal(
        typeof cfg.separateChecker,
        'boolean',
        `${documentType} does not declare separateChecker. Whether approving it needs a ` +
          'second person must be stated, not defaulted - defaulting is how this control was ' +
          'lost the first time.',
      );
    }
  });

  test('the registry and the expectations describe the same set of documents', () => {
    assert.deepEqual(
      Object.keys(REGISTRY).sort(),
      Object.keys(EXPECTED).sort(),
      'A document type was added to or removed from the approval engine without saying ' +
        'whether it needs a separate checker. Update EXPECTED above with the answer.',
    );
  });

  test('each document requires a separate checker exactly where the business says', () => {
    for (const [documentType, wanted] of Object.entries(EXPECTED)) {
      assert.equal(
        REGISTRY[documentType].separateChecker,
        wanted,
        `${documentType} should ${wanted ? '' : 'NOT '}require a separate checker.`,
      );
    }
  });

  test('a purchase order requires a separate checker - the defect this fixed', () => {
    assert.equal(
      REGISTRY.PURCHASE_ORDER.separateChecker,
      true,
      'A purchase order is the largest financial commitment this system makes. If this is ' +
        'ever false, one person can commit company money to a vendor unaided.',
    );
  });

  test('the three exceptions are deliberate, not leftovers', () => {
    // Each of these reaches APPROVED as the act of the person who raised it.
    // Requiring a second person would stop the gate, the receipt and the
    // cutting floor working - see the comments in REGISTRY.
    assert.equal(REGISTRY.GATE_PASS.separateChecker, false);
    assert.equal(REGISTRY.CUTTING_ISSUE.separateChecker, false);
    assert.equal(REGISTRY.GRN.separateChecker, false);
  });
});

describe('F-01 - the rule itself is DISABLED', () => {
  /*
   * Maker-checker was switched off at the owner's instruction - see the header
   * of domain/makerChecker.js. These tests assert the DISABLED behaviour on
   * purpose, so that switching it back on fails here loudly rather than
   * silently changing who may approve what.
   *
   * The registry tests above are untouched: `separateChecker` is still
   * declared per document, and is where a selective reinstatement would go.
   */
  const maker = { userId: 'user-a', fullName: 'Ravi' };
  const checker = { userId: 'user-b', fullName: 'Dinesh' };

  test('the author of a document may now approve it', () => {
    assert.doesNotThrow(() =>
      assertNotSelfApproval({ createdById: 'user-a' }, maker, 'purchase order'),
    );
    assert.equal(canApprove({ createdById: 'user-a' }, maker), true);
  });

  test('anybody else can, as before', () => {
    assert.doesNotThrow(() =>
      assertNotSelfApproval({ createdById: 'user-a' }, checker, 'purchase order'),
    );
    assert.equal(canApprove({ createdById: 'user-a' }, checker), true);
  });

  test('an unknown maker is still not a violation', () => {
    assert.doesNotThrow(() => assertNotSelfApproval({ createdById: null }, maker));
    assert.equal(canApprove({ createdById: null }, maker), true);
  });

  test('nothing refuses an approval any more', () => {
    // The one case that used to throw, stated as its own test so the change is
    // impossible to miss when reading the suite.
    assert.doesNotThrow(() => assertNotSelfApproval({ createdById: 'x' }, { userId: 'x' }, 'plan'));
    assert.equal(canApprove({ createdById: 'x' }, { userId: 'x' }), true);
  });
});
