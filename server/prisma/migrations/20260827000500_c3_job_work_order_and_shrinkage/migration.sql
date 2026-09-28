-- ===========================================================================
--  C3 - JOB WORK PURCHASE ORDER, SHRINKAGE, AND JOB-WORKER STOCK
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   THE JOB WORK ORDER ALREADY EXISTS. IT IS dye_issues.
--
--   The table is named for the workbook sheet ("Dye issue"), but its Process
--   column has read Dyeing / Printing / Washing / Finishing since Phase 0, its
--   document numbers are the DY-001 / PJ-001 job-work PO numbers the sheet's
--   Remark column prints, and it already carries the job worker, the quantity
--   issued and a shrinkage allowance. Creating a job_work_orders table beside
--   it would have produced two registers for one register's worth of work.
--
--   What it was NOT is [A][S]. Before this migration a job work order had no
--   approval step and moved no stock, and fabric reached a job worker on a
--   bare Fabric Issue. Both are fixed here.
--
--   ---------------------------------------------------------------------------
--   WHY standard_shrinkage_allowed LOSES ITS DEFAULT
--
--   It was DEFAULT 0.03. A lot that never stated a tolerance silently
--   inherited three per cent, which is exactly the "do not assume a tolerance"
--   failure C2 and C3 both forbid. The column is renamed to
--   shrinkage_tolerance_pct, the default is dropped, and every job work order
--   from here on resolves its own figure out of shrinkage_rules and stores it.
--
--   ---------------------------------------------------------------------------
--   WHAT shrinkage_rules IS SEEDED WITH, AND WHY THAT IS NOT INVENTION
--
--   The four percentages below are the ones jobWork.service.js PROCESS_META
--   has been applying all along - dyeing 3%, printing 2%, washing 5%,
--   finishing 2%. Lifting a constant that is already in force into a table so
--   it can be changed without a deployment is not inventing a value; it is
--   making an existing one visible. Nothing behaves differently on the day
--   this runs.
--
--   FLAGGED FOR THE OFFICE: washing at 5% sits outside the 2-3% band the C3
--   brief describes. It is seeded at 5% because that is what the application
--   has been enforcing, and silently tightening it here would start refusing
--   returns that yesterday passed. It is reported for a decision instead.
--
--   ---------------------------------------------------------------------------
--   WHY THE STOCK LEGS ARE NOT BACKFILLED
--
--   Under C3 a job work issue posts a TRANSFER - out of the store, in at the
--   job worker - so the fabric stays visible in total on-hand while it is off
--   site and stays out of available-for-issue. Three lots (DY-008, PJ-001,
--   PJ-002) are open right now and were issued under the old model, where the
--   Fabric Issue took the fabric out of stock entirely and nothing put it
--   anywhere.
--
--   Writing job-worker legs for them retrospectively would insert stock
--   movements that never happened, on dates chosen by this migration, into an
--   append-only ledger. stock_posted_at stays NULL for them instead, and
--   jobWork.receive() reads it: a lot with no job-worker leg returns exactly
--   the way it always did. New lots get the full treatment. Nothing is
--   rewritten and nothing double-counts.
--  ---------------------------------------------------------------------------

-- --- 1. The shrinkage master ----------------------------------------------

CREATE TABLE "shrinkage_rules" (
    "id" UUID NOT NULL,
    "process" "JobWorkProcess" NOT NULL,
    "vendor_id" UUID,
    "shrinkage_tolerance_pct" DECIMAL(9,6) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "basis" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "shrinkage_rules_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "shrinkage_rules"
  ADD CONSTRAINT "shrinkage_rules_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "shrinkage_rules_process_vendor_id_effective_from_key"
  ON "shrinkage_rules"("process", "vendor_id", "effective_from");
CREATE INDEX "shrinkage_rules_process_is_active_idx" ON "shrinkage_rules"("process", "is_active");
CREATE INDEX "shrinkage_rules_vendor_id_idx" ON "shrinkage_rules"("vendor_id");
CREATE INDEX "shrinkage_rules_deleted_at_idx" ON "shrinkage_rules"("deleted_at");

ALTER TABLE "shrinkage_rules"
  ADD CONSTRAINT "shrinkage_rules_pct_is_a_fraction"
  CHECK ("shrinkage_tolerance_pct" >= 0 AND "shrinkage_tolerance_pct" <= 1),
  ADD CONSTRAINT "shrinkage_rules_effective_period_ordered"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

-- A UNIQUE index treats two NULLs as distinct, so the constraint above would
-- happily accept two process-wide rules with the same start date. This is the
-- one that actually stops it.
CREATE UNIQUE INDEX "shrinkage_rules_one_process_wide_version"
  ON "shrinkage_rules"("process", "effective_from")
  WHERE "vendor_id" IS NULL;

INSERT INTO "shrinkage_rules"
  ("id", "process", "vendor_id", "shrinkage_tolerance_pct", "effective_from", "basis", "updated_at")
VALUES
  (gen_random_uuid(), 'DYEING',    NULL, 0.030000, DATE '2026-08-27',
   'Process Documentation: 2-3% shrinkage is normal on a dye lot. Lifted from jobWork.service.js PROCESS_META, which has been enforcing this figure.', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PRINTING',  NULL, 0.020000, DATE '2026-08-27',
   'Lifted from jobWork.service.js PROCESS_META - the printing process loss the application has been enforcing.', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'WASHING',   NULL, 0.050000, DATE '2026-08-27',
   'Lifted from jobWork.service.js PROCESS_META - washing shrinks cotton harder than dyeing. OUTSIDE the 2-3% band the C3 brief describes; seeded at the enforced value and flagged for a decision rather than tightened silently.', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FINISHING', NULL, 0.020000, DATE '2026-08-27',
   'Lifted from jobWork.service.js PROCESS_META - the finishing process loss the application has been enforcing.', CURRENT_TIMESTAMP);

-- --- 2. dye_issues becomes an approvable, stock-moving job work order ------

ALTER TABLE "dye_issues"
  RENAME COLUMN "standard_shrinkage_allowed" TO "shrinkage_tolerance_pct";

ALTER TABLE "dye_issues"
  ALTER COLUMN "shrinkage_tolerance_pct" DROP DEFAULT;

ALTER TABLE "dye_issues"
  ADD COLUMN "workflow_state" "DocumentState",
  ADD COLUMN "shrinkage_rule_id" UUID,
  ADD COLUMN "shrinkage_rule_basis" TEXT,
  ADD COLUMN "expected_return_qty" DECIMAL(18,4),
  ADD COLUMN "stock_posted_at" TIMESTAMPTZ(3),
  ADD COLUMN "stock_posted_by_id" UUID,
  ADD COLUMN "stock_posted_by_name" VARCHAR(120),
  ADD COLUMN "inventory_item_id" UUID,
  ADD COLUMN "job_worker_location" VARCHAR(80) NOT NULL DEFAULT 'WITH JOB WORKER';

ALTER TABLE "dye_issues"
  ADD CONSTRAINT "dye_issues_inventory_item_id_fkey"
  FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill workflow_state from the fulfilment status the row already carries.
--
-- This is a mapping, not a guess: it is the same correspondence the approval
-- engine's legacy map will maintain from here on, applied backwards once. A
-- lot the store recorded as COMPLETED was authorised and has run its course; a
-- lot IN_PROGRESS is at the vendor, which cannot happen without somebody
-- having authorised it; a lot still PENDING has not been acted on and is a
-- draft. Nothing is invented - each state is read off a column that was
-- already there.
UPDATE "dye_issues"
   SET "workflow_state" = CASE "status"
     WHEN 'COMPLETED'   THEN 'COMPLETED'::"DocumentState"
     WHEN 'IN_PROGRESS' THEN 'APPROVED'::"DocumentState"
     WHEN 'CANCELLED'   THEN 'CANCELLED'::"DocumentState"
     ELSE 'DRAFT'::"DocumentState"
   END
 WHERE "workflow_state" IS NULL;

-- expected_return_qty = issued x (1 - tolerance), using the tolerance the row
-- already carries. Recomputing the figure the rule always implied.
UPDATE "dye_issues"
   SET "expected_return_qty" = ROUND("qty" * (1 - "shrinkage_tolerance_pct"), 4)
 WHERE "expected_return_qty" IS NULL;

ALTER TABLE "dye_issues"
  ALTER COLUMN "workflow_state" SET NOT NULL,
  ALTER COLUMN "workflow_state" SET DEFAULT 'DRAFT',
  ALTER COLUMN "expected_return_qty" SET NOT NULL;

CREATE INDEX "dye_issues_workflow_state_idx" ON "dye_issues"("workflow_state");
CREATE INDEX "dye_issues_inventory_item_id_idx" ON "dye_issues"("inventory_item_id");

ALTER TABLE "dye_issues"
  ADD CONSTRAINT "dye_issues_shrinkage_tolerance_is_a_fraction"
  CHECK ("shrinkage_tolerance_pct" >= 0 AND "shrinkage_tolerance_pct" <= 1),
  -- Fabric shrinks; it does not multiply. The expected return can never
  -- exceed what went out, and it cannot be negative.
  ADD CONSTRAINT "dye_issues_expected_return_within_issued"
  CHECK ("expected_return_qty" >= 0 AND "expected_return_qty" <= "qty"),
  -- The stock leg is stamped by whoever posted it, or not at all. A posting
  -- time with no poster is a half-written audit trail.
  ADD CONSTRAINT "dye_issues_stock_posting_is_attributed"
  CHECK (("stock_posted_at" IS NULL) = ("stock_posted_by_name" IS NULL)),
  -- A lot cannot be at a job worker in the ledger without an item to be at
  -- one as.
  ADD CONSTRAINT "dye_issues_stock_posted_names_its_item"
  CHECK ("stock_posted_at" IS NULL OR "inventory_item_id" IS NOT NULL);

-- --- 3. dyeing_receipts: the standard is inherited, never defaulted --------

ALTER TABLE "dyeing_receipts"
  ALTER COLUMN "standard_shrinkage_allowed" DROP DEFAULT;
