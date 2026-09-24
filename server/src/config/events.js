/**
 * In-process events - a listener list, and nothing more.
 *
 * config/prisma.js raises `approvalRecorded` after every committed approval
 * trail entry. It cannot import the services that care (they import prisma,
 * which would be a cycle), so they register here instead: the notification
 * service subscribes when it is loaded.
 */

const approvalListeners = new Set();

/** Subscribe to committed approval-trail entries. Returns an unsubscribe. */
export function onApprovalRecorded(listener) {
  approvalListeners.add(listener);
  return () => approvalListeners.delete(listener);
}

export async function emitApprovalRecorded(row) {
  for (const listener of approvalListeners) {
    try {
      await listener(row);
    } catch (err) {
      // A failing listener must never fail the business write it follows,
      // which has already committed by the time this runs.
      process.stderr.write(`[events] approvalRecorded listener failed: ${err?.stack ?? err}\n`);
    }
  }
}
