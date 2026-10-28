-- ===========================================================================
--  INTERNAL QUALITY CHECK - A COUNT PER DEFECT TYPE
-- ===========================================================================
--
--  A check carried one Defect Type and one typed Total Defect Pcs, so a
--  checker who found 5 stained and 2 torn pieces could record only one of
--  them. Each defect type found is now its own line with its own count, and
--  Total Defect Pcs is the sum of the lines, worked out by the server.
--
--  Every existing check keeps what it said: its total becomes one line under
--  its old defect type, or under "Not specified" where none was chosen.
-- ===========================================================================

-- CreateTable
CREATE TABLE "internal_quality_defects" (
    "id" UUID NOT NULL,
    "check_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "defect_type" VARCHAR(120) NOT NULL,
    "qty" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "internal_quality_defects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "internal_quality_defects_check_id_line_no_key" ON "internal_quality_defects"("check_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "internal_quality_defects_check_id_defect_type_key" ON "internal_quality_defects"("check_id", "defect_type");

-- CreateIndex
CREATE INDEX "internal_quality_defects_defect_type_idx" ON "internal_quality_defects"("defect_type");

-- AddForeignKey
ALTER TABLE "internal_quality_defects" ADD CONSTRAINT "internal_quality_defects_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "internal_quality_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A line is a defect found: at least one piece.
ALTER TABLE "internal_quality_defects"
  ADD CONSTRAINT "internal_quality_defects_qty_positive" CHECK ("qty" > 0);

-- --- The existing checks, one line each ------------------------------------

INSERT INTO "internal_quality_defects" ("id", "check_id", "line_no", "defect_type", "qty", "created_at", "created_by_id")
SELECT gen_random_uuid(),
       c."id",
       1,
       COALESCE(NULLIF(btrim(c."defect_type"), ''), 'Not specified'),
       c."total_defect_pcs",
       c."created_at",
       c."created_by_id"
  FROM "internal_quality_checks" AS c
 WHERE c."total_defect_pcs" > 0;

-- The type now lives on the lines.
ALTER TABLE "internal_quality_checks" DROP COLUMN "defect_type";
