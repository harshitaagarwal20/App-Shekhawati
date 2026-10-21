-- ===========================================================================
--  PHASE 3 - INLINE QC
-- ===========================================================================
--
--    inline_qc_entries   one check on one tailor's work, taken on the line
--                        while stitching runs. Check Type SIZE is the
--                        workbook's "QC Size" sheet (Operation and Size given);
--                        WORKMANSHIP is its "QC Defects" sheet.
--    inline_qc_defects   each defect found on a check - a line on the Inform
--                        To person's Action needed list until they mark it
--                        Resolved.
--
--  Inline QC moves no pieces: it does not feed ironing, the Alteration Unit
--  or the Rejected Register.
--
--  Then the reference data a migrated (not seeded) database needs: the
--  INLINE_QC permissions (with RESOLVE, held by whoever may be named in
--  Inform To), the grants, and the Operation list. Idempotent - db:deploy is
--  all it needs.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "InlineQcCheckType" AS ENUM ('SIZE', 'WORKMANSHIP');

-- CreateEnum
CREATE TYPE "InlineQcDefectStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "inline_qc_entries" (
    "id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "check_type" "InlineQcCheckType" NOT NULL,
    "tailor_id" UUID NOT NULL,
    "unit" VARCHAR(80) NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "operation" VARCHAR(60),
    "size_measurement" VARCHAR(60),
    "pcs_checked" DECIMAL(18,4) NOT NULL,
    "pcs_rejected" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inform_to_user_id" UUID,
    "inform_to_name" VARCHAR(120),
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "inline_qc_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inline_qc_defects" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "defect" VARCHAR(120) NOT NULL,
    "status" "InlineQcDefectStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "resolved_by_name" VARCHAR(120),
    "resolution_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "inline_qc_defects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inline_qc_entries_entry_date_idx" ON "inline_qc_entries"("entry_date");

-- CreateIndex
CREATE INDEX "inline_qc_entries_unit_entry_date_idx" ON "inline_qc_entries"("unit", "entry_date");

-- CreateIndex
CREATE INDEX "inline_qc_entries_order_id_style_id_idx" ON "inline_qc_entries"("order_id", "style_id");

-- CreateIndex
CREATE INDEX "inline_qc_entries_tailor_id_idx" ON "inline_qc_entries"("tailor_id");

-- CreateIndex
CREATE INDEX "inline_qc_entries_inform_to_user_id_idx" ON "inline_qc_entries"("inform_to_user_id");

-- CreateIndex
CREATE INDEX "inline_qc_entries_deleted_at_idx" ON "inline_qc_entries"("deleted_at");

-- CreateIndex
CREATE INDEX "inline_qc_defects_status_idx" ON "inline_qc_defects"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inline_qc_defects_entry_id_defect_key" ON "inline_qc_defects"("entry_id", "defect");

-- AddForeignKey
ALTER TABLE "inline_qc_entries" ADD CONSTRAINT "inline_qc_entries_tailor_id_fkey" FOREIGN KEY ("tailor_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inline_qc_entries" ADD CONSTRAINT "inline_qc_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inline_qc_entries" ADD CONSTRAINT "inline_qc_entries_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inline_qc_entries" ADD CONSTRAINT "inline_qc_entries_inform_to_user_id_fkey" FOREIGN KEY ("inform_to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inline_qc_defects" ADD CONSTRAINT "inline_qc_defects_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "inline_qc_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- The field rules, held by the database as well as the service -----------

-- Something was checked, and no more were rejected than were checked.
ALTER TABLE "inline_qc_entries" ADD CONSTRAINT "inline_qc_entries_pcs"
  CHECK ("pcs_checked" > 0 AND "pcs_rejected" >= 0 AND "pcs_rejected" <= "pcs_checked");

-- Operation and Size belong to a Size check, and only to one.
ALTER TABLE "inline_qc_entries" ADD CONSTRAINT "inline_qc_entries_size_fields"
  CHECK (
    ("check_type" = 'SIZE'
       AND NULLIF(btrim("operation"), '') IS NOT NULL
       AND NULLIF(btrim("size_measurement"), '') IS NOT NULL)
    OR
    ("check_type" = 'WORKMANSHIP' AND "operation" IS NULL AND "size_measurement" IS NULL)
  );

-- A resolved defect says when; an open one does not.
ALTER TABLE "inline_qc_defects" ADD CONSTRAINT "inline_qc_defects_resolved_stamp"
  CHECK (("status" = 'RESOLVED') = ("resolved_at" IS NOT NULL));

-- --- Permissions, grants ----------------------------------------------------
--
--  RESOLVE is not one of the five standard actions. It marks who may be named
--  in Inform To; marking a defect Resolved is then for the person named.

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.module, v.action, v.description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('INLINE_QC.VIEW',    'INLINE_QC', 'VIEW',    'View inline qc'),
    ('INLINE_QC.CREATE',  'INLINE_QC', 'CREATE',  'Create inline qc'),
    ('INLINE_QC.EDIT',    'INLINE_QC', 'EDIT',    'Edit inline qc'),
    ('INLINE_QC.DELETE',  'INLINE_QC', 'DELETE',  'Delete inline qc'),
    ('INLINE_QC.EXPORT',  'INLINE_QC', 'EXPORT',  'Export inline qc'),
    ('INLINE_QC.RESOLVE', 'INLINE_QC', 'RESOLVE', 'Resolve inline qc')
  ) AS v(code, module, action, description)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
  FROM (VALUES
    -- The QC Dept (Checker) takes the checks.
    ('QC', 'INLINE_QC.VIEW'),
    ('QC', 'INLINE_QC.CREATE'),
    ('QC', 'INLINE_QC.EDIT'),
    ('QC', 'INLINE_QC.EXPORT'),
    -- The unit's supervisor is told, and resolves.
    ('STITCHING_SUPERVISOR', 'INLINE_QC.VIEW'),
    ('STITCHING_SUPERVISOR', 'INLINE_QC.EXPORT'),
    ('STITCHING_SUPERVISOR', 'INLINE_QC.RESOLVE'),
    ('ADMIN', 'INLINE_QC.VIEW'),
    ('ADMIN', 'INLINE_QC.CREATE'),
    ('ADMIN', 'INLINE_QC.EDIT'),
    ('ADMIN', 'INLINE_QC.DELETE'),
    ('ADMIN', 'INLINE_QC.EXPORT'),
    ('ADMIN', 'INLINE_QC.RESOLVE'),
    ('DIRECTOR', 'INLINE_QC.VIEW'),
    ('DIRECTOR', 'INLINE_QC.EXPORT'),
    ('MERCHANDISING', 'INLINE_QC.VIEW'),
    ('MERCHANDISING', 'INLINE_QC.EXPORT'),
    ('STORE_MANAGER', 'INLINE_QC.VIEW'),
    ('STORE_MANAGER', 'INLINE_QC.EXPORT')
  ) AS g(role_code, permission_code)
  JOIN "roles" r ON r."code" = g.role_code
  JOIN "permissions" p ON p."code" = g.permission_code
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- --- The Operation list (L_Operation) ---------------------------------------

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'Operation', 'Operation',
       'Inline QC (Size check) - the stitching operation checked (L_Operation)', TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = 'Operation');

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active",
                                  "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", v."value", v."sort", TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
  JOIN (VALUES
        ('Body Stitch', 10), ('Handle Attach', 20), ('Hemming', 30), ('Label Attach', 40),
        ('Lupi Stitch', 50), ('Gusset Stitch', 60), ('Final Trim', 70)
       ) AS v("value", "sort") ON TRUE
 WHERE l."code" = 'Operation'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e
      WHERE e."list_id" = l."id" AND e."value" = v."value"
   );
