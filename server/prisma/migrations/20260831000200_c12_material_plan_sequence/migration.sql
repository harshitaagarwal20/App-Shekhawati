-- ===========================================================================
--  C12 - THE COUNTER MATERIAL PLANS ARE NUMBERED FROM
-- ===========================================================================
--
--  Separated from the migration that created the tables for the same reason
--  the C5 sequence was: PostgreSQL will not let a transaction USE an enum
--  value it added itself, and 20260831000100 is the transaction that adds
--  MATERIAL_PLAN to "DocumentType". The row below has to be inserted after
--  that transaction has committed.
--
--  Without it nextNumber('MATERIAL_PLAN') refuses - correct behaviour for an
--  unconfigured sequence, and useless behaviour for a shipped feature.
--
--  MP-0001, four digits, matching CC-0001 and the rest of the C-series
--  documents rather than the three-digit workbook numbers.
-- ===========================================================================

INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "created_at", "updated_at")
SELECT gen_random_uuid(), 'MATERIAL_PLAN', '', 'MP', '', '-', 4, 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (
   SELECT 1 FROM "document_sequences"
    WHERE "document_type" = 'MATERIAL_PLAN' AND "scope_key" = ''
 );
