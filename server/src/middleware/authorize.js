/**
 * Server-side RBAC. This is the security boundary - the React navigation only
 * hides links, it never protects anything.
 *
 *   router.get('/', authenticate, can('BUYER.VIEW'), controller.list)
 *
 * `can()` grants when the user holds ANY of the listed permission codes.
 * `canAll()` requires all of them. ADMIN passes everything by construction
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

/** Grants only if the user holds every one of `codes`. */
export function canAll(...codes) {
  const required = codes.flat();
  return (req, _res, next) => {
    try {
      ensureAuth(req);
      const missing = required.filter((code) => !req.auth.has(code));
      if (missing.length === 0) return next();
      return next(
        ApiError.forbidden(`This action requires: ${required.join(', ')}`, { required, missing }),
      );
    } catch (err) {
      next(err);
    }
  };
}

/** Grants if the user holds one of the named roles. Prefer `can()`. */
export function hasRole(...roleCodes) {
  const required = roleCodes.flat();
  return (req, _res, next) => {
    try {
      ensureAuth(req);
      if (req.auth.isAdmin || required.some((r) => req.auth.roles.includes(r))) return next();
      return next(ApiError.forbidden(`This action is restricted to: ${required.join(', ')}`));
    } catch (err) {
      next(err);
    }
  };
}

/** Restricts a route to administrators. */
export const adminOnly = hasRole('ADMIN');

export default can;
