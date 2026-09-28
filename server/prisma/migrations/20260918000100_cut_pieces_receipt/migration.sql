-- ===========================================================================
--  CUT PIECES RECEIPT - what the cutting department hands over
-- ===========================================================================
--
--  Good pieces, rejected pieces and handles, counted in from the cutting
--  floor against an order (and, normally, the cutting challan they were cut
--  for). The count sits between the challan and the Cutting Issue, so the
--  store knows how many cut pieces it holds before it issues any.
--
--  The sequence row and the permissions are in the NEXT migration: PostgreSQL
--  will not let a transaction use an enum value it added itself.
-- ===========================================================================

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CUT_PIECES_RECEIPT' AFTER 'CUTTING_ISSUE';

CREATE TABLE "cut_pieces_receipts" (
    "id" UUID NOT NULL,
    "receipt_no" VARCHAR(40) NOT NULL,
    "receipt_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "cutting_challan_id" UUID,
    "cutting_master_id" UUID,
    "cutting_master_name" VARCHAR(120) NOT NULL,
    "color_code" VARCHAR(60),
    "lot_no" VARCHAR(40),
    "pcs_received" DECIMAL(18,4) NOT NULL,
    "pcs_rejected" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "handles_received" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "received_by_name" VARCHAR(120),
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "cut_pieces_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cut_pieces_receipts_receipt_no_key" ON "cut_pieces_receipts"("receipt_no");
CREATE INDEX "cut_pieces_receipts_order_id_idx" ON "cut_pieces_receipts"("order_id");
CREATE INDEX "cut_pieces_receipts_style_id_idx" ON "cut_pieces_receipts"("style_id");
CREATE INDEX "cut_pieces_receipts_cutting_challan_id_idx" ON "cut_pieces_receipts"("cutting_challan_id");
CREATE INDEX "cut_pieces_receipts_cutting_master_id_idx" ON "cut_pieces_receipts"("cutting_master_id");
CREATE INDEX "cut_pieces_receipts_receipt_date_idx" ON "cut_pieces_receipts"("receipt_date");
CREATE INDEX "cut_pieces_receipts_deleted_at_idx" ON "cut_pieces_receipts"("deleted_at");

ALTER TABLE "cut_pieces_receipts"
  ADD CONSTRAINT "cut_pieces_receipts_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cut_pieces_receipts_style_id_fkey"
  FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cut_pieces_receipts_cutting_challan_id_fkey"
  FOREIGN KEY ("cutting_challan_id") REFERENCES "cutting_challans"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "cut_pieces_receipts_cutting_master_id_fkey"
  FOREIGN KEY ("cutting_master_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cut_pieces_receipts"
  -- Counts are never negative.
  ADD CONSTRAINT "cut_pieces_receipts_counts_non_negative"
  CHECK ("pcs_received" >= 0 AND "pcs_rejected" >= 0 AND "handles_received" >= 0),
  -- A receipt of nothing is not a receipt.
  ADD CONSTRAINT "cut_pieces_receipts_counts_something"
  CHECK ("pcs_received" + "pcs_rejected" + "handles_received" > 0);
