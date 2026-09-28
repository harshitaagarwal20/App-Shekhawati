-- ===========================================================================
--  ApprovalAction gains POSTED and COMPLETED
--
--  The trail recorded a GRN posting as "SUBMITTED", because SUBMITTED was the
--  nearest of the six values available. A person reading the history of a
--  receipt was therefore told it had been submitted for approval, which is not
--  what happened - a GRN has no approval step at all. Posting IS the act.
--
--  DocumentState gained POSTED and COMPLETED in migration 20260825001100. This
--  gives the ACTION recorded against a transition the same vocabulary as the
--  STATE it moves to, so the two stop disagreeing.
--
--  No backfill accompanies this. Existing rows say SUBMITTED because that is
--  what the system recorded at the time, and an audit trail is not something to
--  go back and re-word. The state columns tell the true story; migration
--  20260825001200 already corrected those.
-- ===========================================================================

-- AlterEnum
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'POSTED';
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- And AMENDED, which the code has always written and the enum has never had.
--
-- buyerOrder.amend() records the act on the approval trail so that an
-- amendment appears in sequence beside the decisions around it. Every call
-- failed with "Invalid value for argument `action`" - which surfaced as a 400
-- "Malformed database query", so amending a locked order was impossible.
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'AMENDED';

-- ---------------------------------------------------------------------------
--  And a GRN opens in POSTED rather than in APPROVED.
--
--  A receipt is written and posted in one transaction - there is no draft GRN
--  sitting between the goods arriving and the stock existing - so its opening
--  state is the state it is in. The default was APPROVED only because APPROVED
--  was the closest word available before POSTED existed.
--
--  Existing rows were already moved by migration 20260825001200; this changes
--  what the NEXT row defaults to.
-- ---------------------------------------------------------------------------

ALTER TABLE "grns" ALTER COLUMN "workflow_state" SET DEFAULT 'POSTED';
