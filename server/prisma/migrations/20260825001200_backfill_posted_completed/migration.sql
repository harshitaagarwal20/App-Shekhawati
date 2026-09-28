-- ===========================================================================
--  Move the documents that were already acted on into POSTED / COMPLETED
--
--  A separate migration from the one that adds the enum values: PostgreSQL will
--  not let a transaction USE an enum value it added itself.
--
--  Nothing here changes what happened. It changes what the system CALLS what
--  happened, so that "authorised", "acted on" and "finished" stop sharing one
--  word.
-- ===========================================================================

-- A GRN is POSTED, never approved: posting it is the act. There is no approval
-- step on a receipt, and there never was one to record.
UPDATE "grns"
   SET "workflow_state" = 'POSTED'
 WHERE "posted_at" IS NOT NULL
   AND "workflow_state" = 'APPROVED';

-- A fabric issue is NOT in this list, and deliberately so. It carries no
-- workflow_state column, because nobody approves one: the storekeeper hands
-- cloth over and the ledger records it. Its controlled status is `status`
-- (PENDING / IN_PROGRESS / COMPLETED / ON_HOLD / CANCELLED), which moves
-- through FULFILMENT_TRANSITIONS in approvalEngine.js like every other
-- fulfilment status. The same is true of job work (dye_issues).

-- A cutting challan IS approved - by the supervisor posting it - and then
-- posted. The approval trail already records both steps; this moves the current
-- state to the later of the two.
UPDATE "cutting_issues"
   SET "workflow_state" = 'POSTED'
 WHERE "posted_at" IS NOT NULL
   AND "workflow_state" = 'APPROVED';

-- A purchase order whose goods have all arrived is COMPLETED, not merely
-- approved. `status` already recorded this; the workflow state now agrees.
UPDATE "purchase_orders"
   SET "workflow_state" = 'COMPLETED'
 WHERE "status" = 'COMPLETED'
   AND "workflow_state" = 'APPROVED';

-- And a buyer order that has run its course.
UPDATE "buyer_orders"
   SET "workflow_state" = 'COMPLETED'
 WHERE "status" = 'COMPLETED'
   AND "workflow_state" = 'APPROVED';
