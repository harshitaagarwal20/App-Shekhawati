-- ===========================================================================
--  REPAIR - ONE LEDGER ROW LOST TO AN OVER-BROAD TEST CLEANUP
-- ===========================================================================
--
--  WHAT HAPPENED
--
--  An early version of test/c2-c9.e2e.test.js cleaned up after itself with
--
--      DELETE FROM stock_ledger WHERE document_no LIKE 'E2E%' OR remarks LIKE '%E2E%'
--
--  The second clause is far too wide a net for an append-only table: `remarks`
--  is free text written by every posting path in the system. It matched, and
--  deleted, the receipt entry for GRN-008 - 900 Mtrs of ITM-0100 - which the
--  test did not create and had no business touching.
--
--  The test's cleanup has since been narrowed to document numbers only and can
--  no longer reach a row it did not write. This migration puts the row back.
--
--  ---------------------------------------------------------------------------
--   WHY WRITING TO AN APPEND-ONLY LEDGER IS THE RIGHT REPAIR HERE
--
--   The ledger is append-only because entries record events, and events do not
--   un-happen. That principle is exactly why this row has to be restored rather
--   than written off: the receipt DID happen. GRN-008 is still in the database
--   and still says 900 Mtrs arrived on 2026-09-04 at a rate of 150 into MAIN
--   STORE. What was lost was the ledger's record of it, not the fact.
--
--   Every value below is READ FROM THE GRN ROW ITSELF. Nothing is estimated,
--   and the migration refuses if the GRN is missing or if a ledger entry for it
--   already exists.
--
--   THE ROLL LINK CANNOT BE RESTORED, AND THE ROW SAYS SO.
--
--   The same deletion took GRN-008's fabric rolls with it, and the GRN's own
--   `roll_no` is null (it was a multi-roll receipt, so the service never stored
--   a single number on the header). Which rolls they were is not recoverable
--   from anything still in the database.
--
--   So `roll_id` is left NULL and the remark states plainly that roll-level
--   traceability for this receipt was lost and how. A quantity that is right
--   with a disclosed gap in its provenance is honest; a quantity that is right
--   with an invented roll number attached to it is not.
--
--   TO RESTORE THE ROLLS AS WELL: re-seed the database (`npm run db:reset`),
--   which rebuilds GRN-008 and its rolls exactly as designed. That destroys all
--   data and is the office's call, not this migration's.
--  ---------------------------------------------------------------------------

DO $do$
DECLARE
  g            RECORD;
  already      bigint;
  running      numeric;
BEGIN
  SELECT "id", "grn_no", "grn_date", "receiving_qty", "inventory_rate",
         "inventory_item_id", "location", "purchase_order_id"
    INTO g
    FROM "grns"
   WHERE "grn_no" = 'GRN-008' AND "deleted_at" IS NULL;

  -- Nothing to repair on a database that never had this receipt - a freshly
  -- seeded one, for instance, where the row is already correct.
  IF g."id" IS NULL THEN
    RAISE NOTICE 'GRN-008 is not present; nothing to repair.';
    RETURN;
  END IF;

  SELECT count(*) INTO already
    FROM "stock_ledger"
   WHERE "document_type" = 'GRN' AND "document_id" = g."id";

  IF already > 0 THEN
    RAISE NOTICE 'GRN-008 already has % ledger entry(ies); nothing to repair.', already;
    RETURN;
  END IF;

  IF g."inventory_item_id" IS NULL THEN
    RAISE EXCEPTION
      'GRN-008 names no inventory item, so the lost movement cannot be reconstructed without inventing one. Re-seed instead.';
  END IF;

  -- The balance this entry brings the (item, location) to, derived from the
  -- movements that survive rather than assumed to be the receipt quantity.
  SELECT COALESCE(SUM("qty_in") - SUM("qty_out"), 0) INTO running
    FROM "stock_ledger"
   WHERE "item_id" = g."inventory_item_id" AND "location" = g."location";

  INSERT INTO "stock_ledger" (
    "id", "entry_date", "item_id", "roll_id", "location",
    "item_category", "color_code", "gsm", "content", "uom",
    "order_id", "document_type", "document_id", "document_no",
    "direction", "qty", "qty_in", "qty_out", "rate", "value", "balance_qty",
    "grn_id", "remarks", "created_at", "created_by_name"
  )
  SELECT
    gen_random_uuid(), g."grn_date", g."inventory_item_id",
    -- Not recoverable. See the note above.
    NULL,
    g."location",
    i."item_category", i."color_code", i."gsm", i."content", i."uom",
    po."order_id", 'GRN', g."id", g."grn_no",
    'IN', g."receiving_qty", g."receiving_qty", 0,
    g."inventory_rate",
    ROUND(g."receiving_qty" * g."inventory_rate", 2),
    running + g."receiving_qty",
    g."id",
    'REPAIRED 2026-08-29. This receipt entry was deleted in error by an over-broad '
      || 'cleanup in test/c2-c9.e2e.test.js (it matched on remarks text). Every figure here is '
      || 'read from GRN-008 itself. The roll link could NOT be recovered - the same deletion '
      || 'removed this receipt''s fabric rolls and the GRN carries no single roll number - so '
      || 'roll-level traceability for this receipt is lost. Re-seed to restore it fully.',
    CURRENT_TIMESTAMP,
    'System repair'
  FROM "inventory_items" i
  LEFT JOIN "purchase_orders" po ON po."id" = g."purchase_order_id"
  WHERE i."id" = g."inventory_item_id";

  RAISE NOTICE 'Restored the GRN-008 receipt of % into %.', g."receiving_qty", g."location";
END
$do$;
