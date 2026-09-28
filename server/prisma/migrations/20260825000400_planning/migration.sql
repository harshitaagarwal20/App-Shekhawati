-- ===========================================================================
--  Phase 4 - Planning: server-calculated allocation and the approval flow
--
--  Current Process.xlsx -> Planning sheet: "Sum should match Order Qty".
--  Phase 0 recorded that as a cross-row rule for the service layer rather than
--  a CHECK. This migration gives the rule somewhere to live: planned_qty and
--  planned_cutting_pcs are recomputed from the lines on every write, and the
--  service refuses any plan whose planned_qty exceeds the order's
--  effective_qty - the ceiling that already embeds the Director's approved
--  excess and nothing more.
--
--  It also lifts the approval decision onto the plan header. PlanApproval
--  stays the per-round log; these columns are the current state, exactly as
--  buyer_orders carries the excess decision beside approval_history.
-- ===========================================================================

-- AlterTable
ALTER TABLE "plannings"
  ADD COLUMN "planned_qty"          DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "planned_cutting_pcs"  DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "submitted_to"         VARCHAR(120),
  ADD COLUMN "submitted_at"         TIMESTAMPTZ(3),
  ADD COLUMN "submitted_by_id"      UUID,
  ADD COLUMN "submitted_by_name"    VARCHAR(120),
  ADD COLUMN "approved_at"          TIMESTAMPTZ(3),
  ADD COLUMN "approved_by_id"       UUID,
  ADD COLUMN "approved_by_name"     VARCHAR(120),
  ADD COLUMN "rejection_reason"     TEXT;

-- ---------------------------------------------------------------------------
--  Backfill from the lines that already exist.
--
--  Plans seeded from the workbook are live plans, not drafts: every one of
--  them appears on the Plan Approval sheet as submitted, so submitted_at is
--  stamped and the approved rows carry their decision.
-- ---------------------------------------------------------------------------
UPDATE "plannings" p
   SET "planned_qty" = COALESCE(t."qty", 0),
       "planned_cutting_pcs" = COALESCE(t."pcs", 0)
  FROM (
    SELECT "planning_id",
           SUM("deliverable_size")                AS "qty",
           SUM(COALESCE("cutting_pcs_allotted",0)) AS "pcs"
      FROM "planning_lines"
     WHERE "deleted_at" IS NULL
     GROUP BY "planning_id"
  ) t
 WHERE t."planning_id" = p."id";

UPDATE "plannings"
   SET "submitted_to"      = 'Dinesh Sir',
       "submitted_by_name" = 'Vinay ji (GM)',
       "submitted_at"      = "created_at",
       "approved_at"       = CASE WHEN "approval_status" = 'APPROVED' THEN "created_at" END,
       "approved_by_name"  = CASE WHEN "approval_status" = 'APPROVED' THEN 'Dinesh Sir' END,
       "rejection_reason"  = CASE WHEN "approval_status" = 'REJECTED'
                                  THEN 'Rejected before this system was in use' END;

-- CreateIndex
CREATE INDEX "plannings_submitted_at_idx" ON "plannings"("submitted_at");

-- ---------------------------------------------------------------------------
--  Constraints
--
--  The ceiling itself (planned_qty <= buyer_orders.effective_qty) spans two
--  tables and cannot be a CHECK; it is enforced in planning.service.js on
--  every create, edit, submit and approval. What CAN be checked row-locally
--  is checked here.
-- ---------------------------------------------------------------------------
ALTER TABLE "plannings"
  ADD CONSTRAINT "plannings_planned_qty_non_negative"
    CHECK ("planned_qty" >= 0),
  ADD CONSTRAINT "plannings_planned_cutting_pcs_non_negative"
    CHECK ("planned_cutting_pcs" >= 0),

  -- A decision needs its evidence, both ways round.
  ADD CONSTRAINT "plannings_approved_at_present"
    CHECK ("approval_status" <> 'APPROVED' OR "approved_at" IS NOT NULL),
  ADD CONSTRAINT "plannings_rejection_reason_present"
    CHECK ("approval_status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL),

  -- Nothing is decided that was never submitted.
  ADD CONSTRAINT "plannings_decision_needs_submission"
    CHECK ("approval_status" = 'PENDING' OR "submitted_at" IS NOT NULL);

-- A day cannot have more pieces allotted to cutting than it is due to deliver.
ALTER TABLE "planning_lines"
  ADD CONSTRAINT "planning_lines_allotted_within_deliverable"
    CHECK ("cutting_pcs_allotted" IS NULL
           OR "cutting_pcs_allotted" <= "deliverable_size");
