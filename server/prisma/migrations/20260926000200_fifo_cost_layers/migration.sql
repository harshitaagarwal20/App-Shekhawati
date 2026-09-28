-- ===========================================================================
--  FIFO STOCK VALUATION
-- ===========================================================================
--
--  The costing policy is FIRST IN, FIRST OUT. See
--  docs/STOCK-VALUATION-POLICY.md for the policy in full.
--
--  stock_cost_layers         one row per receipt of cost: what came in, at
--                            what rate, and how much of it is still on hand.
--  stock_layer_consumptions  which layers each OUT movement consumed, at what
--                            cost - the explanation of every OUT row's value.
--
--  THE CUT-OVER. Until today stock was valued at the weighted average of
--  everything ever received at an (item, location). This migration opens ONE
--  layer per (item, location) holding stock, for exactly the quantity on hand,
--  at exactly that weighted average - so every balance's value is unchanged by
--  the switch, and from here on each movement is costed FIFO.
--
--  THE LEDGER IS NOT REWRITTEN. Movements before today keep the values they
--  were posted with. An append-only ledger that re-costs its own history is
--  not append-only; the opening layers are marked `is_opening` so the cut-over
--  can always be seen.
-- ===========================================================================

CREATE TABLE "stock_cost_layers" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location" VARCHAR(80) NOT NULL,
    "roll_id" UUID,
    "layer_date" DATE NOT NULL,
    "source_ledger_id" UUID,
    "source_document_no" VARCHAR(60) NOT NULL,
    "qty_in" DECIMAL(18,4) NOT NULL,
    "qty_remaining" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "is_opening" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_cost_layers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_layer_consumptions" (
    "id" UUID NOT NULL,
    "layer_id" UUID NOT NULL,
    "ledger_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_layer_consumptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_cost_layers_item_id_location_layer_date_idx" ON "stock_cost_layers"("item_id", "location", "layer_date");
CREATE INDEX "stock_cost_layers_source_ledger_id_idx" ON "stock_cost_layers"("source_ledger_id");
CREATE INDEX "stock_cost_layers_roll_id_idx" ON "stock_cost_layers"("roll_id");
CREATE INDEX "stock_layer_consumptions_layer_id_idx" ON "stock_layer_consumptions"("layer_id");
CREATE INDEX "stock_layer_consumptions_ledger_id_idx" ON "stock_layer_consumptions"("ledger_id");

-- Only the layers still holding stock are ever read by an issue.
CREATE INDEX "stock_cost_layers_open_idx" ON "stock_cost_layers"("item_id", "location", "layer_date")
  WHERE "qty_remaining" > 0;

ALTER TABLE "stock_cost_layers"
  ADD CONSTRAINT "stock_cost_layers_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_cost_layers_source_ledger_id_fkey"
  FOREIGN KEY ("source_ledger_id") REFERENCES "stock_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- A layer can be drawn down to nothing and no further, and never above what
  -- came in. postMovement() decrements rather than writing an absolute, so an
  -- over-consumption is refused here instead of being overwritten.
  ADD CONSTRAINT "stock_cost_layers_remaining_in_range"
  CHECK ("qty_remaining" >= 0 AND "qty_remaining" <= "qty_in"),
  ADD CONSTRAINT "stock_cost_layers_qty_in_positive" CHECK ("qty_in" > 0),
  ADD CONSTRAINT "stock_cost_layers_rate_non_negative" CHECK ("rate" >= 0),
  -- Every layer but an opening one was opened by a movement.
  ADD CONSTRAINT "stock_cost_layers_source_or_opening"
  CHECK ("is_opening" OR "source_ledger_id" IS NOT NULL);

ALTER TABLE "stock_layer_consumptions"
  ADD CONSTRAINT "stock_layer_consumptions_layer_id_fkey"
  FOREIGN KEY ("layer_id") REFERENCES "stock_cost_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_layer_consumptions_ledger_id_fkey"
  FOREIGN KEY ("ledger_id") REFERENCES "stock_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_layer_consumptions_qty_positive" CHECK ("qty" > 0);

-- ===========================================================================
--  THE OPENING LAYERS
--
--  Quantity: the ledger's balance at the (item, location), which is what
--  stock_balances caches. Rate: the weighted average of the INs there -
--  exactly the figure recomputeBalance() used until now - so the value of
--  every balance is the same before and after this migration. Dated at the
--  earliest receipt there, so any receipt keyed later with an earlier date
--  still sorts behind the opening stock rather than jumping the queue.
-- ===========================================================================

INSERT INTO "stock_cost_layers"
  ("id", "item_id", "location", "roll_id", "layer_date", "source_ledger_id", "source_document_no",
   "qty_in", "qty_remaining", "rate", "is_opening", "created_at")
SELECT gen_random_uuid(),
       t."item_id",
       t."location",
       NULL,
       t."first_in",
       NULL,
       'OPENING',
       t."on_hand",
       t."on_hand",
       CASE WHEN t."in_qty" > 0 THEN ROUND(t."in_value" / t."in_qty", 4) ELSE 0 END,
       TRUE,
       CURRENT_TIMESTAMP
  FROM (
    SELECT "item_id",
           "location",
           SUM("qty_in") - SUM("qty_out")                              AS "on_hand",
           SUM(CASE WHEN "direction" = 'IN' THEN "qty" ELSE 0 END)     AS "in_qty",
           SUM(CASE WHEN "direction" = 'IN' THEN "value" ELSE 0 END)   AS "in_value",
           COALESCE(MIN(CASE WHEN "direction" = 'IN' THEN "entry_date" END), CURRENT_DATE) AS "first_in"
      FROM "stock_ledger"
     GROUP BY "item_id", "location"
  ) t
 WHERE t."on_hand" > 0;

-- The cache now reads its value from the layers. Refreshed here so a balance
-- read before the next movement already agrees with them.
UPDATE "stock_balances" b
   SET "avg_rate" = l."rate",
       "value"    = ROUND(b."qty" * l."rate", 2)
  FROM "stock_cost_layers" l
 WHERE l."is_opening"
   AND l."item_id" = b."item_id"
   AND l."location" = b."location";
