-- ===========================================================================
--  SAMPLE CHECK ON CUT PIECES, BEFORE STITCHING
-- ===========================================================================
--
--  Every cut-pieces lot is checked on a sample before it may be issued to
--  stitching. The defects found are recorded by panel and type, and the rate
--  against the accept limit decides the lot (src/domain/cutCheck.js). A
--  Cutting Issue can only send pieces from PASSED lots.
--
--  BACKFILL: receipts that already exist predate the check. Pieces from them
--  have been - or are being - issued on the old rule, and stranding them as
--  PENDING would stop every order mid-way. They are marked PASSED with no
--  sample, which the screens show as "before checking began".
-- ===========================================================================

CREATE TYPE "CutCheckStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED');

ALTER TABLE "cut_pieces_receipts"
  ADD COLUMN "check_status"     "CutCheckStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "sample_qty"       DECIMAL(18,4),
  ADD COLUMN "defective_pcs"    DECIMAL(18,4),
  ADD COLUMN "defect_rate_pct"  DECIMAL(9,3),
  ADD COLUMN "accept_limit_pct" DECIMAL(9,3),
  ADD COLUMN "checked_at"       TIMESTAMPTZ(3),
  ADD COLUMN "checked_by_id"    UUID,
  ADD COLUMN "checked_by_name"  VARCHAR(120),
  ADD COLUMN "check_remarks"    TEXT;

UPDATE "cut_pieces_receipts" SET "check_status" = 'PASSED';

-- A sample is part of the lot, and the defects are part of the sample.
ALTER TABLE "cut_pieces_receipts"
  ADD CONSTRAINT "cut_pieces_receipts_sample_within_lot" CHECK (
        ("sample_qty"    IS NULL OR ("sample_qty" > 0 AND "sample_qty" <= "pcs_received"))
    AND ("defective_pcs" IS NULL OR ("defective_pcs" >= 0
                                     AND "defective_pcs" <= COALESCE("sample_qty", 0)))
  );

CREATE INDEX "cut_pieces_receipts_check_status_idx" ON "cut_pieces_receipts"("check_status");

CREATE TABLE "cut_piece_defects" (
    "id"            UUID NOT NULL,
    "receipt_id"    UUID NOT NULL,
    "line_no"       INTEGER NOT NULL,
    "panel"         VARCHAR(80),
    "defect_type"   VARCHAR(80) NOT NULL,
    "qty"           DECIMAL(18,4) NOT NULL,
    "remarks"       TEXT,
    "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "cut_piece_defects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cut_piece_defects_qty_positive" CHECK ("qty" > 0)
);

CREATE UNIQUE INDEX "cut_piece_defects_receipt_id_line_no_key" ON "cut_piece_defects"("receipt_id", "line_no");
CREATE INDEX "cut_piece_defects_receipt_id_idx" ON "cut_piece_defects"("receipt_id");
CREATE INDEX "cut_piece_defects_defect_type_idx" ON "cut_piece_defects"("defect_type");

ALTER TABLE "cut_piece_defects"
  ADD CONSTRAINT "cut_piece_defects_receipt_id_fkey" FOREIGN KEY ("receipt_id")
  REFERENCES "cut_pieces_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- L_CutPieceDefect - what a checker finds on a cut panel. Editable on the
-- Master Lists screen like every other list.
INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'CutPieceDefect', 'Cut Piece Defect',
       'Cut Pieces Receipt - sample check defect types (L_CutPieceDefect)', TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = 'CutPieceDefect');

INSERT INTO "master_list_values" ("id", "list_id", "value", "sort_order", "is_active",
                                  "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", v."value", v."sort", TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
  JOIN (VALUES
        ('Hole', 10), ('Stain', 20), ('Shade Variation', 30), ('Weaving Fault', 40),
        ('Mis-cut / Wrong Shape', 50), ('Wrong Size', 60), ('Notch Missing', 70),
        ('Fraying Edge', 80), ('Print Defect', 90), ('Wrong Grain', 100)
       ) AS v("value", "sort") ON TRUE
 WHERE l."code" = 'CutPieceDefect'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e
      WHERE e."list_id" = l."id" AND e."value" = v."value"
   );
