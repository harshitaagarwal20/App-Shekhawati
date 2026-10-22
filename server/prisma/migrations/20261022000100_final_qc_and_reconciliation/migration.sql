-- ===========================================================================
--  PHASE 5 - FINAL QC, SPOT RECTIFICATION AND THE RECONCILIATION
-- ===========================================================================
--
--    internal_quality_checks       "Internal Quality Check" - finishing and
--                                  trimming, checked hourly by the QC checker
--    final_checker_reports         "Final Checker Report" - each checker's day
--    finished_checker_records      "Finished Checker" - seventeen defect columns
--    external_qc_inspection_lines  "External Secondary Checking" - the agency's
--                                  26-line inspection grid, on the External QC
--                                  entry it belongs to
--    spot_rectifications           "Spot Rectification-Scrap" - fixed, sold
--                                  online or scrapped
--    reconciliation_reports        "Reconciliation Report" - the planner's
--                                  status for an order and style; every count
--                                  on it is read live from the registers
--
--  None of them moves pieces. Counts are whole pieces (INTEGER).
--
--  Then the reference data a migrated (not seeded) database needs: the three
--  Master Lists the dropdowns read (StatusQC, InspDefect26, StatusRecon), the
--  five modules' permissions and the grants the seeder makes. Idempotent -
--  db:deploy is all it needs.
-- ===========================================================================

-- CreateTable
CREATE TABLE "internal_quality_checks" (
    "id" UUID NOT NULL,
    "record_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "unit_name" VARCHAR(120) NOT NULL,
    "checker_id" UUID NOT NULL,
    "total_pcs_checked" INTEGER NOT NULL,
    "total_defect_pcs" INTEGER NOT NULL,
    "defect_type" VARCHAR(120),
    "qc_status" VARCHAR(40) NOT NULL,
    "transferred_back_to_unit" VARCHAR(120),
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "internal_quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_checker_reports" (
    "id" UUID NOT NULL,
    "record_date" DATE NOT NULL,
    "checker_id" UUID NOT NULL,
    "order_id" UUID,
    "style_id" UUID NOT NULL,
    "total_pcs_checked" INTEGER NOT NULL,
    "total_defect" INTEGER NOT NULL,
    "defect_type" VARCHAR(120),
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "final_checker_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finished_checker_records" (
    "id" UUID NOT NULL,
    "record_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "checker_id" UUID NOT NULL,
    "checked_pcs" INTEGER NOT NULL,
    "untrimmed_thread" INTEGER NOT NULL DEFAULT 0,
    "handle_out" INTEGER NOT NULL DEFAULT 0,
    "handle_size" INTEGER NOT NULL DEFAULT 0,
    "handle_alter" INTEGER NOT NULL DEFAULT 0,
    "without_label" INTEGER NOT NULL DEFAULT 0,
    "slanted_label" INTEGER NOT NULL DEFAULT 0,
    "double_lupi" INTEGER NOT NULL DEFAULT 0,
    "without_lupi" INTEGER NOT NULL DEFAULT 0,
    "wrong_side_lupi" INTEGER NOT NULL DEFAULT 0,
    "weaving_defect" INTEGER NOT NULL DEFAULT 0,
    "cut_hole" INTEGER NOT NULL DEFAULT 0,
    "improper_hem" INTEGER NOT NULL DEFAULT 0,
    "double_stitch" INTEGER NOT NULL DEFAULT 0,
    "without_stitch" INTEGER NOT NULL DEFAULT 0,
    "torn" INTEGER NOT NULL DEFAULT 0,
    "stain" INTEGER NOT NULL DEFAULT 0,
    "alter" INTEGER NOT NULL DEFAULT 0,
    "total_defects" INTEGER NOT NULL,
    "pieces_passed" INTEGER NOT NULL,
    "defect_pct" DECIMAL(9,6) NOT NULL,
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "finished_checker_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_qc_inspection_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "particular" VARCHAR(150) NOT NULL,
    "critical" INTEGER NOT NULL DEFAULT 0,
    "major" INTEGER NOT NULL DEFAULT 0,
    "minor" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "remark" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "external_qc_inspection_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spot_rectifications" (
    "id" UUID NOT NULL,
    "record_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "qty_received" INTEGER NOT NULL,
    "sold_online_qty" INTEGER NOT NULL DEFAULT 0,
    "scrap_qty" INTEGER NOT NULL DEFAULT 0,
    "order_qty" DECIMAL(18,4) NOT NULL,
    "scrap_pct" DECIMAL(9,6) NOT NULL,
    "authorised_by" VARCHAR(120),
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "spot_rectifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_reports" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "recon_status" VARCHAR(40) NOT NULL,
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "reconciliation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "internal_quality_checks_order_id_style_id_idx" ON "internal_quality_checks"("order_id", "style_id");

-- CreateIndex
CREATE INDEX "internal_quality_checks_checker_id_idx" ON "internal_quality_checks"("checker_id");

-- CreateIndex
CREATE INDEX "internal_quality_checks_record_date_idx" ON "internal_quality_checks"("record_date");

-- CreateIndex
CREATE INDEX "internal_quality_checks_deleted_at_idx" ON "internal_quality_checks"("deleted_at");

-- CreateIndex
CREATE INDEX "final_checker_reports_order_id_idx" ON "final_checker_reports"("order_id");

-- CreateIndex
CREATE INDEX "final_checker_reports_style_id_idx" ON "final_checker_reports"("style_id");

-- CreateIndex
CREATE INDEX "final_checker_reports_checker_id_idx" ON "final_checker_reports"("checker_id");

-- CreateIndex
CREATE INDEX "final_checker_reports_record_date_idx" ON "final_checker_reports"("record_date");

-- CreateIndex
CREATE INDEX "final_checker_reports_deleted_at_idx" ON "final_checker_reports"("deleted_at");

-- CreateIndex
CREATE INDEX "finished_checker_records_order_id_style_id_idx" ON "finished_checker_records"("order_id", "style_id");

-- CreateIndex
CREATE INDEX "finished_checker_records_checker_id_idx" ON "finished_checker_records"("checker_id");

-- CreateIndex
CREATE INDEX "finished_checker_records_record_date_idx" ON "finished_checker_records"("record_date");

-- CreateIndex
CREATE INDEX "finished_checker_records_deleted_at_idx" ON "finished_checker_records"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "external_qc_inspection_lines_entry_id_line_no_key" ON "external_qc_inspection_lines"("entry_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "external_qc_inspection_lines_entry_id_particular_key" ON "external_qc_inspection_lines"("entry_id", "particular");

-- CreateIndex
CREATE INDEX "spot_rectifications_order_id_style_id_idx" ON "spot_rectifications"("order_id", "style_id");

-- CreateIndex
CREATE INDEX "spot_rectifications_record_date_idx" ON "spot_rectifications"("record_date");

-- CreateIndex
CREATE INDEX "spot_rectifications_deleted_at_idx" ON "spot_rectifications"("deleted_at");

-- CreateIndex
CREATE INDEX "reconciliation_reports_order_id_style_id_idx" ON "reconciliation_reports"("order_id", "style_id");

-- CreateIndex
CREATE INDEX "reconciliation_reports_deleted_at_idx" ON "reconciliation_reports"("deleted_at");

-- AddForeignKey
ALTER TABLE "internal_quality_checks" ADD CONSTRAINT "internal_quality_checks_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_quality_checks" ADD CONSTRAINT "internal_quality_checks_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_quality_checks" ADD CONSTRAINT "internal_quality_checks_checker_id_fkey" FOREIGN KEY ("checker_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_checker_reports" ADD CONSTRAINT "final_checker_reports_checker_id_fkey" FOREIGN KEY ("checker_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_checker_reports" ADD CONSTRAINT "final_checker_reports_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_checker_reports" ADD CONSTRAINT "final_checker_reports_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_checker_records" ADD CONSTRAINT "finished_checker_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_checker_records" ADD CONSTRAINT "finished_checker_records_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_checker_records" ADD CONSTRAINT "finished_checker_records_checker_id_fkey" FOREIGN KEY ("checker_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_qc_inspection_lines" ADD CONSTRAINT "external_qc_inspection_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "external_qc_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spot_rectifications" ADD CONSTRAINT "spot_rectifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spot_rectifications" ADD CONSTRAINT "spot_rectifications_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- The sheets' formulas, held by the database as well as the service ------

ALTER TABLE "internal_quality_checks"
  ADD CONSTRAINT "internal_quality_checks_defects_within_checked"
  CHECK ("total_pcs_checked" >= 0 AND "total_defect_pcs" >= 0
     AND "total_defect_pcs" <= "total_pcs_checked"),
  -- "Transferred Back To Unit - if Rejected".
  ADD CONSTRAINT "internal_quality_checks_rejected_names_unit"
  CHECK ("qc_status" <> 'Rejected' OR NULLIF(btrim("transferred_back_to_unit"), '') IS NOT NULL);

ALTER TABLE "final_checker_reports"
  ADD CONSTRAINT "final_checker_reports_defects_within_checked"
  CHECK ("total_pcs_checked" >= 0 AND "total_defect" >= 0
     AND "total_defect" <= "total_pcs_checked");

ALTER TABLE "finished_checker_records"
  ADD CONSTRAINT "finished_checker_records_counts_non_negative"
  CHECK ("checked_pcs" >= 0
     AND "untrimmed_thread" >= 0 AND "handle_out" >= 0 AND "handle_size" >= 0
     AND "handle_alter" >= 0 AND "without_label" >= 0 AND "slanted_label" >= 0
     AND "double_lupi" >= 0 AND "without_lupi" >= 0 AND "wrong_side_lupi" >= 0
     AND "weaving_defect" >= 0 AND "cut_hole" >= 0 AND "improper_hem" >= 0
     AND "double_stitch" >= 0 AND "without_stitch" >= 0 AND "torn" >= 0
     AND "stain" >= 0 AND "alter" >= 0),
  -- Projected = SUM(defects); Total pieces passed = Checked - Projected.
  ADD CONSTRAINT "finished_checker_records_totals_are_derived"
  CHECK ("total_defects" = "untrimmed_thread" + "handle_out" + "handle_size" + "handle_alter"
                         + "without_label" + "slanted_label" + "double_lupi" + "without_lupi"
                         + "wrong_side_lupi" + "weaving_defect" + "cut_hole" + "improper_hem"
                         + "double_stitch" + "without_stitch" + "torn" + "stain" + "alter"
     AND "pieces_passed" = "checked_pcs" - "total_defects"
     AND "pieces_passed" >= 0);

ALTER TABLE "external_qc_inspection_lines"
  ADD CONSTRAINT "external_qc_inspection_lines_total_is_derived"
  CHECK ("critical" >= 0 AND "major" >= 0 AND "minor" >= 0
     AND "total" = "critical" + "major" + "minor");

ALTER TABLE "spot_rectifications"
  -- What is sold online and what is scrapped comes out of what was received.
  ADD CONSTRAINT "spot_rectifications_counts_within_received"
  CHECK ("qty_received" >= 0 AND "sold_online_qty" >= 0 AND "scrap_qty" >= 0
     AND "sold_online_qty" + "scrap_qty" <= "qty_received");

-- One reconciliation per order and style.
CREATE UNIQUE INDEX "reconciliation_reports_one_per_order_style"
  ON "reconciliation_reports" ("order_id", "style_id")
  WHERE "deleted_at" IS NULL;

-- --- The Master Lists (L_StatusQC, L_InspDefect26, L_StatusRecon) -----------

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.name, v.description, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('StatusQC', 'Status QC', 'Internal Quality Check - Status (L_StatusQC)'),
    ('InspDefect26', 'Inspection Defect', 'External QC - inspection report Particulars, the 26 inspection defects (L_InspDefect26)'),
    ('StatusRecon', 'Status Recon', 'Reconciliation Report - Status (L_StatusRecon)')
  ) AS v(code, name, description)
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = v.code);

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active",
                                  "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", v."value", v."sort", TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
  JOIN (VALUES
        ('StatusQC', 'Approved', 10), ('StatusQC', 'Rejected', 20), ('StatusQC', 'Alteration', 30),
        ('StatusRecon', 'Matched', 10), ('StatusRecon', 'Variance Found', 20),
        ('InspDefect26', 'Stitch skipping', 10),
        ('InspDefect26', 'Open stitch', 20),
        ('InspDefect26', 'Sewing shifted / Uneven', 30),
        ('InspDefect26', 'Sewing shifted / Gathering', 40),
        ('InspDefect26', 'Over / Double stitch', 50),
        ('InspDefect26', 'Yarn cutting / Uncut thread', 60),
        ('InspDefect26', 'Blind-stitch defect / Open seam', 70),
        ('InspDefect26', 'Pilling / Fly yarn', 80),
        ('InspDefect26', 'Press', 90),
        ('InspDefect26', 'Over / Doubling stitch', 100),
        ('InspDefect26', 'Fabric no strength / Fabric fault', 110),
        ('InspDefect26', 'Side stitch / Overlock', 120),
        ('InspDefect26', 'Color difference / Shade', 130),
        ('InspDefect26', 'Size difference', 140),
        ('InspDefect26', 'Breakage / Damage / Eyelet breakage', 150),
        ('InspDefect26', 'Needle hole', 160),
        ('InspDefect26', 'Thread breakage / Broken stitch', 170),
        ('InspDefect26', 'Dirt / Spot', 180),
        ('InspDefect26', 'Walking shade / Running shade', 190),
        ('InspDefect26', 'Overlock tension', 200),
        ('InspDefect26', 'Label mistake', 210),
        ('InspDefect26', 'Handle placement', 220),
        ('InspDefect26', 'Pressing mark', 230),
        ('InspDefect26', 'Oil spot / Stain', 240),
        ('InspDefect26', 'Chalk mark', 250),
        ('InspDefect26', 'Fastener opening / Closing defect', 260)
       ) AS v("list", "value", "sort") ON l."code" = v."list"
 WHERE NOT EXISTS (
     SELECT 1 FROM "master_list_values" e
      WHERE e."list_id" = l."id" AND e."value" = v."value"
   );

-- --- Permissions, grants ----------------------------------------------------
--
--  The five standard actions less APPROVE: "Status" and "Authorised By" on
--  these sheets are recorded, not routed through the approval engine. The
--  grants are exactly the seeder's (seed/data/rbac.js), so a migrated
--  database matches a fresh one.

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), m.module || '.' || a.action, m.module, a.action,
       initcap(lower(a.action)) || ' ' || lower(replace(m.module, '_', ' ')),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('INTERNAL_QUALITY_CHECK'), ('FINAL_CHECKER_REPORT'), ('FINISHED_CHECKER'),
    ('SPOT_RECTIFICATION'), ('RECONCILIATION_REPORT')
  ) AS m(module)
 CROSS JOIN (VALUES ('VIEW'), ('CREATE'), ('EDIT'), ('DELETE'), ('EXPORT')) AS a(action)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = m.module || '.' || a.action);

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
  FROM (
    -- The QC Dept (Checker) keeps the four QC sheets.
    SELECT 'QC' AS role_code, m.module, a.action
      FROM (VALUES ('INTERNAL_QUALITY_CHECK'), ('FINAL_CHECKER_REPORT'), ('FINISHED_CHECKER'),
                   ('SPOT_RECTIFICATION')) AS m(module)
     CROSS JOIN (VALUES ('VIEW'), ('CREATE'), ('EDIT'), ('EXPORT')) AS a(action)
    UNION ALL
    -- Planning Dept (GM) keeps the reconciliation...
    SELECT 'MERCHANDISING', 'RECONCILIATION_REPORT', a.action
      FROM (VALUES ('VIEW'), ('CREATE'), ('EDIT'), ('EXPORT')) AS a(action)
    UNION ALL
    -- ...and reads the QC sheets it is read against.
    SELECT 'MERCHANDISING', m.module, a.action
      FROM (VALUES ('INTERNAL_QUALITY_CHECK'), ('FINAL_CHECKER_REPORT'), ('FINISHED_CHECKER'),
                   ('SPOT_RECTIFICATION')) AS m(module)
     CROSS JOIN (VALUES ('VIEW'), ('EXPORT')) AS a(action)
    UNION ALL
    SELECT 'ADMIN', m.module, a.action
      FROM (VALUES ('INTERNAL_QUALITY_CHECK'), ('FINAL_CHECKER_REPORT'), ('FINISHED_CHECKER'),
                   ('SPOT_RECTIFICATION'), ('RECONCILIATION_REPORT')) AS m(module)
     CROSS JOIN (VALUES ('VIEW'), ('CREATE'), ('EDIT'), ('DELETE'), ('EXPORT')) AS a(action)
    UNION ALL
    SELECT 'DIRECTOR', m.module, a.action
      FROM (VALUES ('INTERNAL_QUALITY_CHECK'), ('FINAL_CHECKER_REPORT'), ('FINISHED_CHECKER'),
                   ('SPOT_RECTIFICATION'), ('RECONCILIATION_REPORT')) AS m(module)
     CROSS JOIN (VALUES ('VIEW'), ('EXPORT')) AS a(action)
  ) AS g
  JOIN "roles" r ON r."code" = g.role_code
  JOIN "permissions" p ON p."code" = g.module || '.' || g.action
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;
