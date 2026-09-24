/**
 * Role and permission administration.
 *
 * System roles (the nine seeded ones) cannot be renamed away or deleted, but
 * their permission sets remain editable - that is the knob an administrator
 * actually needs. Changing a role's permissions ends the sessions of everyone
 * holding it, so the change is immediate and unambiguous.
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';

export const SORTABLE = ['code', 'name', 'createdAt'];

const INCLUDE = {
  permissions: { include: { permission: true } },
  _count: { select: { users: true } },
};

function project(role) {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    userCount: role._count?.users ?? 0,
    permissions: (role.permissions ?? [])
      .map((rp) => rp.permission.code)
      .sort(),
  };
}

export async function list({ page, pageSize, skip, take, orderBy, search, includeDeleted }) {
  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...searchFilter(search, ['code', 'name', 'description']),
  };
  const [rows, total] = await Promise.all([
    prisma.role.findMany({ where, orderBy, skip, take, include: INCLUDE }),
    prisma.role.count({ where }),
  ]);
  return { rows: rows.map(project), total, page, pageSize };
}

export async function getById(id) {
  const role = await prisma.role.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!role) throw ApiError.notFound('Role');
  return project(role);
}

/** The full permission catalogue, grouped by module, for the role editor. */
export async function permissionCatalogue() {
  const permissions = await prisma.permission.findMany({
    orderBy: [{ module: 'asc' }, { action: 'asc' }],
  });
  const byModule = new Map();
  for (const p of permissions) {
    if (!byModule.has(p.module)) byModule.set(p.module, []);
    byModule.get(p.module).push({ code: p.code, action: p.action, description: p.description });
  }
  return [...byModule].map(([module, actions]) => ({ module, actions }));
}

async function resolvePermissionIds(codes) {
  const permissions = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const found = new Set(permissions.map((p) => p.code));
  const missing = codes.filter((c) => !found.has(c));
  if (missing.length) {
    throw ApiError.badRequest(`Unknown permission(s): ${missing.join(', ')}`, { missing });
  }
  return permissions.map((p) => p.id);
}

export async function create(input, actorId) {
  const clash = await prisma.role.findUnique({ where: { code: input.code } });
  if (clash) throw ApiError.conflict('A role with this code already exists', { field: 'code' });

  const permissionIds = await resolvePermissionIds(input.permissions ?? []);

  const role = await prisma.role.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description,
      isSystem: false,
      createdById: actorId,
      updatedById: actorId,
      permissions: {
        create: permissionIds.map((permissionId) => ({ permissionId, createdById: actorId })),
      },
    },
    include: INCLUDE,
  });
  return project(role);
}

export async function update(id, input, actorId) {
  const role = await prisma.role.findFirst({ where: { id, deletedAt: null } });
  if (!role) throw ApiError.notFound('Role');
  if (role.isSystem && input.code && input.code !== role.code) {
    throw ApiError.badRequest('The code of a system role cannot be changed');
  }

  const updated = await prisma.role.update({
    where: { id },
    data: {
      ...(input.code !== undefined && !role.isSystem ? { code: input.code } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      updatedById: actorId,
    },
    include: INCLUDE,
  });
  return project(updated);
}

/** Replaces the role's permission set and ends the sessions of its holders. */
export async function setPermissions(id, codes, actorId) {
  const role = await prisma.role.findFirst({ where: { id, deletedAt: null } });
  if (!role) throw ApiError.notFound('Role');

  if (role.code === 'ADMIN') {
    throw ApiError.badRequest(
      'The ADMIN role grants everything by construction and cannot be narrowed.',
    );
  }

  const permissionIds = await resolvePermissionIds(codes);

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: id } }),
    prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId: id, permissionId, createdById: actorId })),
    }),
    prisma.role.update({ where: { id }, data: { updatedById: actorId } }),
    prisma.userSession.updateMany({
      where: { revokedAt: null, user: { roles: { some: { roleId: id } } } },
      data: { revokedAt: new Date(), revokedReason: 'ROLE_PERMISSIONS_CHANGED' },
    }),
  ]);

  return getById(id);
}

export async function remove(id, actorId) {
  const role = await prisma.role.findFirst({
    where: { id, deletedAt: null },
    include: { _count: { select: { users: true } } },
  });
  if (!role) throw ApiError.notFound('Role');
  if (role.isSystem) throw ApiError.badRequest('System roles cannot be deleted');
  if (role._count.users > 0) {
    throw ApiError.conflict(
      `${role._count.users} user(s) still hold this role. Reassign them first.`,
    );
  }

  await prisma.role.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId },
  });
  return { deleted: true };
}
