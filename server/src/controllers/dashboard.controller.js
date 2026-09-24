import * as service from '../services/dashboard.service.js';
import { asyncHandler, ok } from '../utils/http.js';

/**
 * The whole dashboard, built for whoever is asking.
 *
 * `req.auth` is passed straight through rather than a list of permission
 * codes, because the service decides section by section what this caller may
 * see - and `auth.has()` is the same function every route in the application
 * authorises with, including the ADMIN short-circuit. Re-deriving the caller's
 * rights here would be a second copy of that decision.
 */
export const summary = asyncHandler(async (req, res) => ok(res, await service.build(req.auth)));

export default { summary };
