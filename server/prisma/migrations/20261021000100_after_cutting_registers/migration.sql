-- ===========================================================================
--  AFTER CUTTING - the stitching, quality and reconciliation registers
-- ===========================================================================
--
--  One table per workbook sheet, from "Stiching Record" to "Reconciliation
--  Report". Packing, Needle Checking and Dispatch are not part of this
--  migration and still have no table.
--
--    stitching_records              Stiching Record
--    hourly_monitorings             Hourly Monitoring
--    qc_size_records                QC Size           (Daily QC - Tailor Size)
--    qc_defect_records              QC Defects        (Daily QC - Tailor Defects)
--    internal_quality_checks        Internal Quality Check
--    final_checker_reports          Final Checker Report
--    finished_checker_records       Finished Checker
--    external_secondary_checks      External Secondary Checking (+ _lines)
--    alter_reports                  Alter Report
--    spot_rectifications            Spot Rectification-Scrap
--    rejected_records               Rejected
--    reconciliation_reports         Reconciliation Report
--
--  None of them moves stock. The CHECK constraints at the foot hold the
--  sheet's formulas, so a row written around the service still adds up.
-- ===========================================================================

CREATE TABLE "stitching_records" (
    "id" UUID NOT NULL,
    "record_date" DATE NOT NULL,
    "unit_name" VARCHAR(120) NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "cutting_issue_id" UUID,
    "deliverable_size" INTEGER NOT NULL,
    "actual_qty" INTEGER NOT NULL,
    "remaining_qty" INTEGER NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "stitching_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hourly_monitorings" (
    "id" UUID NOT NULL,
    "record_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "pcs_at_10" INTEGER NOT NULL DEFAULT 0,
    "pcs_at_11" INTEGER NOT NULL DEFAULT 0,
    "pcs_at_12" INTEGER NOT NULL DEFAULT 0,
    "pcs_at_13" INTEGER NOT NULL DEFAULT 0,
    "pcs_at_14" INTEGER NOT NULL DEFAULT 0,
    "pcs_at_15" INTEGER NOT NULL DEFAULT 0,
    "pcs_at_16" INTEGER NOT NULL DEFAULT 0,
    "pcs_at_1730" INTEGER NOT NULL DEFAULT 0,
    "pcs_at_1830" INTEGER NOT NULL DEFAULT 0,
    "total_pcs" INTEGER NOT NULL DEFAULT 0,
    "slot_captured_at" JSONB,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "hourly_monitorings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "qc_size_records" (
    "id" UUID NOT NULL,
    "record_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "unit_name" VARCHAR(120) NOT NULL,
    "tailor_id" UUID,
    "tailor_name" VARCHAR(120) NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "size" VARCHAR(60),
    "pcs_checked_rejected" INTEGER NOT NULL,
    "defect_found" VARCHAR(120),
    "inform_to" VARCHAR(80),
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "qc_size_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "qc_defect_records" (
    "id" UUID NOT NULL,
    "record_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "unit_name" VARCHAR(120) NOT NULL,
    "tailor_id" UUID,
    "tailor_name" VARCHAR(120) NOT NULL,
    "pcs_checked_rejected" INTEGER NOT NULL,
    "defect_found" VARCHAR(120),
    "inform_to" VARCHAR(80),
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "qc_defect_records_pkey" PRIMARY KEY ("id")
);

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
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "internal_quality_checks_pkey" PRIMARY KEY ("id")
);

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
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "final_checker_reports_pkey" PRIMARY KEY ("id")
);

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
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "finished_checker_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_secondary_checks" (
    "id" UUID NOT NULL,
    "record_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "agency_name" VARCHAR(150),
    "person_incharge" VARCHAR(120),
    "inspection_qty" INTEGER NOT NULL,
    "critical_total" INTEGER NOT NULL,
    "major_total" INTEGER NOT NULL,
    "minor_total" INTEGER NOT NULL,
    "total_defects" INTEGER NOT NULL,
    "pass_qty" INTEGER NOT NULL,
    "defect_ratio" DECIMAL(9,6) NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "external_secondary_checks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_secondary_check_lines" (
    "id" UUID NOT NULL,
    "check_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "particular" VARCHAR(150) NOT NULL,
    "critical" INTEGER NOT NULL DEFAULT 0,
    "major" INTEGER NOT NULL DEFAULT 0,
    "minor" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "remark" VARCHAR(500),

    CONSTRAINT "external_secondary_check_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "alter_reports" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "output_pcs" INTEGER NOT NULL,
    "pass_pcs" INTEGER NOT NULL,
    "alter_pcs" INTEGER NOT NULL,
    "alter_pct" DECIMAL(9,6) NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "alter_reports_pkey" PRIMARY KEY ("id")
);

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
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "spot_rectifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rejected_records" (
    "id" UUID NOT NULL,
    "record_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "order_qty" DECIMAL(18,4) NOT NULL,
    "cutting_qty" INTEGER NOT NULL,
    "packed_qty" INTEGER NOT NULL,
    "rejected_qty" INTEGER NOT NULL,
    "checked_by_id" UUID,
    "checked_by_name" VARCHAR(120),
    "reject_reason" VARCHAR(120),
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "rejected_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reconciliation_reports" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "recon_status" VARCHAR(40) NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "reconciliation_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stitching_records_order_id_idx" ON "stitching_records"("order_id");

CREATE INDEX "stitching_records_style_id_idx" ON "stitching_records"("style_id");

CREATE INDEX "stitching_records_cutting_issue_id_idx" ON "stitching_records"("cutting_issue_id");

CREATE INDEX "stitching_records_record_date_idx" ON "stitching_records"("record_date");

CREATE INDEX "stitching_records_deleted_at_idx" ON "stitching_records"("deleted_at");

CREATE INDEX "hourly_monitorings_order_id_idx" ON "hourly_monitorings"("order_id");

CREATE INDEX "hourly_monitorings_style_id_idx" ON "hourly_monitorings"("style_id");

CREATE INDEX "hourly_monitorings_employee_id_idx" ON "hourly_monitorings"("employee_id");

CREATE INDEX "hourly_monitorings_record_date_idx" ON "hourly_monitorings"("record_date");

CREATE INDEX "hourly_monitorings_deleted_at_idx" ON "hourly_monitorings"("deleted_at");

CREATE INDEX "qc_size_records_order_id_idx" ON "qc_size_records"("order_id");

CREATE INDEX "qc_size_records_style_id_idx" ON "qc_size_records"("style_id");

CREATE INDEX "qc_size_records_tailor_id_idx" ON "qc_size_records"("tailor_id");

CREATE INDEX "qc_size_records_record_date_idx" ON "qc_size_records"("record_date");

CREATE INDEX "qc_size_records_deleted_at_idx" ON "qc_size_records"("deleted_at");

CREATE INDEX "qc_defect_records_order_id_idx" ON "qc_defect_records"("order_id");

CREATE INDEX "qc_defect_records_style_id_idx" ON "qc_defect_records"("style_id");

CREATE INDEX "qc_defect_records_tailor_id_idx" ON "qc_defect_records"("tailor_id");

CREATE INDEX "qc_defect_records_record_date_idx" ON "qc_defect_records"("record_date");

CREATE INDEX "qc_defect_records_deleted_at_idx" ON "qc_defect_records"("deleted_at");

CREATE INDEX "internal_quality_checks_order_id_idx" ON "internal_quality_checks"("order_id");

CREATE INDEX "internal_quality_checks_style_id_idx" ON "internal_quality_checks"("style_id");

CREATE INDEX "internal_quality_checks_checker_id_idx" ON "internal_quality_checks"("checker_id");

CREATE INDEX "internal_quality_checks_record_date_idx" ON "internal_quality_checks"("record_date");

CREATE INDEX "internal_quality_checks_deleted_at_idx" ON "internal_quality_checks"("deleted_at");

CREATE INDEX "final_checker_reports_order_id_idx" ON "final_checker_reports"("order_id");

CREATE INDEX "final_checker_reports_style_id_idx" ON "final_checker_reports"("style_id");

CREATE INDEX "final_checker_reports_checker_id_idx" ON "final_checker_reports"("checker_id");

CREATE INDEX "final_checker_reports_record_date_idx" ON "final_checker_reports"("record_date");

CREATE INDEX "final_checker_reports_deleted_at_idx" ON "final_checker_reports"("deleted_at");

CREATE INDEX "finished_checker_records_order_id_idx" ON "finished_checker_records"("order_id");

CREATE INDEX "finished_checker_records_style_id_idx" ON "finished_checker_records"("style_id");

CREATE INDEX "finished_checker_records_checker_id_idx" ON "finished_checker_records"("checker_id");

CREATE INDEX "finished_checker_records_record_date_idx" ON "finished_checker_records"("record_date");

CREATE INDEX "finished_checker_records_deleted_at_idx" ON "finished_checker_records"("deleted_at");

CREATE INDEX "external_secondary_checks_order_id_idx" ON "external_secondary_checks"("order_id");

CREATE INDEX "external_secondary_checks_style_id_idx" ON "external_secondary_checks"("style_id");

CREATE INDEX "external_secondary_checks_record_date_idx" ON "external_secondary_checks"("record_date");

CREATE INDEX "external_secondary_checks_deleted_at_idx" ON "external_secondary_checks"("deleted_at");

CREATE INDEX "external_secondary_check_lines_check_id_idx" ON "external_secondary_check_lines"("check_id");

CREATE UNIQUE INDEX "external_secondary_check_lines_check_id_line_no_key" ON "external_secondary_check_lines"("check_id", "line_no");

CREATE INDEX "alter_reports_order_id_idx" ON "alter_reports"("order_id");

CREATE INDEX "alter_reports_style_id_idx" ON "alter_reports"("style_id");

CREATE INDEX "alter_reports_captured_at_idx" ON "alter_reports"("captured_at");

CREATE INDEX "alter_reports_deleted_at_idx" ON "alter_reports"("deleted_at");

CREATE INDEX "spot_rectifications_order_id_idx" ON "spot_rectifications"("order_id");

CREATE INDEX "spot_rectifications_style_id_idx" ON "spot_rectifications"("style_id");

CREATE INDEX "spot_rectifications_record_date_idx" ON "spot_rectifications"("record_date");

CREATE INDEX "spot_rectifications_deleted_at_idx" ON "spot_rectifications"("deleted_at");

CREATE INDEX "rejected_records_order_id_idx" ON "rejected_records"("order_id");

CREATE INDEX "rejected_records_style_id_idx" ON "rejected_records"("style_id");

CREATE INDEX "rejected_records_checked_by_id_idx" ON "rejected_records"("checked_by_id");

CREATE INDEX "rejected_records_record_date_idx" ON "rejected_records"("record_date");

CREATE INDEX "rejected_records_deleted_at_idx" ON "rejected_records"("deleted_at");

CREATE INDEX "reconciliation_reports_order_id_idx" ON "reconciliation_reports"("order_id");

CREATE INDEX "reconciliation_reports_style_id_idx" ON "reconciliation_reports"("style_id");

CREATE INDEX "reconciliation_reports_deleted_at_idx" ON "reconciliation_reports"("deleted_at");

ALTER TABLE "stitching_records" ADD CONSTRAINT "stitching_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stitching_records" ADD CONSTRAINT "stitching_records_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stitching_records" ADD CONSTRAINT "stitching_records_cutting_issue_id_fkey" FOREIGN KEY ("cutting_issue_id") REFERENCES "cutting_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hourly_monitorings" ADD CONSTRAINT "hourly_monitorings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hourly_monitorings" ADD CONSTRAINT "hourly_monitorings_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hourly_monitorings" ADD CONSTRAINT "hourly_monitorings_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "qc_size_records" ADD CONSTRAINT "qc_size_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "qc_size_records" ADD CONSTRAINT "qc_size_records_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "qc_size_records" ADD CONSTRAINT "qc_size_records_tailor_id_fkey" FOREIGN KEY ("tailor_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "qc_defect_records" ADD CONSTRAINT "qc_defect_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "qc_defect_records" ADD CONSTRAINT "qc_defect_records_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "qc_defect_records" ADD CONSTRAINT "qc_defect_records_tailor_id_fkey" FOREIGN KEY ("tailor_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "internal_quality_checks" ADD CONSTRAINT "internal_quality_checks_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "internal_quality_checks" ADD CONSTRAINT "internal_quality_checks_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "internal_quality_checks" ADD CONSTRAINT "internal_quality_checks_checker_id_fkey" FOREIGN KEY ("checker_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "final_checker_reports" ADD CONSTRAINT "final_checker_reports_checker_id_fkey" FOREIGN KEY ("checker_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "final_checker_reports" ADD CONSTRAINT "final_checker_reports_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "final_checker_reports" ADD CONSTRAINT "final_checker_reports_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finished_checker_records" ADD CONSTRAINT "finished_checker_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finished_checker_records" ADD CONSTRAINT "finished_checker_records_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finished_checker_records" ADD CONSTRAINT "finished_checker_records_checker_id_fkey" FOREIGN KEY ("checker_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "external_secondary_checks" ADD CONSTRAINT "external_secondary_checks_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "external_secondary_checks" ADD CONSTRAINT "external_secondary_checks_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "external_secondary_check_lines" ADD CONSTRAINT "external_secondary_check_lines_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "external_secondary_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "alter_reports" ADD CONSTRAINT "alter_reports_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "alter_reports" ADD CONSTRAINT "alter_reports_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "spot_rectifications" ADD CONSTRAINT "spot_rectifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "spot_rectifications" ADD CONSTRAINT "spot_rectifications_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rejected_records" ADD CONSTRAINT "rejected_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rejected_records" ADD CONSTRAINT "rejected_records_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rejected_records" ADD CONSTRAINT "rejected_records_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
--  THE SHEET'S FORMULAS, HELD BY THE DATABASE
-- ===========================================================================

ALTER TABLE "stitching_records"
  ADD CONSTRAINT "stitching_records_counts_non_negative"
  CHECK ("deliverable_size" >= 0 AND "actual_qty" >= 0),
  -- Remaining = Deliverable Size - Actual, and a unit cannot hand back more
  -- than it was given.
  ADD CONSTRAINT "stitching_records_remaining_is_derived"
  CHECK ("remaining_qty" = "deliverable_size" - "actual_qty" AND "remaining_qty" >= 0);

ALTER TABLE "hourly_monitorings"
  ADD CONSTRAINT "hourly_monitorings_slots_non_negative"
  CHECK ("pcs_at_10" >= 0 AND "pcs_at_11" >= 0 AND "pcs_at_12" >= 0 AND "pcs_at_13" >= 0
     AND "pcs_at_14" >= 0 AND "pcs_at_15" >= 0 AND "pcs_at_16" >= 0
     AND "pcs_at_1730" >= 0 AND "pcs_at_1830" >= 0),
  ADD CONSTRAINT "hourly_monitorings_total_is_derived"
  CHECK ("total_pcs" = "pcs_at_10" + "pcs_at_11" + "pcs_at_12" + "pcs_at_13" + "pcs_at_14"
                     + "pcs_at_15" + "pcs_at_16" + "pcs_at_1730" + "pcs_at_1830");

-- One row per operator, per order, per day: the supervisor fills its slots
-- through the day rather than starting a new row each hour.
CREATE UNIQUE INDEX "hourly_monitorings_one_row_per_operator_day"
  ON "hourly_monitorings" ("record_date", "order_id", "employee_id")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "qc_size_records"
  ADD CONSTRAINT "qc_size_records_pcs_non_negative" CHECK ("pcs_checked_rejected" >= 0);

ALTER TABLE "qc_defect_records"
  ADD CONSTRAINT "qc_defect_records_pcs_non_negative" CHECK ("pcs_checked_rejected" >= 0);

ALTER TABLE "internal_quality_checks"
  ADD CONSTRAINT "internal_quality_checks_defects_within_checked"
  CHECK ("total_pcs_checked" >= 0 AND "total_defect_pcs" >= 0
     AND "total_defect_pcs" <= "total_pcs_checked");

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

ALTER TABLE "external_secondary_checks"
  ADD CONSTRAINT "external_secondary_checks_totals_are_derived"
  CHECK ("inspection_qty" >= 0
     AND "critical_total" >= 0 AND "major_total" >= 0 AND "minor_total" >= 0
     AND "total_defects" = "critical_total" + "major_total" + "minor_total"
     AND "pass_qty" = "inspection_qty" - "total_defects"
     AND "pass_qty" >= 0);

ALTER TABLE "external_secondary_check_lines"
  ADD CONSTRAINT "external_secondary_check_lines_total_is_derived"
  CHECK ("critical" >= 0 AND "major" >= 0 AND "minor" >= 0
     AND "total" = "critical" + "major" + "minor");

ALTER TABLE "alter_reports"
  -- Passed and altered pieces come out of the output, never beyond it.
  ADD CONSTRAINT "alter_reports_counts_within_output"
  CHECK ("output_pcs" >= 0 AND "pass_pcs" >= 0 AND "alter_pcs" >= 0
     AND "pass_pcs" + "alter_pcs" <= "output_pcs");

ALTER TABLE "spot_rectifications"
  -- What is sold online and what is scrapped comes out of what was received.
  ADD CONSTRAINT "spot_rectifications_counts_within_received"
  CHECK ("qty_received" >= 0 AND "sold_online_qty" >= 0 AND "scrap_qty" >= 0
     AND "sold_online_qty" + "scrap_qty" <= "qty_received");

ALTER TABLE "rejected_records"
  -- Rejected = IF(Cutting = 0, 0, Cutting - Packed), never negative.
  ADD CONSTRAINT "rejected_records_rejected_is_derived"
  CHECK ("cutting_qty" >= 0 AND "packed_qty" >= 0
     AND "rejected_qty" = CASE WHEN "cutting_qty" = 0 THEN 0 ELSE "cutting_qty" - "packed_qty" END
     AND "rejected_qty" >= 0);

-- One reconciliation per order and style.
CREATE UNIQUE INDEX "reconciliation_reports_one_per_order_style"
  ON "reconciliation_reports" ("order_id", "style_id")
  WHERE "deleted_at" IS NULL;
