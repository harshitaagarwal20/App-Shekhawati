-- ===========================================================================
--  PHASE 4 - EXTERNAL QC AND THE ALTERATION UNIT
-- ===========================================================================
--
--    ironing_entries            + source: Stitching unit / Re-iron (from
--                               External QC) / From Alteration Unit. Only a
--                               stitching unit names from_unit.
--    external_qc_entries        offered = approved + alteration + rejected,
--                               each faulty box broken down by reason
--    external_qc_checker_lines  the checker codes faulty pieces were traced to
--    external_qc_attachments    the agency's inspection report (photo / PDF)
--    alteration_receipts        the bags in the Alteration Unit - from External
--                               QC (any reason but Iron) and from ironing
--    alteration_entries         pieces altered / cleaned, pieces not repairable
--    rejected_register_entries  the Rejected Register (stage Alteration Unit)
--
--  Then: every PENDING pending reject from Phase 3 is converted into a bag in
--  the Alteration Unit, and the permissions, roles, grants and the Alteration
--  department are added. Idempotent reference data - db:deploy is all it needs.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "IroningSource" AS ENUM ('STITCHING_UNIT', 'RE_IRON', 'ALTERATION_UNIT');

-- CreateEnum
CREATE TYPE "QcBox" AS ENUM ('ALTERATION', 'REJECTED');

-- CreateEnum
CREATE TYPE "AlterationSource" AS ENUM ('EXTERNAL_QC', 'IRONING');

-- CreateEnum
CREATE TYPE "AlterationBagStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RejectStage" AS ENUM ('ALTERATION_UNIT');

-- AlterTable
ALTER TABLE "ironing_entries" ADD COLUMN     "source" "IroningSource" NOT NULL DEFAULT 'STITCHING_UNIT',
ALTER COLUMN "from_unit" DROP NOT NULL;

-- CreateTable
CREATE TABLE "external_qc_entries" (
    "id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "inspector_name" VARCHAR(120),
    "pcs_offered" DECIMAL(18,4) NOT NULL,
    "pcs_approved" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pcs_alteration" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pcs_rejected" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "alt_alter" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "alt_iron" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "alt_defected" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "alt_spoiled" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "alt_other" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rej_alter" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rej_iron" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rej_defected" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rej_spoiled" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rej_other" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "external_qc_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_qc_checker_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "checker_code" VARCHAR(30) NOT NULL,
    "employee_id" UUID,
    "pcs" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "external_qc_checker_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_qc_attachments" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_id" UUID,
    "uploaded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "external_qc_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alteration_receipts" (
    "id" UUID NOT NULL,
    "received_date" DATE NOT NULL,
    "source" "AlterationSource" NOT NULL,
    "external_qc_entry_id" UUID,
    "box" "QcBox",
    "ironing_entry_id" UUID,
    "pending_reject_id" UUID,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "unit" VARCHAR(80),
    "reason" VARCHAR(60) NOT NULL,
    "defect_type" VARCHAR(60),
    "qty" DECIMAL(18,4) NOT NULL,
    "pcs_altered" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pcs_not_repairable" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "AlterationBagStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "alteration_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alteration_entries" (
    "id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "receipt_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "pcs_altered" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pcs_not_repairable" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "not_repairable_reason" VARCHAR(200),
    "staff_id" UUID NOT NULL,
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "alteration_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rejected_register_entries" (
    "id" UUID NOT NULL,
    "reject_date" DATE NOT NULL,
    "stage" "RejectStage" NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "unit" VARCHAR(80),
    "qty" DECIMAL(18,4) NOT NULL,
    "reason" VARCHAR(60) NOT NULL,
    "defect_type" VARCHAR(60),
    "origin" "AlterationSource" NOT NULL,
    "not_repairable_reason" VARCHAR(200),
    "alteration_entry_id" UUID,
    "alteration_receipt_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "rejected_register_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_qc_entries_order_id_style_id_idx" ON "external_qc_entries"("order_id", "style_id");

-- CreateIndex
CREATE INDEX "external_qc_entries_entry_date_idx" ON "external_qc_entries"("entry_date");

-- CreateIndex
CREATE INDEX "external_qc_entries_agency_id_idx" ON "external_qc_entries"("agency_id");

-- CreateIndex
CREATE INDEX "external_qc_entries_deleted_at_idx" ON "external_qc_entries"("deleted_at");

-- CreateIndex
CREATE INDEX "external_qc_checker_lines_checker_code_idx" ON "external_qc_checker_lines"("checker_code");

-- CreateIndex
CREATE INDEX "external_qc_checker_lines_employee_id_idx" ON "external_qc_checker_lines"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_qc_checker_lines_entry_id_checker_code_key" ON "external_qc_checker_lines"("entry_id", "checker_code");

-- CreateIndex
CREATE INDEX "external_qc_attachments_entry_id_idx" ON "external_qc_attachments"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "alteration_receipts_ironing_entry_id_key" ON "alteration_receipts"("ironing_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "alteration_receipts_pending_reject_id_key" ON "alteration_receipts"("pending_reject_id");

-- CreateIndex
CREATE INDEX "alteration_receipts_order_id_style_id_idx" ON "alteration_receipts"("order_id", "style_id");

-- CreateIndex
CREATE INDEX "alteration_receipts_status_idx" ON "alteration_receipts"("status");

-- CreateIndex
CREATE INDEX "alteration_receipts_received_date_idx" ON "alteration_receipts"("received_date");

-- CreateIndex
CREATE UNIQUE INDEX "alteration_receipts_external_qc_entry_id_box_reason_key" ON "alteration_receipts"("external_qc_entry_id", "box", "reason");

-- CreateIndex
CREATE INDEX "alteration_entries_receipt_id_idx" ON "alteration_entries"("receipt_id");

-- CreateIndex
CREATE INDEX "alteration_entries_order_id_style_id_idx" ON "alteration_entries"("order_id", "style_id");

-- CreateIndex
CREATE INDEX "alteration_entries_entry_date_idx" ON "alteration_entries"("entry_date");

-- CreateIndex
CREATE INDEX "alteration_entries_staff_id_idx" ON "alteration_entries"("staff_id");

-- CreateIndex
CREATE INDEX "alteration_entries_deleted_at_idx" ON "alteration_entries"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "rejected_register_entries_alteration_entry_id_key" ON "rejected_register_entries"("alteration_entry_id");

-- CreateIndex
CREATE INDEX "rejected_register_entries_order_id_style_id_idx" ON "rejected_register_entries"("order_id", "style_id");

-- CreateIndex
CREATE INDEX "rejected_register_entries_reject_date_idx" ON "rejected_register_entries"("reject_date");

-- CreateIndex
CREATE INDEX "rejected_register_entries_stage_idx" ON "rejected_register_entries"("stage");

-- CreateIndex
CREATE INDEX "rejected_register_entries_deleted_at_idx" ON "rejected_register_entries"("deleted_at");

-- CreateIndex
CREATE INDEX "ironing_entries_source_order_id_style_id_idx" ON "ironing_entries"("source", "order_id", "style_id");

-- AddForeignKey
ALTER TABLE "external_qc_entries" ADD CONSTRAINT "external_qc_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_qc_entries" ADD CONSTRAINT "external_qc_entries_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_qc_entries" ADD CONSTRAINT "external_qc_entries_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_qc_checker_lines" ADD CONSTRAINT "external_qc_checker_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "external_qc_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_qc_checker_lines" ADD CONSTRAINT "external_qc_checker_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_qc_attachments" ADD CONSTRAINT "external_qc_attachments_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "external_qc_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alteration_receipts" ADD CONSTRAINT "alteration_receipts_external_qc_entry_id_fkey" FOREIGN KEY ("external_qc_entry_id") REFERENCES "external_qc_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alteration_receipts" ADD CONSTRAINT "alteration_receipts_ironing_entry_id_fkey" FOREIGN KEY ("ironing_entry_id") REFERENCES "ironing_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alteration_receipts" ADD CONSTRAINT "alteration_receipts_pending_reject_id_fkey" FOREIGN KEY ("pending_reject_id") REFERENCES "pending_rejects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alteration_receipts" ADD CONSTRAINT "alteration_receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alteration_receipts" ADD CONSTRAINT "alteration_receipts_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alteration_entries" ADD CONSTRAINT "alteration_entries_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "alteration_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alteration_entries" ADD CONSTRAINT "alteration_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alteration_entries" ADD CONSTRAINT "alteration_entries_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alteration_entries" ADD CONSTRAINT "alteration_entries_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_register_entries" ADD CONSTRAINT "rejected_register_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_register_entries" ADD CONSTRAINT "rejected_register_entries_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_register_entries" ADD CONSTRAINT "rejected_register_entries_alteration_entry_id_fkey" FOREIGN KEY ("alteration_entry_id") REFERENCES "alteration_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_register_entries" ADD CONSTRAINT "rejected_register_entries_alteration_receipt_id_fkey" FOREIGN KEY ("alteration_receipt_id") REFERENCES "alteration_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- --- The arithmetic, held in the database as well as the service ----------

ALTER TABLE "ironing_entries"
  -- A stitching unit is named exactly when the pieces came from one.
  ADD CONSTRAINT "ironing_entries_unit_iff_stitching" CHECK (
    ("source" = 'STITCHING_UNIT') = ("from_unit" IS NOT NULL)
  );

ALTER TABLE "external_qc_entries"
  ADD CONSTRAINT "external_qc_entries_non_negative" CHECK (
    "pcs_offered" > 0 AND "pcs_approved" >= 0 AND "pcs_alteration" >= 0 AND "pcs_rejected" >= 0
    AND "alt_alter" >= 0 AND "alt_iron" >= 0 AND "alt_defected" >= 0 AND "alt_spoiled" >= 0 AND "alt_other" >= 0
    AND "rej_alter" >= 0 AND "rej_iron" >= 0 AND "rej_defected" >= 0 AND "rej_spoiled" >= 0 AND "rej_other" >= 0
  ),
  -- Every piece offered is in exactly one box.
  ADD CONSTRAINT "external_qc_entries_boxes_equal_offered" CHECK (
    "pcs_approved" + "pcs_alteration" + "pcs_rejected" = "pcs_offered"
  ),
  -- Every piece in a faulty box has exactly one reason.
  ADD CONSTRAINT "external_qc_entries_alteration_reasons_add_up" CHECK (
    "alt_alter" + "alt_iron" + "alt_defected" + "alt_spoiled" + "alt_other" = "pcs_alteration"
  ),
  ADD CONSTRAINT "external_qc_entries_rejected_reasons_add_up" CHECK (
    "rej_alter" + "rej_iron" + "rej_defected" + "rej_spoiled" + "rej_other" = "pcs_rejected"
  );

ALTER TABLE "external_qc_checker_lines"
  ADD CONSTRAINT "external_qc_checker_lines_pcs_positive" CHECK ("pcs" > 0),
  ADD CONSTRAINT "external_qc_checker_lines_code_not_blank" CHECK (length(trim("checker_code")) > 0);

ALTER TABLE "alteration_receipts"
  ADD CONSTRAINT "alteration_receipts_non_negative" CHECK (
    "qty" >= 0 AND "pcs_altered" >= 0 AND "pcs_not_repairable" >= 0
  ),
  -- Altered + not repairable never exceed what the bag holds.
  ADD CONSTRAINT "alteration_receipts_worked_within_qty" CHECK (
    "pcs_altered" + "pcs_not_repairable" <= "qty"
  ),
  ADD CONSTRAINT "alteration_receipts_source_link" CHECK (
    ("source" = 'EXTERNAL_QC' AND "external_qc_entry_id" IS NOT NULL AND "box" IS NOT NULL AND "ironing_entry_id" IS NULL)
    OR ("source" = 'IRONING' AND "ironing_entry_id" IS NOT NULL AND "external_qc_entry_id" IS NULL AND "box" IS NULL)
  ),
  -- Iron is not a bag: those pieces go back to ironing.
  ADD CONSTRAINT "alteration_receipts_never_iron" CHECK ("reason" <> 'Iron');

ALTER TABLE "alteration_entries"
  ADD CONSTRAINT "alteration_entries_non_negative" CHECK (
    "pcs_altered" >= 0 AND "pcs_not_repairable" >= 0
  ),
  ADD CONSTRAINT "alteration_entries_says_something" CHECK (
    "pcs_altered" + "pcs_not_repairable" > 0
  ),
  ADD CONSTRAINT "alteration_entries_not_repairable_has_reason" CHECK (
    "pcs_not_repairable" = 0 OR "not_repairable_reason" IS NOT NULL
  );

ALTER TABLE "rejected_register_entries"
  ADD CONSTRAINT "rejected_register_entries_qty_positive" CHECK ("qty" > 0);

-- --- Phase 3's pending rejects become bags in the Alteration Unit ---------
--
--  Every piece rejected at ironing while there was nowhere to send it. The
--  bag keeps the reason ("Ironing damage"), the damage type and the unit, and
--  points back at the pending reject it came from, which is marked
--  TRANSFERRED. Run twice, the NOT EXISTS makes the second a no-op.

INSERT INTO "alteration_receipts" (
  "id", "received_date", "source", "ironing_entry_id", "pending_reject_id",
  "order_id", "style_id", "unit", "reason", "defect_type", "qty",
  "pcs_altered", "pcs_not_repairable", "status",
  "created_at", "created_by_id", "updated_at", "updated_by_id"
)
SELECT gen_random_uuid(),
       COALESCE(ie."entry_date", (pr."created_at" AT TIME ZONE 'Asia/Kolkata')::date),
       'IRONING',
       pr."ironing_entry_id",
       pr."id",
       pr."order_id", pr."style_id", pr."unit", pr."reason", pr."defect_type", pr."qty",
       0, 0, 'OPEN',
       pr."created_at", pr."created_by_id", CURRENT_TIMESTAMP, pr."updated_by_id"
  FROM "pending_rejects" pr
  JOIN "ironing_entries" ie ON ie."id" = pr."ironing_entry_id"
 WHERE pr."status" = 'PENDING'
   AND NOT EXISTS (SELECT 1 FROM "alteration_receipts" a WHERE a."pending_reject_id" = pr."id")
   AND NOT EXISTS (SELECT 1 FROM "alteration_receipts" a WHERE a."ironing_entry_id" = pr."ironing_entry_id");

UPDATE "pending_rejects" pr
   SET "status" = 'TRANSFERRED', "updated_at" = CURRENT_TIMESTAMP
 WHERE pr."status" = 'PENDING'
   AND EXISTS (SELECT 1 FROM "alteration_receipts" a WHERE a."pending_reject_id" = pr."id");

-- --- Permissions, roles, grants --------------------------------------------

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.module, v.action, v.description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('EXTERNAL_QC.VIEW',         'EXTERNAL_QC',       'VIEW',   'View external qc'),
    ('EXTERNAL_QC.CREATE',       'EXTERNAL_QC',       'CREATE', 'Create external qc'),
    ('EXTERNAL_QC.EDIT',         'EXTERNAL_QC',       'EDIT',   'Edit external qc'),
    ('EXTERNAL_QC.DELETE',       'EXTERNAL_QC',       'DELETE', 'Delete external qc'),
    ('EXTERNAL_QC.EXPORT',       'EXTERNAL_QC',       'EXPORT', 'Export external qc'),
    ('ALTERATION.VIEW',          'ALTERATION',        'VIEW',   'View alteration'),
    ('ALTERATION.CREATE',        'ALTERATION',        'CREATE', 'Create alteration'),
    ('ALTERATION.EDIT',          'ALTERATION',        'EDIT',   'Edit alteration'),
    ('ALTERATION.DELETE',        'ALTERATION',        'DELETE', 'Delete alteration'),
    ('ALTERATION.EXPORT',        'ALTERATION',        'EXPORT', 'Export alteration'),
    ('REJECTED_REGISTER.VIEW',   'REJECTED_REGISTER', 'VIEW',   'View rejected register'),
    ('REJECTED_REGISTER.EXPORT', 'REJECTED_REGISTER', 'EXPORT', 'Export rejected register')
  ) AS v(code, module, action, description)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

INSERT INTO "roles" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.name, v.description, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('EXTERNAL_QC_COORDINATOR', 'External QC Coordinator',
     'Records what the external agency found: pieces offered, approved, sent for alteration and '
     || 'rejected, the reason for each faulty piece and the checker codes on the bags.'),
    ('ALTERATION_SUPERVISOR', 'Alteration Unit Supervisor',
     'Runs the in-house Alteration Unit: works the bags sent from External QC and from ironing, '
     || 'records pieces altered or cleaned and pieces that cannot be repaired.')
  ) AS v(code, name, description)
 WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."code" = v.code);

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
  FROM (VALUES
    ('EXTERNAL_QC_COORDINATOR', 'EXTERNAL_QC.VIEW'),
    ('EXTERNAL_QC_COORDINATOR', 'EXTERNAL_QC.CREATE'),
    ('EXTERNAL_QC_COORDINATOR', 'EXTERNAL_QC.EDIT'),
    ('EXTERNAL_QC_COORDINATOR', 'EXTERNAL_QC.EXPORT'),
    ('EXTERNAL_QC_COORDINATOR', 'IRONING.VIEW'),
    ('EXTERNAL_QC_COORDINATOR', 'ALTERATION.VIEW'),
    ('EXTERNAL_QC_COORDINATOR', 'REJECTED_REGISTER.VIEW'),
    ('EXTERNAL_QC_COORDINATOR', 'REJECTED_REGISTER.EXPORT'),
    ('EXTERNAL_QC_COORDINATOR', 'MASTER_LIST.VIEW'),
    ('EXTERNAL_QC_COORDINATOR', 'REPORT.VIEW'),
    ('ALTERATION_SUPERVISOR', 'ALTERATION.VIEW'),
    ('ALTERATION_SUPERVISOR', 'ALTERATION.CREATE'),
    ('ALTERATION_SUPERVISOR', 'ALTERATION.EDIT'),
    ('ALTERATION_SUPERVISOR', 'ALTERATION.EXPORT'),
    ('ALTERATION_SUPERVISOR', 'IRONING.VIEW'),
    ('ALTERATION_SUPERVISOR', 'EXTERNAL_QC.VIEW'),
    ('ALTERATION_SUPERVISOR', 'REJECTED_REGISTER.VIEW'),
    ('ALTERATION_SUPERVISOR', 'REJECTED_REGISTER.EXPORT'),
    ('ALTERATION_SUPERVISOR', 'MASTER_LIST.VIEW'),
    ('ALTERATION_SUPERVISOR', 'REPORT.VIEW'),
    -- The ironing table receives the re-iron and altered pieces back.
    ('FINISHING_SUPERVISOR', 'EXTERNAL_QC.VIEW'),
    ('FINISHING_SUPERVISOR', 'ALTERATION.VIEW'),
    ('FINISHING_SUPERVISOR', 'REJECTED_REGISTER.VIEW'),
    ('ADMIN', 'EXTERNAL_QC.VIEW'),
    ('ADMIN', 'EXTERNAL_QC.CREATE'),
    ('ADMIN', 'EXTERNAL_QC.EDIT'),
    ('ADMIN', 'EXTERNAL_QC.DELETE'),
    ('ADMIN', 'EXTERNAL_QC.EXPORT'),
    ('ADMIN', 'ALTERATION.VIEW'),
    ('ADMIN', 'ALTERATION.CREATE'),
    ('ADMIN', 'ALTERATION.EDIT'),
    ('ADMIN', 'ALTERATION.DELETE'),
    ('ADMIN', 'ALTERATION.EXPORT'),
    ('ADMIN', 'REJECTED_REGISTER.VIEW'),
    ('ADMIN', 'REJECTED_REGISTER.EXPORT'),
    ('DIRECTOR', 'EXTERNAL_QC.VIEW'),
    ('DIRECTOR', 'EXTERNAL_QC.EXPORT'),
    ('DIRECTOR', 'ALTERATION.VIEW'),
    ('DIRECTOR', 'ALTERATION.EXPORT'),
    ('DIRECTOR', 'REJECTED_REGISTER.VIEW'),
    ('DIRECTOR', 'REJECTED_REGISTER.EXPORT'),
    ('MERCHANDISING', 'EXTERNAL_QC.VIEW'),
    ('MERCHANDISING', 'EXTERNAL_QC.EXPORT'),
    ('MERCHANDISING', 'ALTERATION.VIEW'),
    ('MERCHANDISING', 'ALTERATION.EXPORT'),
    ('MERCHANDISING', 'REJECTED_REGISTER.VIEW'),
    ('MERCHANDISING', 'REJECTED_REGISTER.EXPORT'),
    ('STORE_MANAGER', 'EXTERNAL_QC.VIEW'),
    ('STORE_MANAGER', 'EXTERNAL_QC.EXPORT'),
    ('STORE_MANAGER', 'ALTERATION.VIEW'),
    ('STORE_MANAGER', 'ALTERATION.EXPORT'),
    ('STORE_MANAGER', 'REJECTED_REGISTER.VIEW'),
    ('STORE_MANAGER', 'REJECTED_REGISTER.EXPORT')
  ) AS g(role_code, permission_code)
  JOIN "roles" r ON r."code" = g.role_code
  JOIN "permissions" p ON p."code" = g.permission_code
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- --- Dropdown values --------------------------------------------------------
--
--  "Alteration Staff" lists the active employees in this department.

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", v."value", v."sort", TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
  JOIN (VALUES
        ('Department', 'Alteration', 1010)
       ) AS v("list", "value", "sort") ON l."code" = v."list"
 WHERE NOT EXISTS (
   SELECT 1 FROM "master_list_values" e
    WHERE e."list_id" = l."id" AND e."value" = v."value"
 );
