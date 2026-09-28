-- ===========================================================================
--  THE BUYER'S MEASUREMENT SHEET, HELD RATHER THAN REFERRED TO
-- ===========================================================================
--
--  buyer_orders.measurement_sheet_ref has existed since C9 and holds a
--  FILENAME. It was never wired to a screen, and a filename is only worth what
--  the shared folder behind it is worth: the row survives, the file is moved,
--  and the order can no longer be traced back to the sheet its per-piece
--  figures came from. That is the exact failure the column existed to prevent.
--
--  The bytes go in the database rather than in a folder on the machine because
--  a folder makes the backup two things instead of one, and the first time only
--  one of them is restored every row here points at a file that is gone.
--
--  The old columns are LEFT ALONE. They may hold a reference somebody typed,
--  and dropping them would discard it to save nothing.
-- ===========================================================================

CREATE TABLE "buyer_order_attachments" (
  "id"               UUID         NOT NULL,
  "buyer_order_id"   UUID         NOT NULL,
  "file_name"        VARCHAR(255) NOT NULL,
  "mime_type"        VARCHAR(120) NOT NULL,
  "size_bytes"       INTEGER      NOT NULL,
  "note"             TEXT,
  "data"             BYTEA        NOT NULL,
  "uploaded_by_id"   UUID,
  "uploaded_by_name" VARCHAR(120),
  "created_at"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"       TIMESTAMPTZ(3),
  "deleted_by_id"    UUID,

  CONSTRAINT "buyer_order_attachments_pkey" PRIMARY KEY ("id")
);

-- Cascade: an attachment is part of its order and has no meaning without it.
ALTER TABLE "buyer_order_attachments"
  ADD CONSTRAINT "buyer_order_attachments_buyer_order_id_fkey"
  FOREIGN KEY ("buyer_order_id") REFERENCES "buyer_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "buyer_order_attachments_buyer_order_id_idx"
  ON "buyer_order_attachments"("buyer_order_id");
CREATE INDEX "buyer_order_attachments_deleted_at_idx"
  ON "buyer_order_attachments"("deleted_at");

-- A stored file must have content. Zero bytes is a failed upload, not a file.
ALTER TABLE "buyer_order_attachments"
  ADD CONSTRAINT "buyer_order_attachments_size_positive"
  CHECK ("size_bytes" > 0);
