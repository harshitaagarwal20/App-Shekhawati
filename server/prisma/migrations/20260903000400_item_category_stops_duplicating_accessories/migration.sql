-- ===========================================================================
--  ITEM CATEGORY STOPS DUPLICATING ACCESSORIES ITEM
-- ===========================================================================
--
--  L_ItemCategory offered Handle, Zipper, Label, Thread and Button. So does
--  L_AccessoriesItem. The same black zipper could therefore be recorded as
--
--      ("Zipper",      sub "", item "",       colour Black, ... )
--      ("Accessories", sub "", item "Zipper", colour Black, ... )
--
--  and inventory_item_identity - (item_category, sub_category,
--  accessories_item, color_code, gsm, count, uom) - treats those as two
--  different items. Two stock rows for one physical thing: two balances, two
--  reorder levels, two ledgers, and no complaint from anywhere, because
--  categoryOf() resolves all five onto ACCESSORIES regardless.
--
--  A second, quieter one: isAccessoryLine() is `item === 'Accessories' ||
--  accessoriesItem`, so a line filed under "Zipper" with no accessories item
--  took the GENERAL 3% excess ceiling instead of the accessories 1%.
--
--  WHY NOW COSTS NOTHING
--
--  Every accessory in this database is already ("Accessories" + an item):
--  Woven Label, Cotton Handle, Zipper. Not one row uses the five being
--  withdrawn, so there is no data to migrate - which stops being true the
--  first time somebody picks one.
--
--  SOFT deleted, and categoryOf() keeps its mappings for all five. A document
--  raised before today may name one, and a value that can no longer be picked
--  still has to be readable.
-- ===========================================================================

UPDATE "master_list_values" v
   SET "deleted_at" = CURRENT_TIMESTAMP,
       "is_active"  = FALSE,
       "updated_at" = CURRENT_TIMESTAMP
  FROM "master_lists" l
 WHERE v."list_id" = l."id"
   AND l."code" = 'ItemCategory'
   AND v."value" IN ('Handle', 'Zipper', 'Label', 'Thread', 'Button')
   AND v."deleted_at" IS NULL;
