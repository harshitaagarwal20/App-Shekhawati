-- ===========================================================================
--  Phase 5 - Vendor Quotation: reasoned decisions and a server-owned Amount
--
--  The "Vendor Quotation-Approval" sheet holds Amount as a formula
--  (Rate x Qty). In the ERP that formula lives in vendorQuotation.service.js
--  and runs on every write; the column below simply stores the result. A
--  client-supplied amount is stripped by the validator and never reaches the
--  database, and the CHECK here is the last line of that defence.
--
--  The sheet records a rejection only in Remarks. A decision that blocks
--  procurement deserves its own reasoned field, and an approval deserves a
--  name that was stamped rather than typed - so both get columns, matching how
--  buyer_orders carries the Director's excess decision.
-- ===========================================================================

-- AlterTable
ALTER TABLE "vendor_quotations"
  ADD COLUMN "rejection_reason"  TEXT,
  ADD COLUMN "approved_by_name"  VARCHAR(120),
  ADD COLUMN "decided_at"        TIMESTAMPTZ(3);

-- ---------------------------------------------------------------------------
--  Backfill. Rows seeded from the workbook are settled quotations: the ones
--  the sheet marks Approved or Rejected were decided by the name in the
--  "Authorised By" column on the quotation date.
-- ---------------------------------------------------------------------------
UPDATE "vendor_quotations"
   SET "approved_by_name" = CASE WHEN "authorisation_status" <> 'PENDING'
                                 THEN "authorised_by" END,
       "decided_at"       = CASE WHEN "authorisation_status" <> 'PENDING'
                                 THEN COALESCE("approved_at", "created_at") END,
       "rejection_reason" = CASE WHEN "authorisation_status" = 'REJECTED'
                                 THEN COALESCE("remarks", 'Rejected before this system was in use')
                                 END;

-- CreateIndex
CREATE INDEX "vendor_quotations_item_idx" ON "vendor_quotations"("item");

-- ---------------------------------------------------------------------------
--  Constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "vendor_quotations"
  -- Amount is Rate x Qty and nothing else. Rounded to the stored scale of 2,
  -- so the check agrees with the column rather than fighting it.
  ADD CONSTRAINT "vendor_quotations_amount_is_rate_x_qty"
    CHECK ("amount" = ROUND("rate_quoted" * "qty", 2)),

  -- A decision needs its evidence, both ways round.
  ADD CONSTRAINT "vendor_quotations_rejection_reason_present"
    CHECK ("authorisation_status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL),
  ADD CONSTRAINT "vendor_quotations_approved_at_present"
    CHECK ("authorisation_status" <> 'APPROVED' OR "approved_at" IS NOT NULL),

  -- Nothing is decided anonymously, and a pending quotation has no decision.
  ADD CONSTRAINT "vendor_quotations_decided_by_present"
    CHECK ("authorisation_status" = 'PENDING' OR "approved_by_name" IS NOT NULL),
  ADD CONSTRAINT "vendor_quotations_pending_has_no_decision"
    CHECK ("authorisation_status" <> 'PENDING'
           OR ("approved_at" IS NULL AND "decided_at" IS NULL
               AND "rejection_reason" IS NULL));
