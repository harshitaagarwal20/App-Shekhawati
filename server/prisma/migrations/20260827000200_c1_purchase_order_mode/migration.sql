-- ===========================================================================
--  C1 - PURCHASE ORDER MODE
-- ===========================================================================
--
--  A purchase order must state, explicitly, which of two modes it runs in:
--
--      AS_PER_STYLE   qty <= computed_requirement_qty x (1 + excess_allowed)
--                     A HARD CAP, enforced here as well as in the service.
--
--      BULK           unbounded. A linked style is reference only; the
--                     variance is recorded and the PO stands.
--
--  ---------------------------------------------------------------------------
--   THIS IS A RENAME, NOT A NEW COLUMN
--
--   `order_type` (enum PoOrderType: ORDER_AS_PER_STYLE / BULK_ORDER) already
--   encoded exactly this concept, carrying a DEFAULT that C1 forbids. Adding an
--   `order_mode` beside it would leave two columns meaning one thing and
--   invite them to drift, so the existing column and type are renamed in place
--   and the default is dropped.
--
--   BACKFILL FOR order_mode: none needed. Every existing row already carries a
--   value, because the column it is renamed from had a default and was NOT
--   NULL. The rename preserves those values verbatim; SET NOT NULL below is
--   therefore a no-op against real data and will fail loudly if that
--   assumption is ever wrong.
--  ---------------------------------------------------------------------------

-- --- 1. The enum -----------------------------------------------------------

ALTER TYPE "PoOrderType" RENAME VALUE 'ORDER_AS_PER_STYLE' TO 'AS_PER_STYLE';
ALTER TYPE "PoOrderType" RENAME VALUE 'BULK_ORDER' TO 'BULK';
ALTER TYPE "PoOrderType" RENAME TO "PoOrderMode";

-- --- 2. The column ---------------------------------------------------------

ALTER TABLE "purchase_orders" RENAME COLUMN "order_type" TO "order_mode";

-- Guard: refuse to proceed if any row somehow lacks a mode, rather than
-- silently inventing one. SET NOT NULL would fail anyway; this says why.
DO $$
DECLARE missing bigint;
BEGIN
  SELECT count(*) INTO missing FROM "purchase_orders" WHERE "order_mode" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION
      'C1: % purchase order(s) have no order_mode. Set one explicitly before migrating.', missing;
  END IF;
END $$;

ALTER TABLE "purchase_orders"
  ALTER COLUMN "order_mode" DROP DEFAULT,
  ALTER COLUMN "order_mode" SET NOT NULL;

-- --- 3. The frozen requirement --------------------------------------------
--
--  computed_requirement_qty is persisted at creation time and never
--  recomputed. The BOM behind it is free to change; a ceiling that has already
--  been applied to a signed document is not.
--
--  BACKFILL: deliberately left NULL for rows that predate this migration.
--
--  Those POs were raised and approved under the rules in force at the time,
--  against a BOM that may since have moved. Reconstructing a requirement for
--  them now would invent a figure that was never actually applied, and could
--  retrospectively put a historical PO in breach of a constraint it was never
--  judged by. NULL means "nothing bounded this line", which is the truth for
--  every one of them, and the CHECK below is written to permit it.

ALTER TABLE "purchase_orders"
  ADD COLUMN "computed_requirement_qty" DECIMAL(18,4),
  ADD COLUMN "requirement_basis" TEXT,
  ADD COLUMN "bulk_variance_qty" DECIMAL(18,4);

-- --- 4. The constraints ----------------------------------------------------

-- The C1 hard cap, at the level the application cannot bypass.
--
-- Same-row form: the service applies a STRICTER cumulative version that also
-- counts what is already on order against the same buyer order and item, which
-- no single-row CHECK can see. This is the backstop, not the whole rule.
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_as_per_style_within_requirement"
  CHECK (
    "order_mode" <> 'AS_PER_STYLE'
    OR "computed_requirement_qty" IS NULL
    OR "order_qty" <= "computed_requirement_qty" * (1 + "excess_allowed")
  );

-- A requirement, where one was computed, is a quantity: never negative.
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_requirement_non_negative"
  CHECK ("computed_requirement_qty" IS NULL OR "computed_requirement_qty" >= 0);

-- Variance is a BULK-only measurement. Recording one against an AS_PER_STYLE
-- order would mean the ceiling had been treated as advisory.
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_variance_is_bulk_only"
  CHECK ("bulk_variance_qty" IS NULL OR "order_mode" = 'BULK');

-- --- 5. Index --------------------------------------------------------------

CREATE INDEX "purchase_orders_order_mode_idx" ON "purchase_orders"("order_mode");
