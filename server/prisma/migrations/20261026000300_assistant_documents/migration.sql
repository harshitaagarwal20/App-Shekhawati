-- The assistant: reference documents, their searchable chunks, and the
-- ASSISTANT permissions. See services/assistant.service.js.

-- CreateTable
CREATE TABLE "assistant_documents" (
    "id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "page_count" INTEGER,
    "required_permission" VARCHAR(80),
    "uploaded_by_id" UUID,
    "uploaded_by_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "assistant_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "page" INTEGER,
    "text" TEXT NOT NULL,
    "embedding" BYTEA NOT NULL,

    CONSTRAINT "assistant_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_documents_deleted_at_idx" ON "assistant_documents"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_chunks_document_id_seq_key" ON "assistant_chunks"("document_id", "seq");

-- AddForeignKey
ALTER TABLE "assistant_chunks" ADD CONSTRAINT "assistant_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "assistant_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 384 float32 values, and nothing else.
ALTER TABLE "assistant_chunks" ADD CONSTRAINT "assistant_chunks_embedding_size" CHECK (octet_length("embedding") = 1536);

-- The permissions, as buildPermissions() in seed/data/rbac.js issues them:
-- VIEW asks questions, CREATE uploads a document, DELETE removes one.
INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'ASSISTANT.' || a.action, 'ASSISTANT', a.action,
       initcap(lower(a.action)) || ' assistant',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES ('VIEW'), ('CREATE'), ('DELETE')) AS a(action)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = 'ASSISTANT.' || a.action);

-- ADMIN everything; the Director asks and uploads. Removing a document stays
-- with ADMIN.
INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
  FROM (
    SELECT 'ADMIN' AS role_code, a.action
      FROM (VALUES ('VIEW'), ('CREATE'), ('DELETE')) AS a(action)
    UNION ALL
    SELECT 'DIRECTOR', a.action FROM (VALUES ('VIEW'), ('CREATE')) AS a(action)
  ) AS g
  JOIN "roles" r ON r."code" = g.role_code
  JOIN "permissions" p ON p."code" = 'ASSISTANT.' || g.action
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;
