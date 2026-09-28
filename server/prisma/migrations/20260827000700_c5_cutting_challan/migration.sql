-- ===========================================================================
--  C5 - CUTTING CHALLAN
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   THE DOCUMENT THAT WAS MISSING
--
--   Until now the cutting floor pulled fabric out of the store on a Fabric
--   Issue alone. There was no approved statement of what cutting needed, so
--   there was nothing to reconcile the issues against afterwards and nothing
--   to refuse an issue that nobody had asked for.
--
--   The challan is that statement: an approval-enabled document raised against
--   an APPROVED planning version, listing the required item and quantity. Every
--   new Fabric Issue must quote one of its lines.
--
--   ---------------------------------------------------------------------------
--   PARTIAL FULFILMENT YES, OVER-FULFILMENT NEVER
--
--   A line for 100 may be filled by issues of 40, 30 and 30, and the line
--   closes at exactly 100. The fourth issue is refused. The
--   cutting_challan_lines_no_over_fulfilment CHECK is what makes that true
--   even for a caller that never goes through the service, and issued_qty is
--   RE-DERIVED from the issues inside the posting transaction rather than
--   incremented - a total that is added to can drift, a total that is
--   recomputed cannot.
--
--   A line may also be CLOSED SHORT: cutting decides it needs no more and the
--   outstanding quantity is deliberately abandoned. That is a different fact
--   from being filled, and it has its own columns rather than being disguised
--   as completion.
--
--   ---------------------------------------------------------------------------
--   MIGRATION OF EXISTING FABRIC ISSUES
--
--   Ten fabric issues predate the challan. They cannot be given a requirement
--   that was never raised, and inventing a retrospective challan to hang them
--   on would put an approved document in the system that nobody approved.
--
--   fabric_issues.cutting_challan_line_id is therefore NULLABLE, and the
--   partial CHECK below makes it mandatory only for rows created after this
--   migration. History stays readable; new work cannot skip the challan.
--  ---------------------------------------------------------------------------

-- --- 1. The document type -------------------------------------------------

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CUTTING_CHALLAN' BEFORE 'CUTTING_ISSUE';

-- --- 2. The challan header ------------------------------------------------

CREATE TABLE "cutting_challans" (
    "id" UUID NOT NULL,
    "workflow_state" "DocumentState" NOT NULL DEFAULT 'DRAFT',
    "challan_no" VARCHAR(40) NOT NULL,
    "challan_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "planning_id" UUID NOT NULL,
    "plan_approval_id" UUID,
    "container_no" VARCHAR(40),
    "required_by" DATE,
    "status" "StatusGeneral" NOT NULL DEFAULT 'PENDING',
    "closed_short_at" TIMESTAMPTZ(3),
    "closed_short_by_id" UUID,
    "closed_short_by_name" VARCHAR(120),
    "closed_short_reason" TEXT,
    "approved_by_id" UUID,
    "approved_by_name" VARCHAR(120),
    "approved_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "cutting_challans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cutting_challans_challan_no_key" ON "cutting_challans"("challan_no");
CREATE INDEX "cutting_challans_order_id_idx" ON "cutting_challans"("order_id");
CREATE INDEX "cutting_challans_style_id_idx" ON "cutting_challans"("style_id");
CREATE INDEX "cutting_challans_planning_id_idx" ON "cutting_challans"("planning_id");
CREATE INDEX "cutting_challans_plan_approval_id_idx" ON "cutting_challans"("plan_approval_id");
CREATE INDEX "cutting_challans_challan_date_idx" ON "cutting_challans"("challan_date");
CREATE INDEX "cutting_challans_status_idx" ON "cutting_challans"("status");
CREATE INDEX "cutting_challans_workflow_state_idx" ON "cutting_challans"("workflow_state");
CREATE INDEX "cutting_challans_container_no_idx" ON "cutting_challans"("container_no");
CREATE INDEX "cutting_challans_deleted_at_idx" ON "cutting_challans"("deleted_at");

ALTER TABLE "cutting_challans"
  ADD CONSTRAINT "cutting_challans_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cutting_challans_style_id_fkey"
  FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cutting_challans_planning_id_fkey"
  FOREIGN KEY ("planning_id") REFERENCES "plannings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cutting_challans_plan_approval_id_fkey"
  FOREIGN KEY ("plan_approval_id") REFERENCES "plan_approvals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cutting_challans"
  -- A short close is a decision somebody takes and has to answer for. The
  -- three columns arrive together or not at all.
  ADD CONSTRAINT "cutting_challans_short_close_is_attributed"
  CHECK (
    ("closed_short_at" IS NULL AND "closed_short_by_name" IS NULL AND "closed_short_reason" IS NULL)
    OR ("closed_short_at" IS NOT NULL AND "closed_short_by_name" IS NOT NULL AND "closed_short_reason" IS NOT NULL)
  ),
  -- An approval is stamped, not typed. Same rule the rest of the pipeline uses.
  ADD CONSTRAINT "cutting_challans_approval_is_attributed"
  CHECK (("approved_at" IS NULL) = ("approved_by_name" IS NULL));

-- --- 3. The challan lines -------------------------------------------------

CREATE TABLE "cutting_challan_lines" (
    "id" UUID NOT NULL,
    "challan_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_category" VARCHAR(60) NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "sub_category" VARCHAR(60),
    "accessories_item" VARCHAR(80),
    "color_code" VARCHAR(60),
    "description" VARCHAR(200),
    "required_qty" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "computed_requirement_qty" DECIMAL(18,4),
    "requirement_basis" TEXT,
    "issued_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "StatusGeneral" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "cutting_challan_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cutting_challan_lines_challan_id_line_no_key"
  ON "cutting_challan_lines"("challan_id", "line_no");
CREATE INDEX "cutting_challan_lines_challan_id_idx" ON "cutting_challan_lines"("challan_id");
CREATE INDEX "cutting_challan_lines_status_idx" ON "cutting_challan_lines"("status");
CREATE INDEX "cutting_challan_lines_category_idx" ON "cutting_challan_lines"("category");
CREATE INDEX "cutting_challan_lines_deleted_at_idx" ON "cutting_challan_lines"("deleted_at");

ALTER TABLE "cutting_challan_lines"
  ADD CONSTRAINT "cutting_challan_lines_challan_id_fkey"
  FOREIGN KEY ("challan_id") REFERENCES "cutting_challans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cutting_challan_lines"
  ADD CONSTRAINT "cutting_challan_lines_line_no_positive" CHECK ("line_no" > 0),
  -- Asking for nothing is not a requirement.
  ADD CONSTRAINT "cutting_challan_lines_required_qty_positive" CHECK ("required_qty" > 0),
  ADD CONSTRAINT "cutting_challan_lines_issued_qty_non_negative" CHECK ("issued_qty" >= 0),
  -- THE C5 RULE, at the level nothing can bypass. Partial fulfilment is
  -- permitted by the <=; over-fulfilment is impossible.
  ADD CONSTRAINT "cutting_challan_lines_no_over_fulfilment"
  CHECK ("issued_qty" <= "required_qty"),
  ADD CONSTRAINT "cutting_challan_lines_requirement_non_negative"
  CHECK ("computed_requirement_qty" IS NULL OR "computed_requirement_qty" >= 0);

-- --- 4. The fabric issue quotes a line ------------------------------------

ALTER TABLE "fabric_issues"
  ADD COLUMN "cutting_challan_line_id" UUID,
  ADD COLUMN "in_process_location" VARCHAR(80);

ALTER TABLE "fabric_issues"
  ADD CONSTRAINT "fabric_issues_cutting_challan_line_id_fkey"
  FOREIGN KEY ("cutting_challan_line_id") REFERENCES "cutting_challan_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "fabric_issues_cutting_challan_line_id_idx" ON "fabric_issues"("cutting_challan_line_id");

-- Mandatory for everything raised from here on; silent about the ten issues
-- that predate the challan. The cut-off is the migration timestamp itself, so
-- the rule cannot be dodged by back-dating issue_date - created_at is written
-- by the database.
ALTER TABLE "fabric_issues"
  ADD CONSTRAINT "fabric_issues_new_rows_need_challan"
  CHECK (
    "created_at" < TIMESTAMPTZ '2026-08-27 00:00:00+00'
    OR "cutting_challan_line_id" IS NOT NULL
  );
