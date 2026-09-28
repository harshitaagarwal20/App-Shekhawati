-- ===========================================================================
--  C5 CORRECTION - THE CHALLAN GOVERNS ISSUES TO CUTTING, AND ONLY THOSE
-- ===========================================================================
--
--  `fabric_issues_new_rows_need_challan`, as first written, required EVERY
--  fabric issue created after the C5 migration to quote a cutting challan
--  line. That is wrong, and the end-to-end test is what caught it.
--
--  A fabric issue has three destinations and three different authorisations:
--
--      to the CUTTING FLOOR   an approved Cutting Challan line        (C5)
--      to a JOB WORKER        an approved Job Work order              (C3)
--      back to the STORE      none - a return fulfils no requirement
--
--  The cutting department does not raise requirements for cloth going to a dye
--  house, so no challan line could ever exist for a dyeing issue. The original
--  constraint therefore made it impossible to send fabric to a job worker at
--  all - it refused the very movement C3 exists to authorise.
--
--  The rule the constraint should have expressed, and now does:
--
--      a new issue needs a challan line UNLESS it is going to a job worker
--      or coming back to the store.
--
--  Nothing is weakened. An issue to cutting still cannot be raised without an
--  approved challan line, which is the control C5 asks for; the purposes that
--  were never governed by a challan are no longer pretending to be.
-- ===========================================================================

ALTER TABLE "fabric_issues" DROP CONSTRAINT "fabric_issues_new_rows_need_challan";

ALTER TABLE "fabric_issues"
  ADD CONSTRAINT "fabric_issues_new_rows_need_challan"
  CHECK (
    -- History, untouched: the issues that predate the cutting challan.
    "created_at" < TIMESTAMPTZ '2026-08-27 00:00:00+00'
    -- Authorised by a Job Work order instead (C3).
    OR "purpose" IN ('DYEING', 'PRINTING')
    -- A return fulfils nothing; it puts cloth back on the rack.
    OR "purpose" = 'RETURN'
    -- Everything else - cutting, above all - must quote its challan line.
    OR "cutting_challan_line_id" IS NOT NULL
  );
