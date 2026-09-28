-- ===========================================================================
--  Phase 8 - the counter that issues inventory item codes (ITM-0001).
--
--  This is a migration of its own, and not the tail of the one before it,
--  because PostgreSQL refuses to let a transaction USE an enum value that the
--  same transaction added. The previous migration adds INVENTORY_ITEM to
--  DocumentType; the row below is the first use of it, so it has to wait for
--  the next transaction.
--
--  Why item codes come from document_sequences at all: a GRN posting resolves
--  or creates its inventory item inside the same transaction as the receipt,
--  the roll and the ledger entry. document_sequences is incremented with an
--  UPDATE inside that transaction, so a receipt that rolls back gives its item
--  code back with everything else. A bare Postgres SEQUENCE would not - nextval
--  survives a rollback by design, and the codes would develop gaps that look
--  like deleted stock.
--
--  next_number starts past the codes the seeder issues so a seeded database and
--  a fresh one both keep going from a safe point.
-- ===========================================================================

INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "description", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'INVENTORY_ITEM', '', 'ITM', '', '-',
   4, 100, 'Inventory item code - ITM-0001', NOW(), NOW())
ON CONFLICT ("document_type", "scope_key") DO NOTHING;
