-- ===========================================================================
--  C5 / C3 - THE REFERENCE DATA THE NEW DOCUMENTS NEED
-- ===========================================================================
--
--  Separated from the migrations that created the tables for one reason: the
--  C5 migration adds CUTTING_CHALLAN to the DocumentType enum, and PostgreSQL
--  will not let a transaction USE an enum value it added itself. The sequence
--  row below has to be inserted after that transaction has committed.
--
--  Two pieces of reference data:
--
--   1. The CC- counter cutting challans are numbered from. Without it
--      nextNumber('CUTTING_CHALLAN') refuses, which is the correct behaviour
--      for an unconfigured sequence and a useless one for a shipped feature.
--
--   2. WITH JOB WORKER, added to the StockLocation master list.
--
--      C3 names this location. The list already carries AT DYEING VENDOR and
--      AT PRINTING VENDOR, and those stay the PREFERRED values - a store
--      keeper looking for fabric is better served by "at the dye house" than
--      by "somewhere off site". The generic value exists for the two processes
--      that have no vendor location of their own, washing and finishing, and
--      inventory.service.js treats all three alike for the one rule that
--      matters: stock at any of them counts towards total on hand and does
--      NOT count towards available for issue.
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

INSERT INTO "master_list_values"
  ("id", "list_id", "value", "code", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), ml."id", 'WITH JOB WORKER', 'WITH_JOB_WORKER',
       COALESCE((SELECT MAX("sort_order") FROM "master_list_values" WHERE "list_id" = ml."id"), 0) + 1,
       true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" ml
 WHERE ml."code" = 'StockLocation'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" v
      WHERE v."list_id" = ml."id" AND v."value" = 'WITH JOB WORKER'
   );
