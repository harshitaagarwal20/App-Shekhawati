-- ===========================================================================
--  Phase 8 - inventory is transaction-based: the ledger is the source of truth
--
--  Two rules drive this migration.
--
--  1. STOCK IS DERIVED, NEVER OVERWRITTEN.
--     stock_balances is a cache. Every one of its columns is recomputed by
--     aggregating stock_ledger for the same (item, location), inside the same
--     transaction as the movement that changed it. Nothing adds to or
--     subtracts from a balance in place, so a balance cannot drift away from
--     the movements behind it - at worst it can be rebuilt from them.
--
--     GRN  +100 m  ->  Fabric Issue  -25 m  ->  available 75 m,
--     and "available" is SUM(qty_in) - SUM(qty_out), not a number anybody set.
--
--  2. A LEDGER LINE HAS TO STAY READABLE.
--     The item-describing columns added below - category, colour, GSM, content,
--     UOM - are snapshots, not joins. A stock register printed next year must
--     read the way it read on the day, even after the inventory master is
--     edited underneath it. Same reason the PO snapshots the vendor address.
--
--  qty_in / qty_out are the two columns a stock register is actually read in.
--  They are kept in step with the existing direction/qty pair by a CHECK, so
--  SUM(qty_in) - SUM(qty_out) and the direction-aware sum can never disagree.
-- ===========================================================================

-- AlterTable
ALTER TABLE "stock_ledger"
  ADD COLUMN "item_category"   VARCHAR(60)   NOT NULL DEFAULT '',
  ADD COLUMN "color_code"      VARCHAR(60),
  ADD COLUMN "gsm"             VARCHAR(20),
  ADD COLUMN "content"         VARCHAR(80),
  ADD COLUMN "uom"             VARCHAR(20)   NOT NULL DEFAULT '',
  ADD COLUMN "order_id"        UUID,
  ADD COLUMN "qty_in"          DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "qty_out"         DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "created_by_name" VARCHAR(120);

-- ---------------------------------------------------------------------------
--  Backfill.
--
--  Split the existing direction/qty pair into the two columns, and take the
--  descriptive snapshot from the inventory item as it stands right now. That is
--  the best available reading of how those rows read on the day: they were
--  written by the seeder from the same master row, in the same run.
-- ---------------------------------------------------------------------------
UPDATE "stock_ledger"
   SET "qty_in"  = CASE WHEN "direction" = 'IN'  THEN "qty" ELSE 0 END,
       "qty_out" = CASE WHEN "direction" = 'OUT' THEN "qty" ELSE 0 END;

UPDATE "stock_ledger" l
   SET "item_category" = i."item_category",
       "color_code"    = NULLIF(i."color_code", ''),
       "gsm"           = NULLIF(i."gsm", ''),
       "content"       = i."content",
       "uom"           = i."uom"
  FROM "inventory_items" i
 WHERE i."id" = l."item_id";

-- A receipt's order is the order its purchase order was raised for.
UPDATE "stock_ledger" l
   SET "order_id" = po."order_id"
  FROM "grns" g
  JOIN "purchase_orders" po ON po."id" = g."purchase_order_id"
 WHERE g."id" = l."grn_id"
   AND po."order_id" IS NOT NULL;

-- An issue's order is named on the issue itself.
UPDATE "stock_ledger" l
   SET "order_id" = fi."order_id"
  FROM "fabric_issues" fi
 WHERE l."document_type" = 'FABRIC_ISSUE'
   AND fi."id" = l."document_id"
   AND fi."order_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "stock_ledger_item_id_location_idx" ON "stock_ledger"("item_id", "location");
CREATE INDEX "stock_ledger_order_id_idx" ON "stock_ledger"("order_id");

-- AddForeignKey
ALTER TABLE "stock_ledger"
  ADD CONSTRAINT "stock_ledger_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
--  Constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "stock_ledger"
  ADD CONSTRAINT "stock_ledger_in_out_non_negative"
    CHECK ("qty_in" >= 0 AND "qty_out" >= 0),

  -- Exactly one side of a movement is non-zero, and it agrees with direction
  -- and qty. This is what lets a report SUM(qty_in) - SUM(qty_out) and a rule
  -- read `direction` without the two ever telling different stories.
  ADD CONSTRAINT "stock_ledger_in_out_matches_direction"
    CHECK (("direction" = 'IN'  AND "qty_in" = "qty" AND "qty_out" = 0)
        OR ("direction" = 'OUT' AND "qty_out" = "qty" AND "qty_in" = 0)),

  -- Value is Qty x Rate, like every other total in this system.
  ADD CONSTRAINT "stock_ledger_value_is_qty_x_rate"
    CHECK ("value" = ROUND("qty" * "rate", 2));

-- ---------------------------------------------------------------------------
--  "The system must prevent issuing more stock than available stock" is
--  enforced in inventory.service.js, on every OUT movement, inside the same
--  transaction that would write it - and NOT as a CHECK on balance_qty here.
--
--  The reason is the workbook itself. Its sample data issues FAB-003, FAB-007
--  and FAB-009 for printing on 15 and 25 August against a GRN dated the 20th,
--  so replaying the sheets in date order drives two items transiently negative.
--  A CHECK would refuse to load the company's own history. The rule belongs to
--  new movements, which is exactly where the service applies it: an issue that
--  would exceed the available balance is refused before anything is written,
--  and the whole transaction rolls back.
--
--  The BALANCE cache can still be constrained, because it is recomputed from
--  the finished ledger rather than mid-replay, and every seeded item settles
--  non-negative.
-- ---------------------------------------------------------------------------
ALTER TABLE "stock_balances"
  ADD CONSTRAINT "stock_balances_qty_non_negative" CHECK ("qty" >= 0);

-- ---------------------------------------------------------------------------
--  FABRIC ROLL CONTROL
--
--  roll_no is already UNIQUE from the initial migration, which is what stops a
--  duplicate roll number. What was missing is the guarantee that a roll never
--  claims more balance than it was received with. Non-negativity is already
--  covered by fabric_rolls_balance_non_negative from the Phase 0 constraints,
--  so between the two a roll balance is penned in on both sides.
-- ---------------------------------------------------------------------------
ALTER TABLE "fabric_rolls"
  ADD CONSTRAINT "fabric_rolls_balance_within_received"
    CHECK ("balance_qty" <= "received_qty");
