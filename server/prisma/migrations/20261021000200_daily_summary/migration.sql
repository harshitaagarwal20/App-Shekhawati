-- ===========================================================================
--  THE DAILY SUMMARY
-- ===========================================================================
--
--  An evening message of the day's work - pieces cut and stitched, QC and
--  rejections, approvals waiting - sent to the holders of REPORT.SUMMARY.
--  See services/dailySummary.service.js.
--
--    users.notify_daily_summary   each person's own switch; on by default,
--                                 because who RECEIVES it is decided by the
--                                 permission, not by this column.
--
--  Then the reference data a migrated (not seeded) database needs: the
--  permission, and its grant to the Director. Idempotent.
-- ===========================================================================

ALTER TABLE "users" ADD COLUMN "notify_daily_summary" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'REPORT.SUMMARY', 'REPORT', 'SUMMARY', 'Summary report', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = 'REPORT.SUMMARY');

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
  FROM "roles" r
  JOIN "permissions" p ON p."code" = 'REPORT.SUMMARY'
 WHERE r."code" = 'DIRECTOR'
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;
