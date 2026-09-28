-- Record cutting damage separately from ordinary wastage.
ALTER TABLE "cutting_issues"
  ADD COLUMN "cutting_pcs_damaged" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "fabric_damage_qty" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "cutting_issues"
  DROP CONSTRAINT "cutting_issues_fabric_quantities_non_negative",
  DROP CONSTRAINT "cutting_issues_remainder_reconciles";

ALTER TABLE "cutting_issues"
  ADD CONSTRAINT "cutting_issues_fabric_quantities_non_negative"
    CHECK ("issued_qty" >= 0 AND "consumed_qty" >= 0 AND "remainder_qty" >= 0 AND
      "wastage_qty" >= 0 AND "fabric_damage_qty" >= 0),
  ADD CONSTRAINT "cutting_issues_remainder_reconciles"
    CHECK ("issued_qty" = "consumed_qty" + "remainder_qty" + "wastage_qty" + "fabric_damage_qty");