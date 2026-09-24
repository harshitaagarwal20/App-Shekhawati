/**
 * The audit trail.
 *
 * ===========================================================================
 *  THREE SOURCES, ONE TRAIL
 * ===========================================================================
 *
 * This system records what happened in three different places, because three
 * different questions get asked:
 *
 *   ApprovalHistory     "who decided this, and when?"
 *                       Every workflow transition on every approvable document,
 *                       with the actor and the remarks. Written by
 *                       approvalEngine.transition().
 *
 *   DocumentAmendment   "what did it say before?"
 *                       The field-level before/after set for a locked record
 *                       that was corrected. Written by the amendment paths.
 *
 *   AuditLog            "who touched this row at all?"
 *                       Row-level writes on business tables, including the ones
 *                       that are not decisions - an edited address, a corrected
 *                       bill number. Written by the Prisma extension in
 *                       config/prisma.js.
 *
 * `trail()` merges all three for one document, in time order, so a person
 * asking "what happened to RF-001" gets one answer rather than three screens.
 *
 * ---------------------------------------------------------------------------
 *  READ-ONLY, WITH NO EXCEPTIONS
 *
 *  There is no create, update or delete in this file, and no endpoint behind
 *  one. An audit trail somebody can edit is not an audit trail. Old entries are
 *  pruned by a database retention policy if they ever need to be, never by the
 *  application.
 * ---------------------------------------------------------------------------
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';
import { REGISTRY } from './approvalEngine.js';
import { AUDITED, labelFor, routeFor } from '../config/auditedTables.js';
import { changedFields } from '../config/auditSnapshot.js';

export { AUDITED, changedFields };

export const SORTABLE = ['createdAt', 'tableName', 'action', 'userName'];

// The audited tables, their labels and their screens all live in
// config/auditedTables.js, because the Prisma extension that writes the
// entries needs the same list and neither module should own it alone.

// ===========================================================================
//  THE ROW-LEVEL LOG
// ===========================================================================

/**
 * Row-level writes, filtered and paged.
 *
 * `before` and `after` are whole-row snapshots. They are returned as-is on the
 * detail read but reduced to a CHANGED-FIELD list here, because a table of
 * forty-column JSON blobs is not something anybody reads.
 */
export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search,
    tableName, recordId, userId, action, dateFrom, dateTo,
  } = query;

  const where = {
    ...(tableName ? { tableName } : {}),
    ...(recordId ? { recordId } : {}),
    ...(userId ? { userId } : {}),
    ...(action ? { action } : {}),
    ...(dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...searchFilter(search, ['userName', 'tableName', 'action']),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy, skip, take }),
    prisma.auditLog.count({ where }),
  ]);

  return { rows: rows.map(project), total, page, pageSize };
}

function project(entry) {
  const changed = changedFields(entry.before, entry.after);
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    tableName: entry.tableName,
    label: labelFor(entry.tableName),
    recordId: entry.recordId,
    route: routeFor(entry.tableName, entry.recordId),
    action: entry.action,
    userName: entry.userName,
    userId: entry.userId,
    ipAddress: entry.ipAddress,
    /** Just the field names, for the list. The detail read carries the values. */
    changedFields: changed.map((c) => c.field),
    changeCount: changed.length,
  };
}

/** One entry, with the full before/after values. */
export async function getById(id) {
  const entry = await prisma.auditLog.findUnique({ where: { id } });
  if (!entry) throw ApiError.notFound('Audit entry');

  return {
    ...project(entry),
    changes: changedFields(entry.before, entry.after),
    before: entry.before,
    after: entry.after,
  };
}

// ===========================================================================
//  THE MERGED TRAIL FOR ONE DOCUMENT
// ===========================================================================

/**
 * Everything that ever happened to one record, from all three sources, in time
 * order.
 *
 * This is the screen somebody opens when a figure looks wrong and they want to
 * know how it got that way. Merging the sources here rather than leaving three
 * tabs is the whole point: the decision, the amendment and the edit that
 * caused it are usually minutes apart, and separating them by source hides
 * exactly the sequence a person is trying to reconstruct.
 *
 * @param {string} tableName  e.g. "purchase_orders"
 * @param {string} recordId
 */
export async function trail(tableName, recordId) {
  if (!AUDITED[tableName]) {
    throw ApiError.badRequest(
      `"${tableName}" is not an audited table.`,
      { field: 'tableName', audited: Object.keys(AUDITED) },
    );
  }

  // The approval trail and the amendments are keyed on DocumentType, not on a
  // table name, so the table has to be mapped back to one.
  const documentType = Object.entries(REGISTRY).find(
    ([, cfg]) => tableNameFor(cfg.model) === tableName,
  )?.[0];

  const [writes, decisions, amendments] = await Promise.all([
    prisma.auditLog.findMany({
      where: { tableName, recordId },
      orderBy: { createdAt: 'asc' },
    }),
    documentType
      ? prisma.approvalHistory.findMany({
          where: { documentType, documentId: recordId },
          orderBy: { actedAt: 'asc' },
        })
      : [],
    documentType
      ? prisma.documentAmendment.findMany({
          where: { documentType, documentId: recordId },
          orderBy: { amendedAt: 'asc' },
        })
      : [],
  ]);

  const events = [
    ...writes.map((w) => ({
      at: w.createdAt,
      source: 'WRITE',
      action: w.action,
      by: w.userName,
      summary:
        w.action === 'CREATE'
          ? 'Record created'
          : w.action === 'DELETE'
            ? 'Record deleted'
            : `${changedFields(w.before, w.after).length} field(s) changed`,
      changes: changedFields(w.before, w.after),
      id: w.id,
    })),
    ...decisions.map((d) => ({
      at: d.actedAt,
      source: 'DECISION',
      action: d.action,
      by: d.actedByName,
      summary:
        d.fromStatus && d.toStatus
          ? `${readable(d.fromStatus)} → ${readable(d.toStatus)}`
          : readable(d.action),
      remarks: d.remarks,
      id: d.id,
    })),
    ...amendments.map((a) => ({
      at: a.amendedAt,
      source: 'AMENDMENT',
      action: 'AMENDED',
      by: null,
      summary: `Amendment ${a.amendmentNo}: ${a.reason}`,
      changes: Object.keys(a.changes?.after ?? {}).map((field) => ({
        field,
        from: a.changes.before?.[field] ?? null,
        to: a.changes.after?.[field] ?? null,
      })),
      id: a.id,
    })),
  ].sort((x, y) => new Date(x.at) - new Date(y.at));

  return {
    tableName,
    label: labelFor(tableName),
    recordId,
    route: routeFor(tableName, recordId),
    documentType: documentType ?? null,
    counts: {
      writes: writes.length,
      decisions: decisions.length,
      amendments: amendments.length,
      total: events.length,
    },
    events,
  };
}

/** Prisma model name -> table name, matching the @@map in the schema. */
function tableNameFor(model) {
  const MODEL_TABLES = {
    buyerOrder: 'buyer_orders',
    planning: 'plannings',
    vendorQuotation: 'vendor_quotations',
    purchaseOrder: 'purchase_orders',
    gatePass: 'gate_passes',
    grn: 'grns',
    fabricScrutiny: 'fabric_scrutinies',
    planApproval: 'plan_approvals',
    cuttingIssue: 'cutting_issues',
  };
  return MODEL_TABLES[model] ?? null;
}

const readable = (v) => String(v ?? '').replace(/_/g, ' ').toLowerCase();

// ===========================================================================
//  SUPPORTING READS
// ===========================================================================

/** The audited tables, for the filter dropdown. */
export function tables() {
  return Object.entries(AUDITED).map(([tableName, cfg]) => ({
    tableName,
    label: cfg.label,
  }));
}

/** Everyone who has written anything, for the "who" filter. */
export async function actors() {
  const rows = await prisma.auditLog.groupBy({
    by: ['userId', 'userName'],
    _count: { _all: true },
    orderBy: { _count: { userId: 'desc' } },
    take: 100,
  });
  return rows
    .filter((r) => r.userId)
    .map((r) => ({ userId: r.userId, userName: r.userName, writes: r._count._all }));
}

/**
 * A summary for the top of the screen: what has been touched lately, and by
 * how many people.
 */
export async function summary({ days = 7 } = {}) {
  const since = new Date(Date.now() - days * 86400000);

  const [byTable, byAction, total, people] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ['tableName'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.auditLog.groupBy({
      by: ['action'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
    prisma.auditLog.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  return {
    days,
    total,
    people: people.filter((p) => p.userId).length,
    byTable: byTable
      .map((t) => ({ tableName: t.tableName, label: labelFor(t.tableName), count: t._count._all }))
      .sort((a, b) => b.count - a.count),
    byAction: byAction.map((a) => ({ action: a.action, count: a._count._all })),
  };
}
