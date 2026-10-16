/**
 * Server-side RBAC. This is the security boundary - the React navigation only
 * hides links, it never protects anything.
 *
 *   router.get('/', authenticate, can('BUYER.VIEW'), controller.list)
 *
 * `can()` grants when the user holds ANY of the listed permission codes.
 * ADMIN passes everything by construction
 * (see authenticate.js, which sets `has()` to short-circuit for that role).
 */

import { ApiError } from '../utils/ApiError.js';

function ensureAuth(req) {
  if (!req.auth) {
    throw new Error(
      'authorize() used without authenticate() - the route is unprotected. This is a bug.',
    );
  }
}

/** Grants if the user holds at least one of `codes`. */
export function can(...codes) {
  const required = codes.flat();
  return (req, _res, next) => {
    try {
      ensureAuth(req);
      if (required.some((code) => req.auth.has(code))) return next();
      return next(
        ApiError.forbidden(
          `This action requires one of: ${required.join(', ')}`,
          // Not the caller's own permission list: a refused request should
          // not hand back a map of everything else the account can do.
          { required },
        ),
      );
    } catch (err) {
      next(err);
    }
  };
}

export default can;
