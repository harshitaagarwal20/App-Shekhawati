/**
 * The registers kept after cutting, each at its own path.
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

export const stitchingRecordRoutes = registerRouter('stitching', {
  view: can('STITCHING_RECORD.VIEW'),
  create: can('STITCHING_RECORD.CREATE'),
  edit: can('STITCHING_RECORD.EDIT'),
  remove: can('STITCHING_RECORD.DELETE'),
});

export const hourlyMonitoringRoutes = registerRouter('hourly', {
  view: can('HOURLY_MONITORING.VIEW'),
  create: can('HOURLY_MONITORING.CREATE'),
  edit: can('HOURLY_MONITORING.EDIT'),
  remove: can('HOURLY_MONITORING.DELETE'),
});

export const qcSizeRoutes = registerRouter('qcSize', {
  view: can('QC_SIZE_RECORD.VIEW'),
  create: can('QC_SIZE_RECORD.CREATE'),
  edit: can('QC_SIZE_RECORD.EDIT'),
  remove: can('QC_SIZE_RECORD.DELETE'),
});

export const qcDefectRoutes = registerRouter('qcDefect', {
  view: can('QC_DEFECT_RECORD.VIEW'),
  create: can('QC_DEFECT_RECORD.CREATE'),
  edit: can('QC_DEFECT_RECORD.EDIT'),
  remove: can('QC_DEFECT_RECORD.DELETE'),
});

export const internalQcRoutes = registerRouter('internalQc', {
  view: can('INTERNAL_QUALITY_CHECK.VIEW'),
  create: can('INTERNAL_QUALITY_CHECK.CREATE'),
  edit: can('INTERNAL_QUALITY_CHECK.EDIT'),
  remove: can('INTERNAL_QUALITY_CHECK.DELETE'),
});

export const finalCheckerRoutes = registerRouter('finalChecker', {
  view: can('FINAL_CHECKER_REPORT.VIEW'),
  create: can('FINAL_CHECKER_REPORT.CREATE'),
  edit: can('FINAL_CHECKER_REPORT.EDIT'),
  remove: can('FINAL_CHECKER_REPORT.DELETE'),
});

export const finishedCheckerRoutes = registerRouter('finishedChecker', {
  view: can('FINISHED_CHECKER.VIEW'),
  create: can('FINISHED_CHECKER.CREATE'),
  edit: can('FINISHED_CHECKER.EDIT'),
  remove: can('FINISHED_CHECKER.DELETE'),
});

export const externalCheckRoutes = registerRouter('externalCheck', {
  view: can('EXTERNAL_SECONDARY_CHECK.VIEW'),
  create: can('EXTERNAL_SECONDARY_CHECK.CREATE'),
  edit: can('EXTERNAL_SECONDARY_CHECK.EDIT'),
  remove: can('EXTERNAL_SECONDARY_CHECK.DELETE'),
});

export const alterReportRoutes = registerRouter('alter', {
  view: can('ALTER_REPORT.VIEW'),
  create: can('ALTER_REPORT.CREATE'),
  edit: can('ALTER_REPORT.EDIT'),
  remove: can('ALTER_REPORT.DELETE'),
});

export const spotRectificationRoutes = registerRouter('spotRectification', {
  view: can('SPOT_RECTIFICATION.VIEW'),
  create: can('SPOT_RECTIFICATION.CREATE'),
  edit: can('SPOT_RECTIFICATION.EDIT'),
  remove: can('SPOT_RECTIFICATION.DELETE'),
});

export const rejectedRecordRoutes = registerRouter('rejected', {
  view: can('REJECTED_RECORD.VIEW'),
  create: can('REJECTED_RECORD.CREATE'),
  edit: can('REJECTED_RECORD.EDIT'),
  remove: can('REJECTED_RECORD.DELETE'),
});

export const reconciliationRoutes = registerRouter('reconciliation', {
  view: can('RECONCILIATION_REPORT.VIEW'),
  create: can('RECONCILIATION_REPORT.CREATE'),
  edit: can('RECONCILIATION_REPORT.EDIT'),
  remove: can('RECONCILIATION_REPORT.DELETE'),
});

/**
 * The dropdowns every register's form reads. Open to anybody who may view
 * any of the twelve, so a stitching supervisor can pick an order and an
 * operator without being granted the order book or the employee master.
 */
const anyRegister = can(
  'STITCHING_RECORD.VIEW',
  'HOURLY_MONITORING.VIEW',
  'QC_SIZE_RECORD.VIEW',
  'QC_DEFECT_RECORD.VIEW',
  'INTERNAL_QUALITY_CHECK.VIEW',
  'FINAL_CHECKER_REPORT.VIEW',
  'FINISHED_CHECKER.VIEW',
  'EXTERNAL_SECONDARY_CHECK.VIEW',
  'ALTER_REPORT.VIEW',
  'SPOT_RECTIFICATION.VIEW',
  'REJECTED_RECORD.VIEW',
  'RECONCILIATION_REPORT.VIEW',
);

export const productionLookupRoutes = Router();
productionLookupRoutes.get('/orders', anyRegister, c.orderOptions);
productionLookupRoutes.get('/styles', anyRegister, c.styleOptions);
productionLookupRoutes.get('/employees', anyRegister, c.employeeOptions);
productionLookupRoutes.get('/order-context', anyRegister, validate({ query: orderContextQuery }), c.orderContext);
