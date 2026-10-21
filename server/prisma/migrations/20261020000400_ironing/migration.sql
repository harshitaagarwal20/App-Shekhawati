-- ===========================================================================
--  IRONING - after stitching, before final QC
-- ===========================================================================
--
--    ironing_entries     pieces received from a unit, ironed, damaged - and
--                        how each damaged piece was decided (re-iron/reject)
--    pending_rejects     pieces rejected at ironing, held until the Rejected
--                        Register (Phase 3) exists to take them
--    cutting_issues      + pcs received at ironing and a receipt status
--                        (Not received / Partially received / Closed), both
--                        derived by the ironing service
--    printings.from_unit the unit stitched pieces were sent for printing from,
--                        so they are held against that unit
--
--  And the reference data: IRONING permissions, the FINISHING_SUPERVISOR
--  role, the IroningDamage list, "Ironer" and "Finishing" on the employee
--  dropdowns.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "IroningReceiptStatus" AS ENUM ('NOT_RECEIVED', 'PARTIALLY_RECEIVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PendingRejectStatus" AS ENUM ('PENDING', 'TRANSFERRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "printings" ADD COLUMN     "from_unit" VARCHAR(80);

-- AlterTable
ALTER TABLE "cutting_issues" ADD COLUMN     "ironing_receipt_status" "IroningReceiptStatus" NOT NULL DEFAULT 'NOT_RECEIVED',
ADD COLUMN     "pcs_received_at_ironing" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ironing_entries" (
    "id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "from_unit" VARCHAR(80) NOT NULL,
    "ironer_id" UUID,
    "pcs_received" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pcs_ironed" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pcs_damaged" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "damage_type" VARCHAR(60),
    "pcs_re_ironed" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pcs_rejected" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "recorded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "ironing_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_rejects" (
    "id" UUID NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "ironing_entry_id" UUID,
    "order_id" UUID NOT NULL,
    "style_id" UUID NOT NULL,
    "unit" VARCHAR(80) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "reason" VARCHAR(120) NOT NULL,
    "defect_type" VARCHAR(60),
    "status" "PendingRejectStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "pending_rejects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ironing_entries_from_unit_order_id_style_id_idx" ON "ironing_entries"("from_unit", "order_id", "style_id");

-- CreateIndex
CREATE INDEX "ironing_entries_entry_date_idx" ON "ironing_entries"("entry_date");

-- CreateIndex
CREATE INDEX "ironing_entries_order_id_idx" ON "ironing_entries"("order_id");

-- CreateIndex
CREATE INDEX "ironing_entries_style_id_idx" ON "ironing_entries"("style_id");

-- CreateIndex
CREATE INDEX "ironing_entries_ironer_id_idx" ON "ironing_entries"("ironer_id");

-- CreateIndex
CREATE INDEX "ironing_entries_deleted_at_idx" ON "ironing_entries"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "pending_rejects_ironing_entry_id_key" ON "pending_rejects"("ironing_entry_id");

-- CreateIndex
CREATE INDEX "pending_rejects_status_idx" ON "pending_rejects"("status");

-- CreateIndex
CREATE INDEX "pending_rejects_order_id_idx" ON "pending_rejects"("order_id");

-- AddForeignKey
ALTER TABLE "ironing_entries" ADD CONSTRAINT "ironing_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ironing_entries" ADD CONSTRAINT "ironing_entries_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ironing_entries" ADD CONSTRAINT "ironing_entries_ironer_id_fkey" FOREIGN KEY ("ironer_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_rejects" ADD CONSTRAINT "pending_rejects_ironing_entry_id_fkey" FOREIGN KEY ("ironing_entry_id") REFERENCES "ironing_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_rejects" ADD CONSTRAINT "pending_rejects_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "buyer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_rejects" ADD CONSTRAINT "pending_rejects_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- --- The arithmetic, held in the database as well as the service ----------

ALTER TABLE "ironing_entries"
  ADD CONSTRAINT "ironing_entries_quantities_non_negative" CHECK (
    "pcs_received" >= 0 AND "pcs_ironed" >= 0 AND "pcs_damaged" >= 0
    AND "pcs_re_ironed" >= 0 AND "pcs_rejected" >= 0
  ),
  -- Every damaged piece is decided at most once.
  ADD CONSTRAINT "ironing_entries_decided_within_damaged" CHECK (
    "pcs_re_ironed" + "pcs_rejected" <= "pcs_damaged"
  ),
  ADD CONSTRAINT "ironing_entries_damage_names_its_type" CHECK (
    "pcs_damaged" = 0 OR "damage_type" IS NOT NULL
  ),
  ADD CONSTRAINT "ironing_entries_says_something" CHECK (
    "pcs_received" + "pcs_ironed" + "pcs_damaged" > 0
  );

ALTER TABLE "pending_rejects"
  ADD CONSTRAINT "pending_rejects_qty_positive" CHECK ("qty" > 0);

ALTER TABLE "cutting_issues"
  ADD CONSTRAINT "cutting_issues_received_at_ironing_non_negative" CHECK (
    "pcs_received_at_ironing" >= 0
  );

-- --- Older after-stitching printing rows ----------------------------------
--
--  Rows written before "Pcs Received Back" existed say nothing about what
--  came back. One marked COMPLETED is back by definition, so the printing
--  register and the printing-status report show it as back rather than out.
--  (Rows with no from_unit are not counted by the unit flow check at all -
--  see unitFlow.service.js.)

UPDATE "printings"
   SET "qty_received" = "qty"
 WHERE "fabric_stage" = 'AFTER_STITCHING'
   AND "status" = 'COMPLETED'
   AND "qty_received" = 0;

-- --- Permissions, role, grants --------------------------------------------

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, 'IRONING', v.action, v.description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('IRONING.VIEW',   'VIEW',   'View ironing'),
    ('IRONING.CREATE', 'CREATE', 'Create ironing'),
    ('IRONING.EDIT',   'EDIT',   'Edit ironing'),
    ('IRONING.DELETE', 'DELETE', 'Delete ironing'),
    ('IRONING.EXPORT', 'EXPORT', 'Export ironing')
  ) AS v(code, action, description)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

INSERT INTO "roles" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(),
       'FINISHING_SUPERVISOR',
       'Ironing & Finishing Supervisor',
       'Runs the ironing table: receives stitched pieces from the units, records '
       || 'what each ironer pressed and damaged, and decides each damaged piece - '
       || 're-iron or reject.',
       TRUE,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'FINISHING_SUPERVISOR');

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
  FROM (VALUES
    ('FINISHING_SUPERVISOR', 'IRONING.VIEW'),
    ('FINISHING_SUPERVISOR', 'IRONING.CREATE'),
    ('FINISHING_SUPERVISOR', 'IRONING.EDIT'),
    ('FINISHING_SUPERVISOR', 'IRONING.EXPORT'),
    ('FINISHING_SUPERVISOR', 'MASTER_LIST.VIEW'),
    ('FINISHING_SUPERVISOR', 'REPORT.VIEW'),
    ('ADMIN', 'IRONING.VIEW'),
    ('ADMIN', 'IRONING.CREATE'),
    ('ADMIN', 'IRONING.EDIT'),
    ('ADMIN', 'IRONING.DELETE'),
    ('ADMIN', 'IRONING.EXPORT'),
    ('DIRECTOR', 'IRONING.VIEW'),
    ('DIRECTOR', 'IRONING.EXPORT'),
    ('MERCHANDISING', 'IRONING.VIEW'),
    ('MERCHANDISING', 'IRONING.EXPORT'),
    ('STORE_MANAGER', 'IRONING.VIEW'),
    ('STORE_MANAGER', 'IRONING.EXPORT')
  ) AS g(role_code, permission_code)
  JOIN "roles" r ON r."code" = g.role_code
  JOIN "permissions" p ON p."code" = g.permission_code
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- --- Dropdown values --------------------------------------------------------

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'IroningDamage', 'Ironing Damage',
       'Ironing - the damage type of a piece damaged at the ironing table (L_IroningDamage)', TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = 'IroningDamage');

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", v."value", v."sort", TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
  JOIN (VALUES
        ('IroningDamage', 'Iron Shine', 10),
        ('IroningDamage', 'Scorch-Burn', 20),
        ('IroningDamage', 'Water Mark', 30),
        -- Appended after the existing values, so nothing already sorted moves.
        ('Designation', 'Ironer', 1000),
        ('Department', 'Finishing', 1000)
       ) AS v("list", "value", "sort") ON l."code" = v."list"
 WHERE NOT EXISTS (
   SELECT 1 FROM "master_list_values" e
    WHERE e."list_id" = l."id" AND e."value" = v."value"
 );
