/**
 * Accessory variety - which Button, which Zipper.
 *
 * Two rules carry the feature, and both are pure, so they are asserted here
 * without a database:
 *
 *   1. The stock identity includes the variety. 18L horn and 24L metal buttons
 *      in one colour are two stock items, not one "Button" balance.
 *   2. The BOM line that bounds a PO is chosen by variety when the BOM has one,
 *      and falls back to a line with no variety rather than refusing the PO.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { itemIdentity, describeItem } from '../src/services/inventory.service.js';
import { requirementFor } from '../src/domain/requirement.js';

const button = { item: 'Accessories', accessoriesItem: 'Button', colorCode: 'Black', uom: 'Pcs' };

describe('stock identity', () => {
  test('two varieties of one button are two stock items', () => {
    const horn = itemIdentity({ ...button, accessoryType: '4-hole horn 18L' });
    const metal = itemIdentity({ ...button, accessoryType: 'Metal shank 20L' });
    assert.notDeepEqual(horn, metal);
    assert.equal(horn.accessoryType, '4-hole horn 18L');
  });

  test('no variety is the empty string, never null', () => {
    // A UNIQUE index treats two NULLs as distinct, which would create the same
    // item twice. Stock received before varieties existed keys on ''.
    assert.equal(itemIdentity(button).accessoryType, '');
    assert.equal(itemIdentity({ item: 'Fabric', uom: 'Mtrs' }).accessoryType, '');
  });

  test('the variety is in the description on the issue slip', () => {
    assert.match(describeItem({ ...button, accessoryType: '4-hole horn 18L' }), /4-hole horn 18L/);
  });
});

describe('which BOM line bounds a PO', () => {
  const line = (lineNo, accessoryType, perPiece) => ({
    lineNo,
    itemCategory: 'Accessories',
    accessoriesItem: 'Button',
    accessoryType,
    avgUtilisationPerPiece: perPiece,
    wastagePct: 0,
    uom: 'Pcs',
    deletedAt: null,
  });
  const order = { effectiveQty: 100 };

  test('the line of the same variety wins', () => {
    const style = { styleNo: 'S1', bomLines: [line(1, '4-hole horn 18L', 4), line(2, 'Metal shank 20L', 2)] };
    const r = requirementFor({ style, order, line: { item: 'Accessories', accessoriesItem: 'Button', accessoryType: 'Metal shank 20L' } });
    assert.equal(r.bomLineNo, 2);
    assert.equal(r.requirement.toFixed(0), '200');
  });

  test('a BOM that says only "Button" still bounds a PO naming a variety', () => {
    const style = { styleNo: 'S1', bomLines: [line(1, null, 4)] };
    const r = requirementFor({ style, order, line: { item: 'Accessories', accessoriesItem: 'Button', accessoryType: '4-hole horn 18L' } });
    assert.equal(r.bomLineNo, 1);
  });

  test('a variety the BOM does not have is not bounded by a DIFFERENT variety', () => {
    // An 18L PO against a style that only takes 20L metal must not borrow the
    // 20L line's quantity as its ceiling.
    const style = { styleNo: 'S1', bomLines: [line(1, 'Metal shank 20L', 2)] };
    const r = requirementFor({ style, order, line: { item: 'Accessories', accessoriesItem: 'Button', accessoryType: '4-hole horn 18L' } });
    assert.equal(r.requirement, null);
  });
});
