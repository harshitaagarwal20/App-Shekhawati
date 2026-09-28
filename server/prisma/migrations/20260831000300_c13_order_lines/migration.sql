-- ===========================================================================
--  C13 - AN ORDER CARRIES SEVERAL STYLES
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   THE BUG THIS FIXES
--
--   An order in this business carries several styles. The workbook does not -
--   its Order sheet has a single "Style No" dropdown per row - and the ERP
--   reproduced that faithfully, so a buyer_orders row held one style_id and
--   one order_qty.
--
--   That was not a cosmetic limitation. domain/requirement.js multiplies a
--   style's per-piece consumption by the ORDER quantity, and it is the only
--   requirement calculation in this application - the purchase order ceiling,
--   planning, the cutting challan and the material plan all call it. On an
--   order that really carried two styles it charged the WHOLE order quantity
--   against the single style named on the header: over-buying that style, and
--   buying nothing whatsoever for the other one.
--
--   C7 had already met the same gap from the other end and worked around it
--   locally - plan_approvals gained its own style_id because "two styles
--   shipping in one container shared a single plan approval". The workaround
--   went downstream; the order was never fixed. This fixes the order.
--
--   ---------------------------------------------------------------------------
--   THE LINE CARRIES ITS OWN CEILING
--
--   effective_qty is on the LINE, not only on the order. It is that line's
--   quantity plus the excess the Director approved, and it is what every
--   requirement must be computed against.
--
--   The columns are deliberately named exactly as buyer_orders names them.
--   requirementFor() reads `effectiveQty ?? orderQty` off whatever object it is
--   handed, so handing it a LINE where an order used to go needs no change to
--   the calculation itself. The seam is the field names.
--
--   ---------------------------------------------------------------------------
--   THE HEADER QUANTITY BECOMES DERIVED
--
--   buyer_orders.order_qty and .effective_qty stay, and stay NOT NULL, but they
--   are now the SUM of the lines rather than typed figures. A header quantity a
--   user could set independently of the lines would be a second answer to "how
--   many pieces is this order", and the two would drift the first time somebody
--   edited a line.
--
--   buyer_orders.style_id also stays, as the LEAD style - line 1's style, kept
--   in step by the service. It is not the authority (the lines are), but every
--   list screen and report reads it, the workbook prints it, and on a
--   single-style order it is exactly right.
--
--   ---------------------------------------------------------------------------
--   BACKFILL: EVERY EXISTING ORDER BECOMES A ONE-LINE ORDER
--
--   Each buyer_orders row already describes exactly one style with one
--   quantity. That IS a valid single-line order, so the backfill is lossless
--   and needs no judgement: line 1 takes the header's style, colour, size group
--   and both quantities. Nothing is invented and no figure changes, so every
--   requirement computed after this migration equals the one computed before it
--   for every order that exists today.
-- ===========================================================================

-- --- 1. The line table ----------------------------------------------------

CREATE TABLE "buyer_order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "style_id" UUID NOT NULL,
    "color_code" VARCHAR(60),
    "size_group" VARCHAR(60),
    "order_qty" DECIMAL(18,4) NOT NULL,
    "effective_qty" DECIMAL(18,4) NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "buyer_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "buyer_order_lines_order_id_line_no_key"
  ON "buyer_order_lines"("order_id", "line_no");
CREATE INDEX "buyer_order_lines_order_id_idx" ON "buyer_order_lines"("order_id");
CREATE INDEX "buyer_order_lines_style_id_idx" ON "buyer_order_lines"("style_id");
CREATE INDEX "buyer_order_lines_deleted_at_idx" ON "buyer_order_lines"("deleted_at");

-- The same style in the same colour and size twice on one order is one line
-- entered twice, and it would double that style's requirement.
--
-- COALESCE rather than a plain UNIQUE on the four columns: colour and size
-- group are nullable, and PostgreSQL treats NULLs as distinct in a unique
-- index - so two lines for the same style with no colour on either would both
-- be accepted by the naive constraint, which is exactly the duplicate this is
-- meant to refuse. Partial on deleted_at so a soft-deleted line never blocks
-- re-entering the one it replaced.
CREATE UNIQUE INDEX "buyer_order_lines_identity_key"
  ON "buyer_order_lines"("order_id", "style_id", COALESCE("color_code", ''), COALESCE("size_group", ''))
  WHERE "deleted_at" IS NULL;

ALTER TABLE "buyer_order_lines"
  ADD CONSTRAINT "buyer_order_lines_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "buyer_order_lines_style_id_fkey"
  FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "buyer_order_lines"
  ADD CONSTRAINT "buyer_order_lines_line_no_positive" CHECK ("line_no" > 0),
  -- Ordering nothing of a style is not a line.
  ADD CONSTRAINT "buyer_order_lines_order_qty_positive" CHECK ("order_qty" > 0),
  -- The approved excess can only ever ADD. A line permitted less than it
  -- ordered is an arithmetic error, not a tighter ceiling.
  ADD CONSTRAINT "buyer_order_lines_effective_at_least_order"
  CHECK ("effective_qty" >= "order_qty");

-- --- 2. Backfill: every existing order becomes a one-line order ------------

INSERT INTO "buyer_order_lines"
  ("id", "order_id", "line_no", "style_id", "color_code", "size_group",
   "order_qty", "effective_qty", "created_at", "created_by_id", "updated_at", "updated_by_id",
   "deleted_at", "deleted_by_id")
SELECT gen_random_uuid(), o."id", 1, o."style_id", o."color_code", o."size_group",
       o."order_qty",
       -- Defensive: a handful of historic rows could carry an effective_qty
       -- below order_qty, which the new CHECK would refuse. The order quantity
       -- is the floor - an excess only ever adds.
       GREATEST(o."effective_qty", o."order_qty"),
       o."created_at", o."created_by_id", CURRENT_TIMESTAMP, o."updated_by_id",
       o."deleted_at", o."deleted_by_id"
  FROM "buyer_orders" o;

-- Every order must now have exactly one line. If this fires, the backfill
-- missed rows and the migration must not be allowed to commit.
DO $$
DECLARE orphaned INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphaned
    FROM "buyer_orders" o
   WHERE NOT EXISTS (SELECT 1 FROM "buyer_order_lines" l WHERE l."order_id" = o."id");
  IF orphaned > 0 THEN
    RAISE EXCEPTION 'C13 backfill left % order(s) with no line', orphaned;
  END IF;
END $$;

-- --- 3. The header quantities are now sums; prove they still agree --------
--
-- Nothing is UPDATEd here: the backfill copied the header figures down, so the
-- sums equal the headers by construction. This asserts it rather than assuming
-- it, because from here on the service recomputes the header from the lines and
-- a mismatch introduced now would be silently baked in.

DO $$
DECLARE mismatched INTEGER;
BEGIN
  SELECT COUNT(*) INTO mismatched
    FROM "buyer_orders" o
    JOIN (SELECT "order_id", SUM("order_qty") AS qty FROM "buyer_order_lines" GROUP BY "order_id") s
      ON s."order_id" = o."id"
   WHERE o."order_qty" <> s.qty;
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'C13 backfill: % order(s) disagree with the sum of their lines', mismatched;
  END IF;
END $$;

-- --- 4. A material plan is raised against a LINE --------------------------
--
-- C12 keyed a material plan on (order, style). An order may legitimately carry
-- the same style twice in different colours, and each of those is its own
-- requirement, so the key moves onto the line.

ALTER TABLE "material_plans" ADD COLUMN "order_line_id" UUID;

ALTER TABLE "material_plans"
  ADD CONSTRAINT "material_plans_order_line_id_fkey"
  FOREIGN KEY ("order_line_id") REFERENCES "buyer_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "material_plans_order_line_id_idx" ON "material_plans"("order_line_id");

-- Point any existing plan at the line that carries its order and style. Every
-- order has exactly one line at this point, so the match is unambiguous.
UPDATE "material_plans" mp
   SET "order_line_id" = l."id"
  FROM "buyer_order_lines" l
 WHERE l."order_id" = mp."order_id"
   AND l."style_id" = mp."style_id"
   AND mp."order_line_id" IS NULL;

DROP INDEX IF EXISTS "material_plans_order_id_style_id_version_key";

-- Nullable only for plans predating C13. NULLs are distinct in a PostgreSQL
-- unique index, so those rows do not collide with each other.
CREATE UNIQUE INDEX "material_plans_order_line_id_version_key"
  ON "material_plans"("order_line_id", "version");
