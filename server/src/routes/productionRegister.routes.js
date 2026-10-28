/**
 * The Phase 5 registers, each at its own path.
 *
 * Every permission code is written out in full rather than built from the
 * module name: test/rbac.rules.test.js reads the `can()` calls in this
 * directory as text, and a code assembled at runtime is one it cannot see.
 */

import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/productionRegister.controller.js';
import { idParam } from '../validators/common.validator.js';
import { orderContextQuery, registerListQuery, schemasFor } from '../validators/productionRegister.validator.js';

/** Builds the router of one register from its five guards. */
function registerRouter(key, guard) {
  const h = c.handlersFor(key);
  const { create, update } = schemasFor(key);
  const r = Router();
  r.get('/', guard.view, validate({ query: registerListQuery }), h.list);
  r.post('/', guard.create, validate({ body: create }), h.create);
  r.get('/:id', guard.view, validate({ params: idParam }), h.get);
  r.patch('/:id', guard.edit, validate({ params: idParam, body: update }), h.update);
  r.delete('/:id', guard.remove, validate({ params: idParam }), h.remove);
  return r;
}

export const internalQcRoutes = registerRouter('internalQc', {
  view: can('INTERNAL_QUALITY_CHECK.VIEW'),
  create: can('INTERNAL_QUALITY_CHECK.CREATE'),
  edit: can('INTERNAL_QUALITY_CHECK.EDIT'),
  remove: can('INTERNAL_QUALITY_CHECK.DELETE'),
});

export const finishedCheckerRoutes = registerRouter('finishedChecker', {
  view: can('FINISHED_CHECKER.VIEW'),
  create: can('FINISHED_CHECKER.CREATE'),
  edit: can('FINISHED_CHECKER.EDIT'),
  remove: can('FINISHED_CHECKER.DELETE'),
});

export const spotRectificationRoutes = registerRouter('spotRectification', {
  view: can('SPOT_RECTIFICATION.VIEW'),
  create: can('SPOT_RECTIFICATION.CREATE'),
  edit: can('SPOT_RECTIFICATION.EDIT'),
  remove: can('SPOT_RECTIFICATION.DELETE'),
});

export const reconciliationRoutes = registerRouter('reconciliation', {
  view: can('RECONCILIATION_REPORT.VIEW'),
  create: can('RECONCILIATION_REPORT.CREATE'),
  edit: can('RECONCILIATION_REPORT.EDIT'),
  remove: can('RECONCILIATION_REPORT.DELETE'),
});

/**
 * The dropdowns every register's form reads. Open to anybody who may view
 * any of the five, so a checker can pick an order and an employee without
 * being granted the order book or the employee master.
 */
const anyRegister = can(
  'INTERNAL_QUALITY_CHECK.VIEW',
  'FINISHED_CHECKER.VIEW',
  'SPOT_RECTIFICATION.VIEW',
  'RECONCILIATION_REPORT.VIEW',
);

export const productionLookupRoutes = Router();
productionLookupRoutes.get('/orders', anyRegister, c.orderOptions);
productionLookupRoutes.get('/styles', anyRegister, c.styleOptions);
productionLookupRoutes.get('/employees', anyRegister, c.employeeOptions);
productionLookupRoutes.get('/order-context', anyRegister, validate({ query: orderContextQuery }), c.orderContext);
