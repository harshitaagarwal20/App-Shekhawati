-- ===========================================================================
--  CONTAINER NO ON THE BUYER ORDER AND ON THE PURCHASE ORDER
-- ===========================================================================
--
--  The planning chain - Planning, Plan Approval, Material Plan, Cutting
--  Challan, Cutting Issue - has carried `container_no` from the start, and it
--  was first TYPED at Planning. That is late: the container is booked when
--  the order is taken, and the cloth and trims are bought against it. Until
--  now the number could not be recorded at either of those two points, so a
--  planner retyped it from an email.
--
--  Free text, VarChar(40), matching every other container_no column in this
--  schema. It is deliberately NOT a master list value - see the long note in
--  planning.service.js: a container number belongs to one shipment and is
--  never used again, so a master of them could only grow into thousands of
--  dead entries with the one needed today missing from it.
--
--  Nullable with no default, so every order and every purchase order that
--  already exists is untouched and nothing downstream changes behaviour.
--  Indexed, because "what else is going in MSKU7654321" is the question these
--  columns exist to answer.
-- ===========================================================================

ALTER TABLE "buyer_orders" ADD COLUMN "container_no" VARCHAR(40);
CREATE INDEX "buyer_orders_container_no_idx" ON "buyer_orders"("container_no");

ALTER TABLE "purchase_orders" ADD COLUMN "container_no" VARCHAR(40);
CREATE INDEX "purchase_orders_container_no_idx" ON "purchase_orders"("container_no");

-- The document header carries the default for its lines, as `order_id` does.
ALTER TABLE "purchase_order_headers" ADD COLUMN "container_no" VARCHAR(40);
CREATE INDEX "purchase_order_headers_container_no_idx" ON "purchase_order_headers"("container_no");
