-- ===========================================================================
--  Phase 3 - Buyer Order: excess approval workflow and server-calculated qty
--
--  The Order sheet marks its "Excess" column "Approval from dinesh sir", so any
--  excess above zero becomes a Director decision rather than a free-text field.
--  effective_qty is the ceiling on what may be cut, procured and shipped; it is
--  computed by the server on every write and is never accepted from a client.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "ExcessApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "buyer_orders"
  ADD COLUMN "excess_approval_status"  "ExcessApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "excess_approved_pct"     DECIMAL(9,6)  NOT NULL DEFAULT 0,
  ADD COLUMN "excess_justification"    TEXT,
  ADD COLUMN "excess_approved_by_name" VARCHAR(120),
  ADD COLUMN "excess_approved_by_id"   UUID,
  ADD COLUMN "excess_approved_at"      TIMESTAMPTZ(3),
  ADD COLUMN "excess_rejection_reason" TEXT,
  ADD COLUMN "effective_qty"           DECIMAL(18,4),
  ADD COLUMN "amendment_count"         INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows before the NOT NULL constraint goes on.
-- Orders seeded from the workbook already carry an approved excess: the sample
-- rows are live orders, not drafts awaiting a decision.
UPDATE "buyer_orders"
   SET "excess_approved_pct"    = "excess_pct",
       "effective_qty"          = "order_qty" * (1 + "excess_pct"),
       "excess_approval_status" = CASE WHEN "excess_pct" > 0 THEN 'APPROVED'::"ExcessApprovalStatus"
                                       ELSE 'NOT_REQUIRED'::"ExcessApprovalStatus" END,
       "excess_approved_by_name" = CASE WHEN "excess_pct" > 0 THEN 'Dinesh Sir' ELSE NULL END,
       "excess_approved_at"      = CASE WHEN "excess_pct" > 0 THEN "created_at" ELSE NULL END;

ALTER TABLE "buyer_orders" ALTER COLUMN "effective_qty" SET NOT NULL;

-- CreateIndex
CREATE INDEX "buyer_orders_excess_approval_status_idx"
  ON "buyer_orders"("excess_approval_status");

-- ---------------------------------------------------------------------------
--  Constraints
-- ---------------------------------------------------------------------------

ALTER TABLE "buyer_orders"
  ADD CONSTRAINT "buyer_orders_excess_approved_range"
    CHECK ("excess_approved_pct" >= 0 AND "excess_approved_pct" < 1),

  -- The approved excess can never exceed what was asked for.
  ADD CONSTRAINT "buyer_orders_excess_approved_within_requested"
    CHECK ("excess_approved_pct" <= "excess_pct"),

  -- Nothing is approved unless the decision says so.
  ADD CONSTRAINT "buyer_orders_excess_approved_only_when_approved"
    CHECK ("excess_approval_status" = 'APPROVED' OR "excess_approved_pct" = 0),

  -- An approval and a rejection each need their evidence.
  ADD CONSTRAINT "buyer_orders_excess_approved_at_present"
    CHECK ("excess_approval_status" <> 'APPROVED' OR "excess_approved_at" IS NOT NULL),
  ADD CONSTRAINT "buyer_orders_excess_rejection_reason_present"
    CHECK ("excess_approval_status" <> 'REJECTED' OR "excess_rejection_reason" IS NOT NULL),

  -- An order asking for no excess must not be sitting in an approval queue.
  ADD CONSTRAINT "buyer_orders_no_excess_needs_no_approval"
    CHECK ("excess_pct" > 0 OR "excess_approval_status" = 'NOT_REQUIRED'),

  ADD CONSTRAINT "buyer_orders_effective_qty_positive"
    CHECK ("effective_qty" > 0),

  ADD CONSTRAINT "buyer_orders_amendment_count_non_negative"
    CHECK ("amendment_count" >= 0),

  -- A buyer cannot ask for delivery before the order was placed.
  ADD CONSTRAINT "buyer_orders_delivery_after_order"
    CHECK ("buyer_delivery_date" IS NULL OR "buyer_delivery_date" >= "order_date");

-- ---------------------------------------------------------------------------
--  Document sequence for system-generated order numbers
--
--  The Order sheet notes "Buyer PO num is their order no", so a buyer PO number
--  entered by the merchandiser always wins. This series is the fallback for an
--  order taken before the buyer's own number is known.
-- ---------------------------------------------------------------------------
INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "description", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'BUYER_ORDER', '', 'SO', '', '-', 5, 1,
   'Fallback order number when the buyer PO number is not yet known', NOW(), NOW())
ON CONFLICT ("document_type", "scope_key") DO NOTHING;
