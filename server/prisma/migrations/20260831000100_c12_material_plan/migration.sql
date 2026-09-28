-- ===========================================================================
--  C12 - MATERIAL PLAN
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   THE PANEL THAT WAS NEVER A DOCUMENT
--
--   The office plans its raw material - fabric AND accessories - the same way
--   it plans cutting, stitching and shipping: somebody works out what the
--   order consumes, and somebody senior signs it before procurement goes to
--   the market.
--
--   The arithmetic for that has existed since C9. domain/requirement.js
--   explodes the Style BOM into a per-item requirement, buyerOrder.service.js
--   presents it in three views, and the Buyer Order screen has shown it all
--   along. What it has never been is a DOCUMENT. It was a derived panel,
--   recomputed on every read - nobody prepared it, nobody signed it, and there
--   was no version of it to point back to once the BOM moved.
--
--   These two tables are that panel turned into a document: prepared by
--   planning, submitted, signed, versioned on rejection.
--
--   ---------------------------------------------------------------------------
--   THE LINES ARE COPIES, AND THAT IS THE WHOLE POINT
--
--   A plan that recalculates itself is a report, not a plan. Wastage gets
--   renegotiated, an accessory gets substituted, an average utilisation gets
--   corrected - and a document somebody has signed must not change underneath
--   the signature.
--
--   Every line therefore carries the figures AS THEY STOOD when the plan was
--   raised: avg_utilisation_per_piece, wastage_pct, base_requirement,
--   required_qty, and requirement_basis spelling out the multiplication in
--   words so it can be re-checked by hand a year later. The header freezes the
--   two quantities it was worked out against, order_qty and effective_qty.
--
--   This is the same reasoning that already freezes
--   purchase_orders.computed_requirement_qty and
--   cutting_challan_lines.computed_requirement_qty. Nothing new is being
--   asserted here; an existing rule is being applied to a new document.
--
--   ---------------------------------------------------------------------------
--   [A] ONLY - IT AUTHORISES, IT DOES NOT BUY
--
--   Approving a material plan is a signature on a shopping list. It moves no
--   stock, raises no purchase order and reserves nothing, and it does NOT gate
--   a PO: procurement stays bounded by the style requirement ceiling that has
--   bounded it since C9. That was the office's decision, and it is recorded
--   here because the absence of a gate is easy to mistake for an oversight.
--
--   If a gate is wanted later it is a check in purchaseOrder.service.js
--   against an approved plan line - no schema change, which is part of why
--   the plan carries frozen per-line quantities rather than a total.
--
--   ---------------------------------------------------------------------------
--   NO BACKFILL
--
--   Existing orders get no retrospective material plan. Inventing one would
--   put a signed document in the system that nobody signed, and the
--   requirement panel those orders were bought against is still there and
--   still correct. History stays readable; new work gets the document.
--  ---------------------------------------------------------------------------

-- --- 1. The document type -------------------------------------------------
--
-- Placed before CUTTING_CHALLAN, which is the order the work happens in:
-- the material plan says what to buy, the challan says what to cut.

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'MATERIAL_PLAN' BEFORE 'CUTTING_CHALLAN';

-- --- 2. The plan header ---------------------------------------------------

CREATE TABLE "material_plans" (
    "id" UUID NOT NULL,
    "workflow_state" "DocumentState" NOT NULL DEFAULT 'DRAFT',
    "plan_no" VARCHAR(40) NOT NULL,
    "plan_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "container_no" VARCHAR(40),
    "order_qty" DECIMAL(18,4) NOT NULL,
    "effective_qty" DECIMAL(18,4) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "approval_status" "StatusApproval" NOT NULL DEFAULT 'PENDING',
    "submitted_to" VARCHAR(120),
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_by_id" UUID,
    "submitted_by_name" VARCHAR(120),
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "approved_by_name" VARCHAR(120),
    "decided_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "material_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_plans_plan_no_key" ON "material_plans"("plan_no");
CREATE UNIQUE INDEX "material_plans_order_id_style_id_version_key"
  ON "material_plans"("order_id", "style_id", "version");
CREATE INDEX "material_plans_order_id_idx" ON "material_plans"("order_id");
CREATE INDEX "material_plans_style_id_idx" ON "material_plans"("style_id");
CREATE INDEX "material_plans_plan_date_idx" ON "material_plans"("plan_date");
CREATE INDEX "material_plans_approval_status_idx" ON "material_plans"("approval_status");
CREATE INDEX "material_plans_workflow_state_idx" ON "material_plans"("workflow_state");
CREATE INDEX "material_plans_container_no_idx" ON "material_plans"("container_no");
CREATE INDEX "material_plans_deleted_at_idx" ON "material_plans"("deleted_at");

ALTER TABLE "material_plans"
  ADD CONSTRAINT "material_plans_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "material_plans_style_id_fkey"
  FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "material_plans"
  ADD CONSTRAINT "material_plans_version_positive" CHECK ("version" > 0),
  -- Planning for nothing is not a plan.
  ADD CONSTRAINT "material_plans_order_qty_positive" CHECK ("order_qty" > 0),
  -- The approved excess can only ever ADD to what was ordered. A plan worked
  -- out against less than the order quantity is an arithmetic error, not a
  -- tighter plan.
  ADD CONSTRAINT "material_plans_effective_qty_at_least_order_qty"
  CHECK ("effective_qty" >= "order_qty"),
  -- An approval is stamped, not typed. Same rule the rest of the pipeline uses.
  ADD CONSTRAINT "material_plans_approval_is_attributed"
  CHECK (("approved_at" IS NULL) = ("approved_by_name" IS NULL)),
  -- A submission is stamped the same way.
  ADD CONSTRAINT "material_plans_submission_is_attributed"
  CHECK (("submitted_at" IS NULL) = ("submitted_by_name" IS NULL)),
  -- A rejection that does not say why is not a decision anybody can act on.
  ADD CONSTRAINT "material_plans_rejection_has_a_reason"
  CHECK ("approval_status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL);

-- --- 3. The plan lines ----------------------------------------------------

CREATE TABLE "material_plan_lines" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_category" VARCHAR(60) NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "sub_category" VARCHAR(60),
    "accessories_item" VARCHAR(80),
    "color_code" VARCHAR(60),
    "content" VARCHAR(80),
    "gsm" VARCHAR(20),
    "count" VARCHAR(20),
    "description" VARCHAR(200),
    "hsn_code" VARCHAR(20),
    "uom" VARCHAR(20) NOT NULL,
    "avg_utilisation_per_piece" DECIMAL(18,4) NOT NULL,
    "wastage_pct" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "base_requirement" DECIMAL(18,4) NOT NULL,
    "required_qty" DECIMAL(18,4) NOT NULL,
    "requirement_basis" TEXT,
    "bom_line_no" INTEGER,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "material_plan_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_plan_lines_plan_id_line_no_key"
  ON "material_plan_lines"("plan_id", "line_no");
CREATE INDEX "material_plan_lines_plan_id_idx" ON "material_plan_lines"("plan_id");
CREATE INDEX "material_plan_lines_category_idx" ON "material_plan_lines"("category");
CREATE INDEX "material_plan_lines_deleted_at_idx" ON "material_plan_lines"("deleted_at");

ALTER TABLE "material_plan_lines"
  ADD CONSTRAINT "material_plan_lines_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "material_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "material_plan_lines"
  ADD CONSTRAINT "material_plan_lines_line_no_positive" CHECK ("line_no" > 0),
  -- A material nobody consumes does not belong on a requirement.
  ADD CONSTRAINT "material_plan_lines_utilisation_positive"
  CHECK ("avg_utilisation_per_piece" > 0),
  ADD CONSTRAINT "material_plan_lines_wastage_non_negative" CHECK ("wastage_pct" >= 0),
  ADD CONSTRAINT "material_plan_lines_base_requirement_positive" CHECK ("base_requirement" > 0),
  ADD CONSTRAINT "material_plan_lines_required_qty_positive" CHECK ("required_qty" > 0),
  -- Wastage and approved excess can only ADD. A required quantity below the
  -- base requirement means the two were computed from different figures.
  ADD CONSTRAINT "material_plan_lines_required_at_least_base"
  CHECK ("required_qty" >= "base_requirement");

-- --- 4. The permissions ---------------------------------------------------
--
-- Rule 8 of the brief: do not hardcode approvers. No role is named below.
-- Each new permission is granted to exactly the roles that ALREADY hold the
-- closest existing equivalent, so the office's own decisions about who does
-- what carry forward and nothing here asserts a new one:
--
--   MATERIAL_PLAN.VIEW/CREATE/EDIT/DELETE -> whoever holds the same on
--       PLANNING, because preparing the raw material plan is the same desk
--       that prepares the cutting, stitching and shipping plans.
--   MATERIAL_PLAN.APPROVE -> whoever holds PLAN_APPROVAL.APPROVE, because
--       the same office signs every plan.
--
-- MAKER-CHECKER IS SEPARATE AND IS NOT A PERMISSION. Holding
-- MATERIAL_PLAN.APPROVE does not let you approve YOUR OWN plan -
-- domain/makerChecker.js refuses that regardless of role.

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.module, v.action, v.description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('MATERIAL_PLAN.VIEW', 'MATERIAL_PLAN', 'VIEW',
     'C12: see the raw material plans - what fabric and accessories an order needs bought in.'),
    ('MATERIAL_PLAN.CREATE', 'MATERIAL_PLAN', 'CREATE',
     'C12: raise a raw material plan from the style BOM for an order.'),
    ('MATERIAL_PLAN.EDIT', 'MATERIAL_PLAN', 'EDIT',
     'C12: amend a raw material plan while it is still a draft.'),
    ('MATERIAL_PLAN.DELETE', 'MATERIAL_PLAN', 'DELETE',
     'C12: delete a draft raw material plan.'),
    ('MATERIAL_PLAN.EXPORT', 'MATERIAL_PLAN', 'EXPORT',
     'C12: export raw material plans.'),
    ('MATERIAL_PLAN.APPROVE', 'MATERIAL_PLAN', 'APPROVE',
     'C12: sign off a raw material plan before procurement goes to the market.')
  ) AS v(code, module, action, description)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT rp."role_id", np."id", CURRENT_TIMESTAMP
  FROM (VALUES
    ('MATERIAL_PLAN.VIEW',    'PLANNING.VIEW'),
    ('MATERIAL_PLAN.CREATE',  'PLANNING.CREATE'),
    ('MATERIAL_PLAN.EDIT',    'PLANNING.EDIT'),
    ('MATERIAL_PLAN.DELETE',  'PLANNING.DELETE'),
    ('MATERIAL_PLAN.EXPORT',  'PLANNING.EXPORT'),
    ('MATERIAL_PLAN.APPROVE', 'PLAN_APPROVAL.APPROVE')
  ) AS m(new_code, like_code)
  JOIN "permissions" np ON np."code" = m.new_code
  JOIN "permissions" lp ON lp."code" = m.like_code
  JOIN "role_permissions" rp ON rp."permission_id" = lp."id"
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x
    WHERE x."role_id" = rp."role_id" AND x."permission_id" = np."id"
 );
