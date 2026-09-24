/**
 * The dashboard.
 *
 *   GET /api/dashboard    everything the caller's own permissions allow
 *
 * ---------------------------------------------------------------------------
 *  WHY THERE IS NO `can(...)` ON THIS ROUTE
 *
 *  Every other route in this application names the permission it needs, and
 *  this one deliberately does not. The reason is that the dashboard has no
 *  single subject: it is the union of eleven modules, and which of them a
 *  caller sees is decided section by section inside the service, from that
 *  caller's own permissions.
 *
 *  Guarding the route with one code would either lock out a user who legitimately
 *  holds a different one, or - worse - become a code that everybody is granted
 *  and therefore means nothing.
 *
 *  This is not a hole. `authenticate` has already run in routes/index.js, so a
 *  session is still required; and a user holding no permissions at all receives
 *  a dashboard with every section empty, which is the honest answer rather than
 *  a 403 they cannot act on.
 * ---------------------------------------------------------------------------
 */

import { Router } from 'express';
import * as c from '../controllers/dashboard.controller.js';

const router = Router();

router.get('/', c.summary);

export default router;
