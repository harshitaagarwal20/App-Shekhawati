-- ===========================================================================
--  C9 - MEASUREMENT SHEET / AVERAGE UTILISATION PER PIECE
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   THIS IS A RENAME, NOT A NEW COLUMN
--
--   style_bom_lines.qty_per_pc is documented in the schema as "quantity of
--   this material consumed by one finished piece". That is, word for word,
--   the average raw-material utilisation per piece C9 asks for, and it is
--   already what every requirement calculation in the system reads.
--
--   Adding avg_utilisation_per_piece BESIDE it would have left two columns
--   meaning one thing, three services free to read either, and no way to tell
--   which one a historical document was judged by. The column is renamed in
--   place instead - the same decision, for the same reason, that the C1
--   migration took with order_type -> order_mode.
--
--   The CHECK constraint that guarded it is renamed with it, so the > 0 rule
--   is never off even for the duration of this migration.
--
--   THE API STILL ACCEPTS qtyPerPc. master.validator.js takes either name and
--   normalises, so nothing calling this server from outside the repository
--   breaks on the rename.
--
--   BACKFILL FOR effective_from: the BOM line's own created_at date.
--
--   That is the day the figure entered the system and the earliest day any
--   document could have been judged by it. It is a fact on the row, not an
--   assumption about the buyer's paperwork - and because every existing
--   document is dated on or after its BOM line, every one of them still
--   resolves the same line it always did.
--  ---------------------------------------------------------------------------

-- --- 1. The rename ---------------------------------------------------------

ALTER TABLE "style_bom_lines" RENAME COLUMN "qty_per_pc" TO "avg_utilisation_per_piece";

ALTER TABLE "style_bom_lines"
  RENAME CONSTRAINT "style_bom_lines_qty_positive" TO "style_bom_lines_utilisation_positive";

-- --- 2. Guard: a utilisation of zero cannot compute a requirement ----------
--
--  C9 requires a style without utilisation to fail loudly rather than produce
--  a requirement of zero. The constraint above already enforces > 0, so this
--  can only fire if the constraint was ever disabled. It is here because a
--  migration that assumes its own invariants is how a bad row survives one.

DO $do$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad
    FROM "style_bom_lines"
   WHERE "avg_utilisation_per_piece" <= 0 AND "deleted_at" IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION
      'C9: % style BOM line(s) carry a utilisation of zero or less. A requirement cannot be computed from them and they must be corrected before migrating.', bad;
  END IF;
END
$do$;

-- --- 3. effective_from -----------------------------------------------------

ALTER TABLE "style_bom_lines" ADD COLUMN "effective_from" DATE;

UPDATE "style_bom_lines"
   SET "effective_from" = ("created_at" AT TIME ZONE 'UTC')::date
 WHERE "effective_from" IS NULL;

ALTER TABLE "style_bom_lines" ALTER COLUMN "effective_from" SET NOT NULL;

CREATE INDEX "style_bom_lines_effective_from_idx" ON "style_bom_lines"("effective_from");

-- --- 4. The buyer's measurement sheet, on the order -----------------------
--
--  Optional, and a REFERENCE rather than a blob: this system has no file
--  store, and Style.image_ref set the convention of naming the document
--  rather than holding it.

ALTER TABLE "buyer_orders"
  ADD COLUMN "measurement_sheet_ref" VARCHAR(200),
  ADD COLUMN "measurement_sheet_note" TEXT;
