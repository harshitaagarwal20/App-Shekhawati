/**
 * User management: CRUD, role assignment, activation, admin password reset.
 *
 * Every mutation revokes the affected user's sessions where the change alters
 * what they may do or whether they may be here at all - deactivation, role
 * change, password reset. Permissions are re-read per request too, but ending
 * the session is the unambiguous action.
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { hashPassword } from '../utils/tokens.js';
import { projectUser } from './auth.service.js';
import { logoutAll } from './auth.service.js';
import { searchFilter } from '../utils/http.js';

const INCLUDE = {
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

export const SORTABLE = ['username', 'fullName', 'email', 'isActive', 'lastLoginAt', 'createdAt'];

export async function list({ page, pageSize, skip, take, orderBy, search, includeDeleted, status, roleCode }) {
  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(status ? { isActive: status === 'ACTIVE' } : {}),
    ...(roleCode ? { roles: { some: { role: { code: roleCode } } } } : {}),
    ...searchFilter(search, ['username', 'fullName', 'email']),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy, skip, take, include: INCLUDE }),
    prisma.user.count({ where }),
  ]);

  return { rows: rows.map(projectUser), total, page, pageSize };
}

export async function getById(id) {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!user) throw ApiError.notFound('User');
  return projectUser(user);
}

async function resolveRoleIds(roleCodes) {
  const roles = await prisma.role.findMany({
    where: { code: { in: roleCodes }, deletedAt: null },
    select: { id: true, code: true },
  });
  const found = new Set(roles.map((r) => r.code));
  const missing = roleCodes.filter((c) => !found.has(c));
  if (missing.length) {
    throw ApiError.badRequest(`Unknown role(s): ${missing.join(', ')}`, { missing });
  }
  return roles.map((r) => r.id);
}

export async function create(input, actorId) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: input.username }, ...(input.email ? [{ email: input.email }] : [])] },
    select: { id: true, username: true, email: true, deletedAt: true },
  });
  if (existing) {
    const field = existing.username === input.username ? 'username' : 'email';
    throw ApiError.conflict(
      existing.deletedAt
        ? `A deleted user already uses this ${field}. Restore that user instead.`
        : `This ${field} is already taken`,
      { field },
    );
  }

  if (input.employeeId) {
    const employee = await prisma.employee.findFirst({
      where: { id: input.employeeId, deletedAt: null },
    });
    if (!employee) throw ApiError.badRequest('Linked employee does not exist');
  }

  const roleIds = await resolveRoleIds(input.roleCodes);

  const user = await prisma.user.create({
    data: {
      username: input.username,
      email: input.email,
      fullName: input.fullName,
      passwordHash: await hashPassword(input.password),
      isActive: input.isActive ?? true,
      mustChangePassword: false,
      employeeId: input.employeeId ?? null,
      createdById: actorId,
      updatedById: actorId,
      roles: { create: roleIds.map((roleId) => ({ roleId, createdById: actorId })) },
    },
    include: INCLUDE,
  });

  return projectUser(user);
}

export async function update(id, input, actorId) {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw ApiError.notFound('User');

  if (input.email && input.email !== user.email) {
    const clash = await prisma.user.findFirst({
      where: { email: input.email, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict('This email is already taken', { field: 'email' });
  }

  if (input.employeeId) {
    const employee = await prisma.employee.findFirst({
      where: { id: input.employeeId, deletedAt: null },
    });
    if (!employee) throw ApiError.badRequest('Linked employee does not exist');
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}),
      updatedById: actorId,
    },
    include: INCLUDE,
  });

  return projectUser(updated);
}

/** Replaces the user's role set wholesale, then ends their sessions. */
export async function setRoles(id, roleCodes, actorId) {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw ApiError.notFound('User');

  const roleIds = await resolveRoleIds(roleCodes);

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: id } }),
    prisma.userRole.createMany({
      data: roleIds.map((roleId) => ({ userId: id, roleId, createdById: actorId })),
    }),
    prisma.user.update({ where: { id }, data: { updatedById: actorId } }),
  ]);

  await logoutAll({ userId: id, reason: 'ROLES_CHANGED' });

  return getById(id);
}

/**
 * Activates or deactivates a user. Deactivating ends every session at once
 * rather than waiting for the access token to expire.
 */
export async function setActive(id, isActive, actorId) {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw ApiError.notFound('User');

  if (!isActive && id === actorId) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }
  if (!isActive) await assertNotLastAdmin(id);

  await prisma.user.update({ where: { id }, data: { isActive, updatedById: actorId } });
  if (!isActive) await logoutAll({ userId: id, reason: 'DEACTIVATED' });

  return getById(id);
}

/** Administrator password reset. The new password is used as-is at next login. */
export async function resetPassword(id, newPassword, actorId) {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw ApiError.notFound('User');

  await prisma.user.update({
    where: { id },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      updatedById: actorId,
    },
  });

  await logoutAll({ userId: id, reason: 'PASSWORD_RESET' });
  return { reset: true };
}

/** Soft delete. The username is retained so it can never be silently reused. */
export async function remove(id, actorId) {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw ApiError.notFound('User');
  if (id === actorId) throw ApiError.badRequest('You cannot delete your own account');
  await assertNotLastAdmin(id);

  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId, isActive: false },
  });
  await logoutAll({ userId: id, reason: 'DELETED' });

  return { deleted: true };
}

/**
 * Guards the one irreversible mistake in user administration: removing the last
 * account that can still administer the system.
 */
async function assertNotLastAdmin(userId) {
  const isAdmin = await prisma.userRole.findFirst({
    where: { userId, role: { code: 'ADMIN' } },
    select: { userId: true },
  });
  if (!isAdmin) return;

  const otherAdmins = await prisma.user.count({
    where: {
      id: { not: userId },
      isActive: true,
      deletedAt: null,
      roles: { some: { role: { code: 'ADMIN' } } },
    },
  });
  if (otherAdmins === 0) {
    throw ApiError.badRequest(
      'This is the last active administrator. Grant ADMIN to another user first.',
    );
  }
}
