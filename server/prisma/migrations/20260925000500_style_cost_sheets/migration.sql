-- ===========================================================================
--  STYLE COST SHEETS - FOB costing from the BOM
-- ===========================================================================
--
--  material + conversion + overhead + rejection = total cost per piece;
--  FOB = total cost / (1 - margin - commission). Computed in
--  server/src/domain/costing.js and stored, so what the Director signed is
--  what every report reads. Versioned per style; an approved sheet is frozen.
-- ===========================================================================

CREATE TABLE "style_cost_sheets" (
  "id"                UUID NOT NULL,
  "cost_sheet_no"     VARCHAR(40) NOT NULL,
  "style_id"          UUID NOT NULL,
  "version"           INTEGER NOT NULL,
  "order_id"          UUID,
  "cost_date"         DATE NOT NULL,
  "status"            VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  "currency"          VARCHAR(10) NOT NULL DEFAULT 'USD',
  "exchange_rate"     DECIMAL(18,6) NOT NULL DEFAULT 1,
  "target_price"      DECIMAL(18,4),
  "cmt_cost"          DECIMAL(18,4) NOT NULL DEFAULT 0,
  "print_cost"        DECIMAL(18,4) NOT NULL DEFAULT 0,
  "dye_wash_cost"     DECIMAL(18,4) NOT NULL DEFAULT 0,
  "other_cost"        DECIMAL(18,4) NOT NULL DEFAULT 0,
  "other_cost_label"  VARCHAR(120),
  "overhead_pct"      DECIMAL(9,6) NOT NULL DEFAULT 0,
  "rejection_pct"     DECIMAL(9,6) NOT NULL DEFAULT 0,
  "commission_pct"    DECIMAL(9,6) NOT NULL DEFAULT 0,
  "margin_pct"        DECIMAL(9,6) NOT NULL DEFAULT 0,
  "material_cost"     DECIMAL(18,4),
  "conversion_cost"   DECIMAL(18,4) NOT NULL DEFAULT 0,
  "overhead_amount"   DECIMAL(18,4),
  "rejection_amount"  DECIMAL(18,4),
  "total_cost"        DECIMAL(18,4),
  "commission_amount" DECIMAL(18,4),
  "margin_amount"     DECIMAL(18,4),
  "fob_inr"           DECIMAL(18,4),
  "fob_price"         DECIMAL(18,4),
  "margin_at_target"  DECIMAL(9,6),
  "submitted_at"      TIMESTAMPTZ(3),
  "approved_at"       TIMESTAMPTZ(3),
  "approved_by_id"    UUID,
  "approved_by_name"  VARCHAR(120),
  "rejection_reason"  TEXT,
  "remarks"           TEXT,
  "created_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id"     UUID,
  "updated_at"        TIMESTAMPTZ(3) NOT NULL,
  "updated_by_id"     UUID,
  "deleted_at"        TIMESTAMPTZ(3),
  "deleted_by_id"     UUID,
  CONSTRAINT "style_cost_sheets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "style_cost_sheets_style_id_fkey" FOREIGN KEY ("style_id")
    REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "style_cost_sheets_order_id_fkey" FOREIGN KEY ("order_id")
    REFERENCES "buyer_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "style_cost_sheets_status_known"
    CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  CONSTRAINT "style_cost_sheets_rate_positive" CHECK ("exchange_rate" > 0),
  CONSTRAINT "style_cost_sheets_pcts_in_range" CHECK (
    "overhead_pct" >= 0 AND "overhead_pct" < 1 AND
    "rejection_pct" >= 0 AND "rejection_pct" < 1 AND
    "commission_pct" >= 0 AND "margin_pct" >= 0 AND
    "commission_pct" + "margin_pct" < 1
  ),
  CONSTRAINT "style_cost_sheets_costs_non_negative" CHECK (
    "cmt_cost" >= 0 AND "print_cost" >= 0 AND "dye_wash_cost" >= 0 AND "other_cost" >= 0
  )
);

CREATE UNIQUE INDEX "style_cost_sheets_cost_sheet_no_key" ON "style_cost_sheets"("cost_sheet_no");
CREATE UNIQUE INDEX "style_cost_sheets_style_id_version_key" ON "style_cost_sheets"("style_id", "version");
CREATE INDEX "style_cost_sheets_style_id_idx" ON "style_cost_sheets"("style_id");
CREATE INDEX "style_cost_sheets_order_id_idx" ON "style_cost_sheets"("order_id");
CREATE INDEX "style_cost_sheets_status_idx" ON "style_cost_sheets"("status");
CREATE INDEX "style_cost_sheets_deleted_at_idx" ON "style_cost_sheets"("deleted_at");

-- At most one live approved costing per style.
CREATE UNIQUE INDEX "style_cost_sheets_one_approved_per_style"
  ON "style_cost_sheets"("style_id") WHERE "status" = 'APPROVED' AND "deleted_at" IS NULL;

CREATE TABLE "style_cost_sheet_lines" (
  "id"                UUID NOT NULL,
  "cost_sheet_id"     UUID NOT NULL,
  "line_no"           INTEGER NOT NULL,
  "bom_line_no"       INTEGER,
  "item_category"     VARCHAR(60) NOT NULL,
  "sub_category"      VARCHAR(60),
  "accessories_item"  VARCHAR(80),
  "color_code"        VARCHAR(60),
  "description"       VARCHAR(200),
  "uom"               VARCHAR(20) NOT NULL,
  "consumption"       DECIMAL(12,4) NOT NULL,
  "wastage_pct"       DECIMAL(9,6) NOT NULL DEFAULT 0,
  "gross_consumption" DECIMAL(14,6) NOT NULL,
  "rate"              DECIMAL(18,4),
  "rate_source"       VARCHAR(200),
  "amount"            DECIMAL(18,4),
  CONSTRAINT "style_cost_sheet_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "style_cost_sheet_lines_cost_sheet_id_fkey" FOREIGN KEY ("cost_sheet_id")
    REFERENCES "style_cost_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "style_cost_sheet_lines_non_negative"
    CHECK ("consumption" >= 0 AND "wastage_pct" >= 0 AND ("rate" IS NULL OR "rate" >= 0)),
  CONSTRAINT "style_cost_sheet_lines_amount_follows_rate"
    CHECK (("rate" IS NULL) = ("amount" IS NULL))
);

CREATE UNIQUE INDEX "style_cost_sheet_lines_cost_sheet_id_line_no_key"
  ON "style_cost_sheet_lines"("cost_sheet_id", "line_no");
CREATE INDEX "style_cost_sheet_lines_cost_sheet_id_idx" ON "style_cost_sheet_lines"("cost_sheet_id");

-- ---------------------------------------------------------------------------
--  The counter: CS-0001
-- ---------------------------------------------------------------------------
INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "created_at", "updated_at")
SELECT gen_random_uuid(), 'COST_SHEET', '', 'CS', '', '-', 4, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (
   SELECT 1 FROM "document_sequences" WHERE "document_type" = 'COST_SHEET' AND "scope_key" = ''
 );

-- ---------------------------------------------------------------------------
--  Permissions. Granted by what roles already hold, not by role name:
--    view / create / edit / export  -> whoever creates buyer orders
--    view                           -> whoever edits the style master
--    view / export / approve        -> whoever approves buyer orders
--    everything                     -> the ADMIN role
-- ---------------------------------------------------------------------------
INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, 'COST_SHEET', v.action, v.description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('COST_SHEET.VIEW', 'VIEW', 'View cost sheet'),
    ('COST_SHEET.CREATE', 'CREATE', 'Create cost sheet'),
    ('COST_SHEET.EDIT', 'EDIT', 'Edit cost sheet'),
    ('COST_SHEET.DELETE', 'DELETE', 'Delete cost sheet'),
    ('COST_SHEET.APPROVE', 'APPROVE', 'Approve cost sheet'),
    ('COST_SHEET.EXPORT', 'EXPORT', 'Export cost sheet')
  ) AS v(code, action, description)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT DISTINCT rp."role_id", np."id", CURRENT_TIMESTAMP
  FROM (VALUES
    ('COST_SHEET.VIEW',    'BUYER_ORDER.CREATE'),
    ('COST_SHEET.CREATE',  'BUYER_ORDER.CREATE'),
    ('COST_SHEET.EDIT',    'BUYER_ORDER.CREATE'),
    ('COST_SHEET.EXPORT',  'BUYER_ORDER.CREATE'),
    ('COST_SHEET.VIEW',    'STYLE.EDIT'),
    ('COST_SHEET.VIEW',    'BUYER_ORDER.APPROVE'),
    ('COST_SHEET.EXPORT',  'BUYER_ORDER.APPROVE'),
    ('COST_SHEET.APPROVE', 'BUYER_ORDER.APPROVE')
  ) AS m(new_code, like_code)
  JOIN "permissions" np ON np."code" = m.new_code
  JOIN "permissions" lp ON lp."code" = m.like_code
  JOIN "role_permissions" rp ON rp."permission_id" = lp."id"
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."role_id" = rp."role_id" AND x."permission_id" = np."id"
 );

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
  FROM "roles" r
  JOIN "permissions" p ON p."module" = 'COST_SHEET'
 WHERE r."code" = 'ADMIN'
   AND NOT EXISTS (
     SELECT 1 FROM "role_permissions" x WHERE x."role_id" = r."id" AND x."permission_id" = p."id"
   );
