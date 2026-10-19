-- ===========================================================================
--  FABRIC ACCOUNTING MOVES TO THE CUT PIECES RECEIPT
-- ===========================================================================
--
--  The cutting floor reports what it cut, and the cloth it cut it from, when
--  it hands the pieces over - so the fabric equation and the ledger legs that
--  take the cloth off the cutting floor are recorded here now, not on the
--  Cutting Issue (which sends checked pieces to stitching and moves no cloth).
--
--      issued = consumed + remainder + remnants + wastage + fabric damage
--
--  Existing receipts carry no fabric: every figure defaults to zero and none
--  has moved stock. Cutting Issues already posted keep their figures and the
--  ledger entries they wrote.
-- ===========================================================================

ALTER TABLE "cut_pieces_receipts"
  ADD COLUMN "fabric_issue_id"   UUID,
  ADD COLUMN "fabric_uom"        VARCHAR(20)   NOT NULL DEFAULT 'Mtrs',
  ADD COLUMN "issued_qty"        DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "consumed_qty"      DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "remainder_qty"     DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "remnant_qty"       DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "wastage_qty"       DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "fabric_damage_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "stock_posted_at"   TIMESTAMPTZ(3),
  ADD COLUMN "remnant_roll_no"   VARCHAR(40);

-- The equation, held by the database as well as the service: a receipt that
-- states fabric must account for every metre of it, and nothing is negative.
ALTER TABLE "cut_pieces_receipts"
  ADD CONSTRAINT "cut_pieces_receipts_fabric_non_negative" CHECK (
        "issued_qty" >= 0 AND "consumed_qty" >= 0 AND "remainder_qty" >= 0
    AND "remnant_qty" >= 0 AND "wastage_qty" >= 0 AND "fabric_damage_qty" >= 0
  ),
  ADD CONSTRAINT "cut_pieces_receipts_fabric_reconciles" CHECK (
    "issued_qty" = "consumed_qty" + "remainder_qty" + "remnant_qty"
                 + "wastage_qty" + "fabric_damage_qty"
  ),
  ADD CONSTRAINT "cut_pieces_receipts_fabric_names_its_issue" CHECK (
    "issued_qty" = 0 OR "fabric_issue_id" IS NOT NULL
  );

CREATE INDEX "cut_pieces_receipts_fabric_issue_id_idx" ON "cut_pieces_receipts"("fabric_issue_id");

ALTER TABLE "cut_pieces_receipts"
  ADD CONSTRAINT "cut_pieces_receipts_fabric_issue_id_fkey" FOREIGN KEY ("fabric_issue_id")
  REFERENCES "fabric_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
