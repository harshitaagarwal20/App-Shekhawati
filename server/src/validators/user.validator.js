import { z } from 'zod';
import { email, listQuery, optionalText, password, requiredText, uuid } from './common.validator.js';

const roleCodes = z
  .array(z.string().trim().min(1).max(60))
  .min(1, 'At least one role must be assigned');

export const userListQuery = listQuery.extend({
  roleCode: z.string().trim().max(60).optional(),
});

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Username must be at least 3 characters')
    .max(60)
    .regex(/^[a-z0-9._-]+$/, 'Username may contain only letters, numbers, dot, underscore and hyphen'),
  fullName: requiredText(120, 'Full name'),
  email: email.optional().nullable(),
  password,
  employeeId: uuid.nullish(),
  isActive: z.boolean().default(true),
  roleCodes,
});

export const updateUserSchema = z.object({
  fullName: requiredText(120, 'Full name').optional(),
  email: email.nullish(),
  employeeId: uuid.nullish(),
});

export const setRolesSchema = z.object({ roleCodes });

export const setActiveSchema = z.object({ isActive: z.boolean() });

export const resetPasswordSchema = z.object({ newPassword: password });

export const createRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(60)
    .regex(/^[A-Z0-9_]+$/, 'Role code may contain only capital letters, numbers and underscore'),
  name: requiredText(120, 'Role name'),
  description: optionalText(255),
  permissions: z.array(z.string().trim().max(80)).default([]),
});

export const updateRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(60)
    .regex(/^[A-Z0-9_]+$/)
    .optional(),
  name: requiredText(120, 'Role name').optional(),
  description: optionalText(255),
});

export const setPermissionsSchema = z.object({
  permissions: z.array(z.string().trim().max(80)),
});
