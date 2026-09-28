-- ===========================================================================
--  MULTI-LINE PURCHASE ORDERS, QUOTATIONS AND GRNs
-- ===========================================================================
--
--  A row of purchase_orders / vendor_quotations / grns becomes ONE LINE of a
--  document. The document - one vendor, one date, one number, one bill - is
--  a new header table above each. Nothing per item moves: tolerances,
--  requirement ceilings, cumulative receipts, rolls and ledger entries stay
--  exactly where they are, on the line rows.
--
--  BACKFILL: every existing row becomes a one-line document whose header
--  number IS the number the row already had (RF-012 stays RF-012). Nothing a
--  vendor already holds is renumbered.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. The headers
-- ---------------------------------------------------------------------------

CREATE TABLE "purchase_order_headers" (
  "id"            UUID NOT NULL,
  "po_no"         VARCHAR(40) NOT NULL,
  "po_date"       DATE NOT NULL,
  "vendor_id"     UUID NOT NULL,
  "address"       TEXT,
  "order_id"      UUID,
  "delivery_date" DATE,
  "payment_terms" VARCHAR(150),
  "remarks"       TEXT,
  "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  "updated_at"    TIMESTAMPTZ(3) NOT NULL,
  "updated_by_id" UUID,
  "deleted_at"    TIMESTAMPTZ(3),
  "deleted_by_id" UUID,
  CONSTRAINT "purchase_order_headers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_headers_vendor_id_fkey" FOREIGN KEY ("vendor_id")
    REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "purchase_order_headers_po_no_key" ON "purchase_order_headers"("po_no");
CREATE INDEX "purchase_order_headers_vendor_id_idx" ON "purchase_order_headers"("vendor_id");
CREATE INDEX "purchase_order_headers_order_id_idx" ON "purchase_order_headers"("order_id");
CREATE INDEX "purchase_order_headers_po_date_idx" ON "purchase_order_headers"("po_date");
CREATE INDEX "purchase_order_headers_deleted_at_idx" ON "purchase_order_headers"("deleted_at");

CREATE TABLE "vendor_quotation_headers" (
  "id"             UUID NOT NULL,
  "quotation_no"   VARCHAR(40) NOT NULL,
  "quotation_date" DATE NOT NULL,
  "vendor_id"      UUID NOT NULL,
  "order_id"       UUID,
  "vendor_ref_no"  VARCHAR(60),
  "valid_until"    DATE,
  "remarks"        TEXT,
  "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id"  UUID,
  "updated_at"     TIMESTAMPTZ(3) NOT NULL,
  "updated_by_id"  UUID,
  "deleted_at"     TIMESTAMPTZ(3),
  "deleted_by_id"  UUID,
  CONSTRAINT "vendor_quotation_headers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vendor_quotation_headers_vendor_id_fkey" FOREIGN KEY ("vendor_id")
    REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "vendor_quotation_headers_quotation_no_key" ON "vendor_quotation_headers"("quotation_no");
CREATE INDEX "vendor_quotation_headers_vendor_id_idx" ON "vendor_quotation_headers"("vendor_id");
CREATE INDEX "vendor_quotation_headers_order_id_idx" ON "vendor_quotation_headers"("order_id");
CREATE INDEX "vendor_quotation_headers_quotation_date_idx" ON "vendor_quotation_headers"("quotation_date");
CREATE INDEX "vendor_quotation_headers_deleted_at_idx" ON "vendor_quotation_headers"("deleted_at");

CREATE TABLE "grn_headers" (
  "id"            UUID NOT NULL,
  "grn_no"        VARCHAR(40) NOT NULL,
  "grn_date"      DATE NOT NULL,
  "vendor_id"     UUID NOT NULL,
  "bill_no"       VARCHAR(60) NOT NULL,
  "bill_date"     DATE,
  "location"      VARCHAR(80),
  "remarks"       TEXT,
  "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  "updated_at"    TIMESTAMPTZ(3) NOT NULL,
  "updated_by_id" UUID,
  "deleted_at"    TIMESTAMPTZ(3),
  "deleted_by_id" UUID,
  CONSTRAINT "grn_headers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grn_headers_vendor_id_fkey" FOREIGN KEY ("vendor_id")
    REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "grn_headers_grn_no_key" ON "grn_headers"("grn_no");
CREATE INDEX "grn_headers_vendor_id_idx" ON "grn_headers"("vendor_id");
CREATE INDEX "grn_headers_bill_no_idx" ON "grn_headers"("bill_no");
CREATE INDEX "grn_headers_grn_date_idx" ON "grn_headers"("grn_date");
CREATE INDEX "grn_headers_deleted_at_idx" ON "grn_headers"("deleted_at");

-- ---------------------------------------------------------------------------
--  2. The line columns, nullable until backfilled
-- ---------------------------------------------------------------------------

ALTER TABLE "purchase_orders"   ADD COLUMN "header_id" UUID, ADD COLUMN "line_no" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "vendor_quotations" ADD COLUMN "header_id" UUID, ADD COLUMN "line_no" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "grns"              ADD COLUMN "header_id" UUID, ADD COLUMN "line_no" INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
--  3. Backfill: one header per existing row, numbered as the row is
-- ---------------------------------------------------------------------------

INSERT INTO "purchase_order_headers"
  ("id", "po_no", "po_date", "vendor_id", "address", "order_id",
   "created_at", "created_by_id", "updated_at", "updated_by_id", "deleted_at", "deleted_by_id")
SELECT gen_random_uuid(), po."po_id", po."po_date", po."vendor_id", po."address", po."order_id",
       po."created_at", po."created_by_id", CURRENT_TIMESTAMP, po."updated_by_id", po."deleted_at", po."deleted_by_id"
  FROM "purchase_orders" po;

UPDATE "purchase_orders" po SET "header_id" = h."id"
  FROM "purchase_order_headers" h WHERE h."po_no" = po."po_id";

INSERT INTO "vendor_quotation_headers"
  ("id", "quotation_no", "quotation_date", "vendor_id", "order_id",
   "created_at", "created_by_id", "updated_at", "updated_by_id", "deleted_at", "deleted_by_id")
SELECT gen_random_uuid(), q."quotation_no", q."quotation_date", q."vendor_id", q."order_id",
       q."created_at", q."created_by_id", CURRENT_TIMESTAMP, q."updated_by_id", q."deleted_at", q."deleted_by_id"
  FROM "vendor_quotations" q;

UPDATE "vendor_quotations" q SET "header_id" = h."id"
  FROM "vendor_quotation_headers" h WHERE h."quotation_no" = q."quotation_no";

INSERT INTO "grn_headers"
  ("id", "grn_no", "grn_date", "vendor_id", "bill_no", "location",
   "created_at", "created_by_id", "updated_at", "updated_by_id", "deleted_at", "deleted_by_id")
SELECT gen_random_uuid(), g."grn_no", g."grn_date", g."vendor_id", g."bill_no", g."location",
       g."created_at", g."created_by_id", CURRENT_TIMESTAMP, g."updated_by_id", g."deleted_at", g."deleted_by_id"
  FROM "grns" g;

UPDATE "grns" g SET "header_id" = h."id"
  FROM "grn_headers" h WHERE h."grn_no" = g."grn_no";

-- ---------------------------------------------------------------------------
--  4. Every line now belongs to a document, and says which line it is
-- ---------------------------------------------------------------------------

ALTER TABLE "purchase_orders"   ALTER COLUMN "header_id" SET NOT NULL;
ALTER TABLE "vendor_quotations" ALTER COLUMN "header_id" SET NOT NULL;
ALTER TABLE "grns"              ALTER COLUMN "header_id" SET NOT NULL;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_header_id_fkey"
  FOREIGN KEY ("header_id") REFERENCES "purchase_order_headers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_header_id_fkey"
  FOREIGN KEY ("header_id") REFERENCES "vendor_quotation_headers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grns" ADD CONSTRAINT "grns_header_id_fkey"
  FOREIGN KEY ("header_id") REFERENCES "grn_headers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "purchase_orders_header_id_line_no_key" ON "purchase_orders"("header_id", "line_no");
CREATE INDEX "purchase_orders_header_id_idx" ON "purchase_orders"("header_id");
CREATE UNIQUE INDEX "vendor_quotations_header_id_line_no_key" ON "vendor_quotations"("header_id", "line_no");
CREATE INDEX "vendor_quotations_header_id_idx" ON "vendor_quotations"("header_id");
CREATE UNIQUE INDEX "grns_header_id_line_no_key" ON "grns"("header_id", "line_no");
CREATE INDEX "grns_header_id_idx" ON "grns"("header_id");

ALTER TABLE "purchase_orders"   ADD CONSTRAINT "purchase_orders_line_no_positive"   CHECK ("line_no" >= 1);
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_line_no_positive" CHECK ("line_no" >= 1);
ALTER TABLE "grns"              ADD CONSTRAINT "grns_line_no_positive"              CHECK ("line_no" >= 1);
