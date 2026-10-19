-- ===========================================================================
--  EXCESS RULES: ONLY WHAT IS READ
-- ===========================================================================
--
--  Five of the eight seeded excess rules were shown on the Excess Rules screen
--  as policy while nothing read them. Editing one changed nothing. This
--  retires the ones that cannot apply and clears the fields that are never
--  read, so the screen says what the system does. See RULE_CONSUMERS in
--  src/services/excess.service.js, which the service now enforces on create.
--
--  Retired = soft-deleted and deactivated, exactly as the screen's own delete
--  does. The rows stay, so the audit trail and any authorisation that
--  snapshotted one keep their reference.
--
--  Not touched: BUYER_ORDER (now read - the order band was a constant),
--  CUTTING_ISSUE, the PO and GRN percentages, and GLOBAL.
-- ---------------------------------------------------------------------------

-- 1. Rules for a document type nothing reads. DYE_ISSUE is the seeded one:
--    job-work shrinkage moved to shrinkage_rules (C3).
UPDATE "excess_rules"
SET "deleted_at" = CURRENT_TIMESTAMP,
    "is_active"  = false,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "deleted_at" IS NULL
  AND COALESCE("document_type"::text,
               CASE WHEN "scope"::text = 'DOCUMENT_TYPE' THEN "scope_key" END)
      NOT IN ('BUYER_ORDER', 'CUTTING_ISSUE', 'PURCHASE_ORDER', 'GRN');

-- 2. Item-category rules that cannot apply.
--    Only purchase orders and receipts are judged by item category, and only
--    where the tolerance master has no row in force for that category - which
--    for the seeded Accessories pair it does (C2).
UPDATE "excess_rules" r
SET "deleted_at" = CURRENT_TIMESTAMP,
    "is_active"  = false,
    "updated_at" = CURRENT_TIMESTAMP
WHERE r."deleted_at" IS NULL
  AND r."scope"::text = 'ITEM_CATEGORY'
  AND (
        r."document_type"::text IN ('BUYER_ORDER', 'CUTTING_ISSUE')
     OR EXISTS (
          SELECT 1
          FROM "tolerance_rules" t
          WHERE t."deleted_at" IS NULL
            AND t."is_active"
            AND t."effective_from" <= CURRENT_DATE
            AND (t."effective_to" IS NULL OR t."effective_to" >= CURRENT_DATE)
            -- The same mapping as src/domain/itemCategory.js.
            AND t."category"::text = CASE lower(trim(r."scope_key"))
                  WHEN 'fabric'             THEN 'FABRIC'
                  WHEN 'accessories'        THEN 'ACCESSORIES'
                  WHEN 'handle'             THEN 'ACCESSORIES'
                  WHEN 'zipper'             THEN 'ACCESSORIES'
                  WHEN 'label'              THEN 'ACCESSORIES'
                  WHEN 'thread'             THEN 'ACCESSORIES'
                  WHEN 'button'             THEN 'ACCESSORIES'
                  WHEN 'packaging material' THEN 'PACKAGING'
                  WHEN 'packaging'          THEN 'PACKAGING'
                  WHEN 'stationery'         THEN 'STATIONERY'
                  WHEN 'stationary'         THEN 'STATIONERY'
                END
        )
      );

-- 3. Purchase orders and receipts read the percentage alone - a PO over it is
--    refused, a receipt over it is flagged - so a ceiling on their rule is
--    never consulted. Cleared rather than left looking like a limit.
UPDATE "excess_rules"
SET "hard_ceiling_pct" = NULL,
    "updated_at"       = CURRENT_TIMESTAMP
WHERE "deleted_at" IS NULL
  AND "hard_ceiling_pct" IS NOT NULL
  AND COALESCE("document_type"::text,
               CASE WHEN "scope"::text = 'DOCUMENT_TYPE' THEN "scope_key" END)
      IN ('PURCHASE_ORDER', 'GRN');
