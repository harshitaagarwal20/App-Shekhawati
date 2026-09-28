-- ===========================================================================
--  A STYLE'S COLOUR AND ITS CARTON QUANTITY STOP BEING A SENTENCE IN REMARKS
-- ===========================================================================
--
--  Every row of the buyer's requirement sheets carried the same four facts
--  packed into the free-text Remarks column:
--
--      Fabric: 10 oz Fabric; Color: Natural; Qty/ctn: 200;
--      Source: TWA03 Requirement Sheet 14.07.2022
--
--  Two of the four had nowhere else to go.
--
--  COLOUR. A colour already exists on the BOM line and on the order line, and
--  this is neither of those. The buyer numbers a colourway as its own style -
--  TP-0007-008 is the Natural pouch, TP-0007-009 the Black one - so the colour
--  is part of what the style number identifies, decided when the style is
--  registered rather than when a material or an order is written. Held in a
--  remark, nothing could filter, group or search by it.
--
--  QTY/CTN. How many finished pieces go in one export carton. This is a
--  SPECIFICATION THE BUYER STATES PER STYLE, in the same way the utilisation
--  per piece is, and the column does NOT open a packing module: there is still
--  no packing list, no carton row and no packed quantity anywhere in this
--  system. It is recorded here so that whoever eventually builds packing reads
--  the figure off the style instead of re-parsing a sentence.
--
--  The other two stay in Remarks and are right to: "10 oz Fabric" is the
--  FABRIC BOM LINE's sub-category and belongs on the grid, not on the header,
--  and the source sheet with its date is provenance - exactly what a remark is
--  for.
--
--  Both columns are NULLABLE. Most styles already on file have neither, and
--  backfilling a colour by guessing at a description is how a wrong colourway
--  reaches a purchase order.
-- ===========================================================================

ALTER TABLE "styles"
  ADD COLUMN "color_code" VARCHAR(60),
  ADD COLUMN "qty_per_carton" INTEGER;

-- Zero pieces per carton is not a specification anybody means; it is an empty
-- cell that was coerced. Absent says "the buyer has not stated it" honestly.
ALTER TABLE "styles"
  ADD CONSTRAINT "styles_qty_per_carton_positive"
  CHECK ("qty_per_carton" IS NULL OR "qty_per_carton" > 0);

CREATE INDEX "styles_color_code_idx" ON "styles"("color_code");

-- ===========================================================================
--  THE COLOURWAYS THE REQUIREMENT SHEETS ACTUALLY NAME
-- ===========================================================================
--
--  L_ColorCode held eight cloth colours and nine hardware finishes. The buyer's
--  sheets name twenty-six colourways, and `assertValueInList` is an exact
--  match - so without these the style file is refused whole rather than
--  row by row (import.service.js rule 1). Colours are data, so they belong in a
--  migration rather than in a code change nobody can see.
--
--  The spellings are the SHEET'S OWN WORDS, cased. Nothing is re-worded here:
--  "Olive" is not folded into the existing "Olive Green" and "Navy" is not
--  folded into "Navy Blue", because merging two colour names on a guess is how
--  the wrong cloth gets bought. If the office decides they are the same
--  colour, that is a RENAME, and it belongs on the Master Lists screen which
--  knows the difference (see the note in import.service.js).
--
--  "Sand Gbeige" is left exactly as the sheet writes it, for the same reason.
--  It reads like a typo for Sand Beige and it may well be one - but this
--  migration is not the place to decide that on the office's behalf.
--
--  Sort orders start at 300 so the seeded colours and the 200-series finishes
--  keep the order they have.
-- ===========================================================================

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active",
                                  "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", v."value", v."sort", TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
  JOIN (VALUES
        ('Black', 300), ('White', 305), ('Red', 310), ('Pink', 315),
        ('Vivid Pink', 320), ('Smoke Pink', 325), ('Purple', 330),
        ('Orange', 335), ('Mustard', 340), ('Olive', 345),
        ('Dark Green', 350), ('Wine Red', 355), ('Sand Gbeige', 360),
        ('Sky Gray', 365), ('Light Blue', 370), ('Royal Blue', 375),
        ('Navy', 380), ('Mid Night Blue', 385), ('Turquoise Blue', 390),
        ('Smoke Blue', 395), ('Vintage Blue', 400), ('Wash Blue', 405),
        ('Indigo', 410)
       ) AS v("value", "sort") ON TRUE
 WHERE l."code" = 'ColorCode'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e
      WHERE e."list_id" = l."id" AND e."value" = v."value"
   );
