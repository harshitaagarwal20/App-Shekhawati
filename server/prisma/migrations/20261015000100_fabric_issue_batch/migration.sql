-- ===========================================================================
--  SEVERAL ROLLS ON ONE FABRIC ISSUE
-- ===========================================================================
--
--  The store issues three or four rolls to the cutting floor at a time, and
--  until now had to walk through the issue screen once per roll.
--
--  Each roll stays its own fabric_issues row - its own FI number, ledger legs,
--  challan-line fulfilment and downstream cutting issues - because everything
--  after this document (cutting issue, job work, GRN reversal, the ledger,
--  reports) is built on one roll per issue. What is new is `batch_no`: the
--  rolls posted together in one transaction share it, so the list can show
--  the group and the challan prints them on one sheet.
--
--  The counter reuses the FABRIC_ISSUE document type under scope 'BATCH'
--  rather than adding an enum value, so no second migration is needed to wait
--  for an ALTER TYPE to commit (see 20261005000100 for why that would be).
--
--  Repeated in prisma/seed/data/transactions.js, because the seed clears and
--  rebuilds document_sequences from that list.
-- ===========================================================================

ALTER TABLE "fabric_issues" ADD COLUMN "batch_no" VARCHAR(40);

CREATE INDEX "fabric_issues_batch_no_idx" ON "fabric_issues"("batch_no");

INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "created_at", "updated_at")
SELECT gen_random_uuid(), 'FABRIC_ISSUE', 'BATCH', 'FIB', '', '-', 4, 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (
   SELECT 1 FROM "document_sequences"
    WHERE "document_type" = 'FABRIC_ISSUE' AND "scope_key" = 'BATCH'
 );
