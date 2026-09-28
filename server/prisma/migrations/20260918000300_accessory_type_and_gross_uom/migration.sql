-- ===========================================================================
--  ACCESSORY TYPE - what kind of Button, Zipper, Handle it is
-- ===========================================================================
--
--  "Accessories Item" says Button; the office also needs to say which button
--  ("4-hole horn, 18L"). Free text, because the types arrive in the buyer's
--  wording. Typed on the PO (and the Vendor Quotation).
-- ===========================================================================

ALTER TABLE "vendor_quotations"  ADD COLUMN "accessory_type" VARCHAR(120);
ALTER TABLE "purchase_orders"    ADD COLUMN "accessory_type" VARCHAR(120);

-- ===========================================================================
--  GRUSE (gross) - 144 pieces - for buttons and similar trim bought by the gross
-- ===========================================================================

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active",
                                  "attributes", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", 'Gruse', 130, TRUE, '{"pieces": 144}'::jsonb,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
 WHERE l."code" = 'UOM'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e
      WHERE e."list_id" = l."id" AND e."value" = 'Gruse'
   );
