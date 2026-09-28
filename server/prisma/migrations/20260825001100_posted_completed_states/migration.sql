-- ===========================================================================
--  DocumentState gains POSTED and COMPLETED
--
--  Until now every document that had been acted on sat in APPROVED, which
--  conflated two different facts:
--
--      APPROVED   somebody with the authority has agreed to this
--      POSTED     it has been written to the ledger and acted on
--      COMPLETED  it has run its course
--
--  A purchase order is approved long before it is completed, and a GRN is
--  posted without ever having been approved by anybody - posting it IS the act.
--  Collapsing all three into APPROVED meant a screen could not tell "authorised"
--  from "done", which is the question most people are actually asking.
--
--  The transition table in approvalEngine.js is the authority for what may
--  follow what. APPROVED is no longer terminal - it may go to POSTED or
--  COMPLETED - but it still never returns to DRAFT. Undoing an approval goes
--  through an explicit amendment mechanism (PO reopen, scrutiny amendment, plan
--  approval versioning), never through the table.
-- ===========================================================================

-- AlterEnum
ALTER TYPE "DocumentState" ADD VALUE IF NOT EXISTS 'POSTED';
ALTER TYPE "DocumentState" ADD VALUE IF NOT EXISTS 'COMPLETED';
