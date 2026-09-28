-- ===========================================================================
--  A BUYER ORDER CARRIES ITS PRICE
-- ===========================================================================
--
--  Until now an order said how many pieces and never for how much, so the
--  order book had no value, no margin could be read against a cost sheet, and
--  nothing matched the order to the buyer's own PO. These columns add the
--  commercial side WITHOUT touching anything structural: a price does not
--  change what gets cut or bought.
--
--  Everything is NULLABLE. Orders already on file have no price, and a price
--  backfilled by guess is worse than an honest blank. `order_value` stays
--  NULL until every line is priced - a partial sum would read as the whole.
-- ===========================================================================

ALTER TABLE "buyer_orders"
  ADD COLUMN "buyer_po_no"     VARCHAR(60),
  ADD COLUMN "buyer_po_date"   DATE,
  ADD COLUMN "ex_factory_date" DATE,
  ADD COLUMN "price_terms"     VARCHAR(150),
  ADD COLUMN "payment_terms"   VARCHAR(150),
  ADD COLUMN "exchange_rate"   DECIMAL(18, 6),
  ADD COLUMN "order_value"     DECIMAL(18, 2),
  ADD COLUMN "order_value_inr" DECIMAL(18, 2);

ALTER TABLE "buyer_order_lines"
  ADD COLUMN "unit_price" DECIMAL(18, 4),
  ADD COLUMN "line_value" DECIMAL(18, 2);

ALTER TABLE "buyer_orders"
  ADD CONSTRAINT "buyer_orders_exchange_rate_positive"
  CHECK ("exchange_rate" IS NULL OR "exchange_rate" > 0),
  ADD CONSTRAINT "buyer_orders_order_value_non_negative"
  CHECK ("order_value" IS NULL OR "order_value" >= 0);

-- A price of zero is a sample or a free replacement and is allowed; a
-- negative one is a typing error. The value is qty x price and follows it.
ALTER TABLE "buyer_order_lines"
  ADD CONSTRAINT "buyer_order_lines_unit_price_non_negative"
  CHECK ("unit_price" IS NULL OR "unit_price" >= 0),
  ADD CONSTRAINT "buyer_order_lines_value_follows_price"
  CHECK (("unit_price" IS NULL) = ("line_value" IS NULL));

CREATE INDEX "buyer_orders_ex_factory_date_idx" ON "buyer_orders"("ex_factory_date");
CREATE INDEX "buyer_orders_buyer_po_no_idx" ON "buyer_orders"("buyer_po_no");
