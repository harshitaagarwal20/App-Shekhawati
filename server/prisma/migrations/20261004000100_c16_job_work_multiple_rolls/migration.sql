-- ===========================================================================
--  C16 - A JOB WORK ORDER COVERS SEVERAL ROLLS
-- ===========================================================================
--
--  A dyeing lot is physically several rolls: one vendor, one shade, one
--  despatch. `dye_issues.roll_id` could name exactly one, so five rolls meant
--  five job work orders, five approvals and five numbers for a single lot -
--  and the vendor received one pile of cloth with five pieces of paper that
--  did not add up to it.
--
--  The split follows C13 on buyer orders exactly:
--
--    - `dye_issues.roll_id` STAYS, NOT NULL, as the LEAD roll. Every list
--      screen, report and printed challan reads it, and on a single-roll job -
--      which is every job that exists today - it is precisely right. Dropping
--      it would have rewritten ninety-odd references to prove a point.
--
--    - `dye_issue_rolls` becomes the AUTHORITY on what the order covers, and
--      `dye_issues.qty` becomes the sum of its rows.
--
--  WHY THE QUANTITY IS PER ROLL
--
--  Shrinkage is judged against what went out, roll by roll. A lot where one
--  roll came back four per cent short and the rest were clean is a different
--  fact from one where every roll lost a little, and only the first is a
--  vendor problem. `dyeing_receipts` already records its return per roll, so
--  the issued side has to be per roll or the two cannot be reconciled.
--
--  THE BACKFILL IS THE POINT OF THIS MIGRATION
--
--  Every existing job becomes a one-roll job carrying its own figures, so
--  nothing that reads the new table sees a job with no rolls. The running
--  totals are copied from the header rather than reset: these jobs have cloth
--  at a vendor right now, and zeroing `issued_qty` would re-authorise fabric
--  that has already gone out.
-- ===========================================================================

CREATE TABLE "dye_issue_rolls" (
    "id"                  UUID         NOT NULL,
    "dye_issue_id"        UUID         NOT NULL,
    "line_no"             INTEGER      NOT NULL,
    "roll_id"             UUID         NOT NULL,
    "qty"                 DECIMAL(18,4) NOT NULL,
    "issued_qty"          DECIMAL(18,4) NOT NULL DEFAULT 0,
    "received_qty"        DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expected_return_qty" DECIMAL(18,4) NOT NULL,
    "remarks"             TEXT,
    "created_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id"       UUID,
    "updated_at"          TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id"       UUID,
    "deleted_at"          TIMESTAMPTZ(3),
    "deleted_by_id"       UUID,

    CONSTRAINT "dye_issue_rolls_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "dye_issue_rolls"
  ADD CONSTRAINT "dye_issue_rolls_dye_issue_id_fkey"
  FOREIGN KEY ("dye_issue_id") REFERENCES "dye_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dye_issue_rolls"
  ADD CONSTRAINT "dye_issue_rolls_roll_id_fkey"
  FOREIGN KEY ("roll_id") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "dye_issue_rolls_dye_issue_id_line_no_key"
    ON "dye_issue_rolls"("dye_issue_id", "line_no");

-- One roll cannot appear twice on one order: that is one line with a bigger
-- quantity, and two would each keep their own running totals.
CREATE UNIQUE INDEX "dye_issue_roll_identity"
    ON "dye_issue_rolls"("dye_issue_id", "roll_id");

CREATE INDEX "dye_issue_rolls_dye_issue_id_idx" ON "dye_issue_rolls"("dye_issue_id");
CREATE INDEX "dye_issue_rolls_roll_id_idx"      ON "dye_issue_rolls"("roll_id");
CREATE INDEX "dye_issue_rolls_deleted_at_idx"   ON "dye_issue_rolls"("deleted_at");

-- A line cannot be for nothing, and cannot have sent or received a negative.
ALTER TABLE "dye_issue_rolls"
  ADD CONSTRAINT "dye_issue_rolls_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "dye_issue_rolls"
  ADD CONSTRAINT "dye_issue_rolls_totals_not_negative"
  CHECK ("issued_qty" >= 0 AND "received_qty" >= 0);

-- ---------------------------------------------------------------------------
--  BACKFILL - every existing job becomes a one-roll job
-- ---------------------------------------------------------------------------
--
--  Soft-deleted jobs are included. They are still readable, still reachable
--  from a report, and a deleted job with no rolls would print as a job for
--  nothing. Their line inherits the same deleted_at, so it is invisible
--  wherever the parent is.
--
--  The running totals are COPIED, not zeroed: a job half sent out must stay
--  half sent out, or the next challan would be authorised to send the same
--  cloth twice.

INSERT INTO "dye_issue_rolls" (
    "id", "dye_issue_id", "line_no", "roll_id", "qty",
    "issued_qty", "received_qty", "expected_return_qty",
    "created_at", "created_by_id", "updated_at", "updated_by_id",
    "deleted_at", "deleted_by_id"
)
SELECT gen_random_uuid(), d."id", 1, d."roll_id", d."qty",
       d."issued_qty", d."received_qty", d."expected_return_qty",
       d."created_at", d."created_by_id", CURRENT_TIMESTAMP, d."updated_by_id",
       d."deleted_at", d."deleted_by_id"
  FROM "dye_issues" d
 WHERE NOT EXISTS (
   SELECT 1 FROM "dye_issue_rolls" r WHERE r."dye_issue_id" = d."id"
 );
