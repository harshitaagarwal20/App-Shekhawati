/**
 * Phase 6 - from External QC's Approved to the buyer.
 *
 *  /api/needle-checking
 *      GET    /context  /orders                 what External QC has approved
 *      GET    /position                         one order and style's sheet
 *      GET    /  POST /   GET | PATCH | DELETE /:id   the cartons
 *
 *  /api/packing
 *      GET    /context  /orders  /position
 *      GET    /  POST /   GET | PATCH | DELETE /:id
 *
 *  /api/dispatches
 *      GET    /context  /orders                 the Order No dropdown
 *      GET    /preview                          what a dispatch of the order takes
 *      GET    /  POST /   GET | PATCH | DELETE /:id
 *      GET    /:id/print/:kind                  dispatch-note, packing-list
 *
 * Needle Checking keeps the NEEDLE_DETECTION permissions. The prints are
 * DISPATCH.EXPORT, as every other print is its module's EXPORT.
 */

import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/shipping.controller.js';
import { idParam } from '../validators/common.validator.js';
import {
  createCartonSchema,
  createDispatchSchema,
  createPackingSchema,
  dispatchListQuery,
  dispatchPreviewQuery,
  needleListQuery,
  orderStyleQuery,
  packingListQuery,
  printParams,
  updateCartonSchema,
  updateDispatchSchema,
  updatePackingSchema,
} from '../validators/shipping.validator.js';

// --- Needle Checking ---------------------------------------------------------

export const needleRoutes = Router();

needleRoutes.get('/context', can('NEEDLE_DETECTION.VIEW'), c.needleContext);
needleRoutes.get('/orders', can('NEEDLE_DETECTION.VIEW'), c.needleOrders);
needleRoutes.get('/position', can('NEEDLE_DETECTION.VIEW'), validate({ query: orderStyleQuery }), c.needlePosition);
needleRoutes.get('/', can('NEEDLE_DETECTION.VIEW'), validate({ query: needleListQuery }), c.needleList);
needleRoutes.post('/', can('NEEDLE_DETECTION.CREATE'), validate({ body: createCartonSchema }), c.needleCreate);
needleRoutes.get('/:id', can('NEEDLE_DETECTION.VIEW'), validate({ params: idParam }), c.needleGet);
needleRoutes.patch('/:id', can('NEEDLE_DETECTION.EDIT'), validate({ params: idParam, body: updateCartonSchema }), c.needleUpdate);
needleRoutes.delete('/:id', can('NEEDLE_DETECTION.DELETE'), validate({ params: idParam }), c.needleRemove);

// --- Packing -----------------------------------------------------------------

export const packingRoutes = Router();

packingRoutes.get('/context', can('PACKING.VIEW'), c.packingContext);
packingRoutes.get('/orders', can('PACKING.VIEW'), c.packingOrders);
packingRoutes.get('/position', can('PACKING.VIEW'), validate({ query: orderStyleQuery }), c.packingPosition);
packingRoutes.get('/', can('PACKING.VIEW'), validate({ query: packingListQuery }), c.packingList);
packingRoutes.post('/', can('PACKING.CREATE'), validate({ body: createPackingSchema }), c.packingCreate);
packingRoutes.get('/:id', can('PACKING.VIEW'), validate({ params: idParam }), c.packingGet);
packingRoutes.patch('/:id', can('PACKING.EDIT'), validate({ params: idParam, body: updatePackingSchema }), c.packingUpdate);
packingRoutes.delete('/:id', can('PACKING.DELETE'), validate({ params: idParam }), c.packingRemove);

// --- Dispatch ----------------------------------------------------------------

export const dispatchRoutes = Router();

dispatchRoutes.get('/context', can('DISPATCH.VIEW'), c.dispatchContext);
dispatchRoutes.get('/orders', can('DISPATCH.VIEW'), c.dispatchOrders);
dispatchRoutes.get('/preview', can('DISPATCH.VIEW'), validate({ query: dispatchPreviewQuery }), c.dispatchPreview);
dispatchRoutes.get('/', can('DISPATCH.VIEW'), validate({ query: dispatchListQuery }), c.dispatchList);
dispatchRoutes.post('/', can('DISPATCH.CREATE'), validate({ body: createDispatchSchema }), c.dispatchCreate);
dispatchRoutes.get('/:id', can('DISPATCH.VIEW'), validate({ params: idParam }), c.dispatchGet);
dispatchRoutes.patch('/:id', can('DISPATCH.EDIT'), validate({ params: idParam, body: updateDispatchSchema }), c.dispatchUpdate);
dispatchRoutes.delete('/:id', can('DISPATCH.DELETE'), validate({ params: idParam }), c.dispatchRemove);
dispatchRoutes.get('/:id/print/:kind', can('DISPATCH.EXPORT'), validate({ params: printParams }), c.dispatchPrint);
