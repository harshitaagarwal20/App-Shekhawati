-- ===========================================================================
--  "PACKAGING MATERIAL" LEAVES THE ITEM CATEGORY DROPDOWN
-- ===========================================================================
--
--  SOFT deleted, not removed. One style_bom_lines row still names it, and
--  itemCategory on that row is the text that was chosen, not a foreign key -
--  deleting the list value would leave the row reading "Packaging Material"
--  with nothing in the master to explain where it came from. MasterSelect
--  already handles this: a value a record holds but the list no longer offers
--  is shown, marked inactive, rather than silently blanking the field.
--
--  WHAT IS DELIBERATELY LEFT ALONE
--
--    ItemCategory.PACKAGING   the enum value. It is one of the three
--                             commercial categories every tolerance is keyed
--                             on, and dropping it would be a schema change
--                             reaching into rules this request did not ask
--                             about.
--    categoryOf()             still maps "packaging material" and "packaging"
--                             onto PACKAGING, so the one existing row and any
--                             historical document still resolve. A mapping for
--                             a value nobody can pick any more costs nothing;
--                             removing it would make that row unreadable.
--
--  Nothing else referenced it: no inventory item, no purchase order, no
--  tolerance rule.
-- ===========================================================================

UPDATE "master_list_values" v
   SET "deleted_at" = CURRENT_TIMESTAMP,
       "is_active"  = FALSE,
       "updated_at" = CURRENT_TIMESTAMP
  FROM "master_lists" l
 WHERE v."list_id" = l."id"
   AND l."code" = 'ItemCategory'
   AND v."value" = 'Packaging Material'
   AND v."deleted_at" IS NULL;
