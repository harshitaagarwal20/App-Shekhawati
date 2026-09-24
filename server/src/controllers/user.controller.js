import * as userService from '../services/user.service.js';
import * as roleService from '../services/role.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';

// --- Users -----------------------------------------------------------------

export const listUsers = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, { sortable: userService.SORTABLE, defaultSort: 'username' });
  const result = await userService.list({ ...q, status: req.query.status, roleCode: req.query.roleCode });
  return okList(res, result);
});

export const getUser = asyncHandler(async (req, res) =>
  ok(res, await userService.getById(req.params.id)),
);

export const createUser = asyncHandler(async (req, res) =>
  ok(res, await userService.create(req.body, req.auth.userId), 201),
);

export const updateUser = asyncHandler(async (req, res) =>
  ok(res, await userService.update(req.params.id, req.body, req.auth.userId)),
);

export const setUserRoles = asyncHandler(async (req, res) =>
  ok(res, await userService.setRoles(req.params.id, req.body.roleCodes, req.auth.userId)),
);

export const setUserActive = asyncHandler(async (req, res) =>
  ok(res, await userService.setActive(req.params.id, req.body.isActive, req.auth.userId)),
);

export const resetUserPassword = asyncHandler(async (req, res) =>
  ok(res, await userService.resetPassword(req.params.id, req.body.newPassword, req.auth.userId)),
);

export const deleteUser = asyncHandler(async (req, res) =>
  ok(res, await userService.remove(req.params.id, req.auth.userId)),
);

// --- Roles -----------------------------------------------------------------

export const listRoles = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, { sortable: roleService.SORTABLE, defaultSort: 'code' });
  return okList(res, await roleService.list(q));
});

export const getRole = asyncHandler(async (req, res) =>
  ok(res, await roleService.getById(req.params.id)),
);

export const getPermissionCatalogue = asyncHandler(async (_req, res) =>
  ok(res, await roleService.permissionCatalogue()),
);

export const createRole = asyncHandler(async (req, res) =>
  ok(res, await roleService.create(req.body, req.auth.userId), 201),
);

export const updateRole = asyncHandler(async (req, res) =>
  ok(res, await roleService.update(req.params.id, req.body, req.auth.userId)),
);

export const setRolePermissions = asyncHandler(async (req, res) =>
  ok(res, await roleService.setPermissions(req.params.id, req.body.permissions, req.auth.userId)),
);

export const deleteRole = asyncHandler(async (req, res) =>
  ok(res, await roleService.remove(req.params.id, req.auth.userId)),
);
