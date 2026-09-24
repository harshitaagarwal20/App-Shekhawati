/**
 * Authentication service: login, refresh, logout, password change, and the
 * "who am I" projection the React client boots from.
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import {
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  verifyPassword,
} from '../utils/tokens.js';

const USER_WITH_ROLES = {
  employee: {
    select: { id: true, empId: true, empName: true, department: true, designation: true, unitLine: true },
  },
  roles: {
    include: {
      role: {
        include: { permissions: { include: { permission: { select: { code: true } } } } },
      },
    },
  },
};

/** Flattens the nested role/permission include into plain arrays. */
export function projectUser(user) {
  const roles = user.roles.map((ur) => ({
    code: ur.role.code,
    name: ur.role.name,
  }));
  const permissions = [
    ...new Set(user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code))),
  ].sort();

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    employee: user.employee,
    roles,
    roleCodes: roles.map((r) => r.code),
    permissions,
  };
}

async function issueSession(user, { ip, userAgent }) {
  const refreshToken = generateRefreshToken();
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiry(),
      ipAddress: ip ?? null,
      userAgent: userAgent ? userAgent.slice(0, 255) : null,
    },
  });

  const projected = projectUser(user);
  const accessToken = signAccessToken({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    sessionId: session.id,
    roles: projected.roleCodes,
    permissions: projected.permissions,
  });

  return { accessToken, refreshToken, sessionId: session.id, user: projected };
}

/**
 * Verifies credentials and opens a session.
 *
 * The same message is returned for an unknown username and a wrong password so
 * the endpoint cannot be used to enumerate accounts. A disabled account is
 * reported distinctly, but only after the password has been verified.
 */
export async function login({ username, password, ip, userAgent }) {
  const user = await prisma.user.findFirst({
    where: { username: username.toLowerCase(), deletedAt: null },
    include: USER_WITH_ROLES,
  });

  // Always run a comparison so a missing user and a wrong password take
  // comparable time.
  const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const passwordOk = await verifyPassword(password, hash);

  if (!user || !passwordOk) {
    throw ApiError.unauthorized('Incorrect username or password', 'INVALID_CREDENTIALS');
  }
  if (!user.isActive) {
    throw ApiError.unauthorized('This account is disabled. Contact the administrator.', 'ACCOUNT_DISABLED');
  }
  if (user.roles.length === 0) {
    throw ApiError.forbidden('No role has been assigned to this account. Contact the administrator.');
  }

  const issued = await issueSession(user, { ip, userAgent });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return issued;
}

/**
 * Exchanges a refresh token for a new access token, rotating the refresh token.
 *
 * If a token that has already been rotated away is presented, every session for
 * that user is revoked: presenting a used token means either a replay or a
 * stolen token, and in both cases the safe response is to end all sessions.
 */
export async function refresh({ refreshToken, ip, userAgent }) {
  const tokenHash = hashRefreshToken(refreshToken);
  const session = await prisma.userSession.findUnique({
    where: { refreshTokenHash: tokenHash },
    include: { user: { include: USER_WITH_ROLES } },
  });

  if (!session) throw ApiError.unauthorized('Invalid refresh token', 'REFRESH_INVALID');

  if (session.revokedAt) {
    await prisma.userSession.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
    });
    throw ApiError.unauthorized(
      'This session has already ended. Please sign in again.',
      'REFRESH_REUSED',
    );
  }

  if (session.expiresAt <= new Date()) {
    throw ApiError.unauthorized('Session expired. Please sign in again.', 'REFRESH_EXPIRED');
  }

  const { user } = session;
  if (!user || user.deletedAt) throw ApiError.unauthorized('Account no longer exists', 'ACCOUNT_GONE');
  if (!user.isActive) throw ApiError.unauthorized('Account is disabled', 'ACCOUNT_DISABLED');

  // Rotate: close the old session, then open a new one.
  await prisma.userSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date(), revokedReason: 'ROTATED', lastUsedAt: new Date() },
  });

  return issueSession(user, { ip, userAgent });
}

/** Ends one session. Idempotent - logging out twice is not an error. */
export async function logout({ sessionId }) {
  await prisma.userSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
  });
}

/** Ends every session for a user ("log out everywhere"). */
export async function logoutAll({ userId, reason = 'LOGOUT_ALL' }) {
  const { count } = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return count;
}

/** The current user, re-read from the database. */
export async function me(userId) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: USER_WITH_ROLES,
  });
  if (!user) throw ApiError.notFound('User');
  return projectUser(user);
}

/**
 * Changes the caller's own password. Every other session is revoked, since a
 * password change is exactly when a possibly-compromised session should end.
 */
export async function changePassword({ userId, sessionId, currentPassword, newPassword }) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw ApiError.notFound('User');

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw ApiError.badRequest('Current password is incorrect');

  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw ApiError.badRequest('New password must be different from the current password');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
        updatedById: userId,
      },
    }),
    prisma.userSession.updateMany({
      where: { userId, revokedAt: null, id: { not: sessionId } },
      data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
    }),
  ]);
}

/** Active sessions for a user, for the "signed in on" panel. */
export async function listSessions(userId) {
  return prisma.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      lastUsedAt: true,
      createdAt: true,
      expiresAt: true,
    },
  });
}
