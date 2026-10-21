-- ===========================================================================
--  PRODUCTION PHASE 2 - STITCHING RECORD, HOURLY MONITORING, AND PRINTING
--  AFTER STITCHING
-- ===========================================================================
--
--  The pipeline used to end at Cutting Issue. This migration opens the next
--  stage: what each stitching unit stitched in a day, and what each tailor
--  stitched in each hour. Nothing about the earlier stages changes.
--
--    stitching_records           one row per unit, date, order and style
--    hourly_monitoring_entries   one row per tailor, date, order, style, slot
--    printings.qty_received      "Pcs Received Back" on the Printing sheet,
--                                so pieces out for printing after stitching
--                                can be told apart from pieces back
--    styles.hourly_target        pieces one tailor should stitch in an hour
--
--  And the reference data a migrated (not seeded) database needs for it:
--  the permissions, the STITCHING_SUPERVISOR role, and the HourlySlot list.
-- ===========================================================================

-- --- Columns on existing tables -------------------------------------------

ALTER TABLE "styles" ADD COLUMN "hourly_target" DECIMAL(10,2);

ALTER TABLE "printings" ADD COLUMN "qty_received" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN "received_date" DATE;

-- --- Stitching record -----------------------------------------------------

CREATE TABLE "stitching_records" (
    "id" UUID NOT NULL,
    "unit" VARCHAR(80) NOT NULL,
    "record_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "deliverable_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "deliverable_from_plan" DECIMAL(18,4),
    "actual_stitched" DECIMAL(18,4) NOT NULL,
    "remaining" DECIMAL(18,4) NOT NULL,
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "stitching_records_pkey" PRIMARY KEY ("id")
);

-- --- Hourly monitoring ----------------------------------------------------

CREATE TABLE "hourly_monitoring_entries" (
    "id" UUID NOT NULL,
    "unit" VARCHAR(80) NOT NULL,
    "entry_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "slot" VARCHAR(20) NOT NULL,
    "pcs" DECIMAL(18,4) NOT NULL,
    "hourly_target" DECIMAL(10,2),
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "hourly_monitoring_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stitching_records_unit_order_id_style_id_idx" ON "stitching_records"("unit", "order_id", "style_id");
CREATE INDEX "stitching_records_record_date_idx" ON "stitching_records"("record_date");
CREATE INDEX "stitching_records_order_id_idx" ON "stitching_records"("order_id");
CREATE INDEX "stitching_records_style_id_idx" ON "stitching_records"("style_id");
CREATE INDEX "stitching_records_deleted_at_idx" ON "stitching_records"("deleted_at");

CREATE INDEX "hourly_monitoring_entries_unit_entry_date_idx" ON "hourly_monitoring_entries"("unit", "entry_date");
CREATE INDEX "hourly_monitoring_entries_order_id_idx" ON "hourly_monitoring_entries"("order_id");
CREATE INDEX "hourly_monitoring_entries_style_id_idx" ON "hourly_monitoring_entries"("style_id");
CREATE INDEX "hourly_monitoring_entries_employee_id_idx" ON "hourly_monitoring_entries"("employee_id");
CREATE UNIQUE INDEX "hourly_monitoring_entries_entry_date_order_id_style_id_empl_key" ON "hourly_monitoring_entries"("entry_date", "order_id", "style_id", "employee_id", "slot");

ALTER TABLE "stitching_records" ADD CONSTRAINT "stitching_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stitching_records" ADD CONSTRAINT "stitching_records_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hourly_monitoring_entries" ADD CONSTRAINT "hourly_monitoring_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hourly_monitoring_entries" ADD CONSTRAINT "hourly_monitoring_entries_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hourly_monitoring_entries" ADD CONSTRAINT "hourly_monitoring_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One live stitching record per unit, day, order and style. Partial, so a
-- deleted row does not stop the day being recorded again.
CREATE UNIQUE INDEX "stitching_records_one_per_unit_day_order_style"
    ON "stitching_records"("unit", "record_date", "order_id", "style_id")
 WHERE "deleted_at" IS NULL;

-- --- The arithmetic, held in the database as well as the service ----------

ALTER TABLE "stitching_records"
  ADD CONSTRAINT "stitching_records_quantities_non_negative" CHECK (
    "deliverable_qty" >= 0 AND "actual_stitched" >= 0
  ),
  -- Remaining = Deliverable - Actual. The workbook's sample row (10,000 /
  -- 900 / 100) does not satisfy it; every row in this table will.
  ADD CONSTRAINT "stitching_records_remaining_is_deliverable_less_actual" CHECK (
    "remaining" = "deliverable_qty" - "actual_stitched"
  );

ALTER TABLE "hourly_monitoring_entries"
  ADD CONSTRAINT "hourly_monitoring_entries_pcs_non_negative" CHECK ("pcs" >= 0);

ALTER TABLE "printings"
  ADD CONSTRAINT "printings_received_within_sent" CHECK (
    "qty_received" >= 0 AND "qty_received" <= "qty"
  );

ALTER TABLE "styles"
  ADD CONSTRAINT "styles_hourly_target_positive" CHECK (
    "hourly_target" IS NULL OR "hourly_target" > 0
  );

-- --- Permissions ----------------------------------------------------------
--
--  Neither module carries an approval: a day's count is stated by the person
--  who counted it. Same five actions as every other non-approvable module.

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.module, v.action, v.description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('STITCHING_RECORD.VIEW',    'STITCHING_RECORD', 'VIEW',   'View stitching record'),
    ('STITCHING_RECORD.CREATE',  'STITCHING_RECORD', 'CREATE', 'Create stitching record'),
    ('STITCHING_RECORD.EDIT',    'STITCHING_RECORD', 'EDIT',   'Edit stitching record'),
    ('STITCHING_RECORD.DELETE',  'STITCHING_RECORD', 'DELETE', 'Delete stitching record'),
    ('STITCHING_RECORD.EXPORT',  'STITCHING_RECORD', 'EXPORT', 'Export stitching record'),
    ('HOURLY_MONITORING.VIEW',   'HOURLY_MONITORING', 'VIEW',   'View hourly monitoring'),
    ('HOURLY_MONITORING.CREATE', 'HOURLY_MONITORING', 'CREATE', 'Create hourly monitoring'),
    ('HOURLY_MONITORING.EDIT',   'HOURLY_MONITORING', 'EDIT',   'Edit hourly monitoring'),
    ('HOURLY_MONITORING.DELETE', 'HOURLY_MONITORING', 'DELETE', 'Delete hourly monitoring'),
    ('HOURLY_MONITORING.EXPORT', 'HOURLY_MONITORING', 'EXPORT', 'Export hourly monitoring')
  ) AS v(code, module, action, description)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

-- --- The supervisor's role ------------------------------------------------

INSERT INTO "roles" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(),
       'STITCHING_SUPERVISOR',
       'Stitching Supervisor',
       'Runs one stitching unit. Records the unit''s daily stitching and the '
       || 'hourly count per tailor, for the orders cut for that unit only. The '
       || 'unit comes from the Unit / Line on the supervisor''s Employee record.',
       TRUE,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'STITCHING_SUPERVISOR');

-- --- Grants ---------------------------------------------------------------
--
--  Supervisor  view / create / edit / export of both modules, and the
--              dropdown values. Not DELETE - a wrong count is corrected,
--              and removing one is an office decision (ADMIN).
--  Admin       everything, as for every other module.
--  Director    view and export, as for every other module.
--  Merchandising and the store
--              view and export: merchandising planned the units' days, and
--              the store issued them their cut pieces and sends stitched
--              pieces out for printing.

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
  FROM (VALUES
    ('STITCHING_SUPERVISOR', 'STITCHING_RECORD.VIEW'),
    ('STITCHING_SUPERVISOR', 'STITCHING_RECORD.CREATE'),
    ('STITCHING_SUPERVISOR', 'STITCHING_RECORD.EDIT'),
    ('STITCHING_SUPERVISOR', 'STITCHING_RECORD.EXPORT'),
    ('STITCHING_SUPERVISOR', 'HOURLY_MONITORING.VIEW'),
    ('STITCHING_SUPERVISOR', 'HOURLY_MONITORING.CREATE'),
    ('STITCHING_SUPERVISOR', 'HOURLY_MONITORING.EDIT'),
    ('STITCHING_SUPERVISOR', 'HOURLY_MONITORING.EXPORT'),
    ('STITCHING_SUPERVISOR', 'MASTER_LIST.VIEW'),
    ('ADMIN', 'STITCHING_RECORD.VIEW'),
    ('ADMIN', 'STITCHING_RECORD.CREATE'),
    ('ADMIN', 'STITCHING_RECORD.EDIT'),
    ('ADMIN', 'STITCHING_RECORD.DELETE'),
    ('ADMIN', 'STITCHING_RECORD.EXPORT'),
    ('ADMIN', 'HOURLY_MONITORING.VIEW'),
    ('ADMIN', 'HOURLY_MONITORING.CREATE'),
    ('ADMIN', 'HOURLY_MONITORING.EDIT'),
    ('ADMIN', 'HOURLY_MONITORING.DELETE'),
    ('ADMIN', 'HOURLY_MONITORING.EXPORT'),
    ('DIRECTOR', 'STITCHING_RECORD.VIEW'),
    ('DIRECTOR', 'STITCHING_RECORD.EXPORT'),
    ('DIRECTOR', 'HOURLY_MONITORING.VIEW'),
    ('DIRECTOR', 'HOURLY_MONITORING.EXPORT'),
    ('MERCHANDISING', 'STITCHING_RECORD.VIEW'),
    ('MERCHANDISING', 'STITCHING_RECORD.EXPORT'),
    ('MERCHANDISING', 'HOURLY_MONITORING.VIEW'),
    ('MERCHANDISING', 'HOURLY_MONITORING.EXPORT'),
    ('STORE_MANAGER', 'STITCHING_RECORD.VIEW'),
    ('STORE_MANAGER', 'STITCHING_RECORD.EXPORT'),
    ('STORE_MANAGER', 'HOURLY_MONITORING.VIEW'),
    ('STORE_MANAGER', 'HOURLY_MONITORING.EXPORT')
  ) AS g(role_code, permission_code)
  JOIN "roles" r ON r."code" = g.role_code
  JOIN "permissions" p ON p."code" = g.permission_code
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- --- Printing numbers ------------------------------------------------------
--
--  Printing after stitching is numbered PR-001 from the existing PRINTING
--  counter. That counter is seeded, never migrated, and the seed clears the
--  table (see 20261002000200) - so make sure it exists, starting past any
--  printing number already taken.

INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "created_at", "updated_at")
SELECT gen_random_uuid(), 'PRINTING', '', 'PR', '', '-', 3,
       COALESCE((SELECT MAX(substring("printing_no" FROM '^PR-(\d+)$')::INT) FROM "printings"), 0) + 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (
   SELECT 1 FROM "document_sequences"
    WHERE "document_type" = 'PRINTING' AND "scope_key" = ''
 );

-- --- The time slots, as a dropdown list -----------------------------------
--
--  "Configurable in settings": the slots are values of a master list, so the
--  office adds, renames or retires one on the Dropdown Lists screen. Sort
--  order is the order the columns appear in.

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'HourlySlot', 'Hourly Slot',
       'Hourly Monitoring - the time-slot columns, in the order shown (L_HourlySlot)', TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = 'HourlySlot');

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active",
                                  "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", v."value", v."sort", TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
  JOIN (VALUES
        ('10:00', 10), ('11:00', 20), ('12:00', 30), ('1:00', 40), ('2:00', 50),
        ('3:00', 60), ('4:00', 70), ('5:30', 80), ('6:30', 90)
       ) AS v("value", "sort") ON TRUE
 WHERE l."code" = 'HourlySlot'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e
      WHERE e."list_id" = l."id" AND e."value" = v."value"
   );
