-- ===========================================================================
--  PHASE 6, AS THE FLOOR WORKS IT - NEEDLE CHECKING, PACKING AND DISPATCH
-- ===========================================================================
--
--  20261023000100 put Humidity Checking and a machine-by-machine Needle
--  Detection between External QC and Packing, and dispatched container-wise.
--  The floor's sheets say otherwise:
--
--      External QC approved -> Needle Checking ("Size Assortment Carton")
--                           -> Packing ("Packing Details", box by box)
--                           -> Dispatch (one order at a time)
--
--  So this migration
--
--    - drops Humidity Checking: its tables, enums, dropdown lists,
--      permissions and the buyers' / styles' Max Moisture %
--    - drops the needle detector, its calibrations, quarantine and
--      broken-needle holds, and the Rejected Register's Needle Detection
--      stage, and puts needle_check_cartons in their place
--    - reshapes packing_entries to the packing list's columns
--    - makes a dispatch one order, with the buyer's shipment details, the
--      container from the order's plan, totals from packing and a status
--
--  Phase 6 never went to production and every one of these tables is empty
--  on the machines that ran 20261023000100, so nothing is carried across.
--  db:deploy is all it needs.
-- ===========================================================================

-- --- The Rejected Register goes back to the Alteration Unit only ------------

ALTER TABLE "rejected_register_entries" DROP CONSTRAINT IF EXISTS "rejected_register_entries_stage_source";
ALTER TABLE "rejected_register_entries" DROP CONSTRAINT IF EXISTS "rejected_register_entries_needle_resolution_id_fkey";
DELETE FROM "rejected_register_entries" WHERE "stage" = 'NEEDLE_DETECTION';
DROP INDEX IF EXISTS "rejected_register_entries_needle_resolution_id_key";
ALTER TABLE "rejected_register_entries" DROP COLUMN "needle_resolution_id",
ALTER COLUMN "origin" SET NOT NULL;

CREATE TYPE "RejectStage_new" AS ENUM ('ALTERATION_UNIT');
ALTER TABLE "rejected_register_entries" ALTER COLUMN "stage" TYPE "RejectStage_new" USING ("stage"::text::"RejectStage_new");
ALTER TYPE "RejectStage" RENAME TO "RejectStage_old";
ALTER TYPE "RejectStage_new" RENAME TO "RejectStage";
DROP TYPE "RejectStage_old";

-- --- Humidity Checking and the needle detector -------------------------------

DROP TABLE "needle_quarantine_resolutions";
DROP TABLE "needle_detection_entries";
DROP TABLE "broken_needle_holds";
DROP TABLE "needle_calibrations";
DROP TABLE "needle_detectors";
DROP TABLE "humidity_checks";
DROP TABLE "humidity_lots";

DROP TYPE "CheckResult";
DROP TYPE "HumidityLotStatus";
DROP TYPE "NeedleCheckSource";
DROP TYPE "NeedleCheckStatus";
DROP TYPE "NeedleHoldStatus";
DROP TYPE "QuarantineOutcome";

ALTER TABLE "buyers" DROP COLUMN "max_moisture_pct";
ALTER TABLE "styles" DROP COLUMN "max_moisture_pct";

DELETE FROM "master_list_values"
 WHERE "list_id" IN (SELECT "id" FROM "master_lists" WHERE "code" IN ('MoistureMeter', 'HumidityReadings'));
DELETE FROM "master_lists" WHERE "code" IN ('MoistureMeter', 'HumidityReadings');

DELETE FROM "role_permissions"
 WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "module" = 'HUMIDITY_CHECK');
DELETE FROM "permissions" WHERE "module" = 'HUMIDITY_CHECK';

-- QC read the Rejected Register for the metal-detected rejects, which are gone.
DELETE FROM "role_permissions"
 WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "code" = 'QC')
   AND "permission_id" IN (SELECT "id" FROM "permissions" WHERE "code" IN ('REJECTED_REGISTER.VIEW', 'REJECTED_REGISTER.EXPORT'));

-- --- Needle Checking - the size assortment cartons ---------------------------

CREATE TABLE "needle_check_cartons" (
    "id" UUID NOT NULL,
    "check_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "carton_qty" INTEGER NOT NULL,
    "color_code" VARCHAR(60),
    "size_1" INTEGER NOT NULL DEFAULT 0,
    "size_2" INTEGER NOT NULL DEFAULT 0,
    "size_3" INTEGER NOT NULL DEFAULT 0,
    "size_4" INTEGER NOT NULL DEFAULT 0,
    "size_5" INTEGER NOT NULL DEFAULT 0,
    "size_6" INTEGER NOT NULL DEFAULT 0,
    "size_7" INTEGER NOT NULL DEFAULT 0,
    "size_8" INTEGER NOT NULL DEFAULT 0,
    "size_9" INTEGER NOT NULL DEFAULT 0,
    "size_10" INTEGER NOT NULL DEFAULT 0,
    "weight_kg" DECIMAL(10,3),
    "pcs_per_carton" INTEGER NOT NULL,
    "total_pcs" DECIMAL(18,4) NOT NULL,
    "signed_by" VARCHAR(120) NOT NULL,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "needle_check_cartons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "needle_check_cartons_order_id_style_id_idx" ON "needle_check_cartons"("order_id", "style_id");
CREATE INDEX "needle_check_cartons_check_date_idx" ON "needle_check_cartons"("check_date");
CREATE INDEX "needle_check_cartons_deleted_at_idx" ON "needle_check_cartons"("deleted_at");

ALTER TABLE "needle_check_cartons" ADD CONSTRAINT "needle_check_cartons_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "needle_check_cartons" ADD CONSTRAINT "needle_check_cartons_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "needle_check_cartons"
  ADD CONSTRAINT "needle_check_cartons_seq_positive" CHECK ("seq" > 0),
  ADD CONSTRAINT "needle_check_cartons_carton_qty_positive" CHECK ("carton_qty" > 0),
  ADD CONSTRAINT "needle_check_cartons_sizes" CHECK (
    "size_1" >= 0 AND "size_2" >= 0 AND "size_3" >= 0 AND "size_4" >= 0 AND "size_5" >= 0
    AND "size_6" >= 0 AND "size_7" >= 0 AND "size_8" >= 0 AND "size_9" >= 0 AND "size_10" >= 0
  ),
  -- Pcs/Carton = Size 1 + ... + Size 10, and a carton holds something.
  ADD CONSTRAINT "needle_check_cartons_pcs_per_carton_follows" CHECK (
    "pcs_per_carton" = "size_1" + "size_2" + "size_3" + "size_4" + "size_5"
                     + "size_6" + "size_7" + "size_8" + "size_9" + "size_10"
    AND "pcs_per_carton" > 0
  ),
  ADD CONSTRAINT "needle_check_cartons_total_follows" CHECK ("total_pcs" = "pcs_per_carton" * "carton_qty"),
  ADD CONSTRAINT "needle_check_cartons_weight_positive" CHECK ("weight_kg" IS NULL OR "weight_kg" > 0),
  ADD CONSTRAINT "needle_check_cartons_signed" CHECK (length(trim("signed_by")) > 0);

-- A row's place on the sheet, once among rows not deleted.
CREATE UNIQUE INDEX "needle_check_cartons_one_seq"
  ON "needle_check_cartons" ("order_id", "style_id", "seq")
  WHERE "deleted_at" IS NULL;

-- --- Packing - the packing details, box by box -------------------------------

DROP INDEX IF EXISTS "packing_entries_one_per_day";
ALTER TABLE "packing_entries" DROP CONSTRAINT IF EXISTS "packing_entries_says_something";
ALTER TABLE "packing_entries" DROP CONSTRAINT IF EXISTS "packing_entries_counts";
ALTER TABLE "packing_entries" DROP COLUMN "status",
ADD COLUMN     "box_no" VARCHAR(40) NOT NULL,
ADD COLUMN     "color_code" VARCHAR(60),
ADD COLUMN     "pcs_per_box" INTEGER NOT NULL,
ADD COLUMN     "nw_per_box_kg" DECIMAL(10,3),
ADD COLUMN     "gw_per_box_kg" DECIMAL(10,3),
ADD COLUMN     "length_cm" DECIMAL(8,2),
ADD COLUMN     "width_cm" DECIMAL(8,2),
ADD COLUMN     "height_cm" DECIMAL(8,2);

DROP TYPE "PackingStatus";

ALTER TABLE "packing_entries"
  ADD CONSTRAINT "packing_entries_counts" CHECK ("pcs_per_box" > 0 AND "boxes_packed" > 0),
  -- Qty (In pcs) = Packing x Boxes.
  ADD CONSTRAINT "packing_entries_qty_follows" CHECK ("pcs_packed" = "pcs_per_box" * "boxes_packed"),
  ADD CONSTRAINT "packing_entries_box_no_not_blank" CHECK (length(trim("box_no")) > 0),
  ADD CONSTRAINT "packing_entries_weights" CHECK (
    ("nw_per_box_kg" IS NULL OR "nw_per_box_kg" > 0)
    AND ("gw_per_box_kg" IS NULL OR "gw_per_box_kg" > 0)
    AND ("nw_per_box_kg" IS NULL OR "gw_per_box_kg" IS NULL OR "gw_per_box_kg" >= "nw_per_box_kg")
  ),
  ADD CONSTRAINT "packing_entries_dims" CHECK (
    ("length_cm" IS NULL OR "length_cm" > 0)
    AND ("width_cm" IS NULL OR "width_cm" > 0)
    AND ("height_cm" IS NULL OR "height_cm" > 0)
  );

-- --- Dispatch - one order ---------------------------------------------------

CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'DISPATCHED', 'DELIVERED');

DROP INDEX IF EXISTS "dispatches_one_per_container";
ALTER TABLE "dispatch_lines" DROP COLUMN "buyer_name",
DROP COLUMN "plan_approval_id",
DROP COLUMN "planned_qty",
DROP COLUMN "planned_ship_date",
DROP COLUMN "ship_mode",
DROP COLUMN "ship_to";

ALTER TABLE "dispatches" DROP COLUMN "seal_no",
DROP COLUMN "vehicle_no",
ADD COLUMN     "order_id" UUID NOT NULL,
ADD COLUMN     "buyer_name" VARCHAR(150),
ADD COLUMN     "total_boxes" INTEGER NOT NULL,
ADD COLUMN     "total_pcs" DECIMAL(18,4) NOT NULL,
ADD COLUMN     "ship_mode" VARCHAR(40),
ADD COLUMN     "carrier_ref" VARCHAR(120),
ADD COLUMN     "eta" DATE,
ADD COLUMN     "status" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "buyer_po_no" VARCHAR(60),
ADD COLUMN     "buyer_address" TEXT,
ADD COLUMN     "ship_to" TEXT,
ADD COLUMN     "consignee_name" VARCHAR(200),
ADD COLUMN     "consignee_address" TEXT,
ADD COLUMN     "notify_party_name" VARCHAR(200),
ADD COLUMN     "notify_party_address" TEXT,
ADD COLUMN     "port_of_discharge" VARCHAR(120),
ADD COLUMN     "final_destination" VARCHAR(120),
ADD COLUMN     "price_terms" VARCHAR(150),
ADD COLUMN     "freight_terms" VARCHAR(40),
ALTER COLUMN "container_no" DROP NOT NULL;

CREATE INDEX "dispatches_order_id_idx" ON "dispatches"("order_id");
CREATE INDEX "dispatches_status_idx" ON "dispatches"("status");

ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dispatches"
  ADD CONSTRAINT "dispatches_totals" CHECK ("total_pcs" > 0 AND "total_boxes" >= 0);

-- A dispatch's lines are its own order's.
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_id_order_id_key" UNIQUE ("id", "order_id");
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_same_order"
  FOREIGN KEY ("dispatch_id", "order_id") REFERENCES "dispatches"("id", "order_id") ON DELETE CASCADE ON UPDATE CASCADE;
