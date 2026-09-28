-- ===========================================================================
--  STYLE SPECS, THE PANEL LIST, AND WHAT THE CUTTING FLOOR ACTUALLY USED
-- ===========================================================================
--
--  1. The style carries the tech pack: L x W x H, gusset, handle drop, strap
--     length, closure, lining, print placement, artwork version.
--  2. The style carries its PANEL LIST (style_components): front, back,
--     gusset, handles, pocket - and how many of each one bag needs. The
--     cut-pieces receipt and the cutting issue multiply by it instead of
--     having the handle count typed, and freeze what they multiplied by.
--  3. The cutting issue freezes planned vs actual consumption at posting, so
--     cutting efficiency per style is a report rather than a calculation.
--  4. End-bits go back into stock as REMNANTS: a roll of their own at the
--     REMNANT STORE, linked to the roll they were cut from.
-- ===========================================================================

-- --- 1. Style spec sheet ----------------------------------------------------

ALTER TABLE "styles"
  ADD COLUMN "bag_length"      DECIMAL(10,2),
  ADD COLUMN "bag_width"       DECIMAL(10,2),
  ADD COLUMN "bag_height"      DECIMAL(10,2),
  ADD COLUMN "gusset_width"    DECIMAL(10,2),
  ADD COLUMN "handle_drop"     DECIMAL(10,2),
  ADD COLUMN "strap_length"    DECIMAL(10,2),
  ADD COLUMN "dimension_uom"   VARCHAR(10) NOT NULL DEFAULT 'cm',
  ADD COLUMN "closure"         VARCHAR(60),
  ADD COLUMN "lining"          VARCHAR(60),
  ADD COLUMN "print_placement" TEXT,
  ADD COLUMN "artwork_version" VARCHAR(40);

ALTER TABLE "styles"
  -- A bag is measured in one unit, and these are the two the tech packs use.
  ADD CONSTRAINT "styles_dimension_uom_known"
  CHECK ("dimension_uom" IN ('cm', 'inch')),
  -- A measurement of zero or less is an empty cell that got coerced.
  ADD CONSTRAINT "styles_dimensions_positive"
  CHECK (
    ("bag_length"   IS NULL OR "bag_length"   > 0) AND
    ("bag_width"    IS NULL OR "bag_width"    > 0) AND
    ("bag_height"   IS NULL OR "bag_height"   > 0) AND
    ("gusset_width" IS NULL OR "gusset_width" > 0) AND
    ("handle_drop"  IS NULL OR "handle_drop"  > 0) AND
    ("strap_length" IS NULL OR "strap_length" > 0)
  );

-- --- 2. The panel list ------------------------------------------------------

CREATE TYPE "StyleComponentType" AS ENUM (
  'FRONT_PANEL', 'BACK_PANEL', 'GUSSET', 'BASE', 'HANDLE', 'STRAP', 'POCKET',
  'FLAP', 'LINING', 'OTHER'
);

CREATE TABLE "style_components" (
    "id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "component_type" "StyleComponentType" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "pieces_per_bag" INTEGER NOT NULL,
    "cut_length" DECIMAL(10,2),
    "cut_width" DECIMAL(10,2),
    "bom_line_no" INTEGER,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "style_components_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "style_components_style_id_idx" ON "style_components"("style_id");
CREATE UNIQUE INDEX "style_components_style_id_line_no_key" ON "style_components"("style_id", "line_no");

ALTER TABLE "style_components"
  ADD CONSTRAINT "style_components_style_id_fkey"
  FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- A bag needs at least one of a panel it lists; forty of one is a typo.
  ADD CONSTRAINT "style_components_pieces_per_bag_range"
  CHECK ("pieces_per_bag" BETWEEN 1 AND 40),
  ADD CONSTRAINT "style_components_cut_size_positive"
  CHECK (("cut_length" IS NULL OR "cut_length" > 0) AND ("cut_width" IS NULL OR "cut_width" > 0));

-- The counts derived from it, frozen on the documents that multiplied by it.

ALTER TABLE "cut_pieces_receipts"
  ADD COLUMN "panels_per_bag"  INTEGER,
  ADD COLUMN "handles_per_bag" INTEGER,
  ADD COLUMN "panels_received" DECIMAL(18,4),
  ADD COLUMN "panel_breakdown" JSONB;

ALTER TABLE "cut_pieces_receipts"
  -- Where the style supplied the multiplier, the product is the product.
  ADD CONSTRAINT "cut_pieces_receipts_panels_follow_style"
  CHECK ("panels_per_bag" IS NULL OR "panels_received" = "pcs_received" * "panels_per_bag"),
  ADD CONSTRAINT "cut_pieces_receipts_handles_follow_style"
  CHECK ("handles_per_bag" IS NULL OR "handles_received" = "pcs_received" * "handles_per_bag");

-- --- 3 + 4. Cutting issue: remnants, efficiency, panels ----------------------

ALTER TABLE "cutting_issues"
  ADD COLUMN "remnant_qty"             DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "std_consumption_per_pc"  DECIMAL(12,4),
  ADD COLUMN "planned_consumption_qty" DECIMAL(18,4),
  ADD COLUMN "actual_consumption_qty"  DECIMAL(18,4),
  ADD COLUMN "cutting_efficiency"      DECIMAL(9,6),
  ADD COLUMN "panels_per_bag"          INTEGER,
  ADD COLUMN "handles_per_bag"         INTEGER,
  ADD COLUMN "panels_issued"           DECIMAL(18,4),
  ADD COLUMN "panel_breakdown"         JSONB;

-- The fabric equation gains its fifth term. Existing rows carry remnant 0, so
-- every one of them still satisfies the widened identity.
ALTER TABLE "cutting_issues"
  DROP CONSTRAINT "cutting_issues_remainder_reconciles";
ALTER TABLE "cutting_issues"
  ADD CONSTRAINT "cutting_issues_remainder_reconciles"
    CHECK ("issued_qty" = "consumed_qty" + "remainder_qty" + "remnant_qty" + "wastage_qty" + "fabric_damage_qty"),
  ADD CONSTRAINT "cutting_issues_remnant_non_negative"
    CHECK ("remnant_qty" >= 0),
  -- Actual consumption is what left stock for good, stated once, and is
  -- exactly the three terms that did.
  ADD CONSTRAINT "cutting_issues_actual_consumption_is_the_formula"
    CHECK ("actual_consumption_qty" IS NULL OR
           "actual_consumption_qty" = "consumed_qty" + "wastage_qty" + "fabric_damage_qty"),
  ADD CONSTRAINT "cutting_issues_efficiency_positive"
    CHECK ("cutting_efficiency" IS NULL OR "cutting_efficiency" > 0);

-- A remnant is a short roll of its own, traced to the roll it was cut from.

ALTER TABLE "fabric_rolls"
  ADD COLUMN "is_remnant"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "parent_roll_id" UUID;

CREATE INDEX "fabric_rolls_parent_roll_id_idx" ON "fabric_rolls"("parent_roll_id");

ALTER TABLE "fabric_rolls"
  ADD CONSTRAINT "fabric_rolls_parent_roll_id_fkey"
  FOREIGN KEY ("parent_roll_id") REFERENCES "fabric_rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- A remnant always names its parent; a roll with a parent is a remnant.
  ADD CONSTRAINT "fabric_rolls_remnant_has_parent"
  CHECK ("is_remnant" = ("parent_roll_id" IS NOT NULL));

-- ===========================================================================
--  THE DROPDOWNS
-- ===========================================================================

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.name, v.description, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('Closure', 'Closure', 'Style Master - how the bag closes (L_Closure)'),
    ('Lining', 'Lining', 'Style Master - what the bag is lined with (L_Lining)'),
    ('StyleComponent', 'Style Component', 'Style Master - panel names for the cutting list (L_StyleComponent)')
  ) AS v(code, name, description)
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" m WHERE m."code" = v.code);

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active",
                                  "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", v."value", v."sort", TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
  JOIN (VALUES
    ('Closure', 'Zip', 10), ('Closure', 'Magnetic Snap', 20), ('Closure', 'Snap Button', 30),
    ('Closure', 'Drawstring', 40), ('Closure', 'Velcro', 50), ('Closure', 'Buckle', 60),
    ('Closure', 'Open Top', 70),
    ('Lining', 'Unlined', 10), ('Lining', 'Cotton', 20), ('Lining', 'Polyester', 30),
    ('Lining', 'PU Coated', 40), ('Lining', 'Jute', 50),
    ('StyleComponent', 'Front Panel', 10), ('StyleComponent', 'Back Panel', 20),
    ('StyleComponent', 'Gusset', 30), ('StyleComponent', 'Base', 40),
    ('StyleComponent', 'Handle', 50), ('StyleComponent', 'Strap', 60),
    ('StyleComponent', 'Pocket', 70), ('StyleComponent', 'Flap', 80),
    ('StyleComponent', 'Lining', 90)
  ) AS v("code", "value", "sort") ON v."code" = l."code"
 WHERE NOT EXISTS (
   SELECT 1 FROM "master_list_values" e WHERE e."list_id" = l."id" AND e."value" = v."value"
 );

-- Where remnants are held. Issuable: it is not an in-process location.
INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active",
                                  "created_at", "updated_at")
SELECT gen_random_uuid(), ml."id", 'REMNANT STORE', 60, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" ml
 WHERE ml."code" = 'StockLocation'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" v WHERE v."list_id" = ml."id" AND v."value" = 'REMNANT STORE'
   );
