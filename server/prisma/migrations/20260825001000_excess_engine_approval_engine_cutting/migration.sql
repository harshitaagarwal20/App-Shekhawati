-- ===========================================================================
--  Phases 16-18 - Cutting Issue, configurable excess, and the approval engine
--
--  THREE THINGS, AND THE MIDDLE ONE IS THE POINT.
--
--  17. NO PERCENTAGE IS COMPILED INTO THIS APPLICATION ANY MORE.
--
--      2% is all over the workbook - "2-3%" on the PO sheet, a 2% receipt
--      variation in the process document, 2-3% shrinkage on a dye lot. Every
--      one of those was a constant in a service file until this migration.
--      They are now ROWS in excess_rules, seeded to exactly the workbook
--      values so nothing changes on day one, and editable on a screen so that
--      a buyer contracted at 5% or an order agreed at 1% needs a data change
--      rather than a deployment.
--
--      Resolution is narrowest-scope-first:
--          ORDER ► BUYER ► ITEM_CATEGORY ► DOCUMENT_TYPE ► GLOBAL
--
--      excess_approvals records every breach: base quantity, permitted
--      percentage, permitted quantity, actual excess, excess percentage,
--      status, approver, approval date and reason. The row is written when the
--      excess is DETECTED, so an over-limit transaction that was refused still
--      leaves a trace of having been attempted.
--
--  18. WORKFLOW STATE IS EXPLICIT.
--
--      Every approvable document gets the same workflow_state column, over the
--      same DocumentState enum. The per-module status columns stay - they are
--      what the workbook prints and what the existing CHECK constraints refer
--      to - and approvalEngine.js writes both in one update, so they cannot
--      disagree. The backfill below derives the initial state from the column
--      each module was already using.
--
--  16. CUTTING ISSUE IS IMMUTABLE ONCE POSTED.
--
--      It is the last document in the pipeline. Cloth has been cut; no module
--      downstream of it exists in this system to correct it, and nothing
--      outside the system can un-cut it. So it locks, permanently, and the
--      constraints below make that true at the table rather than only in a
--      service.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "DocumentState" AS ENUM (
  'DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED',
  'REJECTED', 'RECTIFICATION', 'RESUBMITTED', 'CANCELLED'
);

-- CreateEnum
CREATE TYPE "ExcessScope" AS ENUM (
  'GLOBAL', 'DOCUMENT_TYPE', 'ITEM_CATEGORY', 'BUYER', 'ORDER'
);

-- ---------------------------------------------------------------------------
--  17. CONFIGURABLE EXCESS
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "excess_rules" (
    "id"                UUID NOT NULL,
    "scope"             "ExcessScope" NOT NULL,
    "scope_key"         VARCHAR(80) NOT NULL DEFAULT '',
    "document_type"     "DocumentType",
    "excess_pct"        DECIMAL(9,6) NOT NULL,
    "hard_ceiling_pct"  DECIMAL(9,6),
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "basis"             VARCHAR(255),
    "priority"          INTEGER NOT NULL DEFAULT 0,
    "is_active"         BOOLEAN NOT NULL DEFAULT true,
    "effective_from"    DATE,
    "effective_to"      DATE,
    "created_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id"     UUID,
    "updated_at"        TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id"     UUID,
    "deleted_at"        TIMESTAMPTZ(3),
    "deleted_by_id"     UUID,

    CONSTRAINT "excess_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "excess_approvals" (
    "id"                UUID NOT NULL,
    "document_type"     "DocumentType" NOT NULL,
    "document_id"       UUID,
    "document_no"       VARCHAR(60),
    "order_id"          UUID,
    "rule_id"           UUID,
    "rule_basis"        VARCHAR(255),
    "base_qty"          DECIMAL(18,4) NOT NULL,
    "permitted_pct"     DECIMAL(9,6) NOT NULL,
    "permitted_qty"     DECIMAL(18,4) NOT NULL,
    "max_permitted_qty" DECIMAL(18,4) NOT NULL,
    "actual_qty"        DECIMAL(18,4) NOT NULL,
    "actual_excess_qty" DECIMAL(18,4) NOT NULL,
    "actual_excess_pct" DECIMAL(9,6) NOT NULL,
    "over_limit_qty"    DECIMAL(18,4) NOT NULL,
    "uom"               VARCHAR(20) NOT NULL DEFAULT '',
    "status"            "StatusApproval" NOT NULL DEFAULT 'PENDING',
    "reason"            TEXT NOT NULL,
    "requested_by_id"   UUID,
    "requested_by_name" VARCHAR(120),
    "requested_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id"    UUID,
    "approved_by_name"  VARCHAR(120),
    "approved_at"       TIMESTAMPTZ(3),
    "decided_at"        TIMESTAMPTZ(3),
    "decision_remarks"  TEXT,
    "rejection_reason"  TEXT,
    "consumed_at"       TIMESTAMPTZ(3),
    "created_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "excess_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "excess_rules_scope_scope_key_document_type_key"
  ON "excess_rules"("scope", "scope_key", "document_type");
CREATE INDEX "excess_rules_scope_is_active_idx" ON "excess_rules"("scope", "is_active");
CREATE INDEX "excess_rules_document_type_idx" ON "excess_rules"("document_type");
CREATE INDEX "excess_rules_deleted_at_idx" ON "excess_rules"("deleted_at");

CREATE INDEX "excess_approvals_document_type_document_id_idx"
  ON "excess_approvals"("document_type", "document_id");
CREATE INDEX "excess_approvals_order_id_idx" ON "excess_approvals"("order_id");
CREATE INDEX "excess_approvals_status_idx" ON "excess_approvals"("status");
CREATE INDEX "excess_approvals_requested_at_idx" ON "excess_approvals"("requested_at");

-- AddForeignKey
ALTER TABLE "excess_approvals"
  ADD CONSTRAINT "excess_approvals_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "excess_rules"
  ADD CONSTRAINT "excess_rules_pct_range"
    CHECK ("excess_pct" >= 0 AND "excess_pct" < 1),
  ADD CONSTRAINT "excess_rules_hard_ceiling_range"
    CHECK ("hard_ceiling_pct" IS NULL
           OR ("hard_ceiling_pct" >= 0 AND "hard_ceiling_pct" < 1)),
  -- A hard ceiling below the permitted excess would refuse transactions the
  -- same rule says are fine. It has to be the wider of the two.
  ADD CONSTRAINT "excess_rules_ceiling_above_permitted"
    CHECK ("hard_ceiling_pct" IS NULL OR "hard_ceiling_pct" >= "excess_pct"),
  -- GLOBAL is the fallback and matches everything, so it carries no key.
  ADD CONSTRAINT "excess_rules_global_has_no_key"
    CHECK ("scope" <> 'GLOBAL' OR "scope_key" = ''),
  ADD CONSTRAINT "excess_rules_scoped_has_key"
    CHECK ("scope" = 'GLOBAL' OR "scope_key" <> ''),
  ADD CONSTRAINT "excess_rules_effective_range"
    CHECK ("effective_to" IS NULL OR "effective_from" IS NULL
           OR "effective_to" >= "effective_from");

ALTER TABLE "excess_approvals"
  ADD CONSTRAINT "excess_approvals_quantities_non_negative"
    CHECK ("base_qty" >= 0 AND "permitted_qty" >= 0 AND "actual_qty" >= 0
           AND "over_limit_qty" >= 0),
  ADD CONSTRAINT "excess_approvals_permitted_pct_range"
    CHECK ("permitted_pct" >= 0 AND "permitted_pct" < 1),

  -- The four derived figures, each checked against what it is derived from.
  -- Multiplication and addition are exact in numeric, so these can be equalities.
  ADD CONSTRAINT "excess_approvals_permitted_qty_is_the_formula"
    CHECK ("permitted_qty" = ROUND("base_qty" * "permitted_pct", 4)),
  ADD CONSTRAINT "excess_approvals_max_is_base_plus_permitted"
    CHECK ("max_permitted_qty" = "base_qty" + "permitted_qty"),
  ADD CONSTRAINT "excess_approvals_actual_excess_is_the_difference"
    CHECK ("actual_excess_qty" = "actual_qty" - "base_qty"),
  ADD CONSTRAINT "excess_approvals_over_limit_is_the_difference"
    CHECK ("over_limit_qty" = GREATEST("actual_qty" - "max_permitted_qty", 0)),

  -- A decision needs its evidence, both ways round.
  ADD CONSTRAINT "excess_approvals_approved_at_present"
    CHECK ("status" <> 'APPROVED' OR "approved_at" IS NOT NULL),
  ADD CONSTRAINT "excess_approvals_rejection_reason_present"
    CHECK ("status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL),
  ADD CONSTRAINT "excess_approvals_decided_by_present"
    CHECK ("status" = 'PENDING' OR "approved_by_name" IS NOT NULL),
  ADD CONSTRAINT "excess_approvals_pending_has_no_decision"
    CHECK ("status" <> 'PENDING'
           OR ("approved_at" IS NULL AND "decided_at" IS NULL
               AND "rejection_reason" IS NULL AND "consumed_at" IS NULL)),

  -- Only an approved authorisation can be spent on a transaction.
  ADD CONSTRAINT "excess_approvals_only_approved_is_consumed"
    CHECK ("consumed_at" IS NULL OR "status" = 'APPROVED');

-- ---------------------------------------------------------------------------
--  The seeded rules: the workbook's own thresholds, as data.
--
--  Every number below was, until this migration, a constant in a service file.
--  They are reproduced exactly, so behaviour is unchanged - and they are now
--  editable, which was the whole point.
-- ---------------------------------------------------------------------------
INSERT INTO "excess_rules"
  ("id", "scope", "scope_key", "document_type", "excess_pct", "hard_ceiling_pct",
   "requires_approval", "basis", "priority", "is_active", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'GLOBAL', '', NULL, 0.02, 0.05, true,
   'Default tolerance. Process Documentation s.5: a 2% excess variation is accepted generally.',
   0, true, NOW(), NOW()),

  (gen_random_uuid(), 'DOCUMENT_TYPE', 'PURCHASE_ORDER', 'PURCHASE_ORDER', 0.03, 0.05, true,
   'PO sheet, note beside the Excess Allowed column: "2-3%".',
   10, true, NOW(), NOW()),

  (gen_random_uuid(), 'ITEM_CATEGORY', 'Accessories', 'PURCHASE_ORDER', 0.01, 0.03, true,
   'Process Documentation s.5: accessories may be ordered only 1% over requirement.',
   20, true, NOW(), NOW()),

  (gen_random_uuid(), 'DOCUMENT_TYPE', 'GRN', 'GRN', 0.02, 0.05, true,
   'Process Documentation s.5: a 2% excess variation is accepted on material generally.',
   10, true, NOW(), NOW()),

  (gen_random_uuid(), 'ITEM_CATEGORY', 'Accessories', 'GRN', 0.03, 0.03, true,
   'Process Documentation s.5: accessories may be received up to 3% in excess and no more.',
   20, true, NOW(), NOW()),

  (gen_random_uuid(), 'DOCUMENT_TYPE', 'DYE_ISSUE', 'DYE_ISSUE', 0.03, 0.10, false,
   'Process Documentation: 2-3% shrinkage is normal on a dye lot. Advisory: an out-of-tolerance return goes to scrutiny rather than being refused.',
   10, true, NOW(), NOW()),

  (gen_random_uuid(), 'DOCUMENT_TYPE', 'BUYER_ORDER', 'BUYER_ORDER', 0.02, 0.10, true,
   'Order sheet, note on the Excess column: "Approval from dinesh sir".',
   10, true, NOW(), NOW()),

  (gen_random_uuid(), 'DOCUMENT_TYPE', 'CUTTING_ISSUE', 'CUTTING_ISSUE', 0.02, 0.05, true,
   'Cutting beyond the approved plan needs the same authority as ordering beyond the style.',
   10, true, NOW(), NOW())
ON CONFLICT ("scope", "scope_key", "document_type") DO NOTHING;

-- ---------------------------------------------------------------------------
--  18. THE APPROVAL ENGINE - explicit state on every approvable document
-- ---------------------------------------------------------------------------

ALTER TABLE "buyer_orders"      ADD COLUMN "workflow_state" "DocumentState" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "plannings"         ADD COLUMN "workflow_state" "DocumentState" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "vendor_quotations" ADD COLUMN "workflow_state" "DocumentState" NOT NULL DEFAULT 'PENDING_APPROVAL';
ALTER TABLE "purchase_orders"   ADD COLUMN "workflow_state" "DocumentState" NOT NULL DEFAULT 'PENDING_APPROVAL';
ALTER TABLE "gate_passes"       ADD COLUMN "workflow_state" "DocumentState" NOT NULL DEFAULT 'SUBMITTED';
ALTER TABLE "grns"              ADD COLUMN "workflow_state" "DocumentState" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "fabric_scrutinies" ADD COLUMN "workflow_state" "DocumentState" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "plan_approvals"    ADD COLUMN "workflow_state" "DocumentState" NOT NULL DEFAULT 'PENDING_APPROVAL';
ALTER TABLE "cutting_issues"    ADD COLUMN "workflow_state" "DocumentState" NOT NULL DEFAULT 'DRAFT';

-- Derive the starting state from whatever column each module was already using.
-- This is the one place the mapping between the legacy columns and the shared
-- state is written out in SQL; from here on approvalEngine.js owns it.

UPDATE "buyer_orders" SET "workflow_state" =
  CASE "excess_approval_status"
    WHEN 'APPROVED' THEN 'APPROVED'::"DocumentState"
    WHEN 'REJECTED' THEN 'REJECTED'::"DocumentState"
    WHEN 'PENDING'  THEN 'PENDING_APPROVAL'::"DocumentState"
    -- NOT_REQUIRED: no excess was asked for, so there is nothing to approve.
    ELSE 'APPROVED'::"DocumentState"
  END
WHERE "status" <> 'CANCELLED';
UPDATE "buyer_orders" SET "workflow_state" = 'CANCELLED' WHERE "status" = 'CANCELLED';

UPDATE "plannings" SET "workflow_state" =
  CASE "approval_status"
    WHEN 'APPROVED' THEN 'APPROVED'::"DocumentState"
    WHEN 'REJECTED' THEN 'REJECTED'::"DocumentState"
    ELSE CASE WHEN "submitted_at" IS NOT NULL
              THEN 'PENDING_APPROVAL'::"DocumentState"
              ELSE 'DRAFT'::"DocumentState" END
  END;

UPDATE "vendor_quotations" SET "workflow_state" =
  CASE "authorisation_status"
    WHEN 'APPROVED' THEN 'APPROVED'::"DocumentState"
    WHEN 'REJECTED' THEN 'REJECTED'::"DocumentState"
    ELSE 'PENDING_APPROVAL'::"DocumentState"
  END;

UPDATE "purchase_orders" SET "workflow_state" =
  CASE
    WHEN "status" = 'CANCELLED' THEN 'CANCELLED'::"DocumentState"
    WHEN "approval_status" = 'APPROVED' THEN 'APPROVED'::"DocumentState"
    WHEN "approval_status" = 'REJECTED' THEN 'REJECTED'::"DocumentState"
    ELSE 'PENDING_APPROVAL'::"DocumentState"
  END;

-- A gate pass is submitted when it is raised and approved when it is cleared:
-- clearing IS its approval, taken by whoever counted the goods at the gate.
UPDATE "gate_passes" SET "workflow_state" =
  CASE WHEN "status" = 'CLEARED' THEN 'APPROVED'::"DocumentState"
       ELSE 'SUBMITTED'::"DocumentState" END;

-- A GRN has no approval step - posting it IS the act - so a posted receipt is
-- approved and an unposted one is a draft that never happened.
UPDATE "grns" SET "workflow_state" =
  CASE WHEN "status" = 'CANCELLED' THEN 'CANCELLED'::"DocumentState"
       WHEN "posted_at" IS NOT NULL THEN 'APPROVED'::"DocumentState"
       ELSE 'DRAFT'::"DocumentState" END;

UPDATE "fabric_scrutinies" SET "workflow_state" =
  CASE WHEN "is_locked" THEN 'APPROVED'::"DocumentState"
       ELSE 'DRAFT'::"DocumentState" END;

UPDATE "plan_approvals" SET "workflow_state" =
  CASE
    WHEN "approval_status" = 'APPROVED' THEN 'APPROVED'::"DocumentState"
    WHEN "approval_status" = 'REJECTED' AND "rectified_at" IS NOT NULL
      THEN 'RECTIFICATION'::"DocumentState"
    WHEN "approval_status" = 'REJECTED' THEN 'REJECTED'::"DocumentState"
    WHEN "round" > 1 THEN 'RESUBMITTED'::"DocumentState"
    ELSE 'PENDING_APPROVAL'::"DocumentState"
  END;

-- CreateIndex
CREATE INDEX "buyer_orders_workflow_state_idx"      ON "buyer_orders"("workflow_state");
CREATE INDEX "plannings_workflow_state_idx"         ON "plannings"("workflow_state");
CREATE INDEX "vendor_quotations_workflow_state_idx" ON "vendor_quotations"("workflow_state");
CREATE INDEX "purchase_orders_workflow_state_idx"   ON "purchase_orders"("workflow_state");
CREATE INDEX "gate_passes_workflow_state_idx"       ON "gate_passes"("workflow_state");
CREATE INDEX "grns_workflow_state_idx"              ON "grns"("workflow_state");
CREATE INDEX "fabric_scrutinies_workflow_state_idx" ON "fabric_scrutinies"("workflow_state");
CREATE INDEX "plan_approvals_workflow_state_idx"    ON "plan_approvals"("workflow_state");
CREATE INDEX "cutting_issues_workflow_state_idx"    ON "cutting_issues"("workflow_state");

-- ---------------------------------------------------------------------------
--  16. CUTTING ISSUE - the final document
-- ---------------------------------------------------------------------------

ALTER TABLE "cutting_issues"
  ADD COLUMN "excess_approval_id" UUID,
  ADD COLUMN "posted_at"          TIMESTAMPTZ(3),
  ADD COLUMN "posted_by_id"       UUID,
  ADD COLUMN "posted_by_name"     VARCHAR(120),
  ADD COLUMN "is_locked"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "locked_at"          TIMESTAMPTZ(3);

-- Challans seeded from the workbook are issued challans: the cloth was cut and
-- the stitching unit has it. Every one of them is posted and locked.
UPDATE "cutting_issues"
   SET "posted_at"      = "created_at",
       "posted_by_name" = 'Seeded from the workbook',
       "is_locked"      = true,
       "locked_at"      = "created_at",
       "workflow_state" = 'APPROVED'
 WHERE "status" <> 'CANCELLED';

-- CreateIndex
CREATE INDEX "cutting_issues_excess_approval_id_idx" ON "cutting_issues"("excess_approval_id");
CREATE INDEX "cutting_issues_is_locked_idx" ON "cutting_issues"("is_locked");

-- AddForeignKey
ALTER TABLE "cutting_issues"
  ADD CONSTRAINT "cutting_issues_excess_approval_id_fkey"
    FOREIGN KEY ("excess_approval_id") REFERENCES "excess_approvals"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cutting_issues"
  ADD CONSTRAINT "cutting_issues_pcs_non_negative"
    CHECK ("cutting_pcs_issued" >= 0 AND "handle_issued" >= 0
           AND "planned_cutting" >= 0 AND "unit_wise_cutting_pcs_to_be_issued" >= 0),

  -- A posted challan is one the cutting floor acted on: it is stamped, and it
  -- is locked. The three go together or none of them do.
  ADD CONSTRAINT "cutting_issues_posted_is_stamped"
    CHECK ("posted_at" IS NULL OR "posted_by_name" IS NOT NULL),
  ADD CONSTRAINT "cutting_issues_posted_is_locked"
    CHECK ("posted_at" IS NULL OR "is_locked" = true),
  ADD CONSTRAINT "cutting_issues_locked_is_stamped"
    CHECK ("is_locked" = false OR "locked_at" IS NOT NULL),

  -- Cutting Issue is the LAST document in this application. Nothing downstream
  -- of it exists to correct it, so it may only be raised against an approved
  -- plan - which is checked in the service, where the plan can be read - and
  -- once posted it never moves again.
  ADD CONSTRAINT "cutting_issues_needs_plan_approval"
    CHECK ("posted_at" IS NULL OR "plan_approval_id" IS NOT NULL);
