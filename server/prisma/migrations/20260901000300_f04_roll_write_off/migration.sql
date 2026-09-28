-- ===========================================================================
--  F-04 - A ROLL WRITTEN OFF BY A REVERSAL GIVES ITS NUMBER BACK
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   THE RULE, AND ITS ONE EXCEPTION
--
--   "A roll number is never reused" is deliberate and is stated to the user in
--   as many words: `assertRollNoAvailable()` refuses a repeat and adds "that
--   roll is deleted, but its number is never reused". Roll numbers are
--   provenance - FAB-0123 means one specific piece of cloth from one specific
--   delivery - and letting a second roll wear a dead roll's number would make
--   every ledger row that references it ambiguous.
--
--   A GRN reversal is the one case where that reasoning inverts. FAB-0123 is a
--   label PRINTED ON A PHYSICAL ROLL sitting on a rack in the store. If the
--   receipt that booked it in said 1,000 metres when the roll holds 100, the
--   reversal writes the roll RECORD off - but the cloth has not moved and the
--   label has not changed. Re-keying the receipt correctly has to be able to
--   say FAB-0123.
--
--   Refusing leaves the storeman holding a roll they cannot enter under its own
--   number, and their only way out is to invent one - which is a worse lie
--   than the one the reversal was raised to correct.
--
--   Without this migration the whole correction path stops one step short: the
--   reversal posts, the stock comes back out, and then the re-entry fails on
--   `fabric_rolls_roll_no_key`.
--
--  ---------------------------------------------------------------------------
--   WHY A NEW COLUMN AND NOT `deleted_at`
--
--   Conditioning the index on `deleted_at IS NULL` would have been one line and
--   would have freed the number of EVERY soft-deleted roll, quietly repealing
--   the rule above for every other reason a roll gets deleted.
--
--   `written_off_at` says the narrower thing: this roll record was undone by a
--   reversal, so its label is back in circulation. Both are set together by the
--   reversal - the soft delete takes the row out of every live-roll query, the
--   write-off stamp releases the number - and nothing else in the application
--   ever sets it.
--
--  ---------------------------------------------------------------------------
--   NO BACKFILL
--
--   `written_off_at` is NULL for every existing roll, which is correct: none of
--   them was written off by a reversal, because until now there were none.
-- ===========================================================================

ALTER TABLE "fabric_rolls"
  ADD COLUMN IF NOT EXISTS "written_off_at" TIMESTAMPTZ(3);

ALTER TABLE "fabric_rolls"
  -- A write-off is a soft delete with a reason. The reversal sets both in one
  -- update; this stops any other path setting one without the other and
  -- leaving a live roll whose number is somehow also free.
  ADD CONSTRAINT "fabric_rolls_written_off_is_deleted"
    CHECK ("written_off_at" IS NULL OR "deleted_at" IS NOT NULL),
  -- Nothing is left on a roll that was never received in the first place.
  ADD CONSTRAINT "fabric_rolls_written_off_is_empty"
    CHECK ("written_off_at" IS NULL OR "balance_qty" = 0);

CREATE INDEX IF NOT EXISTS "fabric_rolls_written_off_at_idx"
  ON "fabric_rolls"("written_off_at");

-- ---------------------------------------------------------------------------
--  The uniqueness, re-scoped.
--
--  Dropped and replaced rather than altered: a partial index is a different
--  index, and the old one is precisely what refuses the re-entry.
--
--  A plain index on roll_no stays behind it, because the unique index no
--  longer covers every row and lookups by roll number - which is how the store
--  finds a roll - must still be planned.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "fabric_rolls_roll_no_key";

CREATE UNIQUE INDEX IF NOT EXISTS "fabric_rolls_live_roll_no"
  ON "fabric_rolls"("roll_no")
  WHERE "written_off_at" IS NULL;

CREATE INDEX IF NOT EXISTS "fabric_rolls_roll_no_idx" ON "fabric_rolls"("roll_no");
