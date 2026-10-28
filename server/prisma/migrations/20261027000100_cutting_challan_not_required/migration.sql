-- ===========================================================================
--  THE CUTTING CHALLAN IS NO LONGER REQUIRED
-- ===========================================================================
--
--  The office does not raise cutting challans: fabric goes to the cutting floor
--  on a Fabric Issue that quotes the order and nothing else. So a new issue to
--  cutting no longer has to name a challan line.
--
--  Only the requirement goes. The challan tables, the existing challans and the
--  link from an issue to its line are kept, and an issue that does quote a line
--  is still held to it by `cutting_challan_lines_no_over_fulfilment`.
--
--  To bring the requirement back, re-run the CHECK in
--  20260829000100_c5_challan_required_only_for_cutting.
-- ===========================================================================

ALTER TABLE "fabric_issues" DROP CONSTRAINT "fabric_issues_new_rows_need_challan";
