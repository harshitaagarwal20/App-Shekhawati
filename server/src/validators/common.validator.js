/**
 * Zod fragments shared by every module, so that "a UUID path param", "a list
 * query" and "a password" mean exactly one thing across the whole API.
 */

import { z } from 'zod';

export const uuid = z.string().uuid('Must be a valid id');

export const idParam = z.object({ id: uuid });

/**
 * An ISO date (YYYY-MM-DD) or a full timestamp.
 *
 * ===========================================================================
 *  WHY THIS IS NOT `Date.parse(v)` ALONE
 * ===========================================================================
 *
 *  It was, in twelve separate copies, and it let impossible dates through
 *  silently. JavaScript does not reject a day that does not exist in its
 *  month - it rolls it forward:
 *
 *      Date.parse('2026-02-31')  ->  3 March 2026     accepted, and CHANGED
 *      Date.parse('2026-13-01')  ->  NaN              rejected
 *      Date.parse('not-a-date')  ->  NaN              rejected
 *
 *  So the obviously-wrong inputs were caught and the plausible typo was not.
 *  An order submitted as 31 February came back 201 Created and was stored as
 *  3 March, with nothing anywhere telling the person who typed it that the
 *  date they entered is not the date that was saved. A wrong date that is
 *  never mentioned is worse than one that is refused.
 *
 *  The fix is to parse the calendar part ourselves and check the date we get
 *  back still has the year, month and day that were typed. If the roll-over
 *  moved it, the date was not real.
 *
 *  Timestamps are left to `Date.parse` - the calendar check applies to the
 *  YYYY-MM-DD head, which is the part a person types.
 * ---------------------------------------------------------------------------
 */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/;

export function isRealCalendarDate(value) {
  const text = String(value ?? '').trim();
  const m = CALENDAR_DATE.exec(text);
  // Not a YYYY-MM-DD shape at all: fall back to whether it parses as a date.
  if (!m) return !Number.isNaN(Date.parse(text));

  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  // UTC, so a local timezone cannot shift the day underneath the comparison.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
  );
}

export const isoDate = z
  .string()
  .trim()
  .refine(isRealCalendarDate, 'Must be a real date - check the day exists in that month');

/**
 * A trimmed optional string. An empty string means "clear this"; an absent key
 * means "leave this alone".
 *
 * ---------------------------------------------------------------------------
 *  WHY THE DISTINCTION MATTERS
 *
 *  Every partial update in this application is written as:
 *
 *      ...(input.field !== undefined ? { field: input.field } : {})
 *
 *  which only works if a field the client never sent stays `undefined` after
 *  validation. This helper used to end `.nullish().transform((v) => v ?? null)`,
 *  and because the outer transform also runs for an absent key, EVERY optional
 *  text field came out of Zod as an explicit `null`.
 *
 *  The effect was that any partial update silently erased every optional text
 *  field the user had not retyped - a colour, a size group, a remark, the
 *  justification for an order's excess. It looked like the data had never been
 *  entered.
 *
 *  So: absent stays absent, '' becomes null (an explicit clear), and text is
 *  trimmed. Creates are unaffected - they read `input.field ?? null`, which
 *  handles undefined and null identically.
 * ---------------------------------------------------------------------------
 */
/**
 * PostgreSQL stores text as UTF-8 and has no way to hold a NUL byte, so one
 * arriving in a remark aborts the INSERT with SQLSTATE 22021 - which reached
 * the client as a bare 500 with the document unsaved and no reason given.
 *
 * Nobody types a NUL. It arrives pasted out of a spreadsheet or a scanner
 * export, so the honest answer is to name it and let the user retype, rather
 * than to strip it silently and store text they did not check.
 */
const noNulBytes = (schema) =>
  schema.refine((v) => !v.includes('\u0000'), {
    message: 'This text contains a character that cannot be stored. Retype or re-paste it.',
  });

export const optionalText = (max) =>
  z
    .union([
      noNulBytes(
        z
          .string()
          .trim()
          .max(max, `Cannot be longer than ${max} characters`),
      ).transform((v) => (v === '' ? null : v)),
      z.null(),
    ])
    .optional();

/**
 * A required text field.
 *
 * The `required_error` matters as much as the `min`: Zod's default message for
 * an ABSENT key is the bare word "Required", which tells a business user
 * nothing. A field left blank and a field never sent are the same mistake from
 * where they are sitting, so they get the same sentence.
 */
export const requiredText = (max, label = 'This field') =>
  noNulBytes(
    z
      .string({
        required_error: `${label} is required`,
        invalid_type_error: `${label} is required`,
      })
      .trim()
      .min(1, `${label} is required`)
      .max(max, `${label} cannot be longer than ${max} characters`),
  );

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Must be a valid email address')
  .max(150);

export const statusActive = z.enum(['ACTIVE', 'INACTIVE']);

/**
 * Passwords that meet the length and number rules but are among the
 * first a guesser tries - including this company's own name and the seeded
 * defaults. Compared case-insensitively.
 */
const COMMON_PASSWORDS = new Set([
  'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd',
  'abcd1234', 'abc12345', 'abc123456', 'qwerty123', 'qwerty1234', 'qwertyuiop1',
  'iloveyou1', 'welcome1', 'welcome123', 'admin123', 'admin1234', 'admin@123',
  'letmein1', 'india123', 'india@123', 'jaipur123', 'jaipur@123', 'test1234',
  'shekhawati1', 'shekhawati123', 'shekhawati@123', 'sekawati1', 'sekawati123', 'sekawati@123', 'user1234', 'changeme1',
  '12341234', '11223344', '12121212', '00000001', '10203040', '69696969',
]);

/**
 * A PIN-style password that is one digit repeated (11111111) or a run up or
 * down (12345678, 98765432, 34567890). The first thing anyone tries.
 */
function isObviousDigits(v) {
  if (!/^\d+$/.test(v)) return false;
  if (/^(\d)\1+$/.test(v)) return true;
  const ascending = '01234567890123456789';
  const descending = '98765432109876543210';
  return ascending.includes(v) || descending.includes(v);
}

/**
 * Password policy: at least 8 characters including a digit - so an 8-digit
 * number is a valid password, and letters are optional - but not one of the
 * common passwords above or an obvious digit run.
 */
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[0-9]/.test(v), 'Password must contain a number')
  .refine(
    (v) => !COMMON_PASSWORDS.has(v.toLowerCase()) && !isObviousDigits(v),
    'This password is too common and easy to guess. Choose another.',
  );

/** Standard list query: ?page&pageSize&search&sortBy&sortDir&status&includeDeleted */
export const listQuery = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(200).default(25),
    search: z.string().trim().max(120).optional(),
    sortBy: z.string().trim().max(60).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    status: statusActive.optional(),
    includeDeleted: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .passthrough();

/** Decimal-bearing numeric field, accepted as string or number. */
/**
 * A plain decimal numeral, optionally signed, optionally exponent.
 *
 * `Number()` is far more generous than a quantity field should be: it reads
 * '0x10' as 16, '0b11' as 3 and '' as 0, so a typo in a rate column could be
 * stored as a number nobody typed. Everything a business user actually enters
 * matches this pattern, and nothing else gets to reach the database.
 */
const DECIMAL_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Every money and quantity column in this schema is `Decimal(18, 4)`, which
 * PostgreSQL will accept only up to (but not including) 10^14. Past that it
 * raises SQLSTATE 22003 mid-INSERT, which the caller used to receive as a bare
 * 500 - the request was refused with no way to tell what was wrong with it.
 * The ceiling belongs here, where the field can be named.
 */
const DECIMAL_CEILING = 1e14;

export const decimal = (label = 'Value', { min = 0, allowZero = true, max = DECIMAL_CEILING } = {}) =>
  z
    .union([z.string().trim(), z.number()])
    .transform((v, ctx) => {
      if (typeof v === 'string' && !DECIMAL_TEXT.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a number` });
        return z.NEVER;
      }
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a number` });
        return z.NEVER;
      }
      if (n < min || (!allowZero && n === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: allowZero ? `${label} must be at least ${min}` : `${label} must be greater than ${min}`,
        });
        return z.NEVER;
      }
      if (Math.abs(n) >= max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} is too large - it must be less than ${max.toLocaleString('en-IN')}`,
        });
        return z.NEVER;
      }
      return String(n);
    });

/** A percentage the workbook stores as a fraction (0.02 = 2%). */
export const fraction = (label = 'Percentage') =>
  z
    .union([z.string().trim(), z.number()])
    .transform((v, ctx) => {
      if (typeof v === 'string' && !DECIMAL_TEXT.test(v)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be a fraction between 0 and 1 (0.02 = 2%)`,
        });
        return z.NEVER;
      }
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n) || n < 0 || n >= 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be a fraction between 0 and 1 (0.02 = 2%)`,
        });
        return z.NEVER;
      }
      return String(n);
    });
