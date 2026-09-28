-- ===========================================================================
--  STATIONERY - office consumables on a purchase order
-- ===========================================================================
--
--  Pens, registers, printer paper. None of it belongs to a style, so none of
--  it fits FABRIC / ACCESSORIES / PACKAGING - filing it under one of those
--  would judge a ream of paper by a fabric tolerance. It gets its own
--  commercial category, and with no explicit tolerance_rules row it falls back
--  to the approved excess rules like every other category without one.
--
--  The article itself (Pen, Register) is chosen from L_StationeryItem and
--  stored in `sub_category`, the column that already carries "which one" for
--  fabric. Inventory identity is keyed on it, so each article keeps its own
--  balance.
--
--  Every statement is idempotent, so a database that already carries the
--  category or the list is left as it is and only gains what it lacks.
-- ===========================================================================

ALTER TYPE "ItemCategory" ADD VALUE IF NOT EXISTS 'STATIONERY';

-- ---- L_ItemCategory gains "Stationery" -----------------------------------
INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", 'Stationery',
       COALESCE((SELECT MAX(v."sort_order") FROM "master_list_values" v WHERE v."list_id" = l."id"), 0) + 10,
       TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
 WHERE l."code" = 'ItemCategory'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e WHERE e."list_id" = l."id" AND e."value" = 'Stationery'
   );

-- Brought back if it was ever added and removed by hand.
UPDATE "master_list_values" v
   SET "deleted_at" = NULL, "is_active" = TRUE, "updated_at" = CURRENT_TIMESTAMP
  FROM "master_lists" l
 WHERE v."list_id" = l."id" AND l."code" = 'ItemCategory' AND v."value" = 'Stationery'
   AND (v."deleted_at" IS NOT NULL OR v."is_active" = FALSE);

-- ---- L_StationeryItem ------------------------------------------------------
INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'StationeryItem', 'Stationery Item',
       'PO - the stationery article, shown only when Item = Stationery (Pen, Register, A4 Paper)',
       TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = 'StationeryItem');

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", t.value, t.ord * 10, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
 CROSS JOIN (VALUES
   ('Pen', 1), ('Pencil', 2), ('Marker', 3), ('Register', 4), ('A4 Paper', 5),
   ('File / Folder', 6), ('Stapler', 7), ('Stapler Pins', 8), ('Tape', 9), ('Printer Toner', 10)
 ) AS t(value, ord)
 WHERE l."code" = 'StationeryItem'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e WHERE e."list_id" = l."id" AND e."value" = t.value
   );
