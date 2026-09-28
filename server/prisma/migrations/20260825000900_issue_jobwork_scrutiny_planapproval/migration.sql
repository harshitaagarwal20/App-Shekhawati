-- ===========================================================================
--  Phases 12-15 - Fabric Issue, Job Work, Fabric Scrutiny, Plan Approval
--
--  Four modules, and one idea running through all of them: a document that
--  something else now depends on stops being editable.
--
--  FABRIC ISSUE gets the same posting stamp as a GRN. An issue and its Stock
--  Ledger OUT are written in one transaction, so posted_at is set for both or
--  for neither. `Requested Qty <= Available Stock` is checked against the
--  ledger inside that transaction, before anything is written.
--
--  JOB WORK is one register for four processes. dye_issues already carries
--  `process` (Dyeing / Printing / Washing / Finishing); what it was missing was
--  the style, the fabric stage, and running totals for what has come back. The
--  totals are DERIVED - recomputed from dyeing_receipts on every return, never
--  typed - which is why they get a CHECK rather than a default anybody can set.
--
--  FABRIC SCRUTINY locks on decision. A roll may already have been rejected or
--  released on the strength of a scrutiny, so once the decision is taken the
--  row stops moving. Corrections go through document_amendments, which keeps
--  the before/after set, rather than through an edit that erases what was
--  decided and when.
--
--  PLAN APPROVAL is versioned. `round` is the version number. A rejected round
--  is rectified by raising a SUCCESSOR - a new row, round + 1, pointing back at
--  the one it replaces - and the predecessor locks. An approved round locks
--  immediately and permanently, because a cutting issue can be raised against
--  it the moment it is approved.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  12. FABRIC ISSUE
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "fabric_issues"
  ADD COLUMN "location"          VARCHAR(80) NOT NULL DEFAULT 'MAIN STORE',
  ADD COLUMN "inventory_item_id" UUID,
  ADD COLUMN "posted_at"         TIMESTAMPTZ(3),
  ADD COLUMN "posted_by_id"      UUID,
  ADD COLUMN "posted_by_name"    VARCHAR(120);

-- Seeded issues are already out of stock: the seeder writes their ledger entry
-- and their balance. Stamp them, and point each at the item its entry moved.
UPDATE "fabric_issues" fi
   SET "inventory_item_id" = l."item_id",
       "posted_at"         = fi."created_at",
       "posted_by_name"    = 'Seeded from the workbook'
  FROM "stock_ledger" l
 WHERE l."document_type" = 'FABRIC_ISSUE'
   AND l."document_id" = fi."id"
   AND l."direction" = 'OUT';

-- CreateIndex
CREATE INDEX "fabric_issues_inventory_item_id_idx" ON "fabric_issues"("inventory_item_id");

-- AddForeignKey
ALTER TABLE "fabric_issues"
  ADD CONSTRAINT "fabric_issues_inventory_item_id_fkey"
    FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fabric_issues"
  ADD CONSTRAINT "fabric_issues_posted_has_item"
    CHECK ("posted_at" IS NULL OR "inventory_item_id" IS NOT NULL),
  ADD CONSTRAINT "fabric_issues_posted_is_stamped"
    CHECK ("posted_at" IS NULL OR "posted_by_name" IS NOT NULL);

-- ---------------------------------------------------------------------------
--  13. JOB WORK  (dye_issues serves all four processes)
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "dye_issues"
  ADD COLUMN "fabric_stage"  "FabricStage"  NOT NULL DEFAULT 'BEFORE_STITCHING',
  ADD COLUMN "style_id"      UUID,
  ADD COLUMN "received_qty"  DECIMAL(18,4)  NOT NULL DEFAULT 0,
  ADD COLUMN "shrinkage_pct" DECIMAL(9,6)   NOT NULL DEFAULT 0;

-- The style a job was serving is the style on its buyer order.
UPDATE "dye_issues" d
   SET "style_id" = o."style_id"
  FROM "buyer_orders" o
 WHERE o."id" = d."order_id";

-- Bring the running totals up to date from the returns already recorded.
UPDATE "dye_issues" d
   SET "received_qty"  = t."qty",
       "shrinkage_pct" = CASE WHEN d."qty" > 0
                              THEN ROUND((d."qty" - t."qty") / d."qty", 6)
                              ELSE 0 END
  FROM (
    SELECT "dye_issue_id", SUM("qty_received") AS "qty"
      FROM "dyeing_receipts"
     WHERE "deleted_at" IS NULL
     GROUP BY "dye_issue_id"
  ) t
 WHERE t."dye_issue_id" = d."id";

-- CreateIndex
CREATE INDEX "dye_issues_style_id_idx" ON "dye_issues"("style_id");
CREATE INDEX "dye_issues_status_idx" ON "dye_issues"("status");

-- AddForeignKey
ALTER TABLE "dye_issues"
  ADD CONSTRAINT "dye_issues_style_id_fkey"
    FOREIGN KEY ("style_id") REFERENCES "styles"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dye_issues"
  ADD CONSTRAINT "dye_issues_received_non_negative"
    CHECK ("received_qty" >= 0),
  -- A job worker cannot return more than was sent. Fabric shrinks; it does not
  -- multiply. An over-return means somebody's roll numbers are crossed.
  ADD CONSTRAINT "dye_issues_received_within_issued"
    CHECK ("received_qty" <= "qty"),
  -- Shrinkage is derived from the two quantities, with a unit of slack in the
  -- last stored place because a division cannot be checked exactly.
  --
  -- Nothing back yet is shrinkage of ZERO, not of 100%. A lot still at the
  -- vendor has not shrunk; it simply has not returned, and the formula only
  -- starts meaning anything once something has.
  ADD CONSTRAINT "dye_issues_shrinkage_is_the_formula"
    CHECK (("received_qty" = 0 AND "shrinkage_pct" = 0)
           OR ABS("shrinkage_pct" - ("qty" - "received_qty") / "qty") <= 0.000001);

-- ---------------------------------------------------------------------------
--  14. FABRIC SCRUTINY
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "fabric_scrutinies"
  ADD COLUMN "decided_by_name"  VARCHAR(120),
  ADD COLUMN "is_locked"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "locked_at"        TIMESTAMPTZ(3),
  ADD COLUMN "locked_by_id"     UUID,
  ADD COLUMN "amendment_count"  INTEGER NOT NULL DEFAULT 0;

-- Scrutinies seeded from the workbook are settled: the sheet records a decision
-- against every one of them, taken by the name in "Authorised By".
UPDATE "fabric_scrutinies"
   SET "decided_at"      = COALESCE("decided_at", "created_at"),
       "decided_by_name" = COALESCE("authorised_by", 'Recorded before this system was in use'),
       "is_locked"       = true,
       "locked_at"       = COALESCE("decided_at", "created_at");

-- CreateIndex
CREATE INDEX "fabric_scrutinies_is_locked_idx" ON "fabric_scrutinies"("is_locked");

ALTER TABLE "fabric_scrutinies"
  ADD CONSTRAINT "fabric_scrutinies_qty_affected_positive"
    CHECK ("qty_affected" > 0),
  -- A locked scrutiny is a decision that has been taken, and a decision has a
  -- date and a name. The three go together or none of them do.
  ADD CONSTRAINT "fabric_scrutinies_locked_is_decided"
    CHECK ("is_locked" = false
           OR ("decided_at" IS NOT NULL AND "decided_by_name" IS NOT NULL
               AND "locked_at" IS NOT NULL)),
  ADD CONSTRAINT "fabric_scrutinies_amendment_count_non_negative"
    CHECK ("amendment_count" >= 0);

-- ---------------------------------------------------------------------------
--  15. PLAN APPROVAL
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "plan_approvals"
  ADD COLUMN "supersedes_id"     UUID,
  ADD COLUMN "rectified_at"      TIMESTAMPTZ(3),
  ADD COLUMN "decided_at"        TIMESTAMPTZ(3),
  ADD COLUMN "is_locked"         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "locked_at"         TIMESTAMPTZ(3),
  ADD COLUMN "approved_by_name"  VARCHAR(120);

-- Chain the seeded rounds together: within one order and container, round n was
-- raised to replace round n-1.
UPDATE "plan_approvals" pa
   SET "supersedes_id" = prev."id"
  FROM "plan_approvals" prev
 WHERE prev."order_id" = pa."order_id"
   AND COALESCE(prev."container_no", '') = COALESCE(pa."container_no", '')
   AND prev."round" = pa."round" - 1;

-- A decided round is locked. Approved rounds are locked because something can
-- already have been cut against them; rejected rounds that were rectified are
-- locked because their successor is where the work went.
UPDATE "plan_approvals"
   SET "decided_at"       = CASE WHEN "approval_status" <> 'PENDING'
                                 THEN COALESCE("approved_date"::timestamptz, "created_at") END,
       "approved_by_name" = CASE WHEN "approval_status" = 'APPROVED'
                                 THEN "submitted_to" END,
       "is_locked"        = ("approval_status" = 'APPROVED'),
       "locked_at"        = CASE WHEN "approval_status" = 'APPROVED'
                                 THEN COALESCE("approved_date"::timestamptz, "created_at") END;

-- A rejected round that already has a successor is closed too.
UPDATE "plan_approvals" pa
   SET "is_locked"    = true,
       "locked_at"    = COALESCE(pa."decided_at", pa."created_at"),
       "rectified_at" = COALESCE(pa."decided_at", pa."created_at")
 WHERE pa."approval_status" = 'REJECTED'
   AND EXISTS (SELECT 1 FROM "plan_approvals" nxt WHERE nxt."supersedes_id" = pa."id");

-- CreateIndex
CREATE INDEX "plan_approvals_supersedes_id_idx" ON "plan_approvals"("supersedes_id");
CREATE INDEX "plan_approvals_is_locked_idx" ON "plan_approvals"("is_locked");

-- One order and container cannot have two attempts at the same version.
CREATE UNIQUE INDEX "plan_approvals_order_container_round_key"
  ON "plan_approvals"("order_id", COALESCE("container_no", ''), "round");

-- AddForeignKey
ALTER TABLE "plan_approvals"
  ADD CONSTRAINT "plan_approvals_supersedes_id_fkey"
    FOREIGN KEY ("supersedes_id") REFERENCES "plan_approvals"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Only the versioning constraints are new here.
--
-- `plan_approvals_round_positive`, `plan_approvals_approved_date_present` and
-- `plan_approvals_rejection_reason_present` were already added by migration
-- 20260825000100_check_constraints. Re-adding them made this migration fail on
-- a fresh database with "constraint already exists" - which is exactly the kind
-- of thing that only shows up when somebody sets the system up from scratch.
ALTER TABLE "plan_approvals"
  -- Version 1 is the first attempt and replaces nothing; every later version
  -- replaces exactly the one before it.
  ADD CONSTRAINT "plan_approvals_first_round_supersedes_nothing"
    CHECK ("round" > 1 OR "supersedes_id" IS NULL),
  ADD CONSTRAINT "plan_approvals_later_rounds_supersede"
    CHECK ("round" = 1 OR "supersedes_id" IS NOT NULL),
  ADD CONSTRAINT "plan_approvals_decided_at_present"
    CHECK ("approval_status" = 'PENDING' OR "decided_at" IS NOT NULL),
  ADD CONSTRAINT "plan_approvals_pending_has_no_decision"
    CHECK ("approval_status" <> 'PENDING'
           OR ("approved_date" IS NULL AND "decided_at" IS NULL
               AND "rejection_reason" IS NULL)),

  -- An approved version is immutable, without exception.
  ADD CONSTRAINT "plan_approvals_approved_is_locked"
    CHECK ("approval_status" <> 'APPROVED' OR "is_locked" = true),
  ADD CONSTRAINT "plan_approvals_locked_is_stamped"
    CHECK ("is_locked" = false OR "locked_at" IS NOT NULL),
  -- A pending version has not been decided, so it cannot be locked.
  ADD CONSTRAINT "plan_approvals_pending_is_not_locked"
    CHECK ("approval_status" <> 'PENDING' OR "is_locked" = false);
