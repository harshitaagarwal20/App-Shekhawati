/**
 * Who is making the current request, available to code that is nowhere near the
 * request.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS EXISTS
 *
 *  The audit log has to record WHO changed a row. The Prisma extension that
 *  writes it sits underneath every service and has no access to `req` — passing
 *  an actor down through every service signature to reach it would mean
 *  touching every function in the application to serve one cross-cutting
 *  concern, and would still be forgotten somewhere.
 *
 *  `AsyncLocalStorage` is Node's answer to exactly this: a value scoped to an
 *  async call chain rather than to a variable. The auth middleware puts the
 *  actor in at the top of the request, and the extension reads it at the
 *  bottom, with nothing in between having to know.
 *
 *  IT IS NOT A SECURITY BOUNDARY. Nothing authorises anything from this — the
 *  route's `can()` check does that, from `req.auth`. This only answers "whose
 *  name goes on the audit row", and a missing value degrades to null rather
 *  than to somebody else's name.
 * ---------------------------------------------------------------------------
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/**
 * Runs `fn` with an actor attached to the current async context.
 *
 * `actor` may be a plain object, or a function returning one. The middleware
 * passes a function because it is mounted before `authenticate` runs: the
 * request arrives anonymous and acquires `req.auth` a few middlewares later,
 * so the actor has to be read when the audit entry is written rather than when
 * the context is opened.
 *
 * @param {object|(() => object)} actor
 * @param {Function} fn
 */
export function withActor(actor, fn) {
  return storage.run(actor, fn);
}

/**
 * The actor for the current request, or an empty object outside one.
 *
 * Returns `{}` rather than throwing: the seeder and the test suite both write
 * rows with no request behind them, and an audit row attributed to nobody is
 * more useful than a crash.
 */
export function currentActor() {
  const store = storage.getStore();
  if (!store) return {};
  return (typeof store === 'function' ? store() : store) ?? {};
}

/**
 * Express middleware: makes the requesting user available to the audit
 * extension, however deep below the route it runs.
 *
 * Mount this once, early - before `authenticate`, so that it also covers the
 * routes that write before anybody is logged in. The actor is resolved lazily,
 * so a login that succeeds is still attributed correctly.
 */
export function auditContext(req, _res, next) {
  withActor(
    () => ({
      userId: req.auth?.userId ?? null,
      userName: req.auth?.fullName ?? req.auth?.username ?? null,
      // Behind a proxy this is the forwarded address; `trust proxy` decides.
      ipAddress: req.ip ?? null,
    }),
    () => next(),
  );
}

// ===========================================================================
//  THE TRANSACTION BUFFER
// ===========================================================================
//
//  An audit row must not survive a transaction that rolled back. If a GRN
//  posting fails halfway, the trail must not claim the rolls were created.
//
//  Prisma's query extensions cannot see the transaction client, so the audit
//  write cannot simply join the transaction. Instead `$transaction` is wrapped
//  (see config/prisma.js): it opens a buffer here, the extension appends to it
//  instead of writing, and the buffer is flushed only once the transaction has
//  committed. If it throws, the buffer is dropped with it.
//
//  The residual gap is a process crash between the commit and the flush, which
//  loses audit rows for a committed change. That is the acceptable direction to
//  fail in: a trail missing an entry can be reconstructed from the data, a trail
//  that invents one cannot be trusted at all. The decisions themselves -
//  ApprovalHistory and DocumentAmendment - are written inside the transaction by
//  the services and are never subject to this.

const buffer = new AsyncLocalStorage();

/**
 * Runs `fn` with a fresh audit buffer.
 *
 * Returns the buffer alongside whatever `fn` returned, so the caller can flush
 * it once the transaction has committed.
 *
 * A nested call reuses the outer buffer and reports `nested: true`, so a
 * transaction inside a transaction still flushes exactly once, at the
 * outermost commit.
 */
export function withAuditBuffer(fn) {
  const existing = buffer.getStore();
  if (existing) return { nested: true, entries: existing, run: fn() };
  const entries = [];
  return { nested: false, entries, run: buffer.run(entries, fn) };
}

/**
 * Appends an entry to the open buffer.
 *
 * @returns {boolean} true if it was buffered, false if there is no transaction
 *                    open and the caller should write it immediately.
 */
export function bufferAuditEntry(entry) {
  const entries = buffer.getStore();
  if (!entries) return false;
  entries.push(entry);
  return true;
}

/** Whether a transaction buffer is currently open. */
export const inAuditBuffer = () => buffer.getStore() !== undefined;

// ---------------------------------------------------------------------------
//  AFTER-COMMIT HOOKS
//
//  The same shape as the audit buffer, for side effects that must not happen
//  unless the transaction that caused them commits - a notification that an
//  order was approved, when the approval then rolled back, is a lie told to
//  somebody's phone. Work queued inside a transaction runs once the OUTERMOST
//  transaction commits; queued outside any transaction it runs on the next
//  tick. A rolled-back transaction drops its queue.
// ---------------------------------------------------------------------------

const commitHooks = new AsyncLocalStorage();

export function withCommitHooks(fn) {
  const existing = commitHooks.getStore();
  if (existing) return { nested: true, queue: existing, run: fn() };
  const queue = [];
  return { nested: false, queue, run: commitHooks.run(queue, fn) };
}

function runSafely(cb) {
  Promise.resolve()
    .then(cb)
    .catch((err) => process.stderr.write(`[after-commit] ${err?.stack ?? err}
`));
}

export function afterCommit(cb) {
  const queue = commitHooks.getStore();
  if (queue) {
    queue.push(cb);
    return;
  }
  setTimeout(() => runSafely(cb), 0);
}

export function runCommitHooks(queue) {
  for (const cb of queue.splice(0)) runSafely(cb);
}

export default auditContext;
