/**
 * Notifications - telling people that work is waiting for them.
 *
 * ===========================================================================
 *  THREE PARTS
 * ===========================================================================
 *
 *  1. notify()           writes one in-app row per recipient. The ONE entry
 *                        point: approval events below use it, and so does any
 *                        scheduled job (a TNA milestone running late, a bill
 *                        falling due). Idempotent per person with `dedupeKey`.
 *
 *  2. approval events    every committed approval-trail entry is judged by
 *                        `recipientsForApprovalEvent()`: a document waiting for
 *                        a decision tells whoever can take it; a decision tells
 *                        whoever raised the document. Nobody is told about
 *                        their own act.
 *
 *  3. the dispatcher     sweeps the table for rows whose email / WhatsApp is
 *                        PENDING and delivers them. The table IS the outbox:
 *                        a restart resumes from it, and each row is claimed
 *                        before it is sent so two dispatchers never send the
 *                        same row twice.
 * ===========================================================================
 */

import prisma from '../config/prisma.js';
import { env } from '../config/env.js';
import { onApprovalRecorded } from '../config/events.js';
import { ApiError } from '../utils/ApiError.js';
import { REGISTRY } from './approvalEngine.js';

// ===========================================================================
//  WHERE A DOCUMENT LIVES, AND WHO DECIDES IT
// ===========================================================================

/** The in-app route of each document type's detail screen. */
export const DOCUMENT_ROUTE = {
  BUYER_ORDER: '/orders',
  PLANNING: '/planning',
  VENDOR_QUOTATION: '/quotations',
  PURCHASE_ORDER: '/purchase-orders',
  GATE_PASS: '/gate-passes',
  GRN: '/grns',
  GRN_REVERSAL: '/grn-reversals',
  DYE_ISSUE: '/job-works',
  FABRIC_ISSUE: '/fabric-issues',
  FABRIC_SCRUTINY: '/scrutinies',
  PLAN_APPROVAL: '/plan-approvals',
  MATERIAL_PLAN: '/material-plans',
  CUTTING_CHALLAN: '/cutting-challans',
  CUTTING_ISSUE: '/cutting-issues',
  CUT_PIECES_RECEIPT: '/cut-pieces-receipts',
  COST_SHEET: '/cost-sheets',
};

/**
 * Documents that keep their own trail rather than going through the approval
 * engine - where to find their creator.
 */
const OWN_TRAIL_MODELS = { COST_SHEET: 'styleCostSheet' };

export function linkFor(documentType, documentId) {
  const base = DOCUMENT_ROUTE[documentType];
  return base && documentId ? `${base}/${documentId}` : null;
}

const LABEL = {
  BUYER_ORDER: 'Buyer order',
  PLANNING: 'Plan',
  VENDOR_QUOTATION: 'Quotation',
  PURCHASE_ORDER: 'Purchase order',
  GATE_PASS: 'Gate pass',
  GRN: 'GRN',
  GRN_REVERSAL: 'GRN reversal',
  DYE_ISSUE: 'Job work order',
  FABRIC_SCRUTINY: 'Fabric scrutiny',
  PLAN_APPROVAL: 'Plan approval',
  MATERIAL_PLAN: 'Material plan',
  CUTTING_CHALLAN: 'Cutting challan',
  CUTTING_ISSUE: 'Cutting issue',
  COST_SHEET: 'Cost sheet',
};

const labelOf = (documentType) =>
  LABEL[documentType] ?? REGISTRY[documentType]?.label ?? String(documentType).replace(/_/g, ' ').toLowerCase();

/** States in which a trail entry means "somebody must now decide this". */
const AWAITING = new Set(['PENDING', 'PENDING_APPROVAL', 'SUBMITTED', 'RESUBMITTED']);

/**
 * WHO SHOULD HEAR ABOUT ONE APPROVAL-TRAIL ENTRY. Pure, so it is tested
 * without a database.
 *
 * @param {{action: string, toStatus?: string|null, documentType: string}} row
 * @returns {{kind: string, audience: 'approvers'|'creator', permission?: string} | null}
 */
export function recipientsForApprovalEvent(row) {
  const { action, toStatus, documentType } = row;

  if ((action === 'SUBMITTED' || action === 'REOPENED') && AWAITING.has(String(toStatus ?? ''))) {
    return { kind: 'APPROVAL_REQUESTED', audience: 'approvers', permission: `${documentType}.APPROVE` };
  }
  if (action === 'APPROVED') return { kind: 'APPROVED', audience: 'creator' };
  if (action === 'REJECTED') return { kind: 'REJECTED', audience: 'creator' };
  if (action === 'REWORK_REQUESTED') return { kind: 'REWORK_REQUESTED', audience: 'creator' };
  if (action === 'CANCELLED') return { kind: 'CANCELLED', audience: 'creator' };
  return null;
}

/** The sentence a person reads, for one approval event. Pure. */
export function describeApprovalEvent(row, kind) {
  const what = `${labelOf(row.documentType)} ${row.documentNo ?? ''}`.trim();
  const who = row.actedByName ? ` by ${row.actedByName}` : '';
  const why = row.remarks ? String(row.remarks).slice(0, 500) : null;
  switch (kind) {
    case 'APPROVAL_REQUESTED':
      return { title: `${what} is waiting for your approval`, body: why };
    case 'APPROVED':
      return { title: `${what} was approved${who}`, body: why };
    case 'REJECTED':
      return { title: `${what} was rejected${who}`, body: why ? `Reason: ${why}` : null };
    case 'REWORK_REQUESTED':
      return { title: `${what} was sent back for rework${who}`, body: why };
    case 'CANCELLED':
      return { title: `${what} was cancelled${who}`, body: why };
    default:
      return { title: what, body: why };
  }
}

// ===========================================================================
//  RECIPIENTS
// ===========================================================================

/**
 * Active people holding a permission.
 *
 * The ADMIN role holds every permission by construction, so "everyone who can
 * approve a PO" would include every administrator and every approval would
 * reach the IT desk. Admins are told only through a real business role.
 */
export async function usersWithPermission(code, client = prisma) {
  const users = await client.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      roles: {
        some: {
          role: {
            deletedAt: null,
            code: { not: 'ADMIN' },
            permissions: { some: { permission: { code } } },
          },
        },
      },
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

// ===========================================================================
//  1. notify()
// ===========================================================================

export const channels = {
  email: () => Boolean(env.SMTP_HOST && env.SMTP_FROM),
  whatsapp: () => Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
};

/**
 * Writes a notification for each recipient.
 *
 * @param {object} n
 * @param {string[]} [n.userIds]        named people
 * @param {string}   [n.permission]     and/or everyone holding this permission
 * @param {string[]} [n.excludeUserIds] never told - usually the actor
 * @param {string}   n.kind
 * @param {string}   n.title
 * @param {string}   [n.body]
 * @param {string}   [n.link]           in-app route; derived from the document when absent
 * @param {string}   [n.documentType]
 * @param {string}   [n.documentId]
 * @param {string}   [n.documentNo]
 * @param {string}   [n.dedupeKey]      one row per person per key, ever
 * @returns {Promise<{created: number, recipients: number}>}
 */
export async function notify(n, client = prisma) {
  if (!n?.title || !n?.kind) throw new Error('notify() needs a kind and a title');

  const ids = new Set(n.userIds ?? []);
  if (n.permission) for (const id of await usersWithPermission(n.permission, client)) ids.add(id);
  for (const id of n.excludeUserIds ?? []) ids.delete(id);
  if (!ids.size) return { created: 0, recipients: 0 };

  const people = await client.user.findMany({
    where: { id: { in: [...ids] }, isActive: true, deletedAt: null },
    select: { id: true, email: true, notifyByEmail: true, notifyByWhatsapp: true, whatsappNumber: true },
  });

  const emailOn = channels.email();
  const whatsappOn = channels.whatsapp();
  const link = n.link ?? linkFor(n.documentType, n.documentId);

  const { count } = await client.notification.createMany({
    data: people.map((p) => ({
      userId: p.id,
      kind: String(n.kind).slice(0, 40),
      title: String(n.title).slice(0, 200),
      body: n.body ?? null,
      link: link ? String(link).slice(0, 300) : null,
      documentType: n.documentType ?? null,
      documentId: n.documentId ?? null,
      documentNo: n.documentNo ? String(n.documentNo).slice(0, 60) : null,
      dedupeKey: n.dedupeKey ? String(n.dedupeKey).slice(0, 200) : null,
      emailStatus: emailOn && p.notifyByEmail && p.email ? 'PENDING' : 'SKIPPED',
      whatsappStatus: whatsappOn && p.notifyByWhatsapp && p.whatsappNumber ? 'PENDING' : 'SKIPPED',
    })),
    // The (user, dedupeKey) unique index turns a repeat into a no-op.
    skipDuplicates: true,
  });

  return { created: count, recipients: people.length };
}

// ===========================================================================
//  2. APPROVAL EVENTS
// ===========================================================================

/** Who raised a document - the person a decision on it is news to. */
async function creatorOf(documentType, documentId) {
  const model = REGISTRY[documentType]?.model ?? OWN_TRAIL_MODELS[documentType];
  if (!model || !documentId || !prisma[model]) return null;
  const doc = await prisma[model]
    .findUnique({ where: { id: documentId }, select: { createdById: true } })
    .catch(() => null);
  return doc?.createdById ?? null;
}

async function permissionExists(code) {
  return Boolean(await prisma.permission.findUnique({ where: { code }, select: { id: true } }));
}

/**
 * MULTI-LINE DOCUMENTS SPEAK ONCE.
 *
 * Raising or approving a ten-line PO writes ten trail entries, one per line,
 * and would tell the Director ten times. A line is a "follower" when another
 * line of the same document had the same thing happen in the last two
 * minutes; only the first speaks, and its link opens the line - from which
 * the whole document is one click.
 */
const LINE_MODELS = { PURCHASE_ORDER: 'purchaseOrder', VENDOR_QUOTATION: 'vendorQuotation', GRN: 'grn' };

async function isFollowerLine(row) {
  const model = LINE_MODELS[row.documentType];
  if (!model) return false;
  const line = await prisma[model]
    .findUnique({ where: { id: row.documentId }, select: { headerId: true } })
    .catch(() => null);
  if (!line?.headerId) return false;
  const siblings = await prisma[model].findMany({
    where: { headerId: line.headerId, id: { not: row.documentId } },
    select: { id: true },
  });
  if (!siblings.length) return false;
  const earlier = await prisma.approvalHistory.findFirst({
    where: {
      documentType: row.documentType,
      documentId: { in: siblings.map((s) => s.id) },
      action: row.action,
      actedAt: { gte: new Date(Date.now() - 120_000), lte: row.actedAt ?? new Date() },
      id: { not: row.id },
    },
    select: { id: true },
  });
  return Boolean(earlier);
}

export async function handleApprovalEvent(row) {
  const rule = recipientsForApprovalEvent(row);
  if (!rule) return { created: 0, recipients: 0 };
  if (await isFollowerLine(row)) return { created: 0, recipients: 0 };

  const { title, body } = describeApprovalEvent(row, rule.kind);
  const base = {
    kind: rule.kind,
    title,
    body,
    documentType: row.documentType,
    documentId: row.documentId,
    documentNo: row.documentNo,
    excludeUserIds: row.actedById ? [row.actedById] : [],
    // One trail entry, one notification per person - however often the
    // event is replayed.
    dedupeKey: `approval:${row.id}`,
  };

  if (rule.audience === 'approvers') {
    if (!(await permissionExists(rule.permission))) return { created: 0, recipients: 0 };
    return notify({ ...base, permission: rule.permission });
  }
  const creator = await creatorOf(row.documentType, row.documentId);
  return creator ? notify({ ...base, userIds: [creator] }) : { created: 0, recipients: 0 };
}

onApprovalRecorded(handleApprovalEvent);

// ===========================================================================
//  3. THE DISPATCHER
// ===========================================================================

const MAX_ATTEMPTS = 5;

let mailer = null;
async function transport() {
  if (mailer) return mailer;
  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    throw new Error('Email is configured but nodemailer is not installed. Run `npm install nodemailer` in /server.');
  }
  mailer = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return mailer;
}

const absolute = (link) => (link && env.APP_BASE_URL ? `${env.APP_BASE_URL.replace(/\/$/, '')}${link}` : null);

async function sendEmail(row) {
  const url = absolute(row.link);
  await (await transport()).sendMail({
    from: env.SMTP_FROM,
    to: row.user.email,
    subject: row.title,
    text: [row.title, row.body, url ? `Open: ${url}` : null].filter(Boolean).join('\n\n'),
  });
}

async function sendWhatsapp(row) {
  const url = absolute(row.link);
  const detail = [row.body, url].filter(Boolean).join(' - ') || '-';
  const payload = env.WHATSAPP_TEMPLATE_NAME
    ? {
        messaging_product: 'whatsapp',
        to: row.user.whatsappNumber,
        type: 'template',
        template: {
          name: env.WHATSAPP_TEMPLATE_NAME,
          language: { code: env.WHATSAPP_TEMPLATE_LANG },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: row.title.slice(0, 900) },
                { type: 'text', text: detail.slice(0, 900) },
              ],
            },
          ],
        },
      }
    : {
        messaging_product: 'whatsapp',
        to: row.user.whatsappNumber,
        type: 'text',
        text: { body: `${row.title}\n${detail}`.slice(0, 4000) },
      };

  const res = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`WhatsApp API ${res.status}: ${text.slice(0, 300)}`);
  }
}

/**
 * One sweep of the outbox, for one channel.
 *
 * Each row is CLAIMED first - its attempt count is bumped by an update that
 * only matches the count this sweep read - so a second dispatcher (another
 * instance of the API) that read the same row finds nothing to claim and
 * skips it. A crash mid-send leaves the row PENDING with the attempt spent,
 * and MAX_ATTEMPTS bounds how often a failing address is retried.
 */
async function sweep(channel, limit) {
  const field = channel === 'email' ? 'emailStatus' : 'whatsappStatus';
  const send = channel === 'email' ? sendEmail : sendWhatsapp;
  const rows = await prisma.notification.findMany({
    where: { [field]: 'PENDING', deliveryAttempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { user: { select: { email: true, whatsappNumber: true } } },
  });

  let sent = 0;
  for (const row of rows) {
    const { count } = await prisma.notification.updateMany({
      where: { id: row.id, [field]: 'PENDING', deliveryAttempts: row.deliveryAttempts },
      data: { deliveryAttempts: { increment: 1 } },
    });
    if (count === 0) continue;
    try {
      await send(row);
      await prisma.notification.update({
        where: { id: row.id },
        data: { [field]: 'SENT', deliveredAt: new Date(), lastDeliveryError: null },
      });
      sent += 1;
    } catch (err) {
      const attempts = row.deliveryAttempts + 1;
      await prisma.notification.update({
        where: { id: row.id },
        data: {
          [field]: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          lastDeliveryError: String(err?.message ?? err).slice(0, 2000),
        },
      });
    }
  }
  return sent;
}

export async function dispatchPending({ limit = 50 } = {}) {
  const result = { email: 0, whatsapp: 0 };
  if (channels.email()) result.email = await sweep('email', limit);
  if (channels.whatsapp()) result.whatsapp = await sweep('whatsapp', limit);
  return result;
}

let timer = null;

/** Started once from index.js. A no-op when neither channel is configured. */
export function startNotificationDispatcher() {
  if (timer || (!channels.email() && !channels.whatsapp())) return false;
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await dispatchPending();
    } catch (err) {
      process.stderr.write(`[notifications] dispatch failed: ${err?.message ?? err}\n`);
    } finally {
      running = false;
    }
  }, env.NOTIFY_DISPATCH_SECONDS * 1000);
  timer.unref();
  return true;
}

export function stopNotificationDispatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ===========================================================================
//  THE INBOX - what the bell reads
// ===========================================================================

export async function listMine(userId, { unreadOnly = false, limit = 30, before } = {}) {
  const where = {
    userId,
    ...(unreadOnly ? { readAt: null } : {}),
    ...(before ? { createdAt: { lt: new Date(before) } } : {}),
  };
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(limit) || 30, 1), 100),
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        link: true,
        documentType: true,
        documentNo: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { rows, unread };
}

export async function unreadCount(userId) {
  return { unread: await prisma.notification.count({ where: { userId, readAt: null } }) };
}

/** Marks some - or, with no ids, all - of the caller's own notifications read. */
export async function markRead(userId, { ids } = {}) {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return { marked: count };
}

export async function getPreferences(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, notifyByEmail: true, notifyByWhatsapp: true, whatsappNumber: true },
  });
  if (!user) throw ApiError.notFound('User');
  return {
    ...user,
    channels: { email: channels.email(), whatsapp: channels.whatsapp() },
  };
}

export async function setPreferences(userId, { notifyByEmail, notifyByWhatsapp, whatsappNumber }) {
  const number = whatsappNumber === undefined ? undefined : String(whatsappNumber ?? '').replace(/\D/g, '') || null;
  if (number && !/^[0-9]{8,15}$/.test(number)) {
    throw ApiError.badRequest('A WhatsApp number is 8 to 15 digits, with the country code - 919876543210', {
      field: 'whatsappNumber',
    });
  }
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { whatsappNumber: true } });
  if (notifyByWhatsapp === true && !(number ?? current?.whatsappNumber)) {
    throw ApiError.badRequest('Add a WhatsApp number before turning WhatsApp on', { field: 'whatsappNumber' });
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(notifyByEmail !== undefined ? { notifyByEmail } : {}),
      ...(notifyByWhatsapp !== undefined ? { notifyByWhatsapp } : {}),
      ...(number !== undefined ? { whatsappNumber: number } : {}),
    },
  });
  return getPreferences(userId);
}
