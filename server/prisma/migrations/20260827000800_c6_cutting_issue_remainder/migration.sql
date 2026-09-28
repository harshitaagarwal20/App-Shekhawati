-- ===========================================================================
--  C6 - CUTTING ISSUE BECOMES [A][S], AND THE REMAINDER ROLLS BACK
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
--
--   The nine pre-post verifications stay exactly as they are, all nine still
--   run, and none of them short-circuits. A tenth is ADDED -
--   REMAINDER_RECONCILES - and the ledger entries are appended inside the same
--   transaction that posts the challan.
--
--   ---------------------------------------------------------------------------
--   THE EQUATION, AND WHY WASTAGE IS TYPED
--
--       issued_qty = consumed_qty + remainder_qty + wastage_qty
--
--   Deriving wastage as "whatever is left over" would make this balance by
--   construction and therefore check nothing at all - the arithmetic would
--   absorb a mis-count in silence. The supervisor states the wastage, and if
--   the four numbers disagree the posting is refused.
--
--   The CHECK below is unconditional and still passes for every existing row,
--   because all four columns default to zero and 0 = 0 + 0 + 0. A second
--   constraint requires a real issued quantity once the stock leg has actually
--   been posted, so a posted challan cannot claim to have cut nothing.
--
--   ---------------------------------------------------------------------------
--   WHERE THE FABRIC COMES FROM
--
--   The cutting OUT is taken from the CUTTING FLOOR, not from the main store.
--   The Fabric Issue put it there (C5 added fabric_issues.in_process_location
--   for exactly this), which is what lets the ledger show cloth that has left
--   the rack but has not yet been cut - visible on hand, not available to
--   issue. The remainder goes back to the main store on the SAME roll it came
--   off: stock_ledger.roll_id is set on the IN entry, so a returned remainder
--   keeps its identity instead of becoming anonymous metres.
--
--   BACKFILL: none, and the reason is in the fabric issues rather than here.
--   The seven posted challans were posted under the old model, where a cutting
--   issue moved no stock at all. Writing consumption and remainder movements
--   for them now would append entries to a append-only ledger for events that
--   were never recorded, on quantities nobody measured. They keep their zeros
--   and their stock_posted_at stays NULL, which is what says plainly that they
--   never moved stock.
--  ---------------------------------------------------------------------------

ALTER TABLE "cutting_issues"
  ADD COLUMN "issued_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "consumed_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "remainder_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "wastage_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "fabric_uom" VARCHAR(20) NOT NULL DEFAULT 'Mtrs',
  ADD COLUMN "stock_posted_at" TIMESTAMPTZ(3),
  ADD COLUMN "inventory_item_id" UUID,
  ADD COLUMN "cutting_location" VARCHAR(80) NOT NULL DEFAULT 'CUTTING FLOOR';

ALTER TABLE "cutting_issues"
  ADD CONSTRAINT "cutting_issues_inventory_item_id_fkey"
  FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cutting_issues_inventory_item_id_idx" ON "cutting_issues"("inventory_item_id");

ALTER TABLE "cutting_issues"
  ADD CONSTRAINT "cutting_issues_fabric_quantities_non_negative"
  CHECK ("issued_qty" >= 0 AND "consumed_qty" >= 0 AND "remainder_qty" >= 0 AND "wastage_qty" >= 0),
  -- THE C6 EQUATION. The one rule the whole control exists for, at the level
  -- no caller can walk past.
  ADD CONSTRAINT "cutting_issues_remainder_reconciles"
  CHECK ("issued_qty" = "consumed_qty" + "remainder_qty" + "wastage_qty"),
  -- A challan that moved stock must have had fabric to move, and must have cut
  -- some of it. A posting of nothing but remainder is a fabric issue being
  -- reversed, which is not what this document is.
  ADD CONSTRAINT "cutting_issues_posted_stock_has_fabric"
  CHECK ("stock_posted_at" IS NULL OR ("issued_qty" > 0 AND "consumed_qty" > 0)),
  -- Stock cannot have moved without an item it moved as.
  ADD CONSTRAINT "cutting_issues_posted_stock_names_its_item"
  CHECK ("stock_posted_at" IS NULL OR "inventory_item_id" IS NOT NULL),
  -- The ledger leg belongs to the posting. One cannot exist without the other.
  ADD CONSTRAINT "cutting_issues_stock_leg_follows_posting"
  CHECK ("stock_posted_at" IS NULL OR "posted_at" IS NOT NULL);
