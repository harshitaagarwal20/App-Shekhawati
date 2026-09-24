/**
 * C2 - THE ONE MAPPING BETWEEN THE OPEN DROPDOWN AND THE CLOSED CATEGORY.
 *
 * ===========================================================================
 *  WHY THERE ARE TWO LISTS AT ALL
 * ===========================================================================
 *
 * `L_ItemCategory` is a master list. It reads Fabric, Accessories, Handle,
 * Zipper, Label, Thread, Button, Packaging Material, and the office may add to
 * it tomorrow - that is what a master list is for, and every screen in the
 * system offers it verbatim because that is what the workbook offers.
 *
 * Tolerance is not agreed per dropdown value. Nobody has ever negotiated a
 * separate receipt tolerance for zippers as against buttons. It is agreed per
 * COMMERCIAL CATEGORY, and there are exactly three: fabric, accessories,
 * packaging.
 *
 * So the open list stays open, an enum-backed `category` sits beside it, and
 * this file is the single place one becomes the other. Every writer calls
 * `categoryOf()`; nothing else contains a mapping table.
 *
 * ---------------------------------------------------------------------------
 *  WHY THE RESULT IS STORED RATHER THAN DERIVED ON READ
 *
 *  Somebody will eventually re-file "Handle" under packaging, or add "Lining"
 *  to the dropdown. If category were computed on read, that edit would
 *  retrospectively re-categorise every document ever raised - and with it the
 *  tolerance those documents were judged against. Resolving once, at write
 *  time, and storing the answer is what stops a master-list edit rewriting
 *  history.
 *
 *  AN UNKNOWN VALUE IS REFUSED, NOT GUESSED.
 *
 *  `categoryOf()` throws on a value it does not know. The tempting default -
 *  "anything unrecognised is an accessory" - would quietly apply the tightest
 *  order tolerance in the system to a material nobody classified, and the
 *  first anyone would hear of it is a purchase order being refused for a
 *  reason that made no sense. Adding a dropdown value is a two-line change
 *  here; silently mis-filing it is a bug nobody can see.
 * ---------------------------------------------------------------------------
 */

import { ApiError } from '../utils/ApiError.js';

/** The three commercial categories, and the enum values behind them. */
export const ITEM_CATEGORIES = ['FABRIC', 'ACCESSORIES', 'PACKAGING'];

/**
 * L_ItemCategory value -> commercial category.
 *
 * Keys are compared case-insensitively and with surrounding whitespace
 * trimmed, because these strings come off a dropdown that a person maintains.
 */
const MAPPING = {
  fabric: 'FABRIC',

  // Everything a bag is trimmed with. The workbook lists them separately
  // because a buyer's BOM does; commercially they are one category, bought on
  // one tolerance and stored on one shelf.
  accessories: 'ACCESSORIES',
  handle: 'ACCESSORIES',
  zipper: 'ACCESSORIES',
  label: 'ACCESSORIES',
  thread: 'ACCESSORIES',
  button: 'ACCESSORIES',

  // The workbook writes it in full; people type the short form.
  'packaging material': 'PACKAGING',
  packaging: 'PACKAGING',
};

/** Human-readable labels, so screens do not each invent their own wording. */
export const CATEGORY_LABEL = {
  FABRIC: 'Fabric',
  ACCESSORIES: 'Accessories',
  PACKAGING: 'Packaging',
};

/**
 * The commercial category of an L_ItemCategory value.
 *
 * Pure, and exported for its own unit tests: this is the function every
 * document write goes through, so it is worth being able to prove without a
 * database.
 *
 * @param {string} itemCategory  An L_ItemCategory value, e.g. "Packaging Material"
 * @param {object} [opts]
 * @param {string} [opts.field]  Field name to attach to the error
 * @returns {'FABRIC'|'ACCESSORIES'|'PACKAGING'}
 */
export function categoryOf(itemCategory, { field = 'item' } = {}) {
  const key = String(itemCategory ?? '').trim().toLowerCase();
  const resolved = MAPPING[key];

  if (!resolved) {
    throw ApiError.badRequest(
      `"${itemCategory}" is not mapped to one of the three purchase categories ` +
        `(${ITEM_CATEGORIES.join(' / ')}). Tolerances are set per category, so an item ` +
        'that belongs to none of them cannot be ordered or received. Add the mapping in ' +
        'src/domain/itemCategory.js.',
      { field, received: itemCategory ?? null, allowed: ITEM_CATEGORIES },
    );
  }

  return resolved;
}

/**
 * The same question, without the throw, for callers that are surveying rather
 * than writing - a report counting unmapped master-list values, for instance.
 *
 * @returns {'FABRIC'|'ACCESSORIES'|'PACKAGING'|null}
 */
export function tryCategoryOf(itemCategory) {
  return MAPPING[String(itemCategory ?? '').trim().toLowerCase()] ?? null;
}

/**
 * Every L_ItemCategory value this file knows, grouped by the category it maps
 * to. Rendered on the tolerance screen so the office can see exactly which
 * dropdown values a percentage they are editing will govern.
 */
export function mappingByCategory() {
  const grouped = { FABRIC: [], ACCESSORIES: [], PACKAGING: [] };
  for (const [value, category] of Object.entries(MAPPING)) {
    if (!grouped[category]) continue;
    grouped[category].push(value);
  }
  return grouped;
}

/**
 * The category a PURCHASE-side line belongs to.
 *
 * A line may say `item: "Accessories"` with an `accessoriesItem` naming the
 * particular trim, or it may name the trim directly in `item`. Both mean the
 * same category, and this is where the two shapes are reconciled - once,
 * rather than at each of the four call sites that ask.
 *
 * @param {{item?: string, itemCategory?: string, accessoriesItem?: string|null}} line
 */
export function categoryOfLine(line = {}, opts) {
  const named = line.item ?? line.itemCategory;
  if (!named && line.accessoriesItem) return 'ACCESSORIES';
  return categoryOf(named, opts);
}
