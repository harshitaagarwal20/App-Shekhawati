-- ===========================================================================
--  Phases 6, 7 and 8 - Purchase Order, Gate Pass, GRN and Inventory
--
--  Three formulas the workbook holds as spreadsheet cells move onto the server
--  in this phase, and each one gets a CHECK here as its last line of defence:
--
--      PO      Amount        = Order Qty     x Rate
--      GRN     Amount        = Receiving Qty x Inventory Rate
--      Gate    Variation %   = (Qty - Received Qty) / Qty
--
--  The validators strip `amount` and `variationPct` from every input schema, so
--  a client-supplied total never reaches a service, let alone the database.
--  These constraints mean that even a direct psql session cannot write a row
--  whose total disagrees with the two numbers behind it.
--
--  The rest of the migration is about evidence:
--
--    - a rejected PO gets a date (approved_at stays null on a rejection, so
--      without decided_at a refused PO carried no timestamp at all);
--    - a gate pass records who cleared it and when, and which Employee Master
--      record authorised it, because a gate pass is what a guard acts on;
--    - a GRN records where the stock landed, which item it stocked and the
--      moment GRN + Fabric Roll + Stock Ledger IN were committed together.
--
--  DocumentType gains INVENTORY_ITEM. Item codes (ITM-0001) are issued from
--  document_sequences inside the GRN transaction, so a receipt that rolls back
--  does not burn an item code. The sequence ROW is inserted by the next
--  migration: PostgreSQL will not let a transaction use an enum value it added
--  itself.
-- ===========================================================================

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'INVENTORY_ITEM';

-- ---------------------------------------------------------------------------
--  PURCHASE ORDER
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "purchase_orders"
  ADD COLUMN "decided_at" TIMESTAMPTZ(3);

-- Backfill. Rows seeded from the PO sheet are settled purchase orders: the
-- approved ones were decided on the day they were approved, and any rejected
-- one predates this system.
UPDATE "purchase_orders"
   SET "decided_at" = CASE WHEN "approval_status" <> 'PENDING'
                           THEN COALESCE("approved_at", "created_at") END;

ALTER TABLE "purchase_orders"
  -- Amount is Order Qty x Rate and nothing else, rounded to the stored scale.
  ADD CONSTRAINT "purchase_orders_amount_is_qty_x_rate"
    CHECK ("amount" = ROUND("order_qty" * "rate", 2)),

  -- Nothing is decided anonymously, and a pending PO carries no decision.
  ADD CONSTRAINT "purchase_orders_decided_by_present"
    CHECK ("approval_status" = 'PENDING' OR "approved_by_name" IS NOT NULL),
  ADD CONSTRAINT "purchase_orders_decided_at_present"
    CHECK ("approval_status" = 'PENDING' OR "decided_at" IS NOT NULL),
  ADD CONSTRAINT "purchase_orders_pending_has_no_decision"
    CHECK ("approval_status" <> 'PENDING'
           OR ("approved_at" IS NULL AND "decided_at" IS NULL
               AND "rejection_reason" IS NULL)),

  -- A rejected PO procures nothing, so nothing can have been received on it.
  ADD CONSTRAINT "purchase_orders_rejected_receives_nothing"
    CHECK ("approval_status" <> 'REJECTED' OR "received_qty" = 0);

-- ---------------------------------------------------------------------------
--  GATE PASS
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "gate_passes"
  ADD COLUMN "authorised_employee_id" UUID,
  ADD COLUMN "cleared_at"             TIMESTAMPTZ(3),
  ADD COLUMN "cleared_by_id"          UUID,
  ADD COLUMN "cleared_by_name"        VARCHAR(120);

-- Resolve the printed "Authorised By" name onto the Employee Master where it
-- names a real employee. "Dinesh Sir" is a title on the L_AuthorisedBy list
-- rather than an employee name, so those rows keep the name and no link.
UPDATE "gate_passes" gp
   SET "authorised_employee_id" = e."id"
  FROM "employees" e
 WHERE e."emp_name" = gp."authorised_by"
   AND e."deleted_at" IS NULL;

-- Passes seeded as Cleared were cleared on the gate pass date, by the person
-- the sheet names in "Authorised By".
UPDATE "gate_passes"
   SET "cleared_at"      = CASE WHEN "status" = 'CLEARED' THEN "created_at" END,
       "cleared_by_name" = CASE WHEN "status" = 'CLEARED' THEN "authorised_by" END;

-- CreateIndex
CREATE INDEX "gate_passes_authorised_employee_id_idx"
  ON "gate_passes"("authorised_employee_id");

-- AddForeignKey
ALTER TABLE "gate_passes"
  ADD CONSTRAINT "gate_passes_authorised_employee_id_fkey"
    FOREIGN KEY ("authorised_employee_id") REFERENCES "employees"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "gate_passes"
  -- Excel: Variation % = IFERROR((Qty - Received Qty) / Qty, 0). Zero until a
  -- received quantity is entered, and derived from the two columns after.
  --
  -- Stated as a tolerance of one unit in the last stored place rather than as
  -- an equality. The amount checks below and on purchase_orders CAN be exact,
  -- because multiplication of two decimals is exact; a division is not, and
  -- decimal.js in the service and numeric in the server need not agree on the
  -- twentieth significant digit before rounding to the stored scale of 6.
  -- The constraint still catches a total that was made up rather than derived.
  ADD CONSTRAINT "gate_passes_variation_is_the_formula"
    CHECK (("received_qty" IS NULL AND "variation_pct" = 0)
           OR ABS("variation_pct" - ("qty" - "received_qty") / "qty") <= 0.000001),

  -- A cleared pass is evidence the goods moved: it needs a received quantity
  -- and a stamp. A pending pass has neither.
  ADD CONSTRAINT "gate_passes_cleared_has_received_qty"
    CHECK ("status" <> 'CLEARED' OR "received_qty" IS NOT NULL),
  ADD CONSTRAINT "gate_passes_cleared_is_stamped"
    CHECK ("status" <> 'CLEARED' OR "cleared_at" IS NOT NULL),
  ADD CONSTRAINT "gate_passes_pending_is_not_cleared"
    CHECK ("status" <> 'PENDING' OR "cleared_at" IS NULL);

-- ---------------------------------------------------------------------------
--  GRN
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "grns"
  ADD COLUMN "location"          VARCHAR(80) NOT NULL DEFAULT 'MAIN STORE',
  ADD COLUMN "inventory_item_id" UUID,
  ADD COLUMN "posted_at"         TIMESTAMPTZ(3),
  ADD COLUMN "posted_by_id"      UUID,
  ADD COLUMN "posted_by_name"    VARCHAR(120);

-- Seeded receipts are already in stock - the seeder writes their ledger entry
-- and their balance. Stamp them as posted, and point each at the item its
-- ledger entry moved.
UPDATE "grns" g
   SET "inventory_item_id" = l."item_id",
       "posted_at"         = g."created_at",
       "posted_by_name"    = 'Seeded from the workbook'
  FROM "stock_ledger" l
 WHERE l."grn_id" = g."id"
   AND l."direction" = 'IN';

-- CreateIndex
CREATE INDEX "grns_inventory_item_id_idx" ON "grns"("inventory_item_id");
CREATE INDEX "grns_bill_no_idx" ON "grns"("bill_no");

-- AddForeignKey
ALTER TABLE "grns"
  ADD CONSTRAINT "grns_inventory_item_id_fkey"
    FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "grns"
  -- Amount is Receiving Qty x Inventory Rate and nothing else.
  ADD CONSTRAINT "grns_amount_is_qty_x_rate"
    CHECK ("amount" = ROUND("receiving_qty" * "inventory_rate", 2)),

  -- Variance against the PO quantity, as a fraction. Positive = excess.
  -- One unit in the last stored place of slack, for the reason set out on the
  -- gate_passes constraint above.
  ADD CONSTRAINT "grns_variation_is_the_formula"
    CHECK (ABS("variation_pct" - ("receiving_qty" - "order_qty") / "order_qty") <= 0.000001),

  -- A posted GRN is one that reached the stock ledger. It cannot be posted
  -- without an item to post against, and the stamp names who posted it.
  ADD CONSTRAINT "grns_posted_has_item"
    CHECK ("posted_at" IS NULL OR "inventory_item_id" IS NOT NULL),
  ADD CONSTRAINT "grns_posted_is_stamped"
    CHECK ("posted_at" IS NULL OR "posted_by_name" IS NOT NULL);
