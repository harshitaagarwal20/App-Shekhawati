-- ===========================================================================
--  PO SIZE - the size the vendor must supply, printed on the purchase order
-- ===========================================================================
--
--  Free text ("18L", "20 cm", "12 x 16"): it is read by the vendor as written.
--  Nullable, so every existing PO is untouched.
-- ===========================================================================

ALTER TABLE "purchase_orders" ADD COLUMN "size" TEXT;
