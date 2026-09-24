/**
 * The audit trail.
 *
 *   GET /api/audit                    row-level writes, filtered and paged
 *   GET /api/audit/summary            what has been touched lately
 *   GET /api/audit/tables             the audited tables, for the filter
 *   GET /api/audit/actors             who has written anything
 *   GET /api/audit/:id                one entry, with full before/after
 *   GET /api/audit/trail/:tableName/:recordId
 *                                     everything that happened to one record
 *
 * ---------------------------------------------------------------------------
 *  EVERY ROUTE IS A GET
 *
 *  There is no POST, PATCH or DELETE here, and no service function behind one.
 *  An audit trail that the application can rewrite is not evidence of anything.
 *  Retention, if it is ever needed, is a database policy - not a screen.
 *
 *  AUDIT.VIEW is deliberately its own permission rather than folded into
 *  USER.VIEW. The trail carries the before-and-after of every rate, price and
 *  approval in the system, so seeing it is a broader grant than administering
 *  logins, and the two should be given out separately.
 * ---------------------------------------------------------------------------
 */

import { Router } from 'express';
import { can } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import * as c from '../controllers/audit.controller.js';
import {
  auditListQuery,
  auditSummaryQuery,
  auditTrailParams,
  idParam,
} from '../validators/audit.validator.js';

const router = Router();

router.get('/', can('AUDIT.VIEW'), validate({ query: auditListQuery }), c.list);

router.get('/summary', can('AUDIT.VIEW'), validate({ query: auditSummaryQuery }), c.summary);

router.get('/tables', can('AUDIT.VIEW'), c.tables);

router.get('/actors', can('AUDIT.VIEW'), c.actors);

/**
 * Declared before `/:id` so that "trail" is never read as an entry id. Express
 * matches in order, and a uuid check on `/:id` would reject it with a confusing
 * message rather than falling through.
 */
router.get(
  '/trail/:tableName/:recordId',
  can('AUDIT.VIEW'),
  validate({ params: auditTrailParams }),
  c.trail,
);

router.get('/:id', can('AUDIT.VIEW'), validate({ params: idParam }), c.getById);

export default router;
