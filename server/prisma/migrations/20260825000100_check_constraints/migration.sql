-- ===========================================================================
--  Shekhawati Impex ERP - database-level CHECK constraints
--
--  Prisma has no CHECK-constraint syntax, so the quantity / rate / percentage
--  rules that the workbook takes for granted are enforced here. They are
--  intentionally conservative: they reject impossible data (negative
--  quantities, zero-quantity documents) without encoding tolerance policy,
--  which belongs in the service layer where it can produce a useful message.
-- ===========================================================================

-- Masters -------------------------------------------------------------------
ALTER TABLE "styles"
  ADD CONSTRAINT "styles_avg_utilization_positive"
  CHECK ("avg_fabric_utilization_per_pc" > 0);

ALTER TABLE "style_bom_lines"
  ADD CONSTRAINT "style_bom_lines_qty_positive" CHECK ("qty_per_pc" > 0),
  ADD CONSTRAINT "style_bom_lines_wastage_range" CHECK ("wastage_pct" >= 0 AND "wastage_pct" < 1);

-- Buyer Order ---------------------------------------------------------------
ALTER TABLE "buyer_orders"
  ADD CONSTRAINT "buyer_orders_qty_positive" CHECK ("order_qty" > 0),
  ADD CONSTRAINT "buyer_orders_excess_range" CHECK ("excess_pct" >= 0 AND "excess_pct" < 1);

-- Planning ------------------------------------------------------------------
ALTER TABLE "plannings"
  ADD CONSTRAINT "plannings_qty_positive" CHECK ("order_qty" > 0),
  ADD CONSTRAINT "plannings_version_positive" CHECK ("version" >= 1);

ALTER TABLE "planning_lines"
  ADD CONSTRAINT "planning_lines_deliverable_positive" CHECK ("deliverable_size" > 0),
  ADD CONSTRAINT "planning_lines_allotted_non_negative"
    CHECK ("cutting_pcs_allotted" IS NULL OR "cutting_pcs_allotted" >= 0);

-- Vendor Quotation ----------------------------------------------------------
ALTER TABLE "vendor_quotations"
  ADD CONSTRAINT "vendor_quotations_qty_positive" CHECK ("qty" > 0),
  ADD CONSTRAINT "vendor_quotations_rate_non_negative" CHECK ("rate_quoted" >= 0),
  ADD CONSTRAINT "vendor_quotations_amount_non_negative" CHECK ("amount" >= 0);

-- Purchase Order ------------------------------------------------------------
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_qty_positive" CHECK ("order_qty" > 0),
  ADD CONSTRAINT "purchase_orders_rate_non_negative" CHECK ("rate" >= 0),
  ADD CONSTRAINT "purchase_orders_amount_non_negative" CHECK ("amount" >= 0),
  ADD CONSTRAINT "purchase_orders_excess_range" CHECK ("excess_allowed" >= 0 AND "excess_allowed" < 1),
  ADD CONSTRAINT "purchase_orders_received_non_negative" CHECK ("received_qty" >= 0),
  -- A rejected PO must carry a reason; an approved one must carry a timestamp.
  ADD CONSTRAINT "purchase_orders_rejection_reason_present"
    CHECK ("approval_status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL),
  ADD CONSTRAINT "purchase_orders_approved_at_present"
    CHECK ("approval_status" <> 'APPROVED' OR "approved_at" IS NOT NULL);

-- Gate Pass -----------------------------------------------------------------
ALTER TABLE "gate_passes"
  ADD CONSTRAINT "gate_passes_qty_positive" CHECK ("qty" > 0),
  ADD CONSTRAINT "gate_passes_received_non_negative"
    CHECK ("received_qty" IS NULL OR "received_qty" >= 0);

-- GRN -----------------------------------------------------------------------
ALTER TABLE "grns"
  ADD CONSTRAINT "grns_order_qty_positive" CHECK ("order_qty" > 0),
  ADD CONSTRAINT "grns_receiving_qty_non_negative" CHECK ("receiving_qty" >= 0),
  ADD CONSTRAINT "grns_rate_non_negative" CHECK ("inventory_rate" >= 0),
  ADD CONSTRAINT "grns_amount_non_negative" CHECK ("amount" >= 0);

-- Fabric Roll ---------------------------------------------------------------
ALTER TABLE "fabric_rolls"
  ADD CONSTRAINT "fabric_rolls_received_positive" CHECK ("received_qty" > 0),
  ADD CONSTRAINT "fabric_rolls_balance_non_negative" CHECK ("balance_qty" >= 0),
  ADD CONSTRAINT "fabric_rolls_rate_non_negative" CHECK ("rate" IS NULL OR "rate" >= 0),
  ADD CONSTRAINT "fabric_rolls_width_positive" CHECK ("width" IS NULL OR "width" > 0);

-- Inventory -----------------------------------------------------------------
ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_reorder_non_negative" CHECK ("reorder_level" >= 0);

ALTER TABLE "stock_balances"
  ADD CONSTRAINT "stock_balances_rate_non_negative" CHECK ("avg_rate" >= 0),
  ADD CONSTRAINT "stock_balances_in_process_non_negative" CHECK ("in_process_qty" >= 0);

ALTER TABLE "stock_ledger"
  ADD CONSTRAINT "stock_ledger_qty_positive" CHECK ("qty" > 0),
  ADD CONSTRAINT "stock_ledger_rate_non_negative" CHECK ("rate" >= 0);

-- Fabric Issue --------------------------------------------------------------
ALTER TABLE "fabric_issues"
  ADD CONSTRAINT "fabric_issues_qty_positive" CHECK ("fabric_qty_issued" > 0);

-- Dyeing / job work ---------------------------------------------------------
ALTER TABLE "dye_issues"
  ADD CONSTRAINT "dye_issues_qty_positive" CHECK ("qty" > 0),
  ADD CONSTRAINT "dye_issues_rate_non_negative" CHECK ("rate" >= 0),
  ADD CONSTRAINT "dye_issues_amount_non_negative" CHECK ("amount" >= 0),
  ADD CONSTRAINT "dye_issues_shrinkage_range"
    CHECK ("standard_shrinkage_allowed" >= 0 AND "standard_shrinkage_allowed" < 1);

ALTER TABLE "dyeing_receipts"
  ADD CONSTRAINT "dyeing_receipts_issued_positive" CHECK ("qty_issued" > 0),
  ADD CONSTRAINT "dyeing_receipts_received_non_negative" CHECK ("qty_received" >= 0),
  ADD CONSTRAINT "dyeing_receipts_std_shrinkage_range"
    CHECK ("standard_shrinkage_allowed" >= 0 AND "standard_shrinkage_allowed" < 1);

-- Printing ------------------------------------------------------------------
ALTER TABLE "printings"
  ADD CONSTRAINT "printings_qty_positive" CHECK ("qty" > 0);

-- Fabric Scrutiny -----------------------------------------------------------
ALTER TABLE "fabric_scrutinies"
  ADD CONSTRAINT "fabric_scrutinies_qty_positive" CHECK ("qty_affected" > 0);

-- Plan Approval -------------------------------------------------------------
ALTER TABLE "plan_approvals"
  ADD CONSTRAINT "plan_approvals_round_positive" CHECK ("round" >= 1),
  ADD CONSTRAINT "plan_approvals_rejection_reason_present"
    CHECK ("approval_status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL),
  ADD CONSTRAINT "plan_approvals_approved_date_present"
    CHECK ("approval_status" <> 'APPROVED' OR "approved_date" IS NOT NULL);

-- Cutting Issue -------------------------------------------------------------
ALTER TABLE "cutting_issues"
  ADD CONSTRAINT "cutting_issues_planned_non_negative" CHECK ("planned_cutting" >= 0),
  ADD CONSTRAINT "cutting_issues_to_be_issued_non_negative"
    CHECK ("unit_wise_cutting_pcs_to_be_issued" >= 0),
  ADD CONSTRAINT "cutting_issues_issued_non_negative" CHECK ("cutting_pcs_issued" >= 0),
  ADD CONSTRAINT "cutting_issues_handle_non_negative" CHECK ("handle_issued" >= 0);

-- Document numbering --------------------------------------------------------
ALTER TABLE "document_sequences"
  ADD CONSTRAINT "document_sequences_next_number_positive" CHECK ("next_number" >= 1),
  ADD CONSTRAINT "document_sequences_pad_length_range"
    CHECK ("pad_length" >= 1 AND "pad_length" <= 12);

ALTER TABLE "document_amendments"
  ADD CONSTRAINT "document_amendments_no_positive" CHECK ("amendment_no" >= 1);

ALTER TABLE "approval_history"
  ADD CONSTRAINT "approval_history_sequence_positive" CHECK ("sequence_no" >= 1);
