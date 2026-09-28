-- ===========================================================================
--  ACCESSORY VARIETY - which Button, which Zipper, as a dropdown
-- ===========================================================================
--
--  20260918000300 gave the quotation and the PO a free-text "accessory type".
--  That recorded WHICH button on the paperwork, but nowhere else: the Style BOM
--  could only say "Button", and the stock item was keyed without it, so 18L
--  horn buttons and 24L metal buttons in one colour landed on ONE balance.
--
--  The variety is now a List Master value (AccessoryVariety), each tagged with
--  the accessories item it belongs to in `attributes.item`, and it travels
--  BOM -> material plan, and quotation -> PO -> GRN -> stock item.
--
--  The column keeps the name `accessory_type` so the quotation and PO columns
--  that already exist are the same field, not a second one beside them.
-- ===========================================================================

ALTER TABLE "style_bom_lines"        ADD COLUMN "accessory_type" VARCHAR(120);
ALTER TABLE "material_plan_lines"    ADD COLUMN "accessory_type" VARCHAR(120);
ALTER TABLE "style_cost_sheet_lines" ADD COLUMN "accessory_type" VARCHAR(120);

-- Empty string, not NULL, as for every other identity column: a UNIQUE index
-- treats two NULLs as distinct and would let the same item be created twice.
-- Stock already on hand gets '' - it was received without a variety, and its
-- balance cannot be split after the fact.
ALTER TABLE "inventory_items" ADD COLUMN "accessory_type" VARCHAR(120) NOT NULL DEFAULT '';

DROP INDEX "inventory_items_item_category_sub_category_accessories_item_key";
CREATE UNIQUE INDEX "inventory_items_item_category_sub_category_accessories_item_key"
    ON "inventory_items"("item_category", "sub_category", "accessories_item", "accessory_type",
                         "color_code", "gsm", "count", "uom");

-- ===========================================================================
--  THE LIST
-- ===========================================================================

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'AccessoryVariety', 'Accessory Variety',
       'Which kind of an accessories item - Button: 4-hole horn 18L. Each value belongs to one item.',
       TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = 'AccessoryVariety');

-- Seeded from what the office has ALREADY typed on quotations and POs, so the
-- varieties in use are in the dropdown on day one and every existing document
-- still holds a listed value. A wording used under two items goes to the item
-- it was used under most; the list keys values by text alone.
INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active",
                                  "attributes", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", t.accessory_type,
       (ROW_NUMBER() OVER (ORDER BY t.accessories_item, t.accessory_type))::int * 10,
       TRUE, jsonb_build_object('item', t.accessories_item), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
 CROSS JOIN (
   SELECT DISTINCT ON (u.accessory_type) u.accessory_type, u.accessories_item
     FROM (
       SELECT TRIM("accessory_type") AS accessory_type, "accessories_item"
         FROM "purchase_orders"
        WHERE "deleted_at" IS NULL
       UNION ALL
       SELECT TRIM("accessory_type"), "accessories_item"
         FROM "vendor_quotations"
        WHERE "deleted_at" IS NULL
     ) u
    WHERE COALESCE(u.accessory_type, '') <> '' AND COALESCE(u.accessories_item, '') <> ''
    GROUP BY u.accessory_type, u.accessories_item
    ORDER BY u.accessory_type, COUNT(*) DESC, u.accessories_item
 ) t
 WHERE l."code" = 'AccessoryVariety'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e
      WHERE e."list_id" = l."id" AND e."value" = t.accessory_type
   );
