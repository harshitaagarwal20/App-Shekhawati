-- ===========================================================================
--  COST_SHEET joins DocumentType
--
--  On its own because PostgreSQL will not use a new enum value in the same
--  transaction that added it, and the next migration inserts its sequence.
-- ===========================================================================

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'COST_SHEET';
