/**
 * Excess rules: which rule a transaction matches, and which rules are read at all.
 *
 * Pure - no database. The resolution order and the arithmetic are covered in
 * rules.test.js; this pins the two things that were wrong:
 *
 *   - an ITEM_CATEGORY rule keyed "Accessories" did not apply to a zipper,
 *     because the key was compared as exact text;
 *   - the rules screen showed rows nothing read (DYE_ISSUE, item-category rows
 *     shadowed by the tolerance master) as if they were policy.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  RULE_CONSUMERS,
  measure,
  notInEffectReason,
  ruleKeyMatches,
} from '../src/services/excess.service.js';

const rule = (over) => ({ scope: 'DOCUMENT_TYPE', scopeKey: '', documentType: null, ...over });

describe('ruleKeyMatches - item category', () => {
  const accessories = rule({ scope: 'ITEM_CATEGORY', scopeKey: 'Accessories' });

  test('a rule keyed "Accessories" applies to every accessory, in any case', () => {
    for (const item of ['Accessories', 'accessories', 'ACCESSORIES', 'Zipper', ' Handle ', 'Label']) {
      assert.ok(ruleKeyMatches(accessories, item), item);
    }
  });

  test('and not to another category', () => {
    assert.equal(ruleKeyMatches(accessories, 'Fabric'), false);
    assert.equal(ruleKeyMatches(accessories, 'Packaging Material'), false);
  });

  test('an unmapped key still matches itself, case-insensitively', () => {
    const odd = rule({ scope: 'ITEM_CATEGORY', scopeKey: 'Lining' });
    assert.ok(ruleKeyMatches(odd, 'lining'));
    assert.equal(ruleKeyMatches(odd, 'Fabric'), false);
  });

  test('nothing asked about, nothing matched', () => {
    assert.equal(ruleKeyMatches(accessories, null), false);
    assert.equal(ruleKeyMatches(accessories, undefined), false);
  });
});

describe('ruleKeyMatches - every other scope is exact', () => {
  test('ids and document types are compared as they are', () => {
    const buyer = rule({ scope: 'BUYER', scopeKey: 'b-1' });
    assert.ok(ruleKeyMatches(buyer, 'b-1'));
    assert.equal(ruleKeyMatches(buyer, 'B-1'), false);
    assert.ok(ruleKeyMatches(rule({ scope: 'GLOBAL', scopeKey: '' }), ''));
  });
});

describe('notInEffectReason - the screen says which rules are read', () => {
  test('the documents that read a rule are in effect', () => {
    for (const doc of Object.keys(RULE_CONSUMERS)) {
      assert.equal(notInEffectReason(rule({ scopeKey: doc, documentType: doc })), null, doc);
    }
    assert.equal(notInEffectReason(rule({ scope: 'GLOBAL' })), null);
  });

  test('a dye-issue rule is not, and points at the shrinkage screen', () => {
    const reason = notInEffectReason(rule({ scopeKey: 'DYE_ISSUE', documentType: 'DYE_ISSUE' }));
    assert.match(reason, /Shrinkage Rules/);
  });

  test('a DOCUMENT_TYPE rule naming an unread document by key alone is caught too', () => {
    assert.ok(notInEffectReason(rule({ scopeKey: 'FABRIC_ISSUE', documentType: null })));
  });

  test('an item-category PO rule is shadowed when the tolerance master has the category', () => {
    const r = rule({ scope: 'ITEM_CATEGORY', scopeKey: 'Accessories', documentType: 'PURCHASE_ORDER' });
    assert.match(notInEffectReason(r, new Set(['ACCESSORIES'])), /Tolerance Rules/);
    assert.equal(notInEffectReason(r, new Set(['FABRIC'])), null, 'no master row - the rule is the fallback');
  });

  test('an item-category rule for a document that never passes a category is not read', () => {
    const r = rule({ scope: 'ITEM_CATEGORY', scopeKey: 'Fabric', documentType: 'CUTTING_ISSUE' });
    assert.ok(notInEffectReason(r));
  });
});

describe('measure - a rule that needs no approval still has a ceiling', () => {
  const base = { baseQty: '100', permittedPct: '0.02', hardCeilingPct: '0.10', requiresApproval: false };

  test('between the threshold and the ceiling it passes without an authorisation', () => {
    assert.equal(measure({ ...base, actualQty: '105' }).verdict, 'WITHIN');
  });

  test('past the ceiling it is refused', () => {
    assert.equal(measure({ ...base, actualQty: '111' }).verdict, 'REFUSED');
  });

  test('with no ceiling it is purely advisory', () => {
    assert.equal(measure({ ...base, hardCeilingPct: null, actualQty: '500' }).verdict, 'WITHIN');
  });
});
