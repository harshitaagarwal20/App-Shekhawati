-- ===========================================================================
--  NOTIFICATIONS - telling people work is waiting for them
-- ===========================================================================
--
--  Until now a document waiting for approval was visible only to someone who
--  opened the approval queue, so orders sat. A notification row is written
--  for each person who should act or should know, after the transaction that
--  caused it commits. The in-app row is the record; email and WhatsApp are
--  deliveries of it, tracked per row so a dispatcher restart resumes rather
--  than re-sends (an outbox).
-- ===========================================================================

ALTER TABLE "users"
  ADD COLUMN "notify_by_email"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_by_whatsapp" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "whatsapp_number"    VARCHAR(20);

ALTER TABLE "users"
  ADD CONSTRAINT "users_whatsapp_number_digits"
  CHECK ("whatsapp_number" IS NULL OR "whatsapp_number" ~ '^[0-9]{8,15}$');

CREATE TABLE "notifications" (
  "id"                  UUID NOT NULL,
  "user_id"             UUID NOT NULL,
  "kind"                VARCHAR(40) NOT NULL,
  "title"               VARCHAR(200) NOT NULL,
  "body"                TEXT,
  "link"                VARCHAR(300),
  "document_type"       VARCHAR(40),
  "document_id"         UUID,
  "document_no"         VARCHAR(60),
  "dedupe_key"          VARCHAR(200),
  "read_at"             TIMESTAMPTZ(3),
  "email_status"        VARCHAR(12) NOT NULL DEFAULT 'SKIPPED',
  "whatsapp_status"     VARCHAR(12) NOT NULL DEFAULT 'SKIPPED',
  "delivery_attempts"   INTEGER NOT NULL DEFAULT 0,
  "last_delivery_error" TEXT,
  "delivered_at"        TIMESTAMPTZ(3),
  "created_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notifications_email_status_known"
    CHECK ("email_status" IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  CONSTRAINT "notifications_whatsapp_status_known"
    CHECK ("whatsapp_status" IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED'))
);

CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");
CREATE INDEX "notifications_email_status_idx" ON "notifications"("email_status");
CREATE INDEX "notifications_whatsapp_status_idx" ON "notifications"("whatsapp_status");
CREATE INDEX "notifications_document_type_document_id_idx" ON "notifications"("document_type", "document_id");
