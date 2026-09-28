-- ===========================================================================
--  THE BILL OF MATERIALS CAN DESCRIBE SOMETHING THAT IS NOT CLOTH
-- ===========================================================================
--
--  A style's BOM line was identified by the fabric columns - sub-category,
--  GSM, count, construction. Most of a bag is not cloth, and the office's own
--  Style Master separates its lines by a measurement none of those columns can
--  hold: 25 mm and 20 mm pullers, 1.25" and 1.5" webbing, thread on a
--  5/1000 mtr cone and on a 2000 yard one.
--
--  Those rows were indistinguishable. `variant` is where the measurement goes.
--  Free text, because the values arrive in the buyer's notation and a dropdown
--  per material family would have to be invented and then re-typed into.
-- ===========================================================================

ALTER TABLE "style_bom_lines" ADD COLUMN "variant" VARCHAR(60);

-- ===========================================================================
--  THE DROPDOWNS THE OFFICE'S OWN SHEET USES
-- ===========================================================================
--
--  L_AccessoriesItem held nine values and none of the trim this business
--  actually buys; L_UOM had no unit thread or webbing is sold in. Both are
--  data, so both belong in a migration rather than in a code change nobody
--  can see. Sort orders start at 100 so the existing values keep their order.
-- ===========================================================================

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active",
                                  "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", v."value", v."sort", TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
  JOIN (VALUES
        ('Puller', 100), ('Newar / Webbing', 110), ('Dori', 120),
        ('Adjuster', 130), ('Snap Button', 140), ('Elastic Band', 150),
        ('Stamp', 160), ('Wash Care Label', 170), ('Eco Label', 180),
        ('Insulation Sheet', 190)
       ) AS v("value", "sort") ON TRUE
 WHERE l."code" = 'AccessoriesItem'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e
      WHERE e."list_id" = l."id" AND e."value" = v."value"
   );

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active",
                                  "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", v."value", v."sort", TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
  JOIN (VALUES ('Cone', 100), ('Yard', 110), ('Sheet', 120)) AS v("value", "sort") ON TRUE
 WHERE l."code" = 'UOM'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e
      WHERE e."list_id" = l."id" AND e."value" = v."value"
   );

-- The finishes the sheet names, which the colour list did not carry.
INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active",
                                  "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", v."value", v."sort", TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
  JOIN (VALUES
        ('Nickel', 200), ('Antique Nickel', 210), ('Antique Gold', 220),
        ('Gunmetal', 230), ('Beige Gold', 240), ('Golden', 250),
        ('Light Gold', 260), ('Off White', 270), ('Black AS', 280)
       ) AS v("value", "sort") ON TRUE
 WHERE l."code" = 'ColorCode'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e
      WHERE e."list_id" = l."id" AND e."value" = v."value"
   );
