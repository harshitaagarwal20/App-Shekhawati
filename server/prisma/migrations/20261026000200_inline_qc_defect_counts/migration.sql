-- ===========================================================================
--  INLINE QC - A COUNT PER DEFECT
-- ===========================================================================
--
--  A check could name several defects but not how many pieces had each. Each
--  defect line now carries its own count.
--
--  Existing lines: where the check named ONE defect and rejected pieces, the
--  rejected pieces are that defect's count. Where it named several, the
--  rejected pieces cannot be shared out between them, so the count is left
--  empty rather than guessed - the screen shows it as not counted.
-- ===========================================================================

-- AlterTable
ALTER TABLE "inline_qc_defects" ADD COLUMN "qty" INTEGER;

ALTER TABLE "inline_qc_defects"
  ADD CONSTRAINT "inline_qc_defects_qty_positive" CHECK ("qty" IS NULL OR "qty" > 0);

UPDATE "inline_qc_defects" AS d
   SET "qty" = ROUND(e."pcs_rejected")::INTEGER
  FROM "inline_qc_entries" AS e
 WHERE d."entry_id" = e."id"
   AND e."pcs_rejected" >= 1
   AND (SELECT count(*) FROM "inline_qc_defects" AS o WHERE o."entry_id" = d."entry_id") = 1;
