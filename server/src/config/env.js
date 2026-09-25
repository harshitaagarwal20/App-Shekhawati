/**
 * Environment loading and validation.
 *
 * Phase 0 only needs DATABASE_URL. The auth/server keys are validated too so
 * that a misconfigured .env fails at start-up rather than at first request,
 * but nothing in Phase 0 consumes them yet.
 */

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((v) => v.startsWith('postgresql://') || v.startsWith('postgres://'), {
      message: 'DATABASE_URL must be a PostgreSQL connection string',
    }),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters - generate one with: openssl rand -base64 48')
    .refine((v) => !v.includes('CHANGE_ME'), 'JWT_SECRET is still the placeholder value'),
  /** Access-token lifetime. Short by design; the refresh token carries the session. */
  JWT_EXPIRES_IN: z.string().default('30m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().max(90).default(7),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  CLIENT_ORIGIN: z.string().default('http://localhost:5175'),

  // -------------------------------------------------------------------------
  //  The company, as it appears on a printed document
  // -------------------------------------------------------------------------
  //
  //  Deployment configuration rather than business rules: these change when the
  //  firm moves or re-registers, not when somebody makes a decision. They are
  //  here rather than hardcoded into the print layout because a GSTIN printed
  //  on a purchase invoice is a legal statement, and because COMPANY_STATE_CODE
  //  is what decides whether a purchase is CGST+SGST or IGST.
  //
  //  The state code is the first two digits of the company's own GSTIN.
  COMPANY_NAME: z.string().default('Sekawati Impex'),
  COMPANY_ADDRESS: z.string().default('G-90, Garment Zone, Sitapura Industrial Area, Jaipur - 302022'),
  COMPANY_GSTIN: z.string().default(''),
  COMPANY_STATE_CODE: z
    .string()
    .regex(/^\d{2}$/, 'COMPANY_STATE_CODE is the two-digit GST state code - 08 for Rajasthan')
    .default('08'),
  COMPANY_STATE_NAME: z.string().default('Rajasthan'),

  // -------------------------------------------------------------------------
  //  Notification delivery - every key optional
  // -------------------------------------------------------------------------
  //
  //  In-app notifications need none of this. A channel whose keys are absent
  //  is simply off: its rows are marked SKIPPED and nothing is attempted.

  /** The public URL of the app, so an emailed link opens the right screen. */
  APP_BASE_URL: z.string().default(''),

  /** SMTP. Email also needs `npm install nodemailer` in /server. */
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),

  /**
   * WhatsApp Business Cloud API (Meta). Outside a 24-hour customer window
   * Meta only delivers pre-approved TEMPLATES; set WHATSAPP_TEMPLATE_NAME to a
   * template taking two body parameters (title, detail) to use one.
   */
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_TEMPLATE_NAME: z.string().default(''),
  WHATSAPP_TEMPLATE_LANG: z.string().default('en'),

  /** How often the outbox is swept for email / WhatsApp to send. */
  NOTIFY_DISPATCH_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
}

export const env = parsed.data;
export default env;
