-- The buyer address book.
--
-- A buyer used to hold exactly three addresses, and those three are ROLES on a
-- shipping document rather than slots in a list: its own address, the
-- consignee, and the notify party. They stay on the `buyers` row, because the
-- printed documents, the import sheet and the export each name them.
--
-- This table is every OTHER place a buyer has us send goods. Trade Word's
-- orders went twice to "Trade Word DC, New Jersey", which is none of its three,
-- so it was typed by hand each time and offered by nothing.
--
-- Hand-written rather than generated. `prisma migrate diff` wanted to drop a
-- foreign key and thirteen indexes that exist in the database but are not
-- declared in schema.prisma - drift from migrations edited after they were
-- applied. That drift is real and worth fixing, but it is not this change, and
-- dropping those indexes as a side effect of adding a table would be a bad
-- trade. This file therefore contains only the new table.

CREATE TABLE "buyer_addresses" (
    "id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200),
    "address" TEXT NOT NULL,
    "country" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "buyer_addresses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "buyer_addresses_buyer_id_idx" ON "buyer_addresses"("buyer_id");
CREATE INDEX "buyer_addresses_deleted_at_idx" ON "buyer_addresses"("deleted_at");
CREATE UNIQUE INDEX "buyer_addresses_buyer_id_line_no_key" ON "buyer_addresses"("buyer_id", "line_no");

ALTER TABLE "buyer_addresses"
    ADD CONSTRAINT "buyer_addresses_buyer_id_fkey"
    FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
