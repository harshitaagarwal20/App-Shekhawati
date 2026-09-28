-- ===========================================================================
--  AN INWARD GATE PASS IS RAISED AT THE GATE AND ALLOCATED AFTERWARDS
-- ===========================================================================
--
--  WHAT WAS WRONG
--
--  A gate pass could not be written without naming the document it answered -
--  `linked_doc_no` was NOT NULL, and item, quantity, UOM and purpose were all
--  copied from that document and NOT NULL with it.
--
--  That is the wrong order for goods coming IN. The checker at the gate knows
--  two things for certain - who delivered, and when - and is in no position to
--  find a purchase order number with a lorry standing in front of him. So the
--  pass was either written up later from memory, which is what
--  `movement_time` exists to correct, or a plausible-looking document number
--  was typed to get past the field.
--
--  WHAT CHANGES
--
--  An INWARD pass may now be raised naming only the vendor and the time. The
--  document is attached afterwards, by whoever matches the delivery to the
--  order, and THAT is when item, quantity, UOM and purpose are filled in - from
--  the document, exactly as they always were.
--
--  An OUTWARD pass still requires its document. Goods leaving the building
--  without a record of where they are going is a different and much worse
--  problem than a delivery that has not been matched up yet.
--
--  ---------------------------------------------------------------------------
--   NOTHING EXISTING MOVES
--
--   Every gate pass already in the database names its document and carries its
--   quantities, so all of them are already allocated. This migration only
--   RELAXES columns to nullable and adds the allocation stamp; it writes no
--   row. `allocated_at` is backfilled from `created_at` for exactly that
--   reason - those passes were allocated at the moment they were created, and
--   leaving the stamp null would put every one of them on the "not yet
--   allocated" list.
--
--   THE CHECK CONSTRAINTS ARE REPLACED, NOT DROPPED
--
--   `gate_passes_qty_positive` and `gate_passes_variation_is_the_formula` both
--   assumed a quantity. They are re-stated to allow NULL and to say the same
--   thing about the rows that have one, so a nonsense quantity is refused
--   exactly as before.
--  ---------------------------------------------------------------------------

-- 1. The columns the gate cannot know yet.
ALTER TABLE "gate_passes"
  ALTER COLUMN "linked_doc_no" DROP NOT NULL,
  ALTER COLUMN "item"          DROP NOT NULL,
  ALTER COLUMN "qty"           DROP NOT NULL,
  ALTER COLUMN "uom"           DROP NOT NULL,
  ALTER COLUMN "purpose"       DROP NOT NULL;

-- 2. Who matched the delivery to its document, and when.
ALTER TABLE "gate_passes"
  ADD COLUMN "allocated_at"      TIMESTAMPTZ(3),
  ADD COLUMN "allocated_by_id"   UUID,
  ADD COLUMN "allocated_by_name" VARCHAR(120);

-- Every existing pass was allocated at creation - it could not have been
-- written otherwise. Saying so keeps them off the outstanding list.
UPDATE "gate_passes"
   SET "allocated_at" = "created_at"
 WHERE "linked_doc_no" IS NOT NULL;

-- 3. The quantity rules, re-stated for a pass that has no quantity yet.
ALTER TABLE "gate_passes" DROP CONSTRAINT "gate_passes_qty_positive";
ALTER TABLE "gate_passes"
  ADD CONSTRAINT "gate_passes_qty_positive"
    CHECK ("qty" IS NULL OR "qty" > 0);

ALTER TABLE "gate_passes" DROP CONSTRAINT "gate_passes_variation_is_the_formula";
ALTER TABLE "gate_passes"
  ADD CONSTRAINT "gate_passes_variation_is_the_formula"
    CHECK (
      ("received_qty" IS NULL AND "variation_pct" = 0)
      OR ("qty" IS NOT NULL AND abs("variation_pct" - (("qty" - "received_qty") / "qty")) <= 0.000001)
    );

-- 4. An allocated pass is allocated completely.
--
--    The four columns are filled from the document together or not at all, so
--    a half-allocated pass - a document number with no quantity behind it - is
--    refused rather than left to be discovered by whatever reads it next.
ALTER TABLE "gate_passes"
  ADD CONSTRAINT "gate_passes_allocation_is_complete"
    CHECK (
      "linked_doc_no" IS NULL
      OR ("item" IS NOT NULL AND "qty" IS NOT NULL AND "uom" IS NOT NULL AND "purpose" IS NOT NULL)
    );

-- 5. A pass that names no document must at least say who delivered, and only
--    an inward pass may be in that state at all.
ALTER TABLE "gate_passes"
  ADD CONSTRAINT "gate_passes_unallocated_is_inward_and_named"
    CHECK (
      "linked_doc_no" IS NOT NULL
      OR ("type" = 'INWARD' AND ("vendor_id" IS NOT NULL OR "party_name" <> ''))
    );

-- 6. Goods cannot be booked in against nothing: a pass is allocated before it
--    is cleared, because clearing is what a GRN is raised from.
ALTER TABLE "gate_passes"
  ADD CONSTRAINT "gate_passes_cleared_is_allocated"
    CHECK ("status" <> 'CLEARED' OR "linked_doc_no" IS NOT NULL);

CREATE INDEX "gate_passes_allocated_at_idx" ON "gate_passes" ("allocated_at");
