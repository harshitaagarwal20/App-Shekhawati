import { z } from 'zod';

/** Turns of the conversation sent back with a question. Older ones are dropped by the screen. */
export const MAX_HISTORY = 12;

export const askSchema = z.object({
  question: z.string().trim().min(2, 'Type a question').max(2000, 'Keep a question under 2,000 characters'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().trim().min(1).max(8000),
      }),
    )
    .max(MAX_HISTORY)
    .default([]),
});

/** Multipart fields beside the file. An empty select arrives as ''. */
export const uploadSchema = z.object({
  requiredPermission: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
});
