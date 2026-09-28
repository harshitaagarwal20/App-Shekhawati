-- ===========================================================================
--  GST ON THE PURCHASE INVOICE
-- ===========================================================================
--
--  The workbook records no tax anywhere. It was written to track cloth, not to
--  satisfy a tax authority, so "Amount" on the GRN sheet is the taxable value
--  and the story stops there.
--
--  A purchase invoice cannot stop there. The document has to reproduce the bill
--  the vendor actually sent, and that bill carries CGST + SGST or IGST. So the
--  receipt gains the tax it was charged.
--
--  THREE THINGS ARE DELIBERATE HERE.
--
--  1. EVERY COLUMN IS NULLABLE OR ZERO-DEFAULTED.
--     Seven years of workbook receipts have no tax on them, and inventing a
--     rate for them would put a number on a legal document that nobody ever
--     charged. A receipt with no rate prints "GST not recorded", which is true.
--
--  2. THE RATE IS A FRACTION, NOT A PERCENTAGE.
--     0.05, not 5. The same convention as excess_pct and variation_pct, so no
--     screen has to remember which columns are which.
--
--  3. THE SPLIT IS STORED, NOT DERIVED AT PRINT TIME.
--     supply_type and vendor_gstin are frozen onto the receipt when it posts.
--     Correcting a vendor's GSTIN next year must not silently re-tax a receipt
--     that was settled last year.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "SupplyType" AS ENUM ('INTRA_STATE', 'INTER_STATE');

-- AlterTable
ALTER TABLE "grns"
  ADD COLUMN "gst_rate_pct"  DECIMAL(7,6),
  ADD COLUMN "supply_type"   "SupplyType",
  ADD COLUMN "vendor_gstin"  VARCHAR(20),
  ADD COLUMN "cgst_amount"   DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "sgst_amount"   DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "igst_amount"   DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "invoice_total" DECIMAL(18,2);

-- ---------------------------------------------------------------------------
--  The arithmetic, asserted in the database
--
--  Multiplication and addition on numeric are exact, and decimal.js rounds half
--  up exactly as ROUND() does here - so unlike the division constraints
--  elsewhere in this schema, these can be equalities rather than tolerances.
--  If the service and the database ever disagree by a paisa, the row is
--  refused rather than printed.
-- ---------------------------------------------------------------------------

ALTER TABLE "grns"
  -- A rate is a fraction between zero and one.
  ADD CONSTRAINT "grns_gst_rate_range"
    CHECK ("gst_rate_pct" IS NULL OR ("gst_rate_pct" >= 0 AND "gst_rate_pct" < 1)),

  ADD CONSTRAINT "grns_tax_amounts_non_negative"
    CHECK ("cgst_amount" >= 0 AND "sgst_amount" >= 0 AND "igst_amount" >= 0),

  -- No rate means no tax. Anything else is a figure nobody chose.
  ADD CONSTRAINT "grns_no_rate_means_no_tax"
    CHECK ("gst_rate_pct" IS NOT NULL
           OR ("cgst_amount" = 0 AND "sgst_amount" = 0 AND "igst_amount" = 0)),

  -- CGST and SGST always travel together, and never with IGST. A purchase is
  -- one or the other; a row carrying both is not a purchase that happened.
  ADD CONSTRAINT "grns_supply_type_matches_tax"
    CHECK (
      "supply_type" IS NULL
      OR ("supply_type" = 'INTRA_STATE' AND "igst_amount" = 0)
      OR ("supply_type" = 'INTER_STATE' AND "cgst_amount" = 0 AND "sgst_amount" = 0)
    ),

  -- Intra-state splits the rate in half, each half rounded on its own.
  ADD CONSTRAINT "grns_cgst_is_half_the_rate"
    CHECK ("gst_rate_pct" IS NULL OR "supply_type" <> 'INTRA_STATE'
           OR "cgst_amount" = ROUND("amount" * "gst_rate_pct" / 2, 2)),
  ADD CONSTRAINT "grns_sgst_is_half_the_rate"
    CHECK ("gst_rate_pct" IS NULL OR "supply_type" <> 'INTRA_STATE'
           OR "sgst_amount" = ROUND("amount" * "gst_rate_pct" / 2, 2)),

  -- Inter-state charges the whole rate as IGST.
  ADD CONSTRAINT "grns_igst_is_the_whole_rate"
    CHECK ("gst_rate_pct" IS NULL OR "supply_type" <> 'INTER_STATE'
           OR "igst_amount" = ROUND("amount" * "gst_rate_pct", 2)),

  -- The total is the sum of the rounded parts, which is the order a tax
  -- authority expects - not amount x (1 + rate), which can differ by a paisa.
  ADD CONSTRAINT "grns_invoice_total_is_the_sum"
    CHECK ("invoice_total" IS NULL
           OR "invoice_total" = "amount" + "cgst_amount" + "sgst_amount" + "igst_amount");

-- A purchase invoice is looked up by the vendor's bill number far more often
-- than by anything else - somebody is holding the paper and typing what it says.
CREATE INDEX "grns_supply_type_idx" ON "grns"("supply_type");
