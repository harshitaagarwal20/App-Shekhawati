/**
 * Production Phase 2 - /api/stitching
 *
 *      GET    /context                  units, slots, and what this login may do
 *      GET    /orders?unit=             orders and styles cut for the unit
 *      GET    /records/day              what the form fills in by itself
 *      GET    /records  POST /records   the daily register
 *      GET|PATCH|DELETE /records/:id
 *      GET    /hourly/grid              one date and order: tailors x slots
 *      PUT    /hourly/slot              one cell, saved on its own
 *      GET    /hourly                   every cell as a row (the export)
 *      .../printings                    printing after stitching
 *
 * Which UNIT a caller may touch is not decided here - it is the Unit / Line
 * on their Employee record, and stitching.service.js applies it to every
 * call. These guards decide only WHETHER they may.
 */

import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/stitching.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  createPrintingSchema,
  createStitchingRecordSchema,
  dayQuery,
  hourlyListQuery,
  printingListQuery,
  printingSummaryQuery,
  saveSlotSchema,
  stitchingListQuery,
  unitQuery,
  updatePrintingSchema,
  updateStitchingRecordSchema,
} from '../validators/stitching.validator.js';

const router = Router();

const ANY_STITCHING = ['STITCHING_RECORD.VIEW', 'HOURLY_MONITORING.VIEW'];

router.get('/context', can(...ANY_STITCHING), c.context);
router.get('/orders', can(...ANY_STITCHING), validate({ query: unitQuery }), c.orderOptions);

// --- Stitching record -----------------------------------------------------

router.get('/records/day', can('STITCHING_RECORD.VIEW'), validate({ query: dayQuery }), c.dayContext);
router.get('/records', can('STITCHING_RECORD.VIEW'), validate({ query: stitchingListQuery }), c.list);
router.post('/records', can('STITCHING_RECORD.CREATE'), validate({ body: createStitchingRecordSchema }), c.create);
router.get('/records/:id', can('STITCHING_RECORD.VIEW'), validate({ params: idParam }), c.get);
router.patch(
  '/records/:id',
  can('STITCHING_RECORD.EDIT'),
  validate({ params: idParam, body: updateStitchingRecordSchema }),
  c.update,
);
router.delete('/records/:id', can('STITCHING_RECORD.DELETE'), validate({ params: idParam }), c.remove);

// --- Hourly monitoring ----------------------------------------------------

router.get('/hourly/grid', can('HOURLY_MONITORING.VIEW'), validate({ query: dayQuery }), c.hourlyGrid);
/**
 * PUT, because a cell is idempotent: the same count sent twice is one count.
 * CREATE or EDIT - the first number in a slot creates the row, a correction
 * edits it, and the supervisor is doing the same thing both times.
 */
router.put(
  '/hourly/slot',
  can('HOURLY_MONITORING.CREATE', 'HOURLY_MONITORING.EDIT'),
  validate({ body: saveSlotSchema }),
  c.saveSlot,
);
router.get('/hourly', can('HOURLY_MONITORING.VIEW'), validate({ query: hourlyListQuery }), c.listHourly);

// --- Printing after stitching ---------------------------------------------
//
// The Printing sheet's own permission: the same register, its other stage.

router.get('/printings/orders', can('PRINTING.VIEW'), c.printingOrderOptions);
router.get('/printings/summary', can('PRINTING.VIEW'), validate({ query: printingSummaryQuery }), c.printingSummary);
router.get('/printings', can('PRINTING.VIEW'), validate({ query: printingListQuery }), c.listPrintings);
router.post('/printings', can('PRINTING.CREATE'), validate({ body: createPrintingSchema }), c.createPrinting);
router.get('/printings/:id', can('PRINTING.VIEW'), validate({ params: idParam }), c.getPrinting);
router.patch(
  '/printings/:id',
  can('PRINTING.EDIT'),
  validate({ params: idParam, body: updatePrintingSchema }),
  c.updatePrinting,
);
router.delete('/printings/:id', can('PRINTING.DELETE'), validate({ params: idParam }), c.removePrinting);

export default router;
