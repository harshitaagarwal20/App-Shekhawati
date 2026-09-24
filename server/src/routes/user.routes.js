import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/user.controller.js';
import { idParam, listQuery } from '../validators/common.validator.js';
import {
  createRoleSchema,
  createUserSchema,
  resetPasswordSchema,
  setActiveSchema,
  setPermissionsSchema,
  setRolesSchema,
  updateRoleSchema,
  updateUserSchema,
  userListQuery,
} from '../validators/user.validator.js';

const router = Router();

// --- Roles (mounted before /:id so "roles" is not read as a user id) --------
router.get('/roles', can('ROLE.VIEW'), validate({ query: listQuery }), c.listRoles);
router.get('/roles/permissions', can('ROLE.VIEW'), c.getPermissionCatalogue);
router.post('/roles', can('ROLE.CREATE'), validate({ body: createRoleSchema }), c.createRole);
router.get('/roles/:id', can('ROLE.VIEW'), validate({ params: idParam }), c.getRole);
router.patch('/roles/:id', can('ROLE.EDIT'), validate({ params: idParam, body: updateRoleSchema }), c.updateRole);
router.put('/roles/:id/permissions', can('ROLE.EDIT'), validate({ params: idParam, body: setPermissionsSchema }), c.setRolePermissions);
router.delete('/roles/:id', can('ROLE.DELETE'), validate({ params: idParam }), c.deleteRole);

// --- Users -----------------------------------------------------------------
router.get('/', can('USER.VIEW'), validate({ query: userListQuery }), c.listUsers);
router.post('/', can('USER.CREATE'), validate({ body: createUserSchema }), c.createUser);
router.get('/:id', can('USER.VIEW'), validate({ params: idParam }), c.getUser);
router.patch('/:id', can('USER.EDIT'), validate({ params: idParam, body: updateUserSchema }), c.updateUser);
router.put('/:id/roles', can('USER.EDIT'), validate({ params: idParam, body: setRolesSchema }), c.setUserRoles);
router.patch('/:id/active', can('USER.EDIT'), validate({ params: idParam, body: setActiveSchema }), c.setUserActive);
router.post('/:id/reset-password', can('USER.EDIT'), validate({ params: idParam, body: resetPasswordSchema }), c.resetUserPassword);
router.delete('/:id', can('USER.DELETE'), validate({ params: idParam }), c.deleteUser);

export default router;
