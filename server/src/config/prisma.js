/**
 * Prisma client singleton, extended to write the audit trail.
 *
 * A single instance is reused across the process so that hot reloads in
 * development do not exhaust the PostgreSQL connection pool.
 *
 * Soft deletion: every business table carries deleted_at / deleted_by_id.
 * Queries must therefore filter on `deletedAt: null` unless they are
 * deliberately reporting on deleted rows. From Phase 1 this is enforced by the
 * repository layer rather than by hand at each call site.
 *
 * ===========================================================================
 *  THE AUDIT EXTENSION
 * ===========================================================================
 *
 *  Every write to an audited table (see config/auditedTables.js) records who
 *  did it, when, and what the row looked like before and after. It is done here
 *  rather than in the services because it must not be possible to forget: a
 *  trail with holes in it is worse than no trail, because people trust it.
 *
 *  Three things are worth knowing about how it behaves.
 *
 *  1. INSIDE A TRANSACTION, ENTRIES ARE BUFFERED.
 *     A query extension cannot reach the transaction client, so the audit row
 *     cannot join the transaction. `$transaction` is wrapped below to open a
 *     buffer; entries collect there and are written only after the commit. A
 *     rollback drops them. See config/auditContext.js for the full reasoning.
 *
 *  2. THE "BEFORE" SNAPSHOT IS READ ON THE BASE CLIENT.
 *     Which means that inside a transaction it reads the row as it stood when
 *     the transaction began - PostgreSQL's read-committed MVCC hands back the
 *     committed version rather than blocking. For the ordinary case, one write
 *     per row per request, that is exactly right. Where a transaction writes
 *     the same row twice, the second entry's `before` is the state at the start
 *     of the transaction rather than after the first write, so the trail shows
 *     the net change instead of each step. That is a fair reading of what
 *     happened, and it avoids waiting on a lock the transaction itself holds.
 *
 *  3. AUDITING NEVER BREAKS A BUSINESS WRITE.
 *     If recording the trail fails, the failure is logged and swallowed. A
 *     goods receipt must not be refused because the audit table is full.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { env } from './env.js';
import {
  afterCommit,
  bufferAuditEntry,
  currentActor,
  runCommitHooks,
  withAuditBuffer,
  withCommitHooks,
} from './auditContext.js';
import { emitApprovalRecorded } from './events.js';
import { isAudited } from './auditedTables.js';
import { snapshot } from './auditSnapshot.js';

const globalForPrisma = globalThis;

/**
 * The unextended client.
 *
 * Kept separately because the extension needs a handle it can read "before"
 * rows and write audit entries with, and using the extended client for either
 * would recurse.
 */
const base =
  globalForPrisma.__shekhawatiPrismaBase ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

// ---------------------------------------------------------------------------
//  Model name -> table name, taken from the schema rather than hand-maintained.
// ---------------------------------------------------------------------------

const TABLE_OF = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, m.dbName ?? m.name]),
);

/** The write operations worth a trail entry, and what to call each in it. */
const AUDITED_OPERATIONS = {
  create: 'CREATE',
  update: 'UPDATE',
  upsert: 'UPSERT',
  delete: 'DELETE',
};

/*
 * `createMany`, `updateMany` and `deleteMany` are deliberately absent.
 *
 * They return a count, not rows, so there is no id to attribute an entry to,
 * and `audit_logs.record_id` is not nullable for good reason - an entry nobody
 * can trace back to a record is not evidence of anything. In this application
 * they are used only by the seeder and by bulk reference-data loads, neither of
 * which is a business decision anybody audits. Single-row writes, which is what
 * every screen produces, are all covered.
 */

function reportAuditFailure(err) {
  // Logged, never thrown. See point 3 in the header.
  process.stderr.write(`[audit] failed to record entry: ${err?.message ?? err}\n`);
}

/** Records one entry - into the open transaction buffer, or straight to the table. */
async function record(entry) {
  if (bufferAuditEntry(entry)) return;
  await base.auditLog.create({ data: entry }).catch(reportAuditFailure);
}

/** Writes a committed transaction's buffered entries. */
async function flush(entries) {
  if (!entries.length) return;
  await base.auditLog.createMany({ data: entries }).catch(reportAuditFailure);
}

/**
 * A Json column's way of saying "nothing".
 *
 * Prisma refuses a plain `null` for a nullable Json field - it cannot tell
 * whether you mean SQL NULL or the JSON value `null`, so it makes you say. We
 * mean SQL NULL: a create has no "before", and a delete has no "after".
 *
 * Getting this wrong would have been quiet rather than loud. The write is
 * wrapped in a catch, so every CREATE would simply have gone unaudited - a
 * trail with a hole in exactly the entries that matter most.
 */
const jsonOrNull = (value) => value ?? Prisma.DbNull;

/** lowerCamel model name, for indexing the client delegates. */
function delegateName(model) {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Stage one: the recorder.
 *
 * Kept as its own client because stage two needs to call *this* client's
 * `$transaction` - the one whose transaction clients carry the query extension,
 * and therefore the one whose writes get recorded. Calling `base.$transaction`
 * would hand the callback an unextended `tx` and silently audit nothing, which
 * is the exact failure this whole file exists to make impossible.
 */
const recording = base.$extends({
  name: 'audit-trail',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const action = AUDITED_OPERATIONS[operation];
        const tableName = TABLE_OF.get(model);

        if (!action || !tableName || !isAudited(tableName)) {
          return query(args);
        }

        // The row as it stood before. Absent for a create; best-effort for the
        // rest, because a `where` that matches nothing is the caller's problem
        // to report, not ours to pre-empt.
        let before = null;
        if (operation !== 'create' && args?.where) {
          before = await base[delegateName(model)]
            .findFirst({ where: args.where })
            .catch(() => null);
        }

        const after = await query(args);

        // `update` and `upsert` return the row; `delete` returns the row it
        // removed. Any of them can come back without an id if the caller chose
        // a narrower selection, in which case fall back to what we read first.
        const recordId = after?.id ?? before?.id ?? null;
        if (!recordId) return after;

        const actor = currentActor();
        await record({
          tableName,
          recordId,
          // An upsert that found nothing to update created a row; say so.
          action: action === 'UPSERT' ? (before ? 'UPDATE' : 'CREATE') : action,
          before: jsonOrNull(snapshot(before)),
          after: operation === 'delete' ? Prisma.DbNull : jsonOrNull(snapshot(after)),
          userId: actor.userId ?? null,
          userName: actor.userName ?? null,
          ipAddress: actor.ipAddress ?? null,
        }).catch(reportAuditFailure);

        return after;
      },
    },
  },
});

/**
 * Stage two: the commit gate.
 *
 * `$transaction`, wrapped so that audit entries written inside it are held until
 * it commits and dropped if it does not.
 *
 * Both forms are supported: the array form (a batch of promises) and the
 * interactive form (a callback). Neither changes shape - this only decides when
 * the trail is written.
 */
/*
 * EVERY APPROVAL-TRAIL ENTRY IS AN EVENT.
 *
 * approval_history is the one table every workflow move in this system
 * writes to - through approvalEngine.record() and through the four services
 * that keep their own trail. Listening HERE, rather than in each of them,
 * means a new document type is covered the day it starts writing a trail.
 * The event is released only after the transaction commits (afterCommit).
 */
const notifying = recording.$extends({
  name: 'approval-events',
  query: {
    approvalHistory: {
      async create({ args, query }) {
        const row = await query(args);
        afterCommit(() => emitApprovalRecorded(row));
        return row;
      },
    },
  },
});

export const prisma = notifying.$extends({
  name: 'audit-commit-gate',
  client: {
    async $transaction(...txArgs) {
      const hooks = withCommitHooks(async () => {
        const { nested, entries, run } = withAuditBuffer(() =>
          notifying.$transaction(...txArgs),
        );
        const result = await run;
        // A nested call leaves the flush to the outermost transaction.
        if (!nested) await flush(entries);
        return result;
      });
      const result = await hooks.run;
      // Only the outermost transaction releases the side effects, and only
      // once it has committed - a throw above skips this line entirely.
      if (!hooks.nested) runCommitHooks(hooks.queue);
      return result;
    },
  },
});

if (env.NODE_ENV !== 'production') {
  globalForPrisma.__shekhawatiPrismaBase = base;
}

/** Standard filter for "rows that have not been soft-deleted". */
export const notDeleted = { deletedAt: null };

export default prisma;
