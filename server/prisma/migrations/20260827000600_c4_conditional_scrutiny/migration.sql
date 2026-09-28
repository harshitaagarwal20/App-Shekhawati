-- ===========================================================================
--  C4 - CONDITIONAL FABRIC SCRUTINY AND THE FABRIC CHECKING REPORT
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   "NO SCRUTINY REQUIRED" IS A COMPLETE STATE, NOT AN ABSENT ONE
--
--   Before C4 the cutting floor's FABRIC_PROCESS_COMPLETE check looked at the
--   roll: held, rejected, or still out at the vendor. It had no way to
--   distinguish "this return was within standard and needs no checking report"
--   from "this return blew through standard and the report has not been done".
--   Both looked like a roll with nothing wrong with it.
--
--   The decision is now taken once, on the RETURN, and recorded there:
--   variation_pct against the process standard, and requires_scrutiny as the
--   verdict. Fabric within standard proceeds directly and the cutting check
--   passes it. Fabric outside standard cannot be cut until a scrutiny exists,
--   and the check fails with SCRUTINY_REQUIRED_MISSING.
--
--   ---------------------------------------------------------------------------
--   WHY THE DEFECT LINES ARE A TABLE AND NOT MORE COLUMNS
--
--   fabric_scrutinies carries ONE defect_type and ONE qty_affected. A real
--   Fabric Checking Report is a list: shade variation on two rolls, a broken
--   pick on a third. Collapsing that into one row loses the per-roll quantity
--   and loses the reason a director is being asked to reject a lot.
--
--   The header columns stay - they are what the workbook prints, and
--   qty_affected is kept in step with the sum of the lines by the service -
--   and the detail lives in fabric_scrutiny_defects.
--
--   ---------------------------------------------------------------------------
--   WHY A TRIGGER AND NOT A CHECK
--
--   "REWORK or REJECT requires at least one defect line" spans two tables. No
--   CHECK constraint can see across a row boundary. The alternative to a
--   trigger is trusting application code, and rule 19 of the brief is explicit
--   that a business rule with only application validation behind it is not
--   implemented. The trigger fires on the fabric_scrutinies row, at the moment
--   a decision is locked in, which is the moment the rule bites.
--
--   BACKFILL: none. The seven existing scrutinies are all locked ACCEPT
--   decisions with no per-roll findings recorded anywhere, and manufacturing a
--   defect line for a lot somebody accepted would put a finding on the record
--   that no checker ever made. The trigger is written to leave already-locked
--   rows alone for exactly that reason.
--  ---------------------------------------------------------------------------

-- --- 1. The defect family enum and the defect lines -----------------------

CREATE TYPE "DefectCategory" AS ENUM ('DYEING', 'WEAVING', 'OTHER');

CREATE TABLE "fabric_scrutiny_defects" (
    "id" UUID NOT NULL,
    "scrutiny_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "category" "DefectCategory" NOT NULL,
    "defect_type" VARCHAR(80) NOT NULL,
    "roll_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL DEFAULT 'Mtrs',
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "fabric_scrutiny_defects_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "fabric_scrutiny_defects"
  ADD CONSTRAINT "fabric_scrutiny_defects_scrutiny_id_fkey"
  FOREIGN KEY ("scrutiny_id") REFERENCES "fabric_scrutinies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "fabric_scrutiny_defects_roll_id_fkey"
  FOREIGN KEY ("roll_id") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "fabric_scrutiny_defects_scrutiny_id_line_no_key"
  ON "fabric_scrutiny_defects"("scrutiny_id", "line_no");
CREATE INDEX "fabric_scrutiny_defects_scrutiny_id_idx" ON "fabric_scrutiny_defects"("scrutiny_id");
CREATE INDEX "fabric_scrutiny_defects_roll_id_idx" ON "fabric_scrutiny_defects"("roll_id");
CREATE INDEX "fabric_scrutiny_defects_category_idx" ON "fabric_scrutiny_defects"("category");
CREATE INDEX "fabric_scrutiny_defects_deleted_at_idx" ON "fabric_scrutiny_defects"("deleted_at");

-- A defect line with no quantity is a remark, and belongs in the remarks
-- column. A negative one is nonsense.
ALTER TABLE "fabric_scrutiny_defects"
  ADD CONSTRAINT "fabric_scrutiny_defects_qty_positive" CHECK ("qty" > 0),
  ADD CONSTRAINT "fabric_scrutiny_defects_line_no_positive" CHECK ("line_no" > 0);

-- --- 2. The return records its own scrutiny verdict ------------------------

ALTER TABLE "dyeing_receipts"
  ADD COLUMN "variation_pct" DECIMAL(9,6) NOT NULL DEFAULT 0,
  ADD COLUMN "requires_scrutiny" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "scrutiny_id" UUID;

ALTER TABLE "dyeing_receipts"
  ADD CONSTRAINT "dyeing_receipts_scrutiny_id_fkey"
  FOREIGN KEY ("scrutiny_id") REFERENCES "fabric_scrutinies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Restate the verdict on the returns that already exist. Both figures are read
-- off columns that were already on the row - shrinkage_pct is the variation,
-- and variation_flag is the verdict the sheet's own formula reached. This is a
-- copy, not a recalculation with today's rules.
UPDATE "dyeing_receipts"
   SET "variation_pct" = "shrinkage_pct",
       "requires_scrutiny" = "variation_flag";

CREATE INDEX "dyeing_receipts_requires_scrutiny_idx" ON "dyeing_receipts"("requires_scrutiny");
CREATE INDEX "dyeing_receipts_scrutiny_id_idx" ON "dyeing_receipts"("scrutiny_id");

ALTER TABLE "dyeing_receipts"
  -- The verdict and the flag are two names for one decision and may not
  -- disagree. Without this a return could report a variation inside standard
  -- and still demand a checking report, or the reverse.
  ADD CONSTRAINT "dyeing_receipts_scrutiny_matches_variation_flag"
  CHECK ("requires_scrutiny" = "variation_flag"),
  -- A scrutiny may only be attached where one was actually required.
  ADD CONSTRAINT "dyeing_receipts_scrutiny_only_when_required"
  CHECK ("scrutiny_id" IS NULL OR "requires_scrutiny");

-- --- 3. REWORK / REJECT cannot be posted without a finding ----------------

CREATE OR REPLACE FUNCTION "fabric_scrutiny_decision_needs_defects"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  found bigint;
BEGIN
  -- Only when a decision is being LOCKED IN. An unlocked scrutiny is still
  -- being written up, and refusing a half-entered form would stop a checker
  -- saving work in progress.
  IF NEW."is_locked" IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Leave rows that were already locked before this trigger existed alone.
  -- They were decided under the old rules and rewriting them is not this
  -- trigger's business; it exists to stop the NEXT one going out unevidenced.
  IF TG_OP = 'UPDATE' AND OLD."is_locked" IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW."decision" IN ('REWORK', 'REJECT') THEN
    SELECT count(*) INTO found
      FROM "fabric_scrutiny_defects"
     WHERE "scrutiny_id" = NEW."id" AND "deleted_at" IS NULL;

    IF found = 0 THEN
      RAISE EXCEPTION
        'C4: scrutiny % cannot be posted as % without at least one defect line. A rework or a rejection has to say what was found.',
        NEW."scrutiny_no", NEW."decision"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE TRIGGER "fabric_scrutinies_decision_needs_defects"
  BEFORE INSERT OR UPDATE ON "fabric_scrutinies"
  FOR EACH ROW
  EXECUTE FUNCTION "fabric_scrutiny_decision_needs_defects"();
