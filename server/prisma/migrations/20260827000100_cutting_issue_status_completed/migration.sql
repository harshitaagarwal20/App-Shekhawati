-- ===========================================================================
--  Close the challans that were already cut
--
--  The CUTTING_ISSUE legacy map had no POSTED entry, so posting a challan left
--  its `status` column at IN_PROGRESS and nothing could move it on - there is
--  no /cutting-issues/:id/status route, and FULFILMENT_TRANSITIONS would not
--  have permitted the move from a screen anyway.
--
--  approvalEngine.js now maps POSTED -> COMPLETED, which closes every challan
--  posted from here on. This closes the ones posted before that fix.
--
--  Nothing here changes what happened. The cloth was cut; the column now says
--  so, and the dashboard's Cutting Issue stage can fall back to zero instead
--  of counting every challan ever posted as still open.
-- ===========================================================================

UPDATE "cutting_issues"
   SET "status" = 'COMPLETED'
 WHERE "workflow_state" = 'POSTED'
   AND "status" = 'IN_PROGRESS';
