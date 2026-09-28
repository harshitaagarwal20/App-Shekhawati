-- ===========================================================================
--  C7 - PLAN APPROVAL: THREE PLAN TYPES, ONE VERSIONED HEADER
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   PLANNING RECORDS ONLY
--
--   A STITCHING line on a plan approval is a sheet of paper the production
--   office signs before work starts: how many pieces are planned, by when, at
--   which unit. It is not a stitching record, there is no execution table
--   behind it, and nothing in this system reports work done. The same is true
--   of SHIPPING, which is a plan and not a dispatch.
--
--   prisma/verify-scope.js now carries an explicit ALLOWLIST naming these two
--   enum values and saying why they are permitted, so the guard cannot be
--   loosened by accident and cannot flag them by accident either.
--
--   ---------------------------------------------------------------------------
--   round IS THE VERSION NUMBER, AND KEEPS ITS NAME
--
--   plan_approvals.round already meant "version 2 of the plan for this order
--   and container". Renaming it to version would have broken every screen and
--   report that prints it in exchange for a synonym. The API exposes version
--   as an alias so the brief's vocabulary works; the column stays.
--
--   ---------------------------------------------------------------------------
--   WHAT IS ACTUALLY NEW: STYLE, AND ONE CURRENT VERSION
--
--   The header keyed on order + container. Two styles shipping in one
--   container therefore shared a single plan approval, and neither could be
--   superseded without the other. style_id fixes that.
--
--   is_current, and the partial unique index below, are what make "only one
--   version can be APPROVED for a given style + container" a fact rather than
--   a convention a service has to remember. Approving version 2 demotes
--   version 1 in the same transaction; version 1 stays readable, stays locked,
--   and can never be edited again.
--
--   BACKFILL: style_id from the buyer order the approval already points at -
--   buyer_orders.style_id is NOT NULL, so this is a lookup, not a guess.
--   is_current is set true on every APPROVED row; the data holds at most one
--   APPROVED version per (style, container) today, which the index verifies
--   as it is built.
--  ---------------------------------------------------------------------------

-- --- 1. The plan type enum ------------------------------------------------

CREATE TYPE "PlanType" AS ENUM ('CUTTING', 'STITCHING', 'SHIPPING');

-- --- 2. Style-wise versioning on the header -------------------------------

ALTER TABLE "plan_approvals"
  ADD COLUMN "style_id" UUID,
  ADD COLUMN "is_current" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "demoted_at" TIMESTAMPTZ(3),
  ADD COLUMN "demoted_by_id" UUID;

ALTER TABLE "plan_approvals"
  ADD CONSTRAINT "plan_approvals_style_id_fkey"
  FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "plan_approvals" pa
   SET "style_id" = bo."style_id"
  FROM "buyer_orders" bo
 WHERE bo."id" = pa."order_id"
   AND pa."style_id" IS NULL;

UPDATE "plan_approvals"
   SET "is_current" = true
 WHERE "approval_status" = 'APPROVED'
   AND "deleted_at" IS NULL;

CREATE INDEX "plan_approvals_style_id_idx" ON "plan_approvals"("style_id");
CREATE INDEX "plan_approvals_is_current_idx" ON "plan_approvals"("is_current");

-- THE C7 RULE. COALESCE on container_no because a UNIQUE index treats two
-- NULLs as distinct, and two current approved plans for one style with no
-- container is exactly the collision this is here to prevent.
CREATE UNIQUE INDEX "plan_approvals_one_current_approved"
  ON "plan_approvals"("style_id", (COALESCE("container_no", '')))
  WHERE "is_current" AND "approval_status" = 'APPROVED' AND "deleted_at" IS NULL;

ALTER TABLE "plan_approvals"
  -- A version cannot be current without being the version of something.
  ADD CONSTRAINT "plan_approvals_current_version_names_its_style"
  CHECK (NOT "is_current" OR "style_id" IS NOT NULL),
  -- Demoted and current are opposites. Both at once is a version claiming to
  -- be in force and superseded at the same time.
  ADD CONSTRAINT "plan_approvals_demoted_is_not_current"
  CHECK ("demoted_at" IS NULL OR NOT "is_current");

-- NOTE: plan_approvals_round_positive already exists, added by the Phase 0
-- check-constraint migration. The version number was always a count of
-- attempts starting at one; C7 only gives it a second name.

-- --- 3. The three plan types, as lines of one header ----------------------

CREATE TABLE "plan_approval_lines" (
    "id" UUID NOT NULL,
    "plan_approval_id" UUID NOT NULL,
    "plan_type" "PlanType" NOT NULL,
    "planned_qty" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL DEFAULT 'Pcs',
    "planned_start" DATE,
    "planned_end" DATE,
    "planned_unit" VARCHAR(120),
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "plan_approval_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "plan_approval_lines"
  ADD CONSTRAINT "plan_approval_lines_plan_approval_id_fkey"
  FOREIGN KEY ("plan_approval_id") REFERENCES "plan_approvals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One line per plan type per version. Two cutting plans on one signature is
-- not a richer plan, it is an unresolved disagreement.
CREATE UNIQUE INDEX "plan_approval_lines_plan_approval_id_plan_type_key"
  ON "plan_approval_lines"("plan_approval_id", "plan_type");
CREATE INDEX "plan_approval_lines_plan_approval_id_idx" ON "plan_approval_lines"("plan_approval_id");
CREATE INDEX "plan_approval_lines_plan_type_idx" ON "plan_approval_lines"("plan_type");
CREATE INDEX "plan_approval_lines_deleted_at_idx" ON "plan_approval_lines"("deleted_at");

ALTER TABLE "plan_approval_lines"
  ADD CONSTRAINT "plan_approval_lines_planned_qty_positive" CHECK ("planned_qty" > 0),
  ADD CONSTRAINT "plan_approval_lines_dates_ordered"
  CHECK ("planned_start" IS NULL OR "planned_end" IS NULL OR "planned_end" >= "planned_start");
