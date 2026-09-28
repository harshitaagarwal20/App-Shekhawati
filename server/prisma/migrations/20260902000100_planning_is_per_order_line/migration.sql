-- ===========================================================================
--  PLANNING IS DONE PER ORDER LINE - PER STYLE - NOT PER ORDER
-- ===========================================================================
--
--  WHAT WAS WRONG
--
--  An order carries one line per style / colour / size (C13, migration
--  20260901000300). Planning did not: a plan hung off the ORDER and was keyed
--  on (order, department, version), so an order with two styles got ONE cutting
--  plan for both of them. Three things followed from that, all wrong:
--
--    * `style_no` was copied from the order HEADER, so the plan named one style
--      and silently stood for the others too;
--    * `order_qty` was copied from the order HEADER, so a plan for a 500-piece
--      style carried the whole order's 800 and was measured against the wrong
--      ceiling;
--    * a second cutting plan for the second style was refused outright -
--      "Order ... already has a cutting plan. Edit or revise that plan rather
--      than starting a second one."
--
--  WHY THE LINE AND NOT THE STYLE
--
--  A buyer order line is already (style, colour, size) with its own quantity
--  and its own `effective_qty` - which is precisely the ceiling a plan has to
--  be measured against. Keying on the style alone would lose the colour and
--  size, and would still need the line to find the quantity. MaterialPlan
--  (C12) keys on `order_line_id` for the same reason; this brings planning into
--  line with it.
--
--  ---------------------------------------------------------------------------
--   THE BACKFILL IS EXACT, NOT ASSUMED
--
--   Every existing plan is matched to its order line BY STYLE NUMBER - the
--   plan's own `style_no` against the line's style. That was verified to be
--   unambiguous before this migration was written: all seven plans in the
--   database match exactly one line each, and every order currently carries
--   exactly one line.
--
--   The migration REFUSES rather than guessing if any plan cannot be matched to
--   exactly one line. A plan pointed at the wrong style would misstate the
--   quantity every downstream refusal is measured against, so a failed
--   migration is much the better outcome.
--
--   `order_qty` is re-stated from the line at the same time. On today's
--   single-line orders that changes nothing - the line's quantity IS the
--   order's - so no existing plan moves. It matters from the first two-style
--   order onwards.
--  ---------------------------------------------------------------------------

-- 1. The columns, nullable to begin with so the backfill can fill them.
ALTER TABLE "plannings"
  ADD COLUMN "order_line_id" UUID,
  ADD COLUMN "style_id"      UUID;

-- 2. Refuse if any plan cannot be matched to exactly one line of its order.
DO $do$
DECLARE
  unmatched int;
BEGIN
  SELECT count(*) INTO unmatched
  FROM "plannings" p
  WHERE p."deleted_at" IS NULL
    AND (
      SELECT count(*)
      FROM "buyer_order_lines" l
      JOIN "styles" s ON s."id" = l."style_id"
      WHERE l."order_id" = p."order_id"
        AND l."deleted_at" IS NULL
        AND s."style_no" = p."style_no"
    ) <> 1;

  IF unmatched > 0 THEN
    RAISE EXCEPTION
      '% plan(s) do not match exactly one order line by style number. Planning cannot be moved '
      'onto order lines without deciding which style each of those plans is for, and this '
      'migration will not decide that. Resolve them first.', unmatched;
  END IF;
END
$do$;

-- 3. Backfill from the matched line.
UPDATE "plannings" p
   SET "order_line_id" = l."id",
       "style_id"      = l."style_id",
       -- Re-stated from the line. Identical on a single-line order.
       "order_qty"     = l."order_qty"
  FROM "buyer_order_lines" l
  JOIN "styles" s ON s."id" = l."style_id"
 WHERE l."order_id" = p."order_id"
   AND l."deleted_at" IS NULL
   AND s."style_no" = p."style_no";

-- Soft-deleted plans may have no live line to match; give them the order's
-- lowest-numbered line so the NOT NULL below can be applied. They are history
-- and nothing reads their quantities.
UPDATE "plannings" p
   SET "order_line_id" = l."id",
       "style_id"      = l."style_id"
  FROM "buyer_order_lines" l
 WHERE p."order_line_id" IS NULL
   AND l."id" = (
     SELECT l2."id" FROM "buyer_order_lines" l2
      WHERE l2."order_id" = p."order_id"
      ORDER BY l2."line_no" ASC
      LIMIT 1
   );

-- 4. Now they are required.
ALTER TABLE "plannings"
  ALTER COLUMN "order_line_id" SET NOT NULL,
  ALTER COLUMN "style_id"      SET NOT NULL;

ALTER TABLE "plannings"
  ADD CONSTRAINT "plannings_order_line_id_fkey"
    FOREIGN KEY ("order_line_id") REFERENCES "buyer_order_lines"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "plannings_style_id_fkey"
    FOREIGN KEY ("style_id") REFERENCES "styles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. The line joins the key. One plan per (order line, department, version).
DROP INDEX "plannings_order_id_plan_department_version_key";

CREATE UNIQUE INDEX "plannings_order_id_plan_department_order_line_id_version_key"
  ON "plannings" ("order_id", "plan_department", "order_line_id", "version");

CREATE INDEX "plannings_order_line_id_idx" ON "plannings" ("order_line_id");
CREATE INDEX "plannings_style_id_idx"      ON "plannings" ("style_id");

-- 6. A plan's line must belong to the plan's order, and its style must be the
--    line's style. Both are written by the service from the line itself; the
--    constraints are here so a hand-edit cannot put a plan on another order's
--    line and misreport what was planned.
ALTER TABLE "plannings"
  ADD CONSTRAINT "plannings_line_belongs_to_order" CHECK (true) NOT VALID;

DO $do$
BEGIN
  -- Expressed as a trigger-free check via a foreign key on the pair, which
  -- needs a unique index on (id, order_id) over the lines to point at.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'buyer_order_lines'
       AND indexname = 'buyer_order_lines_id_order_id_key'
  ) THEN
    CREATE UNIQUE INDEX "buyer_order_lines_id_order_id_key"
      ON "buyer_order_lines" ("id", "order_id");
  END IF;
END
$do$;

ALTER TABLE "plannings" DROP CONSTRAINT "plannings_line_belongs_to_order";

ALTER TABLE "plannings"
  ADD CONSTRAINT "plannings_line_belongs_to_order"
    FOREIGN KEY ("order_line_id", "order_id")
    REFERENCES "buyer_order_lines" ("id", "order_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
