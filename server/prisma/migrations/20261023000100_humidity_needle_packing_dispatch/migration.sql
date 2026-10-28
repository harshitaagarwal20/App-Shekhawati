-- ===========================================================================
--  PHASE 6 - HUMIDITY CHECKING, NEEDLE DETECTION, PACKING AND DISPATCH
-- ===========================================================================
--
--    humidity_lots                  External QC approved pieces, in lots
--    humidity_checks                every round of readings on a lot - a failed
--                                   lot is on Drying hold until a new round passes
--    needle_detectors               the machines, and their calibration interval
--    needle_calibrations            append-only; a FAIL recalls the machine's
--                                   checks since its last PASS
--    broken_needle_holds            bags held until they pass the detector
--    needle_detection_entries       checked / passed / detected; the detected
--                                   bags are the entry's quarantine
--    needle_quarantine_resolutions  cleared (re-checked, passed) or rejected
--    packing_entries                one day's packing of an order and style
--    dispatches, dispatch_lines     one container, against the shipping plan
--
--  Plus: buyers / styles . max_moisture_pct, the Rejected Register's new
--  stage, StatusGeneral PARTIALLY_SHIPPED / SHIPPED for a buyer order, the
--  dropdown lists, the four modules' permissions and the seeder's grants.
--
--  The DISPATCH document sequence and the Rejected Register's stage check use
--  enum values added here, which PostgreSQL will not let the same transaction
--  use - they are in 20261023000200. Idempotent reference data; db:deploy is
--  all it needs.
-- ===========================================================================

CREATE TYPE "HumidityLotStatus" AS ENUM ('DRYING_HOLD', 'PASSED');

CREATE TYPE "CheckResult" AS ENUM ('PASS', 'FAIL');

CREATE TYPE "NeedleCheckSource" AS ENUM ('HUMIDITY', 'BROKEN_NEEDLE_HOLD');

CREATE TYPE "NeedleCheckStatus" AS ENUM ('VALID', 'RECHECK');

CREATE TYPE "QuarantineOutcome" AS ENUM ('CLEARED', 'REJECTED');

CREATE TYPE "NeedleHoldStatus" AS ENUM ('OPEN', 'RELEASED');

CREATE TYPE "PackingStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

ALTER TYPE "DocumentType" ADD VALUE 'DISPATCH';

ALTER TYPE "RejectStage" ADD VALUE 'NEEDLE_DETECTION';

ALTER TYPE "StatusGeneral" ADD VALUE 'PARTIALLY_SHIPPED';

ALTER TYPE "StatusGeneral" ADD VALUE 'SHIPPED';

ALTER TABLE "buyers" ADD COLUMN     "max_moisture_pct" DECIMAL(6,2);

ALTER TABLE "rejected_register_entries" ADD COLUMN     "needle_resolution_id" UUID,
ALTER COLUMN "origin" DROP NOT NULL;

ALTER TABLE "styles" ADD COLUMN     "max_moisture_pct" DECIMAL(6,2);

CREATE TABLE "humidity_lots" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "lot_seq" INTEGER NOT NULL,
    "pcs" DECIMAL(18,4) NOT NULL,
    "readings_required" INTEGER NOT NULL,
    "status" "HumidityLotStatus" NOT NULL,
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "humidity_lots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "humidity_checks" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meter" VARCHAR(60) NOT NULL,
    "readings" DECIMAL(6,2)[] NOT NULL,
    "max_allowed_pct" DECIMAL(6,2) NOT NULL,
    "highest_reading" DECIMAL(6,2) NOT NULL,
    "result" "CheckResult" NOT NULL,
    "remarks" TEXT,
    "checked_by_id" UUID,
    "checked_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "humidity_checks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "needle_detectors" (
    "id" UUID NOT NULL,
    "machine_code" VARCHAR(40) NOT NULL,
    "description" VARCHAR(200),
    "location" VARCHAR(120),
    "calibration_interval_hours" INTEGER NOT NULL,
    "status" "StatusActive" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "needle_detectors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "needle_calibrations" (
    "id" UUID NOT NULL,
    "detector_id" UUID NOT NULL,
    "calibrated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" "CheckResult" NOT NULL,
    "test_piece" VARCHAR(80),
    "remarks" TEXT,
    "checks_recalled" INTEGER NOT NULL DEFAULT 0,
    "calibrated_by_id" UUID,
    "calibrated_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "needle_calibrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "broken_needle_holds" (
    "id" UUID NOT NULL,
    "held_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "unit" VARCHAR(80),
    "pcs" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "status" "NeedleHoldStatus" NOT NULL DEFAULT 'OPEN',
    "released_at" TIMESTAMPTZ(3),
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "broken_needle_holds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "needle_detection_entries" (
    "id" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detector_id" UUID NOT NULL,
    "calibration_id" UUID NOT NULL,
    "operator_id" UUID,
    "operator_name" VARCHAR(120),
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "source" "NeedleCheckSource" NOT NULL DEFAULT 'HUMIDITY',
    "hold_id" UUID,
    "pcs_checked" DECIMAL(18,4) NOT NULL,
    "pcs_passed" DECIMAL(18,4) NOT NULL,
    "pcs_detected" DECIMAL(18,4) NOT NULL,
    "pcs_cleared" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pcs_rejected" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "status" "NeedleCheckStatus" NOT NULL DEFAULT 'VALID',
    "recalled_at" TIMESTAMPTZ(3),
    "recalled_by_calibration_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "needle_detection_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "needle_quarantine_resolutions" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "resolved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "QuarantineOutcome" NOT NULL,
    "pcs" DECIMAL(18,4) NOT NULL,
    "detector_id" UUID,
    "remarks" TEXT,
    "resolved_by_id" UUID,
    "resolved_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "needle_quarantine_resolutions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "packing_entries" (
    "id" UUID NOT NULL,
    "pack_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "pcs_packed" DECIMAL(18,4) NOT NULL,
    "boxes_packed" INTEGER NOT NULL,
    "status" "PackingStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "packing_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dispatches" (
    "id" UUID NOT NULL,
    "dispatch_no" VARCHAR(40) NOT NULL,
    "dispatch_date" DATE NOT NULL,
    "container_no" VARCHAR(40) NOT NULL,
    "invoice_no" VARCHAR(60),
    "vehicle_no" VARCHAR(60),
    "seal_no" VARCHAR(60),
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "dispatches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dispatch_lines" (
    "id" UUID NOT NULL,
    "dispatch_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "pcs" DECIMAL(18,4) NOT NULL,
    "boxes" INTEGER NOT NULL,
    "plan_approval_id" UUID,
    "planned_qty" DECIMAL(18,4),
    "planned_ship_date" DATE,
    "buyer_name" VARCHAR(150),
    "ship_to" TEXT,
    "ship_mode" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "dispatch_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "humidity_lots_order_id_style_id_idx" ON "humidity_lots"("order_id", "style_id");

CREATE INDEX "humidity_lots_status_idx" ON "humidity_lots"("status");

CREATE UNIQUE INDEX "humidity_lots_order_id_style_id_lot_seq_key" ON "humidity_lots"("order_id", "style_id", "lot_seq");

CREATE INDEX "humidity_lots_deleted_at_idx" ON "humidity_lots"("deleted_at");

CREATE INDEX "humidity_checks_checked_at_idx" ON "humidity_checks"("checked_at");

CREATE UNIQUE INDEX "humidity_checks_lot_id_round_key" ON "humidity_checks"("lot_id", "round");

CREATE UNIQUE INDEX "needle_detectors_machine_code_key" ON "needle_detectors"("machine_code");

CREATE INDEX "needle_detectors_status_idx" ON "needle_detectors"("status");

CREATE INDEX "needle_calibrations_detector_id_calibrated_at_idx" ON "needle_calibrations"("detector_id", "calibrated_at");

CREATE INDEX "broken_needle_holds_order_id_style_id_idx" ON "broken_needle_holds"("order_id", "style_id");

CREATE INDEX "broken_needle_holds_status_idx" ON "broken_needle_holds"("status");

CREATE INDEX "broken_needle_holds_deleted_at_idx" ON "broken_needle_holds"("deleted_at");

CREATE INDEX "needle_detection_entries_order_id_style_id_idx" ON "needle_detection_entries"("order_id", "style_id");

CREATE INDEX "needle_detection_entries_detector_id_checked_at_idx" ON "needle_detection_entries"("detector_id", "checked_at");

CREATE INDEX "needle_detection_entries_hold_id_idx" ON "needle_detection_entries"("hold_id");

CREATE INDEX "needle_detection_entries_status_idx" ON "needle_detection_entries"("status");

CREATE INDEX "needle_detection_entries_deleted_at_idx" ON "needle_detection_entries"("deleted_at");

CREATE INDEX "needle_quarantine_resolutions_entry_id_idx" ON "needle_quarantine_resolutions"("entry_id");

CREATE INDEX "needle_quarantine_resolutions_deleted_at_idx" ON "needle_quarantine_resolutions"("deleted_at");

CREATE INDEX "packing_entries_order_id_style_id_idx" ON "packing_entries"("order_id", "style_id");

CREATE INDEX "packing_entries_pack_date_idx" ON "packing_entries"("pack_date");

CREATE INDEX "packing_entries_deleted_at_idx" ON "packing_entries"("deleted_at");

CREATE UNIQUE INDEX "dispatches_dispatch_no_key" ON "dispatches"("dispatch_no");

CREATE INDEX "dispatches_container_no_idx" ON "dispatches"("container_no");

CREATE INDEX "dispatches_dispatch_date_idx" ON "dispatches"("dispatch_date");

CREATE INDEX "dispatches_deleted_at_idx" ON "dispatches"("deleted_at");

CREATE INDEX "dispatch_lines_order_id_style_id_idx" ON "dispatch_lines"("order_id", "style_id");

CREATE UNIQUE INDEX "dispatch_lines_dispatch_id_order_id_style_id_key" ON "dispatch_lines"("dispatch_id", "order_id", "style_id");

CREATE UNIQUE INDEX "rejected_register_entries_needle_resolution_id_key" ON "rejected_register_entries"("needle_resolution_id");

ALTER TABLE "rejected_register_entries" ADD CONSTRAINT "rejected_register_entries_needle_resolution_id_fkey" FOREIGN KEY ("needle_resolution_id") REFERENCES "needle_quarantine_resolutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "humidity_lots" ADD CONSTRAINT "humidity_lots_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "humidity_lots" ADD CONSTRAINT "humidity_lots_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "humidity_checks" ADD CONSTRAINT "humidity_checks_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "humidity_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "needle_calibrations" ADD CONSTRAINT "needle_calibrations_detector_id_fkey" FOREIGN KEY ("detector_id") REFERENCES "needle_detectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "broken_needle_holds" ADD CONSTRAINT "broken_needle_holds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "broken_needle_holds" ADD CONSTRAINT "broken_needle_holds_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "needle_detection_entries" ADD CONSTRAINT "needle_detection_entries_detector_id_fkey" FOREIGN KEY ("detector_id") REFERENCES "needle_detectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "needle_detection_entries" ADD CONSTRAINT "needle_detection_entries_calibration_id_fkey" FOREIGN KEY ("calibration_id") REFERENCES "needle_calibrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "needle_detection_entries" ADD CONSTRAINT "needle_detection_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "needle_detection_entries" ADD CONSTRAINT "needle_detection_entries_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "needle_detection_entries" ADD CONSTRAINT "needle_detection_entries_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "broken_needle_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "needle_detection_entries" ADD CONSTRAINT "needle_detection_entries_recalled_by_calibration_id_fkey" FOREIGN KEY ("recalled_by_calibration_id") REFERENCES "needle_calibrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "needle_quarantine_resolutions" ADD CONSTRAINT "needle_quarantine_resolutions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "needle_detection_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "needle_quarantine_resolutions" ADD CONSTRAINT "needle_quarantine_resolutions_detector_id_fkey" FOREIGN KEY ("detector_id") REFERENCES "needle_detectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "packing_entries" ADD CONSTRAINT "packing_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "packing_entries" ADD CONSTRAINT "packing_entries_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- --- The arithmetic, held in the database as well as the service ----------

ALTER TABLE "humidity_lots"
  ADD CONSTRAINT "humidity_lots_pcs_positive" CHECK ("pcs" > 0),
  ADD CONSTRAINT "humidity_lots_seq_positive" CHECK ("lot_seq" > 0),
  ADD CONSTRAINT "humidity_lots_readings_required" CHECK ("readings_required" BETWEEN 1 AND 50);

ALTER TABLE "humidity_checks"
  ADD CONSTRAINT "humidity_checks_round_positive" CHECK ("round" > 0),
  ADD CONSTRAINT "humidity_checks_has_readings" CHECK (cardinality("readings") >= 1),
  ADD CONSTRAINT "humidity_checks_readings_are_percent" CHECK (0 <= ALL ("readings") AND 100 >= ALL ("readings")),
  ADD CONSTRAINT "humidity_checks_max_positive" CHECK ("max_allowed_pct" > 0),
  -- Highest Reading is the highest of the readings.
  ADD CONSTRAINT "humidity_checks_highest_is_max" CHECK (
    "highest_reading" = ANY ("readings") AND "highest_reading" >= ALL ("readings")
  ),
  -- Pass only if every reading is at or below the max.
  ADD CONSTRAINT "humidity_checks_result_follows" CHECK (
    "result" = (CASE WHEN "highest_reading" <= "max_allowed_pct" THEN 'PASS' ELSE 'FAIL' END)::"CheckResult"
  );

ALTER TABLE "needle_detectors"
  ADD CONSTRAINT "needle_detectors_interval" CHECK ("calibration_interval_hours" BETWEEN 1 AND 168),
  ADD CONSTRAINT "needle_detectors_code_not_blank" CHECK (length(trim("machine_code")) > 0);

ALTER TABLE "broken_needle_holds"
  ADD CONSTRAINT "broken_needle_holds_pcs_positive" CHECK ("pcs" > 0),
  ADD CONSTRAINT "broken_needle_holds_released_when" CHECK (("status" = 'RELEASED') = ("released_at" IS NOT NULL));

ALTER TABLE "needle_detection_entries"
  ADD CONSTRAINT "needle_detection_entries_counts" CHECK (
    "pcs_checked" > 0 AND "pcs_passed" >= 0 AND "pcs_passed" <= "pcs_checked"
    AND "pcs_cleared" >= 0 AND "pcs_rejected" >= 0
  ),
  -- Pcs Detected = Checked - Passed.
  ADD CONSTRAINT "needle_detection_entries_detected_follows" CHECK ("pcs_detected" = "pcs_checked" - "pcs_passed"),
  -- A quarantined bag is resolved once.
  ADD CONSTRAINT "needle_detection_entries_quarantine_within" CHECK ("pcs_cleared" + "pcs_rejected" <= "pcs_detected"),
  ADD CONSTRAINT "needle_detection_entries_source_link" CHECK (
    ("source" = 'HUMIDITY' AND "hold_id" IS NULL) OR ("source" = 'BROKEN_NEEDLE_HOLD' AND "hold_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "needle_detection_entries_recall_link" CHECK (
    ("status" = 'RECHECK') = ("recalled_by_calibration_id" IS NOT NULL AND "recalled_at" IS NOT NULL)
  );

ALTER TABLE "needle_quarantine_resolutions"
  ADD CONSTRAINT "needle_quarantine_resolutions_pcs_positive" CHECK ("pcs" > 0),
  -- Cleared bags were re-checked on a machine.
  ADD CONSTRAINT "needle_quarantine_resolutions_cleared_on_machine" CHECK ("outcome" <> 'CLEARED' OR "detector_id" IS NOT NULL);

ALTER TABLE "packing_entries"
  ADD CONSTRAINT "packing_entries_counts" CHECK ("pcs_packed" >= 0 AND "boxes_packed" >= 0),
  -- An entry packs something, unless it only closes the order.
  ADD CONSTRAINT "packing_entries_says_something" CHECK ("pcs_packed" > 0 OR "status" = 'COMPLETED');

-- One packing entry per order, style and day.
CREATE UNIQUE INDEX "packing_entries_one_per_day"
  ON "packing_entries" ("order_id", "style_id", "pack_date")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "dispatch_lines"
  ADD CONSTRAINT "dispatch_lines_counts" CHECK ("pcs" > 0 AND "boxes" >= 0);

-- One live dispatch per container: a container leaves once.
CREATE UNIQUE INDEX "dispatches_one_per_container"
  ON "dispatches" ("container_no")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "buyers"
  ADD CONSTRAINT "buyers_max_moisture_pct" CHECK ("max_moisture_pct" IS NULL OR ("max_moisture_pct" > 0 AND "max_moisture_pct" <= 100));
ALTER TABLE "styles"
  ADD CONSTRAINT "styles_max_moisture_pct" CHECK ("max_moisture_pct" IS NULL OR ("max_moisture_pct" > 0 AND "max_moisture_pct" <= 100));

-- --- The dropdown lists ------------------------------------------------------
--
--  L_MoistureMeter is the Moisture Meter dropdown; add the meters on the
--  Dropdown Lists screen. L_HumidityReadings holds one value: how many readings
--  a lot takes (5). A lot keeps the figure it was opened with.

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.name, v.description, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('MoistureMeter', 'Moisture Meter', 'Humidity Checking - the moisture meters (L_MoistureMeter)'),
    ('HumidityReadings', 'Humidity Readings per Lot', 'Humidity Checking - how many readings a lot takes; one value, a whole number (L_HumidityReadings)')
  ) AS v(code, name, description)
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = v.code);

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", v."value", v."sort", TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
  JOIN (VALUES ('HumidityReadings', '5', 10)) AS v("list", "value", "sort") ON l."code" = v."list"
 WHERE NOT EXISTS (SELECT 1 FROM "master_list_values" e WHERE e."list_id" = l."id");

-- --- Permissions, grants ----------------------------------------------------
--
--  The five standard actions less APPROVE. The grants are exactly the
--  seeder's (seed/data/rbac.js): the QC / Packing desk keeps humidity, needle
--  detection and packing; Merchandising, who own the shipping plan, keep
--  dispatch and read the rest.

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), m.module || '.' || a.action, m.module, a.action,
       initcap(lower(a.action)) || ' ' || lower(replace(m.module, '_', ' ')),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES ('HUMIDITY_CHECK'), ('NEEDLE_DETECTION'), ('PACKING'), ('DISPATCH')) AS m(module)
 CROSS JOIN (VALUES ('VIEW'), ('CREATE'), ('EDIT'), ('DELETE'), ('EXPORT')) AS a(action)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = m.module || '.' || a.action);

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
  FROM (
    SELECT 'QC' AS role_code, m.module, a.action
      FROM (VALUES ('HUMIDITY_CHECK'), ('NEEDLE_DETECTION'), ('PACKING')) AS m(module)
     CROSS JOIN (VALUES ('VIEW'), ('CREATE'), ('EDIT'), ('EXPORT')) AS a(action)
    UNION ALL
    -- The metal-detected rejects end up there.
    SELECT 'QC', 'REJECTED_REGISTER', a.action FROM (VALUES ('VIEW'), ('EXPORT')) AS a(action)
    UNION ALL
    SELECT 'MERCHANDISING', 'DISPATCH', a.action
      FROM (VALUES ('VIEW'), ('CREATE'), ('EDIT'), ('EXPORT')) AS a(action)
    UNION ALL
    SELECT 'MERCHANDISING', m.module, a.action
      FROM (VALUES ('HUMIDITY_CHECK'), ('NEEDLE_DETECTION'), ('PACKING')) AS m(module)
     CROSS JOIN (VALUES ('VIEW'), ('EXPORT')) AS a(action)
    UNION ALL
    SELECT 'ADMIN', m.module, a.action
      FROM (VALUES ('HUMIDITY_CHECK'), ('NEEDLE_DETECTION'), ('PACKING'), ('DISPATCH')) AS m(module)
     CROSS JOIN (VALUES ('VIEW'), ('CREATE'), ('EDIT'), ('DELETE'), ('EXPORT')) AS a(action)
    UNION ALL
    SELECT 'DIRECTOR', m.module, a.action
      FROM (VALUES ('HUMIDITY_CHECK'), ('NEEDLE_DETECTION'), ('PACKING'), ('DISPATCH')) AS m(module)
     CROSS JOIN (VALUES ('VIEW'), ('EXPORT')) AS a(action)
  ) AS g
  JOIN "roles" r ON r."code" = g.role_code
  JOIN "permissions" p ON p."code" = g.module || '.' || g.action
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;
