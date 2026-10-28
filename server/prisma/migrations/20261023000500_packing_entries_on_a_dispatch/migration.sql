-- ===========================================================================
--  PHASE 6 - THE BOXES ON A DISPATCH
-- ===========================================================================
--
--  A dispatch used to take "packed less what other dispatches took", style by
--  style, without saying which boxes. So its packing list printed every box of
--  the order - a second dispatch's list carried the first one's boxes - and a
--  packing line could be re-cut after its boxes had left (6 x 10 edited to
--  3 x 20), leaving the dispatch note and the packing list disagreeing.
--
--  Now each packing line names the dispatch it went on. A dispatch takes the
--  order's lines on no other dispatch, whole; its packing list prints those
--  lines; and a line on a Dispatched or Delivered dispatch cannot be changed.
-- ===========================================================================

ALTER TABLE "packing_entries" ADD COLUMN "dispatch_id" UUID;

ALTER TABLE "packing_entries"
  ADD CONSTRAINT "packing_entries_dispatch_id_fkey"
  FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "packing_entries_dispatch_id_idx" ON "packing_entries"("dispatch_id");

-- The dispatches already made: each takes the packing lines of its order and
-- style in the order they were packed, oldest dispatch first, up to the pieces
-- its line carries. A line is given to the dispatch its first piece falls in.
WITH e AS (
  SELECT p."id", p."order_id", p."style_id",
         SUM(p."pcs_packed") OVER (
           PARTITION BY p."order_id", p."style_id"
           ORDER BY p."pack_date", p."created_at", p."id"
         ) - p."pcs_packed" AS "before"
    FROM "packing_entries" p
   WHERE p."deleted_at" IS NULL
),
d AS (
  SELECT l."dispatch_id", l."order_id", l."style_id", l."pcs",
         SUM(l."pcs") OVER (
           PARTITION BY l."order_id", l."style_id"
           ORDER BY x."created_at", x."id"
         ) AS "upto"
    FROM "dispatch_lines" l
    JOIN "dispatches" x ON x."id" = l."dispatch_id" AND x."deleted_at" IS NULL
)
UPDATE "packing_entries" p
   SET "dispatch_id" = d."dispatch_id"
  FROM e
  JOIN d ON d."order_id" = e."order_id"
        AND d."style_id" = e."style_id"
        AND e."before" >= d."upto" - d."pcs"
        AND e."before" < d."upto"
 WHERE p."id" = e."id";
