-- ===========================================================================
--  CUTTING_CHALLAN.EXPORT - the permission that was never created
-- ===========================================================================
--
--  The seeder generates every action in ACTIONS for every module in MODULES
--  (seed/data/rbac.js), so CUTTING_CHALLAN.EXPORT exists on a freshly seeded
--  database. The migration that added the C5 permissions to an ALREADY LIVE
--  database - 20260827001200 - listed only VIEW, CREATE, EDIT, DELETE and
--  APPROVE. EXPORT was missed.
--
--  On any database built by migrating rather than seeding, that permission
--  therefore does not exist, and a permission that does not exist cannot be
--  held by anybody - not even by a role whose grant is a wildcard, because
--  wildcards match PERMISSION ROWS. The visible effect today:
--
--    - Downloading the cutting challan register returns 403. The dataset is
--      registered (dataset.registry.js, key 'cutting-challans') and the
--      Export button is on the screen, but requireExportPermission asks for
--      CUTTING_CHALLAN.EXPORT and nobody can hold it.
--
--  It is also what the new GET /cutting-challans/:id/print route is guarded
--  by, matching every other print route in the application.
--
--  Granted to whoever already holds CUTTING_ISSUE.EXPORT - the same document
--  one step later, and the pattern 20260827001200 used for the other four. No
--  role is named here: the office's own decisions carry forward.
-- ===========================================================================

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.module, v.action, v.description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('CUTTING_CHALLAN.EXPORT', 'CUTTING_CHALLAN', 'EXPORT',
     'C5: download the cutting challan register, and print a challan.')
  ) AS v(code, module, action, description)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT rp."role_id", np."id", CURRENT_TIMESTAMP
  FROM (VALUES
    ('CUTTING_CHALLAN.EXPORT', 'CUTTING_ISSUE.EXPORT')
  ) AS m(new_code, like_code)
  JOIN "permissions" np ON np."code" = m.new_code
  JOIN "permissions" lp ON lp."code" = m.like_code
  JOIN "role_permissions" rp ON rp."permission_id" = lp."id"
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x
    WHERE x."role_id" = rp."role_id" AND x."permission_id" = np."id"
 );
