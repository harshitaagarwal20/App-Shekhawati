-- ===========================================================================
--  ONE JOB WORK PO, SEVERAL CHALLANS
--
--  A dyeing PO is raised for 10,000 and the fabric goes to the dye house on
--  two challans of 5,000. Before this, a job work order was spent by the first
--  fabric issue against it, so the second challan was refused.
--
--  Now every fabric issue (challan) names the order it draws on, and the order
--  carries `issued_qty`: what has actually gone out on it so far, re-derived
--  from those challans. Returns and shrinkage are judged against what was SENT,
--  not against what the PO authorised - 4,900 back from a 5,000 challan is 2%
--  shrinkage, not 51%.
-- ===========================================================================

ALTER TABLE "dye_issues"
  ADD COLUMN "issued_qty" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "fabric_issues"
  ADD COLUMN "job_work_id" UUID;

ALTER TABLE "fabric_issues"
  ADD CONSTRAINT "fabric_issues_job_work_id_fkey"
    FOREIGN KEY ("job_work_id") REFERENCES "dye_issues"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "fabric_issues_job_work_id_idx" ON "fabric_issues"("job_work_id");

-- --- Backfill --------------------------------------------------------------
--
-- C3-era orders (stock posted by their fabric issue): link that issue as the
-- order's challan, and count what it sent. A return already booked can never
-- be more than was sent, so the larger of the two stands.
UPDATE "fabric_issues" fi
   SET "job_work_id" = d."id"
  FROM "dye_issues" d
 WHERE d."fabric_issue_id" = fi."id"
   AND d."stock_posted_at" IS NOT NULL;

UPDATE "dye_issues" d
   SET "issued_qty" = LEAST(d."qty", GREATEST(fi."fabric_qty_issued", d."received_qty"))
  FROM "fabric_issues" fi
 WHERE d."fabric_issue_id" = fi."id"
   AND d."stock_posted_at" IS NOT NULL;

-- Orders from before C3 recorded work on fabric that had already been issued:
-- the whole order quantity went out.
UPDATE "dye_issues"
   SET "issued_qty" = "qty"
 WHERE "stock_posted_at" IS NULL
   AND ("fabric_issue_id" IS NOT NULL OR "received_qty" > 0);

-- --- The rules, on the new basis --------------------------------------------

ALTER TABLE "dye_issues"
  DROP CONSTRAINT "dye_issues_received_within_issued",
  DROP CONSTRAINT "dye_issues_shrinkage_is_the_formula";

-- Shrinkage is now measured against what was sent.
UPDATE "dye_issues"
   SET "shrinkage_pct" = ROUND(("issued_qty" - "received_qty") / "issued_qty", 6)
 WHERE "received_qty" > 0;

ALTER TABLE "dye_issues"
  -- Challans can never send more than the PO authorised.
  ADD CONSTRAINT "dye_issues_issued_within_ordered"
    CHECK ("issued_qty" >= 0 AND "issued_qty" <= "qty"),
  -- A job worker cannot return more than was sent to them.
  ADD CONSTRAINT "dye_issues_received_within_issued"
    CHECK ("received_qty" <= "issued_qty"),
  ADD CONSTRAINT "dye_issues_shrinkage_is_the_formula"
    CHECK (("received_qty" = 0 AND "shrinkage_pct" = 0)
           OR ABS("shrinkage_pct" - ("issued_qty" - "received_qty") / "issued_qty") <= 0.000001);
