-- ===========================================================================
--  NEEDLE CHECKING - CARTON NUMBERS ARE STORED
-- ===========================================================================
--
--  "Carton" (1-5, 6-8 ...) was worked out from the rows in order every time
--  the sheet was read, so deleting a row renumbered every row after it -
--  cartons already labelled 11-15 would read 6-10. Each row now keeps the
--  numbers it was given.
--
--  Every live row keeps the numbers it shows today.
-- ===========================================================================

ALTER TABLE "needle_check_cartons" ADD COLUMN "carton_from" INTEGER;
ALTER TABLE "needle_check_cartons" ADD COLUMN "carton_to" INTEGER;

UPDATE "needle_check_cartons" AS c
   SET "carton_to" = r."run_to",
       "carton_from" = r."run_to" - c."carton_qty" + 1
  FROM (
    SELECT "id",
           SUM("carton_qty") OVER (PARTITION BY "order_id", "style_id" ORDER BY "seq") AS "run_to"
      FROM "needle_check_cartons"
     WHERE "deleted_at" IS NULL
  ) AS r
 WHERE c."id" = r."id";
