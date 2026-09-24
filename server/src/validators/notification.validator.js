import { z } from 'zod';
import { isoDate, uuid } from './common.validator.js';

const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

export const notificationListQuery = z.object({
  unreadOnly: flag,
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /// Cursor: rows created before this moment, for "load older".
  before: isoDate.optional(),
});

export const markReadSchema = z.object({
  /// Omitted or empty: mark every unread notification read.
  ids: z.array(uuid).max(200).optional(),
});

export const preferencesSchema = z.object({
  notifyByEmail: z.boolean().optional(),
  notifyByWhatsapp: z.boolean().optional(),
  whatsappNumber: z.string().trim().max(20).nullish(),
});
