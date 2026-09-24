/**
 * Authentication middleware.
 *
 * Verifies the Bearer access token, then re-checks the session and the user
 * against the database on every request. The JWT alone is not trusted to keep
 * a user logged in: if the session was revoked (logout, "log out everywhere",
 * an admin disabling the account) or the user was deactivated or soft-deleted,
 * the request is rejected even though the signature is still valid.
 *
 * Permissions are re-read from the database rather than taken from the token,
 * so a role change takes effect on the next request instead of at token expiry.
 */

import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/tokens.js';

function extractToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length ? token : null;
}

export async function authenticate(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized('Missing bearer token');

    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw ApiError.unauthorized('Access token expired', 'TOKEN_EXPIRED');
      }
      throw ApiError.unauthorized('Invalid access token', 'TOKEN_INVALID');
    }

    const [user, session] = await Promise.all([
      prisma.user.findFirst({
        where: { id: claims.sub, deletedAt: null },
        include: {
          employee: { select: { id: true, empId: true, empName: true, department: true, designation: true } },
          roles: {
            include: {
              role: {
                include: {
                  permissions: { include: { permission: { select: { code: true } } } },
                },
              },
            },
          },
        },
      }),
      claims.sid
        ? prisma.userSession.findUnique({ where: { id: claims.sid } })
        : Promise.resolve(null),
    ]);

    if (!user) throw ApiError.unauthorized('Account no longer exists', 'ACCOUNT_GONE');
    if (!user.isActive) throw ApiError.unauthorized('Account is disabled', 'ACCOUNT_DISABLED');

    if (!session || session.userId !== user.id) {
      throw ApiError.unauthorized('Session not found', 'SESSION_INVALID');
    }
    if (session.revokedAt) {
      throw ApiError.unauthorized('Session has been ended', 'SESSION_REVOKED');
    }
    if (session.expiresAt <= new Date()) {
      throw ApiError.unauthorized('Session has expired', 'SESSION_EXPIRED');
    }

    // Permissions come from the database, not from the token.
    const roles = user.roles.map((ur) => ur.role.code);
    const permissions = new Set();
    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) permissions.add(rp.permission.code);
    }

    req.auth = {
      userId: user.id,
      sessionId: session.id,
      username: user.username,
      fullName: user.fullName,
      employee: user.employee,
      mustChangePassword: user.mustChangePassword,
      roles,
      permissions,
      isAdmin: roles.includes('ADMIN'),
      has: (code) => roles.includes('ADMIN') || permissions.has(code),
    };

    next();
  } catch (err) {
    next(err);
  }
}

export default authenticate;
