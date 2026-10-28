-- ===========================================================================
--  DISPATCH - its counter, and the Rejected Register's new stage
-- ===========================================================================
--
--  Separate from 20261023000100 because that transaction adds DISPATCH to
--  "DocumentType" and NEEDLE_DETECTION to "RejectStage", and PostgreSQL will
--  not let the same transaction use them. DSP-0001, four digits.
-- ===========================================================================

INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "created_at", "updated_at")
SELECT gen_random_uuid(), 'DISPATCH', '', 'DSP', '', '-', 4, 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (
   SELECT 1 FROM "document_sequences"
    WHERE "document_type" = 'DISPATCH' AND "scope_key" = ''
 );

-- A needle-detection reject comes from a quarantine resolution and no bag; an
-- Alteration Unit reject from a bag. Each names exactly its own source.
ALTER TABLE "rejected_register_entries"
  ADD CONSTRAINT "rejected_register_entries_stage_source" CHECK (
    ("stage" = 'NEEDLE_DETECTION' AND "needle_resolution_id" IS NOT NULL AND "origin" IS NULL)
    OR ("stage" = 'ALTERATION_UNIT' AND "needle_resolution_id" IS NULL AND "origin" IS NOT NULL)
  );
