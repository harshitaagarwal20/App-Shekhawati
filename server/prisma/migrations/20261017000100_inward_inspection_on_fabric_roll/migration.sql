-- ===========================================================================
--  INWARD INSPECTION ON A FABRIC ROLL
-- ===========================================================================
--
--  The store's check on a roll after the GRN: status, the measured length,
--  width and GSM, and the length found faulty. A record, not a gate - nothing
--  refuses an issue on the strength of these columns.
--
--  BACKFILL: only rolls a GRN created that are still exactly as received -
--  RAW, nothing taken off them, not held, not a remnant - become PENDING.
--  They are on the rack and can still be inspected. Every other existing roll
--  stays NULL, "inspection never asked of it": a roll already dyed or cut
--  cannot be inspected as received, and marking it PENDING would fill the
--  queue with work nobody can do.
-- ===========================================================================

CREATE TYPE "InspectionStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED');

ALTER TABLE "fabric_rolls"
  ADD COLUMN "inspection_status"     "InspectionStatus",
  ADD COLUMN "inspected_qty"         DECIMAL(18,4),
  ADD COLUMN "inspected_width"       DECIMAL(10,2),
  ADD COLUMN "inspected_gsm"         DECIMAL(10,2),
  ADD COLUMN "inspection_defect_qty" DECIMAL(18,4),
  ADD COLUMN "inspection_remarks"    TEXT,
  ADD COLUMN "inspected_at"          TIMESTAMPTZ(3),
  ADD COLUMN "inspected_by_id"       UUID,
  ADD COLUMN "inspected_by_name"     VARCHAR(120);

-- Defect length is part of the roll; it cannot exceed what was received.
ALTER TABLE "fabric_rolls"
  ADD CONSTRAINT "fabric_rolls_inspection_figures_non_negative" CHECK (
        ("inspected_qty"         IS NULL OR "inspected_qty"         > 0)
    AND ("inspected_width"       IS NULL OR "inspected_width"       > 0)
    AND ("inspected_gsm"         IS NULL OR "inspected_gsm"         > 0)
    AND ("inspection_defect_qty" IS NULL OR "inspection_defect_qty" >= 0)
  );

CREATE INDEX "fabric_rolls_inspection_status_idx" ON "fabric_rolls"("inspection_status");

UPDATE "fabric_rolls"
   SET "inspection_status" = 'PENDING'
 WHERE "grn_id" IS NOT NULL
   AND "is_remnant" = false
   AND "is_held" = false
   AND "deleted_at" IS NULL
   AND "written_off_at" IS NULL
   AND "stage" = 'RAW'
   AND "balance_qty" = "received_qty";
