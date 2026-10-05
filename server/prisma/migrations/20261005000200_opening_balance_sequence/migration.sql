-- ===========================================================================
--  THE COUNTER OPENING BALANCE POSTINGS ARE NUMBERED FROM
-- ===========================================================================
--
--  Separated from 20261005000100 because that migration adds OPENING_BALANCE
--  to the DocumentType enum, and PostgreSQL will not let a transaction use an
--  enum value it added itself. `document_sequences.document_type` is that
--  enum, so this row has to wait for that transaction to commit.
--
--  OB-0001, four digits, matching the other counters added since the C series.
--  Without it nextNumber('OPENING_BALANCE') refuses - correct behaviour for an
--  unconfigured sequence, and useless for a shipped feature.
--
--  Repeated in prisma/seed/data/transactions.js, because the seed CLEARS this
--  table and rebuilds it from that list. A counter that lives only here is a
--  counter a db:reset deletes - see the note in AZURE-DEPLOYMENT.md.
-- ===========================================================================

INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "created_at", "updated_at")
SELECT gen_random_uuid(), 'OPENING_BALANCE', '', 'OB', '', '-', 4, 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (
   SELECT 1 FROM "document_sequences"
    WHERE "document_type" = 'OPENING_BALANCE' AND "scope_key" = ''
 );
