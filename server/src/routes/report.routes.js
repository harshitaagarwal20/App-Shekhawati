/**
 * Operational reports.
 *
 *   GET /api/reports              the catalogue, filtered to what you may run
 *   GET /api/reports/:key         run one
 *   GET /api/reports/:key/csv     the same, as a download
 *
 * ---------------------------------------------------------------------------
 *  RBAC IS CHECKED TWICE, ON PURPOSE
 *
 *  The catalogue is filtered by permission, so a user is never offered a report
 *  the API would refuse. That is a convenience. `requireReportPermission` then
 *  checks the SAME permission on every run, from the report's own descriptor —
 *  and that is what actually protects the data.
 *
 *  Note the middleware reads the permission from `REPORTS[key]` rather than
 *  taking it from the request. A report cannot be run under a permission the
 *  caller nominated.
 * ---------------------------------------------------------------------------
 */

import { Router } from 'express';
import { z } from 'zod';
import validate from '../middleware/validate.js';
import * as c from '../controllers/report.controller.js';
import { reportQuery } from '../validators/report.validator.js';

const router = Router();

const keyParam = z.object({ key: z.string().trim().min(1).max(60) });

/** The reports this user may run. Filtered by permission in the controller. */
router.get('/', c.catalogue);

router.get(
  '/:key',
  validate({ params: keyParam, query: reportQuery }),
  c.requireReportPermission,
  c.run,
);

/**
 * The same report as a CSV download.
 *
 * Rendered on the server so the exported file and the screen carry identical
 * figures. A spreadsheet is exactly where a formatting discrepancy would be
 * discovered, months later, by somebody reconciling against the workbook.
 */
router.get(
  '/:key/csv',
  validate({ params: keyParam, query: reportQuery }),
  c.requireReportPermission,
  c.csv,
);

export default router;
