/**
 * Inventory, stock ledger and fabric rolls.
 *
 * Note what is NOT here: there is no POST that writes a stock movement, and no
 * PATCH that sets a balance. Stock moves only as a consequence of a document -
 * a GRN in, an issue out - through `postMovement()`. A ledger with a public
 * write endpoint is not a ledger, it is a spreadsheet with extra steps.
 *
 * The one write that touches balances is `/reconcile`, and it does not set them
 * either: it re-derives every one of them from the movements.
 */

import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/inventory.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  itemListQuery,
  itemOptionsQuery,
  ledgerListQuery,
  reconcileQuery,
  relocateRollSchema,
  markRollShadeSchema,
  rollListQuery,
  stockSummaryQuery,
  updateItemSchema,
} from '../validators/grn.validator.js';

const router = Router();

// --- Stock ------------------------------------------------------------------

/** On-hand by item and location, valued, with low stock called out. */
router.get('/stock', can('INVENTORY.VIEW'), validate({ query: stockSummaryQuery }), c.summary);

/** The register: date, item, roll, in, out, rate, order, reference, user. */
router.get(
  '/stock/ledger',
  can('STOCK_LEDGER.VIEW'),
  validate({ query: ledgerListQuery }),
  c.ledger,
);

/**
 * Rebuilds the balance cache from the ledger; ?dryRun=true reports the
 * differences without writing.
 *
 * Behind INVENTORY.EXPORT rather than VIEW: a reconciliation is a control
 * activity, and the roles that hold EXPORT on inventory - Store Manager,
 * Planning GM, Director - are the ones who would run one.
 */
router.post(
  '/stock/reconcile',
  can('INVENTORY.EXPORT'),
  validate({ query: reconcileQuery }),
  c.reconcile,
);

// --- Fabric rolls -----------------------------------------------------------

router.get('/rolls', can('FABRIC_ROLL.VIEW'), validate({ query: rollListQuery }), c.listRolls);

/** One roll, with its whole chain: GRN, vendor, PO, order, and issue history. */
router.get('/rolls/:id', can('FABRIC_ROLL.VIEW'), validate({ params: idParam }), c.getRoll);

/** Grading a roll's shade and dye lot - see markRollShade() for when it closes. */
router.patch(
  '/rolls/:id/shade',
  can('FABRIC_ROLL.EDIT'),
  validate({ params: idParam, body: markRollShadeSchema }),
  c.markRollShade,
);

router.patch(
  '/rolls/:id/location',
  can('FABRIC_ROLL.EDIT'),
  validate({ params: idParam, body: relocateRollSchema }),
  c.relocateRoll,
);

// --- Stock items ------------------------------------------------------------

router.get(
  '/items/options',
  can('INVENTORY.VIEW'),
  validate({ query: itemOptionsQuery }),
  c.itemOptions,
);

router.get('/items', can('INVENTORY.VIEW'), validate({ query: itemListQuery }), c.listItems);
router.get('/items/:id', can('INVENTORY.VIEW'), validate({ params: idParam }), c.getItem);

/**
 * Only the description, the reorder level, the HSN code and the active flag.
 * The seven identity columns are the item's identity and the table's unique
 * key; an item that needs different ones is a different item.
 *
 * INVENTORY is a read-only module in the permission catalogue - it is a
 * projection of other documents - so the reorder level, which is the one
 * genuinely operational setting here, is edited by whoever owns the GRN that
 * created the item.
 */
router.patch(
  '/items/:id',
  can('GRN.EDIT'),
  validate({ params: idParam, body: updateItemSchema }),
  c.updateItem,
);

export default router;
