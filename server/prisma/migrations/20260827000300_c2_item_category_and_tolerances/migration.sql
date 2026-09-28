-- ===========================================================================
--  C2 - ITEM CATEGORY, THE TOLERANCE MASTER, AND PAYABLE QUANTITY
-- ===========================================================================
--
--  Three things, and they belong in one migration because none of them is
--  meaningful without the others: a tolerance is resolved BY category, and it
--  is the receipt tolerance that decides what is payable.
--
--  ---------------------------------------------------------------------------
--   1. WHY A THREE-VALUE ENUM BESIDE THE EIGHT-VALUE DROPDOWN
--
--   L_ItemCategory offers Fabric, Accessories, Handle, Zipper, Label, Thread,
--   Button and Packaging Material, and users may add to it - that is what a
--   master list is for. Tolerance, however, is not agreed per dropdown value.
--   It is agreed per COMMERCIAL category, and there are three.
--
--   So the open column stays exactly as it is and an enum-backed "category" is
--   added beside it. The mapping is applied once, here, and thereafter at
--   write time by categoryOf() - never re-derived on read, because a later
--   edit to the open list must not silently re-categorise an item that
--   tolerances have already been resolved against.
--
--   2. WHY tolerance_rules IS NOT ANOTHER excess_rules
--
--   excess_rules carries UNIQUE(scope, scope_key, document_type). That permits
--   exactly ONE live row per key, so its effective_from / effective_to columns
--   can close a rule down but can never version one. C2 requires date-versioned
--   rules, and it requires the ORDER and RECEIPT tolerances of a category to be
--   read together as one version. Neither is expressible in that table.
--   excess_rules keeps the excess-authorisation workflow it was built for;
--   this table owns the category tolerances.
--
--   3. WHAT IS SEEDED, AND WHAT IS DELIBERATELY NOT
--
--   ACCESSORIES only: order 1%, receipt 5%. Those two numbers are specified in
--   the C2 brief and nowhere else.
--
--   FABRIC and PACKAGING ARE NOT SEEDED. The brief is explicit that a tolerance
--   absent from the approved master must be REPORTED, not invented, and no
--   category-scoped figure for either exists in excess_rules today.
--   tolerance.service.js therefore falls back to the DOCUMENT_TYPE rules that
--   ARE approved and in force (purchase order 3%, GRN 2%), marks the result as
--   a fallback, and GET /api/tolerances/gaps lists both categories as awaiting
--   a decision. Nothing behaves differently from before this migration; the gap
--   is now visible instead of invisible.
--
--   NOTE FOR THE OFFICE: the approved master's accessories RECEIPT figure is 3%
--   with a 3% hard ceiling (excess_rules, ITEM_CATEGORY/Accessories/GRN), and
--   the C2 brief specifies 5%. Both are recorded. The 5% applies from today
--   forward; the 3% row is left untouched so that receipts already judged by it
--   stay reproducible. This disagreement is reported, not resolved here.
--
--   4. BACKFILL OF THE FROZEN TOLERANCES ON EXISTING PURCHASE ORDERS
--
--   The purchase orders that predate this migration were judged by the
--   constants compiled into purchaseOrder.service.js and grn.service.js:
--   accessories 1% order / 3% receipt, everything else 3% order / 2% receipt.
--   Those constants ARE what was applied, so writing them onto the rows records
--   history rather than inventing it. A historical PO therefore keeps
--   reproducing exactly the verdict it was given.
--  ---------------------------------------------------------------------------

-- --- 1. The enum -----------------------------------------------------------

CREATE TYPE "ItemCategory" AS ENUM ('FABRIC', 'ACCESSORIES', 'PACKAGING');

-- --- 2. The tolerance master ----------------------------------------------

CREATE TABLE "tolerance_rules" (
    "id" UUID NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "order_tolerance_pct" DECIMAL(9,6) NOT NULL,
    "receipt_tolerance_pct" DECIMAL(9,6) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "basis" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "tolerance_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tolerance_rules_category_effective_from_key"
  ON "tolerance_rules"("category", "effective_from");
CREATE INDEX "tolerance_rules_category_is_active_idx" ON "tolerance_rules"("category", "is_active");
CREATE INDEX "tolerance_rules_effective_from_idx" ON "tolerance_rules"("effective_from");
CREATE INDEX "tolerance_rules_deleted_at_idx" ON "tolerance_rules"("deleted_at");

-- A tolerance is a fraction of a quantity. Negative is meaningless, and a
-- figure above 1 means somebody typed a percentage into a fraction column -
-- the single most likely data-entry error on this table, and the one that
-- would silently permit a hundredfold over-delivery.
ALTER TABLE "tolerance_rules"
  ADD CONSTRAINT "tolerance_rules_order_pct_is_a_fraction"
  CHECK ("order_tolerance_pct" >= 0 AND "order_tolerance_pct" <= 1),
  ADD CONSTRAINT "tolerance_rules_receipt_pct_is_a_fraction"
  CHECK ("receipt_tolerance_pct" >= 0 AND "receipt_tolerance_pct" <= 1),
  ADD CONSTRAINT "tolerance_rules_effective_period_ordered"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

-- The one version the brief actually specifies.
INSERT INTO "tolerance_rules"
  ("id", "category", "order_tolerance_pct", "receipt_tolerance_pct",
   "effective_from", "basis", "updated_at")
VALUES
  (gen_random_uuid(), 'ACCESSORIES', 0.010000, 0.050000, DATE '2026-08-27',
   'C2 brief, default business rule currently specified: accessories may be ordered 1% over requirement and received 5% over order. Version 1 - supersedes nothing.',
   CURRENT_TIMESTAMP);

-- --- 3. items.category -----------------------------------------------------

ALTER TABLE "inventory_items" ADD COLUMN "category" "ItemCategory";

UPDATE "inventory_items"
   SET "category" = CASE
     WHEN "item_category" = 'Fabric'             THEN 'FABRIC'::"ItemCategory"
     WHEN "item_category" = 'Packaging Material' THEN 'PACKAGING'::"ItemCategory"
     WHEN "item_category" IN ('Accessories', 'Handle', 'Zipper', 'Label', 'Thread', 'Button')
                                                 THEN 'ACCESSORIES'::"ItemCategory"
   END
 WHERE "category" IS NULL;

-- Refuse to proceed on an item the mapping does not cover, naming it, rather
-- than filing it under a category nobody chose. SET NOT NULL below would fail
-- anyway; this says which value and why.
DO $do$
DECLARE unmapped text;
BEGIN
  SELECT string_agg(DISTINCT "item_category", ', ')
    INTO unmapped
    FROM "inventory_items"
   WHERE "category" IS NULL;
  IF unmapped IS NOT NULL THEN
    RAISE EXCEPTION
      'C2: inventory item category value(s) not covered by the FABRIC/ACCESSORIES/PACKAGING mapping: %. Add them to categoryOf() and to this migration before continuing.', unmapped;
  END IF;
END
$do$;

ALTER TABLE "inventory_items" ALTER COLUMN "category" SET NOT NULL;
CREATE INDEX "inventory_items_category_idx" ON "inventory_items"("category");

-- --- 4. purchase_orders: category, frozen tolerances, payable quantity -----

ALTER TABLE "purchase_orders"
  ADD COLUMN "category" "ItemCategory",
  ADD COLUMN "order_tolerance_pct" DECIMAL(9,6),
  ADD COLUMN "receipt_tolerance_pct" DECIMAL(9,6),
  ADD COLUMN "tolerance_rule_id" UUID,
  ADD COLUMN "tolerance_basis" TEXT,
  ADD COLUMN "receipt_breach_acknowledged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "payable_qty" DECIMAL(18,4) NOT NULL DEFAULT 0;

UPDATE "purchase_orders"
   SET "category" = CASE
         WHEN "item" = 'Fabric'             THEN 'FABRIC'::"ItemCategory"
         WHEN "item" = 'Packaging Material' THEN 'PACKAGING'::"ItemCategory"
         ELSE 'ACCESSORIES'::"ItemCategory"
       END
 WHERE "category" IS NULL;

-- The constants the application actually applied to these rows, written down.
UPDATE "purchase_orders"
   SET "order_tolerance_pct" = CASE WHEN "category" = 'ACCESSORIES' THEN 0.010000 ELSE 0.030000 END,
       "receipt_tolerance_pct" = CASE WHEN "category" = 'ACCESSORIES' THEN 0.030000 ELSE 0.020000 END,
       "tolerance_basis" =
         'Backfilled by the C2 migration from the constants in force when this order was raised '
         || '(purchaseOrder.service.js EXCESS_CEILING, grn.service.js RECEIPT_TOLERANCE). '
         || 'Recorded so this order keeps reproducing the verdict it was actually given.'
 WHERE "order_tolerance_pct" IS NULL;

-- payable_qty is the quantity actually received. For orders already received
-- against, that number exists: it is received_qty, which the GRN posting
-- transaction has been maintaining all along. Copying it is not a guess.
UPDATE "purchase_orders" SET "payable_qty" = "received_qty" WHERE "received_qty" > 0;

-- --- 4b. The over-receipts that were already accepted ----------------------
--
--  An over-tolerance receipt is not unheard of and the system has always had
--  a path for it: grn.create() refuses the breach unless the receiver passes
--  acknowledgeToleranceBreach, and stamps tolerance_breached on the GRN when
--  they do. That acknowledgement is a decision somebody took, and the CHECK
--  below has to respect it or it would retrospectively invalidate receipts the
--  business accepted.
--
--  So the ceiling is enforced UNLESS the breach was acknowledged, and the flag
--  is backfilled from the GRNs themselves - not assumed. RF-006 is the one row
--  this applies to today: 900 + 10 + 10 against an order of 900 is 2.22% on a
--  2% fabric tolerance, and GRN-010 carries tolerance_breached = true.
UPDATE "purchase_orders" po
   SET "receipt_breach_acknowledged" = true
 WHERE po."received_qty" > po."order_qty" * (1 + po."receipt_tolerance_pct")
   AND EXISTS (
     SELECT 1 FROM "grns" g
      WHERE g."purchase_order_id" = po."id"
        AND g."tolerance_breached" IS TRUE
        AND g."deleted_at" IS NULL
   );

-- An over-receipt that nobody ever acknowledged is a data problem, not a
-- migration problem. Name it rather than widening the constraint until it
-- stops complaining.
DO $do$
DECLARE offenders text;
BEGIN
  SELECT string_agg("po_id", ', ')
    INTO offenders
    FROM "purchase_orders"
   WHERE "received_qty" > "order_qty" * (1 + "receipt_tolerance_pct")
     AND NOT "receipt_breach_acknowledged";
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'C2: purchase order(s) % have received more than their receipt tolerance permits with no acknowledged breach on any GRN. Resolve the receipts before migrating; do not widen the tolerance to hide them.', offenders;
  END IF;
END
$do$;

ALTER TABLE "purchase_orders"
  ALTER COLUMN "category" SET NOT NULL,
  ALTER COLUMN "order_tolerance_pct" SET NOT NULL,
  ALTER COLUMN "receipt_tolerance_pct" SET NOT NULL;

CREATE INDEX "purchase_orders_category_idx" ON "purchase_orders"("category");

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_order_tolerance_is_a_fraction"
  CHECK ("order_tolerance_pct" >= 0 AND "order_tolerance_pct" <= 1),
  ADD CONSTRAINT "purchase_orders_receipt_tolerance_is_a_fraction"
  CHECK ("receipt_tolerance_pct" >= 0 AND "receipt_tolerance_pct" <= 1),
  -- Payable is what came in. It cannot be negative, and it cannot exceed what
  -- was received - a payment figure larger than the delivery is the one error
  -- on this column that costs real money.
  ADD CONSTRAINT "purchase_orders_payable_qty_non_negative"
  CHECK ("payable_qty" >= 0),
  ADD CONSTRAINT "purchase_orders_payable_within_received"
  CHECK ("payable_qty" <= "received_qty"),
  -- THE C2 RECEIPT CEILING, at the level the application cannot bypass:
  -- cumulative receipts against the order may not exceed the ordered quantity
  -- plus the tolerance frozen on this row.
  --
  -- received_qty IS the cumulative figure - the GRN posting transaction
  -- recomputes it as prior + this receipt - so this single-row CHECK is a
  -- cumulative test, which is what C2 requires. A per-GRN test would wave
  -- three deliveries of 1% each straight through.
  --
  -- The acknowledgement escape is not a loophole: it is the existing,
  -- deliberate path for an over-delivery the business decides to accept, it
  -- requires an explicit act from the receiver, and it leaves both the GRN
  -- flag and this column behind as evidence. What it stops is an over-receipt
  -- landing silently.
  ADD CONSTRAINT "purchase_orders_received_within_receipt_tolerance"
  CHECK (
    "receipt_breach_acknowledged"
    OR "received_qty" <= "order_qty" * (1 + "receipt_tolerance_pct")
  );

-- --- 5. grns: the category and the tolerance the receipt was judged by -----

ALTER TABLE "grns"
  ADD COLUMN "category" "ItemCategory",
  ADD COLUMN "receipt_tolerance_pct" DECIMAL(9,6),
  ADD COLUMN "cumulative_received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "cumulative_variation_pct" DECIMAL(9,6) NOT NULL DEFAULT 0;

UPDATE "grns" g
   SET "category" = po."category",
       "receipt_tolerance_pct" = po."receipt_tolerance_pct"
  FROM "purchase_orders" po
 WHERE po."id" = g."purchase_order_id"
   AND g."category" IS NULL;

-- A GRN with no purchase order behind it cannot inherit a category. Rather
-- than guess, fall back to the item text the receipt itself carries.
UPDATE "grns"
   SET "category" = CASE
         WHEN "item" = 'Fabric'             THEN 'FABRIC'::"ItemCategory"
         WHEN "item" = 'Packaging Material' THEN 'PACKAGING'::"ItemCategory"
         ELSE 'ACCESSORIES'::"ItemCategory"
       END,
       "receipt_tolerance_pct" =
         CASE WHEN "item" = 'Accessories' THEN 0.030000 ELSE 0.020000 END
 WHERE "category" IS NULL;

-- Restate the cumulative position each historical receipt brought its order
-- to. Derived from the receipts themselves, in order, so it is a recomputation
-- of what happened rather than an assumption about it.
UPDATE "grns" g
   SET "cumulative_received_qty" = c.running,
       "cumulative_variation_pct" = CASE
         WHEN po."order_qty" > 0 THEN (c.running - po."order_qty") / po."order_qty"
         ELSE 0
       END
  FROM (
    SELECT "id",
           SUM("receiving_qty") OVER (
             PARTITION BY "purchase_order_id"
             ORDER BY "grn_date", "created_at", "id"
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS running
      FROM "grns"
     WHERE "deleted_at" IS NULL AND "purchase_order_id" IS NOT NULL
  ) c,
  "purchase_orders" po
 WHERE c."id" = g."id"
   AND po."id" = g."purchase_order_id";

ALTER TABLE "grns"
  ALTER COLUMN "category" SET NOT NULL,
  ALTER COLUMN "receipt_tolerance_pct" SET NOT NULL;

CREATE INDEX "grns_category_idx" ON "grns"("category");

ALTER TABLE "grns"
  ADD CONSTRAINT "grns_receipt_tolerance_is_a_fraction"
  CHECK ("receipt_tolerance_pct" >= 0 AND "receipt_tolerance_pct" <= 1),
  ADD CONSTRAINT "grns_cumulative_received_non_negative"
  CHECK ("cumulative_received_qty" >= 0),
  -- The cumulative total this receipt contributed to must be at least this
  -- receipt. Catches a running total written without its own row in it.
  ADD CONSTRAINT "grns_cumulative_covers_this_receipt"
  CHECK ("cumulative_received_qty" >= "receiving_qty");
