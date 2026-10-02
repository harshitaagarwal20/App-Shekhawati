-- ===========================================================================
--  RESTORE THE THREE COUNTERS THE SEED DELETES AND DOES NOT PUT BACK
-- ===========================================================================
--
--  Symptom: "No document sequence configured for CUTTING_CHALLAN" on saving a
--  cutting challan. The same failure is waiting on Material Plan and GRN
--  Reversal, for the same reason.
--
--  WHAT WENT WRONG
--
--  `document_sequences` has two sources of truth and they had drifted apart:
--
--    1. prisma/seed/data/transactions.js, which the seed writes - and the
--       seed CLEARS THE WHOLE TABLE first (seed/index.js, the `order` list).
--    2. These migrations, which insert the counters added after that list was
--       last updated:
--         20260827001100  CUTTING_CHALLAN  CC-0001
--         20260831000200  MATERIAL_PLAN    MP-0001
--         20260901000200  GRN_REVERSAL     GRV-0001
--
--  So on a database that was migrated and THEN seeded, the seed deleted all
--  three and re-inserted a list that never had them. The migrations had
--  already run, so re-running `migrate deploy` could not put them back: a
--  migration that has been applied once is never applied again.
--
--  Hence this migration. It is a new file, so `migrate deploy` runs it on
--  every environment - including ones where the damage was already done.
--
--  The seed list has been corrected in the same change, so a future
--  `db:reset` does not re-open the hole. If a fourth counter is ever added by
--  a migration, it has to go in that list too.
--
--  Every insert is WHERE NOT EXISTS, so this is safe to run on a healthy
--  database and safe to run twice. Nothing is updated and nothing is deleted:
--  a counter that survived keeps its current `next_number`, because resetting
--  a live counter would hand out numbers that are already in use.
-- ===========================================================================

INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "created_at", "updated_at")
SELECT gen_random_uuid(), 'CUTTING_CHALLAN', '', 'CC', '', '-', 4, 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (
   SELECT 1 FROM "document_sequences"
    WHERE "document_type" = 'CUTTING_CHALLAN' AND "scope_key" = ''
 );

INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "created_at", "updated_at")
SELECT gen_random_uuid(), 'MATERIAL_PLAN', '', 'MP', '', '-', 4, 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (
   SELECT 1 FROM "document_sequences"
    WHERE "document_type" = 'MATERIAL_PLAN' AND "scope_key" = ''
 );

INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "created_at", "updated_at")
SELECT gen_random_uuid(), 'GRN_REVERSAL', '', 'GRV', '', '-', 4, 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (
   SELECT 1 FROM "document_sequences"
    WHERE "document_type" = 'GRN_REVERSAL' AND "scope_key" = ''
 );
